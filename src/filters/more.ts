// Más ajustes y filtros: corrección selectiva, reemplazar color, ecualizar, desenfoque de superficie,
// polvo y rascaduras, coordenadas polares, rizo, cristalizar, pintura al óleo, nubes,
// inclinación-desplazamiento y enfoque suavizado. Todos trabajan sobre ImageData en el sitio.

import { gaussianBlur } from './blur';
import { median } from './advanced';
import { displace } from './advanced';
import { rgb2hsl, hsl2rgb } from './adjustments';

const hex = (s: string) => { const n = parseInt(String(s).slice(1), 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const clamp = (v: number) => v < 0 ? 0 : v > 255 ? 255 : v;

// ---- Corrección selectiva --------------------------------------------------------------
export const SELCOLOR_GROUPS: [string, string][] = [['reds', 'Rojos'], ['yellows', 'Amarillos'], ['greens', 'Verdes'], ['cyans', 'Cianes'], ['blues', 'Azules'], ['magentas', 'Magentas'], ['whites', 'Blancos'], ['neutrals', 'Neutros'], ['blacks', 'Negros']];

/** p[`${grupo}_c|m|y|k`] en -100…100; p.absolute = método absoluto. */
export function selectiveColor(img: ImageData, p: any) {
  const d = img.data, abs = !!p.absolute;
  const adj = SELCOLOR_GROUPS.map(([g]) => [p[g + '_c'] ?? 0, p[g + '_m'] ?? 0, p[g + '_y'] ?? 0, p[g + '_k'] ?? 0].map(v => v / 100));
  const active = adj.map(a => a.some(v => v !== 0));
  if (!active.some(Boolean)) return;
  const w = new Float32Array(9);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), mid = r + g + b - mx - mn;
    w.fill(0);
    // tonos: el canal mayor y la mezcla de los dos mayores
    if (mx > mn) {
      const prim = mx - mid, sec = mid - mn;
      if (r === mx) { w[0] = prim; if (g >= b) w[1] = sec; else w[5] = sec; }
      else if (g === mx) { w[2] = prim; if (r >= b) w[1] = sec; else w[3] = sec; }
      else { w[4] = prim; if (r >= g) w[5] = sec; else w[3] = sec; }
    }
    w[6] = mn > 128 ? (mn - 128) * 2 : 0;                  // blancos
    w[8] = mx < 128 ? (128 - mx) * 2 : 0;                  // negros
    w[7] = 255 - (Math.abs(mx - 127.5) + Math.abs(mn - 127.5)); // neutros
    const v = [r / 255, g / 255, b / 255], out = [r, g, b];
    for (let c = 0; c < 3; c++) {
      let delta = 0;
      for (let k = 0; k < 9; k++) {
        if (!active[k] || w[k] <= 0) continue;
        const a = adj[k][c], K = adj[k][3], ink = 1 - v[c];
        // tinta del canal tras el ajuste (relativo: proporcional a la tinta existente)
        let ink2 = abs ? ink + a : ink + a * (a > 0 ? ink : ink);
        ink2 = K > 0 ? ink2 + K * (abs ? 1 : ink2) * (1 - ink2) : ink2 * (1 + K);
        ink2 = ink2 < 0 ? 0 : ink2 > 1 ? 1 : ink2;
        delta += (ink - ink2) * 255 * (w[k] / 255);
      }
      out[c] = clamp(out[c] + delta);
    }
    d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2];
  }
}

