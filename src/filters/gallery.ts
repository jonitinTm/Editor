// Filtros de la «galería de filtros» clásica: artísticos, trazos de pincel, bosquejar, textura y otros.
//
// Algoritmos adaptados a TypeScript a partir de VectorCraft (https://github.com/storytold/vectorcraft),
// crates/effects/src/pixel/*.rs, © los autores de VectorCraft, con licencia MIT (ver LICENSES/vectorcraft-MIT.txt).
// Allí son, a su vez, aproximaciones visuales hechas a partir de la documentación pública del comportamiento de
// estos filtros, no reproducciones de un algoritmo propietario. Las unidades se han pasado de puntos a píxeles.
//
// Todo trabaja sobre ImageData (se ejecuta en el hilo de los filtros), sin tocar la interfaz.

import { texturizer as texturize } from './artistic';

type F = Float32Array;
const clamp01 = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v;
const ramp = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

// ---- Azar reproducible (mismo resultado en la vista previa y al aplicar) -------------------------------------
function hash(salt: number, i: number, j: number, k: number) {
  let h = Math.imul(salt ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i | 0, 0xc2b2ae35) ^ Math.imul(j | 0, 0x27d4eb2f) ^ Math.imul(k | 0, 0x165667b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const rand = (salt: number, i: number, j: number, k = 0) => hash(salt, i, j, k);
/** Ruido de valor suave en [0, 1). */
function vnoise(salt: number, x: number, y: number) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = rand(salt, i, j), b = rand(salt, i + 1, j), c = rand(salt, i, j + 1), d = rand(salt, i + 1, j + 1);
  const top = a + (b - a) * sx, bot = c + (d - c) * sx; return top + (bot - top) * sy;
}
/** Ruido suave en [-1, 1) con celdas de `size` píxeles. */
const snoise = (salt: number, x: number, y: number, size: number) => 2 * vnoise(salt, x / size, y / size) - 1;

// ---- Planos de color -------------------------------------------------------------------------------------------
interface Planes { r: F; g: F; b: F; a: F; w: number; h: number }
function planes(img: ImageData): Planes {
  const { width: w, height: h, data: d } = img, n = w * h, r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n), a = new Float32Array(n);
  for (let i = 0; i < n; i++) { r[i] = d[i * 4] / 255; g[i] = d[i * 4 + 1] / 255; b[i] = d[i * 4 + 2] / 255; a[i] = d[i * 4 + 3] / 255; }
  return { r, g, b, a, w, h };
}
function write(img: ImageData, P: { r: F; g: F; b: F }) {
  const d = img.data, n = img.width * img.height;
  for (let i = 0; i < n; i++) { if (!d[i * 4 + 3]) continue; d[i * 4] = clamp01(P.r[i]) * 255 + 0.5; d[i * 4 + 1] = clamp01(P.g[i]) * 255 + 0.5; d[i * 4 + 2] = clamp01(P.b[i]) * 255 + 0.5; }
}
const tonesOf = (P: Planes) => { const n = P.w * P.h, t = new Float32Array(n); for (let i = 0; i < n; i++) t[i] = luma(P.r[i], P.g[i], P.b[i]); return t; };

/** Desenfoque gaussiano aproximado (tres pasadas de caja) de un plano. */
function blurPlane(p: F, w: number, h: number, sigma: number) {
  if (!(sigma > 0.3)) return p;
  const wIdeal = Math.sqrt(12 * sigma * sigma / 3 + 1); let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const m = Math.round((12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4));
  const tmp = new Float32Array(p.length);
  for (let k = 0; k < 3; k++) { const r = ((k < m ? wl : wl + 2) - 1) / 2; boxH(p, tmp, w, h, r); boxV(tmp, p, w, h, r); }
  return p;
}
function boxH(s: F, o: F, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w; let acc = s[row] * (r + 1); for (let x = 0; x < r; x++) acc += s[row + Math.min(w - 1, x)];
    for (let x = 0; x < w; x++) { acc += s[row + Math.min(w - 1, x + r)] - s[row + Math.max(0, x - r - 1)]; o[row + x] = acc * iarr; }
  }
}
function boxV(s: F, o: F, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    let acc = s[x] * (r + 1); for (let y = 0; y < r; y++) acc += s[Math.min(h - 1, y) * w + x];
    for (let y = 0; y < h; y++) { acc += s[Math.min(h - 1, y + r) * w + x] - s[Math.max(0, y - r - 1) * w + x]; o[y * w + x] = acc * iarr; }
  }
}
/** Suaviza los colores sin que lo transparente oscurezca los bordes. */
function soften(P: Planes, sigma: number): Planes {
  if (!(sigma > 0.3)) return { ...P, r: P.r.slice(), g: P.g.slice(), b: P.b.slice() };
  const n = P.w * P.h, a = blurPlane(P.a.slice(), P.w, P.h, sigma), out = { ...P, r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n) };
  for (const k of ['r', 'g', 'b'] as const) {
    const q = new Float32Array(n); for (let i = 0; i < n; i++) q[i] = P[k][i] * P.a[i];
    blurPlane(q, P.w, P.h, sigma); for (let i = 0; i < n; i++) out[k][i] = a[i] > 1e-4 ? clamp01(q[i] / a[i]) : P[k][i];
  }
  return out;
}
/** Magnitud del gradiente (Sobel) de un plano 0..1: vale ~4 en un salto de negro a blanco. */
function sobel(L: F, w: number, h: number) {
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym = (y > 0 ? y - 1 : y) * w, yc = y * w, yp = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : x, xp = x < w - 1 ? x + 1 : x;
      const gx = L[ym + xp] + 2 * L[yc + xp] + L[yp + xp] - L[ym + xm] - 2 * L[yc + xm] - L[yp + xm];
      const gy = L[yp + xm] + 2 * L[yp + x] + L[yp + xp] - L[ym + xm] - 2 * L[ym + x] - L[ym + xp];
      g[yc + x] = Math.hypot(gx, gy);
    }
  }
  return g;
}
/** Bordes del objeto tras suavizarlo `sigma` píxeles: ~1 en un salto de negro a blanco, igual a cualquier tamaño. */
function edges(P: Planes, sigma: number) {
  const n = P.w * P.h, t = new Float32Array(n), c = P.a.slice(); for (let i = 0; i < n; i++) t[i] = luma(P.r[i], P.g[i], P.b[i]) * P.a[i];
  blurPlane(t, P.w, P.h, sigma); blurPlane(c, P.w, P.h, sigma);
  const norm = Math.max(sigma, 0.8) * Math.sqrt(2 * Math.PI) / 8, a = sobel(t, P.w, P.h), b = sobel(c, P.w, P.h);
  for (let i = 0; i < n; i++) a[i] = Math.max(a[i], b[i]) * norm; return a;
}
const at = (p: F, w: number, h: number, x: number, y: number) => p[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];

