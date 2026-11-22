// Filtros de Interpretar (árbol, llama, marco de imagen), Enfocar › Reducción de movimiento y Vídeo › Desentrelazar.
// Trabajan sobre ImageData (se ejecutan en un worker), dibujando con sus propias rutinas.

const clamp = (v: number) => v < 0 ? 0 : v > 255 ? 255 : v;
const hex = (s: string) => { const n = parseInt(String(s || '#000').slice(1), 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
function rng(seed: number) { let s = (seed * 9301 + 49297) % 233280 || 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

/** Pinta un círculo suave (para trazos gruesos y hojas) mezclándolo sobre la imagen. */
function disc(img: ImageData, cx: number, cy: number, r: number, col: number[], a: number) {
  const { width: w, height: h, data: d } = img, R = Math.max(0.6, r);
  const x0 = Math.max(0, Math.floor(cx - R - 1)), x1 = Math.min(w - 1, Math.ceil(cx + R + 1)), y0 = Math.max(0, Math.floor(cy - R - 1)), y1 = Math.min(h - 1, Math.ceil(cy + R + 1));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cy), cov = Math.max(0, Math.min(1, R - dd + 0.5)) * a; if (cov <= 0) continue;
    const i = (y * w + x) * 4, ao = d[i + 3] / 255, an = cov + ao * (1 - cov);
    for (let c = 0; c < 3; c++) d[i + c] = (col[c] * cov + d[i + c] * ao * (1 - cov)) / Math.max(1e-6, an);
    d[i + 3] = an * 255;
  }
}
function line(img: ImageData, x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, col: number[]) {
  const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(L / Math.max(0.5, Math.min(r0, r1) * 0.5)));
  for (let i = 0; i <= n; i++) { const t = i / n; disc(img, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r0 + (r1 - r0) * t, col, 1); }
}

// ---- Árbol ------------------------------------------------------------------------------------------
export function tree(img: ImageData, p: any) {
  const { width: w, height: h } = img, r = rng(p.seed ?? 3);
  const bx = (p.x ?? 50) / 100 * w, by = (p.y ?? 98) / 100 * h, H = (p.size ?? 60) / 100 * h, depth = Math.max(3, Math.min(11, p.depth ?? 8));
  const bark = hex(p.bark ?? '#4a3020'), leaf = hex(p.leaves ?? '#3f8f3a'), spread = (p.spread ?? 28) * Math.PI / 180, dens = (p.density ?? 60) / 100;
  const leaves: [number, number, number][] = [];
  const grow = (x: number, y: number, ang: number, len: number, wid: number, lvl: number) => {
    const bend = (r() - 0.5) * 0.35, x1 = x + Math.cos(ang + bend) * len, y1 = y - Math.sin(ang + bend) * len;
    line(img, x, y, x1, y1, wid, wid * 0.7, bark);
    if (lvl >= depth || len < 3) { if (r() < 0.4 + dens) leaves.push([x1, y1, Math.max(2, H * 0.025 * (0.6 + r()))]); return; }
    const n = r() < 0.3 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const a = ang + (n === 2 ? (k ? 1 : -1) : (k - 1)) * spread * (0.7 + r() * 0.6);
      grow(x1, y1, a, len * (0.68 + r() * 0.12), wid * 0.68, lvl + 1);
    }
    if (lvl > depth - 3 && r() < dens) leaves.push([x1, y1, Math.max(2, H * 0.02 * (0.6 + r()))]);
  };
  grow(bx, by, Math.PI / 2, H * 0.3, Math.max(1.5, H * 0.035), 1);
  // copa: hojas con algo de variación de tono
  for (const [x, y, s] of leaves) for (let k = 0; k < 4; k++) {
    const t = 0.75 + r() * 0.5;
    disc(img, x + (r() - 0.5) * s * 3, y + (r() - 0.5) * s * 3, s * (0.7 + r() * 0.6), leaf.map(c => clamp(c * t)), 0.85);
  }
}

