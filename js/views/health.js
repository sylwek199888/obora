/**
 * views/health.js — LECZENIE I WETERYNARIA
 * Wpisy leczenia, szczepienia i odrobaczania, karencja (mleko/mięso)
 * z czerwonym znacznikiem „KARENCJA”, terminy kolejnych dawek oraz
 * KSIĘGA LECZENIA ZWIERZĄT z wydrukiem do kontroli.
 */
import * as db from '../db.js';
import { esc, fmtDate, fmtMoney, todayISO, addDays, daysBetween, plural } from '../utils.js';
import { TREATMENT_TYPES, ROUTES, withdrawalEnds, activeWithdrawal, validateEntryDate, cowLabel, isActive } from '../model.js';
import { formDialog, toast, confirmDlg, emptyState, badge } from '../ui.js';
import { registerCowTab, registerQuickAction } from './cow.js';
import { registerBulkAction } from './herd.js';
import { registerTaskProvider } from '../tasks.js';
import { registerDashPanel } from './dashboard.js';
import { registerCSV } from '../backup.js';
import { pageHead, auditLine } from './common.js';
import { getFarm } from '../farm.js';

const TYPE_ICON = { leczenie: '💊', szczepienie: '💉', odrobaczanie: '🪱' };

/** Pola formularza leczenia. Dla szczepień/odrobaczania pokazujemy „następna dawka”. */
function treatmentFields(bulk = false) {
  return [
    { name: 'type', label: 'Rodzaj', type: 'select', options: TREATMENT_TYPES, required: true },
    { name: 'date', label: 'Data (pierwszego) podania', type: 'date', required: true },
    { name: 'diagnosis', label: 'Objawy / rozpoznanie', type: 'text', required: true,
      list: ['Zapalenie wymienia (mastitis)', 'Kulawizna', 'Biegunka', 'Zapalenie płuc', 'Gorączka mleczna', 'Zatrzymanie łożyska', 'Ketoza', 'Profilaktyka', 'BVD', 'IBR', 'Choroby układu oddechowego'] },
    { name: 'drug', label: 'Lek / preparat', type: 'text', required: true },
    { name: 'batch', label: 'Numer partii (serii) leku', type: 'text' },
    { name: 'dose', label: 'Dawka', type: 'text', placeholder: 'np. 20 ml' },
    { name: 'route', label: 'Sposób podania', type: 'select', options: ROUTES },
    { name: 'days', label: 'Liczba dni podawania', type: 'number', help: 'Karencja liczy się od ostatniego dnia podania' },
    { name: 'withdrawalMilk', label: 'Karencja — mleko', type: 'number', unit: 'dni' },
    { name: 'withdrawalMeat', label: 'Karencja — mięso', type: 'number', unit: 'dni' },
    { name: 'vet', label: 'Lekarz weterynarii', type: 'text' },
    { name: 'cost', label: bulk ? 'Koszt (na 1 zwierzę)' : 'Koszt', type: 'number', unit: 'zł' },
    { name: 'nextDate', label: 'Data następnej dawki', type: 'date', noFuture: false, showIf: v => v.type !== 'leczenie',
      help: 'Przypomnienie pojawi się na pulpicie i w kalendarzu' },
    { name: 'note', label: 'Uwagi', type: 'textarea', rows: 2 },
  ];
}

function validateTreatment(v, cow) {
  const e = {};
  const de = validateEntryDate(v.date, cow); if (de) e.date = de;
  for (const f of ['withdrawalMilk', 'withdrawalMeat', 'cost']) if (v[f] !== null && v[f] < 0) e[f] = 'Wartość nie może być ujemna.';
  if (v.days !== null && (v.days < 1 || v.days > 60)) e.days = 'Podaj od 1 do 60 dni.';
  if (v.nextDate && v.nextDate <= v.date) e.nextDate = 'Następna dawka musi być po dacie podania.';
  return e;
}

/** Podsumowanie karencji po zapisie. */
function withdrawalToast(v) {
  const { milkEnd, meatEnd } = withdrawalEnds(v);
  const parts = [];
  if (milkEnd) parts.push(`mleko do ${fmtDate(milkEnd)}`);
  if (meatEnd) parts.push(`mięso do ${fmtDate(meatEnd)}`);
  toast(parts.length ? `Zapisano. KARENCJA: ${parts.join(', ')}.` : 'Zapisano.', parts.length ? 'warn' : 'ok', 6000);
}