// ---- Trazos: la imagen «arrastrada» a lo largo de una dirección (pinceladas) -----------------------------------
const RIGHT: [number, number] = [Math.SQRT1_2, -Math.SQRT1_2], LEFT: [number, number] = [Math.SQRT1_2, Math.SQRT1_2];
const DIRS: Record<string, [number, number]> = { rightDiagonal: RIGHT, leftDiagonal: LEFT, horizontal: [1, 0], vertical: [0, 1] };
class Smear {
  private src: F; private n: number;
  constructor(P: Planes, public len: number) {
    len = Math.max(0, len); this.len = len;
    this.n = Math.max(1, Math.min(16, Math.ceil(len) + 1));
    const gap = this.n > 1 ? len / (this.n - 1) : 0, n = P.w * P.h, src = new Float32Array(n * 4);
    // premultiplicado (para no arrastrar color desde lo transparente) y, si las muestras quedan separadas, suavizado
    const pl = [P.r, P.g, P.b].map(c => { const q = new Float32Array(n); for (let i = 0; i < n; i++) q[i] = c[i] * P.a[i]; return gap > 1 ? blurPlane(q, P.w, P.h, gap / 2) : q; });
    const a = gap > 1 ? blurPlane(P.a.slice(), P.w, P.h, gap / 2) : P.a;
    for (let i = 0; i < n; i++) { src[i * 4] = pl[0][i]; src[i * 4 + 1] = pl[1][i]; src[i * 4 + 2] = pl[2][i]; src[i * 4 + 3] = a[i]; }
    this.src = src; this.w = P.w; this.h = P.h;
  }
  private w: number; private h: number;
  /** Media a lo largo de un segmento de `len` centrado en (x, y): color sin premultiplicar en `out`. */
  at(x: number, y: number, dx: number, dy: number, out: number[]) {
    const hl = this.len / 2, n = this.n; let ax = x - dx * hl, ay = y - dy * hl; const sx = n > 1 ? dx * this.len / (n - 1) : 0, sy = n > 1 ? dy * this.len / (n - 1) : 0;
    if (n === 1) { ax = x; ay = y; }
    let r = 0, g = 0, b = 0, a = 0; const S = this.src, w = this.w, h = this.h;
    for (let k = 0; k < n; k++, ax += sx, ay += sy) {
      const x0 = Math.floor(ax), y0 = Math.floor(ay), fx = ax - x0, fy = ay - y0;
      for (const [xx, yy, wt] of [[x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)], [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy]]) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || wt <= 0) continue; const q = (yy * w + xx) * 4;
        r += S[q] * wt; g += S[q + 1] * wt; b += S[q + 2] * wt; a += S[q + 3] * wt;
      }
    }
    if (a > 1e-6) { out[0] = clamp01(r / a); out[1] = clamp01(g / a); out[2] = clamp01(b / a); out[3] = a / n; } else out[3] = 0;
  }
  /** Una pincelada: los trazos se cortan en trozos con un desplazamiento al azar, en filas de `width` de ancho. */
  stroke(salt: number, x: number, y: number, dir: [number, number], width: number, out: number[]) {
    let shift = 0;
    if (this.len > 0 && width > 0) {
      const u = x * dir[0] + y * dir[1], v = y * dir[0] - x * dir[1], row = Math.floor(v / width), col = Math.floor(u / this.len + rand(salt, row, 0));
      shift = (2 * rand(salt, col, row, 1) - 1) * 0.25 * this.len;
    }
    this.at(x + dir[0] * shift, y + dir[1] * shift, dir[0], dir[1], out);
  }
}
/** Vetas a lo largo de `dir` (para cerdas y rayados), en [-1, 1). */
function streak(salt: number, x: number, y: number, dir: [number, number], along: number, across: number) {
  const u = x * dir[0] + y * dir[1], v = y * dir[0] - x * dir[1]; return 2 * vnoise(salt, u / Math.max(1e-3, along), v / Math.max(1e-3, across)) - 1;
}
/** Muestra bilineal del original (para desplazamientos). */
function sampleInto(src: Uint8ClampedArray, w: number, h: number, x: number, y: number, o: Uint8ClampedArray, q: number) {
  x = Math.max(0, Math.min(w - 1.001, x)); y = Math.max(0, Math.min(h - 1.001, y));
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i00 = (y0 * w + x0) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
  for (let c = 0; c < 4; c++) o[q + c] = (src[i00 + c] * (1 - fx) + src[i10 + c] * fx) * (1 - fy) + (src[i01 + c] * (1 - fx) + src[i11 + c] * fx) * fy;
}
/** Luz: dirección hacia la que mira la superficie iluminada. */
const LIGHTS: Record<string, [number, number]> = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0], topLeft: [-Math.SQRT1_2, -Math.SQRT1_2], topRight: [Math.SQRT1_2, -Math.SQRT1_2], bottomLeft: [-Math.SQRT1_2, Math.SQRT1_2], bottomRight: [Math.SQRT1_2, Math.SQRT1_2] };
const gray = (img: ImageData, v: F) => { const d = img.data; for (let i = 0; i < v.length; i++) { if (!d[i * 4 + 3]) continue; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = clamp01(v[i]) * 255 + 0.5; } };
const tex = (img: ImageData, p: any) => { if ((p.relief ?? 4) > 0) texturize(img, { kind: p.kind ?? 'canvas', scale: p.scaling ?? 100, relief: Math.min(20, p.relief ?? 4) }); };

// ================================================================================================================
// Artístico
// ================================================================================================================
export function coloredPencil(img: ImageData, p: any) {
  const width = Math.max(1, p.width ?? 5), pressure = clamp01((p.pressure ?? 5) / 15), paper = clamp01((p.paper ?? 25) / 50);
  const P0 = planes(img), P = soften(P0, 0.12 * width), w = P.w, h = P.h, T = tonesOf(P), E = sobel(T, w, h), spacing = Math.max(1, 0.35 * width);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, gx = at(T, w, h, x + 1, y) - at(T, w, h, x - 1, y), gy = at(T, w, h, x, y + 1) - at(T, w, h, x, y - 1);
    const ang = Math.atan2(gy, gx) + Math.PI / 2, along = x * Math.cos(ang) + y * Math.sin(ang);
    const grain = vnoise(304, along / spacing, (x * 0.37 + y * 0.11) / spacing), stroke = 0.5 + 0.5 * Math.sin(along / spacing * 2 * Math.PI + grain * 3);
    const ink = pressure * (0.3 + 0.55 * stroke) * (0.55 + 0.45 * Math.min(1, E[i] / 4)), lift = paper * (1 - T[i]) * 0.35;
    P.r[i] = P.r[i] * (1 - ink * 0.45) + lift * (1 - P.r[i]); P.g[i] = P.g[i] * (1 - ink * 0.45) + lift * (1 - P.g[i]); P.b[i] = P.b[i] * (1 - ink * 0.45) + lift * (1 - P.b[i]);
  }
  write(img, P);
}

