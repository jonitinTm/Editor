// Filtros artísticos y de bocetos (como los de una «galería de filtros»): acuarela, grano de película,
// bordes resplandecientes, boceto a lápiz, carboncillo, pluma de tinta, cuarteado, neón, texturizador,
// vidriera, grabado, bordes posterizados y sello. Además: desenfoque inteligente, destramar y cizalla.
// Todo trabaja sobre ImageData (se ejecuta en un worker), sin tocar la interfaz.

import { gaussianBlur } from './blur';
import { sample } from './advanced';
import { median } from './advanced';
import { surfaceBlur } from './more';

const clamp = (v: number) => v < 0 ? 0 : v > 255 ? 255 : v;
const hex = (s: string) => { const n = parseInt(String(s || '#000').slice(1), 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
function rng(seed: number) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
const copy = (img: ImageData) => new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
/** Luminancia 0..255 de cada píxel. */
function lum(img: ImageData) { const { data: d } = img, n = d.length / 4, L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114; return L; }
/** Desenfoca un canal suelto (Float32) pasándolo por ImageData. */
function blurArr(a: Float32Array, w: number, h: number, r: number) {
  if (r <= 0) return a;
  const im = new ImageData(w, h); for (let i = 0; i < a.length; i++) { const v = clamp(a[i]); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
  gaussianBlur(im, r); const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = im.data[i * 4]; return o;
}
/** Magnitud del gradiente (Sobel) de un canal. */
function sobel(L: Float32Array, w: number, h: number) {
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xm = x > 0 ? x - 1 : x, xp = x < w - 1 ? x + 1 : x, ym = y > 0 ? y - 1 : y, yp = y < h - 1 ? y + 1 : y;
    const a = L[ym * w + xm], b = L[ym * w + x], c = L[ym * w + xp], d = L[y * w + xm], f = L[y * w + xp], gg = L[yp * w + xm], hh = L[yp * w + x], ii = L[yp * w + xp];
    const gx = c + 2 * f + ii - a - 2 * d - gg, gy = gg + 2 * hh + ii - a - 2 * b - c;
    g[y * w + x] = Math.hypot(gx, gy) / 4;
  }
  return g;
}
/** Ruido de valor suavizado (para texturas de papel, lienzo…). */
function valueNoise(w: number, h: number, scale: number, seed: number) {
  const r = rng(seed), gw = Math.ceil(w / scale) + 2, gh = Math.ceil(h / scale) + 2, g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = x / scale, fy = y / scale, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g[iy * gw + ix], b = g[iy * gw + ix + 1], c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
    o[y * w + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  return o;
}

// ---- Acuarela ---------------------------------------------------------------------------------
export function watercolor(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, detail = p.detail ?? 6, shadow = (p.shadow ?? 30) / 100, tex = (p.texture ?? 40) / 100;
  // manchas planas: suavizado que respeta bordes y algo de posterizado suave
  surfaceBlur(img, Math.max(2, 14 - detail), 40);
  const L = lum(img), E = sobel(blurArr(L, w, h, 1.2), w, h);
  const N = valueNoise(w, h, 6, 7), N2 = valueNoise(w, h, 40, 11);
  for (let i = 0; i < w * h; i++) {
    // los bordes se oscurecen (el agua acumula pigmento) y el papel deja manchas
    const edge = Math.min(1, E[i] / 60) * shadow, paper = 1 - tex * 0.18 * (N[i] - 0.5) - tex * 0.12 * (N2[i] - 0.5);
    for (let c = 0; c < 3; c++) { let v = d[i * 4 + c]; v = Math.round(v / 24) * 24 * 0.35 + v * 0.65; v = v * (1 - edge * 0.6) * paper; d[i * 4 + c] = clamp(v + (255 - v) * 0.06); }
  }
}

// ---- Grano de película --------------------------------------------------------------------------
export function filmGrain(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, amt = (p.amount ?? 30) / 100, size = p.size ?? 1.5, hl = (p.highlights ?? 20) / 100;
  const r = rng(p.seed ?? 3), g = new Float32Array(w * h); for (let i = 0; i < g.length; i++) g[i] = (r() + r() + r() - 1.5);
  const G = size > 0.6 ? blurArr(g.map(v => v * 60 + 128), w, h, size * 0.6).map(v => (v - 128) / 60 * Math.max(1, size)) : g;
  for (let i = 0; i < w * h; i++) {
    const l = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
    // el grano se ve sobre todo en los medios tonos; las luces se pueden aclarar un poco
    const wgt = 1 - Math.pow(Math.abs(2 * l - 1), 2) * 0.7, n = G[i] * amt * 45 * wgt, lift = hl * l * l * 40;
    for (let c = 0; c < 3; c++) d[i * 4 + c] = clamp(d[i * 4 + c] + n + lift);
  }
}

// ---- Bordes resplandecientes ----------------------------------------------------------------------
export function glowingEdges(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, width = p.width ?? 2, bright = (p.brightness ?? 6) / 6, smooth = p.smooth ?? 5;
  const src = copy(img); gaussianBlur(src, smooth * 0.4);
  const ch = [0, 1, 2].map(c => { const a = new Float32Array(w * h); for (let i = 0; i < w * h; i++) a[i] = src.data[i * 4 + c]; return blurArr(sobel(a, w, h), w, h, width * 0.5); });
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) d[i * 4 + c] = clamp(ch[c][i] * 2.2 * bright);
}

// ---- Boceto a lápiz (sobreexponer color con la imagen invertida y desenfocada) -----------------
export function pencilSketch(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, width = p.width ?? 6, dark = (p.darkness ?? 50) / 100, color = !!p.color;
  const L = lum(img), inv = blurArr(L.map(v => 255 - v), w, h, width);
  const N = valueNoise(w, h, 1.5, 5);
  for (let i = 0; i < w * h; i++) {
    let s = inv[i] >= 255 ? 255 : Math.min(255, L[i] * 255 / (255 - inv[i]));
    s = 255 - (255 - s) * (0.6 + dark * 1.4); s = clamp(s - (N[i] - 0.5) * 18 * (1 - s / 255));
    if (color) for (let c = 0; c < 3; c++) d[i * 4 + c] = clamp(d[i * 4 + c] * 0.35 * (s / 255) + s * 0.65);
    else d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = s;
  }
}

// ---- Tiza y carboncillo ----------------------------------------------------------------------
export function charcoal(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, bal = (p.balance ?? 50) / 100, pressure = (p.pressure ?? 50) / 100;
  const fg = hex(p.fg ?? '#1a1a1a'), bg = hex(p.bg ?? '#f4f1ea');
  const L = blurArr(lum(img), w, h, 1), r = rng(9);
  // trazos diagonales: ruido estirado en una dirección
  const n = new Float32Array(w * h); for (let i = 0; i < n.length; i++) n[i] = r();
  const st = new Float32Array(w * h); const len = 6;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, k = 0; for (let t = -len; t <= len; t++) { const xx = x + t, yy = y + t; if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += n[yy * w + xx]; k++; } } st[y * w + x] = s / k; }
  for (let i = 0; i < w * h; i++) {
    const t = L[i] / 255 + (st[i] - 0.5) * (0.8 + pressure);
    const ink = t < bal ? Math.min(1, (bal - t) * (2 + pressure * 4)) : 0;
    for (let c = 0; c < 3; c++) d[i * 4 + c] = bg[c] + (fg[c] - bg[c]) * ink;
  }
}