/** Podpowiedź: ostatnio użyte dane leku o tej samej nazwie (karencja, dawka...). */
async function lastUsed(type) {
  const d = await db.loadAll();
  const t = d.treatments.filter(x => x.type === type).sort((a, b) => b.date.localeCompare(a.date))[0];
  return t ? { vet: t.vet, drug: type === 'leczenie' ? '' : t.drug, dose: type === 'leczenie' ? '' : t.dose, route: t.route,
    withdrawalMilk: type === 'leczenie' ? null : t.withdrawalMilk, withdrawalMeat: type === 'leczenie' ? null : t.withdrawalMeat } : {};
}

export async function treatmentDialog(cow, rec = null, type = 'leczenie') {
  const values = rec || { type, date: todayISO(), days: 1, diagnosis: type === 'leczenie' ? '' : 'Profilaktyka', ...(await lastUsed(type)) };
  const res = await formDialog({
    title: `${rec ? 'Edytuj wpis' : TYPE_ICON[type] + ' ' + type[0].toUpperCase() + type.slice(1)} — ${cow.name || cow.earTag}`,
    fields: treatmentFields(), values,
    validate: v => validateTreatment(v, cow),
    onSubmit: v => db.save('treatments', { ...(rec || {}), ...v, cowId: cow.id }),
  });
  if (res) withdrawalToast(res);
  return res;
}

/** Ten sam zabieg dla wielu zwierząt (np. odrobaczanie całej grupy). */
export async function bulkTreatmentDialog(cows, type) {
  const res = await formDialog({
    title: `${TYPE_ICON[type]} ${type[0].toUpperCase() + type.slice(1)} — ${cows.length} ${plural(cows.length, 'zwierzę', 'zwierzęta', 'zwierząt')}`,
    intro: `<p class="muted">${cows.map(c => esc(c.name || c.earTag)).join(', ')}</p>`,
    fields: treatmentFields(true), values: { type, date: todayISO(), days: 1, diagnosis: 'Profilaktyka', ...(await lastUsed(type)) },
    validate: v => {
      const e = validateTreatment(v, null);
      const young = cows.find(c => c.birthDate > v.date);
      if (young) e.date = `${cowLabel(young)} urodziła się po tej dacie.`;
      return e;
    },
    onSubmit: v => db.saveMany('treatments', cows.map(c => ({ ...v, cowId: c.id, note: [v.note, 'zabieg grupowy'].filter(Boolean).join(' · ') }))),
  });
  if (res) withdrawalToast(res);
  return res;
}

/* ---------------- ZAKŁADKA „ZDROWIE” ---------------- */

function treatmentRow(t, d, showCow = false) {
  const { milkEnd, meatEnd } = withdrawalEnds(t);
  const today = todayISO();
  const wd = (end, label) => end ? `<div>${label}: <b class="${end >= today ? 'neg' : ''}">${fmtDate(end)}</b>${end >= today ? ' ⛔' : ''}</div>` : '';
  const cow = d.cowsById.get(t.cowId);
  return `<li class="card">
    <div class="timeline-head"><div><b>${fmtDate(t.date)}</b> ${badge(TYPE_ICON[t.type] + ' ' + t.type)}
      ${showCow && cow ? ` <a href="#/krowa/${esc(cow.id)}?tab=zdrowie">${esc(cowLabel(cow))}</a>` : ''}</div>
      <span class="row-actions"><button class="btn-icon" data-act="edit-tr" data-id="${t.id}" aria-label="Edytuj">✎</button>
      <button class="btn-icon" data-act="del-tr" data-id="${t.id}" aria-label="Usuń">🗑</button></span></div>
    <div><b>${esc(t.diagnosis || '')}</b></div>
    <div>${esc(t.drug || '')}${t.batch ? ` (seria ${esc(t.batch)})` : ''} · ${esc(t.dose || '')} · ${esc(t.route || '')}${t.days > 1 ? ` · ${t.days} dni` : ''}</div>
    ${wd(milkEnd, 'Karencja mleko do')}${wd(meatEnd, 'Karencja mięso do')}
    ${t.nextDate ? `<div>Następna dawka: <b>${fmtDate(t.nextDate)}</b></div>` : ''}
    <div class="muted">${t.vet ? 'Lek. wet.: ' + esc(t.vet) : ''}${t.cost ? ' · koszt ' + fmtMoney(t.cost) : ''}</div>
    ${t.note ? `<div>${esc(t.note)}</div>` : ''}
    ${auditLine(t)}</li>`;
}