export function dryBrush(img: ImageData, p: any) {
  const len = 2 + 2.8 * (Math.max(1, Math.min(10, p.size ?? 2)) - 1), sigma = 0.22 * (10 - Math.max(0, Math.min(10, p.detail ?? 10))), texture = Math.max(1, Math.min(3, p.texture ?? 1));
  const edgeGain = 0.25 + 0.2 * (texture - 1), bristle = 0.04 + 0.05 * (texture - 1);
  const P = soften(planes(img), sigma), w = P.w, h = P.h, n = w * h, T = new Float32Array(n);
  for (let i = 0; i < n; i++) T[i] = luma(P.r[i], P.g[i], P.b[i]) * P.a[i];
  const E = sobel(T, w, h), S = new Smear(P, 0), out = { r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n) }, c = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    // la pincelada sigue la forma: perpendicular al gradiente de luz
    let dx = -0.5 * (at(T, w, h, x, y + 1) - at(T, w, h, x, y - 1)), dy = 0.5 * (at(T, w, h, x + 1, y) - at(T, w, h, x - 1, y)); const l = Math.hypot(dx, dy);
    if (l > 1e-6) { dx /= l; dy /= l; } else { dx = 1; dy = 0; }
    let r = 0, g = 0, b = 0, k = 0;
    for (let s = 0; s < 5; s++) { const t = (s / 4 - 0.5) * len; S.at(x + dx * t, y + dy * t, 0, 0, c); if (c[3] > 0) { r += c[0]; g += c[1]; b += c[2]; k++; } }
    if (!k) { out.r[i] = P.r[i]; out.g[i] = P.g[i]; out.b[i] = P.b[i]; continue; }
    const dark = Math.min(0.75, edgeGain * Math.min(1, E[i])), gr = bristle * (2 * vnoise(264, x / 5, y / 5) - 1);
    out.r[i] = r / k * (1 - dark) + gr; out.g[i] = g / k * (1 - dark) + gr; out.b[i] = b / k * (1 - dark) + gr;
  }
  write(img, out);
}

export function fresco(img: ImageData, p: any) {
  const size = Math.max(1, Math.min(10, p.size ?? 2)), detail = Math.max(0, Math.min(10, p.detail ?? 10)), texture = Math.round(Math.max(1, Math.min(3, p.texture ?? 1)));
  const side = 2 + 1.8 * size, P = soften(planes(img), 0.15 * (10 - detail) * size + 0.8), w = P.w, h = P.h;
  const texStrength = 0.08 + 0.07 * (texture - 1), texScale = 3 / texture, streakMix = 0.25 * (1 - detail / 10), out = { r: new Float32Array(w * h), g: new Float32Array(w * h), b: new Float32Array(w * h) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, ci = Math.floor(x / side), cj = Math.floor(y / side);
    const sx = Math.round(x + (rand(320, ci, cj, 0) - 0.5) * 0.35 * side), sy = Math.round(y + (rand(320, ci, cj, 1) - 0.5) * 0.35 * side);
    const k = Math.max(0, Math.min(h - 1, sy)) * w + Math.max(0, Math.min(w - 1, sx)), ang = 2 * Math.PI * rand(320, ci, cj, 2);
    const along = (x - ci * side) * Math.cos(ang) + (y - cj * side) * Math.sin(ang), st = 1 - streakMix * (0.5 + 0.5 * Math.sin(along / side) ** 2);
    const bump = 1 + texStrength * snoise(323, x, y, texScale * side), f = st * bump;
    out.r[i] = P.r[k] * f; out.g[i] = P.g[k] * f; out.b[i] = P.b[k] * f;
  }
  write(img, out);
}

export function paintDaubs(img: ImageData, p: any) {
  const spacing = Math.max(1, Math.min(50, p.size ?? 10)), radius = spacing * 0.48 + 0.5, edge = 1 + 2.5 * Math.max(0, Math.min(40, p.sharpness ?? 25)) / 40, kind = p.kind ?? 'simple';
  const P0 = planes(img), P = soften(P0, spacing * 0.15), w = P.w, h = P.h, gw = Math.ceil(w / spacing) + 2, gh = Math.ceil(h / spacing) + 2;
  // cada toque: un centro al azar en su celda y el color de alrededor
  const cx = new Float32Array(gw * gh), cy = new Float32Array(gw * gh), col = new Float32Array(gw * gh * 3);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const k = j * gw + i, x = (i - 1 + rand(272, i, j, 0)) * spacing, y = (j - 1 + rand(272, i, j, 1)) * spacing; cx[k] = x; cy[k] = y;
    const q = Math.max(0, Math.min(h - 1, Math.round(y))) * w + Math.max(0, Math.min(w - 1, Math.round(x))); col[k * 3] = P.r[q]; col[k * 3 + 1] = P.g[q]; col[k * 3 + 2] = P.b[q];
  }
  const out = { r: P0.r.slice(), g: P0.g.slice(), b: P0.b.slice() };
  const wide = kind === 'wideSharp' || kind === 'wideBlurry', ek = kind === 'wideSharp' ? edge * 1.35 : kind === 'wideBlurry' ? edge * 0.55 : edge;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, ci = Math.floor(x / spacing) + 1, cj = Math.floor(y / spacing) + 1; let r = 0, g = 0, b = 0, wt = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const k = (cj + dj) * gw + (ci + di); if (k < 0 || k >= gw * gh) continue;
      let dx = x - cx[k], dy = y - cy[k]; if (wide) { dx *= 0.65; dy *= 1.35; }
      const t = Math.min(1, Math.hypot(dx, dy) / radius); let c = Math.pow(1 - t, ek); if (c <= 0) continue;
      const tone = luma(col[k * 3], col[k * 3 + 1], col[k * 3 + 2]);
      if (kind === 'lightRough') c *= 0.7 + 0.35 * rand(275, Math.floor(x / 3.7), Math.floor(y / 3.7));
      else if (kind === 'darkRough') c *= 0.55 + 0.45 * (1 - rand(276, Math.floor(x / 3.7), Math.floor(y / 3.7)));
      else if (kind === 'sparkle' && rand(277, ci + di, cj + dj) > 0.92 && tone > 0.55) c = Math.max(c, 0.85);
      r += col[k * 3] * c; g += col[k * 3 + 1] * c; b += col[k * 3 + 2] * c; wt += c;
    }
    if (wt > 1e-6) { out.r[i] = r / wt; out.g[i] = g / wt; out.b[i] = b / wt; }
  }
  write(img, out);
}