// ---- Pluma de tinta / Fotocopia -------------------------------------------------------------
export function inkOutlines(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, detail = (p.detail ?? 50) / 100, dark = (p.darkness ?? 50) / 100, keep = !!p.keepColor;
  const L = blurArr(lum(img), w, h, 1.5 - detail), E = sobel(L, w, h), thr = 40 - detail * 30;
  for (let i = 0; i < w * h; i++) {
    const line = Math.min(1, Math.max(0, (E[i] - thr) / 25)), shade = L[i] < 255 * (0.25 + dark * 0.2) ? 1 : 0;
    const v = 255 * (1 - Math.max(line, shade * 0.9));
    if (keep) for (let c = 0; c < 3; c++) d[i * 4 + c] = d[i * 4 + c] * (v / 255);
    else d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
  }
}

// ---- Cuarteado (grietas de pintura vieja) ----------------------------------------------------
export function craquelure(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, cs = Math.max(6, p.spacing ?? 30), depth = (p.depth ?? 6) / 10, bright = (p.brightness ?? 9) / 10;
  const gw = Math.ceil(w / cs) + 1, gh = Math.ceil(h / cs) + 1, r = rng(21), sx = new Float32Array(gw * gh), sy = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { sx[j * gw + i] = (i + r()) * cs; sy[j * gw + i] = (j + r()) * cs; }
  const crack = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ci = Math.floor(x / cs), cj = Math.floor(y / cs); let b1 = Infinity, b2 = Infinity;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= gw || j >= gh) continue; const k = j * gw + i, dd = Math.hypot(sx[k] - x, sy[k] - y); if (dd < b1) { b2 = b1; b1 = dd; } else if (dd < b2) b2 = dd; }
    crack[y * w + x] = Math.exp(-(b2 - b1) * (b2 - b1) / 3);
  }
  const N = valueNoise(w, h, 3, 4);
  for (let i = 0; i < w * h; i++) {
    const k = crack[i] * depth * (0.6 + 0.4 * N[i]);
    for (let c = 0; c < 3; c++) d[i * 4 + c] = clamp(d[i * 4 + c] * bright * (1 - k * 0.75) + (1 - bright) * 40);
  }
}

