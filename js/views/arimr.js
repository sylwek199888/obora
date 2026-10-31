/**
 * views/arimr.js — ZGŁOSZENIA DO ARiMR (IRZplus)
 * Rejestr zdarzeń wymagających zgłoszenia (urodzenie, zakup, sprzedaż,
 * padnięcie, ubój) z terminem 7 dni, znacznikiem „zgłoszone/niezgłoszone”,
 * ostrzeżeniami i czytelną tabelą do przepisania w IRZplus.
 */
import * as db from '../db.js';
import { esc, fmtDate, todayISO, plural } from '../utils.js';
import { arimrEvents, cowLabel, ARIMR_DAYS } from '../model.js';
import { toast, emptyState, confirmDlg } from '../ui.js';
import { pageHead } from './common.js';
import { registerTaskProvider } from '../tasks.js';
import { registerCSV } from '../backup.js';
import { registerNewCowField } from './cow.js';
import { getFarm } from '../farm.js';
import { refresh } from '../router.js';

const KIND_ICON = { urodzenie: '🐣', zakup: '🛒', 'sprzedaż': '💰', 'padnięcie': '✝', 'ubój': '🔪' };
let filter = 'niezgłoszone';

/** Dane potrzebne do zgłoszenia — w zależności od rodzaju zdarzenia. */
function details(ev, d) {
  const c = ev.cow;
  const mother = c.motherId ? d.cowsById.get(c.motherId) : null;
  switch (ev.kind) {
    case 'urodzenie': return `matka: ${esc(mother?.earTag || c.motherText || '?')}; płeć: ${esc(c.sex === 'cielę' ? (c.gender || '?') : c.sex)}; rasa: ${esc(c.breed || '?')}`;
    case 'zakup': return `od: ${esc(c.purchaseFrom || '?')}; ur. ${fmtDate(c.birthDate)}`;
    case 'sprzedaż': return `nabywca: ${esc(c.buyer || '?')}`;
    default: return `przyczyna: ${esc(c.exitCause || '?')}`;
  }
}

function statusHTML(ev) {
  if (ev.reported) return `<span class="badge badge-ok">✔ zgłoszone${ev.reportedDate ? ' ' + fmtDate(ev.reportedDate) : ''}</span>`;
  if (ev.daysLeft < 0) return `<span class="badge badge-danger">PO TERMINIE (${-ev.daysLeft} dni)</span>`;
  return `<span class="badge badge-warn">niezgłoszone — zostało ${ev.daysLeft} ${plural(ev.daysLeft, 'dzień', 'dni', 'dni')}</span>`;
}

function table(list, d, print = false) {
  return `<div class="table-wrap"><table class="table"><thead><tr>${print ? '<th>Lp.</th>' : ''}<th>Zdarzenie</th><th>Data zdarzenia</th><th>Nr kolczyka</th>
    <th>Zwierzę</th><th>Dane do zgłoszenia</th><th>Termin</th><th>Status</th>${print ? '' : '<th></th>'}</tr></thead>
    <tbody>${list.map((ev, i) => `<tr class="${!ev.reported && ev.daysLeft < 0 ? 'row-danger' : !ev.reported && ev.daysLeft <= 2 ? 'row-warn' : ''}">
      ${print ? `<td>${i + 1}</td>` : ''}<td>${KIND_ICON[ev.kind]} <b>${esc(ev.kind)}</b></td><td>${fmtDate(ev.date)}</td>
      <td><b>${esc(ev.cow.earTag)}</b></td><td>${print ? esc(ev.cow.name || '') : `<a href="#/krowa/${esc(ev.cowId)}">${esc(cowLabel(ev.cow))}</a>`}</td>
      <td><small>${details(ev, d)}</small></td><td>${fmtDate(ev.deadline)}</td><td>${statusHTML(ev)}</td>
      ${print ? '' : `<td><button class="btn ${ev.reported ? 'btn-ghost' : 'btn-primary'} btn-small" data-toggle="${esc(ev.id)}">${ev.reported ? 'Cofnij' : '✔ Zgłoszone'}</button></td>`}</tr>`).join('')}
    </tbody></table></div>`;
}

