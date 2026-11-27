// Texturas para videojuegos: generador de texturas repetibles (sin costuras) de ladrillo, piedra, baldosas, madera,
// hierba, tierra, hormigón, asfalto, metal, tejas, agua y mármol, en estilo realista o pixel art; «Hacer repetible»
// para cualquier imagen; vista en mosaico; y mapas para motores de juego (normal, relieve, rugosidad y oclusión).
// Todo el ruido es periódico: lo que sale por un borde entra por el contrario, así la textura se repite sin cortes.
import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog } from './dialog';
import { ctx2d, makeCanvas } from '../core/canvas';
import { EditorDocument } from '../core/document';
import { RasterLayer } from '../core/layers';

// ---- ruido periódico -------------------------------------------------------------------------
const hash = (x: number, y: number, s: number) => { let n = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); n ^= n >>> 16; return (n >>> 0) / 4294967296; };
const fade = (t: number) => t * t * (3 - 2 * t);
const mod = (a: number, p: number) => ((a % p) + p) % p;
/** Ruido de valor en (x, y) con periodo p (en celdas): repetible. */
function vnoise(x: number, y: number, p: number, s: number) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = fade(x - x0), fy = fade(y - y0);
  const a = mod(x0, p), b = mod(y0, p), a1 = mod(x0 + 1, p), b1 = mod(y0 + 1, p);
  const v00 = hash(a, b, s), v10 = hash(a1, b, s), v01 = hash(a, b1, s), v11 = hash(a1, b1, s);
  return (v00 + (v10 - v00) * fx) * (1 - fy) + (v01 + (v11 - v01) * fx) * fy;
}
/** Ruido fractal repetible en (u, v) ∈ [0,1): `px` y `py` celdas en cada eje en la primera octava. */
function fbm(u: number, v: number, px: number, py: number, oct: number, s: number) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) { const k = 1 << o; sum += amp * vnoise(u * px * k, v * py * k, px * k, s + o * 101); norm += amp; amp *= 0.5; }
  // (el periodo en y es py·k: se usa el mismo truco con una segunda llamada si px ≠ py)
  return sum / norm;
}
function fbm2(u: number, v: number, px: number, py: number, oct: number, s: number) {
  if (px === py) return fbm(u, v, px, py, oct, s);
  // periodos distintos en cada eje: ruido de valor con periodo independiente
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) {
    const k = 1 << o, X = u * px * k, Y = v * py * k, x0 = Math.floor(X), y0 = Math.floor(Y), fx = fade(X - x0), fy = fade(Y - y0), Px = px * k, Py = py * k, so = s + o * 101;
    const a = mod(x0, Px), b = mod(y0, Py), a1 = mod(x0 + 1, Px), b1 = mod(y0 + 1, Py);
    const v00 = hash(a, b, so), v10 = hash(a1, b, so), v01 = hash(a, b1, so), v11 = hash(a1, b1, so);
    sum += amp * ((v00 + (v10 - v00) * fx) * (1 - fy) + (v01 + (v11 - v01) * fx) * fy); norm += amp; amp *= 0.5;
  }
  return sum / norm;
}
/** Voronoi repetible: distancias a los dos puntos más cercanos y el identificador de la celda. */
function voronoi(u: number, v: number, p: number, s: number, jitter = 0.85) {
  const X = u * p, Y = v * p, cx = Math.floor(X), cy = Math.floor(Y);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const gx = cx + i, gy = cy + j, wx = mod(gx, p), wy = mod(gy, p);
    const px = gx + 0.5 + (hash(wx, wy, s) - 0.5) * jitter, py = gy + 0.5 + (hash(wx, wy, s + 7) - 0.5) * jitter;
    const d = Math.hypot(px - X, py - Y);
    if (d < f1) { f2 = f1; f1 = d; id = wx * 7919 + wy; } else if (d < f2) f2 = d;
  }
  return { f1, f2, id };
}
const clamp = (v: number, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const sstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const rgb = (hex: string): [number, number, number] => { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const mix = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: number[], k: number) => [a[0] * k, a[1] * k, a[2] * k];

/** Grietas: bordes de celdas de Voronoi con el espacio deformado por ruido (repetible), solo donde el ruido lo permite. */
function cracks(u: number, v: number, p: TexParams, cells: number) {
  if (p.wear <= 0) return 0;
  const wu = u + (fbm(u, v, 4, 4, 3, p.seed + 21) - 0.5) * 0.12, wv = v + (fbm(u, v, 4, 4, 3, p.seed + 22) - 0.5) * 0.12;
  const w = minW(p, 0.035, cells * 1.5), vo = voronoi(wu, wv, cells, p.seed + 23), line = 1 - sstep(w * 0.15, w, vo.f2 - vo.f1);
  const th = 0.66 - p.wear * 0.3, m = sstep(th, th + 0.06, fbm(u, v, 3, 3, 3, p.seed + 24));
  return line * m;
}
// ---- tipos de textura ---------------------------------------------------------------------------
export type TexParams = { type: string; size: number; scale: number; c1: string; c2: string; variation: number; wear: number; relief: number; seed: number; pixel: boolean; /** tamaño de un píxel (interno) */ _px?: number };
/** Grosor mínimo de una línea: en pixel art, al menos un píxel (para que juntas y ranuras no desaparezcan). */
const minW = (p: TexParams, w: number, cells: number) => p.pixel ? Math.max(w, 0.62 * cells * (p._px ?? 0)) : w;
type Gen = (u: number, v: number, p: TexParams, c1: number[], c2: number[]) => { c: number[]; h: number };

export const TEX_TYPES: { id: string; name: string; c1: string; c2: string; scale: number; gen: Gen }[] = [
  { id: 'brick', name: 'Ladrillos', c1: '#9c4a32', c2: '#b9b1a3', scale: 8, gen: (u, v, p, c1, c2) => {
    const rows = p.scale, cols = Math.max(1, Math.round(p.scale / 2)), r = Math.floor(v * rows), off = (mod(r, 2)) * 0.5 / cols, x = mod(u + off, 1), c = Math.floor(x * cols);
    const lx = x * cols - c, ly = v * rows - r, d = Math.min(Math.min(lx, 1 - lx) * rows / cols, Math.min(ly, 1 - ly)), mw = minW(p, 0.09, rows); // en unidades de alto del ladrillo
    const g = fbm(u, v, 16, 16, 4, p.seed), id = hash(mod(c, cols), mod(r, rows), p.seed);
    if (d < mw) return { c: mul(c2, 0.85 + g * 0.3), h: 0.1 + g * 0.1 };
    const bevel = sstep(mw, mw + 0.12, d), tone = 1 + (id - 0.5) * p.variation * 0.6 + (g - 0.5) * 0.35;
    const dirt = sstep(0.55, 0.8, fbm(u, v, 6, 6, 4, p.seed + 3)) * p.wear;
    return { c: mix(mul(c1, tone), mul(c1, 0.45), dirt * 0.7), h: 0.45 + bevel * 0.45 + (g - 0.5) * 0.15 };
  } },
  { id: 'stone', name: 'Piedra (adoquines)', c1: '#8d8a83', c2: '#4b4740', scale: 6, gen: (u, v, p, c1, c2) => {
    const vo = voronoi(u, v, p.scale, p.seed), e = vo.f2 - vo.f1, mw = minW(p, 0.07, p.scale * 1.3), g = fbm(u, v, 12, 12, 5, p.seed + 1);
    if (e < mw) return { c: mul(c2, 0.8 + g * 0.4), h: 0.05 + g * 0.1 };
    const id = hash(vo.id, 3, p.seed), dome = sstep(mw, 0.4, e) * (1 - vo.f1 * 0.45);
    const tone = 1 + (id - 0.5) * p.variation * 0.7 + (g - 0.5) * 0.4, moss = sstep(0.6, 0.75, fbm(u, v, 5, 5, 4, p.seed + 9)) * p.wear * (1 - dome);
    return { c: mix(mul(c1, tone), [0.25, 0.4, 0.15], moss), h: 0.3 + dome * 0.6 + (g - 0.5) * 0.12 };
  } },
  { id: 'tiles', name: 'Baldosas', c1: '#d9d4c7', c2: '#6f6a62', scale: 6, gen: (u, v, p, c1, c2) => {
    const n = p.scale, cx = Math.floor(u * n), cy = Math.floor(v * n), lx = u * n - cx, ly = v * n - cy, d = Math.min(lx, 1 - lx, ly, 1 - ly), mw = minW(p, 0.05, n);
    const g = fbm(u, v, 24, 24, 3, p.seed), dirt = sstep(0.55, 0.8, fbm(u, v, 5, 5, 4, p.seed + 5)) * p.wear;
    if (d < mw) return { c: mul(c2, (0.85 + g * 0.3) * (1 - dirt * 0.4)), h: 0.1 };
    const id = hash(mod(cx, n), mod(cy, n), p.seed), tone = 1 + (id - 0.5) * p.variation * 0.35 + (g - 0.5) * 0.1;
    return { c: mul(c1, tone * (1 - dirt * 0.25)), h: 0.5 + sstep(mw, mw + 0.06, d) * 0.4 };
  } },
  { id: 'wood', name: 'Madera (tablas)', c1: '#b07a45', c2: '#6b4123', scale: 5, gen: (u, v, p, c1, c2) => {
    const n = p.scale, i = Math.floor(u * n), lx = u * n - i, id = hash(mod(i, n), 0, p.seed);
    const seamV = Math.min(lx, 1 - lx), joint = mod(v + id, 1), seamH = Math.min(joint, 1 - joint) * 4;
    const g = fbm2(u, v, n * 6, 2, 5, p.seed + Math.floor(id * 50)), ring = 0.5 + 0.5 * Math.sin((g * 9 + id * 6) * Math.PI * 2);
    const tone = 1 + (id - 0.5) * p.variation * 0.6;
    if (seamV < minW(p, 0.025, n) || seamH < minW(p, 0.012, 4)) return { c: mul(c2, 0.55), h: 0.05 };
    const worn = fbm(u, v, 8, 8, 4, p.seed + 4) * p.wear;
    return { c: mul(mix(c1, c2, ring * 0.55 + worn * 0.3), tone), h: 0.5 + ring * 0.12 + sstep(0.025, 0.08, seamV) * 0.3 };
  } },
  { id: 'grass', name: 'Hierba', c1: '#4f8a2e', c2: '#2c5a1a', scale: 6, gen: (u, v, p, c1, c2) => {
    const base = fbm(u, v, p.scale, p.scale, 5, p.seed), blades = fbm2(u, v, 96, 24, 2, p.seed + 2), dry = sstep(0.6, 0.85, fbm(u, v, 4, 4, 4, p.seed + 6)) * p.wear;
    const t = clamp(base * 0.8 + (blades - 0.5) * 1.2 * (0.5 + p.variation));
    return { c: mix(mix(c2, c1, t), [0.65, 0.6, 0.3], dry), h: t };
  } },
  { id: 'dirt', name: 'Tierra', c1: '#7a5a3a', c2: '#4e3826', scale: 6, gen: (u, v, p, c1, c2) => {
    const g = fbm(u, v, p.scale, p.scale, 6, p.seed), vo = voronoi(u, v, p.scale * 2, p.seed + 3, 1), r = 0.18 + p.variation * 0.22;
    const peb = hash(vo.id, 2, p.seed) < 0.3 && vo.f1 < r ? Math.sqrt(1 - vo.f1 / r) : 0, wet = sstep(0.6, 0.8, fbm(u, v, 3, 3, 4, p.seed + 7)) * p.wear;
    const stone = mix(mul(c1, 1.15), [0.5, 0.47, 0.43], 0.5).map(x => x * (0.75 + hash(vo.id, 1, p.seed) * 0.35));
    return { c: mul(mix(mix(c2, c1, g), stone, sstep(0, 0.2, peb)), 1 - wet * 0.35), h: g * 0.4 + peb * 0.6 };
  } },
  { id: 'concrete', name: 'Hormigón', c1: '#9a9893', c2: '#55534e', scale: 4, gen: (u, v, p, c1, c2) => {
    const g = fbm(u, v, p.scale * 2, p.scale * 2, 6, p.seed), sp = hash(Math.floor(u * 512), Math.floor(v * 512), p.seed) < 0.05 ? 0.88 : 1;
    const cr = cracks(u, v, p, p.scale), stain = sstep(0.55, 0.8, fbm(u, v, 3, 3, 4, p.seed + 5)) * p.variation;
    return { c: mul(mix(mix(c1, c2, stain * 0.5), mul(c2, 0.6), cr * 0.85), (0.86 + g * 0.28) * sp), h: 0.45 + g * 0.25 - cr * 0.25 };
  } },
  { id: 'asphalt', name: 'Asfalto', c1: '#3c3c3e', c2: '#1f1f21', scale: 4, gen: (u, v, p, c1, c2) => {
    const g = fbm(u, v, p.scale * 2, p.scale * 2, 5, p.seed), gr = hash(Math.floor(u * 384), Math.floor(v * 384), p.seed), stone = gr > 0.9 ? 1.45 : gr < 0.08 ? 0.7 : 1;
    const cr = cracks(u, v, p, p.scale);
    return { c: mul(mix(mix(c1, c2, (1 - g) * p.variation * 0.5), mul(c2, 0.5), cr * 0.9), stone * (0.86 + g * 0.28)), h: 0.4 + g * 0.2 + (stone - 1) * 0.08 - cr * 0.2 };
  } },
  { id: 'metal', name: 'Metal (paneles)', c1: '#8b9196', c2: '#8a4a24', scale: 2, gen: (u, v, p, c1, c2) => {
    const n = p.scale, cx = Math.floor(u * n), cy = Math.floor(v * n), lx = u * n - cx, ly = v * n - cy, d = Math.min(lx, 1 - lx, ly, 1 - ly);
    const brushed = fbm2(u, v, 4, 128, 2, p.seed + cx * 3 + cy), rust = sstep(0.55, 0.75, fbm(u, v, 6, 6, 5, p.seed + 2)) * p.wear;
    const rx = Math.min(lx, 1 - lx), ry = Math.min(ly, 1 - ly), rv = Math.hypot(rx - 0.06, ry - 0.06), rivet = rv < 0.025 ? 1 - rv / 0.025 : 0;
    if (d < minW(p, 0.012, n)) return { c: mul(c1, 0.35), h: 0.05 };
    const tone = 0.8 + brushed * 0.35 + (hash(mod(cx, n), mod(cy, n), p.seed) - 0.5) * p.variation * 0.3;
    return { c: mix(mul(c1, tone + rivet * 0.3), c2, rust), h: 0.5 + sstep(0.012, 0.04, d) * 0.2 + rivet * 0.3 };
  } },
  { id: 'roof', name: 'Tejas', c1: '#a8452e', c2: '#5e2418', scale: 8, gen: (u, v, p, c1, c2) => {
    const rows = p.scale, cols = Math.max(1, Math.round(p.scale * 0.75)), r = Math.floor(v * rows), off = mod(r, 2) * 0.5 / cols, x = mod(u + off, 1), c = Math.floor(x * cols);
    const lx = x * cols - c, ly = v * rows - r, curve = 1 - 0.35 * (1 - (2 * lx - 1) ** 2), inside = ly < curve;
    const id = hash(mod(c, cols), mod(r, rows), p.seed), g = fbm(u, v, 16, 16, 3, p.seed);
    if (!inside) return { c: mul(c2, 0.7), h: 0.1 };
    const shade = sstep(0, 0.9, ly / curve) * (1 - Math.abs(2 * lx - 1) * 0.3), moss = sstep(0.62, 0.78, fbm(u, v, 5, 5, 4, p.seed + 3)) * p.wear;
    return { c: mix(mul(c1, (0.65 + shade * 0.5) * (1 + (id - 0.5) * p.variation * 0.5) * (0.9 + g * 0.2)), [0.3, 0.38, 0.18], moss), h: 0.2 + shade * 0.7 };
  } },
  { id: 'water', name: 'Agua', c1: '#2f7fb8', c2: '#0d3a63', scale: 4, gen: (u, v, p, c1, c2) => {
    const g = fbm(u, v, p.scale, p.scale, 5, p.seed), w = fbm(u + g * 0.15, v, p.scale * 2, p.scale * 2, 4, p.seed + 1), lines = 1 - sstep(0, 0.05 + p.variation * 0.05, Math.abs(w - 0.5));
    return { c: mix(mix(c2, c1, g), [0.85, 0.95, 1], lines * 0.55), h: g * 0.5 + lines * 0.3 };
  } },
  { id: 'marble', name: 'Mármol', c1: '#ece9e2', c2: '#6d6a66', scale: 3, gen: (u, v, p, c1, c2) => {
    let t = 0, amp = 0.5; for (let o = 0; o < 5; o++) { const k = 1 << o; t += amp * Math.abs(vnoise(u * 4 * k, v * 4 * k, 4 * k, p.seed + o * 31) - 0.5) * 2; amp *= 0.5; }
    const s = Math.abs(Math.sin((u + v) * p.scale * Math.PI + t * 6)), vein = Math.pow(1 - s, 10 - p.variation * 6), cloud = fbm(u, v, p.scale, p.scale, 4, p.seed + 2);
    return { c: mix(mul(c1, 0.93 + cloud * 0.1), c2, clamp(vein * 1.1) * 0.85), h: 0.5 };
  } },
];

/** Genera la textura (colores y relieve) del tamaño indicado. */
export function generateTexture(p: TexParams, size = p.size): { canvas: HTMLCanvasElement; height: Float32Array } {
  const t = TEX_TYPES.find(x => x.id === p.type) ?? TEX_TYPES[0], c1 = rgb(p.c1), c2 = rgb(p.c2);
  const W = size, H = size, col = new Float32Array(W * H * 3), hm = new Float32Array(W * H), pp = { ...p, _px: 1 / size };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = t.gen((x + 0.5) / W, (y + 0.5) / H, pp, c1, c2), i = y * W + x;
    col[i * 3] = r.c[0]; col[i * 3 + 1] = r.c[1]; col[i * 3 + 2] = r.c[2]; hm[i] = r.h;
  }
  // relieve: luz desde arriba a la izquierda con la pendiente del mapa de alturas (repetible: los bordes se dan la vuelta)
  const k = p.relief / 100 * Math.max(W / 64, p.pixel ? 1.2 : 0) * 1.5, c = makeCanvas(W, H), x2 = ctx2d(c), img = x2.createImageData(W, H), o = img.data;
  // pixel art: cada píxel toma el tono más cercano de una paleta corta hecha con los dos colores de la textura
  // (así no aparecen tintes raros, como al reducir cada canal por separado)
  const pal: number[][] = p.pixel ? [...[0.5, 0.68, 0.84, 1, 1.18].map(k => mul(c1, k)), ...[0.55, 0.8, 1.05].map(k => mul(c2, k)), mul(mix(c1, c2, 0.5), 0.9)].map(c => c.map(v => clamp(v))) : [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, hx = hm[y * W + (x + 1) % W] - hm[y * W + (x - 1 + W) % W], hy = hm[((y + 1) % H) * W + x] - hm[((y - 1 + H) % H) * W + x];
    const shade = clamp(1 - (hx + hy) * k * 0.7, 0.35, 1.6);
    const r = clamp(col[i * 3] * shade), g = clamp(col[i * 3 + 1] * shade), b = clamp(col[i * 3 + 2] * shade);
    if (pal.length) { let best = pal[0], bd = 9; for (const q of pal) { const dd = (q[0] - r) ** 2 * 0.3 + (q[1] - g) ** 2 * 0.59 + (q[2] - b) ** 2 * 0.11; if (dd < bd) { bd = dd; best = q; } } o[i * 4] = best[0] * 255 + 0.5; o[i * 4 + 1] = best[1] * 255 + 0.5; o[i * 4 + 2] = best[2] * 255 + 0.5; }
    else { o[i * 4] = r * 255 + 0.5; o[i * 4 + 1] = g * 255 + 0.5; o[i * 4 + 2] = b * 255 + 0.5; }
    o[i * 4 + 3] = 255;
  }
  x2.putImageData(img, 0, 0);
  return { canvas: c, height: hm };
}

