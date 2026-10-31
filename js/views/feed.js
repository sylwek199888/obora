/**
 * views/feed.js — PASZA I ŻYWIENIE
 * Słownik pasz z ceną za kg, dawki (dla grupy lub konkretnej krowy),
 * dzienne/miesięczne zużycie i koszt, magazyn (przyjęcia, inwentaryzacja,
 * na ile dni wystarczy) oraz koszt paszy na 1 kg przyrostu.
 */
import * as db from '../db.js';
import { esc, fmtDate, fmtNum, fmtKg, fmtMoney, todayISO, parseNum, sum, plCompare, groupBy } from '../utils.js';
import { GROUPS, feedUsage, feedStock, isActive, weightStats, cowLabel, validateEntryDate } from '../model.js';
import { formDialog, toast, confirmDlg, emptyState, tabsHTML } from '../ui.js';
import { pageHead } from './common.js';
import { registerTaskProvider } from '../tasks.js';
import { registerDashPanel } from './dashboard.js';
import { registerCSV } from '../backup.js';
import { registerQuickAction } from './cow.js';

let tab = 'zuzycie';

/** Stan magazynu wszystkich pasz: [{feed, daily, stock, daysLeft, low}]. */
export function stockSummary(d, today = todayISO()) {
  const usage = feedUsage(d.cows, d.rations, d.feeds);
  const byFeed = groupBy(d.feedStock, s => s.feedId);
  return d.feeds.slice().sort((a, b) => plCompare(a.name, b.name)).map(f => {
    const daily = usage.perFeed.get(f.id) || 0;
    const st = feedStock(byFeed.get(f.id) || [], daily, today);
    const min = parseNum(f.minDays) ?? 14;
    return { feed: f, daily, ...st, low: st.stock !== null && st.daysLeft !== null && st.daysLeft < min, min };
  });
}

/** Opłacalność: koszt paszy na 1 kg przyrostu wg grup i zwierząt. */
export function profitability(d) {
  const usage = feedUsage(d.cows, d.rations, d.feeds);
  const rows = d.cows.filter(isActive).map(c => {
    const ws = weightStats(d.of('weights', c.id));
    const adg = ws.adgTotal ?? ws.adgLast;
    const cost = usage.perCow.get(c.id) || 0;
    return { c, adg, cost, perKg: adg > 0.05 && cost > 0 ? cost / adg : null };
  });
  const groups = GROUPS.map(g => {
    const r = rows.filter(x => x.c.group === g);
    const withAdg = r.filter(x => x.adg !== null && x.adg !== undefined);
    const adg = withAdg.length ? sum(withAdg, x => x.adg) / withAdg.length : null;
    const cost = r.length ? sum(r, x => x.cost) / r.length : 0;
    return { group: g, n: r.length, adg, cost, perKg: adg > 0.05 && cost > 0 ? cost / adg : null };
  }).filter(g => g.n);
  return { rows, groups };
}

/* ---------------- OKNA ---------------- */

async function feedDialog(rec = null) {
  const d = await db.loadAll();
  return formDialog({
    title: rec ? `Pasza: ${rec.name}` : 'Nowa pasza',
    fields: [
      { name: 'name', label: 'Nazwa', type: 'text', required: true },
      { name: 'pricePerKg', label: 'Cena', type: 'number', unit: 'zł/kg', required: true },
      { name: 'minDays', label: 'Ostrzegaj, gdy zapasu zostanie mniej niż', type: 'number', unit: 'dni' },
    ],
    values: rec || { minDays: 14 },
    validate: v => {
      const e = {};
      if (v.pricePerKg !== null && v.pricePerKg < 0) e.pricePerKg = 'Cena nie może być ujemna.';
      if (d.feeds.some(f => f.id !== rec?.id && f.name.toLowerCase() === v.name.toLowerCase())) e.name = 'Taka pasza już istnieje.';
      return e;
    },
    onSubmit: v => db.save('feeds', { ...(rec || {}), ...v }),
  });
}

