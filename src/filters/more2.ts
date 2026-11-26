// Más filtros: corrección de lente, destello, desenfoques (lente, caja, promediar), estilizar
// (solarizar, viento, difusión, mosaicos, trazar contorno), pixelizar (semitono, puntillista,
// fragmentar), interpretar (nubes de diferencia, fibras), distorsionar (zigzag, vidrio) y artísticos (recortes).

import { gaussianBlur } from './blur';
import { displace, sample } from './advanced';
import { clouds } from './more';

const clamp = (v: number) => v < 0 ? 0 : v > 255 ? 255 : v;
const hex = (s: string) => { const n = parseInt(String(s).slice(1), 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
function rng(seed: number) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

// ---- Corrección de lente ---------------------------------------------------------------------
export function lensCorrection(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, cx = w / 2, cy = h / 2, R = Math.hypot(cx, cy);
  const k = -(p.distortion ?? 0) / 100 * 0.5, ca = (p.chroma ?? 0) / 100 * 0.01;
  const src = new Uint8ClampedArray(d), c = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x - cx) / R, dy = (y - cy) / R, r2 = dx * dx + dy * dy, f = 1 + k * r2;
    const i = (y * w + x) * 4;
    // cada canal con su propio aumento: aberración cromática (bordes rojos/cian)
    for (let ch = 0; ch < 3; ch++) {
      const s = f * (1 + (ch - 1) * ca);
      sample(src, w, h, cx + dx * R * s, cy + dy * R * s, c);
      d[i + ch] = c[ch]; if (ch === 1) d[i + 3] = c[3];
    }
  }
  const v = (p.vignette ?? 0) / 100;
  if (v) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = Math.hypot((x - cx) / cx, (y - cy) / cy) / Math.SQRT2, f = 1 + v * Math.pow(r, 2.2) * 1.4, i = (y * w + x) * 4;
    for (let ch = 0; ch < 3; ch++) d[i + ch] = clamp(v < 0 ? d[i + ch] * Math.max(0, f) : d[i + ch] + (255 - d[i + ch]) * (f - 1));
  }
}

// ---- Destello de lente ---------------------------------------------------------------------
export function lensFlare(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img;
  const fx = (p.x ?? 30) / 100 * w, fy = (p.y ?? 30) / 100 * h, br = (p.brightness ?? 100) / 100, sz = Math.min(w, h);
  const cx = w / 2, cy = h / 2;
  // halo central, anillo y «fantasmas» a lo largo de la línea que pasa por el centro
  const ghosts = [[0.4, 0.06, [255, 200, 120]], [0.7, 0.03, [140, 200, 255]], [1.25, 0.09, [180, 255, 180]], [1.6, 0.05, [255, 150, 200]], [2.0, 0.12, [160, 170, 255]]] as const;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, dd = Math.hypot(x - fx, y - fy) / sz;
    let r = 0, g = 0, b = 0;
    const core = Math.exp(-dd * dd * 900) * 1.4 + Math.exp(-dd * 18) * 0.5;
    r += core * 255; g += core * 245; b += core * 220;
    const ring = Math.exp(-Math.pow((dd - 0.13) * 60, 2)) * 0.18; r += ring * 255; g += ring * 180; b += ring * 120;
    const ang = Math.atan2(y - fy, x - fx), rays = Math.pow(Math.abs(Math.cos(ang * 6)), 40) * Math.exp(-dd * 9) * 0.5; r += rays * 255; g += rays * 240; b += rays * 220;
    for (const [t, s, col] of ghosts) {
      const gx = fx + (cx - fx) * t, gy = fy + (cy - fy) * t, gd = Math.hypot(x - gx, y - gy) / sz;
      const gv = gd < s ? 0.12 * (0.6 + 0.4 * gd / s) : Math.exp(-Math.pow((gd - s) * 160, 2)) * 0.08;
      r += gv * col[0]; g += gv * col[1]; b += gv * col[2];
    }
    // se suma en modo Trama sobre lo que haya; donde la capa está vacía (o es transparente) el destello queda con su
    // propia transparencia, así funciona también en una capa nueva (en Photoshop habría que rellenarla de negro)
    const R = Math.min(1, r * br / 255), G = Math.min(1, g * br / 255), B = Math.min(1, b * br / 255), a0 = d[i + 3] / 255;
    if (a0 >= 1) { d[i] = 255 - (255 - d[i]) * (1 - R); d[i + 1] = 255 - (255 - d[i + 1]) * (1 - G); d[i + 2] = 255 - (255 - d[i + 2]) * (1 - B); continue; }
    // destello como color «sobre transparente» (alfa = su canal más fuerte) mezclado con lo que haya debajo en la capa
    const fa = Math.max(R, G, B); if (fa <= 0) continue;
    const oa = fa + a0 * (1 - fa);
    for (const [k, v] of [[0, R], [1, G], [2, B]] as const) d[i + k] = ((v / fa * 255) * fa + d[i + k] * a0 * (1 - fa)) / oa;
    d[i + 3] = oa * 255;
  }
}

