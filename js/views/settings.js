/**
 * views/settings.js — USTAWIENIA: wygląd (jasny/ciemny, wysoki kontrast),
 * nazwa użytkownika, kopia zapasowa, import, eksport CSV, dane demo, kosz.
 * Moduły (synchronizacja, powiadomienia) dopisują swoje sekcje
 * przez registerSettingsSection().
 */
import * as db from '../db.js';
import { esc, fmtDate } from '../utils.js';
import { toast, confirmDlg, openModal } from '../ui.js';
import { exportBackup, importBackup, CSV_EXPORTS, downloadCSV, daysSinceBackup } from '../backup.js';
import { pageHead } from './common.js';
import { applyTheme, getTheme } from '../theme.js';
import { navigate } from '../router.js';

const sections = [];
/** s = {order, render() -> html (może być async), bind(el)} */
export function registerSettingsSection(s) { sections.push(s); sections.sort((a, b) => a.order - b.order); }

export async function settingsView(el) {
  const d = await db.loadAll();
  const theme = getTheme();
  const lastBackup = await db.getMeta('lastBackup');
  const bDays = await daysSinceBackup();
  const demo = d.cows.some(c => c.demo);
  const extra = [];
  for (const s of sections) extra.push(await s.render());

  el.innerHTML = `
    ${pageHead('Ustawienia')}
    <section class="card">
      <h2>Wygląd</h2>
      <div class="seg" role="radiogroup" aria-label="Motyw">
        ${[['auto', 'Automatyczny'], ['jasny', '☀️ Jasny'], ['ciemny', '🌙 Ciemny']].map(([v, l]) =>
          `<button class="seg-btn ${theme.mode === v ? 'active' : ''}" data-theme-mode="${v}" role="radio" aria-checked="${theme.mode === v}">${l}</button>`).join('')}
      </div>
      <label class="field-check big-check"><input type="checkbox" data-contrast ${theme.contrast ? 'checked' : ''}>
        <span>Wysoki kontrast (lepiej widać w słońcu)</span></label>
      <label class="field-check big-check"><input type="checkbox" data-bigtext ${theme.bigText ? 'checked' : ''}>
        <span>Większy tekst</span></label>
    </section>
    ${extra.join('')}
    <section class="card">
      <h2>Kopia zapasowa</h2>
      <p>Ostatnia kopia: <b>${lastBackup ? fmtDate(lastBackup) : 'nigdy'}</b>
        ${bDays === null || bDays >= 7 ? '<span class="badge badge-warn">zalecana nowa kopia</span>' : ''}</p>
      <p class="muted">Kopia to jeden plik .json ze wszystkimi danymi (także zdjęciami). Zapisz go np. na pendrive, w e-mailu lub na Dysku Google.</p>
      <div class="actions-row">
        <button class="btn btn-primary btn-big" data-act="backup">💾 Pobierz kopię zapasową</button>
        <label class="btn btn-big">📂 Wczytaj kopię…<input type="file" accept=".json,application/json" data-import hidden></label>
      </div>
    </section>
    <section class="card">
      <h2>Eksport tabel do Excela (CSV)</h2>
      <div class="btn-list">${CSV_EXPORTS.map(x => `<button class="btn" data-csv="${x.id}">📄 ${esc(x.label)}</button>`).join('')}</div>
    </section>
    <section class="card">
      <h2>Dane</h2>
      <div class="actions-row">
        <a class="btn" href="#/kosz">🗑 Kosz (przywracanie usuniętych)</a>
        ${demo ? '<button class="btn btn-danger" data-act="remove-demo">Usuń dane demo</button>' : '<button class="btn" data-act="load-demo">Wczytaj dane demo</button>'}
      </div>
    </section>
    <section class="card">
      <h2>O aplikacji</h2>
      <p>Obora — zarządzanie stadem bydła. Działa bez internetu; dane zapisane są w tej przeglądarce.
      Wersja ${esc(window.APP_VERSION || '')}.</p>
    </section>`;

  el.addEventListener('click', async e => {
    const t = e.target.closest("[data-theme-mode]");
    if (t) { applyTheme({ ...getTheme(), mode: t.dataset.themeMode }); navigate('/ustawienia'); return; }
    const c = e.target.closest('[data-csv]');
    if (c) {
      const x = CSV_EXPORTS.find(z => z.id === c.dataset.csv);
      const { columns, rows } = x.build(await db.loadAll());
      downloadCSV(x.id, columns, rows);
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'backup': await exportBackup(); toast('Pobrano kopię zapasową.', 'ok'); navigate('/ustawienia'); break;
      case 'remove-demo': { const { removeDemo } = await import('../demo.js'); await removeDemo(); break; }
      case 'load-demo': { const { loadDemo } = await import('../demo.js'); await loadDemo(); toast('Wczytano dane demo.', 'ok'); break; }
    }
  });
  el.addEventListener('change', async e => {
    if (e.target.matches('[data-contrast]')) applyTheme({ ...getTheme(), contrast: e.target.checked });
    if (e.target.matches('[data-bigtext]')) applyTheme({ ...getTheme(), bigText: e.target.checked });
    if (e.target.matches('[data-import]') && e.target.files[0]) {
      const file = e.target.files[0];
      e.target.value = '';
      importDialog(file);
    }
  });
  for (const s of sections) s.bind && s.bind(el);
}

/** Pyta, czy dołączyć dane z kopii, czy zastąpić wszystko. */
function importDialog(file) {
  const { el, close } = openModal({
    title: 'Wczytywanie kopii zapasowej',
    body: `<p>Plik: <b>${esc(file.name)}</b></p>
      <p><b>Połącz</b> — dodaje dane z kopii, przy różnicach zostaje nowsza wersja wpisu.<br>
      <b>Zastąp</b> — usuwa obecne dane w aplikacji i wczytuje tylko te z kopii.</p>`,
    footer: `<button class="btn" data-close>Anuluj</button>
      <button class="btn btn-danger" data-mode="replace">Zastąp wszystko</button>
      <button class="btn btn-primary" data-mode="merge">Połącz</button>`,
  });
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    if (b.dataset.mode === 'replace' && !await confirmDlg('Na pewno zastąpić WSZYSTKIE obecne dane danymi z kopii?', { danger: true, okText: 'Zastąp' })) return;
    try {
      const n = await importBackup(file, b.dataset.mode);
      toast(`Wczytano ${n} wpisów.`, 'ok');
      close();
    } catch (err) { toast(err.message, 'error', 6000); }
  });
}