// ---- diálogo del generador --------------------------------------------------------------------
const LAST = 'editor.texGen';
export function textureDialog() {
  let saved: Partial<TexParams> = {}; try { saved = JSON.parse(localStorage.getItem(LAST) || '{}'); } catch { /* */ }
  const p: TexParams = { type: 'brick', size: 512, scale: 8, c1: '#9c4a32', c2: '#b9b1a3', variation: 0.5, wear: 0.3, relief: 60, seed: 1, pixel: false, ...saved };
  const pv = h('canvas', { class: 'tex-pv', width: 256, height: 256 }) as HTMLCanvasElement;
  let pending = 0;
  const redraw = () => { if (pending) return; pending = requestAnimationFrame(() => { pending = 0; const t = generateTexture(p, p.pixel ? Math.min(p.size, 64) : 128), x = ctx2d(pv); x.imageSmoothingEnabled = !p.pixel; for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) x.drawImage(t.canvas, i * 128, j * 128, 128, 128); }); };
  // tipos (con miniatura)
  const types = h('div', { class: 'tex-types' });
  const c1 = h('input', { type: 'color', value: p.c1, class: 'color-input', 'aria-label': 'Color principal' }) as HTMLInputElement;
  const c2 = h('input', { type: 'color', value: p.c2, class: 'color-input', 'aria-label': 'Color secundario' }) as HTMLInputElement;
  const sc = numberSlider({ min: 1, max: 24, value: p.scale, onInput: v => { p.scale = v; redraw(); } });
  const setScale = (n: number) => { p.scale = n; (sc.el.querySelector('input.num') as HTMLInputElement).value = String(n); (sc.el.querySelector('input[type=range]') as HTMLInputElement).value = String(n); };
  for (const t of TEX_TYPES) {
    const th = generateTexture({ ...p, type: t.id, c1: t.c1, c2: t.c2, scale: t.scale, pixel: false }, 48).canvas;
    const b = h('button', { type: 'button', class: 'tex-type' + (t.id === p.type ? ' on' : ''), title: t.name, 'data-t': t.id }, th, h('span', {}, t.name));
    b.onclick = () => {
      p.type = t.id; p.c1 = t.c1; p.c2 = t.c2; c1.value = t.c1; c2.value = t.c2; setScale(p.pixel ? Math.max(2, Math.round(t.scale / 2)) : t.scale);
      types.querySelectorAll('.tex-type').forEach(x => x.classList.toggle('on', x === b)); redraw();
    };
    types.append(b);
  }
  c1.oninput = () => { p.c1 = c1.value; redraw(); }; c2.oninput = () => { p.c2 = c2.value; redraw(); };
  const size = h('select', {}, ...[64, 128, 256, 512, 1024, 2048].map(n => h('option', { value: String(n) }, `${n} × ${n}`))); size.value = String(p.size);
  size.onchange = () => { p.size = +size.value; redraw(); };
  const style = h('select', {}, h('option', { value: 'real' }, 'Realista'), h('option', { value: 'pixel' }, 'Pixel art')); style.value = p.pixel ? 'pixel' : 'real';
  style.onchange = () => { p.pixel = style.value === 'pixel'; if (p.pixel && p.size > 128) { p.size = 64; size.value = '64'; } if (p.pixel) setScale(Math.max(2, Math.round(p.scale / 2))); redraw(); };
  const seed = h('input', { type: 'number', class: 'num', min: 1, max: 99999, value: String(p.seed) }) as HTMLInputElement;
  seed.onchange = () => { p.seed = Math.max(1, +seed.value || 1); redraw(); };
  const dice = h('button', { type: 'button', class: 'btn', title: 'Otra variante al azar' }, 'Otra variante');
  dice.onclick = () => { p.seed = 1 + Math.floor(Math.random() * 99998); seed.value = String(p.seed); redraw(); };
  const row = (label: string, ...els: (HTMLElement | string)[]) => h('div', { class: 'form-row' }, h('label', {}, label), ...els);
  const pct = (key: 'variation' | 'wear', label: string) => row(label, numberSlider({ min: 0, max: 100, value: Math.round(p[key] * 100), unit: '%', onInput: v => { p[key] = v / 100; redraw(); } }).el);
  const save = () => { try { localStorage.setItem(LAST, JSON.stringify(p)); } catch { /* */ } };
  const make = () => { app.toast('Generando la textura…'); return generateTexture(p).canvas; };
  let dlg: { close: () => void } | null = null;
  const asLayer = h('button', { type: 'button', class: 'btn', title: 'Rellena una capa nueva del documento abierto con la textura repetida' }, 'Añadir como capa');
  asLayer.onclick = () => {
    const d = app.doc; if (!d) { app.toast('Abre antes un documento', 'warn'); return; }
    save(); const t = make(), l = new RasterLayer(TEX_TYPES.find(x => x.id === p.type)!.name, d.width, d.height), x = ctx2d(l.canvas);
    x.imageSmoothingEnabled = false; x.fillStyle = x.createPattern(t, 'repeat')!; x.fillRect(0, 0, d.width, d.height);
    d.root.add(l); d.setActive(l, false); d.invalidate(); d.commit('Textura'); app.emit('docs');
    dlg?.close();
  };
  const asPattern = h('button', { type: 'button', class: 'btn', title: 'La guarda como motivo para el bote de pintura, los rellenos y los estilos' }, 'Guardar como motivo');
  asPattern.onclick = async () => { save(); const { addPattern } = await import('../core/patterns'); addPattern(TEX_TYPES.find(x => x.id === p.type)!.name, make()); app.toast('Guardada como motivo: úsala con el bote de pintura (Relleno › Motivo)'); };
  dlg = showDialog({
    title: 'Generador de texturas', okLabel: 'Crear documento', width: 720, extraButtons: [asLayer, asPattern],
    body: [h('div', { class: 'tex-wrap' },
      h('div', { class: 'tex-left' }, types),
      h('div', { class: 'tex-right' },
        h('div', { class: 'tex-pv-wrap' }, pv, h('div', { class: 'hint' }, 'Vista previa repetida 2 × 2: no se ven cortes entre copias.')),
        row('Tamaño', size), row('Estilo', style), row('Escala', sc.el), row('Colores', c1, c2), pct('variation', 'Variación'), pct('wear', 'Desgaste'),
        row('Relieve', numberSlider({ min: 0, max: 100, value: p.relief, unit: '%', onInput: v => { p.relief = v; redraw(); } }).el),
        row('Semilla', seed, dice)))],
    onOk: () => {
      save(); const t = make(), name = TEX_TYPES.find(x => x.id === p.type)!.name;
      const d = new EditorDocument(`${name} ${p.size}`, p.size, p.size), l = new RasterLayer('Textura', p.size, p.size);
      ctx2d(l.canvas).drawImage(t, 0, 0); d.root.add(l); d.setActive(l, false);
      if (p.pixel) d.meta.pixelArt = true;
      d.meta.tileable = true;
      app.addDocument(d, 'Nueva textura');
      setTilePreview(true);
    },
  });
  redraw();
}

