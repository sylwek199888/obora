/**
 * views/repro.js — ROZRÓD
 * Ruje, inseminacje (z ostrzeżeniem o pokrewieństwie), badania cielności,
 * automatyczne terminy wycielenia (283 dni) i zasuszenia (60 dni przed),
 * wycielenia z tworzeniem karty cielęcia, wydajność mleka.
 */
import * as db from '../db.js';
import { esc, fmtDate, fmtNum, fmtMoney, todayISO, daysBetween, normalizeTag, parseNum, sum } from '../utils.js';
import {
  REPRO_TYPES, PREG_RESULTS, CALVING_COURSES, reproInfo, calvingIntervals, validateEntryDate, cowLabel, isFemale, isActive,
  kinshipWarning, calvingDate, dryOffDate, validateCow, GESTATION_DAYS, DRY_OFF_BEFORE,
} from '../model.js';
import { formDialog, toast, confirmDlg, emptyState, badge } from '../ui.js';
import { registerCowTab, registerQuickAction } from './cow.js';
import { registerTaskProvider, dueText } from '../tasks.js';
import { registerCSV } from '../backup.js';
import { lineChart } from '../charts.js';
import { auditLine } from './common.js';

const ICON = { ruja: '🔥', inseminacja: '🧪', badanie: '🔍', wycielenie: '🐮', zasuszenie: '🥛', poronienie: '⚠️' };

/** Pola formularza zależne od rodzaju zdarzenia. */
function fieldsFor(type, d) {
  const date = { name: 'date', label: 'Data', type: 'date', required: true };
  const note = { name: 'note', label: 'Uwagi', type: 'text' };
  const bulls = [...new Set([...d.repro.filter(r => r.bull).map(r => r.bull), ...d.cows.filter(c => c.sex === 'byk').map(c => c.earTag)])];
  switch (type) {
    case 'inseminacja': return [date,
      { name: 'bull', label: 'Buhaj (numer / nazwa)', type: 'text', required: true, list: bulls },
      { name: 'inseminator', label: 'Inseminator', type: 'text', list: [...new Set(d.repro.map(r => r.inseminator).filter(Boolean))] },
      { name: 'cost', label: 'Koszt', type: 'number', unit: 'zł' }, note];
    case 'badanie': return [date, { name: 'result', label: 'Wynik badania cielności', type: 'select', options: PREG_RESULTS, required: true },
      { name: 'method', label: 'Metoda', type: 'select', options: ['USG', 'badanie rektalne', 'test z mleka', 'inne'] }, note];
    case 'wycielenie': return [date,
      { name: 'course', label: 'Przebieg', type: 'select', options: CALVING_COURSES, required: true },
      { name: 'calfSex', label: 'Płeć cielęcia', type: 'select', options: ['jałówka', 'byczek'], required: true },
      { name: 'calfAlive', label: 'Cielę', type: 'select', options: ['żywe', 'martwe'], required: true },
      { name: 'createCalf', label: 'Utwórz od razu kartę cielęcia (powiązaną z matką)', type: 'checkbox', showIf: v => v.calfAlive === 'żywe' },
      { name: 'calfTag', label: 'Numer kolczyka cielęcia', type: 'text', upper: true, placeholder: 'PL…', showIf: v => v.createCalf && v.calfAlive === 'żywe' },
      { name: 'calfName', label: 'Imię cielęcia', type: 'text', showIf: v => v.createCalf && v.calfAlive === 'żywe' },
      { name: 'calfWeight', label: 'Waga cielęcia', type: 'number', unit: 'kg', showIf: v => v.createCalf && v.calfAlive === 'żywe' },
      note];
    default: return [date, note];
  }
}