function healthTab(cow, d) {
  const list = d.of('treatments', cow.id).slice().reverse();
  const wd = activeWithdrawal(list);
  return `
    ${wd.active ? `<div class="alert alert-danger"><span class="flag-withdrawal">KARENCJA</span>
      ${wd.milk ? ` Mleko: do <b>${fmtDate(wd.milk)}</b> włącznie.` : ''}${wd.meat ? ` Mięso: do <b>${fmtDate(wd.meat)}</b> włącznie.` : ''}</div>`
      : '<div class="alert alert-ok">✔ Brak aktywnej karencji.</div>'}
    <div class="quick-grid">
      <button class="btn btn-primary btn-big" data-act="add-tr" data-type="leczenie">💊 Leczenie</button>
      <button class="btn btn-big" data-act="add-tr" data-type="szczepienie">💉 Szczepienie</button>
      <button class="btn btn-big" data-act="add-tr" data-type="odrobaczanie">🪱 Odrobaczanie</button>
    </div>
    ${list.length ? `<ul class="timeline">${list.map(t => treatmentRow(t, d)).join('')}</ul>` : emptyState('Brak wpisów leczenia.')}`;
}

async function handleHealth(act, id, cow, d, el, btn) {
  if (act === 'add-tr') { await treatmentDialog(cow, null, btn.dataset.type || 'leczenie'); return true; }
  if (act === 'edit-tr') { const t = d.treatments.find(x => x.id === id); await treatmentDialog(d.cowsById.get(t.cowId) || cow, t, t.type); return true; }
  if (act === 'del-tr') {
    if (await confirmDlg('Usunąć ten wpis leczenia? Trafi do kosza na 30 dni. Pamiętaj, że księgę leczenia trzeba przechowywać 5 lat.', { danger: true, okText: 'Usuń' })) {
      await db.softDelete('treatments', id); toast('Przeniesiono do kosza.');
    }
    return true;
  }
  return false;
}

registerCowTab({ id: 'zdrowie', label: 'Zdrowie', order: 20, render: healthTab, handle: handleHealth });
registerQuickAction({ act: 'treat', label: '💊 Leczenie', order: 10, run: cow => treatmentDialog(cow) });
registerBulkAction({ act: 'deworm', label: '🪱 Odrobaczanie', run: cows => bulkTreatmentDialog(cows, 'odrobaczanie') });
registerBulkAction({ act: 'vacc', label: '💉 Szczepienie', run: cows => bulkTreatmentDialog(cows, 'szczepienie') });

/* ---------------- ZADANIA: koniec karencji, kolejne dawki ---------------- */

registerTaskProvider((d, from, to, today) => {
  const out = [];
  for (const t of d.treatments) {
    const cow = d.cowsById.get(t.cowId);
    if (!cow || !isActive(cow)) continue;
    const { milkEnd, meatEnd } = withdrawalEnds(t);
    if (milkEnd && milkEnd >= today) out.push({ date: milkEnd, type: 'karencja', icon: '⛔', kind: 'danger', cowId: cow.id, href: `#/krowa/${cow.id}?tab=zdrowie`,
      title: `Ostatni dzień karencji (mleko): ${cowLabel(cow)} — ${t.drug}` });
    if (meatEnd && meatEnd >= today && meatEnd !== milkEnd) out.push({ date: meatEnd, type: 'karencja', icon: '⛔', kind: 'danger', cowId: cow.id, href: `#/krowa/${cow.id}?tab=zdrowie`,
      title: `Ostatni dzień karencji (mięso): ${cowLabel(cow)} — ${t.drug}` });
    if (t.nextDate) {
      // dawka uznana za wykonaną, jeśli później wpisano zabieg tego samego rodzaju
      const done = d.of('treatments', cow.id).some(x => x.type === t.type && x.date > t.date && x.date >= addDays(t.nextDate, -14));
      if (!done && daysBetween(t.nextDate, today) <= 60) {
        out.push({ date: t.nextDate, type: t.type, icon: TYPE_ICON[t.type], kind: t.nextDate < today ? 'warn' : 'info', overdue: t.nextDate < today,
          cowId: cow.id, href: `#/krowa/${cow.id}?tab=zdrowie`, title: `${t.type === 'szczepienie' ? 'Szczepienie' : 'Odrobaczanie'}: ${cowLabel(cow)} — ${t.drug}` });
      }
    }
  }
  return out;
});