// ---- Reemplazar color ------------------------------------------------------------------
export function replaceColor(img: ImageData, p: any) {
  const d = img.data, [tr, tg, tb] = hex(p.color), fuzz = Math.max(1, p.fuzziness ?? 40) * 1.6;
  const hs = (p.hue ?? 0) / 360, ss = (p.sat ?? 0) / 100, ls = (p.light ?? 0) / 100;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const dist = Math.sqrt(((d[i] - tr) * 0.9) ** 2 + ((d[i + 1] - tg) * 1.2) ** 2 + ((d[i + 2] - tb) * 0.8) ** 2);
    const wgt = dist >= fuzz ? 0 : 1 - dist / fuzz; if (wgt <= 0) continue;
    let [h, s, l] = rgb2hsl(d[i], d[i + 1], d[i + 2]);
    h = (h + hs + 1) % 1; s = Math.min(1, Math.max(0, ss > 0 ? s + (1 - s) * ss : s * (1 + ss))); l = ls > 0 ? l + (1 - l) * ls : l * (1 + ls);
    const [r, g, b] = hsl2rgb(h, s, l);
    d[i] += (r - d[i]) * wgt; d[i + 1] += (g - d[i + 1]) * wgt; d[i + 2] += (b - d[i + 2]) * wgt;
  }
}

// ---- Ecualizar ---------------------------------------------------------------------------
export function equalize(img: ImageData) {
  const d = img.data, hist = new Float64Array(256); let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { hist[Math.round(d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11)]++; n++; }
  if (!n) return;
  const lut = new Uint8ClampedArray(256); let acc = 0, first = -1;
  for (let k = 0; k < 256; k++) { if (first < 0 && hist[k]) first = acc + hist[k]; acc += hist[k]; lut[k] = n === first ? k : (acc - first) / (n - first) * 255; }
  // se aplica sobre la luminosidad conservando el color
  for (let i = 0; i < d.length; i += 4) {
    const y = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11, t = lut[Math.round(y)], k = y > 0.5 ? t / y : 0;
    if (y <= 0.5) { d[i] = d[i + 1] = d[i + 2] = t; continue; }
    d[i] = clamp(d[i] * k); d[i + 1] = clamp(d[i + 1] * k); d[i + 2] = clamp(d[i + 2] * k);
  }
}

// ---- Desenfoque de superficie (bilateral separable) ------------------------------------
export function surfaceBlur(img: ImageData, radius: number, threshold: number) {
  const { width: w, height: h, data: d } = img, r = Math.max(1, Math.round(radius)), thr = Math.max(1, threshold);
  const sw = new Float32Array(2 * r + 1); for (let k = -r; k <= r; k++) sw[k + r] = Math.exp(-(k * k) / (2 * (r / 2) ** 2));
  const rw = new Float32Array(256); for (let k = 0; k < 256; k++) rw[k] = k >= thr * 2.5 ? 0 : Math.exp(-(k * k) / (2 * thr * thr));
  const pass = (horiz: boolean) => {
    const src = new Uint8ClampedArray(d);
    const len = horiz ? w : h, lines = horiz ? h : w;
    for (let L = 0; L < lines; L++) for (let q = 0; q < len; q++) {
      const i = (horiz ? L * w + q : q * w + L) * 4;
      for (let c = 0; c < 3; c++) {
        const v0 = src[i + c]; let s = 0, ws = 0;
        for (let k = -r; k <= r; k++) {
          const qq = q + k; if (qq < 0 || qq >= len) continue;
          const j = (horiz ? L * w + qq : qq * w + L) * 4, v = src[j + c], wt = sw[k + r] * rw[Math.abs(v - v0)];
          s += v * wt; ws += wt;
        }
        d[i + c] = s / ws;
      }
    }
  };
  pass(true); pass(false);
}

// ---- Polvo y rascaduras ----------------------------------------------------------------
export function dustScratches(img: ImageData, radius: number, threshold: number) {
  const orig = new Uint8ClampedArray(img.data);
  median(img, radius);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const diff = Math.abs(d[i] - orig[i]) + Math.abs(d[i + 1] - orig[i + 1]) + Math.abs(d[i + 2] - orig[i + 2]);
    if (diff / 3 <= threshold) { d[i] = orig[i]; d[i + 1] = orig[i + 1]; d[i + 2] = orig[i + 2]; }
  }
}