/** Okno dodania zdarzenia rozrodu danego rodzaju. */
export async function reproDialog(cow, type, rec = null) {
  const d = await db.loadAll();
  const fields = fieldsFor(type, d);
  const ri = reproInfo(d.of('repro', cow.id));
  const values = rec ? { ...rec } : { date: todayISO(), calfAlive: 'żywe', createCalf: true, course: 'łatwy' };
  let intro = '';
  if (type === 'inseminacja' && !rec) intro = `<p class="muted">Po zapisie aplikacja wyliczy termin wycielenia (+${GESTATION_DAYS} dni) i zasuszenia (${DRY_OFF_BEFORE} dni przed).</p>`;
  if (type === 'wycielenie' && ri.expectedCalving && !rec) intro = `<p class="muted">Spodziewany termin: ${fmtDate(ri.expectedCalving)}. Ojciec cielęcia: ${esc(ri.lastInsem?.bull || 'nieznany')}.</p>`;
  let calf = null;
  const res = await formDialog({
    title: `${ICON[type]} ${type[0].toUpperCase() + type.slice(1)} — ${cow.name || cow.earTag}`,
    fields, values, intro,
    validate: v => {
      const e = {};
      const de = validateEntryDate(v.date, cow); if (de) e.date = de;
      if (type === 'wycielenie' && v.createCalf && v.calfAlive === 'żywe') {
        const ce = validateCow({ earTag: v.calfTag, sex: 'cielę', birthDate: v.date }, d.cows);
        if (ce.earTag) e.calfTag = ce.earTag;
        if (v.calfWeight !== null && (v.calfWeight <= 0 || v.calfWeight > 120)) e.calfWeight = 'Podaj wagę 1–120 kg.';
      }
      if (v.cost !== undefined && v.cost !== null && v.cost < 0) e.cost = 'Koszt nie może być ujemny.';
      return e;
    },
    onSubmit: async v => {
      if (type === 'inseminacja') {
        const herdBull = d.cowsByTag.get(normalizeTag(v.bull));
        const warn = kinshipWarning(cow, { id: herdBull?.id, text: v.bull }, d.cowsById, d.cowsByTag);
        if (warn && !await confirmDlg(`⚠️ ${warn}\n\nZapisać inseminację mimo to?`, { title: 'Ostrzeżenie: pokrewieństwo', okText: 'Zapisz mimo to', danger: true })) {
          throw new Error('Nie zapisano — wybierz innego buhaja.');
        }
      }
      const { createCalf, calfTag, calfName, calfWeight, ...data } = v;
      const saved = await db.save('repro', { ...(rec || {}), ...data, type, cowId: cow.id });
      if (type === 'wycielenie' && !rec) {
        // po wycieleniu jałówka staje się krową, zasuszona wraca do dojnych
        const upd = {};
        if (cow.sex === 'jałówka') upd.sex = 'krowa';
        if (['Zasuszone', 'Jałówki'].includes(cow.group)) upd.group = 'Dojne';
        if (Object.keys(upd).length) await db.save('cows', { ...cow, ...upd });
        if (createCalf && v.calfAlive === 'żywe') {
          calf = await db.save('cows', {
            earTag: normalizeTag(calfTag), name: calfName || '', sex: 'cielę', gender: v.calfSex === 'jałówka' ? 'samica' : 'samiec',
            breed: cow.breed || '', birthDate: v.date, origin: 'urodzona', motherId: cow.id,
            fatherText: ri.lastInsem?.bull || '', group: 'Cielęta', status: 'aktywna',
          });
          if (calfWeight) await db.save('weights', { cowId: calf.id, date: v.date, kg: calfWeight, method: 'taśma', note: 'przy urodzeniu' });
          await db.save('repro', { ...saved, calfId: calf.id });
        }
      }
      if (type === 'zasuszenie' && !rec && cow.group !== 'Zasuszone') await db.save('cows', { ...cow, group: 'Zasuszone' });
    },
  });
  if (res) {
    if (type === 'inseminacja') toast(`Zapisano. Wycielenie ok. ${fmtDate(calvingDate(res.date))}, zasuszenie ok. ${fmtDate(dryOffDate(res.date))}.`, 'ok', 6000);
    else if (calf) toast(`Zapisano wycielenie i utworzono kartę cielęcia ${calf.earTag}. Pamiętaj o zgłoszeniu do ARiMR w ciągu 7 dni!`, 'warn', 7000);
    else toast('Zapisano.', 'ok');
  }
  return res;
}

