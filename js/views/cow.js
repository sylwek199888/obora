/**
 * views/cow.js — KARTA KROWY
 * Zakładki: Przegląd, Waga, Zdrowie, Rozród, Dziennik, Rodowód, Finanse.
 * Zakładki z innych modułów rejestrują się przez registerCowTab().
 * Tu też: formularz dodawania/edycji zwierzęcia, zmiana statusu,
 * dziennik (notatki ze zdjęciem) i historia kondycji (BCS, racice).
 */
import * as db from '../db.js';
import { esc, fmtDate, fmtKg, fmtNum, fmtMoney, ageText, todayISO, normalizeTag, parseNum } from '../utils.js';
import {
  COW_FIELDS, newCowDefaults, validateCow, validateEntryDate, cowLabel, isActive, STATUS_LABEL, GROUPS,
  HOOF_STATES, pedigree, kinshipWarning, isFemale, weightStats,
} from '../model.js';
import { formDialog, confirmDlg, toast, tabsHTML, emptyState, badge } from '../ui.js';
import { navigate } from '../router.js';
import { cowAlerts, cowPhoto, auditLine } from './common.js';
import { weightsTab, handleWeightAction, weightDialog } from './weights.js';

/* ---------------- REJESTR ZAKŁADEK ---------------- */

const tabs = [];
/** tab = {id, label, order, render(cow,d) -> html, handle(act,id,cow,d,el) -> bool} */
export function registerCowTab(tab) { tabs.push(tab); tabs.sort((a, b) => a.order - b.order); }
/** Dodatkowe szybkie akcje na „Przeglądzie”: {act, label, order, show(cow), run(cow,d)} */
const quickActions = [];
export function registerQuickAction(a) { quickActions.push(a); quickActions.sort((x, y) => x.order - y.order); }

let activeTab = 'przeglad';
let lastCowId = null;

/* ---------------- FORMULARZ ZWIERZĘCIA ---------------- */

/** Dodatkowe pola formularza z innych modułów (np. ARiMR przy nowej krowie). */
const extraNewFields = [];
const afterCreateHooks = [];
export function registerNewCowField(field, afterCreate) { extraNewFields.push(field); if (afterCreate) afterCreateHooks.push(afterCreate); }

/** Okno dodawania lub edycji zwierzęcia. Zwraca zapisaną krowę lub null. */
export async function cowFormDialog(cow = null, preset = {}) {
  const d = await db.loadAll();
  const values = cow ? { ...cow } : { ...newCowDefaults(), ...preset };
  const fields = [];
  let section = null;
  for (const f of COW_FIELDS) {
    if (f.section !== section) { section = f.section; fields.push({ type: 'heading', name: 'h_' + section, label: section }); }
    fields.push(f);
  }
  if (!cow) fields.push(...extraNewFields);
  let saved = null;
  await formDialog({
    title: cow ? `Edycja: ${cowLabel(cow)}` : 'Nowe zwierzę',
    fields, values, wide: true, ctx: { cows: d.cows, selfId: cow?.id },
    validate: v => validateCow(v, d.cows, cow?.id),
    onSubmit: async v => {
      v.earTag = normalizeTag(v.earTag);
      const extra = {};
      for (const f of extraNewFields) { extra[f.name] = v[f.name]; delete v[f.name]; }
      saved = await db.save('cows', { ...(cow || {}), ...v });
      if (!cow) for (const h of afterCreateHooks) await h(saved, extra);
    },
  });
  if (saved) toast(cow ? 'Zapisano zmiany.' : 'Dodano zwierzę.', 'ok');
  return saved;
}

/** Sprzedaż / padnięcie / ubój. */
async function statusDialog(cow, kind) {
  const sold = kind === 'sprzedana';
  const fields = sold ? [
    { name: 'exitDate', label: 'Data sprzedaży', type: 'date', required: true },
    { name: 'buyer', label: 'Komu (nabywca)', type: 'text' },
    { name: 'salePrice', label: 'Cena', type: 'number', unit: 'zł' },
    { name: 'saleWeight', label: 'Waga', type: 'number', unit: 'kg' },
  ] : [
    { name: 'status', label: 'Zdarzenie', type: 'select', required: true, options: [{ value: 'padła', label: 'Padła' }, { value: 'ubój', label: 'Ubój' }] },
    { name: 'exitDate', label: 'Data', type: 'date', required: true },
    { name: 'exitCause', label: 'Przyczyna', type: 'text' },
  ];
  const d = await db.loadAll();
  const lastW = weightStats(d.of('weights', cow.id)).last;
  return formDialog({
    title: sold ? 'Sprzedaż zwierzęcia' : 'Padnięcie / ubój',
    fields, values: { exitDate: todayISO(), status: 'padła', saleWeight: lastW?.kg ?? null },
    intro: '<p class="muted">Zwierzę zostanie zarchiwizowane — dane i historia pozostaną dostępne (filtr „Status”).</p>',
    validate: v => validateCow({ ...cow, ...v, status: sold ? 'sprzedana' : v.status }, d.cows, cow.id),
    onSubmit: v => db.save('cows', { ...cow, ...v, status: sold ? 'sprzedana' : v.status }),
  });
}

