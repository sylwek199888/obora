/**
 * charts.js — WYKRESY w SVG, bez zewnętrznych bibliotek.
 * Funkcje zwracają tekst <svg>, który wstawia się do HTML.
 * Kolory pochodzą z CSS (klasy .s1, .s2, ... i zmienne --chart-*),
 * więc wykresy same dopasowują się do trybu jasnego i ciemnego.
 */
import { esc, fmtDate, fmtNum, parseISO } from './utils.js';

const W = 640; // szerokość „logiczna” — SVG skaluje się do szerokości ekranu

/** Ładne wartości podziałki osi (np. 0, 50, 100...). */
function niceTicks(min, max, count = 5) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || step0;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

/**
 * Wykres liniowy w czasie.
 * series: [{label, points:[{x:'RRRR-MM-DD', y:number, title?}]}]
 * opts: {height, unit, target:{y,label}, decimals}
 */
export function lineChart(series, opts = {}) {
  const H = opts.height || 280, pad = { l: 70, r: 16, t: 20, b: 44 };
  const all = series.flatMap(s => s.points);
  if (!all.length) return '<p class="muted">Brak danych do wykresu.</p>';
  const xs = all.map(p => parseISO(p.x).getTime());
  let ys = all.map(p => p.y);
  if (opts.target) ys = ys.concat(opts.target.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x0 === x1) { x0 -= 86400000 * 15; x1 += 86400000 * 15; }
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const sx = t => pad.l + (t - x0) / (x1 - x0) * (W - pad.l - pad.r);
  const sy = v => H - pad.b - (v - y0) / (y1 - y0 || 1) * (H - pad.t - pad.b);
  const dec = opts.decimals ?? 0;

  let g = '';
  for (const t of ticks) {
    g += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${sy(t)}" y2="${sy(t)}"/>
          <text class="axis" x="${pad.l - 6}" y="${sy(t) + 4}" text-anchor="end">${fmtNum(t, dec)}</text>`;
  }
  // etykiety osi X: 4 daty równomiernie
  for (let i = 0; i <= 3; i++) {
    const t = x0 + (x1 - x0) * i / 3;
    const d = new Date(t);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    g += `<text class="axis" x="${sx(t)}" y="${H - pad.b + 20}" text-anchor="${i === 0 ? 'start' : i === 3 ? 'end' : 'middle'}">${fmtDate(iso)}</text>`;
  }
  if (opts.target) {
    const y = sy(opts.target.y);
    g += `<line class="target" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/>
          <text class="axis target-label" x="${W - pad.r}" y="${y - 6}" text-anchor="end">${esc(opts.target.label || '')}</text>`;
  }
  series.forEach((s, i) => {
    const pts = s.points.slice().sort((a, b) => a.x.localeCompare(b.x));
    const d = pts.map((p, j) => `${j ? 'L' : 'M'}${sx(parseISO(p.x).getTime()).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
    g += `<path class="line s${i + 1}" d="${d}"/>`;
    for (const p of pts) {
      g += `<circle class="dot s${i + 1}" cx="${sx(parseISO(p.x).getTime()).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="5">
        <title>${esc(p.title || `${fmtDate(p.x)}: ${fmtNum(p.y, dec)} ${opts.unit || ''}`)}</title></circle>`;
    }
  });
  const legend = series.length > 1 ? legendHTML(series.map(s => s.label)) : '';
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title || 'Wykres')}">${g}</svg>${legend}</figure>`;
}

/**
 * Wykres słupkowy (grupowany).
 * labels: ['sty 2026', ...], series: [{label, values:[...]}]
 */
export function barChart(labels, series, opts = {}) {
  const H = opts.height || 280, pad = { l: 76, r: 12, t: 20, b: 48 };
  const vals = series.flatMap(s => s.values).filter(v => isFinite(v));
  if (!vals.length || vals.every(v => !v)) return '<p class="muted">Brak danych do wykresu.</p>';
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const sy = v => H - pad.b - (v - y0) / (y1 - y0 || 1) * (H - pad.t - pad.b);
  const slot = (W - pad.l - pad.r) / labels.length;
  const bw = Math.min(40, slot * 0.8 / series.length);
  let g = '';
  for (const t of ticks) {
    g += `<line class="grid ${t === 0 ? 'zero' : ''}" x1="${pad.l}" x2="${W - pad.r}" y1="${sy(t)}" y2="${sy(t)}"/>
          <text class="axis" x="${pad.l - 6}" y="${sy(t) + 4}" text-anchor="end">${fmtNum(t, opts.decimals ?? 0)}</text>`;
  }
  labels.forEach((lab, i) => {
    const cx = pad.l + slot * i + slot / 2;
    series.forEach((s, j) => {
      const v = s.values[i] || 0;
      const x = cx - (bw * series.length) / 2 + j * bw;
      const ya = sy(Math.max(0, v)), yb = sy(Math.min(0, v));
      g += `<rect class="bar s${j + 1} ${v < 0 ? 'neg' : ''}" x="${x.toFixed(1)}" y="${ya.toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${Math.max(0, yb - ya).toFixed(1)}" rx="2">
        <title>${esc(lab)} — ${esc(s.label)}: ${fmtNum(v, opts.decimals ?? 0)} ${esc(opts.unit || '')}</title></rect>`;
    });
    const every = Math.ceil(labels.length / 6);
    if (i % every === 0) g += `<text class="axis" x="${cx}" y="${H - pad.b + 18}" text-anchor="middle">${esc(lab)}</text>`;
  });
  const legend = series.length > 1 ? legendHTML(series.map(s => s.label)) : '';
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title || 'Wykres')}">${g}</svg>${legend}</figure>`;
}

/** Poziome słupki (np. najczęstsze choroby): items [{label, value}]. */
export function hBarChart(items, opts = {}) {
  if (!items.length) return '<p class="muted">Brak danych.</p>';
  const max = Math.max(...items.map(i => i.value)) || 1;
  return `<div class="hbars">${items.map(i => `
    <div class="hbar-row"><span class="hbar-label">${esc(i.label)}</span>
      <span class="hbar-track"><span class="hbar-fill" style="width:${(i.value / max * 100).toFixed(1)}%"></span></span>
      <span class="hbar-val">${fmtNum(i.value, opts.decimals ?? 0)}${opts.unit ? ' ' + esc(opts.unit) : ''}</span></div>`).join('')}</div>`;
}

const legendHTML = labels => `<figcaption class="legend">${labels.map((l, i) =>
  `<span><i class="sw s${i + 1}"></i>${esc(l)}</span>`).join('')}</figcaption>`;
