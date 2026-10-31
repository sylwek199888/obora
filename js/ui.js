/**
 * ui.js — wspólne elementy interfejsu: komunikaty (toast), okna potwierdzenia,
 * okna modalne i GENERATOR FORMULARZY.
 *
 * formDialog({ title, fields, values, onSubmit, validate }) buduje formularz
 * z listy pól (ten sam format co COW_FIELDS w model.js), pokazuje błędy
 * walidacji przy polach i zwraca Promise z zapisanymi wartościami (lub null).
 */
import { esc, $, $$, compressImage, parseNum, todayISO, plCompare } from './utils.js';
import { cowLabel, isFemale, isMale } from './model.js';

/* ---------------- TOAST ---------------- */

export function toast(msg, type = 'info', ms = 3500) {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add('hide'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

/* ---------------- MODAL ---------------- */

/** Otwiera okno. Zwraca {el, close}. onClose wywoływane zawsze przy zamknięciu. */
export function openModal({ title, body, footer = '', wide = false, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="modal-head">
        <h2>${esc(title)}</h2>
        <button type="button" class="btn-icon" data-close aria-label="Zamknij">✕</button>
      </header>
      <div class="modal-body">${body}</div>
      ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
    </div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('modal-open');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.remove();
    if (!$('.modal-backdrop')) document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = e => { if (e.key === 'Escape' && wrap === $$('.modal-backdrop').pop()) close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  const first = wrap.querySelector('input:not([type=hidden]),select,textarea');
  if (first && window.matchMedia('(pointer:fine)').matches) setTimeout(() => first.focus(), 50);
  return { el: wrap, close };
}

/** Okno potwierdzenia. Zwraca Promise<boolean>. */
export function confirmDlg(message, { okText = 'Tak', cancelText = 'Anuluj', danger = false, title = 'Potwierdź' } = {}) {
  return new Promise(resolve => {
    let result = false;
    const { el, close } = openModal({
      title,
      body: `<p class="confirm-text">${esc(message)}</p>`,
      footer: `<button type="button" class="btn" data-close>${esc(cancelText)}</button>
               <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(okText)}</button>`,
      onClose: () => resolve(result),
    });
    el.querySelector('[data-ok]').addEventListener('click', () => { result = true; close(); });
  });
}

/* ---------------- POLA FORMULARZA ---------------- */

const optList = opts => (opts || []).map(o => typeof o === 'object' ? o : { value: o, label: o });

/** Lista zwierząt do pola „cowref” (np. matka — tylko samice). */
function cowOptions(cows, filter, selfId) {
  let list = (cows || []).filter(c => c.id !== selfId);
  if (filter === 'female') list = list.filter(isFemale);
  if (filter === 'male') list = list.filter(isMale);
  return list.sort((a, b) => plCompare(a.name || a.earTag, b.name || b.earTag));
}

/** HTML jednego pola. ctx = {cows, selfId}. */
export function fieldHTML(f, values, ctx = {}) {
  const id = `f_${f.name}`;
  const v = values[f.name];
  const req = f.required ? ' <span class="req" aria-hidden="true">*</span>' : '';
  const unit = f.unit ? `<span class="unit">${esc(f.unit)}</span>` : '';
  const help = f.help ? `<small class="help">${esc(f.help)}</small>` : '';
  let input = '';
  const common = `id="${id}" name="${f.name}" ${f.required ? 'required' : ''} ${f.readonly ? 'readonly' : ''}`;
  switch (f.type) {
    case 'heading':
      return `<h3 class="form-section" data-field="${f.name}">${esc(f.label)}</h3>`;
    case 'info':
      return `<div class="form-info" data-field="${f.name}">${f.html || esc(f.label)}</div>`;
    case 'hidden':
      return `<input type="hidden" name="${f.name}" value="${esc(v ?? '')}">`;
    case 'select':
      input = `<select ${common}>
        ${f.required && v ? '' : '<option value="">— wybierz —</option>'}
        ${optList(f.options).map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(v ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select>`;
      break;
    case 'textarea':
      input = `<textarea ${common} rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(v ?? '')}</textarea>`;
      break;
    case 'checkbox':
      return `<label class="field field-check" data-field="${f.name}">
        <input type="checkbox" ${common} ${v ? 'checked' : ''}> <span>${esc(f.label)}</span>${help}</label>`;
    case 'number':
      input = `<input type="text" inputmode="decimal" ${common} value="${esc(v ?? '')}" placeholder="${esc(f.placeholder || '')}" autocomplete="off">`;
      break;
    case 'date':
      input = `<input type="date" ${common} value="${esc(v ?? '')}" ${f.noFuture !== false ? `max="${todayISO()}"` : ''}>`;
      break;
    case 'photo': {
      const has = !!v;
      input = `<div class="photo-field">
        <img class="photo-preview" src="${has ? esc(v) : ''}" alt="" ${has ? '' : 'hidden'}>
        <input type="hidden" name="${f.name}" value="${esc(v ?? '')}">
        <label class="btn">📷 ${has ? 'Zmień zdjęcie' : 'Zrób / wybierz zdjęcie'}
          <input type="file" accept="image/*" capture="environment" data-photo-input hidden></label>
        <button type="button" class="btn btn-ghost" data-photo-clear ${has ? '' : 'hidden'}>Usuń zdjęcie</button>
      </div>`;
      break;
    }
    case 'cowref': {
      const selId = values[f.name + 'Id'] || '';
      const txt = values[f.name + 'Text'] || '';
      const opts = cowOptions(ctx.cows, f.filter, ctx.selfId);
      input = `<div class="cowref">
        <select id="${id}" name="${f.name}Id">
          <option value="">— spoza stada / brak —</option>
          ${opts.map(c => `<option value="${esc(c.id)}" ${c.id === selId ? 'selected' : ''}>${esc(cowLabel(c))}</option>`).join('')}
        </select>
        <input type="text" name="${f.name}Text" value="${esc(txt)}" placeholder="lub wpisz numer / nazwę" ${selId ? 'hidden' : ''} autocomplete="off">
      </div>`;
      break;
    }
    default: {
      const list = f.list ? `list="dl_${f.name}"` : '';
      input = `<input type="${f.inputType || 'text'}" ${common} value="${esc(v ?? '')}" placeholder="${esc(f.placeholder || '')}" ${list} ${f.upper ? 'autocapitalize="characters"' : ''} autocomplete="off">
        ${f.list ? `<datalist id="dl_${f.name}">${f.list.map(x => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}`;
    }
  }
  return `<div class="field" data-field="${f.name}">
    <label for="${id}">${esc(f.label)}${req}</label>
    <div class="input-wrap">${input}${unit}</div>${help}
    <div class="field-error" role="alert"></div>
  </div>`;
}

/** Odczytuje wartości formularza zgodnie z definicją pól. */
export function readForm(form, fields) {
  const v = {};
  for (const f of fields) {
    if (['heading', 'info'].includes(f.type)) continue;
    if (f.type === 'cowref') {
      v[f.name + 'Id'] = form.elements[f.name + 'Id'].value;
      v[f.name + 'Text'] = v[f.name + 'Id'] ? '' : form.elements[f.name + 'Text'].value.trim();
      continue;
    }
    const el = form.elements[f.name];
    if (!el) continue;
    if (f.type === 'checkbox') v[f.name] = el.checked;
    else if (f.type === 'number') v[f.name] = parseNum(el.value);
    else v[f.name] = typeof el.value === 'string' ? el.value.trim() : el.value;
    if (f.upper && v[f.name]) v[f.name] = v[f.name].toUpperCase().replace(/\s/g, '');
  }
  return v;
}

/** Pokazuje/ukrywa pola z warunkiem showIf. */
function applyShowIf(form, fields) {
  const v = readForm(form, fields);
  for (const f of fields) {
    if (!f.showIf) continue;
    const box = form.querySelector(`[data-field="${f.name}"]`);
    if (box) box.hidden = !f.showIf(v);
  }
}

/** Podpina obsługę zdjęć, pól cowref i showIf. */
export function bindForm(form, fields) {
  form.addEventListener('change', async e => {
    const t = e.target;
    if (t.matches('[data-photo-input]') && t.files[0]) {
      const box = t.closest('.photo-field');
      try {
        const url = await compressImage(t.files[0]);
        box.querySelector('input[type=hidden]').value = url;
        const img = box.querySelector('img');
        img.src = url; img.hidden = false;
        box.querySelector('[data-photo-clear]').hidden = false;
      } catch { toast('Nie udało się wczytać zdjęcia.', 'error'); }
    }
    if (t.matches('.cowref select')) {
      const txt = t.parentElement.querySelector('input[type=text]');
      txt.hidden = !!t.value;
    }
    applyShowIf(form, fields);
  });
  form.addEventListener('input', () => applyShowIf(form, fields));
  form.addEventListener('click', e => {
    const b = e.target.closest('[data-photo-clear]');
    if (!b) return;
    const box = b.closest('.photo-field');
    box.querySelector('input[type=hidden]').value = '';
    box.querySelector('img').hidden = true;
    b.hidden = true;
  });
  applyShowIf(form, fields);
}

/** Wyświetla błędy przy polach. Zwraca true, jeśli są błędy. */
export function showErrors(form, errors) {
  $$('.field', form).forEach(f => { f.classList.remove('has-error'); const e = f.querySelector('.field-error'); if (e) e.textContent = ''; });
  const keys = Object.keys(errors || {});
  for (const k of keys) {
    const box = form.querySelector(`[data-field="${k}"]`);
    if (box) {
      box.classList.add('has-error');
      const e = box.querySelector('.field-error');
      if (e) e.textContent = errors[k];
    } else toast(errors[k], 'error');
  }
  if (keys.length) {
    const first = form.querySelector('.has-error');
    first && first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  return keys.length > 0;
}

/**
 * Okno z formularzem.
 *  validate(values) -> {pole: błąd}  (opcjonalnie, może być async)
 *  onSubmit(values) -> async; jeśli rzuci wyjątek, okno zostaje otwarte
 * Zwraca Promise z wartościami po zapisie albo null przy anulowaniu.
 */
export function formDialog({ title, fields, values = {}, submitText = 'Zapisz', validate, onSubmit, ctx = {}, intro = '', wide = false, extraButtons = '' }) {
  return new Promise(resolve => {
    let saved = null;
    const body = `<form class="form" novalidate>
      ${intro}
      ${fields.map(f => fieldHTML(f, values, ctx)).join('')}
      <button type="submit" hidden></button>
    </form>`;
    const { el, close } = openModal({
      title, body, wide,
      footer: `${extraButtons}<button type="button" class="btn" data-close>Anuluj</button>
               <button type="button" class="btn btn-primary" data-submit>${esc(submitText)}</button>`,
      onClose: () => resolve(saved),
    });
    const form = el.querySelector('form');
    bindForm(form, fields);
    const submit = async () => {
      const v = readForm(form, fields);
      // pola ukryte warunkiem nie są zapisywane
      for (const f of fields) if (f.showIf && !f.showIf(v)) v[f.name] = f.type === 'number' ? null : '';
      // pola wymagane
      const errs = {};
      for (const f of fields) {
        if (f.required && (!f.showIf || f.showIf(v)) && (v[f.name] === '' || v[f.name] === null || v[f.name] === undefined)) {
          errs[f.name] = 'To pole jest wymagane.';
        }
      }
      Object.assign(errs, validate ? (await validate(v)) || {} : {});
      if (showErrors(form, errs)) return;
      const btn = el.querySelector('[data-submit]');
      btn.disabled = true;
      try {
        await (onSubmit && onSubmit(v));
        saved = v;
        close();
      } catch (e) {
        console.warn(e);
        toast(e.message || 'Nie udało się zapisać.', 'error');
        btn.disabled = false;
      }
    };
    el.querySelector('[data-submit]').addEventListener('click', submit);
    form.addEventListener('submit', e => { e.preventDefault(); submit(); });
  });
}

/* ---------------- DROBNE ELEMENTY ---------------- */

/** Pusta lista z komunikatem. */
export const emptyState = (text, action = '') => `<div class="empty"><p>${esc(text)}</p>${action}</div>`;

/** Plakietka (badge). */
export const badge = (text, kind = '') => `<span class="badge ${kind ? 'badge-' + kind : ''}">${esc(text)}</span>`;

/** Zakładki: tabs=[{id,label}], active=id. */
export const tabsHTML = (tabs, active) => `<div class="tabs" role="tablist">${tabs.map(t =>
  `<button type="button" role="tab" class="tab ${t.id === active ? 'active' : ''}" aria-selected="${t.id === active}" data-tab="${t.id}">${esc(t.label)}</button>`).join('')}</div>`;
