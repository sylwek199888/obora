/**
 * qr.js — GENERATOR KODÓW QR (bez zewnętrznych bibliotek).
 * Tryb bajtowy (UTF-8), poziom korekcji błędów M (~15%), wersje 1–20.
 * Na podstawie normy ISO/IEC 18004. Wynik: macierz true/false lub gotowy SVG.
 *
 * Użycie: qrSVG('https://…/#/krowa/abc') -> '<svg …>'
 */

// Liczba słów korekcyjnych na blok i liczba bloków dla poziomu M (indeks = wersja)
const ECC_PER_BLOCK_M = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26];
const NUM_BLOCKS_M = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];
const FORMAT_BITS_M = 0; // M = 00

/** Liczba modułów na dane (bez wzorców funkcyjnych) dla wersji. */
function rawModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
const dataCodewords = ver => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK_M[ver] * NUM_BLOCKS_M[ver];

/* ---- arytmetyka w ciele GF(256) i kod Reeda–Solomona ---- */
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data, divisor) {
  const r = new Array(divisor.length).fill(0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    divisor.forEach((c, i) => { r[i] ^= gfMul(c, f); });
  }
  return r;
}

/** Pozycje wzorców wyrównujących. */
function alignmentPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const res = [6];
  for (let pos = size - 7; res.length < n; pos -= step) res.splice(1, 0, pos);
  return res;
}

/**
 * Tworzy macierz QR dla tekstu. Zwraca {size, modules: boolean[][]}.
 * mask — opcjonalnie wymuszona maska (0–7), domyślnie najlepsza wg kar.
 */
export function qrMatrix(text, forcedMask = -1) {
  const bytes = Array.from(new TextEncoder().encode(text));
  // dobór najmniejszej wersji
  let ver = 1;
  for (; ver <= 20; ver++) {
    const ccBits = ver < 10 ? 8 : 16;
    if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
  }
  if (ver > 20) throw new Error('Tekst za długi dla kodu QR');
  const capacity = dataCodewords(ver) * 8;
  // strumień bitów: tryb bajtowy 0100, licznik, dane, terminator, wypełnienie
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, ver < 10 ? 8 : 16);
  bytes.forEach(b => push(b, 8));
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  // podział na bloki + korekcja błędów + przeplot
  const numBlocks = NUM_BLOCKS_M[ver], eccLen = ECC_PER_BLOCK_M[ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const numShort = numBlocks - raw % numBlocks;
  const shortLen = Math.floor(raw / numBlocks) - eccLen;
  const div = rsDivisor(eccLen);
  const blocks = [], eccs = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortLen + (i < numShort ? 0 : 1);
    const blk = data.slice(k, k + len);
    k += len;
    blocks.push(blk);
    eccs.push(rsRemainder(blk, div));
  }
  const codewords = [];
  for (let i = 0; i <= shortLen; i++) blocks.forEach(b => { if (i < b.length) codewords.push(b[i]); });
  for (let i = 0; i < eccLen; i++) eccs.forEach(e => codewords.push(e[i]));

  // rysowanie wzorców funkcyjnych
  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d !== 2 && d !== 4);
    }
  };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = alignmentPositions(ver);
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const drawFormat = mask => {
    const d = (FORMAT_BITS_M << 3) | mask;
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412;
    const bit = i => ((b >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0); // rezerwacja miejsca
  if (ver >= 7) {
    let r = ver;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (ver << 12) | r;
    for (let i = 0; i < 18; i++) {
      const dark = ((b >>> i) & 1) !== 0;
      const a = size - 11 + i % 3, c = Math.floor(i / 3);
      set(a, c, dark); set(c, a, dark);
    }
  }
  // dane zygzakiem od prawego dolnego rogu
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && i < codewords.length * 8) {
          mod[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }
  const applyMask = m => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (fn[y][x]) continue;
      let inv;
      switch (m) {
        case 0: inv = (x + y) % 2 === 0; break;
        case 1: inv = y % 2 === 0; break;
        case 2: inv = x % 3 === 0; break;
        case 3: inv = (x + y) % 3 === 0; break;
        case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: inv = (x * y) % 2 + (x * y) % 3 === 0; break;
        case 6: inv = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
        default: inv = ((x + y) % 2 + (x * y) % 3) % 2 === 0;
      }
      if (inv) mod[y][x] = !mod[y][x];
    }
  };
  let best = forcedMask;
  if (best < 0) {
    let min = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const p = penalty(mod, size);
      if (p < min) { min = p; best = m; }
      applyMask(m);
    }
  }
  applyMask(best); drawFormat(best);
  return { size, modules: mod, version: ver, mask: best };
}

/** Punkty karne maski (im mniej, tym kod łatwiejszy do odczytu). */
function penalty(m, size) {
  let p = 0;
  const line = get => {
    let run = 1, s = 0;
    for (let i = 1; i < size; i++) {
      if (get(i) === get(i - 1)) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else run = 1;
    }
    // wzorzec podobny do znacznika: 1011101 z 4 jasnymi po jednej stronie
    for (let i = 0; i + 10 < size; i++) {
      const seq = [];
      for (let k = 0; k < 11; k++) seq.push(get(i + k) ? 1 : 0);
      const str = seq.join('');
      if (str === '10111010000' || str === '00001011101') s += 40;
    }
    return s;
  };
  for (let y = 0; y < size; y++) p += line(x => m[y][x]);
  for (let x = 0; x < size; x++) p += line(y => m[y][x]);
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
  }
  let dark = 0;
  for (const row of m) for (const c of row) if (c) dark++;
  p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  return p;
}

/** Kod QR jako SVG (z marginesem 4 modułów, wymagany przez skanery). */
export function qrSVG(text, { label = '' } = {}) {
  const { size, modules } = qrMatrix(text);
  const q = 4, n = size + q * 2;
  let path = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) path += `M${x + q},${y + q}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="Kod QR ${label}">
    <rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