// ---- Resplandor de neón ---------------------------------------------------------------------
export function neonGlow(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, size = p.size ?? 5, bright = (p.brightness ?? 60) / 100, col = hex(p.color ?? '#33ccff');
  // el neón luce sobre oscuro: lo que no es borde se oscurece (antes el blanco quedaba en un gris apagado)
  const keep = 1 - (p.dark ?? 75) / 100, n = w * h;
  // con transparencia, los bordes también son los de la forma (letras negras sobre transparente) y el resplandor sale
  // fuera de ella (antes se quedaba recortado dentro)
  let transp = false; for (let i = 3; i < d.length; i += 4) if (d[i] < 255) { transp = true; break; }
  const L = lum(img);
  if (transp) for (let i = 0; i < n; i++) L[i] = L[i] * d[i * 4 + 3] / 255;
  // solo los contornos principales: antes de buscar los bordes se suaviza según «Detalle», así la textura menuda (pelo,
  // hierba, tela…) no se convierte en una maraña de neón; las líneas y los contornos claros se mantienen
  const detail = Math.max(0, Math.min(1, (p.detail ?? 30) / 100)), soft = Math.max(1, Math.round(1 + (1 - detail) * Math.min(w, h) * 0.006));
  let E = sobel(blurArr(L, w, h, soft), w, h);
  const floor = (1 - detail) * 14; for (let i = 0; i < n; i++) E[i] = Math.max(0, E[i] - floor) * (1 + (1 - detail) * 0.8);
  if (transp) { const A = new Float32Array(n); for (let i = 0; i < n; i++) A[i] = d[i * 4 + 3]; const EA = sobel(blurArr(A, w, h, 1), w, h); for (let i = 0; i < n; i++) E[i] = Math.max(E[i], EA[i]); }
  const G = blurArr(E.map(v => Math.min(255, v * 3)), w, h, size);
  for (let i = 0; i < n; i++) {
    const a0 = d[i * 4 + 3] / 255, g = Math.min(1, (G[i] / 255) * (1 + bright * 2)), core = Math.min(1, E[i] / 80) * bright * 0.5;
    // luz añadida (color del neón y núcleo casi blanco) sobre lo que haya, oscurecido
    const A = Math.min(1, a0 + (1 - a0) * Math.min(1, g + core));
    if (A <= 0) continue;
    for (let c = 0; c < 3; c++) { const base = d[i * 4 + c] * keep * (0.55 + 0.45 * L[i] / 255) * a0; d[i * 4 + c] = clamp((base + g * col[c] + core * 255) / A); }
    d[i * 4 + 3] = Math.round(A * 255);
  }
}

