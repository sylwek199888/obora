/**
 * backup.js — KOPIA ZAPASOWA (JSON) i EKSPORT CSV (do Excela).
 * CSV zapisujemy w formacie, który polski Excel otwiera poprawnie:
 * separator „;”, przecinek dziesiętny, kodowanie UTF-8 z BOM.
 */
import * as db from './db.js';
import { download, todayISO, fmtDate, daysBetween, fmtNum } from './utils.js';
import { COW_FIELDS, cowLabel } from './model.js';
import { registerTaskProvider } from './tasks.js';

export const BACKUP_REMIND_DAYS = 7;

/** Pobiera plik kopii zapasowej i zapamiętuje datę. */
export async function exportBackup() {
  const data = await db.exportAll();
  download(`obora-kopia-${todayISO()}.json`, JSON.stringify(data), 'application/json');
  await db.setMeta('lastBackup', todayISO());
}

/** Wczytuje plik kopii. mode: 'merge' | 'replace'. Zwraca liczbę wczytanych rekordów. */
export async function importBackup(file, mode) {
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Plik nie jest poprawnym plikiem JSON.'); }
  return db.importAll(data, mode);
}

/** Ile dni minęło od ostatniej kopii (null = nigdy). */
export async function daysSinceBackup() {
  const last = await db.getMeta('lastBackup');
  return last ? daysBetween(last, todayISO()) : null;
}

/* ---------------- CSV ---------------- */

const cell = v => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return fmtNum(v, Number.isInteger(v) ? 0 : 2).replace(/\s/g, '');
  const s = String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** columns: [{label, get(row)}] -> tekst CSV. */
export function toCSV(columns, rows) {
  const lines = [columns.map(c => cell(c.label)).join(';')];
  for (const r of rows) lines.push(columns.map(c => cell(c.get(r))).join(';'));
  return '﻿' + lines.join('\r\n');
}

export function downloadCSV(name, columns, rows) {
  download(`${name}-${todayISO()}.csv`, toCSV(columns, rows), 'text/csv;charset=utf-8');
}

/** Rejestr tabel do eksportu: {id, label, build(d) -> {columns, rows}}. */
export const CSV_EXPORTS = [];
export function registerCSV(e) { CSV_EXPORTS.push(e); }

const cowCol = d => ({ label: 'Zwierzę', get: r => cowLabel(d.cowsById.get(r.cowId)) });
const tagCol = d => ({ label: 'Nr kolczyka', get: r => d.cowsById.get(r.cowId)?.earTag || '' });
const audit = [{ label: 'Dodał(a)', get: r => r.createdBy }, { label: 'Dodano', get: r => fmtDate(r.createdAt?.slice(0, 10)) }];

registerCSV({ id: 'stado', label: 'Stado (karty zwierząt)', build: d => ({
  rows: d.cows,
  columns: COW_FIELDS.filter(f => f.type !== 'photo').map(f => ({
    label: f.label,
    get: c => {
      if (f.type === 'cowref') { const r = d.cowsById.get(c[f.name + 'Id']); return r ? r.earTag : c[f.name + 'Text']; }
      if (f.type === 'date') return c[f.name] ? fmtDate(c[f.name]) : '';
      if (f.type === 'select') {
        const o = (f.options || []).find(o => typeof o === 'object' && o.value === c[f.name]);
        return o ? o.label : c[f.name];
      }
      return c[f.name];
    },
  })).concat(audit),
}) });

registerCSV({ id: 'wazenia', label: 'Ważenia', build: d => ({
  rows: d.weights.filter(w => d.cowsById.has(w.cowId)).sort((a, b) => a.date.localeCompare(b.date)),
  columns: [{ label: 'Data', get: r => fmtDate(r.date) }, tagCol(d), cowCol(d), { label: 'Waga (kg)', get: r => r.kg },
    { label: 'Sposób', get: r => r.method }, { label: 'Uwagi', get: r => r.note }, ...audit],
}) });

registerCSV({ id: 'dziennik', label: 'Dziennik i kondycja', build: d => ({
  rows: [...d.notes.map(n => ({ ...n, kind: 'notatka' })), ...d.conditions.map(n => ({ ...n, kind: 'kondycja', text: `BCS ${n.bcs || '-'}, racice: ${n.hooves || '-'} ${n.note || ''}` }))]
    .filter(r => d.cowsById.has(r.cowId)).sort((a, b) => a.date.localeCompare(b.date)),
  columns: [{ label: 'Data', get: r => fmtDate(r.date) }, tagCol(d), cowCol(d), { label: 'Rodzaj', get: r => r.kind }, { label: 'Treść', get: r => r.text }, ...audit],
}) });

/* Przypomnienie o kopii zapasowej jako zadanie na pulpicie. */
let backupDays = null;
export async function refreshBackupState() { backupDays = await daysSinceBackup(); }
registerTaskProvider((d, from, to, today) => {
  if (!d.cows.length) return [];
  if (backupDays !== null && backupDays < BACKUP_REMIND_DAYS) return [];
  return [{ date: today, type: 'kopia', icon: '💾', overdue: true, kind: 'warn', href: '#/ustawienia',
    title: backupDays === null ? 'Zrób kopię zapasową danych (jeszcze nie była robiona)' : `Zrób kopię zapasową (ostatnia ${backupDays} dni temu)` }];
});
