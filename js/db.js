/**
 * db.js — BAZA LOKALNA (IndexedDB)
 * -------------------------------------------------------------
 * Wszystkie dane trzymane są w przeglądarce, więc aplikacja działa bez internetu.
 * Każdy zapis:
 *  - nadaje pola audytu: createdAt/createdBy (kto i kiedy dodał),
 *    updatedAt/updatedBy (kto i kiedy zmienił),
 *  - ustawia znacznik _dirty=1, czyli „do wysłania” — sync.js wyśle go
 *    do Supabase, gdy będzie internet.
 * Usuwanie jest „miękkie”: rekord dostaje deletedAt i trafia do kosza (30 dni).
 */
import { STORE_NAMES, TRASH_DAYS } from './model.js';
import { uuid, groupBy, byDate, normalizeTag } from './utils.js';

const DB_NAME = 'obora';
const DB_VERSION = 1;
let dbPromise = null;
let currentUser = 'Ja';
const listeners = new Set();
let cache = null; // wynik loadAll() — kasowany przy każdej zmianie
let syncActive = false; // czy działa synchronizacja (wtedy nie kasujemy niewysłanych „nagrobków”
export function setSyncActive(v) { syncActive = !!v; }

/** Ustawia nazwę użytkownika zapisywaną przy wpisach (e-mail lub imię). */
export function setCurrentUser(name) { currentUser = name || 'Ja'; }
export function getCurrentUser() { return currentUser; }

/** Otwiera (i przy pierwszym uruchomieniu tworzy) bazę. */
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) {
          const s = db.createObjectStore(name, { keyPath: 'id' });
          s.createIndex('dirty', '_dirty');
        }
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Pomocnik: wykonuje operację w transakcji i zwraca Promise. */
async function tx(stores, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    result = fn(t);
  });
}

const reqP = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

/** Powiadamia widoki i synchronizację o zmianie danych. source: 'local' | 'remote'. */
function emit(source = 'local') {
  cache = null;
  for (const fn of listeners) { try { fn(source); } catch (e) { console.error(e); } }
}
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/* ---------------- ODCZYT ---------------- */

export async function getAll(store, { withDeleted = false } = {}) {
  const db = await openDB();
  const all = await reqP(db.transaction(store).objectStore(store).getAll());
  return withDeleted ? all : all.filter(r => !r.deletedAt);
}

export async function get(store, id) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).get(id));
}

/* ---------------- ZAPIS ---------------- */

/** Uzupełnia pola audytu i znacznik „do wysłania”. */
function stamp(rec) {
  const now = new Date().toISOString();
  if (!rec.id) rec.id = uuid();
  if (!rec.createdAt) { rec.createdAt = now; rec.createdBy = currentUser; }
  rec.updatedAt = now;
  rec.updatedBy = currentUser;
  if (rec.deletedAt === undefined) rec.deletedAt = null;
  rec._dirty = 1;
  return rec;
}

/** Zapisuje (dodaje lub aktualizuje) rekord. Zwraca zapisany rekord. */
export async function save(store, rec) {
  const r = stamp({ ...rec });
  await tx([store], 'readwrite', t => t.objectStore(store).put(r));
  emit();
  return r;
}

/** Zapisuje wiele rekordów naraz (np. ważenie grupy krów). */
export async function saveMany(store, recs) {
  const out = recs.map(r => stamp({ ...r }));
  await tx([store], 'readwrite', t => { const s = t.objectStore(store); out.forEach(r => s.put(r)); });
  emit();
  return out;
}

/** Przenosi rekord do kosza (miękkie usunięcie). */
export async function softDelete(store, id) {
  const r = await get(store, id);
  if (!r) return;
  r.deletedAt = new Date().toISOString();
  await save(store, r);
}

export async function restore(store, id) {
  const r = await get(store, id);
  if (!r) return;
  r.deletedAt = null;
  await save(store, r);
}

/** Trwałe usunięcie z bazy lokalnej (bez śladu). */
export async function purge(store, id) {
  await tx([store], 'readwrite', t => t.objectStore(store).delete(id));
  emit();
}

/** Usuwa z kosza wpisy starsze niż 30 dni. Wywoływane przy starcie. */
export async function purgeOldTrash() {
  const limit = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString();
  let n = 0;
  for (const s of STORE_NAMES) {
    const all = await getAll(s, { withDeleted: true });
    const old = all.filter(r => r.deletedAt && r.deletedAt < limit && (!r._dirty || !syncActive));
    if (old.length) {
      await tx([s], 'readwrite', t => { const st = t.objectStore(s); old.forEach(r => st.delete(r.id)); });
      n += old.length;
    }
  }
  if (n) emit();
  return n;
}

/* ---------------- SYNCHRONIZACJA (używane przez sync.js) ---------------- */

/** Wszystkie rekordy oczekujące na wysłanie: [{store, rec}]. */
export async function getDirty() {
  const out = [];
  for (const s of STORE_NAMES) {
    const db = await openDB();
    const recs = await reqP(db.transaction(s).objectStore(s).index('dirty').getAll(1));
    recs.forEach(rec => out.push({ store: s, rec }));
  }
  return out;
}