// ---- Texturizador (lienzo, ladrillo, arpillera, piedra) ------------------------------------------
export function texturizer(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, kind = p.kind ?? 'canvas', sc = (p.scale ?? 100) / 100, relief = (p.relief ?? 4) / 10;
  const H = new Float32Array(w * h);
  if (kind === 'brick') {
    const bw = 60 * sc, bh = 24 * sc, m = Math.max(1, 3 * sc);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const row = Math.floor(y / bh), xx = (x + (row % 2) * bw / 2) % bw, yy = y % bh; H[y * w + x] = xx < m || yy < m ? 0 : 1; }
    const N = valueNoise(w, h, 4 * sc, 3); for (let i = 0; i < H.length; i++) H[i] = H[i] * (0.8 + 0.2 * N[i]);
  } else if (kind === 'canvas' || kind === 'burlap') {
    const per = (kind === 'canvas' ? 4 : 7) * sc, N = valueNoise(w, h, 2 * sc, 8);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = Math.sin(x / per * Math.PI), b = Math.sin(y / per * Math.PI), warp = (Math.floor(x / per) + Math.floor(y / per)) % 2;
      H[y * w + x] = (warp ? Math.abs(a) : Math.abs(b)) * 0.8 + N[y * w + x] * (kind === 'burlap' ? 0.5 : 0.2);
    }
  } else {
    const A = valueNoise(w, h, 3 * sc, 2), B = valueNoise(w, h, 12 * sc, 6); for (let i = 0; i < H.length; i++) H[i] = A[i] * 0.6 + B[i] * 0.4;
  }
  // relieve iluminado desde arriba a la izquierda
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, nx = H[i] - H[y * w + Math.min(w - 1, x + 1)], ny = H[i] - H[Math.min(h - 1, y + 1) * w + x];
    const s = (nx + ny) * 255 * relief;
    for (let c = 0; c < 3; c++) d[i * 4 + c] = clamp(d[i * 4 + c] + s);
  }
}

// ---- Vidriera ---------------------------------------------------------------------------------
export function stainedGlass(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, cs = Math.max(4, p.cell ?? 24), bw = p.border ?? 3, light = (p.light ?? 30) / 100, bc = hex(p.borderColor ?? '#202020');
  const gw = Math.ceil(w / cs) + 1, gh = Math.ceil(h / cs) + 1, r = rng(13), sx = new Float32Array(gw * gh), sy = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { sx[j * gw + i] = (i + r()) * cs; sy[j * gw + i] = (j + r()) * cs; }
  const own = new Int32Array(w * h), edge = new Float32Array(w * h), sum = new Float64Array(gw * gh * 3), cnt = new Float64Array(gw * gh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ci = Math.floor(x / cs), cj = Math.floor(y / cs); let b1 = Infinity, b2 = Infinity, k1 = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= gw || j >= gh) continue; const k = j * gw + i, dd = Math.hypot(sx[k] - x, sy[k] - y); if (dd < b1) { b2 = b1; b1 = dd; k1 = k; } else if (dd < b2) b2 = dd; }
    const q = y * w + x; own[q] = k1; edge[q] = b2 - b1; for (let c = 0; c < 3; c++) sum[k1 * 3 + c] += d[q * 4 + c]; cnt[k1]++;
  }
  const cx = w / 2, cy = h / 2, R = Math.hypot(cx, cy);
  for (let q = 0; q < w * h; q++) {
    const k = own[q], x = q % w, y = (q / w) | 0, glow = 1 + light * (1 - Math.hypot(x - cx, y - cy) / R);
    if (edge[q] < bw) { for (let c = 0; c < 3; c++) d[q * 4 + c] = bc[c]; continue; }
    for (let c = 0; c < 3; c++) d[q * 4 + c] = clamp(sum[k * 3 + c] / cnt[k] * glow);
  }
}

// ---- Grabado (puntos, líneas o trazos aleatorios en blanco y negro por canal) ------------------
export function mezzotint(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, type = p.type ?? 'dots', r = rng(31);
  for (let y = 0; y < h; y++) {
    const rowRnd = r();
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let t: number;
        if (type === 'lines') t = ((rowRnd + c * 0.31) % 1) * 255;
        else if (type === 'strokes') t = (Math.sin((x + y * 0.5 + c * 13) * 0.35 + rowRnd * 6) * 0.5 + 0.5) * 255 * 0.6 + r() * 255 * 0.4;
        else t = r() * 255;
        d[i + c] = d[i + c] > t ? 255 : 0;
      }
    }
  }
}

// ---- Bordes posterizados ----------------------------------------------------------------------
export function posterEdges(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, thick = (p.thickness ?? 2) / 10, intensity = (p.intensity ?? 1) / 10, levels = Math.max(2, p.levels ?? 4);
  const L = blurArr(lum(img), w, h, 1), E = sobel(L, w, h), step = 255 / (levels - 1);
  for (let i = 0; i < w * h; i++) {
    const line = Math.min(1, Math.max(0, (E[i] - 30 * (1 - thick)) / 30)) * Math.min(1, intensity * 2 + 0.3);
    for (let c = 0; c < 3; c++) d[i * 4 + c] = Math.round(d[i * 4 + c] / step) * step * (1 - line);
  }
}