/** Dawka dla grupy (target='group:Opas') lub zwierzęcia (target='cow:<id>'). */
export async function rationDialog(target, title) {
  const d = await db.loadAll();
  const current = d.rations.filter(r => r.target === target);
  const fields = d.feeds.slice().sort((a, b) => plCompare(a.name, b.name))
    .map(f => ({ name: 'f_' + f.id, label: `${f.name} (${fmtMoney(f.pricePerKg)}/kg)`, type: 'number', unit: 'kg/dzień' }));
  if (!fields.length) { toast('Najpierw dodaj pasze do słownika.', 'warn'); return null; }
  const values = Object.fromEntries(current.map(r => ['f_' + r.feedId, r.kgPerDay]));
  return formDialog({
    title, fields, values,
    intro: target.startsWith('cow:') ? '<p class="muted">Dawka indywidualna zastępuje dawkę grupy. Wyczyść wszystkie pola, aby wrócić do dawki grupowej.</p>' : '<p class="muted">Ilość na 1 zwierzę dziennie. Puste pole = pasza nie jest podawana.</p>',
    validate: v => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && (x < 0 || x > 200)).map(([k]) => [k, 'Podaj 0–200 kg.'])),
    onSubmit: async v => {
      for (const f of d.feeds) {
        const kg = v['f_' + f.id];
        const ex = current.find(r => r.feedId === f.id);
        if (kg && kg > 0) { if (!ex || ex.kgPerDay !== kg) await db.save('rations', { ...(ex || {}), target, feedId: f.id, kgPerDay: kg }); }
        else if (ex) await db.softDelete('rations', ex.id);
      }
      toast('Zapisano dawkę.', 'ok');
    },
  });
}

async function stockDialog(feed, type) {
  return formDialog({
    title: `${type === 'przyjęcie' ? 'Przyjęcie' : 'Inwentaryzacja'}: ${feed.name}`,
    intro: type === 'inwentaryzacja' ? '<p class="muted">Wpisz, ile paszy faktycznie jest w magazynie (np. po zważeniu lub oszacowaniu pryzmy). Od tej chwili stan liczony jest od nowa.</p>' : '',
    fields: [
      { name: 'date', label: 'Data', type: 'date', required: true },
      { name: 'kg', label: type === 'przyjęcie' ? 'Ilość przyjęta' : 'Stan faktyczny', type: 'number', unit: 'kg', required: true },
      ...(type === 'przyjęcie' ? [{ name: 'cost', label: 'Wartość zakupu (trafi do kosztów)', type: 'number', unit: 'zł', help: 'Zostaw puste dla paszy własnej' }] : []),
      { name: 'note', label: 'Uwagi', type: 'text' },
    ],
    values: { date: todayISO() },
    validate: v => {
      const e = {};
      const de = validateEntryDate(v.date); if (de) e.date = de;
      if (v.kg !== null && v.kg < 0) e.kg = 'Ilość nie może być ujemna.';
      return e;
    },
    onSubmit: v => db.save('feedStock', { ...v, feedId: feed.id, type }),
  });
}

/* ---------------- WIDOK ---------------- */