// ---- vista en mosaico ---------------------------------------------------------------------------
export function setTilePreview(on: boolean) { const d = app.doc; if (!d) return; (d as any).tilePreview = on; app.viewport.requestRender(); app.emit('view'); }
export function toggleTilePreview() { const d = app.doc; if (!d) return; setTilePreview(!(d as any).tilePreview); app.toast((d as any).tilePreview ? 'Vista en mosaico: se ve cómo queda la imagen repetida' : 'Vista en mosaico desactivada'); }

// ---- hacer repetible --------------------------------------------------------------------------
/** Mezcla la imagen con una copia desplazada media imagen, de modo que los bordes casen al repetirla. */
export function seamless(src: HTMLCanvasElement, blend = 1): HTMLCanvasElement {
  const W = src.width, H = src.height, a = ctx2d(src).getImageData(0, 0, W, H).data, out = makeCanvas(W, H), x = ctx2d(out), img = x.createImageData(W, H), o = img.data;
  const hw = W / 2, hh = H / 2, b = Math.max(0.05, blend);
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    // peso de la imagen original: 0 en sus bordes; peso de la copia desplazada: 0 en el centro (sus propios bordes)
    const wa = Math.pow(Math.min(xx + 0.5, W - xx - 0.5, y + 0.5, H - y - 0.5) / Math.min(hw, hh) / b, 2);
    const wb = Math.pow(Math.min(Math.abs(xx + 0.5 - hw), Math.abs(y + 0.5 - hh)) / Math.min(hw, hh) / b, 2);
    const ta = Math.min(1, wa), tb = Math.min(1, wb), s = ta + tb || 1, i = (y * W + xx) * 4, j = (((y + hh) % H | 0) * W + ((xx + hw) % W | 0)) * 4;
    for (let c = 0; c < 4; c++) o[i + c] = (a[i + c] * ta + a[j + c] * tb) / s;
  }
  x.putImageData(img, 0, 0);
  return out;
}
export function seamlessDialog() {
  const d = app.doc, l = d?.activeRaster(); if (!d || !l) { app.toast('Elige una capa de imagen', 'warn'); return; }
  let blend = 60;
  const before = ctx2d(l.canvas).getImageData(0, 0, l.canvas.width, l.canvas.height);
  const preview = () => { const tmp = makeCanvas(before.width, before.height); ctx2d(tmp).putImageData(before, 0, 0); const r = seamless(tmp, blend / 100); const x = ctx2d(l.canvas); x.clearRect(0, 0, r.width, r.height); x.drawImage(r, 0, 0); l.touch(); d.invalidate(); app.viewport.requestRender(); };
  setTilePreview(true); preview();
  showDialog({
    title: 'Hacer repetible (sin costuras)', width: 400, side: true,
    body: [h('div', { class: 'form-row' }, h('label', {}, 'Mezcla'), numberSlider({ min: 10, max: 100, value: blend, unit: '%', onInput: v => { blend = v; preview(); } }).el),
      h('div', { class: 'hint' }, 'Los bordes se funden con la parte de dentro para que la imagen se pueda repetir sin que se note el corte. La vista en mosaico enseña el resultado.')],
    onOk: () => { d.commit('Hacer repetible'); d.meta.tileable = true; },
    onCancel: () => { ctx2d(l.canvas).putImageData(before, 0, 0); l.touch(); d.invalidate(); app.viewport.requestRender(); },
  });
}

