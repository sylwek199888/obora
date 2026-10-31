/**
 * views/sync-view.js — ekran SYNCHRONIZACJI: konfiguracja Supabase,
 * logowanie e-mailem, utworzenie gospodarstwa lub dołączenie kodem,
 * lista użytkowników (właściciel, pracownicy) i stan synchronizacji.
 */
import * as db from '../db.js';
import * as sync from '../sync.js';
import { esc, fmtDateTime, plural } from '../utils.js';
import { toast, confirmDlg } from '../ui.js';
import { pageHead } from './common.js';
import { refresh } from '../router.js';
import { registerSettingsSection } from './settings.js';

let recoveryMode = false;
export function setRecoveryMode(v) { recoveryMode = v; }

const STATE_TEXT = {
  off: '⚪ wyłączona', idle: '🟢 aktualne', syncing: '🔄 trwa synchronizacja…', error: '🔴 błąd', offline: '📴 brak internetu — zmiany czekają',
};

/** Krótki opis stanu do menu bocznego / znaczka. */
export function statusBadge(st = sync.getStatus()) {
  if (!sync.isActiveSync()) return st.pending ? `☁️ Synchronizacja wyłączona` : '';
  const pend = st.pending ? ` · ${st.pending} do wysłania` : '';
  return `${STATE_TEXT[st.state] || ''}${pend}`;
}

async function withBusy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { toast(e.message, 'error', 7000); } finally { btn.disabled = false; }
}

