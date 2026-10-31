/**
 * pwa.js — INSTALACJA NA EKRANIE GŁÓWNYM i praca offline.
 * Rejestruje service worker (sw.js), który zapisuje pliki aplikacji
 * w pamięci telefonu, oraz pokazuje przycisk „Zainstaluj aplikację”.
 */
import { toast } from './ui.js';
import { registerSettingsSection } from './views/settings.js';

let installEvent = null;

export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; });
  window.addEventListener('appinstalled', () => { installEvent = null; toast('Aplikacja zainstalowana. 👍', 'ok'); });
  navigator.serviceWorker.register('sw.js').then(reg => {
    if (!reg) return;
    // nowa wersja aplikacji pobrana w tle
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Pobrano nową wersję aplikacji — zostanie użyta po ponownym uruchomieniu.', 'info', 6000);
        }
      });
    });
  }).catch(e => console.warn('Service worker:', e));
  // kliknięcie powiadomienia — przejście do wskazanego ekranu
  navigator.serviceWorker.addEventListener('message', e => { if (e.data?.navigate) location.hash = e.data.navigate; });
}

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

registerSettingsSection({
  order: 1,
  render: () => isStandalone() ? '' : `<section class="card"><h2>📲 Zainstaluj na telefonie</h2>
    ${isIOS() ? '<p>W Safari stuknij <b>Udostępnij</b> (kwadrat ze strzałką) → <b>Do ekranu początkowego</b>.</p>'
      : `<p>Aplikacja pojawi się jako ikona na ekranie głównym i będzie działać bez internetu.</p>
        <button class="btn btn-primary btn-big" data-install>📲 Zainstaluj aplikację</button>
        <p class="muted">Jeśli przycisk nie działa: menu przeglądarki (⋮) → <b>Zainstaluj aplikację</b> / <b>Dodaj do ekranu głównego</b>.</p>`}
  </section>`,
  bind: el => el.querySelector('[data-install]')?.addEventListener('click', async () => {
    if (!installEvent) { toast('Użyj menu przeglądarki (⋮) → „Zainstaluj aplikację”.', 'info', 6000); return; }
    installEvent.prompt();
    await installEvent.userChoice;
    installEvent = null;
  }),
});
