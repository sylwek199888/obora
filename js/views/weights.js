/**
 * views/weights.js — WAGA: dodawanie ważeń (pojedynczo i grupowo),
 * zakładka „Waga” na karcie krowy z wykresem, przyrostami i prognozą.
 */
import * as db from '../db.js';
import { esc, fmtDate, fmtKg, fmtNum, todayISO, parseNum, daysBetween, plural } from '../utils.js';
import { WEIGH_METHODS, weightStats, validateEntryDate, cowLabel } from '../model.js';
import { formDialog, toast, confirmDlg, emptyState } from '../ui.js';
import { lineChart } from '../charts.js';
import { auditLine } from './common.js';

const weightFields = [
  { name: 'date', label: 'Data ważenia', type: 'date', required: true },
  { name: 'kg', label: 'Waga', type: 'number', unit: 'kg', required: true, placeholder: 'np. 512' },
  { name: 'method', label: 'Sposób', type: 'select', options: WEIGH_METHODS, required: true },
  { name: 'note', label: 'Uwagi', type: 'text' },
];

const validKg = kg => (kg === null ? 'Podaj wagę.' : (kg <= 0 || kg > 2000) ? 'Waga musi być w zakresie 1–2000 kg.' : null);

/** Ostrzega, jeśli nowe ważenie jest niższe od poprzedniego. */
async function warnIfDropped(cow) {
  const d = await db.loadAll();
  const st = weightStats(d.of('weights', cow.id));
  if (st.dropped) toast(`Uwaga: ${cow.name || cow.earTag} — waga spadła o ${fmtKg(st.dropKg, 1)} względem poprzedniego ważenia!`, 'warn', 6000);
}

/** Okno dodania / edycji ważenia. */
export async function weightDialog(cow, rec = null) {
  const last = (await db.loadAll()).of('weights', cow.id).slice(-1)[0];
  const values = rec || { date: todayISO(), method: last?.method || 'waga' };
  const res = await formDialog({
    title: `${rec ? 'Edytuj' : 'Dodaj'} ważenie — ${cow.name || cow.earTag}`,
    fields: weightFields, values,
    intro: last && !rec ? `<p class="muted">Ostatnie ważenie: ${fmtKg(last.kg)} (${fmtDate(last.date)})</p>` : '',
    validate: v => {
      const e = {};
      const de = validateEntryDate(v.date, cow); if (de) e.date = de;
      const ke = validKg(v.kg); if (ke) e.kg = ke;
      return e;
    },
    onSubmit: v => db.save('weights', { ...(rec || {}), ...v, cowId: cow.id }),
  });
  if (res) { toast('Zapisano ważenie.', 'ok'); await warnIfDropped(cow); }
  return res;
}

/** Ważenie wielu zwierząt naraz: wspólna data i sposób, osobna waga dla każdego. */
export async function bulkWeightDialog(cows) {
  const fields = [
    { name: 'date', label: 'Data ważenia', type: 'date', required: true },
    { name: 'method', label: 'Sposób', type: 'select', options: WEIGH_METHODS, required: true },
    { name: 'h', label: 'Waga poszczególnych zwierząt (puste = pomiń)', type: 'heading' },
    ...cows.map(c => ({ name: 'kg_' + c.id, label: cowLabel(c), type: 'number', unit: 'kg' })),
  ];
  const res = await formDialog({
    title: `Ważenie grupowe (${cows.length})`, fields, values: { date: todayISO(), method: 'waga' },
    validate: v => {
      const e = {};
      if (validateEntryDate(v.date)) e.date = validateEntryDate(v.date);
      for (const c of cows) {
        const kg = v['kg_' + c.id];
        if (kg !== null && validKg(kg)) e['kg_' + c.id] = validKg(kg);
        if (kg !== null && c.birthDate > v.date) e['kg_' + c.id] = 'Data przed urodzeniem zwierzęcia.';
      }
      if (cows.every(c => v['kg_' + c.id] === null)) e.date = 'Wpisz wagę przynajmniej jednego zwierzęcia.';
      return e;
    },
    onSubmit: async v => {
      const recs = cows.filter(c => v['kg_' + c.id] !== null)
        .map(c => ({ cowId: c.id, date: v.date, kg: v['kg_' + c.id], method: v.method, note: 'ważenie grupowe' }));
      await db.saveMany('weights', recs);
      toast(`Zapisano ${recs.length} ${plural(recs.length, 'ważenie', 'ważenia', 'ważeń')}.`, 'ok');
    },
  });
  if (res) for (const c of cows) if (res['kg_' + c.id] !== null) await warnIfDropped(c);
  return res;
}