function usageTab(d) {
  const usage = feedUsage(d.cows, d.rations, d.feeds);
  const rows = d.feeds.map(f => ({ f, kg: usage.perFeed.get(f.id) || 0 })).filter(r => r.kg > 0).sort((a, b) => b.kg - a.kg);
  const price = f => parseNum(f.pricePerKg) || 0;
  return `<div class="stats-grid">
      <div class="stat"><span>Koszt paszy dziennie</span><b>${fmtMoney(usage.costPerDay)}</b></div>
      <div class="stat"><span>Koszt paszy miesięcznie (30 dni)</span><b>${fmtMoney(usage.costPerDay * 30)}</b></div>
      <div class="stat"><span>Zużycie dziennie</span><b>${fmtKg(sum(rows, r => r.kg))}</b></div>
      <div class="stat"><span>Średnio na zwierzę</span><b>${fmtMoney(usage.costPerDay / Math.max(1, d.cows.filter(isActive).length))}</b><small>dziennie</small></div>
    </div>
    ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Pasza</th><th class="num">kg/dzień</th><th class="num">kg/miesiąc</th><th class="num">zł/dzień</th><th class="num">zł/miesiąc</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(r.f.name)}</td><td class="num">${fmtNum(r.kg, 1)}</td><td class="num">${fmtNum(r.kg * 30)}</td>
        <td class="num">${fmtMoney(r.kg * price(r.f))}</td><td class="num">${fmtMoney(r.kg * price(r.f) * 30)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Razem</td><td class="num">${fmtNum(sum(rows, r => r.kg), 1)}</td><td class="num">${fmtNum(sum(rows, r => r.kg) * 30)}</td>
        <td class="num">${fmtMoney(usage.costPerDay)}</td><td class="num">${fmtMoney(usage.costPerDay * 30)}</td></tr></tfoot></table></div>`
      : emptyState('Brak dawek. Ustaw dawki w zakładce „Dawki”.')}
    <p class="muted">Zużycie liczone jest z dawek × liczba aktywnych zwierząt w grupach.</p>`;
}

function stockTab(d) {
  const list = stockSummary(d);
  const byFeed = groupBy(d.feedStock.slice().sort((a, b) => b.date.localeCompare(a.date)), s => s.feedId);
  return list.length ? list.map(s => `<section class="card ${s.low ? 'row-warn' : ''}">
    <div class="timeline-head"><h3>${esc(s.feed.name)}</h3>${s.low ? '<span class="badge badge-warn">kończy się!</span>' : ''}</div>
    <div class="stats-grid">
      <div class="stat"><span>Stan (szacunkowo)</span><b>${s.stock === null ? '—' : fmtKg(s.stock)}</b><small>${s.since ? 'liczony od ' + fmtDate(s.since) : 'brak wpisów'}</small></div>
      <div class="stat"><span>Zużycie</span><b>${fmtNum(s.daily, 1)} kg/dzień</b></div>
      <div class="stat"><span>Wystarczy na</span><b class="${s.low ? 'neg' : ''}">${s.daysLeft === null ? (s.stock === null ? '—' : '∞') : fmtNum(Math.floor(s.daysLeft)) + ' dni'}</b><small>alarm poniżej ${s.min} dni</small></div>
    </div>
    <div class="actions-row"><button class="btn btn-primary" data-act="receipt" data-id="${s.feed.id}">＋ Przyjęcie</button>
      <button class="btn" data-act="inventory" data-id="${s.feed.id}">📋 Inwentaryzacja</button></div>
    ${(byFeed.get(s.feed.id) || []).length ? `<details><summary>Historia (${byFeed.get(s.feed.id).length})</summary><ul class="link-list">
      ${byFeed.get(s.feed.id).map(x => `<li>${fmtDate(x.date)} — ${esc(x.type)}: <b>${fmtKg(x.kg)}</b>${x.cost ? ` za ${fmtMoney(x.cost)}` : ''} ${esc(x.note || '')}
        <button class="btn-icon" data-act="del-stock" data-id="${x.id}" aria-label="Usuń">🗑</button></li>`).join('')}</ul></details>` : ''}
  </section>`).join('') : emptyState('Brak pasz w słowniku.');
}

function rationsTab(d) {
  const feedName = new Map(d.feeds.map(f => [f.id, f.name]));
  const groupCard = g => {
    const r = d.rations.filter(x => x.target === 'group:' + g);
    const n = d.cows.filter(c => isActive(c) && c.group === g).length;
    return `<section class="card"><div class="timeline-head"><h3>${esc(g)} <span class="pill">${n} szt.</span></h3>
      <button class="btn" data-act="edit-ration" data-target="group:${esc(g)}">✎ Ustaw dawkę</button></div>
      ${r.length ? `<ul class="link-list">${r.map(x => `<li>${esc(feedName.get(x.feedId) || '?')}: <b>${fmtNum(x.kgPerDay, 1)} kg/dzień</b></li>`).join('')}</ul>
        <p class="muted">Koszt: ${fmtMoney(sum(r, x => x.kgPerDay * (parseNum(d.feeds.find(f => f.id === x.feedId)?.pricePerKg) || 0)))} / szt. / dzień</p>`
      : '<p class="muted">Brak dawki.</p>'}</section>`;
  };
  const indiv = groupBy(d.rations.filter(r => r.target.startsWith('cow:')), r => r.target.slice(4));
  return `${GROUPS.map(groupCard).join('')}
    <section class="card"><h3>Dawki indywidualne</h3>
      ${indiv.size ? `<ul class="link-list">${[...indiv].map(([id, r]) => { const c = d.cowsById.get(id); return c ? `<li><a href="#/krowa/${esc(id)}">${esc(cowLabel(c))}</a>:
        ${r.map(x => `${esc(feedName.get(x.feedId) || '?')} ${fmtNum(x.kgPerDay, 1)} kg`).join(', ')}
        <button class="btn btn-small" data-act="edit-ration" data-target="cow:${esc(id)}">✎</button></li>` : ''; }).join('')}</ul>`
      : '<p class="muted">Brak. Dawkę indywidualną ustawisz na karcie zwierzęcia (przycisk „Dawka paszy”).</p>'}</section>`;
}

function dictTab(d) {
  return `<div class="actions-row"><button class="btn btn-primary" data-act="add-feed">＋ Dodaj paszę</button></div>
    ${d.feeds.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Pasza</th><th class="num">Cena za kg</th><th class="num">Alarm zapasu</th><th></th></tr></thead>
    <tbody>${d.feeds.slice().sort((a, b) => plCompare(a.name, b.name)).map(f => `<tr><td><b>${esc(f.name)}</b></td><td class="num">${fmtMoney(f.pricePerKg)}</td>
      <td class="num">${f.minDays ?? 14} dni</td><td class="row-actions"><button class="btn-icon" data-act="edit-feed" data-id="${f.id}" aria-label="Edytuj">✎</button>
      <button class="btn-icon" data-act="del-feed" data-id="${f.id}" aria-label="Usuń">🗑</button></td></tr>`).join('')}</tbody></table></div>` : emptyState('Słownik pasz jest pusty.')}`;
}