export function paletteKnife(img: ImageData, p: any) {
  const len = Math.max(1, Math.min(50, p.size ?? 10)), keep = (Math.max(1, Math.min(3, p.detail ?? 2)) - 1) / 2, softness = Math.max(0, Math.min(10, p.softness ?? 3));
  const P = planes(img), S = new Smear(P, len), w = P.w, h = P.h, cell = len * 0.35, row = Math.max(1, 0.25 * len), c = [0, 0, 0, 0];
  const out: Planes = { ...P, r: P.r.slice(), g: P.g.slice(), b: P.b.slice() };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, ang = 2 * Math.PI * vnoise(208, x / cell, y / cell);
    S.stroke(209, x, y, [Math.cos(ang), Math.sin(ang)], row, c); if (c[3] <= 0) continue;
    const k = 0.15 + 0.35 * keep; out.r[i] = c[0] + (P.r[i] - c[0]) * k; out.g[i] = c[1] + (P.g[i] - c[1]) * k; out.b[i] = c[2] + (P.b[i] - c[2]) * k;
  }
  write(img, softness > 0 ? soften(out, 0.35 * softness) : out);
}

export function plasticWrap(img: ImageData, p: any) {
  const strength = clamp01((p.highlight ?? 20) / 20); if (!strength) return;
  const detail = clamp01((p.detail ?? 12) / 15), sigma = 0.15 + 0.35 * Math.max(1, Math.min(15, p.smoothness ?? 15));
  const P = planes(img), w = P.w, h = P.h, n = w * h, H = new Float32Array(n), cellScale = 8 + 24 * (1 - detail);
  for (let i = 0; i < n; i++) { const x = i % w, y = (i / w) | 0; H[i] = (luma(P.r[i], P.g[i], P.b[i]) + detail * 0.35 * snoise(512, x, y, cellScale)) * P.a[i]; }
  blurPlane(H, w, h, sigma); const cov = blurPlane(P.a.slice(), w, h, sigma); for (let i = 0; i < n; i++) H[i] = cov[i] > 1e-4 ? H[i] / cov[i] : 0;
  const L = [0.35, -0.25, 0.9], ll = Math.hypot(L[0], L[1], L[2]); for (let k = 0; k < 3; k++) L[k] /= ll;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, nx = -(at(H, w, h, x + 1, y) - at(H, w, h, x - 1, y)) / 8 * 8, ny = -(at(H, w, h, x, y + 1) - at(H, w, h, x, y - 1)) / 8 * 8;
    const nl = Math.hypot(nx, ny, 1), dot = Math.max(0, (nx * L[0] + ny * L[1] + L[2]) / nl), spec = Math.pow(dot, 12) * strength;
    if (spec > 1e-5) { P.r[i] = 1 - (1 - P.r[i]) * (1 - spec); P.g[i] = 1 - (1 - P.g[i]) * (1 - spec); P.b[i] = 1 - (1 - P.b[i]) * (1 - spec); }
  }
  write(img, P);
}

export function roughPastels(img: ImageData, p: any) {
  const length = Math.max(0, Math.min(40, p.length ?? 6)), detail = Math.max(1, Math.min(20, p.detail ?? 10));
  if (length > 0) {
    const P = planes(img), S = new Smear(P, Math.max(1, length)), w = P.w, h = P.h, T = blurPlane(tonesOf(P), w, h, 1), row = Math.max(1, 0.18 * S.len);
    const mixK = Math.min(0.8, 0.35 + 0.0225 * detail), bristle = 0.015 + 0.0035 * detail, a = [0, 0, 0, 0], b = [0, 0, 0, 0], out = { r: P.r.slice(), g: P.g.slice(), b: P.b.slice() };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; S.stroke(200, x, y, RIGHT, row, a); S.stroke(201, x, y, LEFT, row, b); if (a[3] <= 0 && b[3] <= 0) continue;
      const nz = bristle * streak(202, x, y, T[i] > 0.52 ? RIGHT : LEFT, Math.max(1, S.len), row);
      for (const [k, ch] of [[0, 'r'], [1, 'g'], [2, 'b']] as const) { const s = (a[k] + b[k]) / 2; out[ch][i] = P[ch][i] + (s - P[ch][i]) * mixK + nz; }
    }
    write(img, out);
  }
  tex(img, p);
}

export function smudgeStick(img: ImageData, p: any) {
  const len = 1 + 1.5 * Math.max(0, Math.min(10, p.length ?? 2)), threshold = 0.9 - 0.5 * clamp01((p.highlight ?? 12) / 20), lift = Math.min(0.7, 0.7 * (p.intensity ?? 10) / 10);
  const P = planes(img), short = new Smear(P, len), long = new Smear(P, 2 * len), w = P.w, h = P.h, T = blurPlane(tonesOf(P), w, h, 1), row = Math.max(1, 0.25 * len);
  const a = [0, 0, 0, 0], b = [0, 0, 0, 0], out = { r: P.r.slice(), g: P.g.slice(), b: P.b.slice() };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; short.stroke(320, x, y, RIGHT, row, a); long.stroke(321, x, y, RIGHT, row, b);
    const bristle = 1 + 0.08 * streak(322, x, y, RIGHT, len, 0.5), t = ramp((T[i] - threshold) / 0.2 + 0.5);
    for (const [k, ch] of [[0, 'r'], [1, 'g'], [2, 'b']] as const) {
      const dark = (a[3] > 0 ? a[k] : P[ch][i]) * bristle, lt = b[3] > 0 ? b[k] : P[ch][i], bright = lt + (1 - lt) * lift;
      out[ch][i] = dark + (bright - dark) * t;
    }
  }
  write(img, out);
}

export function sponge(img: ImageData, p: any) {
  const pore = 3 + 2 * Math.max(0, Math.min(10, p.size ?? 2)), smooth = Math.max(1, Math.min(15, p.smoothness ?? 5)), amount = clamp01((p.definition ?? 12) / 25);
  const P = soften(planes(img), (0.15 + 0.04 * smooth) * pore), w = P.w, h = P.h, edge = 0.12 + 0.03 * smooth, gain = 1 + 0.35 * amount;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, nz = 0.65 * snoise(328, x, y, pore) + 0.35 * snoise(329, x, y, 0.45 * pore), blob = 2 * ramp(0.5 + nz / (2 * edge)) - 1;
    // manchas claras y oscuras de esponja, sin llegar a quemar la imagen
    const l = luma(P.r[i], P.g[i], P.b[i]), target = clamp01(0.5 + (l + 0.22 * amount * blob - 0.5) * gain);
    if (target <= l) { const k = l > 1e-3 ? target / l : 0; P.r[i] *= k; P.g[i] *= k; P.b[i] *= k; }
    else { const k = clamp01((target - l) / Math.max(1e-3, 1 - l)); P.r[i] += (1 - P.r[i]) * k; P.g[i] += (1 - P.g[i]) * k; P.b[i] += (1 - P.b[i]) * k; }
  }
  write(img, P);
}