// ---- Desenfoques -------------------------------------------------------------------------------
/** Desenfoque de lente: las luces se convierten en círculos (bokeh). */
export function lensBlur(img: ImageData, radius: number, highlights: number) {
  const { width: w, height: h, data: d } = img, r = Math.max(1, Math.round(radius));
  // disco de muestras; las zonas muy claras pesan más (bokeh)
  const offs: [number, number][] = []; const step = Math.max(1, Math.round(r / 6));
  for (let y = -r; y <= r; y += step) for (let x = -r; x <= r; x += step) if (x * x + y * y <= r * r) offs.push([x, y]);
  const src = new Uint8ClampedArray(d), hk = highlights / 100;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sr = 0, sg = 0, sb = 0, sa = 0, ws = 0;
    for (const [ox, oy] of offs) {
      const X = Math.min(w - 1, Math.max(0, x + ox)), Y = Math.min(h - 1, Math.max(0, y + oy)), j = (Y * w + X) * 4;
      const l = (src[j] + src[j + 1] + src[j + 2]) / 765, wt = 1 + hk * 30 * Math.pow(l, 6);
      sr += src[j] * wt; sg += src[j + 1] * wt; sb += src[j + 2] * wt; sa += src[j + 3] * wt; ws += wt;
    }
    const i = (y * w + x) * 4; d[i] = sr / ws; d[i + 1] = sg / ws; d[i + 2] = sb / ws; d[i + 3] = sa / ws;
  }
}
export function boxBlur(img: ImageData, radius: number) {
  const { width: w, height: h, data: d } = img, r = Math.max(1, Math.round(radius));
  const k = 2 * r + 1, cl = (q: number, n: number) => q < 0 ? 0 : q >= n ? n - 1 : q;
  // horizontal: cada fila y canal (sumas enteras: el orden no cambia el resultado)
  let src = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let c = 0; c < 4; c++) {
      let acc = 0; for (let q = -r; q <= r; q++) acc += src[row + cl(q, w) * 4 + c];
      for (let q = 0; q < w; q++) { d[row + q * 4 + c] = acc / k; acc += src[row + cl(q + r + 1, w) * 4 + c] - src[row + cl(q - r, w) * 4 + c]; }
    }
  }
  // vertical: fila a fila con un acumulador por columna y canal (memoria en orden)
  src = new Uint8ClampedArray(d);
  const W4 = w * 4, acc = new Float64Array(W4);
  for (let q = -r; q <= r; q++) { const o = cl(q, h) * W4; for (let i = 0; i < W4; i++) acc[i] += src[o + i]; }
  for (let q = 0; q < h; q++) {
    const out = q * W4, add = cl(q + r + 1, h) * W4, sub = cl(q - r, h) * W4;
    for (let i = 0; i < W4; i++) { d[out + i] = acc[i] / k; acc[i] += src[add + i] - src[sub + i]; }
  }
}
export function average(img: ImageData) {
  const d = img.data; let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; r += d[i] * a; g += d[i + 1] * a; b += d[i + 2] * a; n += a; }
  if (!n) return; r /= n; g /= n; b /= n;
  for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; }
}

