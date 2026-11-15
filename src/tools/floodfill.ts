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