export function underpainting(img: ImageData, p: any) {
  const size = Math.max(0, Math.min(40, p.size ?? 6)), coverage = clamp01((p.coverage ?? 16) / 40);
  write(img, soften(planes(img), 0.1 * Math.max(size, 0.25) + 0.6));
  if (coverage <= 0) return;
  const soft = new Uint8ClampedArray(img.data); tex(img, p);
  if (coverage >= 1) return; const d = img.data;
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = soft[i + c] * (1 - coverage) + d[i + c] * coverage;
}

// ================================================================================================================
// Trazos de pincel
// ================================================================================================================
export function accentedEdges(img: ImageData, p: any) {
  const width = Math.max(1, Math.min(14, p.width ?? 2)), smooth = Math.max(1, Math.min(15, p.smoothness ?? 5)), level = clamp01((p.brightness ?? 38) / 50);
  const P = planes(img), E = edges(P, 0.35 * width + 0.1 * smooth), faint = 0.02 * smooth;
  for (let i = 0; i < E.length; i++) {
    const ink = ramp((E[i] - faint) / 0.25);
    // brillo alto: tiza blanca en los bordes; bajo: tinta negra
    if (level >= 0.5) { const k = ink * (level - 0.5) * 2; P.r[i] += (1 - P.r[i]) * k; P.g[i] += (1 - P.g[i]) * k; P.b[i] += (1 - P.b[i]) * k; }
    else { const k = 1 - ink * (0.5 - level) * 2; P.r[i] *= k; P.g[i] *= k; P.b[i] *= k; }
  }
  write(img, P);
}

export function angledStrokes(img: ImageData, p: any) {
  const balance = clamp01((p.balance ?? 50) / 100), len = Math.max(3, Math.min(50, p.length ?? 15)), sharp = clamp01((p.sharpness ?? 3) / 10);
  const P = planes(img), S = new Smear(P, len), w = P.w, h = P.h, T = blurPlane(tonesOf(P), w, h, 1), row = Math.max(1, 0.2 * len), c = [0, 0, 0, 0];
  const out = { r: P.r.slice(), g: P.g.slice(), b: P.b.slice() };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, dir = T[i] >= 1 - balance ? RIGHT : LEFT; S.stroke(313, x, y, dir, row, c); if (c[3] <= 0) continue;
    const br = 1 + 0.12 * sharp * streak(314, x, y, dir, len, 0.7), keep = 0.35 * sharp;
    out.r[i] = (c[0] + (P.r[i] - c[0]) * keep) * br; out.g[i] = (c[1] + (P.g[i] - c[1]) * keep) * br; out.b[i] = (c[2] + (P.b[i] - c[2]) * keep) * br;
  }
  write(img, out);
}

export function crosshatch(img: ImageData, p: any) {
  const len = Math.max(3, Math.min(50, p.length ?? 9)), sharp = clamp01((p.sharpness ?? 6) / 20), passes = Math.round(Math.max(1, Math.min(3, p.strength ?? 1)));
  const P = planes(img), S = new Smear(P, 0.1 * len + 1), w = P.w, h = P.h, T = tonesOf(P), c = [0, 0, 0, 0];
  const out = { r: P.r.slice(), g: P.g.slice(), b: P.b.slice() };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; S.stroke(338, x, y, RIGHT, len * 0.3, c); if (c[3] > 0) { out.r[i] = c[0]; out.g[i] = c[1]; out.b[i] = c[2]; }
    let dark = 0;
    for (let k = 0; k < passes; k++) for (const [s, dir] of [[340 + k * 2, RIGHT], [341 + k * 2, LEFT]] as const) {
      const line = ramp((streak(s, x, y, dir, len, 1.1) - 0.05) / 0.45); dark = Math.max(dark, line * (0.15 + 0.5 * sharp) * (1 - 0.55 * T[i]) * (0.6 + 0.2 * k));
    }
    out.r[i] *= 1 - dark; out.g[i] *= 1 - dark; out.b[i] *= 1 - dark;
  }
  write(img, out);
}

export function darkStrokes(img: ImageData, p: any) {
  const thr = 0.25 + 0.05 * Math.max(0, Math.min(10, p.balance ?? 5)), black = clamp01((p.black ?? 6) / 10), white = clamp01((p.white ?? 2) / 10);
  const P = planes(img), short = new Smear(P, 3), long = new Smear(P, 9), w = P.w, h = P.h, T = blurPlane(tonesOf(P), w, h, 1), a = [0, 0, 0, 0], b = [0, 0, 0, 0];
  const out = { r: P.r.slice(), g: P.g.slice(), b: P.b.slice() };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; short.stroke(378, x, y, LEFT, 1.5, a); long.stroke(379, x, y, RIGHT, 2.5, b); const t = ramp((T[i] - thr) / 0.15 + 0.5);
    for (const [k, ch] of [[0, 'r'], [1, 'g'], [2, 'b']] as const) {
      const d = (a[3] > 0 ? a[k] : P[ch][i]) * (1 - 0.85 * black), lt = b[3] > 0 ? b[k] : P[ch][i], l2 = lt + (1 - lt) * 0.85 * white;
      out[ch][i] = d + (l2 - d) * t;
    }
  }
  write(img, out);
}

export function spatter(img: ImageData, p: any) {
  const shift = 0.4 * Math.max(0, Math.min(25, p.radius ?? 10)), grain = 0.5 + 0.35 * Math.max(1, Math.min(15, p.smoothness ?? 5));
  const { width: w, height: h } = img, src = new Uint8ClampedArray(img.data), o = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const q = (y * w + x) * 4; if (!src[q + 3]) continue;
    const dx = grain <= 1 ? (2 * rand(446, x, y, 0) - 1) * shift : snoise(446, x, y, grain) * shift * 1.6, dy = grain <= 1 ? (2 * rand(446, x, y, 1) - 1) * shift : snoise(447, x, y, grain) * shift * 1.6;
    sampleInto(src, w, h, x + dx, y + dy, o, q); o[q + 3] = src[q + 3];
  }
}

export function sprayedStrokes(img: ImageData, p: any) {
  spatter(img, { radius: (p.radius ?? 7) * 0.75, smoothness: 2 });
  const len = Math.max(0, Math.min(20, p.length ?? 12)); if (len <= 0) return;
  const dir = DIRS[p.dir ?? 'rightDiagonal'] ?? RIGHT, P = planes(img), S = new Smear(P, len), w = P.w, h = P.h, c = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; S.stroke(458, x, y, dir, Math.max(1, 0.25 * len), c); if (c[3] > 0) { P.r[i] = c[0]; P.g[i] = c[1]; P.b[i] = c[2]; } }
  write(img, P);
}

