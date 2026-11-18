// Revelado de Nikon NEF (compresión sin pérdida y con pérdida de Nikon): códigos Huffman con las tablas
// de Nikon, predicción por columnas pares e impares y curva de linealización de las notas del fabricante.

import { Tiff } from './dng';
import { developBayer } from './cr2';

const NIKON_TREE: number[][] = [
  [0, 1, 5, 1, 1, 1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 0, 5, 4, 3, 6, 2, 7, 1, 0, 8, 9, 11, 10, 12],                     // 12 bits con pérdida
  [0, 1, 5, 1, 1, 1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 0, 0x39, 0x5a, 0x38, 0x27, 0x16, 5, 4, 3, 2, 1, 0, 11, 12, 12],      // 12 bits con pérdida (tras el corte)
  [0, 1, 4, 2, 3, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 4, 6, 3, 7, 2, 8, 1, 9, 0, 10, 11, 12],                      // 12 bits sin pérdida
  [0, 1, 4, 3, 1, 1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 0, 5, 6, 4, 7, 8, 3, 9, 2, 1, 0, 10, 11, 12, 13, 14],              // 14 bits con pérdida
  [0, 1, 5, 1, 1, 1, 1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 8, 0x5c, 0x4b, 0x3a, 0x29, 7, 6, 5, 4, 3, 2, 1, 0, 13, 14],     // 14 bits con pérdida (tras el corte)
  [0, 1, 4, 2, 2, 3, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 7, 6, 8, 5, 9, 4, 10, 3, 11, 12, 2, 0, 1, 13, 14],              // 14 bits sin pérdida
];

export function isNef(b: Uint8Array) {
  if (b.length < 16 || !((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d))) return false;
  try { const t = new Tiff(b); return String(t.ifd(t.u32(4)).tags[271] ?? '').toUpperCase().startsWith('NIKON'); } catch { return false; }
}

/** Decodificador Huffman canónico (16 longitudes + símbolos). */
function makeDecoder(src: number[]) {
  const counts = src.slice(0, 16), syms = src.slice(16), map = new Map<number, number>();
  let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) { for (let i = 0; i < counts[len - 1]; i++) map.set((len << 16) | code++, syms[k++]); code <<= 1; }
  return map;
}