// ---- Coordenadas polares -----------------------------------------------------------------
export function polar(img: ImageData, toPolar: boolean) {
  const w = img.width, h = img.height, cx = w / 2, cy = h / 2;
  displace(img, toPolar
    ? (x, y, o) => { const nx = (x - cx) / cx, ny = (y - cy) / cy; let a = Math.atan2(nx, -ny); if (a < 0) a += Math.PI * 2; o[0] = a / (Math.PI * 2) * w; o[1] = Math.hypot(nx, ny) * h; }
    : (x, y, o) => { const a = x / w * Math.PI * 2, r = y / h; o[0] = cx + Math.sin(a) * r * cx; o[1] = cy - Math.cos(a) * r * cy; });
}

// ---- Rizo ------------------------------------------------------------------------------------
export function ripple(img: ImageData, amount: number, size: number) {
  const a = amount / 100 * 4, wl = Math.max(4, size);
  displace(img, (x, y, o) => { o[0] = x + Math.sin(y / wl * Math.PI * 2 + Math.sin(x / (wl * 2.3))) * a; o[1] = y + Math.sin(x / wl * Math.PI * 2 + Math.cos(y / (wl * 1.7))) * a; });
}

// ---- Cristalizar --------------------------------------------------------------------------
export function crystallize(img: ImageData, cell: number, seedBase = 1) {
  const { width: w, height: h, data: d } = img, cs = Math.max(3, Math.round(cell));
  const gw = Math.ceil(w / cs) + 1, gh = Math.ceil(h / cs) + 1, sx = new Float32Array(gw * gh), sy = new Float32Array(gw * gh);
  let seed = seedBase * 9301 + 49297; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { sx[j * gw + i] = (i + rnd()) * cs; sy[j * gw + i] = (j + rnd()) * cs; }
  const owner = new Int32Array(w * h), sum = new Float64Array(gw * gh * 4), cnt = new Float64Array(gw * gh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ci = Math.floor(x / cs), cj = Math.floor(y / cs); let best = Infinity, bi = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= gw || j >= gh) continue;
      const k = j * gw + i, dd = (sx[k] - x) ** 2 + (sy[k] - y) ** 2; if (dd < best) { best = dd; bi = k; }
    }
    const p = y * w + x; owner[p] = bi; const a = d[p * 4 + 3];
    sum[bi * 4] += d[p * 4] * a; sum[bi * 4 + 1] += d[p * 4 + 1] * a; sum[bi * 4 + 2] += d[p * 4 + 2] * a; sum[bi * 4 + 3] += a; cnt[bi]++;
  }
  for (let p = 0; p < w * h; p++) {
    const k = owner[p], a = sum[k * 4 + 3]; if (!a) { d[p * 4 + 3] = 0; continue; }
    d[p * 4] = sum[k * 4] / a; d[p * 4 + 1] = sum[k * 4 + 1] / a; d[p * 4 + 2] = sum[k * 4 + 2] / a; d[p * 4 + 3] = a / cnt[k];
  }
}

// ---- Pintura al óleo (filtro de Kuwahara con tablas integrales) ------------------------
export function oilPaint(img: ImageData, radius: number) {
  const { width: w, height: h, data: d } = img, r = Math.max(1, Math.round(radius)), W = w + 1;
  const S = [0, 1, 2].map(() => new Float64Array(W * (h + 1))), Q = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, o = (y + 1) * W + x + 1, l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    for (let c = 0; c < 3; c++) S[c][o] = d[i + c] + S[c][o - 1] + S[c][o - W] - S[c][o - W - 1];
    Q[o] = l * l + Q[o - 1] + Q[o - W] - Q[o - W - 1];
  }
  const box = (T: Float64Array, x0: number, y0: number, x1: number, y1: number) => T[(y1 + 1) * W + x1 + 1] - T[y0 * W + x1 + 1] - T[(y1 + 1) * W + x0] + T[y0 * W + x0];
  const out = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let best = Infinity, br = 0, bg = 0, bb = 0;
    for (const [qx, qy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x0 = Math.max(0, qx < 0 ? x - r : x), x1 = Math.min(w - 1, qx < 0 ? x : x + r), y0 = Math.max(0, qy < 0 ? y - r : y), y1 = Math.min(h - 1, qy < 0 ? y : y + r);
      const n = (x1 - x0 + 1) * (y1 - y0 + 1);
      const mr = box(S[0], x0, y0, x1, y1) / n, mg = box(S[1], x0, y0, x1, y1) / n, mb = box(S[2], x0, y0, x1, y1) / n;
      const ml = mr * 0.3 + mg * 0.59 + mb * 0.11, v = box(Q, x0, y0, x1, y1) / n - ml * ml;
      if (v < best) { best = v; br = mr; bg = mg; bb = mb; }
    }
    const i = (y * w + x) * 4; out[i] = br; out[i + 1] = bg; out[i + 2] = bb;
  }
  d.set(out);
}