export function sumiE(img: ImageData, p: any) {
  const width = Math.max(3, Math.min(15, p.width ?? 10)), pressure = clamp01((p.pressure ?? 2) / 15), contrast = Math.max(0, Math.min(40, p.contrast ?? 16));
  const P = planes(img), w = P.w, h = P.h, n = w * h, V = new Float32Array(n);
  // trabaja con el valor (lo más claro de cada píxel): el color mantiene su tono y su saturación
  for (let i = 0; i < n; i++) V[i] = Math.max(P.r[i], P.g[i], P.b[i]);
  const VP: Planes = { r: V, g: V, b: V, a: P.a, w, h }, S = new Smear(VP, width), c = [0, 0, 0, 0], W = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; S.stroke(480, x, y, RIGHT, width * 0.6, c); W[i] = c[3] > 0 ? c[0] : V[i]; }
  blurPlane(W, w, h, 0.25 * width);  // la tinta se corre en el papel
  const k = 1 + contrast / 12;
  for (let i = 0; i < n; i++) {
    let v = clamp01(0.5 + (W[i] - 0.5) * k); v *= 1 - pressure * 0.6 * (1 - v); v = Math.min(v, 0.15 + V[i] * 0.85 + 0.15);
    const s = V[i] > 1e-3 ? v / V[i] : 0; P.r[i] = V[i] > 1e-3 ? P.r[i] * s : v; P.g[i] = V[i] > 1e-3 ? P.g[i] * s : v; P.b[i] = V[i] > 1e-3 ? P.b[i] * s : v;
  }
  write(img, P);
}

// ================================================================================================================
// Bosquejar (en blanco y negro, como con tinta o lápiz sobre papel)
// ================================================================================================================
export function basRelief(img: ImageData, p: any) {
  const detail = Math.max(1, Math.min(15, p.detail ?? 13)), smooth = Math.max(1, Math.min(15, p.smoothness ?? 3)), L = LIGHTS[p.light ?? 'bottom'] ?? LIGHTS.bottom;
  const P = planes(img), w = P.w, h = P.h, T = tonesOf(P), Hh = blurPlane(T.slice(), w, h, 0.25 * smooth + 0.15 * (15 - detail)), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, gx = at(Hh, w, h, x + 1, y) - at(Hh, w, h, x - 1, y), gy = at(Hh, w, h, x, y + 1) - at(Hh, w, h, x, y - 1);
    const face = -(gx * L[0] + gy * L[1]) * 12; out[i] = 0.5 + Math.tanh(face) * 0.5 + (T[i] - 0.5) * 0.12;
  }
  gray(img, out);
}

export function chrome(img: ImageData, p: any) {
  const detail = Math.max(0, Math.min(10, p.detail ?? 4)), smooth = Math.max(0, Math.min(10, p.smoothness ?? 4));
  const P = planes(img), w = P.w, h = P.h, T = tonesOf(P), H = blurPlane(T.slice(), w, h, 0.5 + 0.5 * smooth), fine = blurPlane(T.slice(), w, h, 0.6), out = new Float32Array(w * h), dt = detail / 10;
  for (let i = 0; i < H.length; i++) H[i] = H[i] * (1 - 0.4 * dt) + fine[i] * 0.4 * dt;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, gx = at(H, w, h, x + 1, y) - at(H, w, h, x - 1, y), gy = at(H, w, h, x, y + 1) - at(H, w, h, x, y - 1);
    // metal pulido: reflejos en bandas según la altura, y luz desde arriba a la izquierda
    const band = Math.cos(H[i] * Math.PI * 3), face = Math.tanh(-(gx * -0.7 + gy * -0.7) * 10);
    out[i] = 0.5 + 0.32 * band + 0.3 * face;
  }
  gray(img, out);
}

export function charcoal2(img: ImageData, p: any) {
  const thick = Math.max(1, Math.min(7, p.thickness ?? 1)), detail = Math.max(0, Math.min(5, p.detail ?? 1)), bal = clamp01((p.balance ?? 50) / 100);
  const P = planes(img), w = P.w, h = P.h, T = blurPlane(tonesOf(P), w, h, 0.8), E = edges(P, 0.4 * (6 - detail) + 0.3), out = new Float32Array(w * h), thr = 0.2 + 0.6 * bal;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, edge = ramp((E[i] * (1 + 0.4 * thick) - 0.12) / 0.3), st = streak(100, x, y, RIGHT, 6 * thick, 0.8 * thick);
    const tone = ramp((thr - T[i] + st * 0.15) / 0.18 + 0.5); out[i] = 1 - Math.max(edge, tone);
  }
  gray(img, out);
}

export function conteCrayon(img: ImageData, p: any) {
  const fg = clamp01((p.fg ?? 12) / 20), bg = clamp01((p.bg ?? 10) / 20);
  const P = planes(img), w = P.w, h = P.h, T = blurPlane(tonesOf(P), w, h, 0.8), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, grain = 0.75 + 0.5 * vnoise(387, x / 1.3, y / 1.3);
    const dark = ramp(((0.15 + 0.5 * fg) - T[i]) / 0.25 + 0.5) * grain, light = ramp((T[i] - (0.85 - 0.5 * bg)) / 0.25 + 0.5) * grain;
    out[i] = 0.5 * (1 - dark) + light * 0.5;
  }
  gray(img, out); tex(img, p);
}

export function graphicPen(img: ImageData, p: any) {
  const len = Math.max(1, Math.min(15, p.length ?? 5)), bal = clamp01((p.balance ?? 50) / 100), dir = DIRS[p.dir ?? 'rightDiagonal'] ?? RIGHT;
  const P = planes(img), w = P.w, h = P.h, T = blurPlane(tonesOf(P), w, h, 0.7), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, n = streak(525, x, y, dir, len * 2, 0.6); out[i] = ramp((T[i] + n * 0.35 - bal) / 0.08 + 0.5);
  }
  gray(img, out);
}

export function halftonePattern(img: ImageData, p: any) {
  const cellSz = 2 + 1.6 * Math.max(1, Math.min(12, p.size ?? 1)), soft = 0.5 * (1 - clamp01((p.contrast ?? 5) / 50)) + 0.02, kind = p.kind ?? 'dot';
  const P = planes(img), w = P.w, h = P.h, T = blurPlane(tonesOf(P), w, h, cellSz / 3), out = new Float32Array(w * h), cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, dark = 1 - T[i]; let d: number, need: number;
    if (kind === 'dot') { const u = ((x - cx) / cellSz % 1 + 1) % 1 - 0.5, v = ((y - cy) / cellSz % 1 + 1) % 1 - 0.5; d = Math.hypot(u, v); need = Math.sqrt(dark / Math.PI); }
    else { const r = kind === 'circle' ? Math.hypot(x - cx, y - cy) / cellSz : (y - cy) / cellSz; d = Math.abs(((r % 1) + 1) % 1 - 0.5); need = dark / 2; }
    out[i] = ramp((d - need) / soft + 0.5);
  }
  gray(img, out);
}

