/**
 * sync.js — SYNCHRONIZACJA przez Supabase (laptop ↔ telefon, wielu użytkowników)
 * -------------------------------------------------------------
 * Bez zewnętrznych bibliotek: rozmawiamy z Supabase zwykłym fetch()
 * (logowanie: /auth/v1, dane: /rest/v1).
 *
 * Jak to działa:
 *  1. Każda zmiana zapisana w telefonie dostaje znacznik „do wysłania” (db.js).
 *  2. Gdy jest internet, sync wysyła takie wpisy funkcją push_records
 *     (nowsza zmiana wygrywa — starsza nie nadpisze nowszej).
 *  3. Potem pobiera wszystko, co od ostatniego razu zmieniło się na serwerze
 *     (inne urządzenia, inni użytkownicy).
 *  4. Bez internetu nic się nie traci — wpisy czekają i wyślą się później.
 * Synchronizacja uruchamia się: po każdej zmianie (po 2 s), po odzyskaniu
 * internetu, po powrocie do aplikacji i co minutę, gdy aplikacja jest otwarta.
 */
import * as db from './db.js';
import { debounce } from './utils.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const KEY = 'obora-sync';
const BATCH = 200;
const PULL_LIMIT = 1000;
const OVERLAP_MS = 60 * 1000; // pobieramy z zapasem 1 minuty (bezpieczne — wpisy są nadpisywane)

let cfg = load();
let running = false, again = false, timer = null;
const status = { state: 'off', lastSync: null, error: null, pending: 0 };
const listeners = new Set();

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
function persist() { localStorage.setItem(KEY, JSON.stringify(cfg)); }

export const getConfig = () => ({ url: cfg.url || SUPABASE_URL, key: cfg.key || SUPABASE_ANON_KEY });
export const isConfigured = () => !!(getConfig().url && getConfig().key);
export const getSession = () => cfg.session || null;
export const getFarm = () => cfg.farm || null;
export const getStatus = () => ({ ...status });
export const isActiveSync = () => !!(isConfigured() && cfg.session && cfg.farm);
export const hasBuiltInConfig = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);

export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setStatus(patch) {
  Object.assign(status, patch);
  for (const fn of listeners) try { fn(getStatus()); } catch (e) { console.error(e); }
}

/* ---------------- KOMUNIKACJA Z SUPABASE ---------------- */

/** Tłumaczenie typowych komunikatów Supabase na polski. */
function translate(msg = '') {
  const m = String(msg);
  const map = [
    [/invalid login credentials/i, 'Błędny e-mail lub hasło.'],
    [/email not confirmed/i, 'Adres e-mail nie jest potwierdzony — kliknij link w wiadomości od Supabase.'],
    [/user already registered|already been registered/i, 'Konto z tym adresem e-mail już istnieje — zaloguj się.'],
    [/password should be at least/i, 'Hasło musi mieć co najmniej 6 znaków.'],
    [/unable to validate email|invalid email/i, 'Nieprawidłowy adres e-mail.'],
    [/rate limit|too many/i, 'Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie.'],
    [/jwt expired/i, 'Sesja wygasła — zaloguj się ponownie.'],
    [/invalid api key|no api key/i, 'Nieprawidłowy klucz Supabase (anon public).'],
    [/failed to fetch|networkerror|load failed/i, 'Brak połączenia z serwerem (sprawdź internet i adres Supabase).'],
    [/relation .* does not exist|could not find the function/i, 'Baza Supabase nie jest przygotowana — uruchom skrypt supabase/schema.sql.'],
  ];
  for (const [re, pl] of map) if (re.test(m)) return pl;
  return m || 'Nieznany błąd synchronizacji.';
}

export class SyncError extends Error {
  constructor(msg, status) { super(translate(msg)); this.status = status; }
}

