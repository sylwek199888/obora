/**
 * views/print.js — WYDRUKI i KODY QR
 * - kod QR krowy (okno + etykiety do naklejenia na kojec),
 * - widok do druku / PDF karty krowy (przeglądarka: Drukuj → Zapisz jako PDF).
 */
import * as db from '../db.js';
import { esc, fmtDate, fmtKg, fmtNum, ageText, todayISO } from '../utils.js';
import { COW_FIELDS, cowLabel, weightStats, withdrawalEnds, activeWithdrawal, reproInfo, pedigree, isActive, isFemale } from '../model.js';
import { openModal } from '../ui.js';
import { qrSVG } from '../qr.js';
import { registerCowHeadButton, fieldValueHTML } from './cow.js';
import { registerBulkAction } from './herd.js';
import { navigate } from '../router.js';
import { getFarm } from '../farm.js';

/** Adres karty krowy — zakodowany w QR. Po zeskanowaniu otwiera aplikację na karcie. */
export const cowURL = id => `${location.origin}${location.pathname}#/krowa/${id}`;

function qrLabel(c) {
  return `<div class="qr-label">${qrSVG(cowURL(c.id), { label: c.earTag })}
    <b>${esc(c.name || '')} ${c.internalNo ? '#' + esc(c.internalNo) : ''}</b><span>${esc(c.earTag)}</span></div>`;
}

function showQR(cow) {
  openModal({
    title: `Kod QR — ${cow.name || cow.earTag}`,
    body: `<div class="qr-box">${qrSVG(cowURL(cow.id), { label: cow.earTag })}
      <div><b>${esc(cowLabel(cow))}</b></div>
      <p class="muted">Wydrukuj i naklej na kojec. Po zeskanowaniu aparatem telefonu otworzy się karta tego zwierzęcia
      (na urządzeniu, na którym aplikacja jest zainstalowana pod tym samym adresem).</p></div>`,
    footer: `<button class="btn" data-close>Zamknij</button><a class="btn btn-primary" href="#/druk/qr?ids=${esc(cow.id)}" data-close>🖨 Drukuj etykietę</a>`,
  });
}

registerCowHeadButton({ act: 'qr', label: '▦ Kod QR', run: showQR });
registerCowHeadButton({ act: 'print', label: '🖨 Drukuj', run: cow => navigate('/druk/krowa/' + cow.id) });
registerBulkAction({ act: 'qr', label: '▦ Etykiety QR', run: async cows => { navigate('/druk/qr?ids=' + cows.map(c => c.id).join(',')); return true; } });

const printBar = back => `<div class="no-print actions-row"><a class="btn" href="${back}">← Wróć</a>
  <button class="btn btn-primary" onclick="window.print()">🖨 Drukuj / zapisz PDF</button></div>`;

/** Etykiety QR (jedna lub wiele krów; bez parametru — wszystkie aktywne). */
export async function qrLabelsView(el, params, query) {
  const d = await db.loadAll();
  const ids = (query.ids || '').split(',').filter(Boolean);
  const cows = ids.length ? ids.map(id => d.cowsById.get(id)).filter(Boolean) : d.cows.filter(isActive);
  el.innerHTML = `${printBar(ids.length === 1 ? '#/krowa/' + ids[0] : '#/stado')}
    <p class="no-print muted">${cows.length} etykiet. Wytnij wzdłuż przerywanej linii i zalaminuj lub zabezpiecz taśmą.</p>
    <div class="print-page">${cows.map(qrLabel).join('')}</div>`;
}