export function notePaper(img: ImageData, p: any) {
  const bal = clamp01((p.balance ?? 25) / 50), grain = clamp01((p.graininess ?? 0) / 10), relief = Math.max(0, Math.min(50, p.relief ?? 4));
  const P = planes(img), w = P.w, h = P.h, T = blurPlane(tonesOf(P), w, h, 1), H = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let i = 0; i < H.length; i++) { const x = i % w, y = (i / w) | 0; H[i] = ramp((bal - T[i]) / 0.12 + 0.5) + grain * 0.25 * (vnoise(114, x / 1.5, y / 6) - 0.5); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, gx = at(H, w, h, x + 1, y) - at(H, w, h, x - 1, y), gy = at(H, w, h, x, y + 1) - at(H, w, h, x, y - 1);
    out[i] = 0.8 - 0.25 * H[i] + Math.tanh(-(gx + gy) * (0.6 + relief * 0.6)) * 0.3;
  }
  gray(img, out);
}

export function photocopy(img: ImageData, p: any) {
  const detail = Math.max(1, Math.min(24, p.detail ?? 7)), dark = clamp01((p.darkness ?? 25) / 50);
  const P = planes(img), w = P.w, h = P.h, T = tonesOf(P), M = blurPlane(T.slice(), w, h, 0.6 * (25 - detail) + 1), out = new Float32Array(w * h);
  for (let i = 0; i < T.length; i++) {
    // negro donde el píxel es más oscuro que su entorno (los bordes); los medios tonos van a negro o blanco
    const diff = T[i] - M[i], edge = ramp((-diff - (0.09 - 0.08 * dark)) / 0.04), mid = ramp(((0.1 + 0.25 * dark) - T[i]) / 0.06);
    out[i] = 1 - Math.max(edge, mid);
  }
  gray(img, out);
}

export function plaster(img: ImageData, p: any) {
  const bal = clamp01((p.balance ?? 20) / 50), smooth = Math.max(1, Math.min(15, p.smoothness ?? 8)), L = LIGHTS[p.light ?? 'top'] ?? LIGHTS.top;
  const P = planes(img), w = P.w, h = P.h, T = tonesOf(P), H = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let i = 0; i < H.length; i++) H[i] = 1 - ramp((T[i] - bal) / 0.15 + 0.5);  // lo oscuro sube, lo claro se hunde
  blurPlane(H, w, h, 0.35 * smooth + 0.5);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, gx = at(H, w, h, x + 1, y) - at(H, w, h, x - 1, y), gy = at(H, w, h, x, y + 1) - at(H, w, h, x, y - 1);
    out[i] = 0.55 + 0.12 * H[i] + Math.tanh(-(gx * L[0] + gy * L[1]) * 10) * 0.4;
  }
  gray(img, out);
}

export function reticulation(img: ImageData, p: any) {
  const density = clamp01((p.density ?? 12) / 50), fg = clamp01((p.fg ?? 6) / 50), bg = clamp01((p.bg ?? 6) / 50);
  const P = planes(img), w = P.w, h = P.h, T = tonesOf(P), out = new Float32Array(w * h), sz = 0.6 + (1 - density) * 2.5;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, t = clamp01((T[i] - 0.45 * fg) / Math.max(0.1, 1 - 0.45 * fg - 0.45 * bg));
    const g = 0.6 * vnoise(340, x / sz, y / sz) + 0.4 * rand(341, x, y); out[i] = t > g ? 1 : 0;
  }
  gray(img, out);
}

export function tornEdges(img: ImageData, p: any) {
  const bal = clamp01((p.balance ?? 25) / 50), smooth = Math.max(0, Math.min(15, p.smoothness ?? 11)), contrast = Math.max(0, Math.min(20, p.contrast ?? 17));
  const P = planes(img), w = P.w, h = P.h, T = blurPlane(tonesOf(P), w, h, 0.3 * smooth + 0.4), out = new Float32Array(w * h), soft = 0.5 * Math.pow(1 - contrast / 20, 2) + 0.004;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, fray = (0.6 * snoise(444, x, y, 1.5 + smooth * 0.2) + 0.4 * (2 * rand(445, x, y) - 1)) * 0.08; out[i] = ramp((T[i] + fray - bal) / soft + 0.5);
  }
  gray(img, out);
}

export function waterPaper(img: ImageData, p: any) {
  const fiber = Math.max(3, Math.min(50, p.fiber ?? 15)), br = ((p.brightness ?? 50) - 50) / 100, ct = (p.contrast ?? 50) / 50;
  const P = planes(img), S = new Smear(P, fiber * 0.5), w = P.w, h = P.h, c = [0, 0, 0, 0], cell = fiber * 0.8;
  const out = { r: P.r.slice(), g: P.g.slice(), b: P.b.slice() };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, ang = Math.PI * vnoise(498, x / cell, y / cell) * 2; S.at(x, y, Math.cos(ang), Math.sin(ang), c);
    const fib = 0.06 * (vnoise(499, x / 1.2, y / (fiber * 0.4)) - 0.5) + 0.05 * snoise(500, x, y, fiber * 0.6);
    for (const [k, ch] of [[0, 'r'], [1, 'g'], [2, 'b']] as const) { const v = c[3] > 0 ? c[k] : P[ch][i]; out[ch][i] = (v - 0.5) * ct + 0.5 + br + fib + 0.04; }
  }
  write(img, out);
}

// ================================================================================================================
// Distorsionar, Textura y Vídeo
// ================================================================================================================
export function diffuseGlow(img: ImageData, p: any) {
  const grain = clamp01((p.graininess ?? 6) / 10), glow = clamp01((p.glow ?? 10) / 20), clear = clamp01((p.clear ?? 15) / 20);
  const P = planes(img), w = P.w, h = P.h, T = tonesOf(P), G = new Float32Array(w * h);
  for (let i = 0; i < G.length; i++) G[i] = ramp((T[i] - (0.35 + 0.55 * clear)) / 0.25 + 0.5);
  blurPlane(G, w, h, 6);
  for (let i = 0; i < G.length; i++) {
    const g = clamp01(G[i] * glow * 2.2), x = i % w, y = (i / w) | 0, spark = rand(159, x, y) < grain * (0.04 + 0.25 * g) ? 0.6 : 0, k = Math.min(1, g + spark);
    P.r[i] += (1 - P.r[i]) * k; P.g[i] += (1 - P.g[i]) * k; P.b[i] += (1 - P.b[i]) * k;
  }
  write(img, P);
}

