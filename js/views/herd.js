/**
 * views/herd.js — LISTA STADA i SZYBKA PRACA
 * Wyszukiwanie (kolczyk, ostatnie 4 cyfry, nr wewnętrzny, imię), filtry,
 * sortowanie, kafelki, zaznaczanie wielu zwierząt i akcje grupowe.
 * Wyszukiwanie głosowe i skaner są podpinane przez registerSearchTool().
 */
import * as db from '../db.js';
import { esc, normalizeTag, plCompare, ageInMonths } from '../utils.js';
import { GROUPS, SEXES, STATUSES, STATUS_LABEL, isActive, weightStats, activeWithdrawal } from '../model.js';
import { emptyState, toast } from '../ui.js';
import { cowTile, pageHead } from './common.js';
import { cowFormDialog, moveGroupDialog } from './cow.js';
import { bulkWeightDialog } from './weights.js';
import { navigate } from '../router.js';

/** Stan filtrów — pamiętany między wejściami na listę. */
const state = { q: '', group: '', sex: '', status: 'aktywna', withdrawal: false, sort: 'number', select: false, selected: new Set() };

/** Ustawia filtry listy z zewnątrz (np. kliknięcie grupy na pulpicie). */
export function setHerdFilter(f) { Object.assign(state, { q: '', group: '', sex: '', status: 'aktywna', withdrawal: false }, f); }

/** Akcje grupowe: {act, label, run(cows)}; moduły leczenia dopisują swoje. */
const bulkActions = [
  { act: 'weigh', label: '⚖️ Ważenie', run: bulkWeightDialog },
  { act: 'move', label: '🔀 Przenieś do grupy', run: moveGroupDialog },
];
export function registerBulkAction(a) { bulkActions.push(a); }

/** Narzędzia przy polu wyszukiwania (głos, skaner): {id, label, title, available(), run(setQuery)} */
const searchTools = [];
export function registerSearchTool(t) { searchTools.push(t); }

/** Usuwa polskie znaki i wielkość liter (do wyszukiwania imion). */
const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

/** Czy zwierzę pasuje do wyszukiwanej frazy. */
export function matchesQuery(c, q) {
  if (!q) return true;
  const qn = normalizeTag(q);
  const tag = normalizeTag(c.earTag);
  if (/^\d+$/.test(qn) && qn.length <= 5 && tag.endsWith(qn)) return true; // ostatnie cyfry kolczyka
  if (qn && tag.includes(qn)) return true;
  if (c.internalNo && fold(c.internalNo) === fold(q)) return true;
  if (c.internalNo && fold(c.internalNo).includes(fold(q))) return true;
  return fold(c.name).includes(fold(q));
}

