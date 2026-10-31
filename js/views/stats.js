/**
 * views/stats.js — STATYSTYKI
 * Przyrosty według grup, wskaźnik cielności, okres międzywycieleniowy,
 * najczęstsze choroby, koszty w czasie, struktura stada.
 */
import * as db from '../db.js';
import { esc, fmtNum, fmtMoney, todayISO, addDays, sum, groupBy, monthKey, monthName, lastMonths, ageInMonths, plural } from '../utils.js';
import { GROUPS, SEXES, weightStats, calvingIntervals, isActive, isFemale, cowLabel } from '../model.js';
import { barChart, hBarChart } from '../charts.js';
import { pageHead } from './common.js';
import { financeItems } from './finance.js';

/** Ujednolicenie nazw chorób („Zapalenie wymienia (mastitis), ćw. PP” -> „zapalenie wymienia”). */
const diseaseKey = s => String(s || '').toLowerCase().split(/[(,—–-]/)[0].trim();

export async function statsView(el) {
  const d = await db.loadAll();
  const today = todayISO();
  const yearAgo = addDays(today, -365);
  const active = d.cows.filter(isActive);

  // --- przyrosty wg grup
  const adgByGroup = GROUPS.map(g => {
    const vals = active.filter(c => c.group === g).map(c => { const s = weightStats(d.of('weights', c.id)); return s.adgTotal ?? s.adgLast; }).filter(v => v !== null && v !== undefined);
    return { g, n: vals.length, v: vals.length ? sum(vals) / vals.length : 0 };
  });

  // --- rozród (ostatnie 12 miesięcy)
  const repro12 = d.repro.filter(r => r.date >= yearAgo && d.cowsById.has(r.cowId));
  const tests = repro12.filter(r => r.type === 'badanie' && r.result !== 'wątpliwa');
  const positive = tests.filter(r => r.result === 'cielna').length;
  const insems = repro12.filter(r => r.type === 'inseminacja').length;
  const pregRate = tests.length ? positive / tests.length * 100 : null;
  const insemIndex = positive ? insems / positive : null;
  const intervals = d.cows.filter(isFemale).flatMap(c => calvingIntervals(d.of('repro', c.id)).map(v => ({ c, v })));
  const avgInterval = intervals.length ? sum(intervals, x => x.v) / intervals.length : null;
  const calvings12 = repro12.filter(r => r.type === 'wycielenie');

  // --- choroby
  const dis = [...groupBy(d.treatments.filter(t => t.type === 'leczenie' && d.cowsById.has(t.cowId)), t => diseaseKey(t.diagnosis))]
    .map(([k, l]) => ({ label: k || 'bez rozpoznania', value: l.length })).sort((a, b) => b.value - a.value).slice(0, 8);

  // --- koszty w czasie
  const months = lastMonths(12);
  const items = financeItems(d);
  const costCat = c => c === 'pasza' ? 'Pasza' : (c === 'leki' || c === 'weterynarz') ? 'Leki i weterynarz' : 'Pozostałe';
  const byM = groupBy(items.filter(i => i.kind === 'koszt'), i => monthKey(i.date));
  const series = ['Pasza', 'Leki i weterynarz', 'Pozostałe'].map(label => ({
    label, values: months.map(m => sum((byM.get(m) || []).filter(i => costCat(i.category) === label), i => i.amount)),
  }));

  // --- struktura i wagi
  const sexCount = SEXES.map(s => ({ label: s, value: active.filter(c => c.sex === s).length })).filter(x => x.value);
  const ages = active.map(c => ageInMonths(c.birthDate) || 0);
  const lastWeights = active.map(c => weightStats(d.of('weights', c.id)).last?.kg).filter(Boolean);

  const stat = (label, val, sub = '') => `<div class="stat"><span>${label}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  el.innerHTML = `${pageHead('Statystyki')}
    <div class="stats-grid">
      ${stat('Aktywne zwierzęta', active.length, `średni wiek ${ages.length ? Math.round(sum(ages) / ages.length) : 0} mies.`)}
      ${stat('Średnia waga', lastWeights.length ? fmtNum(sum(lastWeights) / lastWeights.length) + ' kg' : '—', `z ${lastWeights.length} zważonych`)}
      ${stat('Wskaźnik cielności', pregRate === null ? '—' : fmtNum(pregRate) + ' %', `${positive} cielnych / ${tests.length} badań (12 mies.)`)}
      ${stat('Indeks inseminacji', insemIndex === null ? '—' : fmtNum(insemIndex, 1), 'inseminacji na 1 ciążę (cel < 2)')}
      ${stat('Okres międzywycieleniowy', avgInterval === null ? '—' : fmtNum(avgInterval) + ' dni', 'średnio (cel ok. 365–400)')}
      ${stat('Wycielenia (12 mies.)', calvings12.length, (h => `${h} ${plural(h, 'jałówka', 'jałówki', 'jałówek')}`)(calvings12.filter(c => c.calfSex === 'jałówka').length) + ', ' + (b => `${b} ${plural(b, 'byczek', 'byczki', 'byczków')}`)(calvings12.filter(c => c.calfSex === 'byczek').length))}
    </div>
    <div class="dash-grid">
      <section class="card"><h2>Średni przyrost dzienny wg grup</h2>
        ${barChart(adgByGroup.map(x => `${x.g} (${x.n})`), [{ label: 'kg/dzień', values: adgByGroup.map(x => +x.v.toFixed(2)) }], { unit: 'kg/dzień', decimals: 2, height: 230 })}</section>
      <section class="card"><h2>Najczęstsze choroby</h2>${hBarChart(dis, { unit: 'przyp.' })}</section>
      <section class="card"><h2>Koszty w czasie (12 mies.)</h2>${barChart(months.map(m => monthName(m, true)), series, { unit: 'zł', height: 240 })}</section>
      <section class="card"><h2>Struktura stada</h2>${hBarChart(sexCount, { unit: 'szt.' })}
        <h3 style="margin-top:14px">Wg grup</h3>${hBarChart(GROUPS.map(g => ({ label: g, value: active.filter(c => c.group === g).length })).filter(x => x.value), { unit: 'szt.' })}</section>
    </div>
    ${intervals.length ? `<section class="card"><h2>Okresy międzywycieleniowe</h2><div class="table-wrap"><table class="table">
      <thead><tr><th>Krowa</th><th class="num">Okres (dni)</th></tr></thead><tbody>
      ${intervals.map(x => `<tr><td><a href="#/krowa/${esc(x.c.id)}?tab=rozrod">${esc(cowLabel(x.c))}</a></td><td class="num ${x.v > 420 ? 'neg' : ''}">${x.v}</td></tr>`).join('')}
      </tbody></table></div></section>` : ''}
    <p class="muted">Koszty łącznie (12 mies.): ${fmtMoney(sum(series.flatMap(s => s.values)))}.</p>`;
}