function profitTab(d) {
  const { rows, groups } = profitability(d);
  return `<p class="muted">Koszt paszy na 1 kg przyrostu = dzienny koszt dawki ÷ średni przyrost dzienny (od pierwszego do ostatniego ważenia).</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>Grupa</th><th class="num">Szt.</th><th class="num">Śr. przyrost</th><th class="num">Pasza zł/szt./dzień</th><th class="num">Koszt 1 kg przyrostu</th></tr></thead>
    <tbody>${groups.map(g => `<tr><td>${esc(g.group)}</td><td class="num">${g.n}</td><td class="num">${g.adg === null ? '—' : fmtNum(g.adg, 2) + ' kg/d'}</td>
      <td class="num">${fmtMoney(g.cost)}</td><td class="num"><b>${g.perKg === null ? '—' : fmtMoney(g.perKg)}</b></td></tr>`).join('')}</tbody></table></div>
    <h3>Poszczególne zwierzęta</h3>
    <div class="table-wrap"><table class="table"><thead><tr><th>Zwierzę</th><th>Grupa</th><th class="num">Przyrost</th><th class="num">Pasza zł/dzień</th><th class="num">Koszt 1 kg przyrostu</th></tr></thead>
    <tbody>${rows.sort((a, b) => (a.perKg ?? 1e9) - (b.perKg ?? 1e9)).map(r => `<tr><td><a href="#/krowa/${esc(r.c.id)}">${esc(cowLabel(r.c))}</a></td><td>${esc(r.c.group || '')}</td>
      <td class="num ${r.adg < 0 ? 'neg' : ''}">${r.adg === null || r.adg === undefined ? '—' : fmtNum(r.adg, 2)}</td><td class="num">${fmtMoney(r.cost)}</td>
      <td class="num"><b>${r.perKg === null ? '—' : fmtMoney(r.perKg)}</b></td></tr>`).join('')}</tbody></table></div>`;
}

const TABS = [
  { id: 'zuzycie', label: 'Zużycie i koszt', render: usageTab },
  { id: 'magazyn', label: 'Magazyn', render: stockTab },
  { id: 'dawki', label: 'Dawki', render: rationsTab },
  { id: 'slownik', label: 'Słownik pasz', render: dictTab },
  { id: 'oplacalnosc', label: 'Opłacalność', render: profitTab },
];