/** Znajduje zwierzę po zeskanowanym/podyktowanym tekście (kolczyk lub link). */
export function findCowByText(d, text) {
  const m = String(text).match(/#\/krowa\/([\w-]+)/);
  if (m && d.cowsById.has(m[1])) return d.cowsById.get(m[1]);
  const t = normalizeTag(text);
  if (d.cowsByTag.has(t)) return d.cowsByTag.get(t);
  const hits = d.cows.filter(c => matchesQuery(c, text));
  return hits.length === 1 ? hits[0] : null;
}

function filtered(d) {
  let list = d.cows.filter(c => matchesQuery(c, state.q));
  if (state.group) list = list.filter(c => c.group === state.group);
  if (state.sex) list = list.filter(c => c.sex === state.sex);
  if (state.status === 'aktywna') list = list.filter(isActive);
  else if (state.status === 'archiwum') list = list.filter(c => !isActive(c));
  else if (state.status) list = list.filter(c => c.status === state.status);
  if (state.withdrawal) list = list.filter(c => activeWithdrawal(d.of('treatments', c.id)).active);
  const lastKg = c => weightStats(d.of('weights', c.id)).last?.kg ?? -1;
  const sorters = {
    number: (a, b) => plCompare(a.internalNo || '~' + a.earTag, b.internalNo || '~' + b.earTag),
    tag: (a, b) => plCompare(a.earTag.slice(-4), b.earTag.slice(-4)),
    name: (a, b) => plCompare(a.name || '~', b.name || '~'),
    ageAsc: (a, b) => (b.birthDate || '').localeCompare(a.birthDate || ''),
    ageDesc: (a, b) => (a.birthDate || '').localeCompare(b.birthDate || ''),
    weightDesc: (a, b) => lastKg(b) - lastKg(a),
    weightAsc: (a, b) => lastKg(a) - lastKg(b),
  };
  return list.sort(sorters[state.sort] || sorters.number);
}

const sel = (name, opts, val, label) => `<label class="filter"><span>${label}</span><select data-filter="${name}">
  ${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;

function listHTML(d) {
  const list = filtered(d);
  state.selected.forEach(id => { if (!d.cowsById.has(id)) state.selected.delete(id); });
  return `<p class="muted count">${list.length} ${list.length === 1 ? 'zwierzę' : 'zwierząt'}${ageSummary(list)}</p>
    ${list.length ? `<div class="tiles">${list.map(c => cowTile(c, d, { selectable: state.select, selected: state.selected.has(c.id) })).join('')}</div>`
    : emptyState(d.cows.length ? 'Brak zwierząt spełniających kryteria.' : 'Stado jest puste. Dodaj pierwsze zwierzę.')}`;
}

function ageSummary(list) {
  if (!list.length) return '';
  const avg = list.reduce((s, c) => s + (ageInMonths(c.birthDate) || 0), 0) / list.length;
  return ` · średni wiek ${Math.round(avg)} mies.`;
}

function bulkBar() {
  if (!state.select) return '';
  return `<div class="bulk-bar">
    <span><b>${state.selected.size}</b> zazn.</span>
    <button class="btn btn-small" data-act="sel-all">Zaznacz wszystkie</button>
    <button class="btn btn-small" data-act="sel-none">Odznacz</button>
    <div class="bulk-actions">${bulkActions.map(a => `<button class="btn btn-primary" data-bulk="${a.act}" ${state.selected.size ? '' : 'disabled'}>${a.label}</button>`).join('')}</div>
  </div>`;
}

export async function herdView(el, params, query) {
  const d = await db.loadAll();
  if (query.q !== undefined) state.q = query.q;
  el.innerHTML = `
    ${pageHead('Stado', `<button class="btn ${state.select ? 'btn-primary' : ''}" data-act="toggle-select">☑ ${state.select ? 'Zakończ zaznaczanie' : 'Zaznacz kilka'}</button>
      <button class="btn btn-primary" data-act="add">＋ Dodaj zwierzę</button>`)}
    <div class="search-row">
      <input type="search" class="search" value="${esc(state.q)}" placeholder="Kolczyk, ostatnie 4 cyfry, numer lub imię" aria-label="Szukaj" autocomplete="off" enterkeyhint="search">
      ${searchTools.filter(t => t.available()).map(t => `<button class="btn btn-icon-big" data-tool="${t.id}" title="${esc(t.title)}" aria-label="${esc(t.title)}">${t.label}</button>`).join('')}
    </div>
    <details class="filters" ${state.group || state.sex || state.status !== 'aktywna' || state.withdrawal ? 'open' : ''}>
      <summary>Filtry i sortowanie</summary>
      <div class="filter-row">
        ${sel('group', [['', 'Wszystkie'], ...GROUPS.map(g => [g, g])], state.group, 'Grupa')}
        ${sel('sex', [['', 'Wszystkie'], ...SEXES.map(g => [g, g])], state.sex, 'Płeć')}
        ${sel('status', [['aktywna', 'Aktywne'], ['archiwum', 'Archiwum (wszystkie nieaktywne)'], ...STATUSES.filter(s => s !== 'aktywna').map(s => [s, STATUS_LABEL[s]]), ['', 'Wszystkie']], state.status, 'Status')}
        ${sel('sort', [['number', 'Numer wewn.'], ['tag', 'Ostatnie 4 cyfry kolczyka'], ['name', 'Imię'], ['ageAsc', 'Wiek: najmłodsze'], ['ageDesc', 'Wiek: najstarsze'], ['weightDesc', 'Waga: najcięższe'], ['weightAsc', 'Waga: najlżejsze']], state.sort, 'Sortuj')}
        <label class="filter filter-check"><input type="checkbox" data-filter="withdrawal" ${state.withdrawal ? 'checked' : ''}> <span>Tylko z karencją</span></label>
      </div>
    </details>
    <div data-bulk-bar>${bulkBar()}</div>
    <div data-list>${listHTML(d)}</div>`;

  const redraw = async () => {
    const dd = await db.loadAll();
    el.querySelector('[data-list]').innerHTML = listHTML(dd);
    el.querySelector('[data-bulk-bar]').innerHTML = bulkBar();
  };
  const search = el.querySelector('.search');
  search.addEventListener('input', () => { state.q = search.value; redraw(); });
  search.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    const dd = await db.loadAll();
    const list = filtered(dd);
    if (list.length === 1) navigate('/krowa/' + list[0].id);
  });
  el.addEventListener('change', e => {
    const f = e.target.dataset.filter;
    if (!f) return;
    state[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    redraw();
  });
  el.addEventListener('click', async e => {
    const tile = e.target.closest('.tile');
    if (tile && state.select) {
      e.preventDefault();
      const id = tile.dataset.id;
      state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
      tile.classList.toggle('selected');
      tile.querySelector('.tile-check').textContent = state.selected.has(id) ? '✔' : '';
      el.querySelector('[data-bulk-bar]').innerHTML = bulkBar();
      return;
    }
    const t = e.target.closest('[data-tool]');
    if (t) {
      const tool = searchTools.find(x => x.id === t.dataset.tool);
      tool.run(q => { state.q = q; search.value = q; redraw(); });
      return;
    }
    const b = e.target.closest('[data-act],[data-bulk]');
    if (!b) return;
    const dd = await db.loadAll();
    if (b.dataset.bulk) {
      const cows = [...state.selected].map(id => dd.cowsById.get(id)).filter(Boolean);
      if (!cows.length) { toast('Najpierw zaznacz zwierzęta.'); return; }
      const a = bulkActions.find(x => x.act === b.dataset.bulk);
      const res = await a.run(cows);
      if (res) { state.selected.clear(); state.select = false; redraw(); el.querySelector('[data-act="toggle-select"]').classList.remove('btn-primary'); }
      return;
    }
    switch (b.dataset.act) {
      case 'add': { const c = await cowFormDialog(); if (c) navigate('/krowa/' + c.id); break; }
      case 'toggle-select':
        state.select = !state.select;
        if (!state.select) state.selected.clear();
        b.classList.toggle('btn-primary', state.select);
        b.textContent = `☑ ${state.select ? 'Zakończ zaznaczanie' : 'Zaznacz kilka'}`;
        redraw();
        break;
      case 'sel-all': filtered(dd).forEach(c => state.selected.add(c.id)); redraw(); break;
      case 'sel-none': state.selected.clear(); redraw(); break;
    }
  });
}