/* ---------------- DZIENNIK I KONDYCJA ---------------- */

async function noteDialog(cow, rec = null) {
  return formDialog({
    title: `${rec ? 'Edytuj' : 'Nowa'} notatka — ${cow.name || cow.earTag}`,
    fields: [
      { name: 'date', label: 'Data', type: 'date', required: true },
      { name: 'text', label: 'Notatka', type: 'textarea', required: true, placeholder: 'np. kuleje na lewą tylną' },
      { name: 'photo', label: 'Zdjęcie', type: 'photo' },
    ],
    values: rec || { date: todayISO() },
    validate: v => { const e = validateEntryDate(v.date, cow); return e ? { date: e } : {}; },
    onSubmit: v => db.save('notes', { ...(rec || {}), ...v, cowId: cow.id }),
  });
}

async function conditionDialog(cow, rec = null) {
  return formDialog({
    title: `Kondycja i racice — ${cow.name || cow.earTag}`,
    fields: [
      { name: 'date', label: 'Data oceny', type: 'date', required: true },
      { name: 'bcs', label: 'BCS (kondycja 1–5)', type: 'select', options: ['1', '1.5', '2', '2.5', '3', '3.25', '3.5', '3.75', '4', '4.5', '5'],
        help: '1 = bardzo chuda, 3 = optymalna, 5 = otłuszczona' },
      { name: 'hooves', label: 'Stan racic', type: 'select', options: HOOF_STATES },
      { name: 'note', label: 'Uwagi', type: 'text' },
    ],
    values: rec || { date: todayISO(), bcs: '3', hooves: 'dobry' },
    validate: v => {
      const e = {};
      const de = validateEntryDate(v.date, cow); if (de) e.date = de;
      if (!v.bcs && !v.hooves) e.bcs = 'Podaj BCS lub stan racic.';
      return e;
    },
    onSubmit: v => db.save('conditions', { ...(rec || {}), ...v, cowId: cow.id }),
  });
}

/* ---------------- WYŚWIETLANIE PÓL ---------------- */

/** Wartość pola karty w czytelnej postaci (HTML). */
export function fieldValueHTML(f, cow, d) {
  if (f.type === 'cowref') {
    const id = cow[f.name + 'Id'];
    const ref = id && d.cowsById.get(id);
    if (ref) return `<a href="#/krowa/${esc(ref.id)}">${esc(cowLabel(ref))}</a>`;
    return esc(cow[f.name + 'Text'] || '');
  }
  const v = cow[f.name];
  if (v === null || v === undefined || v === '') return '';
  if (f.type === 'date') return fmtDate(v);
  if (f.type === 'number') return `${fmtNum(v, f.unit === 'zł' ? 2 : 0)} ${esc(f.unit || '')}`;
  if (f.type === 'checkbox') return v ? 'tak' : 'nie';
  if (f.type === 'select') {
    const o = (f.options || []).find(o => (typeof o === 'object' ? o.value : o) === v);
    return esc(typeof o === 'object' ? o.label : v);
  }
  return esc(v);
}