/** Okno wyboru rodzaju zdarzenia (szybka akcja z przeglądu). */
async function chooseReproType(cow) {
  let chosen = null;
  await formDialog({
    title: 'Rozród — co wpisać?', submitText: 'Dalej',
    fields: [{ name: 'type', label: 'Zdarzenie', type: 'select', options: REPRO_TYPES, required: true }],
    values: { type: 'inseminacja' },
    onSubmit: v => { chosen = v.type; },
  });
  if (chosen) await reproDialog(cow, chosen);
}

/* ---------------- MLEKO ---------------- */

async function milkDialog(cow, rec = null) {
  return formDialog({
    title: `🥛 Wydajność mleka — ${cow.name || cow.earTag}`,
    fields: [
      { name: 'period', label: 'Okres', type: 'select', options: [{ value: 'dzień', label: 'Dzienny wpis' }, { value: 'miesiąc', label: 'Suma za miesiąc' }], required: true },
      { name: 'date', label: 'Data (dla miesiąca — dowolny dzień tego miesiąca)', type: 'date', required: true },
      { name: 'liters', label: 'Ilość', type: 'number', unit: 'l', required: true },
      { name: 'note', label: 'Uwagi', type: 'text' },
    ],
    values: rec || { period: 'dzień', date: todayISO() },
    validate: v => {
      const e = {};
      const de = validateEntryDate(v.date, cow); if (de) e.date = de;
      if (v.liters !== null && (v.liters < 0 || v.liters > (v.period === 'dzień' ? 100 : 3000))) e.liters = 'Nieprawidłowa ilość.';
      return e;
    },
    onSubmit: v => db.save('milk', { ...(rec || {}), ...v, cowId: cow.id }),
  });
}

/* ---------------- ZAKŁADKA „ROZRÓD” ---------------- */