// ---- Estilizar ---------------------------------------------------------------------------------
export function solarize(img: ImageData) { const d = img.data; for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) if (d[i + c] > 127) d[i + c] = 255 - d[i + c]; }
export function wind(img: ImageData, strength: number, fromLeft: boolean) {
  const { width: w, height: h, data: d } = img, src = new Uint8ClampedArray(d), rnd = rng(3), len = Math.max(2, strength);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, l = (src[i] + src[i + 1] + src[i + 2]) / 3;
    // las zonas claras dejan una estela horizontal
    const nx = fromLeft ? x - 1 : x + 1;
    if (nx < 0 || nx >= w) continue;
    const j = (y * w + nx) * 4, ln = (src[j] + src[j + 1] + src[j + 2]) / 3;
    if (l - ln > 25) { const L = Math.round(len * (0.4 + rnd() * 0.6)); for (let k = 1; k <= L; k++) { const X = fromLeft ? x + k : x - k; if (X < 0 || X >= w) break; const q = (y * w + X) * 4, f = 1 - k / (L + 1); for (let c = 0; c < 3; c++) d[q + c] = Math.max(d[q + c], src[q + c] + (src[i + c] - src[q + c]) * f); } }
  }
}
export function diffuse(img: ImageData, amount: number) {
  const { width: w, height: h, data: d } = img, src = new Uint8ClampedArray(d), rnd = rng(7), a = Math.max(1, amount);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = Math.min(w - 1, Math.max(0, x + Math.round((rnd() - 0.5) * 2 * a))), Y = Math.min(h - 1, Math.max(0, y + Math.round((rnd() - 0.5) * 2 * a)));
    const i = (y * w + x) * 4, j = (Y * w + X) * 4; d[i] = src[j]; d[i + 1] = src[j + 1]; d[i + 2] = src[j + 2]; d[i + 3] = src[j + 3];
  }
}
export function tiles(img: ImageData, n: number, offset: number) {
  const { width: w, height: h, data: d } = img, src = new Uint8ClampedArray(d), rnd = rng(11);
  const ts = Math.max(4, Math.round(Math.min(w, h) / Math.max(1, n)));
  d.fill(255); for (let i = 3; i < d.length; i += 4) d[i] = 255;
  for (let ty = 0; ty < h; ty += ts) for (let tx = 0; tx < w; tx += ts) {
    const ox = Math.round((rnd() - 0.5) * ts * offset / 100), oy = Math.round((rnd() - 0.5) * ts * offset / 100);
    for (let y = 0; y < ts; y++) for (let x = 0; x < ts; x++) {
      const sx = tx + x, sy = ty + y, dx = sx + ox, dy = sy + oy;
      if (sx >= w || sy >= h || dx < 0 || dy < 0 || dx >= w || dy >= h) continue;
      const i = (sy * w + sx) * 4, j = (dy * w + dx) * 4; d[j] = src[i]; d[j + 1] = src[i + 1]; d[j + 2] = src[i + 2]; d[j + 3] = src[i + 3];
    }
  }
}
export function traceContour(img: ImageData, level: number) {
  const { width: w, height: h, data: d } = img, src = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      const v = src[i + c] >= level, r = x < w - 1 && (src[i + 4 + c] >= level) !== v, b = y < h - 1 && (src[i + w * 4 + c] >= level) !== v;
      d[i + c] = r || b ? 0 : 255;
    }
  }
}
export function cutout(img: ImageData, levels: number, simplicity: number) {
  // Recortes: simplifica (mediana aproximada con desenfoque) y posteriza
  gaussianBlur(img, Math.max(0.5, simplicity));
  const d = img.data, n = Math.max(2, levels), k = 255 / (n - 1);
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = Math.round(Math.round(d[i + c] / k) * k);
}

