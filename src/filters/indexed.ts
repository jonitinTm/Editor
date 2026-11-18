// Color indexado: reduce la imagen a una paleta (adaptable, web, grises, blanco y negro o personalizada)
// con tramado opcional (difusión de Floyd–Steinberg o motivo ordenado de Bayer).

import { buildPalette } from '../io/gif';

export function makePalette(img: ImageData, kind: string, n: number): number[][] {
  if (kind === 'bw') return [[0, 0, 0], [255, 255, 255]];
  if (kind === 'gray') return Array.from({ length: n }, (_, i) => { const v = Math.round(i * 255 / Math.max(1, n - 1)); return [v, v, v]; });
  if (kind === 'web') { const p: number[][] = []; for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) p.push([r * 51, g * 51, b * 51]); return p; }
  if (kind === 'retro') return ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'].map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
  if (kind === 'gameboy') return [[15, 56, 15], [48, 98, 48], [139, 172, 15], [155, 188, 15]];
  return buildPalette([img], Math.max(2, Math.min(256, n))).palette;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function indexColors(img: ImageData, p: { palette: string; colors: number; dither: string; amount: number }) {
  const pal = makePalette(img, p.palette, p.colors), n = pal.length;
  const { width: w, height: h, data: d } = img;
  const cache = new Map<number, number>();
  const nearest = (r: number, g: number, b: number) => {
    const key = (r >> 2) << 12 | (g >> 2) << 6 | (b >> 2); const c = cache.get(key); if (c !== undefined) return c;
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const q = pal[i], dr = r - q[0], dg = g - q[1], db = b - q[2], e = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11; if (e < bd) { bd = e; best = i; } }
    cache.set(key, best); return best;
  };
  const amt = (p.amount ?? 100) / 100;
  if (p.dither === 'diffusion') {
    const err = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4;
      if (d[o + 3] < 8) continue;
      const r = Math.max(0, Math.min(255, d[o] + err[i * 3])), g = Math.max(0, Math.min(255, d[o + 1] + err[i * 3 + 1])), b = Math.max(0, Math.min(255, d[o + 2] + err[i * 3 + 2]));
      const q = pal[nearest(r | 0, g | 0, b | 0)];
      const er = (r - q[0]) * amt, eg = (g - q[1]) * amt, eb = (b - q[2]) * amt;
      d[o] = q[0]; d[o + 1] = q[1]; d[o + 2] = q[2];
      const push = (dx: number, dy: number, k: number) => { const xx = x + dx, yy = y + dy; if (xx < 0 || xx >= w || yy >= h) return; const j = (yy * w + xx) * 3; err[j] += er * k; err[j + 1] += eg * k; err[j + 2] += eb * k; };
      push(1, 0, 7 / 16); push(-1, 1, 3 / 16); push(0, 1, 5 / 16); push(1, 1, 1 / 16);
    }
    return;
  }
  // amplitud del motivo: la distancia típica entre colores de la paleta
  const spread = p.dither === 'pattern' ? 255 / Math.cbrt(n) * amt : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4; if (d[o + 3] < 8) continue;
    const t = spread ? (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.47) * spread : 0;
    const q = pal[nearest(Math.max(0, Math.min(255, d[o] + t)) | 0, Math.max(0, Math.min(255, d[o + 1] + t)) | 0, Math.max(0, Math.min(255, d[o + 2] + t)) | 0)];
    d[o] = q[0]; d[o + 1] = q[1]; d[o + 2] = q[2];
  }
}
