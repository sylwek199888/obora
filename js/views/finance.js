/**
 * views/finance.js — FINANSE
 * Koszty i przychody: wpisy ręczne + automatycznie zebrane z innych działów
 * (koszt leczenia, inseminacji, zakupu i sprzedaży zwierząt, zakupu paszy).
 * Zestawienie miesięczne z wykresem i zysk/strata na krowę.
 */
import * as db from '../db.js';
import { esc, fmtDate, fmtMoney, todayISO, addDays, parseNum, sum, monthKey, monthName, lastMonths, daysBetween, groupBy } from '../utils.js';
import { COST_CATEGORIES, INCOME_CATEGORIES, feedUsage, cowLabel, isActive, validateEntryDate } from '../model.js';
import { formDialog, toast, confirmDlg, emptyState, tabsHTML } from '../ui.js';
import { pageHead } from './common.js';
import { barChart } from '../charts.js';
import { registerCSV } from '../backup.js';
import { registerCowTab } from './cow.js';

/**
 * Wszystkie pozycje finansowe w jednej liście:
 * {date, kind:'koszt'|'przychód', category, amount, cowId?, source, label, id?}
 * source='ręczny' — można edytować tutaj; inne pochodzą z kart i edytuje się je u źródła.
 */
export function financeItems(d) {
  const out = [];
  for (const f of d.finance) out.push({ ...f, amount: parseNum(f.amount) || 0, source: 'ręczny', label: f.note || f.category });
  for (const t of d.treatments) if (parseNum(t.cost)) out.push({ date: t.date, kind: 'koszt', category: t.type === 'leczenie' ? 'leki' : 'weterynarz', amount: parseNum(t.cost), cowId: t.cowId, source: 'leczenie', label: `${t.type}: ${t.drug || ''}` });
  for (const r of d.repro) if (parseNum(r.cost)) out.push({ date: r.date, kind: 'koszt', category: 'inseminacja', amount: parseNum(r.cost), cowId: r.cowId, source: 'rozród', label: `inseminacja ${r.bull || ''}` });
  for (const c of d.cows) {
    if (c.origin === 'zakup' && parseNum(c.purchasePrice) && c.purchaseDate) out.push({ date: c.purchaseDate, kind: 'koszt', category: 'zakup zwierząt', amount: parseNum(c.purchasePrice), cowId: c.id, source: 'karta', label: `zakup ${cowLabel(c)}` });
    if (c.status === 'sprzedana' && parseNum(c.salePrice) && c.exitDate) out.push({ date: c.exitDate, kind: 'przychód', category: 'sprzedaż zwierząt', amount: parseNum(c.salePrice), cowId: c.id, source: 'karta', label: `sprzedaż ${cowLabel(c)}` });
  }
  const feedName = new Map(d.feeds.map(f => [f.id, f.name]));
  for (const s of d.feedStock) if (s.type === 'przyjęcie' && parseNum(s.cost)) out.push({ date: s.date, kind: 'koszt', category: 'pasza', amount: parseNum(s.cost), source: 'magazyn', label: `zakup: ${feedName.get(s.feedId) || 'pasza'}` });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Zysk/strata na zwierzę w okresie od `from` do dziś.
 * - przychód z mleka bez przypisanego zwierzęcia jest dzielony między krowy
 *   proporcjonalnie do wpisanych litrów w danym miesiącu (a gdy ich brak —
 *   po równo między krowy z grupy „Dojne”),
 * - pasza szacowana z obecnej dawki × dni w gospodarstwie w tym okresie.
 */
export function perCow(d, items = financeItems(d), from = '0000-01-01') {
  const usage = feedUsage(d.cows, d.rations, d.feeds);
  const inPeriod = items.filter(i => i.date >= from);
  const byCow = groupBy(inPeriod.filter(i => i.cowId), i => i.cowId);
  const milkShare = new Map();
  for (const [m, list] of groupBy(inPeriod.filter(i => !i.cowId && i.kind === 'przychód' && i.category === 'mleko'), i => monthKey(i.date))) {
    const total = sum(list, i => i.amount);
    const liters = groupBy(d.milk.filter(x => monthKey(x.date) === m && x.cowId), x => x.cowId);
    const lsum = sum([...liters.values()].flat(), x => x.liters);
    if (lsum > 0) for (const [id, l] of liters) milkShare.set(id, (milkShare.get(id) || 0) + total * sum(l, x => x.liters) / lsum);
    else {
      const dairy = d.cows.filter(c => isActive(c) && c.group === 'Dojne');
      for (const c of dairy) milkShare.set(c.id, (milkShare.get(c.id) || 0) + total / dairy.length);
    }
  }
  return d.cows.map(c => {
    const its = byCow.get(c.id) || [];
    const milk = milkShare.get(c.id) || 0;
    const income = sum(its.filter(i => i.kind === 'przychód'), i => i.amount) + milk;
    const costs = sum(its.filter(i => i.kind === 'koszt'), i => i.amount);
    const start = c.origin === 'zakup' && c.purchaseDate ? c.purchaseDate : c.birthDate;
    const begin = start > from ? start : from;
    const days = Math.max(0, daysBetween(begin, c.exitDate || todayISO()) || 0);
    // dla zwierząt nieaktywnych nie znamy już dawki — pasza 0 (chyba że wpisano ręcznie)
    const feed = isActive(c) ? (usage.perCow.get(c.id) || 0) * days : 0;
    return { c, income, milk, costs, feed, days, result: income - costs - feed };
  });
}

async function entryDialog(rec = null) {
  const d = await db.loadAll();
  return formDialog({
    title: rec ? 'Edytuj wpis' : 'Nowy koszt / przychód',
    fields: [
      { name: 'kind', label: 'Rodzaj', type: 'select', options: ['koszt', 'przychód'], required: true },
      { name: 'date', label: 'Data', type: 'date', required: true },
      { name: 'category', label: 'Kategoria', type: 'select', options: COST_CATEGORIES, required: true, showIf: v => v.kind === 'koszt' },
      { name: 'categoryIn', label: 'Kategoria', type: 'select', options: INCOME_CATEGORIES, required: true, showIf: v => v.kind === 'przychód' },
      { name: 'amount', label: 'Kwota', type: 'number', unit: 'zł', required: true },
      { name: 'cow', label: 'Dotyczy zwierzęcia (opcjonalnie)', type: 'cowref' },
      { name: 'note', label: 'Opis', type: 'text', placeholder: 'np. Mleczarnia — rozliczenie za październik' },
    ],
    ctx: { cows: d.cows },
    values: rec ? { ...rec, categoryIn: rec.category, cowId: rec.cowId } : { kind: 'koszt', date: todayISO() },
    validate: v => {
      const e = {};
      const de = validateEntryDate(v.date); if (de) e.date = de;
      if (v.amount !== null && v.amount <= 0) e.amount = 'Kwota musi być większa od zera.';
      return e;
    },
    onSubmit: v => db.save('finance', {
      ...(rec || {}), kind: v.kind, date: v.date, category: v.kind === 'koszt' ? v.category : v.categoryIn,
      amount: v.amount, cowId: v.cowId || null, note: v.note || v.cowText || '',
    }),
  });
}

/* ---------------- WIDOK ---------------- */

let tab = 'miesiace';

function monthsTab(items) {
  const months = lastMonths(12);
  const byM = groupBy(items, i => monthKey(i.date));
  const rows = months.map(m => {
    const its = byM.get(m) || [];
    const cost = sum(its.filter(i => i.kind === 'koszt'), i => i.amount);
    const inc = sum(its.filter(i => i.kind === 'przychód'), i => i.amount);
    return { m, cost, inc, res: inc - cost };
  });
  const year = items.filter(i => i.date >= months[0] + '-01');
  const cats = kind => [...groupBy(year.filter(i => i.kind === kind), i => i.category)].map(([c, l]) => ({ c, v: sum(l, i => i.amount) })).sort((a, b) => b.v - a.v);
  const tot = rows.reduce((a, r) => ({ cost: a.cost + r.cost, inc: a.inc + r.inc }), { cost: 0, inc: 0 });
  return `<div class="stats-grid">
      <div class="stat"><span>Przychody (12 mies.)</span><b class="pos">${fmtMoney(tot.inc)}</b></div>
      <div class="stat"><span>Koszty (12 mies.)</span><b class="neg">${fmtMoney(tot.cost)}</b></div>
      <div class="stat"><span>Wynik (12 mies.)</span><b class="${tot.inc - tot.cost < 0 ? 'neg' : 'pos'}">${fmtMoney(tot.inc - tot.cost)}</b></div>
      <div class="stat"><span>Średnio miesięcznie</span><b>${fmtMoney((tot.inc - tot.cost) / 12)}</b></div>
    </div>
    <section class="card">${barChart(rows.map(r => monthName(r.m, true)), [{ label: 'Przychody', values: rows.map(r => r.inc) }, { label: 'Koszty', values: rows.map(r => r.cost) }], { unit: 'zł', title: 'Przychody i koszty' })}</section>
    <div class="table-wrap"><table class="table"><thead><tr><th>Miesiąc</th><th class="num">Przychody</th><th class="num">Koszty</th><th class="num">Wynik</th></tr></thead>
      <tbody>${rows.slice().reverse().map(r => `<tr><td>${esc(monthName(r.m))}</td><td class="num">${fmtMoney(r.inc)}</td><td class="num">${fmtMoney(r.cost)}</td>
        <td class="num ${r.res < 0 ? 'neg' : 'pos'}">${fmtMoney(r.res)}</td></tr>`).join('')}</tbody></table></div>
    <div class="dash-grid">
      <section class="card"><h3>Koszty wg kategorii (12 mies.)</h3>${cats('koszt').map(x => `<div class="kv"><dt>${esc(x.c)}</dt><dd>${fmtMoney(x.v)}</dd></div>`).join('') || '<p class="muted">Brak.</p>'}</section>
      <section class="card"><h3>Przychody wg kategorii (12 mies.)</h3>${cats('przychód').map(x => `<div class="kv"><dt>${esc(x.c)}</dt><dd>${fmtMoney(x.v)}</dd></div>`).join('') || '<p class="muted">Brak.</p>'}</section>
    </div>`;
}

let cowPeriod = '12';
const periodFrom = () => cowPeriod === 'all' ? '0000-01-01' : addDays(todayISO(), -365);

function cowsTab(d, items) {
  const rows = perCow(d, items, periodFrom()).sort((a, b) => b.result - a.result);
  return `<div class="seg"><button class="seg-btn ${cowPeriod === '12' ? 'active' : ''}" data-period="12">Ostatnie 12 miesięcy</button>
      <button class="seg-btn ${cowPeriod === 'all' ? 'active' : ''}" data-period="all">Cały okres</button></div>
    <p class="muted">Przychody: sprzedaż, wpisy przypisane do zwierzęcia i udział w przychodzie z mleka (wg wpisanych litrów).
    Koszty: zakup, leczenie, inseminacja, wpisy przypisane. Pasza (szac.) = obecna dawka × dni w gospodarstwie w wybranym okresie.</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>Zwierzę</th><th class="num">Przychody</th><th class="num">Koszty</th><th class="num">Pasza (szac.)</th><th class="num">Wynik</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td><a href="#/krowa/${esc(r.c.id)}?tab=finanse">${esc(cowLabel(r.c))}</a>${!isActive(r.c) ? ` <small class="muted">(${esc(r.c.status)})</small>` : ''}</td>
      <td class="num">${fmtMoney(r.income)}</td><td class="num">${fmtMoney(r.costs)}</td><td class="num">${fmtMoney(r.feed)}</td>
      <td class="num ${r.result < 0 ? 'neg' : 'pos'}"><b>${fmtMoney(r.result)}</b></td></tr>`).join('')}</tbody></table></div>`;
}

function entriesTab(d, items) {
  return `<div class="actions-row"><button class="btn btn-primary btn-big" data-act="add">＋ Koszt / przychód</button></div>
    ${items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Data</th><th>Kategoria</th><th>Opis</th><th class="num">Kwota</th><th></th></tr></thead>
    <tbody>${items.slice(0, 300).map(i => `<tr><td>${fmtDate(i.date)}</td><td>${esc(i.category)}<br><small class="muted">${esc(i.source)}</small></td>
      <td>${esc(i.label || '')}${i.cowId && d.cowsById.get(i.cowId) ? `<br><small>${esc(cowLabel(d.cowsById.get(i.cowId)))}</small>` : ''}</td>
      <td class="num ${i.kind === 'koszt' ? 'neg' : 'pos'}">${i.kind === 'koszt' ? '−' : '+'}${fmtMoney(i.amount)}</td>
      <td class="row-actions">${i.source === 'ręczny' ? `<button class="btn-icon" data-act="edit" data-id="${i.id}" aria-label="Edytuj">✎</button>
        <button class="btn-icon" data-act="del" data-id="${i.id}" aria-label="Usuń">🗑</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : emptyState('Brak wpisów.')}`;
}

const TABS = [{ id: 'miesiace', label: 'Miesięcznie' }, { id: 'zwierzeta', label: 'Na zwierzę' }, { id: 'wpisy', label: 'Wpisy' }];

export async function financeView(el, params, query) {
  if (query.tab) tab = query.tab;
  const d = await db.loadAll();
  const items = financeItems(d);
  const body = () => tab === 'miesiace' ? monthsTab(items) : tab === 'zwierzeta' ? cowsTab(d, items) : entriesTab(d, items);
  el.innerHTML = `${pageHead('Finanse', '<button class="btn btn-primary" data-act="add">＋ Koszt / przychód</button>')}${tabsHTML(TABS, tab)}<div class="tab-body">${body()}</div>`;
  el.addEventListener('click', async e => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; el.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t)); el.querySelector('.tab-body').innerHTML = body(); return; }
    const p = e.target.closest('[data-period]');
    if (p) { cowPeriod = p.dataset.period; el.querySelector('.tab-body').innerHTML = body(); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'add') { if (await entryDialog()) toast('Zapisano.', 'ok'); }
    if (b.dataset.act === 'edit') { if (await entryDialog(d.finance.find(f => f.id === b.dataset.id))) toast('Zapisano.', 'ok'); }
    if (b.dataset.act === 'del' && await confirmDlg('Usunąć ten wpis? Trafi do kosza na 30 dni.', { danger: true, okText: 'Usuń' })) {
      await db.softDelete('finance', b.dataset.id);
    }
  });
}

/* Zakładka „Finanse” na karcie zwierzęcia. */
registerCowTab({ id: 'finanse', label: 'Finanse', order: 70, render: (cow, d) => {
  const items = financeItems(d).filter(i => i.cowId === cow.id);
  const r = perCow(d, items, addDays(todayISO(), -365)).find(x => x.c.id === cow.id);
  const daily = feedUsage([cow], d.rations, d.feeds).perCow.get(cow.id) || 0;
  return `<div class="stats-grid">
      <div class="stat"><span>Przychody (12 mies.)</span><b class="pos">${fmtMoney(r.income)}</b>${r.milk ? `<small>w tym mleko ${fmtMoney(r.milk)}</small>` : ''}</div>
      <div class="stat"><span>Koszty (12 mies.)</span><b class="neg">${fmtMoney(r.costs)}</b></div>
      <div class="stat"><span>Pasza (szac., 12 mies.)</span><b>${fmtMoney(r.feed)}</b><small>${fmtMoney(daily)}/dzień × ${r.days} dni</small></div>
      <div class="stat"><span>Wynik</span><b class="${r.result < 0 ? 'neg' : 'pos'}">${fmtMoney(r.result)}</b></div>
    </div>
    ${items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Data</th><th>Opis</th><th class="num">Kwota</th></tr></thead><tbody>
      ${items.map(i => `<tr><td>${fmtDate(i.date)}</td><td>${esc(i.category)} — ${esc(i.label || '')}</td><td class="num ${i.kind === 'koszt' ? 'neg' : 'pos'}">${i.kind === 'koszt' ? '−' : '+'}${fmtMoney(i.amount)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">Brak pozycji finansowych dla tego zwierzęcia.</p>'}
    <p class="muted">Koszt lub przychód dla zwierzęcia dodasz w dziale Finanse (pole „Dotyczy zwierzęcia”).</p>`;
} });

registerCSV({ id: 'finanse', label: 'Finanse (wszystkie koszty i przychody)', build: d => ({
  rows: financeItems(d).reverse(),
  columns: [{ label: 'Data', get: r => fmtDate(r.date) }, { label: 'Rodzaj', get: r => r.kind }, { label: 'Kategoria', get: r => r.category },
    { label: 'Kwota (zł)', get: r => r.kind === 'koszt' ? -r.amount : r.amount }, { label: 'Opis', get: r => r.label },
    { label: 'Zwierzę', get: r => r.cowId ? cowLabel(d.cowsById.get(r.cowId)) : '' }, { label: 'Źródło', get: r => r.source }],
}) });
