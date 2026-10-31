/**
 * model.js — MODEL DANYCH
 * -------------------------------------------------------------
 * Tu opisane są:
 *  - słowniki (grupy, płcie, statusy, rodzaje leczenia...),
 *  - lista „magazynów” (tabel) w bazie IndexedDB i w Supabase,
 *  - definicja pól karty krowy (COW_FIELDS) — z niej powstaje formularz,
 *    widok karty, eksport CSV i wydruk. Aby dodać nowe pole do karty krowy,
 *    wystarczy dopisać jeden obiekt do COW_FIELDS (patrz README),
 *  - walidacja i wszystkie obliczenia „rolnicze”: przyrosty, karencja,
 *    terminy rozrodu, rodowód, zużycie paszy, zgłoszenia ARiMR.
 *
 * Każdy rekord w każdym magazynie ma pola wspólne (nadawane w db.js):
 *   id, createdAt, createdBy, updatedAt, updatedBy, deletedAt, demo
 */
import {
  addDays, daysBetween, todayISO, normalizeTag, isFuture, byDate, parseNum, sum,
} from './utils.js';

/* ---------------- SŁOWNIKI ---------------- */

export const GROUPS = ['Dojne', 'Zasuszone', 'Jałówki', 'Opas', 'Cielęta'];
export const SEXES = ['krowa', 'jałówka', 'byk', 'cielę'];
export const GENDERS = ['samica', 'samiec'];
export const STATUSES = ['aktywna', 'sprzedana', 'padła', 'ubój'];
export const STATUS_LABEL = { aktywna: 'Aktywna', sprzedana: 'Sprzedana', 'padła': 'Padła', 'ubój': 'Ubój' };
export const BREEDS = ['HF (holsztyńsko-fryzyjska)', 'Simentaler', 'Limousine', 'Charolaise',
  'Hereford', 'Angus', 'Belgijska biało-błękitna', 'Polska czerwona', 'Jersey', 'Mieszaniec'];
export const ORIGINS = [{ value: 'urodzona', label: 'Urodzona w gospodarstwie' }, { value: 'zakup', label: 'Zakupiona' }];
export const WEIGH_METHODS = ['waga', 'taśma'];
export const HOOF_STATES = ['dobry', 'przerośnięte', 'kulawizna', 'zapalenie', 'po korekcji'];
export const TREATMENT_TYPES = ['leczenie', 'szczepienie', 'odrobaczanie'];
export const ROUTES = ['domięśniowo', 'podskórnie', 'dożylnie', 'doustnie', 'dowymieniowo',
  'domacicznie', 'zewnętrznie (pour-on)', 'inne'];
export const REPRO_TYPES = ['ruja', 'inseminacja', 'badanie', 'wycielenie', 'zasuszenie', 'poronienie'];
export const PREG_RESULTS = ['cielna', 'niecielna', 'wątpliwa'];
export const CALVING_COURSES = ['łatwy', 'z pomocą', 'trudny', 'cesarskie cięcie'];
export const EVENT_TYPES = ['wizyta weterynarza', 'inseminator', 'korekcja racic', 'inne'];
export const COST_CATEGORIES = ['pasza', 'leki', 'weterynarz', 'inseminacja', 'zakup zwierząt', 'inne koszty'];
export const INCOME_CATEGORIES = ['sprzedaż zwierząt', 'mleko', 'dopłaty', 'inne przychody'];
export const DEFAULT_FEEDS = [
  { name: 'Sianokiszonka', pricePerKg: 0.25 },
  { name: 'Kiszonka z kukurydzy', pricePerKg: 0.22 },
  { name: 'Śruta zbożowa', pricePerKg: 1.10 },
  { name: 'Mieszanka treściwa', pricePerKg: 1.60 },
  { name: 'Siano', pricePerKg: 0.60 },
  { name: 'Mleko dla cieląt', pricePerKg: 2.20 },
];

