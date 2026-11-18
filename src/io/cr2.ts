// Revelado de Canon CR2: los datos del sensor van en JPEG sin pérdida repartido en franjas verticales
// («slices»). Los márgenes del sensor salen de las notas del fabricante (SensorInfo); el negro se mide
// en la zona tapada del sensor y el equilibrio de blancos se calcula sobre la propia foto.

import { Tiff, ljpeg } from './dng';

export function isCr2(b: Uint8Array) { return b.length > 16 && b[0] === 0x49 && b[1] === 0x49 && b[8] === 0x43 && b[9] === 0x52; }

/** Revela un CR2 a una imagen de 8 bits. */
export function decodeCr2(b: Uint8Array): ImageData {
  const t = new Tiff(b);
  // IFD 0 (orientación), y el cuarto IFD con los datos del sensor
  const ifds: Record<number, number[] | string>[] = []; let o = t.u32(4);
  for (let k = 0; k < 6 && o && o < b.length; k++) { const r = t.ifd(o); ifds.push(r.tags); o = r.next; }
  const raw = ifds.find((f, i) => i >= 3 && f[273]) ?? ifds[3];
  if (!raw || !raw[273]) throw new Error('No se encuentran los datos del sensor en este CR2');
  const off = (raw[273] as number[])[0], len = (raw[279] as number[])[0];
  const j = ljpeg(b, off, off + len);
  // reparto en franjas: [número de franjas, ancho de cada una, ancho de la última]
  const sl = raw[50752] as number[] | undefined;
  const total = j.w * j.comps, H = j.h;
  const W = sl && sl[0] ? sl[0] * sl[1] + sl[2] : total;
  const sens = new Uint16Array(W * H);
  if (sl && sl[0]) {
    let k = 0;
    for (let s = 0; s <= sl[0]; s++) {
      const sw = s < sl[0] ? sl[1] : sl[2], x0 = s * sl[1];
      for (let y = 0; y < H; y++) for (let x = 0; x < sw; x++) sens[y * W + x0 + x] = j.data[k++];
    }
  } else sens.set(j.data.subarray(0, W * H));
  // márgenes del sensor (notas de Canon, etiqueta 0x00E0)
  let left = 0, top = 0, right = W - 1, bottom = H - 1, camWb: number[] | null = null;
  try {
    const exif = (ifds[0][34665] as number[] | undefined)?.[0];
    if (exif) {
      // la nota del fabricante es un IFD; se busca su posición con la del valor de la etiqueta
      const mnOff = findMakerNote(t, exif);
      if (mnOff) {
        const mn = t.ifd(mnOff).tags, si = mn[0x00e0] as number[] | undefined;
        if (si && si.length >= 9 && si[1] === W) { left = si[5]; top = si[6]; right = si[7]; bottom = si[8]; }
        // equilibrio de blancos de la toma (ColorData, 0x4001): la posición depende de la versión del bloque
        const cd = mn[0x4001] as number[] | undefined;
        if (cd && cd.length > 250) { const i = (cd.length === 582 ? 50 : cd.length === 653 ? 68 : cd.length === 5120 ? 142 : 126) / 2; const r = cd[i], g = (cd[i + 1] + cd[i + 2]) / 2, bl = cd[i + 3]; if (r > 0 && g > 0 && bl > 0) camWb = [r / g, 1, bl / g]; }
      }
    }
  } catch { /* sin notas del fabricante */ }
  // negro: media de la zona tapada de la izquierda (o de las primeras columnas)
  let bs = 0, bn = 0;
  const bx1 = left > 8 ? left - 2 : 0;
  for (let y = top; y <= bottom; y += 4) for (let x = 2; x < bx1; x++) { bs += sens[y * W + x]; bn++; }
  const black = bn ? bs / bn : 0;
  let white = 0; for (let i = 0; i < sens.length; i += 7) if (sens[i] > white) white = sens[i];
  white = Math.max(black + 64, white);
  return developBayer(sens, W, { x: left, y: top, w: right - left + 1, h: bottom - top + 1 }, black, white, (ifds[0][274] as number[] | undefined)?.[0] ?? 1, camWb);
}

/** Posición de la nota del fabricante dentro del IFD EXIF. */
function findMakerNote(t: Tiff, exifOff: number): number | null {
  const n = t.u16(exifOff);
  for (let i = 0; i < n; i++) { const e = exifOff + 2 + i * 12; if (t.u16(e) === 37500) return t.u32(e + 8); }
  return null;
}