// ---- Nubes ------------------------------------------------------------------------------------
export function clouds(img: ImageData, c1: string, c2: string, scale: number, seedBase = 1) {
  const { width: w, height: h, data: d } = img, A = hex(c1), B = hex(c2);
  const perm = new Uint8Array(512); let seed = seedBase * 7919 + 13; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const base = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [base[i], base[j]] = [base[j], base[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  const val = (x: number, y: number) => perm[(perm[x & 255] + y) & 511] / 255;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number) => { const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi); const a = val(xi, yi), b = val(xi + 1, yi), c = val(xi, yi + 1), e = val(xi + 1, yi + 1); return (a + (b - a) * fx) * (1 - fy) + (c + (e - c) * fx) * fy; };
  const base0 = Math.max(8, scale);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0, amp = 0.5, f = 1 / base0;
    for (let o = 0; o < 6; o++) { v += noise(x * f, y * f) * amp; amp *= 0.5; f *= 2; }
    const t = Math.min(1, Math.max(0, (v - 0.5) * 1.6 + 0.5)), i = (y * w + x) * 4;
    d[i] = A[0] + (B[0] - A[0]) * t; d[i + 1] = A[1] + (B[1] - A[1]) * t; d[i + 2] = A[2] + (B[2] - A[2]) * t; d[i + 3] = 255;
  }
}

// ---- Inclinación-desplazamiento (tilt-shift) ---------------------------------------------
export function tiltShift(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img;
  const blurred = new ImageData(new Uint8ClampedArray(d), w, h); gaussianBlur(blurred, p.blur ?? 15);
  const a = (p.angle ?? 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const cy = (p.center ?? 50) / 100 * h, cx = w / 2, focus = (p.focus ?? 20) / 100 * h / 2, trans = Math.max(1, (p.transition ?? 25) / 100 * h);
  const b = blurred.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dist = Math.abs(-(x - cx) * sa + (y - cy) * ca);
    let t = (dist - focus) / trans; t = t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
    if (!t) continue;
    const i = (y * w + x) * 4; for (let c = 0; c < 4; c++) d[i + c] += (b[i + c] - d[i + c]) * t;
  }
  if (p.saturation) { // típico de las miniaturas: algo más de color
    const k = p.saturation / 100;
    for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; for (let c = 0; c < 3; c++) d[i + c] = clamp(l + (d[i + c] - l) * (1 + k)); }
  }
}

// ---- Enfoque suavizado -------------------------------------------------------------------
export function smartSharpen(img: ImageData, amount: number, radius: number, noise: number) {
  const d = img.data, blurred = new ImageData(new Uint8ClampedArray(d), img.width, img.height); gaussianBlur(blurred, radius);
  const b = blurred.data, k = amount / 100, nz = noise / 100 * 24;
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11, lb = b[i] * 0.3 + b[i + 1] * 0.59 + b[i + 2] * 0.11;
    let det = l - lb; const ad = Math.abs(det);
    // los detalles pequeños (ruido) se enfocan menos
    if (nz > 0) det *= ad >= nz ? 1 : (ad / nz) ** 2;
    const add = det * k;
    d[i] = clamp(d[i] + add); d[i + 1] = clamp(d[i + 1] + add); d[i + 2] = clamp(d[i + 2] + add);
  }
}