/** Stałe rozrodu (dni). */
export const GESTATION_DAYS = 283;
export const DRY_OFF_BEFORE = 60;
export const PREG_CHECK_AFTER = 35;
export const HEAT_CYCLE = 21;
/** Termin zgłoszenia zdarzenia do ARiMR (dni). */
export const ARIMR_DAYS = 7;
/** Po ilu dniach bez ważenia przypominać. */
export const WEIGH_REMINDER_DAYS = 30;
/** Ile dni wpisy leżą w koszu. */
export const TRASH_DAYS = 30;

/**
 * MAGAZYNY (tabele). `cowId: true` = rekordy powiązane z krową (indeks po cowId).
 * Ta sama lista służy do IndexedDB, kopii zapasowej i synchronizacji.
 */
export const STORES = {
  cows: { label: 'Zwierzęta' },
  weights: { label: 'Ważenia', cowId: true },
  conditions: { label: 'Kondycja i racice', cowId: true },
  notes: { label: 'Dziennik', cowId: true },
  treatments: { label: 'Leczenia', cowId: true },
  repro: { label: 'Rozród', cowId: true },
  milk: { label: 'Mleko', cowId: true },
  feeds: { label: 'Pasze' },
  rations: { label: 'Dawki' },
  feedStock: { label: 'Magazyn pasz' },
  finance: { label: 'Finanse', cowId: true },
  arimr: { label: 'ARiMR' },
  events: { label: 'Wydarzenia' },
};
export const STORE_NAMES = Object.keys(STORES);

/* ---------------- KARTA KROWY ----------------
 * Każde pole: name (klucz w bazie), label, type, section, i opcjonalnie:
 *  required, options, list (podpowiedzi), unit, showIf(values), help,
 *  inList (pokaż w CSV), card:false (nie pokazuj na karcie).
 * Typy: text, number, date, select, textarea, photo, cowref (wybór ze stada
 * lub wpis ręczny — zapisuje <name>Id i <name>Text), checkbox.
 */