export async function arimrView(el, params, query) {
  const d = await db.loadAll();
  const all = arimrEvents(d.cows, d.arimr);
  const pending = all.filter(e => !e.reported);
  const list = filter === 'niezgłoszone' ? pending : all;
  if (query.druk === '1') {
    const farm = await getFarm();
    el.innerHTML = `<div class="no-print actions-row"><a class="btn" href="#/arimr">← Wróć</a><button class="btn btn-primary" data-print>🖨 Drukuj</button></div>
      <div class="print-page"><h1>Zdarzenia do zgłoszenia w IRZplus</h1>
      <p>Gospodarstwo: <b>${esc(farm.name || '')}</b> · Nr producenta: <b>${esc(farm.producerNo || '…………')}</b> · Nr siedziby stada: <b>${esc(farm.herdNo || '…………')}</b> · stan na ${fmtDate(todayISO())}</p>
      ${table(list, d, true)}</div>`;
    el.querySelector('[data-print]').addEventListener('click', () => window.print());
    return;
  }
  const overdue = pending.filter(e => e.daysLeft < 0).length;
  el.innerHTML = `${pageHead('Zgłoszenia ARiMR', `<a class="btn" href="#/arimr?druk=1">🖨 Tabela do przepisania</a>`,
      `Termin zgłoszenia: ${ARIMR_DAYS} dni od zdarzenia. Zgłoszenia składasz w portalu IRZplus, a tutaj tylko oznaczasz je jako wykonane.`)}
    ${overdue ? `<div class="alert alert-danger">⚠️ ${overdue} ${plural(overdue, 'zdarzenie jest', 'zdarzenia są', 'zdarzeń jest')} po terminie zgłoszenia!</div>` : ''}
    <div class="seg"><button class="seg-btn ${filter === 'niezgłoszone' ? 'active' : ''}" data-filter="niezgłoszone">Niezgłoszone (${pending.length})</button>
      <button class="seg-btn ${filter === 'wszystkie' ? 'active' : ''}" data-filter="wszystkie">Wszystkie (${all.length})</button></div>
    ${pending.length > 1 && filter === 'niezgłoszone' ? '<div class="actions-row"><button class="btn" data-act="all">✔ Oznacz wszystkie jako zgłoszone</button></div>' : ''}
    ${list.length ? table(list, d) : emptyState(filter === 'niezgłoszone' ? 'Wszystko zgłoszone. 👍' : 'Brak zdarzeń.')}
    <p class="muted"><a href="https://irz.arimr.gov.pl" target="_blank" rel="noopener">Otwórz IRZplus ↗</a></p>`;
  el.addEventListener('click', async e => {
    const f = e.target.closest('[data-filter]');
    if (f) { filter = f.dataset.filter; refresh(); return; }
    const t = e.target.closest('[data-toggle]');
    if (t) {
      const ev = all.find(x => x.id === t.dataset.toggle);
      const ex = d.arimr.find(r => r.id === ev.id) || { id: ev.id };
      await db.save('arimr', { ...ex, reported: !ev.reported, reportedDate: ev.reported ? null : todayISO() });
      toast(ev.reported ? 'Cofnięto oznaczenie.' : 'Oznaczono jako zgłoszone.', 'ok');
      return;
    }
    if (e.target.closest('[data-act="all"]') && await confirmDlg(`Oznaczyć ${pending.length} zdarzeń jako zgłoszone w IRZplus?`)) {
      await db.saveMany('arimr', pending.map(ev => ({ ...(d.arimr.find(r => r.id === ev.id) || { id: ev.id }), reported: true, reportedDate: todayISO() })));
    }
  });
}

/* Zadania: terminy zgłoszeń. */
registerTaskProvider((d, from, to, today) => arimrEvents(d.cows, d.arimr, today).filter(e => !e.reported).map(e => ({
  date: e.deadline, type: 'arimr', icon: '📋', kind: e.daysLeft <= 2 ? 'danger' : 'warn', overdue: e.daysLeft < 0, cowId: e.cowId, href: '#/arimr',
  title: `ARiMR: zgłoś ${e.kind} — ${cowLabel(e.cow)}${e.daysLeft < 0 ? ' (PO TERMINIE)' : ''}`,
})));

/* Przy dodawaniu zwierzęcia z wcześniejszą historią — możliwość oznaczenia zdarzeń jako już zgłoszonych. */
registerNewCowField(
  { name: 'arimrDone', label: 'Urodzenie / zakup tego zwierzęcia jest już zgłoszone w IRZplus', type: 'checkbox',
    help: 'Zaznacz przy wpisywaniu zwierząt, które już są w stadzie od dawna.' },
  async (cow, extra) => {
    if (!extra.arimrDone) return;
    const evs = arimrEvents([cow], []);
    await db.saveMany('arimr', evs.map(ev => ({ id: ev.id, reported: true, reportedDate: todayISO() })));
  },
);

registerCSV({ id: 'arimr', label: 'Zdarzenia ARiMR', build: d => ({
  rows: arimrEvents(d.cows, d.arimr),
  columns: [{ label: 'Zdarzenie', get: r => r.kind }, { label: 'Data', get: r => fmtDate(r.date) }, { label: 'Nr kolczyka', get: r => r.cow.earTag },
    { label: 'Zwierzę', get: r => cowLabel(r.cow) }, { label: 'Termin', get: r => fmtDate(r.deadline) },
    { label: 'Zgłoszone', get: r => r.reported ? 'tak' : 'nie' }, { label: 'Data zgłoszenia', get: r => r.reportedDate ? fmtDate(r.reportedDate) : '' }],
}) });