/** Revelado genérico de un mosaico RGGB: negros/blancos, balance automático, color, orientación y tono. */
export function developBayer(sens: Uint16Array, W: number, crop: { x: number; y: number; w: number; h: number }, black: number, white: number, ori: number, camWb: number[] | null = null): ImageData {
  const { x: cx, y: cy, w, h } = crop;
  const at = (x: number, y: number) => Math.max(0, (sens[(y + cy) * W + x + cx] - black) / (white - black));
  const col = (x: number, y: number) => ((y + cy) & 1) * 2 + ((x + cx) & 1); // 0 R, 1 G, 2 G, 3 B
  const ch = [0, 1, 1, 2];
  // equilibrio de blancos automático: medias de los tonos medios de cada color
  const sum = [0, 0, 0], cnt = [0, 0, 0];
  for (let y = 0; y < h - 1; y += 6) for (let x = 0; x < w - 1; x += 6) {
    const r = at(x, y), g = (at(x + 1, y) + at(x, y + 1)) / 2, bb = at(x + 1, y + 1), mx = Math.max(r, g, bb);
    if (mx < 0.05 || mx > 0.9) continue;
    const c0 = col(x, y); // se toma el bloque 2×2 completo, sea cual sea su fase
    const vals = [at(x, y), at(x + 1, y), at(x, y + 1), at(x + 1, y + 1)], cols = [c0, col(x + 1, y), col(x, y + 1), col(x + 1, y + 1)];
    for (let k = 0; k < 4; k++) { sum[ch[cols[k]]] += vals[k]; cnt[ch[cols[k]]]++; }
  }
  const mean = sum.map((s, i) => s / Math.max(1, cnt[i])), wb = camWb ?? mean.map(m => (mean[1] || 1) / (m || 1));
  // reconstrucción del color (bilineal) con el balance aplicado
  const rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = [0, 0, 0], n = [0, 0, 0], here = ch[col(x, y)];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const c = ch[col(X, Y)]; if (c === here && (dx || dy)) continue;
      s[c] += at(X, Y); n[c]++;
    }
    const i = (y * w + x) * 3; for (let c = 0; c < 3; c++) rgb[i + c] = (n[c] ? s[c] / n[c] : 0) * wb[c];
  }
  // el color del sensor es menos saturado que sRGB: matriz típica de cámara (conserva el blanco)
  const M = [1.62, -0.48, -0.14, -0.22, 1.52, -0.30, 0.02, -0.52, 1.50];
  // exposición automática suave: el percentil 99 de la luz va a casi blanco
  const lums: number[] = []; for (let i = 0; i < rgb.length; i += 3 * 37) lums.push(rgb[i] * 0.3 + rgb[i + 1] * 0.59 + rgb[i + 2] * 0.11);
  lums.sort((a, b) => a - b); const p99 = lums[Math.floor(lums.length * 0.99)] || 1, exp = Math.min(4, Math.max(0.5, 0.92 / p99));
  const tone = (v: number) => { v = v <= 0 ? 0 : v >= 1 ? 1 : v; const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; return s + (s * s * (3 - 2 * s) - s) * 0.25; };
  const swap = ori >= 5, OW = swap ? h : w, OH = swap ? w : h, out = new ImageData(OW, OH), o = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3, r = rgb[i] * exp, g = rgb[i + 1] * exp, bb = rgb[i + 2] * exp;
    let X = x, Y = y;
    switch (ori) { case 2: X = w - 1 - x; break; case 3: X = w - 1 - x; Y = h - 1 - y; break; case 4: Y = h - 1 - y; break; case 5: X = y; Y = x; break; case 6: X = h - 1 - y; Y = x; break; case 7: X = h - 1 - y; Y = w - 1 - x; break; case 8: X = y; Y = w - 1 - x; break; }
    const k = (Y * OW + X) * 4;
    o[k] = 255 * tone(M[0] * r + M[1] * g + M[2] * bb); o[k + 1] = 255 * tone(M[3] * r + M[4] * g + M[5] * bb); o[k + 2] = 255 * tone(M[6] * r + M[7] * g + M[8] * bb); o[k + 3] = 255;
  }
  return out;
}