const sold = v => v.status === 'sprzedana';
const exited = v => v.status && v.status !== 'aktywna';
export const COW_FIELDS = [
  { section: 'Identyfikacja', name: 'earTag', label: 'Numer kolczyka', type: 'text', required: true,
    placeholder: 'PL123456789012', help: 'Kod kraju + cyfry, np. PL123456789012', upper: true },
  { section: 'Identyfikacja', name: 'internalNo', label: 'Numer wewnętrzny / obrotowy', type: 'text' },
  { section: 'Identyfikacja', name: 'name', label: 'Imię', type: 'text' },
  { section: 'Opis', name: 'breed', label: 'Rasa', type: 'text', list: BREEDS },
  { section: 'Opis', name: 'sex', label: 'Płeć / kategoria', type: 'select', options: SEXES, required: true },
  { section: 'Opis', name: 'gender', label: 'Płeć cielęcia', type: 'select', options: GENDERS,
    showIf: v => v.sex === 'cielę' },
  { section: 'Opis', name: 'color', label: 'Maść / znaki szczególne', type: 'text' },
  { section: 'Opis', name: 'photo', label: 'Zdjęcie', type: 'photo', card: false },
  { section: 'Urodzenie i pochodzenie', name: 'birthDate', label: 'Data urodzenia', type: 'date', required: true },
  { section: 'Urodzenie i pochodzenie', name: 'origin', label: 'Pochodzenie', type: 'select', options: ORIGINS },
  { section: 'Urodzenie i pochodzenie', name: 'purchaseDate', label: 'Data zakupu', type: 'date', showIf: v => v.origin === 'zakup' },
  { section: 'Urodzenie i pochodzenie', name: 'purchaseFrom', label: 'Zakupiona od', type: 'text', showIf: v => v.origin === 'zakup' },
  { section: 'Urodzenie i pochodzenie', name: 'purchasePrice', label: 'Cena zakupu', type: 'number', unit: 'zł', showIf: v => v.origin === 'zakup' },
  { section: 'Urodzenie i pochodzenie', name: 'purchaseWeight', label: 'Waga przy zakupie', type: 'number', unit: 'kg', showIf: v => v.origin === 'zakup' },
  { section: 'Urodzenie i pochodzenie', name: 'mother', label: 'Matka', type: 'cowref', filter: 'female' },
  { section: 'Urodzenie i pochodzenie', name: 'father', label: 'Ojciec (buhaj)', type: 'cowref', filter: 'male',
    help: 'Wybierz ze stada lub wpisz numer / nazwę buhaja' },
  { section: 'Utrzymanie', name: 'group', label: 'Grupa / kojec', type: 'select', options: GROUPS },
  { section: 'Utrzymanie', name: 'targetWeight', label: 'Docelowa waga sprzedażna', type: 'number', unit: 'kg',
    help: 'Do prognozy terminu sprzedaży' },
  { section: 'Utrzymanie', name: 'status', label: 'Status', type: 'select',
    options: STATUSES.map(s => ({ value: s, label: STATUS_LABEL[s] })) },
  { section: 'Utrzymanie', name: 'exitDate', label: 'Data zdarzenia (sprzedaż / padnięcie / ubój)', type: 'date', showIf: exited },
  { section: 'Utrzymanie', name: 'buyer', label: 'Komu sprzedana', type: 'text', showIf: sold },
  { section: 'Utrzymanie', name: 'salePrice', label: 'Cena sprzedaży', type: 'number', unit: 'zł', showIf: sold },
  { section: 'Utrzymanie', name: 'saleWeight', label: 'Waga przy sprzedaży', type: 'number', unit: 'kg', showIf: sold },
  { section: 'Utrzymanie', name: 'exitCause', label: 'Przyczyna', type: 'text', showIf: v => v.status === 'padła' || v.status === 'ubój' },
  { section: 'Utrzymanie', name: 'remarks', label: 'Uwagi', type: 'textarea' },
];

/** Wartości domyślne nowej krowy. */
export function newCowDefaults() {
  return { sex: 'krowa', origin: 'urodzona', group: 'Dojne', status: 'aktywna' };
}

/* ---------------- WALIDACJA ---------------- */

export const TAG_PATTERN = /^[A-Z]{2}\d{6,14}$/;

/** Sprawdza dane krowy. Zwraca obiekt {pole: 'komunikat'} (pusty = OK). */
export function validateCow(v, allCows, selfId = null) {
  const e = {};
  const tag = normalizeTag(v.earTag);
  if (!tag) e.earTag = 'Numer kolczyka jest wymagany.';
  else if (!TAG_PATTERN.test(tag)) e.earTag = 'Nieprawidłowy format. Oczekiwano np. PL123456789012 (2 litery + cyfry).';
  else if (allCows.some(c => c.id !== selfId && !c.deletedAt && normalizeTag(c.earTag) === tag)) {
    e.earTag = 'Zwierzę z takim numerem kolczyka już istnieje.';
  }
  if (!v.sex) e.sex = 'Wybierz płeć / kategorię.';
  if (!v.birthDate) e.birthDate = 'Podaj datę urodzenia.';
  else if (isFuture(v.birthDate)) e.birthDate = 'Data urodzenia nie może być z przyszłości.';
  for (const f of ['purchaseDate', 'exitDate']) {
    if (v[f] && isFuture(v[f])) e[f] = 'Data nie może być z przyszłości.';
    else if (v[f] && v.birthDate && v[f] < v.birthDate) e[f] = 'Data nie może być wcześniejsza niż data urodzenia.';
  }
  if (v.status && v.status !== 'aktywna' && !v.exitDate) e.exitDate = 'Podaj datę zdarzenia.';
  for (const f of ['purchasePrice', 'salePrice', 'purchaseWeight', 'saleWeight', 'targetWeight']) {
    const n = parseNum(v[f]);
    if (n !== null && n < 0) e[f] = 'Wartość nie może być ujemna.';
  }
  if (selfId && v.motherId === selfId) e.mother = 'Zwierzę nie może być swoją matką.';
  if (selfId && v.fatherId === selfId) e.father = 'Zwierzę nie może być swoim ojcem.';
  return e;
}

