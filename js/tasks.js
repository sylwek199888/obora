/**
 * tasks.js — ZADANIA I TERMINY
 * Jedno miejsce, które z danych wylicza wszystko, co trzeba zrobić:
 * wycielenia, zasuszenia, szczepienia, koniec karencji, terminy ARiMR,
 * ważenia, stan paszy, kopia zapasowa. Korzystają z tego: pulpit,
 * kalendarz, eksport .ics i powiadomienia.
 *
 * Moduły dopisują swoje „źródła zadań” przez registerTaskProvider(fn),
 * gdzie fn(d, from, to, today) zwraca listę:
 *   {date, type, icon, title, cowId?, href?, kind: 'danger'|'warn'|'info', overdue?}
 */
import { todayISO, addDays, daysBetween } from './utils.js';
import { cowLabel, isActive, weightStats, WEIGH_REMINDER_DAYS } from './model.js';

const providers = [];
export function registerTaskProvider(fn) { providers.push(fn); }

/** Zadania z zakresu dat [from, to]. Zaległe (przed from) dołączane, gdy includeOverdue. */
export function computeTasks(d, from, to, { includeOverdue = false, today = todayISO() } = {}) {
  const out = [];
  for (const p of providers) {
    try { out.push(...p(d, from, to, today)); } catch (e) { console.error('Błąd źródła zadań', e); }
  }
  return out
    .filter(t => (t.date >= from && t.date <= to) || (includeOverdue && t.overdue && t.date < from))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'danger' ? -1 : 1));
}

/** Zadania „na dziś” (z zaległymi) i „w tym tygodniu” (następne 7 dni). */
export function todayAndWeek(d, today = todayISO()) {
  const all = computeTasks(d, today, addDays(today, 7), { includeOverdue: true, today });
  return {
    today: all.filter(t => t.date <= today),
    week: all.filter(t => t.date > today),
  };
}

/* ---- Źródło: ważenia (krowa nieważona od ponad 30 dni) ---- */
registerTaskProvider((d, from, to, today) => {
  const out = [];
  for (const c of d.cows.filter(isActive)) {
    const st = weightStats(d.of('weights', c.id), null, today);
    if (st.last && st.daysSinceLast <= WEIGH_REMINDER_DAYS) {
      // przypomnienie w dniu, gdy minie 30 dni od ostatniego ważenia
      const due = addDays(st.last.date, WEIGH_REMINDER_DAYS + 1);
      out.push({ date: due, type: 'ważenie', icon: '⚖️', title: `Zważ: ${cowLabel(c)}`, cowId: c.id, href: `#/krowa/${c.id}?tab=waga`, kind: 'info' });
    } else {
      const days = st.last ? st.daysSinceLast : null;
      out.push({ date: today, type: 'ważenie', icon: '⚖️', overdue: true,
        title: `Zważ: ${cowLabel(c)} (${days === null ? 'brak ważeń' : `nieważona ${days} dni`})`,
        cowId: c.id, href: `#/krowa/${c.id}?tab=waga`, kind: 'info' });
    }
  }
  return out;
});

/** Liczba dni do terminu jako tekst. */
export function dueText(date, today = todayISO()) {
  const n = daysBetween(today, date);
  if (n === 0) return 'dziś';
  if (n === 1) return 'jutro';
  if (n === -1) return 'wczoraj';
  return n > 0 ? `za ${n} dni` : `${-n} dni temu`;
}