/** Devuelve también los valores del sensor (para comprobar el decodificador). */
export let lastNefSensor: Uint16Array | null = null;
export function decodeNef(b: Uint8Array): ImageData {
  const t = new Tiff(b);
  const ifd0 = t.ifd(t.u32(4)).tags, subs = ((ifd0[330] as number[] | undefined) ?? []).map(o => t.ifd(o).tags);
  const raw = [ifd0, ...subs].find(f => (f[259] as number[] | undefined)?.[0] === 34713 || ((f[262] as number[] | undefined)?.[0] === 32803));
  if (!raw) throw new Error('No se encuentran los datos del sensor en este NEF');
  const W = (raw[256] as number[])[0], H = (raw[257] as number[])[0], bps = (raw[258] as number[])[0], comp = (raw[259] as number[])[0];
  const off = (raw[273] as number[])[0];
  const sens = new Uint16Array(W * H);
  let tagBlack = -1;
  if (comp === 1) {
    // sin comprimir (16 bits por valor)
    for (let i = 0; i < W * H; i++) sens[i] = t.u16(off + i * 2);
  } else if (comp === 34713) {
    // notas de Nikon: «Nikon\0» + cabecera TIFF propia; la etiqueta 0x96 lleva la linealización
    const exifOff = (ifd0[34665] as number[] | undefined)?.[0]; if (!exifOff) throw new Error('Faltan las notas del fabricante');
    let mnOff = 0; { const n = t.u16(exifOff); for (let i = 0; i < n; i++) { const e = exifOff + 2 + i * 12; if (t.u16(e) === 37500) mnOff = t.u32(e + 8); } }
    if (!mnOff || String.fromCharCode(...b.subarray(mnOff, mnOff + 5)) !== 'Nikon') throw new Error('Notas de Nikon no reconocidas');
    const base = mnOff + 10, mt = new Tiff(b.subarray(base)), mn = mt.ifd(mt.u32(4));
    let meta = -1; { const n = mt.u16(mt.u32(4)); for (let i = 0; i < n; i++) { const e = mt.u32(4) + 2 + i * 12; if (mt.u16(e) === 0x96) meta = base + mt.u32(e + 8); } }
    // nivel de negro guardado por la cámara (0x3D, cuatro valores)
    const bl = mn.tags[0x3d] as number[] | undefined; if (bl && bl.length >= 4) tagBlack = (bl[0] + bl[1] + bl[2] + bl[3]) / 4;
    if (meta < 0) throw new Error('Falta la tabla de linealización de Nikon');
    const be = b[base] === 0x4d, r16 = (p: number) => be ? (b[p] << 8) | b[p + 1] : b[p] | (b[p + 1] << 8);
    let p = meta; const ver0 = b[p++], ver1 = b[p++];
    if (ver0 === 0x49 || ver1 === 0x58) p += 2110;
    let tree = ver0 === 0x46 ? 2 : 0; if (bps === 14) tree += 3;
    const vpred = [[r16(p), r16(p + 2)], [r16(p + 4), r16(p + 6)]]; p += 8;
    let max = (1 << bps) & 0x7fff; const csize = r16(p); p += 2;
    const curve = new Uint16Array(0x10000); for (let i = 0; i < curve.length; i++) curve[i] = i;
    let split = 0, step = csize > 1 ? Math.floor(max / (csize - 1)) : 0;
    if (ver0 === 0x44 && ver1 === 0x20 && step > 0) {
      for (let i = 0; i < csize; i++) curve[i * step] = r16(p + i * 2);
      for (let i = 0; i < max; i++) curve[i] = Math.floor((curve[i - i % step] * (step - i % step) + curve[i - i % step + step] * (i % step)) / step);
      split = r16(meta + 562);
    } else if (ver0 !== 0x46 && csize <= 0x4001) { for (let i = 0; i < csize; i++) curve[i] = r16(p + i * 2); max = csize; }
    while (max > 2 && curve[max - 2] === curve[max - 1]) max--;
    let huff = makeDecoder(NIKON_TREE[tree]);
    // lectura de bits de mayor a menor, sin relleno tras 0xff
    let pos = off, acc = 0, nb = 0;
    const getbits = (n: number) => { if (n <= 0) return 0; while (nb < n) { acc = ((acc << 8) | (b[pos++] ?? 0)) >>> 0; nb += 8; if (nb > 24) { /* evita desbordar */ } } const v = (acc >>> (nb - n)) & ((1 << n) - 1); nb -= n; acc &= (1 << nb) - 1; return v; };
    const gethuff = () => { let code = 0; for (let len = 1; len <= 16; len++) { code = (code << 1) | getbits(1); const s = huff.get((len << 16) | code); if (s !== undefined) return s; } throw new Error('Datos de NEF dañados'); };
    let min = 0, bad = 0; const hpred = [0, 0];
    for (let row = 0; row < H; row++) {
      if (split && row === split) { huff = makeDecoder(NIKON_TREE[tree + 1]); min = 16; max += min << 1; }
      for (let col = 0; col < W; col++) {
        const i = gethuff(), len = i & 15, shl = i >> 4;
        let diff = (((getbits(len - shl) << 1) + 1) << shl) >> 1;
        if (len === 0) diff = 0;
        else if ((diff & (1 << (len - 1))) === 0) diff -= (1 << len) - (shl ? 0 : 1);
        if (col < 2) { vpred[row & 1][col] += diff; hpred[col] = vpred[row & 1][col]; }
        else hpred[col & 1] += diff;
        const hv = (hpred[col & 1] << 16) >> 16;
        // red de seguridad: valores imposibles indican que el archivo no se ha entendido
        if (hv + min < 0 || hv + min >= max) bad++;
        sens[row * W + col] = curve[Math.max(0, Math.min(0x3fff, hv))];
      }
    }
    if (bad > W * H * 0.001) throw new Error('el formato de este NEF no se ha podido interpretar');
  } else throw new Error('Compresión de NEF no admitida (' + comp + ')');
  lastNefSensor = sens;
  // negro: el de la cámara o el de fábrica (600 en los modelos de 14 bits actuales, 0 en los antiguos)
  let lo = 0xffff; for (let i = 0; i < sens.length; i += 5) if (sens[i] < lo) lo = sens[i];
  let hi = 0; for (let i = 0; i < sens.length; i += 5) if (sens[i] > hi) hi = sens[i];
  const black = tagBlack >= 0 ? tagBlack : bps === 14 && lo >= 550 ? 600 : 0;
  return developBayer(sens, W, { x: 0, y: 0, w: W, h: H }, black, Math.max(black + 64, hi), (ifd0[274] as number[] | undefined)?.[0] ?? 1, null);
}
