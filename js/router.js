/**
 * router.js — prosty router oparty na adresie po znaku # (np. #/krowa/abc).
 * Dzięki temu kod QR może zawierać link bezpośrednio do karty krowy,
 * a przycisk „wstecz” w telefonie działa naturalnie.
 */
const routes = [];
let mainEl = null;
let current = null;
let renderToken = 0;

/** Rejestruje trasę: pattern np. '/krowa/:id', view(el, params, query). */
export function route(pattern, view, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ re, keys, view, pattern, ...opts });
}

export function navigate(path) {
  if (location.hash === '#' + path) refresh();
  else location.hash = '#' + path;
}

export function currentPath() { return (location.hash.slice(1) || '/').split('?')[0]; }

/** Ponownie rysuje bieżący widok (np. po zapisie danych). Zachowuje przewinięcie. */
export async function refresh({ keepScroll = true } = {}) {
  if (!mainEl) return;
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  let match = null, params = {};
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) { match = r; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break; }
  }
  if (!match) { location.hash = '#/'; return; }
  const sameView = current && current.pattern === match.pattern && JSON.stringify(current.params) === JSON.stringify(params);
  const y = window.scrollY;
  const token = ++renderToken;
  current = { pattern: match.pattern, params };
  document.body.dataset.route = match.name || '';
  document.body.classList.toggle('print-route', !!match.print);
  try {
    // Każde rysowanie dostaje świeży kontener — dzięki temu stare
    // nasłuchiwacze zdarzeń znikają razem ze starym widokiem.
    const el = document.createElement('div');
    el.className = 'view';
    await match.view(el, params, query);
    if (token !== renderToken) return; // w międzyczasie użytkownik przeszedł dalej
    mainEl.replaceChildren(el);
  } catch (e) {
    console.error(e);
    mainEl.innerHTML = `<div class="card"><h2>Wystąpił błąd</h2><p>${String(e.message || e)}</p></div>`;
  }
  window.scrollTo(0, keepScroll && sameView ? y : 0);
  document.dispatchEvent(new CustomEvent('routechange', { detail: { path, name: match.name } }));
}

export function startRouter(el) {
  mainEl = el;
  window.addEventListener('hashchange', () => refresh());
  refresh();
}
