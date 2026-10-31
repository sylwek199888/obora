/**
 * theme.js — tryb jasny / ciemny / automatyczny, wysoki kontrast, większy tekst.
 * Zapisywane w localStorage (żeby motyw był znany od razu przy starcie, bez mrugania).
 */
const KEY = 'obora-theme';

export function getTheme() {
  try { return { mode: 'auto', contrast: false, bigText: false, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { mode: 'auto', contrast: false, bigText: false }; }
}

export function applyTheme(t = getTheme()) {
  localStorage.setItem(KEY, JSON.stringify(t));
  const root = document.documentElement;
  const dark = t.mode === 'ciemny' || (t.mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.classList.toggle('contrast', !!t.contrast);
  root.classList.toggle('big-text', !!t.bigText);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#111814' : '#1f5c36';
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (getTheme().mode === 'auto') applyTheme(); });