/** Wspólna walidacja daty wpisu (ważenie, leczenie...). */
export function validateEntryDate(date, cow) {
  if (!date) return 'Podaj datę.';
  if (isFuture(date)) return 'Data nie może być z przyszłości.';
  if (cow && cow.birthDate && date < cow.birthDate) return 'Data jest wcześniejsza niż urodzenie zwierzęcia.';
  return null;
}

/* ---------------- POMOCNICZE ---------------- */

export const isFemale = c => c.sex === 'krowa' || c.sex === 'jałówka' || (c.sex === 'cielę' && c.gender === 'samica');
export const isMale = c => c.sex === 'byk' || (c.sex === 'cielę' && c.gender === 'samiec');
export const isActive = c => !c.status || c.status === 'aktywna';

/** Krótka etykieta zwierzęcia: „Malina · 12 · …9012”. */
export function cowLabel(c) {
  if (!c) return '—';
  const parts = [];
  if (c.name) parts.push(c.name);
  if (c.internalNo) parts.push(`nr ${c.internalNo}`);
  parts.push(c.earTag || '?');
  return parts.join(' · ');
}

/** Ostatnie 4 cyfry kolczyka (tak rolnicy zwykle mówią o krowie). */
export const tagLast4 = tag => String(tag || '').slice(-4);

/* ---------------- WAGA ---------------- */

/**
 * Statystyki wagi z posortowanej rosnąco listy ważeń.
 * adgLast — przyrost dzienny od poprzedniego ważenia, adgTotal — od pierwszego.
 */
export function weightStats(weights, cow = null, today = todayISO()) {
  const w = weights.filter(x => parseNum(x.kg) > 0).slice().sort(byDate);
  const st = { count: w.length, last: null, prev: null, first: null, adgLast: null, adgTotal: null,
    dropped: false, dropKg: 0, daysSinceLast: null, forecast: null };
  if (!w.length) return st;
  st.last = w[w.length - 1];
  st.first = w[0];
  st.daysSinceLast = daysBetween(st.last.date, today);
  if (w.length > 1) {
    st.prev = w[w.length - 2];
    const d1 = daysBetween(st.prev.date, st.last.date);
    if (d1 > 0) st.adgLast = (st.last.kg - st.prev.kg) / d1;
    const d2 = daysBetween(st.first.date, st.last.date);
    if (d2 > 0) st.adgTotal = (st.last.kg - st.first.kg) / d2;
    st.dropped = st.last.kg < st.prev.kg;
    st.dropKg = st.prev.kg - st.last.kg;
  }
  if (cow) st.forecast = forecastTarget(st, parseNum(cow.targetWeight));
  return st;
}

/** Prognoza osiągnięcia wagi docelowej na podstawie średniego przyrostu. */
export function forecastTarget(st, target) {
  if (!target || !st.last) return null;
  if (st.last.kg >= target) return { reached: true, date: st.last.date, days: 0 };
  const adg = st.adgTotal ?? st.adgLast;
  if (!adg || adg <= 0) return { reached: false, date: null, days: null };
  const days = Math.ceil((target - st.last.kg) / adg);
  return { reached: false, date: addDays(st.last.date, days), days, adg };
}

/* ---------------- LECZENIE I KARENCJA ---------------- */

