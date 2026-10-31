/**
 * views/more.js — ekran „Więcej” na telefonie: wszystkie działy aplikacji
 * jako duże przyciski (wygodne w rękawiczkach).
 */
import { esc } from '../utils.js';
import { pageHead } from './common.js';

export async function moreView(el) {
  const { NAV } = await import('../app.js');
  el.innerHTML = `${pageHead('Więcej')}
    <div class="more-grid">${NAV.map(n => `<a class="more-item" href="#${n.path}"><span aria-hidden="true">${n.icon}</span>${esc(n.label)}</a>`).join('')}
    <a class="more-item" href="#/kosz"><span aria-hidden="true">🗑</span>Kosz</a></div>`;
}