/* ---------------- PANEL NA PULPICIE: karencje ---------------- */

registerDashPanel({ order: 10, render: (d, today) => {
  const list = d.cows.filter(isActive).map(c => ({ c, wd: activeWithdrawal(d.of('treatments', c.id), today) })).filter(x => x.wd.active);
  return `<section class="card"><h2>⛔ Krowy z aktywną karencją <span class="pill">${list.length}</span></h2>
    ${list.length ? `<ul class="tasks">${list.map(({ c, wd }) => `<li class="task task-danger"><a href="#/krowa/${esc(c.id)}?tab=zdrowie">
      <span class="flag-withdrawal">KARENCJA</span><span class="task-text">${esc(cowLabel(c))}</span>
      <span class="task-date">${wd.milk ? `mleko do ${fmtDate(wd.milk)}` : ''}${wd.milk && wd.meat ? '<br>' : ''}${wd.meat ? `mięso do ${fmtDate(wd.meat)}` : ''}</span></a></li>`).join('')}</ul>`
      : '<p class="muted">Żadne zwierzę nie ma teraz karencji.</p>'}</section>`;
} });

/* ---------------- KSIĘGA LECZENIA ---------------- */

registerCSV({ id: 'leczenia', label: 'Księga leczenia (leczenia, szczepienia, odrobaczanie)', build: d => ({
  rows: d.treatments.filter(t => d.cowsById.has(t.cowId)).sort((a, b) => a.date.localeCompare(b.date)),
  columns: [
    { label: 'Data', get: r => fmtDate(r.date) }, { label: 'Nr kolczyka', get: r => d.cowsById.get(r.cowId).earTag },
    { label: 'Zwierzę', get: r => cowLabel(d.cowsById.get(r.cowId)) }, { label: 'Rodzaj', get: r => r.type },
    { label: 'Rozpoznanie', get: r => r.diagnosis }, { label: 'Lek', get: r => r.drug }, { label: 'Nr partii', get: r => r.batch },
    { label: 'Dawka', get: r => r.dose }, { label: 'Sposób podania', get: r => r.route }, { label: 'Dni podawania', get: r => r.days },
    { label: 'Karencja mleko (dni)', get: r => r.withdrawalMilk }, { label: 'Koniec karencji mleko', get: r => fmtDate(withdrawalEnds(r).milkEnd) },
    { label: 'Karencja mięso (dni)', get: r => r.withdrawalMeat }, { label: 'Koniec karencji mięso', get: r => fmtDate(withdrawalEnds(r).meatEnd) },
    { label: 'Lekarz weterynarii', get: r => r.vet }, { label: 'Koszt (zł)', get: r => r.cost }, { label: 'Następna dawka', get: r => r.nextDate ? fmtDate(r.nextDate) : '' },
    { label: 'Uwagi', get: r => r.note }, { label: 'Wpisał(a)', get: r => r.createdBy },
  ],
}) });

const bookState = { from: addDays(todayISO(), -365), to: todayISO(), type: '' };

