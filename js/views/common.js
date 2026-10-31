/**
 * views/common.js — elementy wspólne dla wielu widoków:
 * kafelek zwierzęcia, ikony alertów, nagłówek strony.
 */
import { esc, ageText, fmtKg, fmtDate, todayISO, daysBetween } from '../utils.js';
import { weightStats, activeWithdrawal, reproInfo, isActive, tagLast4, WEIGH_REMINDER_DAYS, STATUS_LABEL } from '../model.js';

/** Ikona zwierzęcia, gdy nie ma zdjęcia. */
export const COW_ICON = `<svg viewBox="0 0 64 64" aria-hidden="true" class="cow-icon"><path fill="currentColor" opacity=".6" d="M19 15C15 10 16 5 21 2c-1 4 0 8 4 11zM45 15c4-5 3-10-2-13 1 4 0 8-4 11z"/><path fill="currentColor" d="M14 14c-5 0-9 3-10 7 3 1 6 1 9 0l2 3c-1 2-2 5-2 8 0 9 6 18 19 18s19-9 19-18c0-3-1-6-2-8l2-3c3 1 6 1 9 0-1-4-5-7-10-7-2 0-4 1-5 2-4-2-8-3-13-3s-9 1-13 3c-1-1-3-2-5-2zm8 14a3 3 0 110 6 3 3 0 010-6zm20 0a3 3 0 110 6 3 3 0 010-6zM24 42h16c2 0 4 2 4 4s-2 4-4 4H24c-2 0-4-2-4-4s2-4 4-4zm2 3a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm12 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z"/></svg>`;

/**
 * Alerty zwierzęcia (karencja, spadek wagi, brak ważenia, wycielenie...).
 * Zwraca [{icon, text, kind}] — kind: danger | warn | info.
 */
export function cowAlerts(c, d, today = todayISO()) {
  const out = [];
  const wd = activeWithdrawal(d.of('treatments', c.id), today);
  if (wd.active) {
    const parts = [];
    if (wd.milk) parts.push(`mleko do ${fmtDate(wd.milk)}`);
    if (wd.meat) parts.push(`mięso do ${fmtDate(wd.meat)}`);
    out.push({ icon: '⛔', text: `KARENCJA: ${parts.join(', ')}`, kind: 'danger', key: 'karencja' });
  }
  if (isActive(c)) {
    const ws = weightStats(d.of('weights', c.id), c, today);
    if (ws.dropped) out.push({ icon: '📉', text: `Spadek wagi o ${fmtKg(ws.dropKg, 1)}`, kind: 'warn', key: 'spadek' });
    if (!ws.last || ws.daysSinceLast > WEIGH_REMINDER_DAYS) {
      out.push({ icon: '⚖️', text: ws.last ? `Nieważona od ${ws.daysSinceLast} dni` : 'Brak ważeń', kind: 'info', key: 'wazenie' });
    }
    const ri = reproInfo(d.of('repro', c.id), today);
    if (ri.expectedCalving) {
      const days = daysBetween(today, ri.expectedCalving);
      if (days <= 14 && days >= -7) out.push({ icon: '🐄', text: `Wycielenie ${fmtDate(ri.expectedCalving)}`, kind: 'warn', key: 'wycielenie' });
    }
    if (ri.dryOff && !ri.dried) {
      const days = daysBetween(today, ri.dryOff);
      if (days <= 7 && days >= -14) out.push({ icon: '🥛', text: `Zasuszenie ${fmtDate(ri.dryOff)}`, kind: 'info', key: 'zasuszenie' });
    }
  }
  return out;
}

/** Miniatura zdjęcia lub ikona. */
export const cowPhoto = (c, cls = 'tile-photo') => c.photo
  ? `<img class="${cls}" src="${esc(c.photo)}" alt="" loading="lazy">`
  : `<div class="${cls} no-photo">${COW_ICON}</div>`;

/** Kafelek zwierzęcia na liście stada. */
export function cowTile(c, d, { selectable = false, selected = false } = {}) {
  const alerts = cowAlerts(c, d);
  const ws = weightStats(d.of('weights', c.id));
  const wd = alerts.find(a => a.key === 'karencja');
  return `<a class="tile ${wd ? 'tile-withdrawal' : ''} ${selected ? 'selected' : ''}" href="#/krowa/${esc(c.id)}" data-id="${esc(c.id)}">
    ${selectable ? `<span class="tile-check" aria-hidden="true">${selected ? '✔' : ''}</span>` : ''}
    ${cowPhoto(c)}
    <div class="tile-body">
      <div class="tile-title">${esc(c.name || 'bez imienia')}${c.internalNo ? ` <span class="tile-no">#${esc(c.internalNo)}</span>` : ''}</div>
      <div class="tile-tag">${esc(c.earTag.slice(0, -4))}<b>${esc(tagLast4(c.earTag))}</b></div>
      <div class="tile-meta">${esc(c.sex)} · ${esc(ageText(c.birthDate))} · ${ws.last ? fmtKg(ws.last.kg) : 'brak wagi'}</div>
      <div class="tile-meta">${esc(c.group || '')}${!isActive(c) ? ` · <b>${esc(STATUS_LABEL[c.status])}</b>` : ''}</div>
      ${wd ? '<span class="flag-withdrawal">KARENCJA</span>' : ''}
      <div class="tile-alerts">${alerts.filter(a => a.key !== 'karencja').map(a => `<span title="${esc(a.text)}" aria-label="${esc(a.text)}">${a.icon}</span>`).join('')}</div>
    </div>
  </a>`;
}

/** Nagłówek strony z przyciskami po prawej. */
export const pageHead = (title, actions = '', sub = '') => `<header class="page-head">
  <div><h1>${esc(title)}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div>
  <div class="page-actions">${actions}</div></header>`;

/** Kto i kiedy dodał/zmienił wpis — do wyświetlania pod wpisami. */
export const auditLine = r => `<small class="audit">dodał(a): ${esc(r.createdBy || '?')}, ${esc(new Date(r.createdAt).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }))}${r.updatedAt && r.updatedAt !== r.createdAt ? ` · zmiana: ${esc(r.updatedBy || '?')}` : ''}</small>`;