/**
 * Data końca karencji: od ostatniego dnia podawania leku + liczba dni karencji.
 * (Gdy lek podawano 3 dni od 1.03, ostatnia dawka 3.03, karencja 5 dni -> 8.03.)
 * Karencję uznajemy za trwającą do tej daty WŁĄCZNIE (bezpieczniej).
 */
export function withdrawalEnds(t) {
  const lastDose = addDays(t.date, Math.max(1, parseNum(t.days) || 1) - 1);
  const m = parseNum(t.withdrawalMilk), mt = parseNum(t.withdrawalMeat);
  return {
    milkEnd: m ? addDays(lastDose, m) : null,
    meatEnd: mt ? addDays(lastDose, mt) : null,
  };
}

/** Aktywna karencja zwierzęcia: {milk: data|null, meat: data|null, active: bool}. */
export function activeWithdrawal(treatments, today = todayISO()) {
  let milk = null, meat = null;
  for (const t of treatments) {
    const { milkEnd, meatEnd } = withdrawalEnds(t);
    if (milkEnd && milkEnd >= today && (!milk || milkEnd > milk)) milk = milkEnd;
    if (meatEnd && meatEnd >= today && (!meat || meatEnd > meat)) meat = meatEnd;
  }
  return { milk, meat, active: !!(milk || meat) };
}

/* ---------------- ROZRÓD ---------------- */

export const calvingDate = insemDate => addDays(insemDate, GESTATION_DAYS);
export const dryOffDate = insemDate => addDays(insemDate, GESTATION_DAYS - DRY_OFF_BEFORE);

/**
 * Stan rozrodu zwierzęcia na podstawie listy zdarzeń (ruja, inseminacja...).
 * Zwraca m.in. przewidywaną datę wycielenia i zasuszenia.
 */
export function reproInfo(events, today = todayISO()) {
  const ev = events.slice().sort(byDate);
  const calvings = ev.filter(e => e.type === 'wycielenie');
  const lastCalving = calvings[calvings.length - 1] || null;
  const since = ev.filter(e => !lastCalving || e.date > lastCalving.date ||
    (e.date === lastCalving.date && e.type !== 'wycielenie' && e.createdAt > lastCalving.createdAt));
  const insems = since.filter(e => e.type === 'inseminacja');
  const lastInsem = insems[insems.length - 1] || null;
  const info = { lastCalving, lastInsem, insemCount: insems.length, pregnant: null, status: '',
    expectedCalving: null, dryOff: null, checkDue: null, dried: false, nextHeat: null, calvings: calvings.length };
  const lastHeat = since.filter(e => e.type === 'ruja').pop();
  if (lastInsem) {
    const after = since.filter(e => e.date >= lastInsem.date && e !== lastInsem);
    const test = after.filter(e => e.type === 'badanie').pop();
    const abort = after.some(e => e.type === 'poronienie');
    const heatAfter = after.some(e => e.type === 'ruja' && e.date > lastInsem.date);
    info.dried = after.some(e => e.type === 'zasuszenie');
    if (abort || heatAfter || (test && test.result === 'niecielna')) info.pregnant = false;
    else if (test && test.result === 'cielna') info.pregnant = true;
    if (info.pregnant !== false) {
      info.expectedCalving = calvingDate(lastInsem.date);
      info.dryOff = dryOffDate(lastInsem.date);
      if (!test) info.checkDue = addDays(lastInsem.date, PREG_CHECK_AFTER);
      info.status = info.dried ? 'zasuszona' : (info.pregnant ? 'cielna' : 'po inseminacji');
    } else {
      info.status = 'niecielna';
    }
  }
  if (info.pregnant !== true && !info.expectedCalving && lastHeat) {
    let nh = addDays(lastHeat.date, HEAT_CYCLE);
    while (nh < today) nh = addDays(nh, HEAT_CYCLE);
    info.nextHeat = nh;
  }
  return info;
}