export function oceanRipple(img: ImageData, p: any) {
  const wave = Math.max(1, Math.min(15, p.size ?? 9)) + 2, mag = Math.max(0, Math.min(20, p.magnitude ?? 9)) * 0.45;
  const { width: w, height: h } = img, src = new Uint8ClampedArray(img.data), o = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const q = (y * w + x) * 4; if (!src[q + 3]) continue;
    // ondas: el desplazamiento sigue un seno del ruido, como la superficie del agua
    const dx = Math.sin(snoise(146, x, y, wave) * Math.PI * 2) * mag, dy = Math.sin(snoise(147, x, y, wave) * Math.PI * 2) * mag;
    sampleInto(src, w, h, x + dx, y + dy, o, q); o[q + 3] = src[q + 3];
  }
}

export function grain(img: ImageData, p: any) {
  const amt = clamp01((p.intensity ?? 40) / 100), kind = p.kind ?? 'regular', cf = Math.pow(4, ((p.contrast ?? 50) - 50) / 50);
  const P = planes(img), w = P.w, h = P.h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; let n = 0, white = 0, mono = true;
    switch (kind) {
      case 'soft': n = snoise(358, x, y, 1.6); break;
      case 'sprinkles': white = rand(358, x, y) < amt * 0.25 ? 1 : 0; break;
      case 'clumped': n = ramp((vnoise(358, x / 2.5, y / 2.5) - 0.5) * 4 + 0.5) * 2 - 1; break;
      case 'contrasty': n = rand(358, x, y) > 0.5 ? 1.4 : -1.4; break;
      case 'enlarged': n = 2 * rand(358, x >> 1, y >> 1) - 1; break;
      case 'stippled': n = rand(358, x, y) < amt * 0.25 ? -2 : 0; white = rand(359, x, y) < amt * 0.12 ? 1 : 0; break;
      case 'horizontal': n = 2 * vnoise(358, x / 6, y) - 1; break;
      case 'vertical': n = 2 * vnoise(358, x, y / 6) - 1; break;
      case 'speckle': n = rand(358, x, y) < 0.15 ? (2 * rand(359, x, y) - 1) * 2 : 0; break;
      default: n = 2 * rand(358, x, y) - 1; mono = false;
    }
    for (const [ch, s] of [['r', 0], ['g', 1], ['b', 2]] as const) {
      let v = (P[ch][i] - 0.5) * cf + 0.5;
      const nn = mono ? n : 0.7 * n + 0.3 * (2 * rand(360 + s, x, y) - 1);
      v += nn * amt * 0.45; if (white) v = 1; P[ch][i] = v;
    }
  }
  write(img, P);
}

export function mosaicTiles(img: ImageData, p: any) {
  const tile = Math.max(2, Math.min(100, p.tile ?? 12)), grout = 0.5 * Math.max(1, Math.min(15, p.grout ?? 3)), lighten = clamp01((p.lighten ?? 9) / 10);
  const P = planes(img), w = P.w, h = P.h, bevel = Math.max(1, tile * 0.15), pt = (i: number, j: number) => [(i + 0.15 + 0.7 * rand(424, i, j, 0)) * tile, (j + 0.15 + 0.7 * rand(424, i, j, 1)) * tile];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, ci = Math.floor(x / tile), cj = Math.floor(y / tile); let d1 = 1e9, d2 = 1e9, nx = 0, ny = 0, mx = 0, my = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const [px, py] = pt(ci + di, cj + dj), d = (x - px) ** 2 + (y - py) ** 2;
      if (d < d1) { d2 = d1; mx = nx; my = ny; d1 = d; nx = px; ny = py; } else if (d < d2) { d2 = d; mx = px; my = py; }
    }
    // distancia al borde entre las dos teselas más cercanas
    const ex = mx - nx, ey = my - ny, el = Math.hypot(ex, ey) || 1, edge = ((x - (nx + mx) / 2) * ex + (y - (ny + my) / 2) * ey) / -el;
    const l = luma(P.r[i], P.g[i], P.b[i]);
    if (edge < grout) { const gr = 0.25 + 0.6 * lighten; P.r[i] = P.r[i] * 0.25 + gr * 0.75 * (0.6 + 0.4 * l); P.g[i] = P.g[i] * 0.25 + gr * 0.75 * (0.6 + 0.4 * l); P.b[i] = P.b[i] * 0.25 + gr * 0.75 * (0.6 + 0.4 * l); continue; }
    if (edge < grout + bevel) { const face = (-(ex / el) * -0.7 - (ey / el) * -0.7), k = 1 + 0.35 * face * (1 - (edge - grout) / bevel); P.r[i] *= k; P.g[i] *= k; P.b[i] *= k; }
  }
  write(img, P);
}

export function patchwork(img: ImageData, p: any) {
  const sq = Math.max(1, Math.round(1 + 1.5 * Math.max(0, Math.min(10, p.square ?? 4)))), relief = Math.max(0, Math.min(25, p.relief ?? 8)) / 25;
  const P = planes(img), w = P.w, h = P.h, out = { r: P.r.slice(), g: P.g.slice(), b: P.b.slice() }, side = Math.max(1, sq * 0.22);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, ci = Math.floor(x / sq), cj = Math.floor(y / sq), k = Math.min(h - 1, cj * sq + (sq >> 1)) * w + Math.min(w - 1, ci * sq + (sq >> 1));
    const fx = x - ci * sq, fy = y - cj * sq, hgt = (luma(P.r[k], P.g[k], P.b[k]) + 0.25 * (rand(460, ci, cj) - 0.5)) * relief;
    let shade = 1; if (fx < side || fy < side) shade += 0.6 * hgt; else if (fx >= sq - side || fy >= sq - side) shade -= 0.6 * hgt;
    out.r[i] = P.r[k] * shade; out.g[i] = P.g[k] * shade; out.b[i] = P.b[k] * shade;
  }
  write(img, out);
}

export function ntscColors(img: ImageData) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, y = 0.299 * r + 0.587 * g + 0.114 * b;
    let I = 0.596 * r - 0.274 * g - 0.322 * b, Q = 0.211 * r - 0.523 * g + 0.312 * b; const c = Math.hypot(I, Q);
    // la señal de televisión no puede pasar del 110 % del blanco ni bajar del −20 %: se rebaja la saturación
    const lim = Math.min(c, 1.1 - y, y + 0.2); if (c > 1e-6 && lim < c) { const k = Math.max(0, lim) / c; I *= k; Q *= k; }
    d[i] = clamp01(y + 0.956 * I + 0.621 * Q) * 255; d[i + 1] = clamp01(y - 0.272 * I - 0.647 * Q) * 255; d[i + 2] = clamp01(y - 1.106 * I + 1.703 * Q) * 255;
  }
}
