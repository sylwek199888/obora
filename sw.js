/**
 * sw.js — SERVICE WORKER: praca offline.
 * Przy instalacji zapisuje wszystkie pliki aplikacji w pamięci (cache).
 * Potem: najpierw odpowiedź z pamięci (szybko, bez internetu),
 * a w tle pobiera nowszą wersję pliku na następne uruchomienie.
 * Zapytania do Supabase (synchronizacja) nie są zapisywane w pamięci.
 * Po zmianie plików aplikacji zwiększ VERSION.
 */
const VERSION = 'obora-v1.0.0';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'js/app.js', 'js/utils.js', 'js/model.js', 'js/db.js', 'js/ui.js', 'js/router.js', 'js/charts.js', 'js/tasks.js',
  'js/backup.js', 'js/theme.js', 'js/demo.js', 'js/farm.js', 'js/qr.js', 'js/scanner.js', 'js/notify.js', 'js/pwa.js', 'js/sync.js',
  'js/views/common.js', 'js/views/dashboard.js', 'js/views/herd.js', 'js/views/cow.js', 'js/views/weights.js',
  'js/views/settings.js', 'js/views/trash.js', 'js/views/more.js', 'js/views/health.js', 'js/views/repro.js',
  'js/views/feed.js', 'js/views/finance.js', 'js/views/arimr.js', 'js/views/calendar.js', 'js/views/stats.js',
  'js/views/print.js', 'js/views/search-tools.js', 'js/views/sync-view.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // Supabase i inne — zawsze przez sieć
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const key = req.mode === 'navigate' ? 'index.html' : req;
    const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    const network = fetch(req).then(res => {
      if (res && res.ok) cache.put(key, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(network); return cached; }
    return (await network) || new Response('Brak połączenia', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});

// kliknięcie w powiadomienie otwiera aplikację
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './#/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) { c.postMessage({ navigate: target.replace(/^\.\//, '').replace(/^[^#]*/, '') }); return c.focus(); } }
    return self.clients.openWindow(target);
  })());
});