/** Okresy międzywycieleniowe (dni) jednej krowy. */
export function calvingIntervals(events) {
  const c = events.filter(e => e.type === 'wycielenie').map(e => e.date).sort();
  const out = [];
  for (let i = 1; i < c.length; i++) out.push(daysBetween(c[i - 1], c[i]));
  return out;
}

/* ---------------- RODOWÓD ---------------- */

/** Klucz identyfikujący przodka: krowa ze stada -> 'id:..', wpis ręczny -> 'txt:..'. */
function refKey(id, text, cowsById, cowsByTag) {
  if (id && cowsById.has(id)) return 'id:' + id;
  const t = normalizeTag(text);
  if (!t) return null;
  if (cowsByTag.has(t)) return 'id:' + cowsByTag.get(t).id;
  return 'txt:' + t;
}

/** Rodzic jako obiekt {key, cow?, text}. */
export function parentOf(cow, which, cowsById, cowsByTag) {
  if (!cow) return null;
  const id = cow[which + 'Id'], text = cow[which + 'Text'];
  const key = refKey(id, text, cowsById, cowsByTag);
  if (!key) return null;
  const herd = key.startsWith('id:') ? cowsById.get(key.slice(3)) : null;
  return { key, cow: herd, text: herd ? null : text };
}

/** Drzewo rodowodu do 3 pokoleń: {mother:{node, mother, father}, father:{...}}. */
export function pedigree(cow, cowsById, cowsByTag, depth = 3) {
  if (!cow || depth === 0) return null;
  const m = parentOf(cow, 'mother', cowsById, cowsByTag);
  const f = parentOf(cow, 'father', cowsById, cowsByTag);
  return {
    mother: m ? { ...m, tree: m.cow ? pedigree(m.cow, cowsById, cowsByTag, depth - 1) : null } : null,
    father: f ? { ...f, tree: f.cow ? pedigree(f.cow, cowsById, cowsByTag, depth - 1) : null } : null,
  };
}

/** Zbiór przodków (klucz -> opis pokrewieństwa) do `depth` pokoleń. */
export function ancestors(cow, cowsById, cowsByTag, depth = 3) {
  const out = new Map();
  const names = [['matka', 'ojciec'], ['babka', 'dziadek'], ['prababka', 'pradziadek']];
  const walk = (c, level) => {
    if (!c || level >= depth) return;
    for (const [i, which] of [['0', 'mother'], ['1', 'father']]) {
      const p = parentOf(c, which, cowsById, cowsByTag);
      if (!p) continue;
      if (!out.has(p.key)) out.set(p.key, { rel: names[level][+i], label: p.cow ? cowLabel(p.cow) : p.text });
      if (p.cow) walk(p.cow, level + 1);
    }
  };
  walk(cow, 0);
  return out;
}

/**
 * Ostrzeżenie przed kryciem spokrewnionych zwierząt.
 * female — samica, bull — {id?, text?} (buhaj ze stada albo numer wpisany ręcznie).
 * Zwraca tekst ostrzeżenia lub null.
 */
export function kinshipWarning(female, bull, cowsById, cowsByTag) {
  const bullKey = refKey(bull.id, bull.text, cowsById, cowsByTag);
  if (!female || !bullKey) return null;
  const fa = ancestors(female, cowsById, cowsByTag, 3);
  if (fa.has(bullKey)) return `Buhaj to ${fa.get(bullKey).rel} tej samicy — krycie spokrewnione!`;
  const bullCow = bullKey.startsWith('id:') ? cowsById.get(bullKey.slice(3)) : null;
  if (bullCow) {
    const ba = ancestors(bullCow, cowsById, cowsByTag, 3);
    if (ba.has('id:' + female.id)) return 'Samica jest przodkiem tego buhaja — krycie spokrewnione!';
    for (const [k, v] of fa) {
      if (ba.has(k)) return `Wspólny przodek: ${v.label} (${v.rel} samicy, ${ba.get(k).rel} buhaja) — ryzyko chowu wsobnego.`;
    }
  }
  return null;
}