export async function syncView(el) {
  const conf = sync.getConfig();
  const session = sync.getSession();
  const farm = sync.getFarm();
  const st = sync.getStatus();
  const pending = (await db.getDirty()).length;
  let body = '';

  if (recoveryMode && session) {
    body = `<section class="card"><h2>Ustaw nowe hasło</h2>
      <form data-form="newpass" class="form"><div class="field"><label for="np">Nowe hasło (min. 6 znaków)</label>
      <input type="password" id="np" name="password" autocomplete="new-password" minlength="6" required></div>
      <button class="btn btn-primary btn-big">Zapisz hasło</button></form></section>`;
  } else if (!sync.isConfigured()) {
    body = `<section class="card"><h2>Krok 1: połącz z Supabase</h2>
      <p>Synchronizacja pozwala używać tych samych danych na laptopie i telefonie oraz pracować w kilka osób.
      Potrzebny jest darmowy projekt w <a href="https://supabase.com" target="_blank" rel="noopener">Supabase</a> — instrukcja krok po kroku jest w pliku README.</p>
      <form data-form="config" class="form">
        <div class="field"><label for="su">Project URL</label><input type="url" id="su" name="url" placeholder="https://xxxx.supabase.co" value="${esc(conf.url)}" required autocomplete="off"></div>
        <div class="field"><label for="sk">Klucz „anon public” (Publishable key)</label><input type="text" id="sk" name="key" placeholder="eyJhbGciOi…" value="${esc(conf.key)}" required autocomplete="off"></div>
        <button class="btn btn-primary btn-big">Zapisz i sprawdź połączenie</button>
      </form></section>`;
  } else if (!session) {
    body = `<section class="card"><h2>Krok 2: zaloguj się e-mailem</h2>
      <form data-form="login" class="form">
        <div class="field"><label for="le">E-mail</label><input type="email" id="le" name="email" autocomplete="email" required></div>
        <div class="field"><label for="lp">Hasło</label><input type="password" id="lp" name="password" autocomplete="current-password" required></div>
        <div class="actions-row"><button class="btn btn-primary btn-big" data-mode="in">Zaloguj</button>
          <button class="btn btn-big" type="button" data-mode="up">Załóż konto</button></div>
        <button class="btn btn-ghost" type="button" data-mode="reset">Nie pamiętam hasła</button>
      </form>
      ${sync.hasBuiltInConfig() ? '' : `<p class="muted">Serwer: ${esc(conf.url)} · <button class="btn btn-small btn-ghost" data-act="reconfig">zmień</button></p>`}
    </section>`;
  } else if (!farm) {
    let farms = [];
    try { farms = await sync.listFarms(); } catch (e) { toast(e.message, 'error'); }
    const demo = (await db.loadAll()).cows.some(c => c.demo);
    body = `<section class="card"><h2>Krok 3: wybierz gospodarstwo</h2>
      <p>Zalogowano jako <b>${esc(session.user?.email || '')}</b>.</p>
      ${demo ? '<div class="alert alert-warn">W aplikacji są dane demo. Przed połączeniem zostaniesz zapytany, czy je usunąć.</div>' : ''}
      ${farms.length ? `<h3>Twoje gospodarstwa</h3><div class="btn-list">${farms.map(f => `<button class="btn btn-primary btn-big" data-farm="${esc(f.id)}">🏡 ${esc(f.name)} (${esc(f.role)})</button>`).join('')}</div>` : ''}
      <div class="dash-grid">
        <form data-form="create" class="card"><h3>Jestem właścicielem — nowe gospodarstwo</h3>
          <div class="field"><label for="fn">Nazwa gospodarstwa</label><input type="text" id="fn" name="name" placeholder="np. Gospodarstwo Kowalskich" required></div>
          <button class="btn btn-primary">Utwórz gospodarstwo</button>
          <p class="muted">Dane z tego urządzenia zostaną wysłane do nowego gospodarstwa.</p></form>
        <form data-form="join" class="card"><h3>Jestem pracownikiem — mam kod</h3>
          <div class="field"><label for="jc">Kod gospodarstwa (8 znaków od właściciela)</label><input type="text" id="jc" name="code" autocapitalize="characters" required></div>
          <button class="btn btn-primary">Dołącz</button></form>
      </div>
      <button class="btn btn-ghost" data-act="logout">Wyloguj</button></section>`;
  } else {
    let mem = [];
    try { mem = await sync.members(); } catch (e) { /* offline */ }
    const owner = farm.role === 'właściciel';
    body = `<section class="card"><h2>🏡 ${esc(farm.name)}</h2>
      <div class="stats-grid">
        <div class="stat"><span>Stan</span><b>${STATE_TEXT[st.state] || st.state}</b>${st.error ? `<small class="neg">${esc(st.error)}</small>` : ''}</div>
        <div class="stat"><span>Ostatnia synchronizacja</span><b>${st.lastSync ? fmtDateTime(st.lastSync) : '—'}</b></div>
        <div class="stat"><span>Czeka na wysłanie</span><b>${pending} ${plural(pending, 'wpis', 'wpisy', 'wpisów')}</b></div>
        <div class="stat"><span>Zalogowano</span><b style="font-size:1em">${esc(session.user?.email || '')}</b><small>${esc(farm.role)}</small></div>
      </div>
      <div class="actions-row"><button class="btn btn-primary btn-big" data-act="sync">🔄 Synchronizuj teraz</button></div>
      </section>
      <section class="card"><h2>Użytkownicy</h2>
        ${mem.length ? `<ul class="link-list">${mem.map(m => `<li><b>${esc(m.email || m.user_id)}</b> — ${esc(m.role)}
          ${owner && m.user_id !== session.user.id ? ` <button class="btn btn-small" data-remove="${esc(m.user_id)}">Usuń dostęp</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Lista niedostępna offline.</p>'}
        <h3>Dodaj pracownika</h3>
        <p>1. Pracownik otwiera aplikację na swoim telefonie → <b>Więcej → Synchronizacja</b>, zakłada konto swoim e-mailem.<br>
        2. Wpisuje kod gospodarstwa: <b style="font-size:1.4em;letter-spacing:.1em">${esc(farm.join_code || '—')}</b></p>
        ${owner ? '<button class="btn" data-act="newcode">Wygeneruj nowy kod (stary przestanie działać)</button>' : ''}
      </section>
      <section class="card"><h2>Konto</h2><div class="actions-row">
        <button class="btn" data-act="disconnect">Odłącz to urządzenie</button>
        <button class="btn btn-danger" data-act="logout">Wyloguj</button></div>
        <p class="muted">Po wylogowaniu dane zostają w tym urządzeniu, ale przestają się synchronizować.</p></section>`;
  }
  el.innerHTML = `${pageHead('Synchronizacja', '', 'Laptop ↔ telefon, wielu użytkowników. Działa też bez internetu — zmiany wyślą się później.')}${body}`;

  el.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const btn = e.submitter || f.querySelector('button');
    const v = Object.fromEntries(new FormData(f));
    await withBusy(btn, async () => {
      switch (f.dataset.form) {
        case 'config':
          sync.configure(v.url, v.key);
          try { await sync.testConnection(); toast('Połączono z Supabase.', 'ok'); }
          catch (err) { sync.configure('', ''); throw err; }
          break;
        case 'login': {
          const mode = btn.dataset.mode || 'in';
          if (mode === 'up') {
            const r = await sync.signUp(v.email.trim(), v.password);
            toast(r.confirmed ? 'Konto utworzone, zalogowano.' : 'Konto utworzone. Kliknij link w e-mailu od Supabase, potem zaloguj się.', 'ok', 8000);
          } else {
            await sync.signIn(v.email.trim(), v.password);
            toast('Zalogowano.', 'ok');
          }
          break;
        }
        case 'create': await connect(await sync.createFarm(v.name), 'właściciel'); return;
        case 'join': await connect(await sync.joinFarm(v.code), 'pracownik'); return;
        case 'newpass': await sync.setNewPassword(v.password); recoveryMode = false; toast('Zmieniono hasło.', 'ok'); break;
      }
      refresh();
    });
  });
  // przyciski „Załóż konto” / „Nie pamiętam hasła” nie wysyłają formularza same
  el.addEventListener('click', async e => {
    const mb = e.target.closest('[data-mode]');
    if (mb && mb.type === 'button') {
      const f = mb.closest('form');
      if (mb.dataset.mode === 'reset') {
        if (!f.elements.email.value) { toast('Wpisz najpierw adres e-mail.', 'warn'); return; }
        await withBusy(mb, async () => { await sync.resetPassword(f.elements.email.value.trim()); toast('Wysłano e-mail z linkiem do zmiany hasła.', 'ok', 7000); });
        return;
      }
      if (!f.reportValidity()) return;
      f.dispatchEvent(new SubmitEvent('submit', { submitter: mb, cancelable: true, bubbles: true }));
      return;
    }
    const fb = e.target.closest('[data-farm]');
    if (fb) { await withBusy(fb, async () => { const farms = await sync.listFarms(); await connect(farms.find(x => x.id === fb.dataset.farm)); }); return; }
    const rb = e.target.closest('[data-remove]');
    if (rb && await confirmDlg('Odebrać temu użytkownikowi dostęp do gospodarstwa?', { danger: true, okText: 'Usuń dostęp' })) {
      await withBusy(rb, async () => { await sync.removeMember(rb.dataset.remove); refresh(); });
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'sync': await withBusy(b, async () => { await sync.syncNow(); const s = sync.getStatus(); if (s.error) throw new Error(s.error); toast('Zsynchronizowano.', 'ok'); refresh(); }); break;
      case 'reconfig': sync.configure('', ''); refresh(); break;
      case 'logout': if (await confirmDlg('Wylogować? Dane zostaną w tym urządzeniu.')) { await sync.signOut(); refresh(); } break;
      case 'disconnect': if (await confirmDlg('Odłączyć to urządzenie od gospodarstwa? Dane zostaną, ale przestaną się synchronizować.')) { await sync.disconnectFarm(); refresh(); } break;
      case 'newcode': await withBusy(b, async () => { await sync.newJoinCode(); refresh(); }); break;
    }
  });
}

/** Podłączenie do gospodarstwa — z pytaniem o dane demo. */
async function connect(farm, role) {
  const d = await db.loadAll();
  if (d.cows.some(c => c.demo)) {
    const { removeDemo } = await import('../demo.js');
    if (await confirmDlg('Usunąć dane demonstracyjne przed połączeniem? (Zalecane — inaczej trafią do wspólnej bazy gospodarstwa.)', { okText: 'Usuń demo', cancelText: 'Zostaw' })) {
      await removeDemo({ ask: false });
    }
  }
  toast('Łączenie i wysyłanie danych…');
  await sync.selectFarm(farm, role);
  const s = sync.getStatus();
  if (s.error) toast(s.error, 'error', 7000); else toast(`Połączono z gospodarstwem „${farm.name}”.`, 'ok');
  refresh();
}

/* Skrót w ustawieniach. */
registerSettingsSection({
  order: 2,
  render: () => `<section class="card"><h2>☁️ Synchronizacja i użytkownicy</h2>
    <p>${sync.isActiveSync() ? `Połączono z gospodarstwem <b>${esc(sync.getFarm().name)}</b> jako ${esc(sync.getSession().user?.email || '')}. ${esc(statusBadge())}`
      : 'Wyłączona — dane są tylko na tym urządzeniu.'}</p>
    <a class="btn btn-primary" href="#/synchronizacja">${sync.isActiveSync() ? 'Szczegóły' : 'Włącz synchronizację'}</a></section>`,
});