// ---- Llama -------------------------------------------------------------------------------------------
function vnoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const hsh = (a: number, b: number) => { let n = a * 374761393 + b * 668265263 + seed * 982451653; n = (n ^ (n >> 13)) * 1274126177; return ((n ^ (n >> 16)) >>> 0) / 4294967295; };
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hsh(xi, yi), b = hsh(xi + 1, yi), c = hsh(xi, yi + 1), d = hsh(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
export function flame(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, seed = p.seed ?? 5;
  const bx = (p.x ?? 50) / 100 * w, by = (p.y ?? 90) / 100 * h, fh = (p.height ?? 45) / 100 * h, fw = (p.width ?? 18) / 100 * w, turb = (p.turbulence ?? 50) / 100;
  const pal = p.color === 'blue' ? [[0, 0, 0], [10, 30, 120], [40, 120, 255], [180, 220, 255], [255, 255, 255]] : [[0, 0, 0], [140, 10, 0], [240, 90, 10], [255, 200, 40], [255, 255, 220]];
  const x0 = Math.max(0, Math.floor(bx - fw)), x1 = Math.min(w, Math.ceil(bx + fw)), y0 = Math.max(0, Math.floor(by - fh * 1.1)), y1 = Math.min(h, Math.ceil(by + fw * 0.3));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const v = (by - y) / fh; if (v < -0.15) continue;
    const sc = 6 / Math.max(8, fw);
    let n = 0, amp = 1, f = 1; for (let o = 0; o < 4; o++) { n += vnoise((x - bx) * sc * f, (y - by) * sc * f * 0.5 + o * 7, seed + o) * amp; amp *= 0.5; f *= 2; } n /= 1.875;
    // forma de lágrima que se estrecha hacia arriba y se rompe con el ruido
    const half = fw * 0.5 * Math.max(0, 1 - Math.max(0, v)) ** 0.8 * (1 + (n - 0.5) * turb * 1.2);
    const dx = Math.abs(x - bx + (n - 0.5) * fw * turb * v), inside = half > 0 ? 1 - dx / half : 0;
    let t = Math.max(0, inside) * (1 - Math.max(0, v) * 0.7) * (v < 0 ? 1 + v * 6 : 1) + (n - 0.5) * 0.25;
    t = Math.max(0, Math.min(1, t * 1.4)); if (t <= 0.02) continue;
    const k = t * (pal.length - 1), i0 = Math.min(pal.length - 2, Math.floor(k)), fr = k - i0, col = pal[i0].map((c, j) => c + (pal[i0 + 1][j] - c) * fr);
    const i = (y * w + x) * 4;
    // se suma como luz (modo Trama)
    for (let c = 0; c < 3; c++) d[i + c] = 255 - (255 - d[i + c]) * (1 - col[c] / 255 * Math.min(1, t * 1.6));
    d[i + 3] = Math.max(d[i + 3], Math.min(255, t * 400));
  }
}

