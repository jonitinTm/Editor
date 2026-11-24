// Relleno por inundación: devuelve una máscara con los píxeles parecidos al
// del punto de partida (contiguos o en toda la imagen).

import { makeCanvas, ctx2d } from '../core/canvas';

export function floodMask(src: ImageData, sx: number, sy: number, tolerance: number, contiguous: boolean): { canvas: HTMLCanvasElement; count: number } | null {
  const { width: w, height: h, data: d } = src;
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const i0 = (sy * w + sx) * 4;
  const r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2], a0 = d[i0 + 3];
  const tol = tolerance;
  const match = (i: number) => {
    const a = d[i + 3];
    if (a0 === 0 && a === 0) return true;
    return Math.abs(d[i] - r0) <= tol && Math.abs(d[i + 1] - g0) <= tol && Math.abs(d[i + 2] - b0) <= tol && Math.abs(a - a0) <= tol;
  };
  const out = new Uint8Array(w * h);
  let count = 0;
  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (match(p * 4)) { out[p] = 1; count++; }
  } else {
    // Relleno por líneas (scanline) con pila explícita
    const stack: number[] = [sx, sy];
    while (stack.length) {
      const y = stack.pop()!, x0 = stack.pop()!;
      let x = x0;
      const row = y * w;
      if (out[row + x] || !match((row + x) * 4)) continue;
      while (x > 0 && !out[row + x - 1] && match((row + x - 1) * 4)) x--;
      let upOpen = false, downOpen = false;
      for (; x < w && !out[row + x] && match((row + x) * 4); x++) {
        out[row + x] = 1; count++;
        if (y > 0) {
          const m = !out[row - w + x] && match((row - w + x) * 4);
          if (m && !upOpen) { stack.push(x, y - 1); upOpen = true; } else if (!m) upOpen = false;
        }
        if (y < h - 1) {
          const m = !out[row + w + x] && match((row + w + x) * 4);
          if (m && !downOpen) { stack.push(x, y + 1); downOpen = true; } else if (!m) downOpen = false;
        }
      }
    }
  }
  const c = makeCanvas(w, h);
  const img = ctx2d(c).createImageData(w, h);
  const o = img.data;
  for (let p = 0; p < w * h; p++) if (out[p]) { const j = p * 4; o[j] = o[j + 1] = o[j + 2] = o[j + 3] = 255; }
  ctx2d(c).putImageData(img, 0, 0);
  return { canvas: c, count };
}

/** Distancia ≤ r a algún píxel marcado (cuadrado), en O(n): pasada por filas y luego por columnas. */
function dilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return m;
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w; let last = -1e9;
    for (let x = 0; x < w; x++) { if (m[row + x]) last = x; if (x - last <= r) tmp[row + x] = 1; }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) { if (m[row + x]) last = x; if (last - x <= r) tmp[row + x] = 1; }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) { if (tmp[y * w + x]) last = y; if (y - last <= r) out[y * w + x] = 1; }
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) { if (tmp[y * w + x]) last = y; if (last - y <= r) out[y * w + x] = 1; }
  }
  return out;
}

/** Relleno que «cierra huecos»: las líneas se engordan `gap` píxeles para que el color no se escape por
 *  pequeñas aberturas del dibujo; luego el relleno se vuelve a ensanchar hasta tocar las líneas reales. */
export function floodMaskGaps(src: ImageData, sx: number, sy: number, tolerance: number, gap: number): { canvas: HTMLCanvasElement; count: number } | null {
  if (gap <= 0) return floodMask(src, sx, sy, tolerance, true);
  const { width: w, height: h, data: d } = src;
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const i0 = (sy * w + sx) * 4, r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2], a0 = d[i0 + 3], tol = tolerance;
  const n = w * h, wall = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const a = d[i + 3];
    if (a0 === 0 && a === 0) continue;
    if (Math.abs(d[i] - r0) > tol || Math.abs(d[i + 1] - g0) > tol || Math.abs(d[i + 2] - b0) > tol || Math.abs(a - a0) > tol) wall[p] = 1;
  }
  const thick = dilate(wall, w, h, gap);
  // si se toca justo al lado de una línea, se busca el hueco libre más cercano
  let seed = sy * w + sx;
  if (thick[seed]) { let best = -1, bd = 1e9; for (let dy = -gap * 2; dy <= gap * 2; dy++) for (let dx = -gap * 2; dx <= gap * 2; dx++) { const x = sx + dx, y = sy + dy; if (x < 0 || y < 0 || x >= w || y >= h) continue; const q = y * w + x; if (!thick[q] && !wall[q] && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = q; } } if (best < 0) return floodMask(src, sx, sy, tolerance, true); seed = best; }
  const reg = new Uint8Array(n), stack = [seed]; reg[seed] = 1;
  while (stack.length) {
    const p = stack.pop()!, x = p % w;
    if (x > 0 && !reg[p - 1] && !thick[p - 1]) { reg[p - 1] = 1; stack.push(p - 1); }
    if (x < w - 1 && !reg[p + 1] && !thick[p + 1]) { reg[p + 1] = 1; stack.push(p + 1); }
    if (p >= w && !reg[p - w] && !thick[p - w]) { reg[p - w] = 1; stack.push(p - w); }
    if (p < n - w && !reg[p + w] && !thick[p + w]) { reg[p + w] = 1; stack.push(p + w); }
  }
  const grown = dilate(reg, w, h, gap);
  const c = makeCanvas(w, h), img = ctx2d(c).createImageData(w, h), o = img.data;
  let count = 0;
  for (let p = 0; p < n; p++) if (grown[p] && !wall[p]) { const j = p * 4; o[j] = o[j + 1] = o[j + 2] = o[j + 3] = 255; count++; }
  ctx2d(c).putImageData(img, 0, 0);
  return { canvas: c, count };
}