// ---- Pixelizar ---------------------------------------------------------------------------------
export function colorHalftone(img: ImageData, radius: number) {
  const { width: w, height: h, data: d } = img, src = new Uint8ClampedArray(d), cell = Math.max(3, radius * 2);
  const angles = [15, 75, 0].map(a => a * Math.PI / 180); // cian, magenta, amarillo
  for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = 255; }
  for (let c = 0; c < 3; c++) {
    const ca = Math.cos(angles[c]), sa = Math.sin(angles[c]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      // coordenadas en la retícula girada de este canal
      const u = x * ca + y * sa, v = -x * sa + y * ca, cu = (Math.floor(u / cell) + 0.5) * cell, cv = (Math.floor(v / cell) + 0.5) * cell;
      const sx = Math.min(w - 1, Math.max(0, Math.round(cu * ca - cv * sa))), sy = Math.min(h - 1, Math.max(0, Math.round(cu * sa + cv * ca)));
      // el área del punto es la cantidad de tinta (π·r² = tinta·celda²); antes eran un 54 % mayores y en los medios
      // tonos se solapaban hasta dejar la imagen casi negra con manchas de colores puros
      const ink = 1 - src[(sy * w + sx) * 4 + c] / 255, rr = Math.sqrt(ink / Math.PI) * cell;
      const dist = Math.hypot(u - cu, v - cv), i = (y * w + x) * 4;
      // borde suave de un píxel (sin dientes de sierra)
      const cover = Math.max(0, Math.min(1, rr - dist + 0.5));
      if (cover > 0) d[i + c] = Math.min(d[i + c], Math.round(255 * (1 - cover)));
    }
  }
}
export function pointillize(img: ImageData, cell: number, bg: string) {
  const { width: w, height: h, data: d } = img, src = new Uint8ClampedArray(d), rnd = rng(13), cs = Math.max(3, cell);
  const [br, bgc, bb] = hex(bg);
  for (let i = 0; i < d.length; i += 4) { d[i] = br; d[i + 1] = bgc; d[i + 2] = bb; d[i + 3] = 255; }
  const n = Math.round(w * h / (cs * cs) * 1.6);
  for (let k = 0; k < n; k++) {
    const px = rnd() * w, py = rnd() * h, j = (Math.floor(py) * w + Math.floor(px)) * 4, r = cs * (0.45 + rnd() * 0.25);
    const x0 = Math.max(0, Math.floor(px - r)), x1 = Math.min(w - 1, Math.ceil(px + r)), y0 = Math.max(0, Math.floor(py - r)), y1 = Math.min(h - 1, Math.ceil(py + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if ((x - px) ** 2 + (y - py) ** 2 <= r * r) { const i = (y * w + x) * 4; d[i] = src[j]; d[i + 1] = src[j + 1]; d[i + 2] = src[j + 2]; }
  }
}
export function fragment(img: ImageData) {
  const { width: w, height: h, data: d } = img, src = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    for (let c = 0; c < 4; c++) {
      let s = 0; for (const [ox, oy] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) { const X = Math.min(w - 1, Math.max(0, x + ox)), Y = Math.min(h - 1, Math.max(0, y + oy)); s += src[(Y * w + X) * 4 + c]; }
      d[i + c] = s / 4;
    }
  }
}

// ---- Interpretar ---------------------------------------------------------------------------------
export function differenceClouds(img: ImageData, c1: string, c2: string, scale: number) {
  const n = new ImageData(img.width, img.height); clouds(n, c1, c2, scale, 5);
  // lo transparente cuenta como negro (como en Photoshop: en una capa vacía salen las nubes) y el resultado es opaco
  const d = img.data, s = n.data;
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; for (let c = 0; c < 3; c++) d[i + c] = Math.abs(d[i + c] * a - s[i + c]); d[i + 3] = 255; }
}
export function fibers(img: ImageData, c1: string, c2: string, variance: number, strength: number) {
  const { width: w, height: h, data: d } = img, A = hex(c1), B = hex(c2), rnd = rng(17);
  const cols = new Float32Array(w); for (let x = 0; x < w; x++) cols[x] = rnd();
  for (let pass = 0; pass < Math.max(1, Math.round(variance / 4)); pass++) for (let x = 1; x < w - 1; x++) cols[x] = (cols[x - 1] + cols[x] + cols[x + 1]) / 3;
  const drift = new Float32Array(w); for (let x = 0; x < w; x++) drift[x] = rnd();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = Math.min(1, Math.max(0, cols[x] * 0.6 + Math.sin(y / Math.max(2, 64 - strength) + drift[x] * 6.28) * 0.2 + rnd() * 0.25));
    const i = (y * w + x) * 4; d[i] = A[0] + (B[0] - A[0]) * t; d[i + 1] = A[1] + (B[1] - A[1]) * t; d[i + 2] = A[2] + (B[2] - A[2]) * t; d[i + 3] = 255;
  }
}