// ---- Marco de imagen ------------------------------------------------------------------------------------
export function pictureFrame(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, style = p.style ?? 'wood', fw = Math.max(2, Math.round((p.width ?? 6) / 100 * Math.min(w, h))), r = rng(11);
  const mat = style === 'mat' ? Math.round(fw * 1.4) : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const e = Math.min(x, y, w - 1 - x, h - 1 - y), i = (y * w + x) * 4;
    if (e >= fw + mat) {
      if (style === 'vintage') { const dd = Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2)) / Math.SQRT2, k = 1 - Math.pow(dd, 2.5) * 0.55; for (let c = 0; c < 3; c++) d[i + c] = clamp(d[i + c] * k * [1.02, 0.97, 0.85][c] + 12); }
      continue;
    }
    let col: number[];
    if (e >= fw) col = [246, 243, 236]; // paspartú
    else if (style === 'polaroid') col = [250, 250, 248];
    else {
      // bisel: luz arriba/izquierda, sombra abajo/derecha
      const side = x === e ? 0 : y === e ? 1 : (w - 1 - x) === e ? 2 : 3, t = e / fw;
      const lit = side < 2 ? 1.15 : 0.78, groove = 1 - 0.25 * Math.exp(-Math.pow((t - 0.6) * 9, 2)) - 0.2 * Math.exp(-Math.pow((t - 0.05) * 30, 2));
      const base = style === 'gold' ? [205, 160, 70] : style === 'black' ? [30, 30, 32] : style === 'white' ? [236, 234, 230] : [118, 74, 40];
      const grain = style === 'wood' ? 0.85 + 0.3 * Math.abs(Math.sin((side % 2 ? x : y) * 0.15 + Math.sin((side % 2 ? y : x) * 0.02) * 6)) : style === 'gold' ? 0.9 + 0.25 * Math.sin(t * Math.PI * 3) : 1;
      col = base.map(c => clamp(c * lit * groove * grain + (r() - 0.5) * 6));
    }
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
  }
  // pie más ancho de la Polaroid
  if (style === 'polaroid') { const extra = Math.round(fw * 2.5); for (let y = Math.max(0, h - fw - extra); y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] = d[i + 1] = 250; d[i + 2] = 248; d[i + 3] = 255; } }
  // sombra interior junto al borde
  const sh = Math.max(2, Math.round(fw * 0.25)), inner = fw + mat;
  for (let y = inner; y < h - inner; y++) for (let x = inner; x < w - inner; x++) {
    const e = Math.min(x, y, w - 1 - x, h - 1 - y) - inner; if (e >= sh) continue;
    const k = 0.6 + 0.4 * (e / sh), i = (y * w + x) * 4; for (let c = 0; c < 3; c++) d[i + c] *= k;
  }
}

// ---- Reducción de movimiento (foto movida) -----------------------------------------------------------------
/** Deconvolución de Richardson-Lucy con un trazo recto (ángulo y longitud del movimiento), sobre la luminosidad. */
export function shakeReduction(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, ang = (p.angle ?? 0) * Math.PI / 180, len = Math.max(1, p.length ?? 8), it = Math.max(1, Math.min(30, p.iterations ?? 10)), noise = (p.noise ?? 20) / 100;
  const n = w * h, Y = new Float32Array(n); for (let i = 0; i < n; i++) Y[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) + 1;
  const taps = Math.max(2, Math.round(len)), offs: [number, number][] = [];
  for (let k = 0; k < taps; k++) { const t = taps === 1 ? 0 : k / (taps - 1) - 0.5; offs.push([Math.cos(ang) * len * t, -Math.sin(ang) * len * t]); }
  const conv = (src: Float32Array, dst: Float32Array, sign: number) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (const [ox, oy] of offs) { const sx = Math.max(0, Math.min(w - 1, Math.round(x + ox * sign))), sy = Math.max(0, Math.min(h - 1, Math.round(y + oy * sign))); s += src[sy * w + sx]; }
      dst[y * w + x] = s / taps;
    }
  };
  let est = Float32Array.from(Y); const tmp = new Float32Array(n), ratio = new Float32Array(n);
  for (let k = 0; k < it; k++) {
    conv(est, tmp, 1);
    for (let i = 0; i < n; i++) ratio[i] = Y[i] / Math.max(1e-3, tmp[i]);
    conv(ratio, tmp, -1);
    // amortiguado: evita que el ruido se dispare
    for (let i = 0; i < n; i++) { const f = 1 + (tmp[i] - 1) * (1 - noise * 0.8); est[i] = Math.max(0.5, Math.min(400, est[i] * f)); }
  }
  for (let i = 0; i < n; i++) { const delta = est[i] - Y[i]; for (let c = 0; c < 3; c++) d[i * 4 + c] = clamp(d[i * 4 + c] + delta); }
}

// ---- Desentrelazar -----------------------------------------------------------------------------------------
export function deinterlace(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, odd = (p.lines ?? 'odd') === 'odd', interp = (p.mode ?? 'interp') === 'interp';
  for (let y = odd ? 1 : 0; y < h; y += 2) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, a = ((y > 0 ? y - 1 : y + 1) * w + x) * 4, b = ((y < h - 1 ? y + 1 : y - 1) * w + x) * 4;
    for (let c = 0; c < 4; c++) d[i + c] = interp ? (d[a + c] + d[b + c]) / 2 : d[a + c];
  }
}