/** Oznacza rekord jako wysłany, o ile w międzyczasie nie został znów zmieniony. */
export async function markClean(store, id, updatedAt) {
  await tx([store], 'readwrite', t => {
    const s = t.objectStore(store);
    const r = s.get(id);
    r.onsuccess = () => {
      const rec = r.result;
      if (rec && rec.updatedAt === updatedAt) { rec._dirty = 0; s.put(rec); }
    };
  });
}

/**
 * Zapisuje rekordy pobrane z serwera. Zasada „ostatni zapis wygrywa”:
 * jeśli lokalna wersja ma niewysłane zmiany i jest nowsza — zostaje lokalna.
 */
export async function applyRemote(items) {
  let changed = 0;
  const byStore = groupBy(items, i => i.store);
  for (const [store, list] of byStore) {
    if (!STORE_NAMES.includes(store)) continue;
    await tx([store], 'readwrite', t => {
      const s = t.objectStore(store);
      for (const { rec } of list) {
        const g = s.get(rec.id);
        g.onsuccess = () => {
          const local = g.result;
          if (local && local._dirty && local.updatedAt > rec.updatedAt) return;
          if (local && local.updatedAt === rec.updatedAt && !local._dirty) return;
          s.put({ ...rec, _dirty: 0 });
          changed++;
        };
      }
    });
  }
  if (changed) emit('remote');
  return changed;
}

/** Oznacza wszystkie rekordy jako „do wysłania” (np. po podłączeniu nowego gospodarstwa). */
export async function markAllDirty() {
  for (const s of STORE_NAMES) {
    const all = await getAll(s, { withDeleted: true });
    await tx([s], 'readwrite', t => { const st = t.objectStore(s); all.forEach(r => { r._dirty = 1; st.put(r); }); });
  }
}

/* ---------------- META (ustawienia lokalne, nie synchronizowane) ---------------- */

export async function getMeta(key, def = null) {
  const db = await openDB();
  const r = await reqP(db.transaction('meta').objectStore('meta').get(key));
  return r ? r.value : def;
}

export async function setMeta(key, value) {
  await tx(['meta'], 'readwrite', t => t.objectStore('meta').put({ key, value }));
}

/* ---------------- KOPIA ZAPASOWA ---------------- */

/** Wszystkie dane (z koszem) jako obiekt do zapisania w JSON. */
export async function exportAll() {
  const data = { app: 'obora', version: 1, exportedAt: new Date().toISOString(), stores: {} };
  for (const s of STORE_NAMES) data.stores[s] = (await getAll(s, { withDeleted: true })).map(({ _dirty, ...r }) => r);
  return data;
}

/**
 * Wczytuje kopię. mode='replace' — zastępuje wszystko; 'merge' — dokłada,
 * przy konflikcie zostaje nowsza wersja rekordu.
 */
export async function importAll(data, mode = 'merge') {
  if (!data || data.app !== 'obora' || !data.stores) throw new Error('To nie jest plik kopii zapasowej aplikacji Obora.');
  let n = 0;
  for (const s of STORE_NAMES) {
    const recs = Array.isArray(data.stores[s]) ? data.stores[s] : [];
    await tx([s], 'readwrite', t => {
      const st = t.objectStore(s);
      if (mode === 'replace') st.clear();
      for (const r of recs) {
        if (!r || !r.id) continue;
        if (mode === 'replace') { st.put({ ...r, _dirty: 1 }); n++; continue; }
        const g = st.get(r.id);
        g.onsuccess = () => {
          if (!g.result || (g.result.updatedAt || '') < (r.updatedAt || '')) { st.put({ ...r, _dirty: 1 }); n++; }
        };
      }
    });
  }
  emit();
  return n;
}

/** Czyści wszystkie dane (używane przy wylogowaniu z innego gospodarstwa). */
export async function clearAll() {
  await tx(STORE_NAMES, 'readwrite', t => STORE_NAMES.forEach(s => t.objectStore(s).clear()));
  emit();
}

/* ---------------- WSZYSTKO NARAZ (dla widoków) ---------------- */

/**
 * Wczytuje wszystkie aktywne (nieusunięte) dane i buduje indeksy:
 *   d.cows, d.weights, ...           — tablice
 *   d.cowsById, d.cowsByTag          — Map
 *   d.of('weights', cowId)           — wpisy danej krowy posortowane po dacie
 * Wynik jest pamiętany do następnej zmiany w bazie.
 */
export async function loadAll() {
  if (cache) return cache;
  const d = {};
  for (const s of STORE_NAMES) d[s] = await getAll(s);
  d.cowsById = new Map(d.cows.map(c => [c.id, c]));
  d.cowsByTag = new Map(d.cows.map(c => [normalizeTag(c.earTag), c]));
  const idx = {};
  d.of = (store, cowId) => {
    if (!idx[store]) idx[store] = groupBy(d[store].slice().sort(byDate), r => r.cowId);
    return idx[store].get(cowId) || [];
  };
  cache = d;
  return d;
}