// ---- Sello (blanco y negro suave, como un tampón de goma) ---------------------------------------
export function stamp(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, bal = (p.balance ?? 50) / 100 * 255, smooth = p.smooth ?? 4;
  const fg = hex(p.fg ?? '#000000'), bg = hex(p.bg ?? '#ffffff');
  const L = blurArr(lum(img), w, h, smooth * 0.6);
  for (let i = 0; i < w * h; i++) { const t = Math.min(1, Math.max(0, (bal - L[i]) / 12 + 0.5)); for (let c = 0; c < 3; c++) d[i * 4 + c] = bg[c] + (fg[c] - bg[c]) * t; }
}

// ---- Desenfoque inteligente ---------------------------------------------------------------------
export function smartBlur(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, mode = p.mode ?? 'normal';
  const orig = lum(img);
  surfaceBlur(img, p.radius ?? 3, p.threshold ?? 25);
  if (mode === 'normal') return;
  // «solo bordes»: líneas blancas sobre negro; «superponer»: bordes blancos sobre la imagen suavizada
  const E = sobel(orig, w, h), thr = (p.threshold ?? 25) * 1.2;
  for (let i = 0; i < w * h; i++) {
    const e = E[i] > thr ? 255 : 0;
    if (mode === 'edges') { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = e; d[i * 4 + 3] = 255; }
    else if (e) d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255;
  }
}

// ---- Destramar: quita el ruido fino respetando los bordes ---------------------------------------
export function despeckle(img: ImageData) {
  const { width: w, height: h, data: d } = img, src = copy(img), E = sobel(lum(img), w, h);
  median(img, 1);
  for (let i = 0; i < w * h; i++) if (E[i] > 28) for (let c = 0; c < 4; c++) d[i * 4 + c] = src.data[i * 4 + c];
}

// ---- Cizalla: desplaza cada fila según una curva ------------------------------------------------
export function shear(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, amt = (p.amount ?? 30) / 100 * w * 0.5, shape = p.shape ?? 'arc', wrap = (p.edge ?? 'wrap') === 'wrap';
  const src = new Uint8ClampedArray(d), c = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    const t = y / Math.max(1, h - 1), off = shape === 'arc' ? Math.sin(t * Math.PI) * amt : shape === 'wave' ? Math.sin(t * Math.PI * 2) * amt : (t - 0.5) * 2 * amt;
    for (let x = 0; x < w; x++) {
      let sx = x - off;
      if (wrap) sx = ((sx % w) + w) % w; else sx = Math.max(0, Math.min(w - 1, sx));
      sample(src, w, h, sx, y, c); const i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3];
    }
  }
}

// ---- Extrusión (bloques o pirámides) ----------------------------------------------------------
export function extrude(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, s = Math.max(4, p.size ?? 20), pyr = (p.type ?? 'blocks') === 'pyramids';
  const src = new Uint8ClampedArray(d);
  for (let by = 0; by < h; by += s) for (let bx = 0; bx < w; bx += s) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = by; y < Math.min(h, by + s); y++) for (let x = bx; x < Math.min(w, bx + s); x++) { const i = (y * w + x) * 4; r += src[i]; g += src[i + 1]; b += src[i + 2]; n++; }
    r /= n; g /= n; b /= n;
    for (let y = by; y < Math.min(h, by + s); y++) for (let x = bx; x < Math.min(w, bx + s); x++) {
      const u = (x - bx) / s, v = (y - by) / s; let f = 1;
      if (pyr) { const du = u - 0.5, dv = v - 0.5; f = Math.abs(du) > Math.abs(dv) ? (du > 0 ? 0.65 : 1.2) : (dv > 0 ? 0.5 : 1.3); }
      else { const e = 0.18; f = u < e ? 1.25 : v < e ? 1.35 : u > 1 - e ? 0.65 : v > 1 - e ? 0.55 : 1; }
      const i = (y * w + x) * 4; d[i] = clamp(r * f); d[i + 1] = clamp(g * f); d[i + 2] = clamp(b * f);
    }
  }
}

