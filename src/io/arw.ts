// Revelado de Sony ARW (formato comprimido ARW2): cada fila va en bloques de 16 bytes con 16 píxeles del
// mismo color (máximo, mínimo, sus posiciones y 14 diferencias de 7 bits); después pasa por la curva
// de tono de Sony. El equilibrio de blancos se calcula sobre la foto.

import { Tiff } from './dng';
import { developBayer } from './cr2';

export function isArw(b: Uint8Array) {
  if (b.length < 16 || !((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d))) return false;
  try { const t = new Tiff(b); const i0 = t.ifd(t.u32(4)).tags; return String(i0[271] ?? '').toUpperCase().startsWith('SONY'); } catch { return false; }
}

export function decodeArw(b: Uint8Array): ImageData {
  const t = new Tiff(b);
  const ifds: Record<number, number[] | string>[] = []; let o = t.u32(4);
  for (let k = 0; k < 8 && o && o < b.length; k++) { const r = t.ifd(o); ifds.push(r.tags); for (const s of (r.tags[330] as number[] | undefined) ?? []) { try { ifds.push(t.ifd(s).tags); } catch { /* */ } } o = r.next; }
  const raw = ifds.find(f => (f[259] as number[] | undefined)?.[0] === 32767);
  if (!raw) throw new Error('Este ARW no usa el formato comprimido de Sony que se puede revelar');
  const W = (raw[256] as number[])[0], H = (raw[257] as number[])[0], off = (raw[273] as number[])[0], bytes = (raw[279] as number[])[0];
  if (bytes < W * H) throw new Error('Formato de ARW no admitido (sin comprimir o antiguo)');
  // curva de tono de Sony (etiqueta 0x7010): 4 puntos; sin ella, la lineal
  const sc = [0, 0, 0, 0, 0, 4095];
  const tc = (raw[0x7010] ?? ifds[0][0x7010]) as number[] | undefined;
  if (tc && tc.length >= 4) for (let c = 0; c < 4; c++) sc[c + 1] = (tc[c] >> 2) & 0xfff;
  const curve = new Uint32Array(0x10000); for (let i = 0; i < curve.length; i++) curve[i] = i;
  for (let i = 0; i < 5; i++) for (let j = sc[i] + 1; j <= sc[i + 1]; j++) curve[j] = curve[j - 1] + (1 << i);
  const sens = new Uint16Array(W * H), pix = new Uint16Array(16);
  const g2 = (p: number) => b[p] | (b[p + 1] << 8), g4 = (p: number) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
  for (let row = 0; row < H; row++) {
    let dp = off + row * W, col = 0;
    while (col < W - 30) {
      const val = g4(dp), max = val & 0x7ff, min = (val >>> 11) & 0x7ff, imax = (val >>> 22) & 0x0f, imin = (val >>> 26) & 0x0f;
      let sh = 0; while (sh < 4 && (0x80 << sh) <= max - min) sh++;
      for (let i = 0, bit = 30; i < 16; i++) {
        if (i === imax) pix[i] = max;
        else if (i === imin) pix[i] = min;
        else { let v = (((g2(dp + (bit >> 3)) >> (bit & 7)) & 0x7f) << sh) + min; if (v > 0x7ff) v = 0x7ff; pix[i] = v; bit += 7; }
      }
      for (let i = 0; i < 16; i++, col += 2) sens[row * W + col] = curve[pix[i] << 1] >> 2;
      col -= col & 1 ? 1 : 31;
      dp += 16;
    }
  }
  // negro y blanco: etiquetas de Sony si están (0x7310, 0x787f); si no, se miden
  const bl = (raw[0x7310] ?? ifds[0][0x7310]) as number[] | undefined, wl = (raw[0x787f] ?? ifds[0][0x787f]) as number[] | undefined;
  let black = bl && bl.length ? bl.reduce((a, v) => a + v, 0) / bl.length / 4 : -1, white = wl && wl.length ? wl[0] / 4 : -1;
  if (black < 0 || white <= black) {
    // valores de fábrica de Sony: negro 128 y blanco 4095 en la escala de 12 bits de la curva
    const top = curve[4094] >> 2;
    if (black < 0) black = 128 * top / 4095;
    if (white <= black) white = top;
  }
  return developBayer(sens, W, { x: 0, y: 0, w: W, h: H }, black, white, (ifds[0][274] as number[] | undefined)?.[0] ?? 1, null);
}
