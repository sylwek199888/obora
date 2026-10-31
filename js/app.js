/**
 * app.js — START APLIKACJI
 * Ładuje motyw, otwiera bazę, rejestruje widoki (trasy) i menu,
 * odświeża ekran po zmianach danych. Każdy etap dopisuje tu swoje moduły.
 */
import * as db from './db.js';
import { route, startRouter, refresh, currentPath } from './router.js';
import { applyTheme } from './theme.js';
import { esc, debounce } from './utils.js';
import { seedIfEmpty } from './demo.js';
import { dashboardView } from './views/dashboard.js';
import { herdView } from './views/herd.js';
import { cowView } from './views/cow.js';
import { settingsView } from './views/settings.js';
import { trashView } from './views/trash.js';
import { moreView } from './views/more.js';

window.APP_VERSION = '1.0.0';

/**
 * MENU. mobile: true = pozycja w dolnym pasku na telefonie (max 4 + „Więcej”).
 * Na laptopie wszystkie pozycje są w menu bocznym.
 */
export const NAV = [
  { path: '/', icon: '🏠', label: 'Pulpit', mobile: true },
  { path: '/stado', icon: '🐄', label: 'Stado', mobile: true },
  { path: '/ustawienia', icon: '⚙️', label: 'Ustawienia' },
];

function renderNav() {
  const path = currentPath();
  const isActive = p => p === '/' ? path === '/' : path === p || path.startsWith(p + '/') || (p === '/stado' && path.startsWith('/krowa'));
  const item = n => `<a href="#${n.path}" class="nav-item ${isActive(n.path) ? 'active' : ''}" ${isActive(n.path) ? 'aria-current="page"' : ''}>
    <span class="nav-icon" aria-hidden="true">${n.icon}</span><span class="nav-label">${esc(n.label)}</span></a>`;
  document.getElementById('side-nav').innerHTML = `
    <div class="brand"><img src="icons/icon.svg" alt="" width="36" height="36"><span>Obora</span></div>
    ${NAV.map(item).join('')}
    <div id="sync-status-side" class="sync-status"></div>`;
  const mobile = NAV.filter(n => n.mobile);
  const moreActive = !mobile.some(n => isActive(n.path));
  document.getElementById('bottom-nav').innerHTML = mobile.map(item).join('') +
    `<a href="#/wiecej" class="nav-item ${moreActive ? 'active' : ''}"><span class="nav-icon" aria-hidden="true">☰</span><span class="nav-label">Więcej</span></a>`;
}

/** Rejestracja tras. name służy do stylów (body[data-route]). */
function registerRoutes() {
  route('/', dashboardView, { name: 'pulpit' });
  route('/stado', herdView, { name: 'stado' });
  route('/krowa/:id', cowView, { name: 'krowa' });
  route('/ustawienia', settingsView, { name: 'ustawienia' });
  route('/kosz', trashView, { name: 'kosz' });
  route('/wiecej', moreView, { name: 'wiecej' });
}

async function start() {
  applyTheme();
  try {
    await db.openDB();
  } catch (e) {
    document.getElementById('main').innerHTML = `<div class="card"><h2>Nie można otworzyć bazy danych</h2>
      <p>Przeglądarka blokuje zapis danych (np. tryb prywatny). Otwórz aplikację w zwykłym oknie.</p></div>`;
    return;
  }
  const name = localStorage.getItem('obora-user');
  if (name) db.setCurrentUser(name);
  await seedIfEmpty();
  await db.purgeOldTrash();
  registerRoutes();
  document.addEventListener('routechange', renderNav);

  // Odświeżanie ekranu po zmianach danych. Zmiany z synchronizacji nie
  // przerywają pisania w formularzu ani otwartego okna.
  let pending = false;
  const doRefresh = debounce(() => {
    const typing = document.activeElement && document.activeElement.closest('#main') && document.activeElement.matches('input,textarea,select');
    if (document.querySelector('.modal-backdrop') || typing) { pending = true; return; }
    pending = false;
    refresh();
  }, 150);
  db.onChange(src => { if (src === 'local' && !document.querySelector('.modal-backdrop')) { pending = false; refresh(); } else doRefresh(); });
  // po zamknięciu okna dokończ zaległe odświeżenie
  new MutationObserver(() => { if (pending && !document.querySelector('.modal-backdrop')) doRefresh(); })
    .observe(document.body, { childList: true });

  startRouter(document.getElementById('main'));
  renderNav();
  document.getElementById('app').hidden = false;
  document.getElementById('splash')?.remove();
}

start();