// ---- Relieve de pintura (impasto) ----------------------------------------------------------------
/** Da a una pintura plana el relieve de la pintura gruesa: pinceladas con volumen iluminadas desde un lado. */
export function impasto(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, depth = (p.depth ?? 50) / 100 * 6, size = Math.max(1, p.size ?? 6), ang = (p.light ?? 135) * Math.PI / 180;
  const strokeAng = (p.strokes ?? 30) * Math.PI / 180, gloss = (p.gloss ?? 30) / 100;
  // altura: la luminosidad suavizada (las zonas claras «abultan») más la textura de las pinceladas
  const L = blurArr(lum(img), w, h, size * 0.35);
  const N = valueNoise(w, h, Math.max(1.5, size * 0.6), 17);
  // ruido estirado en la dirección de las pinceladas
  const ca = Math.cos(strokeAng), sa = Math.sin(strokeAng), len = Math.max(2, Math.round(size * 1.6)), S = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, k = 0;
    for (let t = -len; t <= len; t += 2) { const xx = Math.round(x + ca * t), yy = Math.round(y + sa * t); if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += N[yy * w + xx]; k++; } }
    S[y * w + x] = k ? s / k : 0.5;
  }
  const Hm = new Float32Array(w * h); for (let i = 0; i < w * h; i++) Hm[i] = L[i] / 255 * 0.6 + S[i] * 0.9;
  const lx = Math.cos(ang) * 0.7, ly = -Math.sin(ang) * 0.7, lz = 0.7, hx0 = lx, hy0 = ly, hz0 = lz + 1, hn = Math.hypot(hx0, hy0, hz0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, xm = x > 0 ? i - 1 : i, xp = x < w - 1 ? i + 1 : i, ym = y > 0 ? i - w : i, yp = y < h - 1 ? i + w : i;
    let nx = -(Hm[xp] - Hm[xm]) * depth, ny = -(Hm[yp] - Hm[ym]) * depth, nz = 1; const nn = Math.hypot(nx, ny, nz); nx /= nn; ny /= nn; nz /= nn;
    const diff = Math.max(0, nx * lx + ny * ly + nz * lz), spec = Math.pow(Math.max(0, (nx * hx0 + ny * hy0 + nz * hz0) / hn), 30) * gloss * 255;
    const k = 0.45 + diff * 0.75;
    for (let c = 0; c < 3; c++) d[i * 4 + c] = clamp(d[i * 4 + c] * k + spec);
  }
}

// ---- 3D: mapas de relieve y de normales --------------------------------------------------------------
/** Mapa de relieve (alturas en gris) a partir de la luminosidad, para usar en programas 3D o en Efectos de iluminación. */
export function bumpMap(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, blur = p.blur ?? 2, contrast = (p.contrast ?? 50) / 50, inv = !!p.invert;
  const L = blurArr(lum(img), w, h, blur);
  let mn = 255, mx = 0; for (const v of L) { if (v < mn) mn = v; if (v > mx) mx = v; }
  for (let i = 0; i < w * h; i++) { let v = (L[i] - mn) / Math.max(1, mx - mn); v = 0.5 + (v - 0.5) * contrast; if (inv) v = 1 - v; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = clamp(v * 255); d[i * 4 + 3] = 255; }
}
/** Mapa de normales (azul violáceo) a partir de la luminosidad: da relieve a texturas en juegos y programas 3D. */
export function normalMap(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, strength = (p.strength ?? 50) / 10, blur = p.blur ?? 1, inv = !!p.invert;
  const L = blurArr(lum(img), w, h, blur);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, xm = x > 0 ? i - 1 : i, xp = x < w - 1 ? i + 1 : i, ym = y > 0 ? i - w : i, yp = y < h - 1 ? i + w : i;
    let nx = (L[xm] - L[xp]) / 255 * strength, ny = (L[ym] - L[yp]) / 255 * strength; if (inv) { nx = -nx; ny = -ny; }
    const nz = 1, n = Math.hypot(nx, ny, nz);
    d[i * 4] = clamp((nx / n * 0.5 + 0.5) * 255); d[i * 4 + 1] = clamp((-ny / n * 0.5 + 0.5) * 255); d[i * 4 + 2] = clamp((nz / n * 0.5 + 0.5) * 255); d[i * 4 + 3] = 255;
  }
}
