/**
 * views/trash.js — KOSZ: usunięte wpisy można przywrócić przez 30 dni.
 * Po 30 dniach są trwale usuwane (przy starcie aplikacji).
 */
import * as db from '../db.js';
import { esc, fmtDate, fmtDateTime, daysBetween, todayISO } from '../utils.js';
import { STORES, STORE_NAMES, TRASH_DAYS, cowLabel } from '../model.js';
import { toast, confirmDlg, emptyState } from '../ui.js';
import { pageHead } from './common.js';

/** Krótki opis usuniętego wpisu. */
function describe(store, r, cowsAll) {
  const cow = r.cowId ? cowsAll.get(r.cowId) : null;
  const who = cow ? ` — ${cowLabel(cow)}` : '';
  switch (store) {
    case 'cows': return cowLabel(r);
    case 'weights': return `${fmtDate(r.date)}: ${r.kg} kg${who}`;
    case 'notes': return `${fmtDate(r.date)}: ${String(r.text || '').slice(0, 60)}${who}`;
    case 'treatments': return `${fmtDate(r.date)}: ${r.type || ''} ${r.drug || ''} ${r.diagnosis || ''}${who}`;
    case 'repro': return `${fmtDate(r.date)}: ${r.type}${who}`;
    case 'finance': return `${fmtDate(r.date)}: ${r.category} ${r.amount} zł`;
    case 'feeds': return r.name;
    default: return `${r.date ? fmtDate(r.date) + ': ' : ''}${r.name || r.title || r.type || r.category || r.id}${who}`;
  }
}

export async function trashView(el) {
  const all = [];
  const cowsAll = new Map((await db.getAll('cows', { withDeleted: true })).map(c => [c.id, c]));
  for (const s of STORE_NAMES) {
    for (const r of await db.getAll(s, { withDeleted: true })) {
      if (r.deletedAt && daysBetween(r.deletedAt.slice(0, 10), todayISO()) <= TRASH_DAYS) all.push({ store: s, r });
    }
  }
  all.sort((a, b) => b.r.deletedAt.localeCompare(a.r.deletedAt));
  el.innerHTML = `${pageHead('Kosz', '', `Usunięte wpisy są przechowywane ${TRASH_DAYS} dni, potem znikają na stałe.`)}
    ${all.length ? `<ul class="trash-list">${all.map(({ store, r }) => {
      const left = TRASH_DAYS - daysBetween(r.deletedAt.slice(0, 10), todayISO());
      return `<li class="card trash-item">
        <div><span class="badge">${esc(STORES[store].label)}</span> <b>${esc(describe(store, r, cowsAll))}</b><br>
        <small class="muted">usunięto ${fmtDateTime(r.deletedAt)} przez ${esc(r.updatedBy || '?')} · zostało ${left} dni</small></div>
        <div class="row-actions"><button class="btn" data-restore="${store}|${r.id}">↩ Przywróć</button>
        <button class="btn btn-ghost" data-purge="${store}|${r.id}">Usuń na stałe</button></div></li>`;
    }).join('')}</ul>` : emptyState('Kosz jest pusty.')}`;

  el.addEventListener('click', async e => {
    const rb = e.target.closest('[data-restore]');
    if (rb) {
      const [s, id] = rb.dataset.restore.split('|');
      await db.restore(s, id);
      toast('Przywrócono.', 'ok');
      return;
    }
    const pb = e.target.closest('[data-purge]');
    if (pb && await confirmDlg('Usunąć ten wpis na zawsze? Tego nie da się cofnąć.', { danger: true, okText: 'Usuń na stałe' })) {
      const [s, id] = pb.dataset.purge.split('|');
      // pozostawiamy „nagrobek” (deletedAt), żeby inne urządzenia też go usunęły; lokalnie znika z kosza
      const r = await db.get(s, id);
      await db.save(s, { ...r, deletedAt: '1970-01-01T00:00:00.000Z' });
      toast('Usunięto na stałe.');
    }
  });
}
