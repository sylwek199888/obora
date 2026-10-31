/**
 * views/dashboard.js — PULPIT (ekran główny)
 * Liczba zwierząt wg grup i statusów, „Do zrobienia dziś / w tym tygodniu”
 * oraz panele dopisywane przez inne moduły (karencje, magazyn pasz...).
 */
import * as db from '../db.js';
import { esc, fmtDate, todayISO, groupBy } from '../utils.js';
import { GROUPS, STATUSES, STATUS_LABEL, isActive } from '../model.js';
import { todayAndWeek, dueText } from '../tasks.js';
import { daysSinceBackup, BACKUP_REMIND_DAYS, refreshBackupState } from '../backup.js';
import { pageHead } from './common.js';
import { cowFormDialog } from './cow.js';
import { navigate } from '../router.js';

const panels = [];
/** panel = {order, render(d, today) -> html (pusty = brak)} */
export function registerDashPanel(p) { panels.push(p); panels.sort((a, b) => a.order - b.order); }

const taskItem = (t, today) => `<li class="task task-${t.kind}">
  <a href="${esc(t.href || '#/kalendarz')}"><span class="task-icon" aria-hidden="true">${t.icon}</span>
  <span class="task-text">${esc(t.title)}</span>
  <span class="task-date">${t.date < today ? `<b class="neg">zaległe</b>` : esc(dueText(t.date, today))}<br><small>${fmtDate(t.date)}</small></span></a></li>`;

/** Lista zadań z możliwością zwinięcia długiej listy. */
function taskList(list, today, limit = 8) {
  if (!list.length) return '<p class="muted">Brak zadań. 👍</p>';
  const head = list.slice(0, limit), rest = list.slice(limit);
  return `<ul class="tasks">${head.map(t => taskItem(t, today)).join('')}</ul>
    ${rest.length ? `<details><summary>Pokaż jeszcze ${rest.length}</summary><ul class="tasks">${rest.map(t => taskItem(t, today)).join('')}</ul></details>` : ''}`;
}

export async function dashboardView(el) {
  await refreshBackupState();
  const d = await db.loadAll();
  const today = todayISO();
  const active = d.cows.filter(isActive);
  const byGroup = groupBy(active, c => c.group || 'bez grupy');
  const byStatus = groupBy(d.cows, c => c.status || 'aktywna');
  const { today: tToday, week } = todayAndWeek(d, today);
  const bDays = await daysSinceBackup();
  const demo = d.cows.some(c => c.demo);

  el.innerHTML = `
    ${pageHead('Pulpit', `<button class="btn btn-primary" data-act="add">＋ Dodaj zwierzę</button>`, esc(new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })))}
    ${demo ? `<div class="alert alert-info">To są <b>dane demonstracyjne</b> (5 przykładowych zwierząt). Gdy zaczniesz wpisywać swoje stado — usuń je.
      <button class="btn btn-small" data-act="remove-demo">Usuń dane demo</button></div>` : ''}
    ${d.cows.length && (bDays === null || bDays >= BACKUP_REMIND_DAYS) ? `<div class="alert alert-warn">💾 ${bDays === null ? 'Nie zrobiono jeszcze kopii zapasowej.' : `Ostatnia kopia zapasowa: ${bDays} dni temu.`}
      <button class="btn btn-small" data-act="backup">Zrób kopię teraz</button></div>` : ''}
    <section class="counts">
      <a class="count-card big" href="#/stado"><b>${active.length}</b><span>aktywnych zwierząt</span></a>
      ${GROUPS.map(g => `<a class="count-card" href="#/stado" data-group="${esc(g)}"><b>${(byGroup.get(g) || []).length}</b><span>${esc(g)}</span></a>`).join('')}
    </section>
    <p class="muted status-line">${STATUSES.filter(s => s !== 'aktywna').map(s => `${STATUS_LABEL[s]}: <b>${(byStatus.get(s) || []).length}</b>`).join(' · ')}</p>
    <div class="dash-grid">
      <section class="card"><h2>Do zrobienia dziś <span class="pill">${tToday.length}</span></h2>${taskList(tToday, today)}</section>
      <section class="card"><h2>W tym tygodniu <span class="pill">${week.length}</span></h2>${taskList(week, today)}</section>
      ${panels.map(p => p.render(d, today)).filter(Boolean).join('')}
    </div>`;

  el.addEventListener('click', async e => {
    const g = e.target.closest('[data-group]');
    if (g) {
      e.preventDefault();
      const { setHerdFilter } = await import('./herd.js');
      setHerdFilter({ group: g.dataset.group });
      navigate('/stado');
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'add') { const c = await cowFormDialog(); if (c) navigate('/krowa/' + c.id); }
    if (b.dataset.act === 'backup') { const { exportBackup } = await import('../backup.js'); await exportBackup(); navigate('/'); }
    if (b.dataset.act === 'remove-demo') { const { removeDemo } = await import('../demo.js'); await removeDemo(); }
  });
}