/* ---------------- PASZA ---------------- */

/** Dawka dla zwierzęcia: indywidualna (jeśli ustawiona), w przeciwnym razie grupowa. */
export function rationForCow(cow, rations) {
  const own = rations.filter(r => r.target === 'cow:' + cow.id);
  if (own.length) return own;
  return rations.filter(r => r.target === 'group:' + cow.group);
}

/**
 * Dzienne zużycie paszy w stadzie.
 * Zwraca {perFeed: Map(feedId -> kg/dzień), costPerDay, perCow: Map(cowId -> zł/dzień)}.
 */
export function feedUsage(cows, rations, feeds) {
  const price = new Map(feeds.map(f => [f.id, parseNum(f.pricePerKg) || 0]));
  const perFeed = new Map(), perCow = new Map();
  let costPerDay = 0;
  for (const c of cows.filter(isActive)) {
    let cost = 0;
    for (const r of rationForCow(c, rations)) {
      const kg = parseNum(r.kgPerDay) || 0;
      perFeed.set(r.feedId, (perFeed.get(r.feedId) || 0) + kg);
      cost += kg * (price.get(r.feedId) || 0);
    }
    perCow.set(c.id, cost);
    costPerDay += cost;
  }
  return { perFeed, costPerDay, perCow };
}

/**
 * Stan magazynu paszy (szacunkowy): ostatnia inwentaryzacja + przyjęcia po niej
 * − dzienne zużycie × liczba dni od inwentaryzacji.
 */
export function feedStock(entries, dailyKg, today = todayISO()) {
  const e = entries.slice().sort(byDate);
  if (!e.length) return { stock: null, daysLeft: null };
  const inv = e.filter(x => x.type === 'inwentaryzacja').pop();
  const start = inv ? inv.date : e[0].date;
  let stock = inv ? parseNum(inv.kg) || 0 : 0;
  stock += sum(e.filter(x => x.type === 'przyjęcie' && (inv ? x.date > inv.date || (x.date === inv.date && x.createdAt > inv.createdAt) : true)), x => x.kg);
  const days = Math.max(0, daysBetween(start, today));
  stock = Math.max(0, stock - dailyKg * days);
  return { stock, daysLeft: dailyKg > 0 ? stock / dailyKg : null, since: start };
}

/* ---------------- ARiMR ---------------- */

export const ARIMR_KINDS = ['urodzenie', 'zakup', 'sprzedaż', 'padnięcie', 'ubój'];

/**
 * Zdarzenia do zgłoszenia w IRZplus, wyliczane z kart zwierząt.
 * Status „zgłoszone” trzymamy w magazynie `arimr` pod id `<cowId>_<rodzaj>`.
 */
export function arimrEvents(cows, arimrRecs, today = todayISO()) {
  const status = new Map(arimrRecs.map(r => [r.id, r]));
  const out = [];
  for (const c of cows) {
    const list = [];
    if (c.origin === 'zakup' && c.purchaseDate) list.push(['zakup', c.purchaseDate]);
    else if (c.birthDate) list.push(['urodzenie', c.birthDate]);
    if (c.status === 'sprzedana' && c.exitDate) list.push(['sprzedaż', c.exitDate]);
    if (c.status === 'padła' && c.exitDate) list.push(['padnięcie', c.exitDate]);
    if (c.status === 'ubój' && c.exitDate) list.push(['ubój', c.exitDate]);
    for (const [kind, date] of list) {
      const id = `${c.id}_${kind}`;
      const s = status.get(id);
      const deadline = addDays(date, ARIMR_DAYS);
      out.push({ id, cowId: c.id, cow: c, kind, date, deadline,
        reported: !!(s && s.reported && !s.deletedAt), reportedDate: s?.reportedDate || null,
        daysLeft: daysBetween(today, deadline), demo: c.demo });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