function reproTab(cow, d) {
  if (!isFemale(cow)) return '<p class="muted">Rozród i mleko prowadzone są dla samic.</p>';
  const ev = d.of('repro', cow.id);
  const ri = reproInfo(ev);
  const intervals = calvingIntervals(ev);
  const today = todayISO();
  const milk = d.of('milk', cow.id);
  const daily = milk.filter(m => m.period === 'dzień');
  const monthly = milk.filter(m => m.period === 'miesiąc');
  const stat = (label, val, sub = '') => `<div class="stat"><span>${label}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const statusBadge = { cielna: 'ok', 'po inseminacji': 'warn', niecielna: 'danger', zasuszona: '' }[ri.status];
  return `
    <div class="quick-grid">${['ruja', 'inseminacja', 'badanie', 'wycielenie', 'zasuszenie', 'poronienie'].map((t, i) =>
      `<button class="btn btn-big ${i === 1 ? 'btn-primary' : ''}" data-act="add-repro" data-type="${t}">${ICON[t]} ${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
    <div class="stats-grid">
      ${stat('Stan', ri.status ? badge(ri.status, statusBadge) : '—', ri.lastInsem ? `inseminacja ${fmtDate(ri.lastInsem.date)} (${ri.insemCount}. w cyklu)` : '')}
      ${stat('Przewidywane wycielenie', ri.expectedCalving ? fmtDate(ri.expectedCalving) : '—', ri.expectedCalving ? dueText(ri.expectedCalving, today) : '')}
      ${stat('Zasuszenie', ri.dried ? 'zasuszona' : ri.dryOff ? fmtDate(ri.dryOff) : '—', ri.dryOff && !ri.dried ? dueText(ri.dryOff, today) : '')}
      ${stat('Badanie cielności', ri.checkDue ? fmtDate(ri.checkDue) : '—', ri.checkDue ? 'zalecane ok. 35 dni po inseminacji' : '')}
      ${stat('Ostatnie wycielenie', ri.lastCalving ? fmtDate(ri.lastCalving.date) : '—', ri.lastCalving ? `${daysBetween(ri.lastCalving.date, today)} dni temu` : '')}
      ${stat('Liczba wycieleń', ri.calvings)}
      ${stat('Okres międzywycieleniowy', intervals.length ? `${Math.round(sum(intervals) / intervals.length)} dni` : '—', intervals.length ? 'średnio' : '')}
      ${stat('Spodziewana ruja', ri.nextHeat ? fmtDate(ri.nextHeat) : '—', ri.nextHeat ? 'co 21 dni od ostatniej' : '')}
    </div>
    <section class="card"><h3>Historia rozrodu</h3>
    ${ev.length ? `<ul class="timeline">${ev.slice().reverse().map(e => {
      const calf = e.calfId && d.cowsById.get(e.calfId);
      const details = {
        inseminacja: `buhaj: <b>${esc(e.bull || '?')}</b>${e.inseminator ? `, inseminator: ${esc(e.inseminator)}` : ''}${e.cost ? `, ${fmtMoney(e.cost)}` : ''}
          <br>→ wycielenie ok. ${fmtDate(calvingDate(e.date))}, zasuszenie ok. ${fmtDate(dryOffDate(e.date))}`,
        badanie: `wynik: <b>${esc(e.result || '')}</b>${e.method ? ` (${esc(e.method)})` : ''}`,
        wycielenie: `przebieg: ${esc(e.course || '')}, ${esc(e.calfSex || '')}, ${esc(e.calfAlive || 'żywe')}${calf ? ` — <a href="#/krowa/${esc(calf.id)}">${esc(cowLabel(calf))}</a>` : ''}`,
      }[e.type] || '';
      return `<li class="card"><div class="timeline-head"><b>${ICON[e.type]} ${fmtDate(e.date)} · ${esc(e.type)}</b>
        <span class="row-actions"><button class="btn-icon" data-act="edit-repro" data-id="${e.id}" aria-label="Edytuj">✎</button>
        <button class="btn-icon" data-act="del-repro" data-id="${e.id}" aria-label="Usuń">🗑</button></span></div>
        ${details ? `<div>${details}</div>` : ''}${e.note ? `<div>${esc(e.note)}</div>` : ''}${auditLine(e)}</li>`;
    }).join('')}</ul>` : '<p class="muted">Brak zdarzeń.</p>'}</section>
    <section class="card"><h3>🥛 Wydajność mleka (opcjonalnie)</h3>
      <div class="actions-row"><button class="btn" data-act="add-milk">＋ Dodaj wpis</button></div>
      ${daily.length > 1 ? lineChart([{ label: 'l/dzień', points: daily.map(m => ({ x: m.date, y: parseNum(m.liters) })) }], { unit: 'l', decimals: 1, height: 200 }) : ''}
      ${monthly.length > 1 ? lineChart([{ label: 'l/miesiąc', points: monthly.map(m => ({ x: m.date, y: parseNum(m.liters) })) }], { unit: 'l', height: 200 }) : ''}
      ${milk.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Data</th><th>Okres</th><th class="num">Litry</th><th></th></tr></thead><tbody>
        ${milk.slice().reverse().slice(0, 30).map(m => `<tr><td>${m.period === 'miesiąc' ? esc(m.date.slice(0, 7)) : fmtDate(m.date)}</td><td>${esc(m.period)}</td>
          <td class="num"><b>${fmtNum(m.liters, 1)}</b></td><td class="row-actions"><button class="btn-icon" data-act="del-milk" data-id="${m.id}" aria-label="Usuń">🗑</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Brak wpisów mleka.</p>'}
    </section>`;
}

async function handleRepro(act, id, cow, d, el, btn) {
  if (act === 'add-repro') { await reproDialog(cow, btn.dataset.type); return true; }
  if (act === 'edit-repro') { const r = d.repro.find(x => x.id === id); await reproDialog(cow, r.type, r); return true; }
  if (act === 'add-milk') { if (await milkDialog(cow)) toast('Zapisano.', 'ok'); return true; }
  if (act === 'del-repro' || act === 'del-milk') {
    if (await confirmDlg('Usunąć ten wpis? Trafi do kosza na 30 dni.', { danger: true, okText: 'Usuń' })) {
      await db.softDelete(act === 'del-repro' ? 'repro' : 'milk', id); toast('Przeniesiono do kosza.');
    }
    return true;
  }
  return false;
}

registerCowTab({ id: 'rozrod', label: 'Rozród', order: 30, render: reproTab, handle: handleRepro });
registerQuickAction({ act: 'repro', label: '🧪 Rozród', order: 20, show: isFemale, run: chooseReproType });

/* ---------------- ZADANIA ---------------- */

registerTaskProvider((d, from, to, today) => {
  const out = [];
  for (const c of d.cows.filter(c => isActive(c) && isFemale(c))) {
    const ri = reproInfo(d.of('repro', c.id), today);
    const href = `#/krowa/${c.id}?tab=rozrod`;
    if (ri.expectedCalving && daysBetween(ri.expectedCalving, today) <= 30) {
      const n = daysBetween(today, ri.expectedCalving);
      out.push({ date: ri.expectedCalving, type: 'wycielenie', icon: '🐮', kind: n <= 14 ? 'warn' : 'info', overdue: n < 0, cowId: c.id, href,
        title: `Wycielenie: ${cowLabel(c)}${ri.lastInsem?.bull ? ` (buhaj ${ri.lastInsem.bull})` : ''}${n < 0 ? ' — termin minął, wpisz wycielenie' : ''}` });
    }
    if (ri.dryOff && !ri.dried && daysBetween(ri.dryOff, today) <= 30) {
      out.push({ date: ri.dryOff, type: 'zasuszenie', icon: '🥛', kind: 'info', overdue: ri.dryOff < today, cowId: c.id, href, title: `Zasuszenie: ${cowLabel(c)}` });
    }
    if (ri.checkDue && daysBetween(ri.checkDue, today) <= 30) {
      out.push({ date: ri.checkDue, type: 'badanie', icon: '🔍', kind: 'info', overdue: ri.checkDue < today, cowId: c.id, href, title: `Badanie cielności: ${cowLabel(c)}` });
    }
  }
  return out;
});