// ---- mapas para motores de juego ------------------------------------------------------------
type Maps = { normal: HTMLCanvasElement; height: HTMLCanvasElement; rough: HTMLCanvasElement; ao: HTMLCanvasElement };
/** Mapas a partir del brillo de la imagen (repetibles si la imagen lo es). */
export function textureMaps(src: HTMLCanvasElement, strength = 1, directx = false, wrap = true): Maps {
  const W = src.width, H = src.height, a = ctx2d(src).getImageData(0, 0, W, H).data, L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = (a[i * 4] * 0.299 + a[i * 4 + 1] * 0.587 + a[i * 4 + 2] * 0.114) / 255;
  // relieve suavizado (caja 3×3) para que el normal no sea solo ruido
  const S = new Float32Array(W * H), at = (x: number, y: number) => wrap ? L[((y + H) % H) * W + (x + W) % W] : L[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += at(x + i, y + j); S[y * W + x] = s / 9; }
  const sAt = (x: number, y: number) => wrap ? S[((y + H) % H) * W + (x + W) % W] : S[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  const mk = () => { const c = makeCanvas(W, H); return { c, x: ctx2d(c), img: ctx2d(c).createImageData(W, H) }; };
  const N = mk(), Hh = mk(), R = mk(), A = mk(), k = strength * 6;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, s = sAt(x, y);
    // Sobel
    const gx = (sAt(x + 1, y - 1) + 2 * sAt(x + 1, y) + sAt(x + 1, y + 1)) - (sAt(x - 1, y - 1) + 2 * sAt(x - 1, y) + sAt(x - 1, y + 1));
    const gy = (sAt(x - 1, y + 1) + 2 * sAt(x, y + 1) + sAt(x + 1, y + 1)) - (sAt(x - 1, y - 1) + 2 * sAt(x, y - 1) + sAt(x + 1, y - 1));
    let nx = -gx * k, ny = (directx ? 1 : -1) * gy * k * -1, nz = 1; const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    N.img.data[i] = (nx * 0.5 + 0.5) * 255; N.img.data[i + 1] = (ny * 0.5 + 0.5) * 255; N.img.data[i + 2] = (nz * 0.5 + 0.5) * 255; N.img.data[i + 3] = 255;
    const hv = s * 255; Hh.img.data[i] = Hh.img.data[i + 1] = Hh.img.data[i + 2] = hv; Hh.img.data[i + 3] = 255;
    // rugosidad: lo oscuro y lo hundido es más áspero; lo claro y liso, más brillante
    const rv = clamp(0.35 + (1 - s) * 0.5 + Math.abs(L[y * W + x] - s) * 2) * 255; R.img.data[i] = R.img.data[i + 1] = R.img.data[i + 2] = rv; R.img.data[i + 3] = 255;
    // oclusión: zonas más bajas que su entorno se oscurecen
    let around = 0; for (let j = -3; j <= 3; j += 3) for (let q = -3; q <= 3; q += 3) around += sAt(x + q, y + j); around /= 9;
    const ao = clamp(1 - Math.max(0, around - s) * 4) * 255; A.img.data[i] = A.img.data[i + 1] = A.img.data[i + 2] = ao; A.img.data[i + 3] = 255;
  }
  for (const m of [N, Hh, R, A]) m.x.putImageData(m.img, 0, 0);
  return { normal: N.c, height: Hh.c, rough: R.c, ao: A.c };
}
export function mapsDialog() {
  const d = app.doc; if (!d) return;
  const src = d.flatten(); let strength = 1, dx = false;
  const names: [keyof Maps, string][] = [['normal', 'Normal'], ['height', 'Relieve (altura)'], ['rough', 'Rugosidad'], ['ao', 'Oclusión ambiental']];
  const cells = names.map(([k, n]) => { const c = h('canvas', { class: 'tex-map', width: 150, height: 150, 'data-map': k }) as HTMLCanvasElement; return { k, c, el: h('div', { class: 'tex-map-cell' }, c, h('span', {}, n)) }; });
  let maps: Maps;
  const redraw = () => { const k = Math.min(1, 256 / Math.max(src.width, src.height)), s = makeCanvas(Math.max(1, Math.round(src.width * k)), Math.max(1, Math.round(src.height * k))); ctx2d(s).drawImage(src, 0, 0, s.width, s.height); const m = textureMaps(s, strength, dx); for (const c of cells) { const x = ctx2d(c.c); x.clearRect(0, 0, 150, 150); x.drawImage(m[c.k], 0, 0, 150, 150); } };
  const fmt = h('select', {}, h('option', { value: 'gl' }, 'OpenGL (Godot, Unity, Blender)'), h('option', { value: 'dx' }, 'DirectX (Unreal)'));
  fmt.onchange = () => { dx = fmt.value === 'dx'; redraw(); };
  redraw();
  const addDocs = h('button', { type: 'button', class: 'btn', title: 'Abre cada mapa como un documento para retocarlo' }, 'Abrir como documentos');
  addDocs.onclick = () => { maps = textureMaps(src, strength, dx); for (const [k, n] of names) { const nd = new EditorDocument(`${d.name} ${n}`, src.width, src.height), l = new RasterLayer(n, src.width, src.height); ctx2d(l.canvas).drawImage(maps[k], 0, 0); nd.root.add(l); nd.setActive(l, false); app.addDocument(nd, 'Nuevo'); } };
  showDialog({
    title: 'Mapas para videojuegos', okLabel: 'Descargar (ZIP)', width: 700, extraButtons: [addDocs],
    body: [h('div', { class: 'tex-maps' }, ...cells.map(c => c.el)),
      h('div', { class: 'form-row' }, h('label', {}, 'Intensidad'), numberSlider({ min: 10, max: 400, value: 100, unit: '%', onInput: v => { strength = v / 100; redraw(); } }).el),
      h('div', { class: 'form-row' }, h('label', {}, 'Formato del normal'), fmt),
      h('div', { class: 'hint' }, 'Se calculan a partir del brillo de la imagen: lo claro se toma como alto y lo oscuro como hundido. Úsalos en el material del motor (Godot, Unity, Unreal, Blender) junto con la textura de color.')],
    onOk: async () => {
      maps = textureMaps(src, strength, dx);
      const { makeZip } = await import('../io/zip'); const io = await import('../io/files');
      const png = async (c: HTMLCanvasElement) => new Uint8Array(await (await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/png'))).arrayBuffer());
      const files = [{ name: `${d.name}_color.png`, data: await png(src) }, { name: `${d.name}_normal.png`, data: await png(maps.normal) }, { name: `${d.name}_height.png`, data: await png(maps.height) }, { name: `${d.name}_roughness.png`, data: await png(maps.rough) }, { name: `${d.name}_ao.png`, data: await png(maps.ao) }];
      try { await io.saveBlob(makeZip(files), `${d.name}_mapas.zip`); app.toast('Exportado'); } catch (e: any) { if (e?.name !== 'AbortError') app.toast('No se pudo exportar: ' + (e?.message ?? e), 'warn'); }
    },
  });
}
