// Ajustes y filtros de píxeles. Cada función recibe una ImageData y la
// modifica en el sitio. Son funciones puras, fáciles de reutilizar más adelante
// en capas de ajuste no destructivas.

import { gaussianBlur } from './blur';

const clamp = (v: number) => v < 0 ? 0 : v > 255 ? 255 : v;

function applyLut(img: ImageData, r: Uint8ClampedArray | number[], g = r, b = r) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = r[d[i]]; d[i + 1] = g[d[i + 1]]; d[i + 2] = b[d[i + 2]]; }
}

export function brightnessContrast(img: ImageData, brightness: number, contrast: number) {
  const lut = new Uint8ClampedArray(256);
  const c = contrast / 100;
  const k = c > 0 ? 1 / (1 - c * 0.99) : 1 + c;
  for (let i = 0; i < 256; i++) {
    let v = i + brightness * (brightness > 0 ? (255 - i) / 255 : i / 255) * 1.0;
    v = (v - 127.5) * k + 127.5;
    lut[i] = clamp(v);
  }
  applyLut(img, lut);
}

export interface LevelsParams { inBlack: number; inWhite: number; gamma: number; outBlack: number; outWhite: number; }
export function levelsLut(p: LevelsParams) {
  const lut = new Uint8ClampedArray(256);
  const range = Math.max(1, p.inWhite - p.inBlack);
  for (let i = 0; i < 256; i++) {
    let v = Math.min(1, Math.max(0, (i - p.inBlack) / range));
    v = Math.pow(v, 1 / p.gamma);
    lut[i] = clamp(p.outBlack + v * (p.outWhite - p.outBlack));
  }
  return lut;
}
export function levels(img: ImageData, p: LevelsParams) { applyLut(img, levelsLut(p)); }

export type CurvePoint = [number, number];
/** Interpolación cúbica monótona (no produce "rebotes" entre puntos). */
export function curveLut(points: CurvePoint[]): Uint8ClampedArray {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  const lut = new Uint8ClampedArray(256);
  if (n < 2) { for (let i = 0; i < 256; i++) lut[i] = i; return lut; }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const dx: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) { dx.push(xs[i + 1] - xs[i] || 1e-6); m.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1e-6)); }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  for (let x = 0; x < 256; x++) {
    let v: number;
    if (x <= xs[0]) v = ys[0];
    else if (x >= xs[n - 1]) v = ys[n - 1];
    else {
      let i = 0; while (x > xs[i + 1]) i++;
      const h = dx[i], u = (x - xs[i]) / h, u2 = u * u, u3 = u2 * u;
      v = (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h * t[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h * t[i + 1];
    }
    lut[x] = clamp(v);
  }
  return lut;
}
export interface CurvesParams { rgb: CurvePoint[]; r: CurvePoint[]; g: CurvePoint[]; b: CurvePoint[]; }
export function curves(img: ImageData, p: CurvesParams) {
  const master = curveLut(p.rgb);
  const r = curveLut(p.r), g = curveLut(p.g), b = curveLut(p.b);
  const rr = new Uint8ClampedArray(256), gg = new Uint8ClampedArray(256), bb = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) { rr[i] = master[r[i]]; gg[i] = master[g[i]]; bb[i] = master[b[i]]; }
  applyLut(img, rr, gg, bb);
}

function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hue2rgb(p: number, q: number, t: number) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}

export function hueSaturation(img: ImageData, hue: number, sat: number, light: number, colorize = false) {
  const d = img.data;
  const hs = hue / 360, ss = sat / 100, ls = light / 100;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let [h, s, l] = rgb2hsl(d[i], d[i + 1], d[i + 2]);
    if (colorize) { h = ((hue + 360) % 360) / 360; s = Math.max(0, (sat + 100) / 200); }
    else {
      h = (h + hs + 1) % 1;
      s = ss > 0 ? s + (1 - s) * ss * s ** 0.5 : s * (1 + ss);
      s = Math.min(1, Math.max(0, s));
    }
    l = ls > 0 ? l + (1 - l) * ls : l * (1 + ls);
    const [r, g, b] = hsl2rgb(h, s, l);
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
}

export function invert(img: ImageData) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
}

/**
 * Blanco y negro por familias de color (rojos, amarillos, verdes, cian, azules, magentas),
 * como en los editores profesionales. Los valores son porcentajes de claridad.
 */
export function blackWhite(img: ImageData, p: { reds: number; yellows: number; greens: number; cyans: number; blues: number; magentas: number } = { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 }) {
  const d = img.data;
  const prim = [p.reds / 100, p.greens / 100, p.blues / 100];
  // secundario entre el canal mayor y el mediano: R+G=amarillo, G+B=cian, R+B=magenta
  const sec = [[0, p.yellows / 100, p.magentas / 100], [p.yellows / 100, 0, p.cyans / 100], [p.magentas / 100, p.cyans / 100, 0]];
  for (let i = 0; i < d.length; i += 4) {
    const c = [d[i], d[i + 1], d[i + 2]];
    let hi = 0, lo = 0;
    for (let k = 1; k < 3; k++) { if (c[k] > c[hi]) hi = k; if (c[k] < c[lo]) lo = k; }
    if (hi === lo) continue; // ya es gris
    const mid = 3 - hi - lo;
    const v = clamp(c[lo] + (c[hi] - c[mid]) * prim[hi] + (c[mid] - c[lo]) * sec[hi][mid]);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
}
export function desaturate(img: ImageData) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const v = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); d[i] = d[i + 1] = d[i + 2] = v; }
}

