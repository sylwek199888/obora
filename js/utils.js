/**
 * utils.js — drobne funkcje pomocnicze: daty (DD.MM.RRRR), liczby, kg, zł,
 * wiek zwierzęcia, odmiana polska, pobieranie plików, kompresja zdjęć.
 * Moduł nie zależy od żadnego innego modułu aplikacji.
 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Zabezpiecza tekst przed wstrzyknięciem HTML. Zawsze używaj przy danych użytkownika. */
export function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Unikalny identyfikator rekordu (UUID v4). */
export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* ---------------------------------------------------------------
 * DATY
 * W bazie daty trzymamy jako tekst ISO „RRRR-MM-DD” (bez strefy czasowej),
 * a użytkownikowi pokazujemy „DD.MM.RRRR”.
 * ------------------------------------------------------------- */

const pad = n => String(n).padStart(2, '0');

/** Date -> 'RRRR-MM-DD' (czas lokalny). */
export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO() { return toISO(new Date()); }

/** 'RRRR-MM-DD' -> Date (południe, by uniknąć problemów ze zmianą czasu). */
export function parseISO(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0);
}

/** 'RRRR-MM-DD' -> 'DD.MM.RRRR'. */
export function fmtDate(iso) {
  const d = parseISO(iso);
  if (!d) return '—';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Znacznik czasu ISO (z godziną) -> 'DD.MM.RRRR GG:MM'. */
export function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d)) return '—';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  if (!d) return null;
  d.setDate(d.getDate() + Math.round(n));
  return toISO(d);
}

/** Liczba dni od a do b (b - a). */
export function daysBetween(a, b) {
  const da = parseISO(a), db = parseISO(b);
  if (!da || !db) return null;
  return Math.round((db - da) / 86400000);
}

export function isFuture(iso) { return iso && iso > todayISO(); }

/** 'RRRR-MM' z daty ISO. */
export const monthKey = iso => String(iso).slice(0, 7);

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec',
  'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
export const WEEKDAYS_SHORT = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];

export function monthName(key, short = false) {
  const [y, m] = key.split('-').map(Number);
  return `${(short ? MONTHS_SHORT : MONTHS)[m - 1]} ${y}`;
}

/** Lista kluczy 'RRRR-MM' z ostatnich n miesięcy (od najstarszego). */
export function lastMonths(n, refIso = todayISO()) {
  const d = parseISO(refIso);
  d.setDate(1);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1, 12);
    out.push(toISO(x).slice(0, 7));
  }
  return out;
}

/** Polska odmiana: plural(2,'rok','lata','lat') -> 'lata'. */
export function plural(n, one, few, many) {
  n = Math.abs(n);
  if (n === 1) return one;
  const l10 = n % 10, l100 = n % 100;
  if (l10 >= 2 && l10 <= 4 && (l100 < 12 || l100 > 14)) return few;
  return many;
}

/** Wiek w pełnych miesiącach. */
export function ageInMonths(birthIso, refIso = todayISO()) {
  const b = parseISO(birthIso), r = parseISO(refIso);
  if (!b || !r) return null;
  let m = (r.getFullYear() - b.getFullYear()) * 12 + (r.getMonth() - b.getMonth());
  if (r.getDate() < b.getDate()) m--;
  return Math.max(0, m);
}

/** Wiek jako tekst: „3 lata 2 mies.”, „5 mies.”, „12 dni”. */
export function ageText(birthIso, refIso = todayISO()) {
  const m = ageInMonths(birthIso, refIso);
  if (m === null) return '—';
  if (m === 0) {
    const d = daysBetween(birthIso, refIso);
    return `${d} ${plural(d, 'dzień', 'dni', 'dni')}`;
  }
  const y = Math.floor(m / 12), mm = m % 12;
  const parts = [];
  if (y) parts.push(`${y} ${plural(y, 'rok', 'lata', 'lat')}`);
  if (mm || !y) parts.push(`${mm} mies.`);
  return parts.join(' ');
}

/* ---------------------------------------------------------------
 * LICZBY
 * ------------------------------------------------------------- */

/** Zamienia tekst z przecinkiem („512,5”) na liczbę; pusty -> null. */
export function parseNum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return isFinite(n) ? n : null;
}

export function fmtNum(n, dec = 0) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return Number(n).toLocaleString('pl-PL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export const fmtKg = (n, dec = 0) => (n === null || n === undefined || !isFinite(n)) ? '—' : `${fmtNum(n, dec)} kg`;
export const fmtMoney = n => (n === null || n === undefined || !isFinite(n)) ? '—' : `${fmtNum(n, 2)} zł`;

/** Numer kolczyka w postaci ujednoliconej: wielkie litery, bez spacji i myślników. */
export const normalizeTag = s => String(s || '').toUpperCase().replace(/[\s\-.]/g, '');

/** Sortowanie tekstów po polsku (ą, ć, ł...). */
export const plCompare = (a, b) => String(a || '').localeCompare(String(b || ''), 'pl', { numeric: true });

/* ---------------------------------------------------------------
 * RÓŻNE
 * ------------------------------------------------------------- */

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Zapisuje tekst/Blob jako plik do pobrania. */
export function download(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Kompresuje zdjęcie z aparatu: zmniejsza do maxSize px (dłuższy bok)
 * i zapisuje jako JPEG. Zwraca data URL (~30–80 kB zamiast kilku MB).
 */
export function compressImage(file, maxSize = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** Grupuje tablicę po kluczu -> Map. */
export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export const sum = (arr, fn = x => x) => arr.reduce((s, x) => s + (Number(fn(x)) || 0), 0);
export const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || '');
