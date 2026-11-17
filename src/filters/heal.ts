// Corrección de píxeles (pincel corrector, corrector puntual y relleno según contenido).
// Idea: se copia la textura de otra zona (C) y se corrige su color/luz para que
// encaje con lo que rodea al hueco. La corrección es la diferencia entre el
// original y la copia medida en el borde, extendida suavemente hacia dentro.

import { blurChannel } from './blur';

/** Rellena los valores desconocidos (known=0) por convolución normalizada a escalas crecientes. */
function fillUnknown(vals: Float32Array, known: Float32Array, w: number, h: number) {
  const n = w * h, done = new Uint8Array(n), tmp = new Float32Array(n);
  let left = 0; for (let i = 0; i < n; i++) if (known[i] > 0.5) done[i] = 1; else left++;
  for (let r = 2; left > 0 && r < Math.max(w, h) * 2; r *= 1.6) {
    const num = new Float32Array(n), den = new Float32Array(n);
    for (let i = 0; i < n; i++) { const k = known[i] > 0.5 ? 1 : 0; num[i] = vals[i] * k; den[i] = k; }
    blurChannel(num, tmp, w, h, r); blurChannel(den, tmp, w, h, r);
    for (let i = 0; i < n; i++) if (!done[i] && den[i] > 0.08) { vals[i] = num[i] / den[i]; done[i] = 1; left--; }
  }
  if (left > 0) for (let i = 0; i < n; i++) if (!done[i]) vals[i] = 0;
  // Suavizado final del interior para que no se noten los saltos entre escalas
  const inner = new Float32Array(n); for (let i = 0; i < n; i++) inner[i] = vals[i];
  blurChannel(inner, tmp, w, h, 2);
  for (let i = 0; i < n; i++) if (known[i] <= 0.5) vals[i] = inner[i];
}

/**
 * O = original, C = copia de textura (mismo tamaño), hole = cuánto corregir cada píxel (0..1).
 * Devuelve la imagen corregida.
 */
export function heal(O: ImageData, C: ImageData, hole: Float32Array): ImageData {
  const { width: w, height: h } = O, n = w * h, o = O.data, c = C.data;
  const known = new Float32Array(n); for (let i = 0; i < n; i++) known[i] = hole[i] < 0.02 ? 1 : 0;
  const out = new ImageData(new Uint8ClampedArray(o), w, h), d = out.data;
  for (let ch = 0; ch < 4; ch++) {
    const diff = new Float32Array(n);
    for (let i = 0; i < n; i++) diff[i] = o[i * 4 + ch] - c[i * 4 + ch];
    fillUnknown(diff, known, w, h);
    for (let i = 0; i < n; i++) { const a = hole[i]; if (a > 0) d[i * 4 + ch] = o[i * 4 + ch] * (1 - a) + (c[i * 4 + ch] + diff[i]) * a; }
  }
  return out;
}

/**
 * Busca una zona cercana de donde copiar textura: la que mejor encaja con el
 * borde del hueco. `full` es la imagen completa; (rx, ry) la esquina de la región.
 */
export function findSource(full: ImageData, region: { x: number; y: number; w: number; h: number }, hole: Float32Array, holeBox: { x: number; y: number; w: number; h: number }): { dx: number; dy: number } {
  const W = full.width, H = full.height, f = full.data;
  const ring: number[] = [];
  const step = Math.max(1, Math.round(Math.sqrt(region.w * region.h / 1500)));
  for (let y = 0; y < region.h; y += step) for (let x = 0; x < region.w; x += step) if (hole[y * region.w + x] < 0.02) ring.push(x, y);
  const holePts: number[] = [];
  for (let y = 0; y < region.h; y += step) for (let x = 0; x < region.w; x += step) if (hole[y * region.w + x] >= 0.02) holePts.push(x, y);
  const base = Math.max(holeBox.w, holeBox.h);
  let best = { dx: Math.round(base * 1.2) + 4, dy: 0 }, bestScore = Infinity;
  for (const dist of [1.15, 1.6, 2.3]) for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2, dx = Math.round(Math.cos(a) * (base * dist + 4)), dy = Math.round(Math.sin(a) * (base * dist + 4));
    if (region.x + dx < 0 || region.y + dy < 0 || region.x + region.w + dx > W || region.y + region.h + dy > H) continue;
    let s = 0;
    for (let i = 0; i < ring.length; i += 2) {
      const p = ((region.y + ring[i + 1]) * W + region.x + ring[i]) * 4, q = ((region.y + ring[i + 1] + dy) * W + region.x + ring[i] + dx) * 4;
      s += Math.abs(f[p] - f[q]) + Math.abs(f[p + 1] - f[q + 1]) + Math.abs(f[p + 2] - f[q + 2]);
    }
    // evita fuentes con mucho contraste interno (bordes que se copiarían dentro del hueco)
    let mean = 0, v = 0, cnt = 0;
    for (let i = 0; i < holePts.length; i += 2) { const q = ((region.y + holePts[i + 1] + dy) * W + region.x + holePts[i] + dx) * 4; const l = f[q] * 0.3 + f[q + 1] * 0.59 + f[q + 2] * 0.11; mean += l; v += l * l; cnt++; }
    if (cnt) { mean /= cnt; v = v / cnt - mean * mean; }
    s = s / Math.max(1, ring.length / 2) + Math.sqrt(Math.max(0, v)) * 0.8 + dist * 2;
    if (s < bestScore) { bestScore = s; best = { dx, dy }; }
  }
  return best;
}