async function api(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  const { url, key } = getConfig();
  if (!url || !key) throw new SyncError('Brak adresu lub klucza Supabase.');
  let res;
  try {
    res = await fetch(url.replace(/\/+$/, '') + path, {
      method,
      headers: {
        apikey: key, 'Content-Type': 'application/json',
        // zalogowany: token użytkownika; niezalogowany: sam klucz w nagłówku apikey
        ...(auth && cfg.session ? { Authorization: `Bearer ${cfg.session.access_token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) { throw new SyncError(e.message, 0); }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) throw new SyncError(json?.msg || json?.message || json?.error_description || json?.error || res.statusText, res.status);
  return json;
}

/* ---------------- KONFIGURACJA I LOGOWANIE ---------------- */

export function configure(url, key) {
  cfg.url = String(url || '').trim().replace(/\/+$/, '');
  cfg.key = String(key || '').trim();
  persist();
}

/** Sprawdza, czy adres i klucz są poprawne. */
export async function testConnection() {
  await api('/auth/v1/settings', { auth: false });
  return true;
}

function storeSession(s) {
  cfg.session = {
    access_token: s.access_token, refresh_token: s.refresh_token,
    expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600),
    user: { id: s.user?.id, email: s.user?.email },
  };
  persist();
  applyUserName();
}

/** Nazwa zapisywana przy wpisach: imię z ustawień, a gdy brak — e-mail. */
export function applyUserName() {
  const name = localStorage.getItem('obora-user');
  db.setCurrentUser(name || cfg.session?.user?.email || 'Ja');
}

export async function signUp(email, password) {
  const redirect = location.origin + location.pathname;
  const r = await api(`/auth/v1/signup?redirect_to=${encodeURIComponent(redirect)}`, { method: 'POST', auth: false, body: { email, password } });
  if (r?.access_token) { storeSession(r); return { confirmed: true }; }
  return { confirmed: false }; // trzeba kliknąć link w e-mailu
}

export async function signIn(email, password) {
  const r = await api('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email, password } });
  storeSession(r);
}

export async function resetPassword(email) {
  const redirect = location.origin + location.pathname;
  await api(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirect)}`, { method: 'POST', auth: false, body: { email } });
}

export async function setNewPassword(password) {
  await ensureToken();
  await api('/auth/v1/user', { method: 'PUT', body: { password } });
}

export async function signOut() {
  try { if (cfg.session) await api('/auth/v1/logout', { method: 'POST' }); } catch { /* i tak wylogowujemy lokalnie */ }
  cfg.session = null;
  cfg.farm = null;
  persist();
  db.setSyncActive(false);
  applyUserName();
  setStatus({ state: 'off', error: null });
}

/** Odświeża token logowania, gdy wygasa (co godzinę). */
async function ensureToken() {
  const s = cfg.session;
  if (!s) throw new SyncError('Nie zalogowano.', 401);
  if (s.expires_at - 120 > Date.now() / 1000) return;
  try {
    const r = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: s.refresh_token } });
    storeSession(r);
  } catch (e) {
    if (e.status >= 400 && e.status < 500) { cfg.session = null; persist(); }
    throw e;
  }
}

/**
 * Obsługa linku z e-maila (potwierdzenie konta / reset hasła).
 * Supabase dopisuje do adresu #access_token=...; zamieniamy to na sesję.
 * Zwraca 'recovery' przy resecie hasła, 'login' przy potwierdzeniu, albo null.
 */
export async function captureAuthRedirect() {
  const h = location.hash;
  if (!h.includes('access_token=') && !h.includes('error_description=')) return null;
  const p = new URLSearchParams(h.replace(/^#\/?/, ''));
  history.replaceState(null, '', location.pathname + '#/synchronizacja');
  if (p.get('error_description')) { setStatus({ error: translate(p.get('error_description')) }); return null; }
  cfg.session = { access_token: p.get('access_token'), refresh_token: p.get('refresh_token'),
    expires_at: Number(p.get('expires_at')) || Math.floor(Date.now() / 1000) + Number(p.get('expires_in') || 3600), user: {} };
  try {
    const u = await api('/auth/v1/user');
    cfg.session.user = { id: u.id, email: u.email };
  } catch { /* uzupełni się później */ }
  persist();
  applyUserName();
  return p.get('type') === 'recovery' ? 'recovery' : 'login';
}

/* ---------------- GOSPODARSTWA I UŻYTKOWNICY ---------------- */

export async function listFarms() {
  await ensureToken();
  const farms = await api('/rest/v1/farms?select=id,name,join_code,created_by&order=created_at');
  const mem = await api(`/rest/v1/farm_members?select=farm_id,role&user_id=eq.${cfg.session.user.id}`);
  const role = new Map(mem.map(m => [m.farm_id, m.role]));
  return farms.map(f => ({ ...f, role: role.get(f.id) || 'pracownik' }));
}

export async function createFarm(name) {
  await ensureToken();
  return api('/rest/v1/rpc/create_farm', { method: 'POST', body: { farm_name: name } });
}

export async function joinFarm(code) {
  await ensureToken();
  return api('/rest/v1/rpc/join_farm', { method: 'POST', body: { code } });
}

/** Podłącza to urządzenie do gospodarstwa i wysyła lokalne dane. */
export async function selectFarm(farm, role) {
  cfg.farm = { id: farm.id, name: farm.name, join_code: farm.join_code, role: role || farm.role || 'pracownik' };
  persist();
  await db.setMeta('syncCursor', null);
  await db.markAllDirty(); // wszystkie lokalne wpisy trafią do gospodarstwa
  db.setSyncActive(true);
  setStatus({ state: 'idle', error: null });
  await syncNow();
}

/** Odłącza urządzenie (dane lokalne zostają, przestają się synchronizować). */
export async function disconnectFarm() {
  cfg.farm = null;
  persist();
  db.setSyncActive(false);
  setStatus({ state: 'off' });
}

export async function members() {
  await ensureToken();
  return api(`/rest/v1/farm_members?select=user_id,email,role,joined_at&farm_id=eq.${cfg.farm.id}&order=joined_at`);
}

export async function removeMember(userId) {
  await ensureToken();
  await api(`/rest/v1/farm_members?farm_id=eq.${cfg.farm.id}&user_id=eq.${userId}`, { method: 'DELETE' });
}

export async function newJoinCode() {
  await ensureToken();
  const code = await api('/rest/v1/rpc/new_join_code', { method: 'POST', body: { f: cfg.farm.id } });
  cfg.farm.join_code = code;
  persist();
  return code;
}

/* ---------------- SYNCHRONIZACJA ---------------- */

/** Wpis bez pól technicznych. */
const clean = ({ _dirty, ...r }) => r;

async function push() {
  const dirty = await db.getDirty();
  for (let i = 0; i < dirty.length; i += BATCH) {
    const part = dirty.slice(i, i + BATCH);
    const rows = part.map(({ store, rec }) => ({
      farm_id: cfg.farm.id, id: rec.id, store, data: clean(rec),
      updated_at: rec.updatedAt || new Date().toISOString(), updated_by: rec.updatedBy || '', deleted: !!rec.deletedAt,
    }));
    await api('/rest/v1/rpc/push_records', { method: 'POST', body: { rows } });
    for (const { store, rec } of part) await db.markClean(store, rec.id, rec.updatedAt);
  }
  return dirty.length;
}

async function pull() {
  let cursor = await db.getMeta('syncCursor');
  let total = 0, first = true;
  for (;;) {
    let since = cursor;
    if (since && first) since = new Date(new Date(since).getTime() - OVERLAP_MS).toISOString();
    const filter = since ? `&server_updated_at=${first ? 'gte' : 'gt'}.${encodeURIComponent(since)}` : '';
    const rows = await api(`/rest/v1/records?select=store,data,server_updated_at&farm_id=eq.${cfg.farm.id}${filter}&order=server_updated_at.asc&limit=${PULL_LIMIT}`);
    first = false;
    if (!rows.length) break;
    await db.applyRemote(rows.map(r => ({ store: r.store, rec: r.data })));
    total += rows.length;
    cursor = rows[rows.length - 1].server_updated_at;
    await db.setMeta('syncCursor', cursor);
    if (rows.length < PULL_LIMIT) break;
  }
  return total;
}

/** Pełna synchronizacja: wyślij zmiany, pobierz nowości. */
export async function syncNow() {
  if (!isActiveSync()) { setStatus({ state: 'off', pending: (await db.getDirty()).length }); return; }
  if (!navigator.onLine) { setStatus({ state: 'offline', pending: (await db.getDirty()).length }); return; }
  if (running) { again = true; return; }
  running = true;
  setStatus({ state: 'syncing', error: null });
  try {
    await ensureToken();
    await push();
    await pull();
    // zmiany zrobione w trakcie wysyłania
    if ((await db.getDirty()).length) await push();
    setStatus({ state: 'idle', lastSync: new Date().toISOString(), error: null, pending: (await db.getDirty()).length });
  } catch (e) {
    console.warn('Synchronizacja:', e);
    setStatus({ state: 'error', error: e.message, pending: (await db.getDirty()).length });
  } finally {
    running = false;
    if (again) { again = false; setTimeout(syncNow, 500); }
  }
}

const syncSoon = debounce(syncNow, 2000);

/** Start przy uruchomieniu aplikacji. */
export async function startSync() {
  applyUserName();
  db.setSyncActive(isActiveSync());
  db.onChange(src => { if (src === 'local') { if (isActiveSync()) syncSoon(); else updatePending(); } });
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => setStatus({ state: isActiveSync() ? 'offline' : 'off' }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  clearInterval(timer);
  timer = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60 * 1000);
  await syncNow();
}

const updatePending = debounce(async () => setStatus({ pending: (await db.getDirty()).length }), 1000);
