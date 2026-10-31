/**
 * views/calendar.js — KALENDARZ
 * Widok miesiąca: wycielenia, zasuszenia, szczepienia, wizyty weterynarza,
 * terminy zgłoszeń ARiMR, koniec karencji. Własne wydarzenia (np. wizyta
 * weterynarza) oraz eksport do kalendarza telefonu (plik .ics).
 */
import * as db from '../db.js';
import { esc, fmtDate, todayISO, toISO, parseISO, addDays, monthName, WEEKDAYS_SHORT, download } from '../utils.js';
import { EVENT_TYPES, cowLabel } from '../model.js';
import { formDialog, toast, confirmDlg } from '../ui.js';
import { pageHead } from './common.js';
import { computeTasks, registerTaskProvider } from '../tasks.js';

/** Rodzaje zadań, których nie pokazujemy w kalendarzu (zbyt częste / bez daty). */
const HIDDEN = new Set(['ważenie', 'kopia', 'pasza']);
const EVENT_ICON = { 'wizyta weterynarza': '🩺', inseminator: '🧪', 'korekcja racic': '🦶', inne: '📌' };

let month = todayISO().slice(0, 7);
let selected = todayISO();

/** Wszystkie pozycje kalendarza w zakresie dat: zadania + historia leczenia/wycieleń. */
export function calendarItems(d, from, to) {
  const today = todayISO();
  const items = computeTasks(d, from, to, { today }).filter(t => !HIDDEN.has(t.type));
  // przeszłe wpisy: leczenia (wizyty) i wycielenia
  for (const t of d.treatments) {
    if (t.date < from || t.date > to || t.date >= today) continue;
    const c = d.cowsById.get(t.cowId);
    if (c) items.push({ date: t.date, icon: '💊', kind: 'info', past: true, href: `#/krowa/${c.id}?tab=zdrowie`, title: `${t.type}: ${cowLabel(c)} — ${t.drug || ''}${t.vet ? ` (${t.vet})` : ''}` });
  }
  for (const r of d.repro) {
    if (r.type !== 'wycielenie' || r.date < from || r.date > to) continue;
    const c = d.cowsById.get(r.cowId);
    if (c) items.push({ date: r.date, icon: '🐮', kind: 'info', past: true, href: `#/krowa/${c.id}?tab=rozrod`, title: `Wycielenie (odbyte): ${cowLabel(c)}` });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

/* Własne wydarzenia jako źródło zadań (widoczne też na pulpicie). */
registerTaskProvider((d, from, to) => d.events.map(e => ({
  date: e.date, type: 'wydarzenie', icon: EVENT_ICON[e.type] || '📌', kind: 'info', eventId: e.id, href: '#/kalendarz',
  title: e.title || e.type,
})));

async function eventDialog(rec = null, date = todayISO()) {
  return formDialog({
    title: rec ? 'Edytuj wydarzenie' : 'Nowe wydarzenie',
    fields: [
      { name: 'date', label: 'Data', type: 'date', required: true, noFuture: false },
      { name: 'type', label: 'Rodzaj', type: 'select', options: EVENT_TYPES, required: true },
      { name: 'title', label: 'Opis', type: 'text', required: true, placeholder: 'np. Wizyta weterynarza — szczepienie cieląt' },
    ],
    values: rec || { date, type: 'wizyta weterynarza' },
    onSubmit: v => db.save('events', { ...(rec || {}), ...v }),
  });
}

/* ---------------- EKSPORT .ICS ---------------- */

const icsEsc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const icsDate = iso => iso.replace(/-/g, '');
/** Zawijanie linii do 75 znaków (wymóg formatu iCalendar). */
const fold = line => line.length <= 74 ? line : line.match(/.{1,73}/g).join('\r\n ');

export function buildICS(items) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Obora//Zarzadzanie stadem//PL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Obora'];
  for (const it of items) {
    const uid = `${icsDate(it.date)}-${(it.type || '')}-${(it.cowId || it.eventId || '')}-${it.title.length}@obora`.replace(/[^\w@.-]/g, '');
    lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${icsDate(it.date)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(it.date, 1))}`, fold(`SUMMARY:${icsEsc(`${it.icon || ''} ${it.title}`.trim())}`),
      'BEGIN:VALARM', 'ACTION:DISPLAY', fold(`DESCRIPTION:${icsEsc(it.title)}`), 'TRIGGER;RELATED=START:PT7H', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

async function exportICS() {
  const d = await db.loadAll();
  const t = todayISO();
  const items = calendarItems(d, t, addDays(t, 365)).filter(i => !i.past);
  download(`obora-kalendarz-${t}.ics`, buildICS(items), 'text/calendar;charset=utf-8');
  toast(`Pobrano ${items.length} terminów. Otwórz plik w telefonie, aby dodać je do kalendarza.`, 'ok', 6000);
}

/* ---------------- WIDOK ---------------- */

function dayList(items, date) {
  const list = items.filter(i => i.date === date);
  return `<section class="card"><div class="timeline-head"><h3>${fmtDate(date)}</h3>
    <button class="btn btn-small" data-act="add" data-date="${date}">＋ Wydarzenie</button></div>
    ${list.length ? `<ul class="tasks">${list.map(i => `<li class="task task-${i.kind}"><a href="${esc(i.href || '#/kalendarz')}">
      <span class="task-icon">${i.icon}</span><span class="task-text">${esc(i.title)}</span></a>
      ${i.eventId ? `<button class="btn-icon" data-act="edit-ev" data-id="${i.eventId}" aria-label="Edytuj">✎</button><button class="btn-icon" data-act="del-ev" data-id="${i.eventId}" aria-label="Usuń">🗑</button>` : ''}</li>`).join('')}</ul>`
      : '<p class="muted">Brak wydarzeń tego dnia.</p>'}</section>`;
}

export async function calendarView(el) {
  const d = await db.loadAll();
  const first = parseISO(month + '-01');
  const startOffset = (first.getDay() + 6) % 7; // poniedziałek = 0
  const gridStart = addDays(month + '-01', -startOffset);
  const gridEnd = addDays(gridStart, 41);
  const items = calendarItems(d, gridStart, gridEnd);
  const today = todayISO();
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const iso = addDays(gridStart, i);
    const its = items.filter(x => x.date === iso);
    cells += `<button class="cal-day ${iso.slice(0, 7) !== month ? 'other' : ''} ${iso === today ? 'today' : ''} ${iso === selected ? 'sel' : ''}" data-day="${iso}" aria-label="${fmtDate(iso)}, ${its.length} wydarzeń">
      <span class="cal-num">${+iso.slice(8)}</span>
      <span class="cal-dots">${its.slice(0, 6).map(x => `<span class="cal-ev" title="${esc(x.title)}">${x.icon}<span class="cal-ev-text"> ${esc(x.title.split(':')[0])}</span></span>`).join('')}${its.length > 6 ? '…' : ''}</span></button>`;
  }
  el.innerHTML = `${pageHead('Kalendarz', `<button class="btn" data-act="ics">📅 Eksport do telefonu (.ics)</button><button class="btn btn-primary" data-act="add" data-date="${selected}">＋ Wydarzenie</button>`)}
    <section class="card">
      <div class="cal-nav"><button class="btn" data-act="prev" aria-label="Poprzedni miesiąc">◀</button>
        <h2>${esc(monthName(month))}</h2><button class="btn" data-act="next" aria-label="Następny miesiąc">▶</button></div>
      <div class="cal-grid">${WEEKDAYS_SHORT.map(w => `<div class="cal-dow">${w}</div>`).join('')}${cells}</div>
      <div class="actions-row" style="margin-top:10px"><button class="btn btn-small" data-act="today">Dziś</button></div>
    </section>
    <div data-daylist>${dayList(items, selected)}</div>
    <p class="muted">🐮 wycielenie · 🥛 zasuszenie · 💉 szczepienie · 🪱 odrobaczanie · ⛔ koniec karencji · 📋 termin ARiMR · 🩺 wizyta weterynarza · 🔍 badanie cielności</p>`;

  el.addEventListener('click', async e => {
    const day = e.target.closest('[data-day]');
    if (day) {
      selected = day.dataset.day;
      el.querySelectorAll('.cal-day').forEach(x => x.classList.toggle('sel', x === day));
      el.querySelector('[data-daylist]').innerHTML = dayList(items, selected);
      if (selected.slice(0, 7) !== month) { month = selected.slice(0, 7); calendarRerender(); }
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const move = n => { const x = parseISO(month + '-01'); x.setMonth(x.getMonth() + n); month = toISO(x).slice(0, 7); selected = month + '-01'; calendarRerender(); };
    switch (b.dataset.act) {
      case 'prev': move(-1); break;
      case 'next': move(1); break;
      case 'today': month = today.slice(0, 7); selected = today; calendarRerender(); break;
      case 'ics': await exportICS(); break;
      case 'add': if (await eventDialog(null, b.dataset.date || selected)) toast('Dodano wydarzenie.', 'ok'); break;
      case 'edit-ev': await eventDialog(d.events.find(x => x.id === b.dataset.id)); break;
      case 'del-ev': if (await confirmDlg('Usunąć to wydarzenie?', { danger: true, okText: 'Usuń' })) await db.softDelete('events', b.dataset.id); break;
    }
  });
}

async function calendarRerender() { const { refresh } = await import('../router.js'); refresh({ keepScroll: true }); }