export async function feedView(el, params, query) {
  if (query.tab) tab = query.tab;
  const d = await db.loadAll();
  el.innerHTML = `${pageHead('Pasza i żywienie')}${tabsHTML(TABS, tab)}<div class="tab-body">${TABS.find(t => t.id === tab).render(d)}</div>`;
  el.addEventListener('click', async e => {
    const t = e.target.closest('[data-tab]');
    if (t) {
      tab = t.dataset.tab;
      el.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
      el.querySelector('.tab-body').innerHTML = TABS.find(x => x.id === tab).render(await db.loadAll());
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const dd = await db.loadAll();
    const feed = dd.feeds.find(f => f.id === b.dataset.id);
    switch (b.dataset.act) {
      case 'add-feed': if (await feedDialog()) toast('Dodano paszę.', 'ok'); break;
      case 'edit-feed': if (await feedDialog(feed)) toast('Zapisano.', 'ok'); break;
      case 'del-feed':
        if (await confirmDlg(`Usunąć paszę „${feed.name}” ze słownika? Dawki z tą paszą przestaną być liczone.`, { danger: true, okText: 'Usuń' })) {
          await db.softDelete('feeds', feed.id);
        }
        break;
      case 'receipt': if (await stockDialog(feed, 'przyjęcie')) toast('Zapisano przyjęcie.', 'ok'); break;
      case 'inventory': if (await stockDialog(feed, 'inwentaryzacja')) toast('Zapisano stan magazynu.', 'ok'); break;
      case 'del-stock': if (await confirmDlg('Usunąć ten wpis magazynowy?', { danger: true, okText: 'Usuń' })) await db.softDelete('feedStock', b.dataset.id); break;
      case 'edit-ration': {
        const tg = b.dataset.target;
        const name = tg.startsWith('group:') ? `grupa ${tg.slice(6)}` : cowLabel(dd.cowsById.get(tg.slice(4)));
        await rationDialog(tg, `Dawka dzienna — ${name}`);
        break;
      }
    }
  });
}

/* ---------------- INTEGRACJE ---------------- */

registerQuickAction({ act: 'ration', label: '🌾 Dawka paszy', order: 40, show: isActive,
  run: cow => rationDialog('cow:' + cow.id, `Dawka indywidualna — ${cow.name || cow.earTag}`) });

registerTaskProvider((d, from, to, today) => stockSummary(d, today).filter(s => s.low).map(s => ({
  date: today, type: 'pasza', icon: '🌾', kind: 'warn', overdue: true, href: '#/pasze?tab=magazyn',
  title: `Kończy się ${s.feed.name}: zapas na ${Math.floor(s.daysLeft)} dni (${fmtKg(s.stock)})`,
})));

registerDashPanel({ order: 20, render: d => {
  const list = stockSummary(d).filter(s => s.stock !== null || s.daily > 0);
  if (!list.length) return '';
  return `<section class="card"><h2>🌾 Magazyn pasz</h2>
    <ul class="tasks">${list.map(s => `<li class="task ${s.low ? 'task-warn' : ''}"><a href="#/pasze?tab=magazyn">
      <span class="task-text">${esc(s.feed.name)}</span>
      <span class="task-date"><b>${s.stock === null ? 'brak stanu' : fmtKg(s.stock)}</b><br><small class="${s.low ? 'neg' : ''}">${s.daysLeft === null ? '' : `na ${Math.floor(s.daysLeft)} dni`}</small></span></a></li>`).join('')}</ul></section>`;
} });

registerCSV({ id: 'pasze', label: 'Pasze — magazyn i dawki', build: d => {
  const name = new Map(d.feeds.map(f => [f.id, f.name]));
  return {
    rows: [...d.feedStock.map(s => ({ ...s, kind: s.type })), ...d.rations.map(r => ({ ...r, kind: 'dawka', kg: r.kgPerDay }))]
      .sort((a, b) => (a.date || '').localeCompare(b.date || '')),
    columns: [{ label: 'Rodzaj', get: r => r.kind }, { label: 'Data', get: r => r.date ? fmtDate(r.date) : '' }, { label: 'Pasza', get: r => name.get(r.feedId) },
      { label: 'Dla', get: r => r.target ? (r.target.startsWith('group:') ? r.target.slice(6) : cowLabel(d.cowsById.get(r.target.slice(4)))) : '' },
      { label: 'kg (dawka: kg/dzień)', get: r => r.kg }, { label: 'Koszt (zł)', get: r => r.cost }, { label: 'Uwagi', get: r => r.note }],
  };
} });
