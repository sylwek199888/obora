/**
 * scanner.js — SKANOWANIE kodów QR / kreskowych aparatem telefonu
 * oraz WYSZUKIWANIE GŁOSOWE (po polsku).
 * Skaner używa wbudowanego w przeglądarkę BarcodeDetector (Chrome na Androidzie,
 * Edge, Opera). Na iPhonie można zeskanować kod QR z kojca zwykłym aparatem —
 * link otworzy kartę krowy.
 */
import { esc } from './utils.js';
import { openModal, toast } from './ui.js';

export const canScan = () => 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = () => !!SR;

/** Otwiera okno z podglądem aparatu. Zwraca odczytany tekst albo null. */
export function scanDialog() {
  return new Promise(resolve => {
    let stream = null, timer = null, result = null;
    const supported = canScan();
    const { el, close } = openModal({
      title: 'Skanuj kolczyk lub kod QR',
      body: `${supported ? '<div class="scanner"><video playsinline muted></video></div><p class="muted">Skieruj aparat na kod QR z kojca lub kod kreskowy kolczyka.</p>'
        : `<div class="alert alert-info">Ta przeglądarka nie obsługuje skanowania kodów. Użyj Chrome na Androidzie
            albo zeskanuj kod QR z kojca zwykłym aparatem telefonu — otworzy się karta krowy.</div>`}
        <form class="inline-form" data-manual><input type="text" name="code" placeholder="lub wpisz numer kolczyka" autocomplete="off" aria-label="Numer kolczyka">
        <button class="btn btn-primary">Szukaj</button></form>`,
      onClose: () => {
        clearInterval(timer);
        stream && stream.getTracks().forEach(t => t.stop());
        resolve(result);
      },
    });
    el.querySelector('[data-manual]').addEventListener('submit', e => {
      e.preventDefault();
      result = e.target.elements.code.value.trim() || null;
      close();
    });
    if (!supported) return;
    (async () => {
      try {
        const wanted = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'data_matrix', 'itf', 'pdf417'];
        const formats = (await BarcodeDetector.getSupportedFormats()).filter(f => wanted.includes(f));
        const detector = new BarcodeDetector({ formats });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        const video = el.querySelector('video');
        video.srcObject = stream;
        await video.play();
        timer = setInterval(async () => {
          try {
            const codes = await detector.detect(video);
            if (codes.length) {
              result = codes[0].rawValue;
              if (navigator.vibrate) navigator.vibrate(120);
              close();
            }
          } catch { /* klatka jeszcze niegotowa */ }
        }, 300);
      } catch (e) {
        el.querySelector('.scanner')?.replaceWith(Object.assign(document.createElement('div'), {
          className: 'alert alert-warn', textContent: 'Brak dostępu do aparatu. Zezwól na użycie aparatu w ustawieniach przeglądarki.' }));
      }
    })();
  });
}

/**
 * Rozpoznawanie mowy. Zwraca Promise z tekstem (np. „Malina” albo „1234”).
 * Cyfry wypowiedziane osobno („12 34”) są sklejane.
 */
export function listen() {
  return new Promise(resolve => {
    if (!SR) { toast('Ta przeglądarka nie obsługuje rozpoznawania mowy.', 'warn'); resolve(null); return; }
    const rec = new SR();
    rec.lang = 'pl-PL';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    const { el, close } = openModal({
      title: 'Mów…',
      body: `<p class="confirm-text">🎤 Powiedz imię krowy, numer wewnętrzny lub ostatnie cyfry kolczyka.</p><p class="muted" data-heard></p>`,
      onClose: () => { try { rec.abort(); } catch { /* */ } },
    });
    let done = false;
    rec.onresult = e => {
      let t = e.results[0][0].transcript.trim();
      if (/^[\d\s]+$/.test(t)) t = t.replace(/\s/g, '');
      el.querySelector('[data-heard]').textContent = `Usłyszano: ${esc(t)}`;
      done = true;
      resolve(t);
      setTimeout(close, 400);
    };
    rec.onerror = e => { if (!done) { done = true; resolve(null); toast(e.error === 'not-allowed' ? 'Brak zgody na mikrofon.' : 'Nie rozpoznano mowy.', 'warn'); close(); } };
    rec.onend = () => { if (!done) { done = true; resolve(null); close(); } };
    rec.start();
  });
}