function bookRows(d) {
  return d.treatments
    .filter(t => d.cowsById.has(t.cowId) && t.date >= bookState.from && t.date <= bookState.to && (!bookState.type || t.type === bookState.type))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

/** Tabela księgi — ta sama na ekranie i na wydruku. */
function bookTable(rows, d) {
  return `<div class="table-wrap"><table class="table book">
    <thead><tr><th>Lp.</th><th>Data</th><th>Nr identyfikacyjny zwierzęcia</th><th>Rozpoznanie</th><th>Produkt leczniczy, nr serii</th>
    <th>Dawka, droga podania, dni</th><th>Okres karencji (dni) / data zakończenia</th><th>Lekarz weterynarii</th><th>Podpis</th></tr></thead>
    <tbody>${rows.map((t, i) => {
      const { milkEnd, meatEnd } = withdrawalEnds(t);
      const c = d.cowsById.get(t.cowId);
      return `<tr><td>${i + 1}</td><td>${fmtDate(t.date)}</td><td><b>${esc(c.earTag)}</b><br><small>${esc(c.name || '')}</small></td>
        <td>${esc(t.diagnosis || '')}${t.type !== 'leczenie' ? `<br><small>(${esc(t.type)})</small>` : ''}</td>
        <td>${esc(t.drug || '')}${t.batch ? `<br>seria: ${esc(t.batch)}` : ''}</td>
        <td>${esc(t.dose || '')}<br>${esc(t.route || '')}${t.days > 1 ? `<br>${t.days} dni` : ''}</td>
        <td>mleko: ${t.withdrawalMilk ?? 0} ${milkEnd ? '→ ' + fmtDate(milkEnd) : ''}<br>mięso: ${t.withdrawalMeat ?? 0} ${meatEnd ? '→ ' + fmtDate(meatEnd) : ''}</td>
        <td>${esc(t.vet || '')}</td><td style="min-width:80px"></td></tr>`;
    }).join('')}</tbody></table></div>`;
}

export async function bookView(el, params, query) {
  const d = await db.loadAll();
  const print = query.druk === '1';
  const rows = bookRows(d);
  const farm = await getFarm();
  if (print) {
    el.innerHTML = `<div class="no-print actions-row"><a class="btn" href="#/leczenie">← Wróć</a><button class="btn btn-primary" data-act="print">🖨 Drukuj / zapisz PDF</button></div>
      <div class="print-page"><h1>Księga leczenia zwierząt</h1>
      <p>Gospodarstwo: <b>${esc(farm.name || '…………………')}</b> · Właściciel: <b>${esc(farm.owner || '…………………')}</b><br>
      Adres: ${esc(farm.address || '…………………')} · Nr siedziby stada: <b>${esc(farm.herdNo || '…………………')}</b><br>
      Okres: ${fmtDate(bookState.from)} – ${fmtDate(bookState.to)} · Gatunek: bydło</p>
      ${bookTable(rows, d)}
      <p><small>Wydruk z aplikacji Obora, ${fmtDate(todayISO())}. Dokumentację przechowuje się przez 5 lat.</small></p></div>`;
    el.querySelector('[data-act="print"]').addEventListener('click', () => window.print());
    return;
  }
  el.innerHTML = `${pageHead('Księga leczenia', `<a class="btn btn-primary" href="#/leczenie?druk=1">🖨 Wydruk do kontroli</a>`)}
    <div class="filter-row card">
      <label class="filter"><span>Od</span><input type="date" data-f="from" value="${bookState.from}"></label>
      <label class="filter"><span>Do</span><input type="date" data-f="to" value="${bookState.to}"></label>
      <label class="filter"><span>Rodzaj</span><select data-f="type"><option value="">Wszystkie</option>${TREATMENT_TYPES.map(t => `<option ${t === bookState.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    </div>
    <p class="muted">${rows.length} ${plural(rows.length, 'wpis', 'wpisy', 'wpisów')}. Leczenie dodajesz na karcie zwierzęcia (zakładka „Zdrowie”) lub grupowo z listy stada.</p>
    ${rows.length ? bookTable(rows, d) : emptyState('Brak wpisów w wybranym okresie.')}`;
  el.addEventListener('change', e => {
    const f = e.target.dataset.f;
    if (!f) return;
    bookState[f] = e.target.value;
    const r = bookRows(d);
    el.querySelector('.table-wrap, .empty')?.replaceWith(Object.assign(document.createElement('div'), { innerHTML: r.length ? bookTable(r, d) : emptyState('Brak wpisów w wybranym okresie.') }).firstElementChild);
    el.querySelector('p.muted').textContent = `${r.length} ${plural(r.length, 'wpis', 'wpisy', 'wpisów')}.`;
  });
}