registerCSV({ id: 'rozrod', label: 'Rozród', build: d => ({
  rows: d.repro.filter(r => d.cowsById.has(r.cowId)).sort((a, b) => a.date.localeCompare(b.date)),
  columns: [
    { label: 'Data', get: r => fmtDate(r.date) }, { label: 'Nr kolczyka', get: r => d.cowsById.get(r.cowId).earTag },
    { label: 'Zwierzę', get: r => cowLabel(d.cowsById.get(r.cowId)) }, { label: 'Zdarzenie', get: r => r.type },
    { label: 'Buhaj', get: r => r.bull }, { label: 'Inseminator', get: r => r.inseminator }, { label: 'Wynik', get: r => r.result },
    { label: 'Przebieg', get: r => r.course }, { label: 'Płeć cielęcia', get: r => r.calfSex },
    { label: 'Przew. wycielenie', get: r => r.type === 'inseminacja' ? fmtDate(calvingDate(r.date)) : '' },
    { label: 'Koszt (zł)', get: r => r.cost }, { label: 'Uwagi', get: r => r.note }, { label: 'Wpisał(a)', get: r => r.createdBy },
  ],
}) });

registerCSV({ id: 'mleko', label: 'Mleko', build: d => ({
  rows: d.milk.filter(r => d.cowsById.has(r.cowId)).sort((a, b) => a.date.localeCompare(b.date)),
  columns: [{ label: 'Data', get: r => fmtDate(r.date) }, { label: 'Nr kolczyka', get: r => d.cowsById.get(r.cowId).earTag },
    { label: 'Zwierzę', get: r => cowLabel(d.cowsById.get(r.cowId)) }, { label: 'Okres', get: r => r.period }, { label: 'Litry', get: r => r.liters }],
}) });