function overviewTab(cow, d) {
  const conds = d.of('conditions', cow.id);
  const lastBcs = conds.filter(c => c.bcs).pop();
  const lastHoof = conds.filter(c => c.hooves).pop();
  const ws = weightStats(d.of('weights', cow.id));
  const sections = [];
  let cur = null;
  for (const f of COW_FIELDS) {
    if (f.card === false) continue;
    if (f.showIf && !f.showIf(cow)) continue;
    const val = fieldValueHTML(f, cow, d);
    if (!val) continue;
    if (!cur || cur.name !== f.section) { cur = { name: f.section, rows: [] }; sections.push(cur); }
    cur.rows.push(`<div class="kv"><dt>${esc(f.label)}</dt><dd>${val}</dd></div>`);
    if (f.name === 'birthDate') cur.rows.push(`<div class="kv"><dt>Wiek</dt><dd><b>${esc(ageText(cow.birthDate))}</b></dd></div>`);
  }
  const extraActions = quickActions.filter(a => !a.show || a.show(cow)).map(a =>
    `<button class="btn btn-big" data-act="qa-${a.act}">${a.label}</button>`).join('');
  return `
    <div class="quick-grid">
      <button class="btn btn-primary btn-big" data-act="add-weight">⚖️ Ważenie</button>
      ${extraActions}
      <button class="btn btn-big" data-act="add-note">📝 Notatka</button>
      <button class="btn btn-big" data-act="add-cond">💪 Kondycja / racice</button>
      <button class="btn btn-big" data-act="move">🔀 Zmień grupę</button>
    </div>
    <div class="stats-grid">
      <div class="stat"><span>Wiek</span><b>${esc(ageText(cow.birthDate))}</b></div>
      <div class="stat"><span>Ostatnia waga</span><b>${ws.last ? fmtKg(ws.last.kg) : '—'}</b><small>${ws.last ? fmtDate(ws.last.date) : ''}</small></div>
      <div class="stat"><span>BCS</span><b>${lastBcs ? esc(lastBcs.bcs) : '—'}</b><small>${lastBcs ? fmtDate(lastBcs.date) : ''}</small></div>
      <div class="stat"><span>Racice</span><b>${lastHoof ? esc(lastHoof.hooves) : '—'}</b><small>${lastHoof ? fmtDate(lastHoof.date) : ''}</small></div>
    </div>
    ${sections.map(s => `<section class="card"><h3>${esc(s.name)}</h3><dl class="kv-list">${s.rows.join('')}</dl></section>`).join('')}
    <section class="card">
      <h3>Kondycja (BCS) i racice — historia</h3>
      ${conds.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Data</th><th>BCS</th><th>Racice</th><th>Uwagi</th><th></th></tr></thead><tbody>
        ${conds.slice().reverse().map(c => `<tr><td>${fmtDate(c.date)}</td><td>${esc(c.bcs || '')}</td><td>${esc(c.hooves || '')}</td>
          <td>${esc(c.note || '')}<br>${auditLine(c)}</td>
          <td class="row-actions"><button class="btn-icon" data-act="edit-cond" data-id="${c.id}" aria-label="Edytuj">✎</button>
          <button class="btn-icon" data-act="del-cond" data-id="${c.id}" aria-label="Usuń">🗑</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Brak ocen kondycji.</p>'}
    </section>
    <section class="card danger-zone">
      <h3>Status i archiwum</h3>
      <div class="actions-row">
        ${isActive(cow) ? `<button class="btn" data-act="sell">💰 Sprzedaż</button>
          <button class="btn" data-act="dead">✝ Padnięcie / ubój</button>`
          : `<button class="btn" data-act="reactivate">↩ Przywróć jako aktywną</button>`}
        <button class="btn btn-danger" data-act="delete">🗑 Usuń kartę</button>
      </div>
      ${auditLine(cow)}
    </section>`;
}

function journalTab(cow, d) {
  const notes = d.of('notes', cow.id).slice().reverse();
  return `<div class="actions-row"><button class="btn btn-primary btn-big" data-act="add-note">📝 Dodaj notatkę</button></div>
    ${notes.length ? `<ul class="timeline">${notes.map(n => `<li class="card">
      <div class="timeline-head"><b>${fmtDate(n.date)}</b>
        <span class="row-actions"><button class="btn-icon" data-act="edit-note" data-id="${n.id}" aria-label="Edytuj">✎</button>
        <button class="btn-icon" data-act="del-note" data-id="${n.id}" aria-label="Usuń">🗑</button></span></div>
      <p class="note-text">${esc(n.text)}</p>
      ${n.photo ? `<img class="note-photo" src="${esc(n.photo)}" alt="Zdjęcie do notatki" loading="lazy">` : ''}
      ${auditLine(n)}</li>`).join('')}</ul>` : emptyState('Dziennik jest pusty.')}`;
}

/* ---------------- RODOWÓD ---------------- */

function pedNode(node, role) {
  if (!node) return `<div class="ped-node empty"><small>${role}</small><span>nieznany</span></div>`;
  const label = node.cow ? `<a href="#/krowa/${esc(node.cow.id)}">${esc(cowLabel(node.cow))}</a>` : esc(node.text);
  return `<div class="ped-node ${node.cow ? 'in-herd' : ''}"><small>${role}</small><span>${label}</span></div>`;
}

function pedigreeTab(cow, d) {
  const tree = pedigree(cow, d.cowsById, d.cowsByTag, 3) || {};
  const m = tree.mother, f = tree.father;
  const offspring = d.cows.filter(c => c.motherId === cow.id || c.fatherId === cow.id);
  return `<section class="card"><h3>Drzewo rodowodu</h3>
    <div class="pedigree">
      <div class="ped-col">${pedNode({ cow }, 'zwierzę')}</div>
      <div class="ped-col">${pedNode(m, 'matka')}${pedNode(f, 'ojciec')}</div>
      <div class="ped-col">
        ${pedNode(m?.tree?.mother, 'babka (po matce)')}${pedNode(m?.tree?.father, 'dziadek (po matce)')}
        ${pedNode(f?.tree?.mother, 'babka (po ojcu)')}${pedNode(f?.tree?.father, 'dziadek (po ojcu)')}
      </div>
    </div></section>
    ${isFemale(cow) ? `<section class="card"><h3>Sprawdź pokrewieństwo przed kryciem</h3>
      <form class="inline-form" data-form="kin">
        <input type="text" name="bull" placeholder="Numer / nazwa buhaja lub kolczyk" aria-label="Buhaj" autocomplete="off" list="dl_bulls">
        <datalist id="dl_bulls">${d.cows.filter(c => c.sex === 'byk').map(c => `<option value="${esc(c.earTag)}">${esc(cowLabel(c))}</option>`).join('')}</datalist>
        <button class="btn btn-primary">Sprawdź</button>
      </form><div data-kin-result></div></section>` : ''}
    <section class="card"><h3>Potomstwo (${offspring.length})</h3>
      ${offspring.length ? `<ul class="link-list">${offspring.map(o => `<li><a href="#/krowa/${esc(o.id)}">${esc(cowLabel(o))}</a> — ${esc(o.sex)}, ur. ${fmtDate(o.birthDate)}</li>`).join('')}</ul>` : '<p class="muted">Brak potomstwa w stadzie.</p>'}
    </section>`;
}

/* ---------------- WIDOK KARTY ---------------- */

registerCowTab({ id: 'przeglad', label: 'Przegląd', order: 0, render: overviewTab });
registerCowTab({ id: 'waga', label: 'Waga', order: 10, render: weightsTab, handle: handleWeightAction });
registerCowTab({ id: 'dziennik', label: 'Dziennik', order: 50, render: journalTab });
registerCowTab({ id: 'rodowod', label: 'Rodowód', order: 60, render: pedigreeTab });

export async function cowView(el, { id }, query) {
  const d = await db.loadAll();
  const cow = d.cowsById.get(id);
  if (!cow) {
    el.innerHTML = `<div class="card"><h2>Nie znaleziono zwierzęcia</h2><p>Mogło zostać usunięte (sprawdź Kosz).</p><a class="btn" href="#/stado">Wróć do stada</a></div>`;
    return;
  }
  if (lastCowId !== id) { activeTab = query.tab || 'przeglad'; lastCowId = id; }
  if (query.tab) activeTab = query.tab;
  if (!tabs.some(t => t.id === activeTab)) activeTab = 'przeglad';
  const alerts = cowAlerts(cow, d);
  const tab = tabs.find(t => t.id === activeTab);
  el.innerHTML = `
    <div class="cow-head ${alerts.some(a => a.key === 'karencja') ? 'has-withdrawal' : ''}">
      <a href="#/stado" class="btn-icon back" aria-label="Wróć do listy">←</a>
      ${cowPhoto(cow, 'cow-photo')}
      <div class="cow-head-info">
        <h1>${esc(cow.name || 'bez imienia')} ${cow.internalNo ? `<span class="tile-no">#${esc(cow.internalNo)}</span>` : ''}</h1>
        <div class="cow-tag">${esc(cow.earTag)}</div>
        <div class="badges">${badge(cow.sex)} ${cow.group ? badge(cow.group) : ''} ${!isActive(cow) ? badge(STATUS_LABEL[cow.status], 'dark') : ''}
          ${alerts.some(a => a.key === 'karencja') ? '<span class="flag-withdrawal">KARENCJA</span>' : ''}</div>
      </div>
      <div class="cow-head-actions">
        <button class="btn" data-act="edit">✎ Edytuj</button>
        ${cowHeadButtons.map(b => `<button class="btn" data-act="hb-${b.act}">${b.label}</button>`).join('')}
      </div>
    </div>
    ${alerts.length ? `<div class="alert-list">${alerts.map(a => `<div class="alert alert-${a.kind}">${a.icon} ${esc(a.text)}</div>`).join('')}</div>` : ''}
    ${tabsHTML(tabs, activeTab)}
    <div class="tab-body">${tab.render(cow, d)}</div>`;

  el.addEventListener('click', async e => {
    const tb = e.target.closest('[data-tab]');
    if (tb) {
      activeTab = tb.dataset.tab;
      el.querySelectorAll('.tab').forEach(t => { t.classList.toggle('active', t === tb); t.setAttribute('aria-selected', t === tb); });
      const dd = await db.loadAll();
      el.querySelector('.tab-body').innerHTML = tabs.find(t => t.id === activeTab).render(cow, dd);
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, rid = b.dataset.id;
    const dd = await db.loadAll();
    switch (act) {
      case 'edit': await cowFormDialog(cow); return;
      case 'add-weight': await weightDialog(cow); return;
      case 'add-note': await noteDialog(cow); return;
      case 'edit-note': await noteDialog(cow, dd.notes.find(n => n.id === rid)); return;
      case 'add-cond': await conditionDialog(cow); return;
      case 'edit-cond': await conditionDialog(cow, dd.conditions.find(n => n.id === rid)); return;
      case 'del-note': case 'del-cond': {
        if (await confirmDlg('Usunąć ten wpis? Trafi do kosza na 30 dni.', { danger: true, okText: 'Usuń' })) {
          await db.softDelete(act === 'del-note' ? 'notes' : 'conditions', rid); toast('Przeniesiono do kosza.');
        }
        return;
      }
      case 'move': await moveGroupDialog([cow]); return;
      case 'sell': if (await statusDialog(cow, 'sprzedana')) toast('Zapisano sprzedaż.', 'ok'); return;
      case 'dead': if (await statusDialog(cow, 'padła')) toast('Zapisano zdarzenie.', 'ok'); return;
      case 'reactivate':
        if (await confirmDlg('Przywrócić zwierzę jako aktywne?')) await db.save('cows', { ...cow, status: 'aktywna', exitDate: '' });
        return;
      case 'delete': {
        const ok = await confirmDlg(`Usunąć kartę ${cowLabel(cow)}? Zalecamy raczej zmianę statusu (sprzedana / padła) — wtedy historia zostaje w archiwum. Usunięta karta trafi do kosza na 30 dni.`,
          { danger: true, okText: 'Usuń do kosza', title: 'Usuwanie karty' });
        if (ok) { await db.softDelete('cows', cow.id); toast('Karta przeniesiona do kosza.'); navigate('/stado'); }
        return;
      }
    }
    if (act.startsWith('qa-')) { const a = quickActions.find(x => 'qa-' + x.act === act); if (a) await a.run(cow, dd); return; }
    if (act.startsWith('hb-')) { const a = cowHeadButtons.find(x => 'hb-' + x.act === act); if (a) await a.run(cow, dd); return; }
    for (const t of tabs) if (t.handle && await t.handle(act, rid, cow, dd, el)) return;
  });
  el.addEventListener('submit', async e => {
    const f = e.target.closest('[data-form="kin"]');
    if (!f) return;
    e.preventDefault();
    const dd = await db.loadAll();
    const txt = f.elements.bull.value.trim();
    const herdBull = dd.cowsByTag.get(normalizeTag(txt));
    const w = kinshipWarning(cow, { id: herdBull?.id, text: txt }, dd.cowsById, dd.cowsByTag);
    el.querySelector('[data-kin-result]').innerHTML = !txt ? '' : w
      ? `<div class="alert alert-danger">⚠️ ${esc(w)}</div>`
      : '<div class="alert alert-ok">✔ Nie wykryto pokrewieństwa (w znanym rodowodzie do 3 pokoleń).</div>';
  });
}

/** Przyciski w nagłówku karty dodawane przez inne moduły (QR, druk). */
const cowHeadButtons = [];
export function registerCowHeadButton(b) { cowHeadButtons.push(b); }

/** Przeniesienie jednej lub wielu krów do innej grupy. */
export async function moveGroupDialog(cows) {
  return formDialog({
    title: cows.length > 1 ? `Przenieś ${cows.length} zwierząt do grupy` : 'Zmień grupę / kojec',
    fields: [{ name: 'group', label: 'Nowa grupa / kojec', type: 'select', options: GROUPS, required: true }],
    values: { group: cows.length === 1 ? cows[0].group : '' },
    onSubmit: async v => {
      await db.saveMany('cows', cows.map(c => ({ ...c, group: v.group })));
      toast(`Przeniesiono do grupy „${v.group}”.`, 'ok');
    },
  });
}