/** Exposición en pasos de diafragma, con desplazamiento y gamma (trabaja en luz lineal). */
export function exposure(img: ImageData, stops: number, offset: number, gamma: number) {
  const lut = new Uint8ClampedArray(256), k = Math.pow(2, stops);
  for (let i = 0; i < 256; i++) {
    const lin = Math.pow(i / 255, 2.2) * k + offset;
    lut[i] = clamp(Math.pow(Math.max(0, Math.pow(Math.max(0, lin), 1 / gamma)), 1 / 2.2) * 255);
  }
  applyLut(img, lut);
}
export function posterize(img: ImageData, levels: number) {
  const n = Math.max(2, Math.round(levels)), lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.min(n - 1, Math.floor(i * n / 256)) * 255 / (n - 1);
  applyLut(img, lut);
}
export function threshold(img: ImageData, level: number) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] >= level ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; }
}
/** Equilibrio de color: desplaza sombras, medios tonos e iluminaciones hacia un color. */
export function colorBalance(img: ImageData, p: any) {
  const luts = [0, 1, 2].map(c => {
    const s = p['s' + c] ?? 0, m = p['m' + c] ?? 0, h = p['h' + c] ?? 0, lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      const x = i / 255;
      const ws = Math.max(0, 1 - x * 3) , wh = Math.max(0, x * 3 - 2), wm = Math.max(0, 1 - Math.abs(x - 0.5) * 2.2);
      lut[i] = clamp(i + (s * ws * 0.9 + m * wm * 0.7 + h * wh * 0.9) * 1.0);
    }
    return lut;
  });
  const d = img.data, keep = p.preserve !== false;
  for (let i = 0; i < d.length; i += 4) {
    const l0 = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    let r = luts[0][d[i]], g = luts[1][d[i + 1]], b = luts[2][d[i + 2]];
    if (keep) { const dl = l0 - (0.299 * r + 0.587 * g + 0.114 * b); r += dl; g += dl; b += dl; }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
}
/** Mezclador de canales: cada canal de salida es una mezcla (en %) de los de entrada más una constante. */
export function channelMixer(img: ImageData, p: any) {
  const d = img.data, m = ['r', 'g', 'b'].map(o => [p[o + 'r'] / 100, p[o + 'g'] / 100, p[o + 'b'] / 100, (p[o + 'c'] ?? 0) * 2.55]);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (p.mono) { const v = r * m[0][0] + g * m[0][1] + b * m[0][2] + m[0][3]; d[i] = d[i + 1] = d[i + 2] = v; continue; }
    d[i] = r * m[0][0] + g * m[0][1] + b * m[0][2] + m[0][3];
    d[i + 1] = r * m[1][0] + g * m[1][1] + b * m[1][2] + m[1][3];
    d[i + 2] = r * m[2][0] + g * m[2][1] + b * m[2][2] + m[2][3];
  }
}
/** Intensidad: satura más los colores apagados y protege los ya saturados. */
export function vibrance(img: ImageData, vib: number, sat: number) {
  const d = img.data, kv = vib / 100, ks = sat / 100;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (r + g + b) / 3;
    const cur = mx === 0 ? 0 : (mx - mn) / mx;
    const f = 1 + ks + kv * (1 - cur) * (kv > 0 ? 1 : cur + 0.5);
    d[i] = l + (r - l) * f; d[i + 1] = l + (g - l) * f; d[i + 2] = l + (b - l) * f;
  }
}

export function blur(img: ImageData, radius: number) { gaussianBlur(img, radius); }

/** Máscara de enfoque: original + cantidad·(original − desenfocado). */
export function unsharpMask(img: ImageData, amount: number, radius: number, threshold: number) {
  const blurred = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  gaussianBlur(blurred, radius);
  const d = img.data, b = blurred.data, k = amount / 100;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = d[i + c] - b[i + c];
      if (Math.abs(diff) >= threshold) d[i + c] = clamp(d[i + c] + diff * k);
    }
  }
}

/** Ruido gaussiano o uniforme. `seed` permite resultados repetibles en la vista previa. */
export function addNoise(img: ImageData, amount: number, mono: boolean, gaussian: boolean, seed = 1) {
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296); };
  const sample = gaussian
    ? () => { const u = rnd() || 1e-9, v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * 0.5; }
    : () => rnd() * 2 - 1;
  const d = img.data, a = amount / 100 * 255;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    if (mono) { const n = sample() * a; d[i] = clamp(d[i] + n); d[i + 1] = clamp(d[i + 1] + n); d[i + 2] = clamp(d[i + 2] + n); }
    else for (let c = 0; c < 3; c++) d[i + c] = clamp(d[i + c] + sample() * a);
  }
}

/** Histograma de luminancia (o de un canal) para el diálogo de niveles/curvas. */
export function histogram(img: ImageData, channel: 'rgb' | 'r' | 'g' | 'b' = 'rgb'): Uint32Array {
  const hist = new Uint32Array(256);
  const d = img.data;
  const step = Math.max(1, Math.floor(d.length / 4 / 400000)) * 4; // muestreo en imágenes grandes
  for (let i = 0; i < d.length; i += step) {
    if (d[i + 3] === 0) continue;
    const v = channel === 'rgb' ? Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
      : d[i + (channel === 'r' ? 0 : channel === 'g' ? 1 : 2)];
    hist[v]++;
  }
  return hist;
}
