/**
 * farm.js — DANE GOSPODARSTWA (nazwa, właściciel, adres, numer siedziby stada).
 * Używane na wydrukach (księga leczenia, karta krowy, zgłoszenia ARiMR).
 * Zapisywane lokalnie w bazie (meta).
 */
import * as db from './db.js';
import { esc } from './utils.js';
import { toast } from './ui.js';
import { registerSettingsSection } from './views/settings.js';

export async function getFarm() { return (await db.getMeta('farm')) || {}; }

registerSettingsSection({
  order: 5,
  render: async () => {
    const f = await getFarm();
    const inp = (name, label, ph = '') => `<div class="field"><label for="farm_${name}">${label}</label>
      <input type="text" id="farm_${name}" name="${name}" value="${esc(f[name] || '')}" placeholder="${esc(ph)}" autocomplete="off"></div>`;
    return `<section class="card"><h2>Gospodarstwo i użytkownik</h2>
      <form data-form="farm" class="form">
        <div class="field"><label for="farm_user">Twoje imię (zapisywane przy wpisach)</label>
          <input type="text" id="farm_user" name="user" value="${esc(localStorage.getItem('obora-user') || '')}" placeholder="np. Jan (właściciel)"></div>
        ${inp('name', 'Nazwa gospodarstwa')}${inp('owner', 'Właściciel (posiadacz zwierząt)')}
        ${inp('address', 'Adres')}${inp('herdNo', 'Numer siedziby stada', 'np. PL012345678-001')}
        ${inp('producerNo', 'Numer producenta (ARiMR)')}
        <button class="btn btn-primary">Zapisz</button>
      </form></section>`;
  },
  bind: el => {
    const form = el.querySelector('[data-form="farm"]');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(form));
      const user = v.user.trim();
      delete v.user;
      if (user) localStorage.setItem('obora-user', user); else localStorage.removeItem('obora-user');
      if (!db.getCurrentUser().includes('@')) db.setCurrentUser(user || 'Ja');
      await db.setMeta('farm', v);
      toast('Zapisano dane gospodarstwa.', 'ok');
    });
  },
});
