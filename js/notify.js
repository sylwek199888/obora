/**
 * notify.js — POWIADOMIENIA w przeglądarce (Notification API)
 * Raz dziennie (przy otwarciu aplikacji lub gdy jest otwarta w tle)
 * pokazuje powiadomienie z zadaniami na dziś.
 * Uwaga: bez własnego serwera push przeglądarki nie pozwalają wysyłać
 * powiadomień, gdy aplikacja jest całkowicie zamknięta.
 */
import * as db from './db.js';
import { todayISO, plural } from './utils.js';
import { todayAndWeek } from './tasks.js';
import { toast } from './ui.js';
import { registerSettingsSection } from './views/settings.js';
import { refresh } from './router.js';

export const notifSupported = () => 'Notification' in window;

async function show(title, body) {
  const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'obora-dzis', data: { url: './#/' } };
  const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
  if (reg) await reg.showNotification(title, opts);
  else new Notification(title, opts);
}

/** Pokazuje powiadomienie o zadaniach na dziś (najwyżej raz dziennie). */
export async function checkAndNotify({ force = false } = {}) {
  if (!notifSupported() || Notification.permission !== 'granted') return;
  if (!force && !(await db.getMeta('notifyOn', true))) return;
  const today = todayISO();
  if (!force && (await db.getMeta('lastNotified')) === today) return;
  const d = await db.loadAll();
  const tasks = todayAndWeek(d, today).today;
  if (!tasks.length && !force) return;
  await db.setMeta('lastNotified', today);
  const body = tasks.length
    ? tasks.slice(0, 5).map(t => `${t.icon} ${t.title}`).join('\n') + (tasks.length > 5 ? `\n…i ${tasks.length - 5} więcej` : '')
    : 'Brak zadań na dziś.';
  await show(`Obora: ${tasks.length} ${plural(tasks.length, 'zadanie', 'zadania', 'zadań')} na dziś`, body);
}

/** Uruchamiane przy starcie: sprawdza teraz, co 30 minut i po powrocie do aplikacji. */
export function startNotifier() {
  setTimeout(() => checkAndNotify(), 3000);
  setInterval(() => checkAndNotify(), 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkAndNotify(); });
}

registerSettingsSection({
  order: 20,
  render: async () => {
    if (!notifSupported()) return `<section class="card"><h2>Powiadomienia</h2><p class="muted">Ta przeglądarka nie obsługuje powiadomień.
      Na iPhonie powiadomienia działają po dodaniu aplikacji do ekranu głównego (iOS 16.4+).</p></section>`;
    const perm = Notification.permission;
    const on = await db.getMeta('notifyOn', true);
    return `<section class="card"><h2>Powiadomienia</h2>
      <p>Stan: <b>${perm === 'granted' ? (on ? 'włączone' : 'wyłączone w aplikacji') : perm === 'denied' ? 'zablokowane w przeglądarce' : 'nie włączone'}</b></p>
      <p class="muted">Raz dziennie pokażemy listę zadań na dziś (wycielenia, szczepienia, koniec karencji, terminy ARiMR…), gdy otworzysz aplikację lub będzie otwarta w tle.</p>
      <div class="actions-row">
        ${perm !== 'granted' ? `<button class="btn btn-primary" data-notif="ask" ${perm === 'denied' ? 'disabled' : ''}>🔔 Włącz powiadomienia</button>`
          : `<button class="btn" data-notif="toggle">${on ? '🔕 Wyłącz' : '🔔 Włącz'}</button><button class="btn" data-notif="test">Wyślij próbne</button>`}
      </div>${perm === 'denied' ? '<p class="muted">Odblokuj powiadomienia w ustawieniach strony w przeglądarce (ikona kłódki przy adresie).</p>' : ''}</section>`;
  },
  bind: el => el.addEventListener('click', async e => {
    const b = e.target.closest('[data-notif]');
    if (!b) return;
    if (b.dataset.notif === 'ask') {
      const p = await Notification.requestPermission();
      if (p === 'granted') { await db.setMeta('notifyOn', true); toast('Powiadomienia włączone.', 'ok'); await checkAndNotify({ force: true }); }
      refresh();
    }
    if (b.dataset.notif === 'toggle') { await db.setMeta('notifyOn', !(await db.getMeta('notifyOn', true))); refresh(); }
    if (b.dataset.notif === 'test') await checkAndNotify({ force: true });
  }),
});