/** Zakładka „Waga” na karcie krowy. */
export function weightsTab(cow, d) {
  const list = d.of('weights', cow.id);
  const st = weightStats(list, cow);
  const target = parseNum(cow.targetWeight);
  const adgCls = v => v === null ? '' : v < 0 ? 'neg' : 'pos';
  let forecast = '<span class="muted">ustaw wagę docelową w karcie</span>';
  if (target && st.forecast) {
    if (st.forecast.reached) forecast = `<b>osiągnięta</b> (${fmtKg(target)})`;
    else if (st.forecast.date) forecast = `<b>${fmtDate(st.forecast.date)}</b> <span class="muted">(za ok. ${Math.max(0, daysBetween(todayISO(), st.forecast.date))} dni, cel ${fmtKg(target)})</span>`;
    else forecast = '<span class="muted">brak dodatniego przyrostu — nie da się prognozować</span>';
  }
  return `
    <div class="actions-row"><button class="btn btn-primary btn-big" data-act="add-weight">⚖️ Dodaj ważenie</button></div>
    ${st.dropped ? `<div class="alert alert-warn">📉 Waga spadła o ${fmtKg(st.dropKg, 1)} względem poprzedniego ważenia (${fmtDate(st.prev.date)}).</div>` : ''}
    <div class="stats-grid">
      <div class="stat"><span>Ostatnia waga</span><b>${st.last ? fmtKg(st.last.kg) : '—'}</b><small>${st.last ? fmtDate(st.last.date) : ''}</small></div>
      <div class="stat"><span>Przyrost od ost. ważenia</span><b class="${adgCls(st.adgLast)}">${st.adgLast === null ? '—' : fmtNum(st.adgLast, 2) + ' kg/dzień'}</b></div>
      <div class="stat"><span>Przyrost od początku</span><b class="${adgCls(st.adgTotal)}">${st.adgTotal === null ? '—' : fmtNum(st.adgTotal, 2) + ' kg/dzień'}</b><small>${st.first ? 'od ' + fmtDate(st.first.date) : ''}</small></div>
      <div class="stat"><span>Prognoza wagi sprzedażnej</span><div>${forecast}</div></div>
    </div>
    <div class="card">
      ${lineChart([{ label: 'Waga', points: list.map(w => ({ x: w.date, y: parseNum(w.kg) })) }],
        { unit: 'kg', target: target ? { y: target, label: `cel ${fmtNum(target)} kg` } : null, title: 'Waga w czasie' })}
    </div>
    ${list.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Data</th><th>Waga</th><th>Zmiana</th><th>Sposób</th><th>Uwagi</th><th></th></tr></thead>
      <tbody>${list.slice().reverse().map((w, i, arr) => {
        const prev = arr[i + 1];
        const diff = prev ? w.kg - prev.kg : null;
        return `<tr>
          <td>${fmtDate(w.date)}</td><td><b>${fmtKg(w.kg, 1)}</b></td>
          <td class="${diff === null ? '' : diff < 0 ? 'neg' : 'pos'}">${diff === null ? '' : (diff > 0 ? '+' : '') + fmtNum(diff, 1)}</td>
          <td>${esc(w.method || '')}</td><td>${esc(w.note || '')}<br>${auditLine(w)}</td>
          <td class="row-actions"><button class="btn-icon" data-act="edit-weight" data-id="${w.id}" aria-label="Edytuj">✎</button>
          <button class="btn-icon" data-act="del-weight" data-id="${w.id}" aria-label="Usuń">🗑</button></td></tr>`;
      }).join('')}</tbody></table></div>` : emptyState('Brak ważeń. Dodaj pierwsze ważenie przyciskiem powyżej.')}`;
}

/** Obsługa przycisków zakładki „Waga”. Zwraca true, jeśli akcja została obsłużona. */
export async function handleWeightAction(act, id, cow, d) {
  if (act === 'add-weight') { await weightDialog(cow); return true; }
  if (act === 'edit-weight') { await weightDialog(cow, d.weights.find(w => w.id === id)); return true; }
  if (act === 'del-weight') {
    if (await confirmDlg('Usunąć to ważenie? Trafi do kosza na 30 dni.', { danger: true, okText: 'Usuń' })) {
      await db.softDelete('weights', id); toast('Przeniesiono do kosza.');
    }
    return true;
  }
  return false;
}
