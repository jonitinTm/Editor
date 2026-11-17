// Revelado (como un filtro "Camera Raw"): balance de blancos, tono, presencia,
// viñeta, enfoque y reducción de ruido en una sola pasada.

import { blurChannel, gaussianBlur } from './blur';

export interface DevelopParams {
  temp: number; tint: number; exposure: number; contrast: number;
  highlights: number; shadows: number; whites: number; blacks: number;
  clarity: number; dehaze: number; vibrance: number; saturation: number;
  vignette: number; sharpen: number; noise: number;
}
export const DEVELOP_DEFAULTS: DevelopParams = { temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0, vignette: 0, sharpen: 0, noise: 0 };

const toLin = new Float32Array(256).map((_, i) => { const v = i / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
const toSrgb = (v: number) => v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
const clamp01 = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Luminancia desenfocada (para los ajustes locales: sombras, iluminaciones, claridad). */
function blurredLum(L: Float32Array, w: number, h: number, r: number) {
  const out = Float32Array.from(L), tmp = new Float32Array(L.length);
  blurChannel(out, tmp, w, h, r);
  return out;
}

export function develop(img: ImageData, p: DevelopParams) {
  const { width: w, height: h, data: d } = img, n = w * h;
  // 1) reducción de ruido y enfoque (antes del tono, como en el revelado)
  if (p.noise > 0) {
    const bl = new ImageData(new Uint8ClampedArray(d), w, h); gaussianBlur(bl, 1 + p.noise / 50);
    const b = bl.data, k = p.noise / 100;
    for (let i = 0; i < d.length; i += 4) {
      // se suaviza más donde la diferencia es pequeña (ruido) y menos en los bordes
      const diff = Math.abs(d[i] - b[i]) + Math.abs(d[i + 1] - b[i + 1]) + Math.abs(d[i + 2] - b[i + 2]);
      const m = k * (1 - smooth(10, 60 + k * 60, diff));
      for (let c = 0; c < 3; c++) d[i + c] = d[i + c] + (b[i + c] - d[i + c]) * m;
    }
  }
  if (p.sharpen > 0) {
    const bl = new ImageData(new Uint8ClampedArray(d), w, h); gaussianBlur(bl, 1);
    const b = bl.data, k = p.sharpen / 100;
    for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = d[i + c] + (d[i + c] - b[i + c]) * k;
  }
  // 2) luminancia y sus versiones desenfocadas
  const L = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) L[i] = (0.2126 * toLin[d[j]] + 0.7152 * toLin[d[j + 1]] + 0.0722 * toLin[d[j + 2]]);
  const needLocal = p.highlights || p.shadows || p.dehaze;
  const Lb = needLocal ? blurredLum(L, w, h, Math.max(4, Math.min(w, h) / 40)) : null;
  const Lc = p.clarity ? blurredLum(L, w, h, Math.max(3, Math.min(w, h) / 120)) : null;
  const wr = 1 + p.temp / 100 * 0.45, wb = 1 - p.temp / 100 * 0.45, wg = 1 - p.tint / 100 * 0.3;
  const ev = 2 ** p.exposure, ct = p.contrast / 100, hz = p.dehaze / 100;
  const cx = w / 2, cy = h / 2, vg = p.vignette / 100, sat = p.saturation / 100, vib = p.vibrance / 100;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (d[j + 3] === 0) continue;
    let r = toLin[d[j]] * wr * ev, g = toLin[d[j + 1]] * wg * ev, b = toLin[d[j + 2]] * wb * ev;
    const l0 = Math.max(1e-5, 0.2126 * r + 0.7152 * g + 0.0722 * b);
    // tono en espacio perceptual
    let t = toSrgb(Math.min(1, l0)), tb = Lb ? toSrgb(Math.min(1, Lb[i] * ev)) : t;
    if (p.shadows) t += p.shadows / 100 * 0.45 * (1 - tb) ** 2 * (1 - t) * (p.shadows > 0 ? 1 : t * 2);
    if (p.highlights) t += p.highlights / 100 * 0.45 * tb ** 2 * t * (p.highlights > 0 ? (1 - t) * 2 : 1);
    if (p.whites) t += p.whites / 100 * 0.25 * t ** 3;
    if (p.blacks) t += p.blacks / 100 * 0.25 * (1 - t) ** 3;
    if (ct) { const s = t - 0.5; t = 0.5 + s * (1 + ct) - (ct > 0 ? ct * 0.6 * s * Math.abs(s) * 2 : 0); }
    if (Lc) { const lc = toSrgb(Math.min(1, Lc[i] * ev)); t += p.clarity / 100 * 1.2 * (t - lc) * (1 - Math.abs(2 * t - 1)); }
    if (hz) { if (hz > 0) { const a = tb * 0.6 * hz; t = (t - a) / (1 - a); } else t = t * (1 + hz * 0.5) - hz * 0.5 * 0.85; }
    if (vg) { const dx = (i % w - cx) / cx, dy = ((i / w | 0) - cy) / cy, rr = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2; t *= 1 + vg * smooth(0.35, 1.1, rr) * (vg < 0 ? 1 : 0.8); }
    t = clamp01(t);
    // la luminancia nueva se reparte en los tres canales manteniendo el color
    const tl = t <= 0.04045 ? t / 12.92 : ((t + 0.055) / 1.055) ** 2.4, k = tl / l0;
    r *= k; g *= k; b *= k;
    // la neblina también apaga o aviva el color
    let sr = toSrgb(clamp01(r)), sg = toSrgb(clamp01(g)), sb = toSrgb(clamp01(b));
    const sAdj = sat + hz * 0.35;
    if (sAdj || vib) {
      const m = (sr + sg + sb) / 3, mx = Math.max(sr, sg, sb), mn = Math.min(sr, sg, sb), cur = mx > 0 ? (mx - mn) / mx : 0;
      const f = 1 + sAdj + vib * (1 - cur) * (vib > 0 ? 1.2 : 1);
      sr = m + (sr - m) * f; sg = m + (sg - m) * f; sb = m + (sb - m) * f;
    }
    d[j] = clamp01(sr) * 255 + 0.5; d[j + 1] = clamp01(sg) * 255 + 0.5; d[j + 2] = clamp01(sb) * 255 + 0.5;
  }
}