/** Karta krowy do druku / PDF. */
export async function cowPrintView(el, { id }) {
  const d = await db.loadAll();
  const cow = d.cowsById.get(id);
  if (!cow) { el.innerHTML = '<p>Nie znaleziono zwierzęcia.</p>'; return; }
  const farm = await getFarm();
  const weights = d.of('weights', id);
  const ws = weightStats(weights, cow);
  const tr = d.of('treatments', id);
  const wd = activeWithdrawal(tr);
  const ri = isFemale(cow) ? reproInfo(d.of('repro', id)) : null;
  const ped = pedigree(cow, d.cowsById, d.cowsByTag) || {};
  const name = n => n ? (n.cow ? cowLabel(n.cow) : n.text) : '—';
  const fields = COW_FIELDS.filter(f => f.card !== false && (!f.showIf || f.showIf(cow)))
    .map(f => [f.label, fieldValueHTML(f, cow, d)]).filter(([, v]) => v);
  el.innerHTML = `${printBar('#/krowa/' + id)}
  <div class="print-page">
    <div class="print-head">
      <div>
        <h1>${esc(cow.name || 'Karta zwierzęcia')} ${cow.internalNo ? '#' + esc(cow.internalNo) : ''}</h1>
        <div class="cow-tag">${esc(cow.earTag)}</div>
        <p>${esc(cow.sex)} · ${esc(cow.breed || '')} · wiek: ${esc(ageText(cow.birthDate))}<br>
        ${farm.name ? `Gospodarstwo: ${esc(farm.name)}${farm.herdNo ? ', nr siedziby stada ' + esc(farm.herdNo) : ''}` : ''}</p>
        ${wd.active ? `<span class="flag-withdrawal">KARENCJA</span> ${wd.milk ? 'mleko do ' + fmtDate(wd.milk) : ''} ${wd.meat ? 'mięso do ' + fmtDate(wd.meat) : ''}` : ''}
      </div>
      ${cow.photo ? `<img class="print-photo" src="${esc(cow.photo)}" alt="">` : ''}
      ${qrSVG(cowURL(cow.id), { label: cow.earTag })}
    </div>
    <h2>Dane</h2>
    <dl class="print-grid">${fields.map(([k, v]) => `<div class="kv"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>
    <h2>Rodowód</h2>
    <dl class="print-grid">
      <div class="kv"><dt>Matka</dt><dd>${esc(name(ped.mother))}</dd></div><div class="kv"><dt>Ojciec</dt><dd>${esc(name(ped.father))}</dd></div>
      <div class="kv"><dt>Babka (po matce)</dt><dd>${esc(name(ped.mother?.tree?.mother))}</dd></div><div class="kv"><dt>Dziadek (po matce)</dt><dd>${esc(name(ped.mother?.tree?.father))}</dd></div>
    </dl>
    <h2>Waga</h2>
    <p>Ostatnia: <b>${ws.last ? fmtKg(ws.last.kg) + ' (' + fmtDate(ws.last.date) + ')' : '—'}</b> ·
      przyrost od początku: <b>${ws.adgTotal === null ? '—' : fmtNum(ws.adgTotal, 2) + ' kg/dzień'}</b>
      ${ws.forecast?.date ? ` · prognoza wagi docelowej: <b>${fmtDate(ws.forecast.date)}</b>` : ''}</p>
    ${weights.length ? `<table class="table"><thead><tr><th>Data</th><th>Waga</th><th>Sposób</th><th>Uwagi</th></tr></thead><tbody>
      ${weights.slice(-15).map(w => `<tr><td>${fmtDate(w.date)}</td><td>${fmtKg(w.kg, 1)}</td><td>${esc(w.method || '')}</td><td>${esc(w.note || '')}</td></tr>`).join('')}</tbody></table>` : ''}
    ${ri ? `<h2>Rozród</h2><p>Stan: <b>${esc(ri.status || '—')}</b>${ri.lastInsem ? ` · inseminacja ${fmtDate(ri.lastInsem.date)} (${esc(ri.lastInsem.bull || '')})` : ''}
      ${ri.expectedCalving ? ` · wycielenie ok. <b>${fmtDate(ri.expectedCalving)}</b> · zasuszenie ok. ${fmtDate(ri.dryOff)}` : ''} · wycieleń: ${ri.calvings}</p>` : ''}
    <h2>Leczenie i profilaktyka</h2>
    ${tr.length ? `<table class="table"><thead><tr><th>Data</th><th>Rodzaj</th><th>Rozpoznanie</th><th>Lek (seria)</th><th>Dawka</th><th>Karencja do</th><th>Lekarz</th></tr></thead><tbody>
      ${tr.slice().reverse().map(t => { const w = withdrawalEnds(t); return `<tr><td>${fmtDate(t.date)}</td><td>${esc(t.type)}</td><td>${esc(t.diagnosis || '')}</td>
        <td>${esc(t.drug || '')}${t.batch ? ' (' + esc(t.batch) + ')' : ''}</td><td>${esc(t.dose || '')} ${esc(t.route || '')}</td>
        <td>${w.milkEnd ? 'mleko ' + fmtDate(w.milkEnd) : ''} ${w.meatEnd ? 'mięso ' + fmtDate(w.meatEnd) : ''}</td><td>${esc(t.vet || '')}</td></tr>`; }).join('')}</tbody></table>` : '<p>Brak wpisów.</p>'}
    <p><small>Wydruk z aplikacji Obora, ${fmtDate(todayISO())}.</small></p>
  </div>`;
}