// ---- Distorsionar ------------------------------------------------------------------------------
export function zigzag(img: ImageData, amount: number, ridges: number) {
  const cx = img.width / 2, cy = img.height / 2, R = Math.min(cx, cy), a = amount / 100, n = Math.max(1, ridges);
  displace(img, (x, y, o) => {
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
    if (r >= R || r === 0) { o[0] = x; o[1] = y; return; }
    const off = Math.sin(r / R * Math.PI * n) * a * 12 * (1 - r / R), ang = Math.atan2(dy, dx);
    o[0] = x + Math.cos(ang) * off; o[1] = y + Math.sin(ang) * off;
  });
}
export function glass(img: ImageData, distortion: number, smoothness: number) {
  const { width: w, height: h } = img, rnd = rng(23), gs = Math.max(4, 16 - smoothness);
  // mapa de desplazamiento suave (ruido en una rejilla interpolado)
  const gw = Math.ceil(w / gs) + 2, gh = Math.ceil(h / gs) + 2, gx = new Float32Array(gw * gh), gy = new Float32Array(gw * gh);
  for (let i = 0; i < gx.length; i++) { gx[i] = rnd() - 0.5; gy[i] = rnd() - 0.5; }
  const at = (g: Float32Array, x: number, y: number) => { const X = x / gs, Y = y / gs, x0 = Math.floor(X), y0 = Math.floor(Y), fx = X - x0, fy = Y - y0, a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1], c = g[(y0 + 1) * gw + x0], e = g[(y0 + 1) * gw + x0 + 1]; return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy; };
  displace(img, (x, y, o) => { o[0] = x + at(gx, x, y) * distortion * 2; o[1] = y + at(gy, x, y) * distortion * 2; });
}

// ---- Efectos de iluminación: una luz (omnidireccional, foco o direccional) con relieve opcional ----
export function lighting(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img;
  const [lr, lg, lb] = hex(p.color ?? '#ffffff').map(v => v / 255);
  const lx = (p.x ?? 50) / 100 * w, ly = (p.y ?? 35) / 100 * h, R = Math.max(1, (p.radius ?? 60) / 100 * Math.hypot(w, h) / 2);
  const inten = (p.intensity ?? 100) / 100, amb = (p.ambient ?? 20) / 100, type = p.type ?? 'spot', height = (p.height ?? 0) / 100 * 8;
  const ang = (p.angle ?? 60) * Math.PI / 180, dirX = Math.cos(ang), dirY = Math.sin(ang);
  // relieve: normal a partir de la luminosidad
  let L: Float32Array | null = null;
  if (height) { L = new Float32Array(w * h); for (let i = 0; i < w * h; i++) L[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255; }
  const zL = R * 0.6;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, o = i * 4;
    let nx = 0, ny = 0, nz = 1;
    if (L) { const xl = L[y * w + Math.max(0, x - 1)], xr = L[y * w + Math.min(w - 1, x + 1)], yu = L[Math.max(0, y - 1) * w + x], yd = L[Math.min(h - 1, y + 1) * w + x]; nx = (xl - xr) * height; ny = (yu - yd) * height; const n = Math.hypot(nx, ny, 1); nx /= n; ny /= n; nz = 1 / n; }
    let vx: number, vy: number, vz: number, fall = 1;
    if (type === 'directional') { vx = -dirX; vy = -dirY; vz = 1; }
    else { vx = lx - x; vy = ly - y; vz = zL; const dist = Math.hypot(vx, vy); fall = type === 'spot' ? Math.max(0, 1 - (dist / R) ** 2) : 1 / (1 + (dist / R) ** 2 * 2); }
    const vl = Math.hypot(vx, vy, vz); const diff = Math.max(0, (nx * vx + ny * vy + nz * vz) / vl);
    const k = diff * fall * inten * 1.4;
    d[o] = clamp(d[o] * (amb + k * lr)); d[o + 1] = clamp(d[o + 1] * (amb + k * lg)); d[o + 2] = clamp(d[o + 2] * (amb + k * lb));
  }
}
