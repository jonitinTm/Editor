// Seleccionar sujeto: estimación automática del objeto principal de la foto.
// Modelo de color del fondo (bordes de la imagen) frente al del sujeto (zona central), refinado en
// varias pasadas, con limpieza de islas y relleno de huecos. Funciona bien con fondos diferenciados.

import { makeCanvas, ctx2d } from '../core/canvas';

type V3 = [number, number, number];

function toLab(r: number, g: number, b: number): V3 {
  const f = (c: number) => { c /= 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; };
  const R = f(r), G = f(g), B = f(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const h = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  x = h(x); y = h(y); z = h(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function kmeans(pts: V3[], k: number, iters = 8): V3[] {
  if (!pts.length) return [];
  const c: V3[] = [];
  for (let i = 0; i < k; i++) c.push([...pts[Math.floor((i + 0.5) / k * pts.length)]] as V3);
  for (let it = 0; it < iters; it++) {
    const s = c.map(() => [0, 0, 0, 0]);
    for (const p of pts) { let bi = 0, bd = Infinity; for (let i = 0; i < c.length; i++) { const d = (p[0] - c[i][0]) ** 2 + (p[1] - c[i][1]) ** 2 + (p[2] - c[i][2]) ** 2; if (d < bd) { bd = d; bi = i; } } const q = s[bi]; q[0] += p[0]; q[1] += p[1]; q[2] += p[2]; q[3]++; }
    for (let i = 0; i < c.length; i++) if (s[i][3]) c[i] = [s[i][0] / s[i][3], s[i][1] / s[i][3], s[i][2] / s[i][3]];
  }
  return c;
}
const near = (p: V3, cs: V3[]) => { let bd = Infinity; for (const c of cs) { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) bd = d; } return Math.sqrt(bd); };

/** Devuelve una máscara (lienzo del tamaño de la imagen, blanco = sujeto) o null si no hay nada claro. */
export function selectSubject(src: HTMLCanvasElement): HTMLCanvasElement | null {
  const W = src.width, H = src.height, k = Math.min(1, 360 / Math.max(W, H));
  const w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k));
  const sm = makeCanvas(w, h), sc = ctx2d(sm); sc.imageSmoothingQuality = 'high'; sc.drawImage(src, 0, 0, w, h);
  const d = sc.getImageData(0, 0, w, h).data, n = w * h;
  const lab: V3[] = new Array(n), alpha = new Uint8Array(n);
  for (let i = 0; i < n; i++) { lab[i] = toLab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); alpha[i] = d[i * 4 + 3]; }
  // Capa con transparencia: el sujeto son los píxeles opacos
  let transp = 0; for (let i = 0; i < n; i++) if (alpha[i] < 128) transp++;
  const fg = new Uint8Array(n);
  if (transp > n * 0.05) for (let i = 0; i < n; i++) fg[i] = alpha[i] >= 128 ? 1 : 0;
  else {
    const band = Math.max(2, Math.round(Math.min(w, h) * 0.04));
    const isBorder = (x: number, y: number) => x < band || y < band || x >= w - band || y >= h - band;
    const inCenter = (x: number, y: number) => ((x - w / 2) / (w * 0.28)) ** 2 + ((y - h / 2) / (h * 0.32)) ** 2 < 1;
    const bgP: V3[] = [], fgP: V3[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (isBorder(x, y)) bgP.push(lab[y * w + x]); else if (inCenter(x, y)) fgP.push(lab[y * w + x]); }
    let bgC = kmeans(bgP, 6);
    // los colores del centro que también son del fondo no cuentan como sujeto
    let fgC = kmeans(fgP.filter(p => near(p, bgC) > 12), 6);
    if (!fgC.length) return null;
    const prob = new Float32Array(n);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < n; i++) { const a = near(lab[i], bgC), b = near(lab[i], fgC); prob[i] = a / (a + b + 1e-6); }
      // suavizado 3×3 para reducir ruido
      const p2 = new Float32Array(n);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h) { s += prob[Y * w + X]; c++; } } p2[y * w + x] = s / c; }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; fg[i] = p2[i] > 0.5 && !isBorder(x, y) ? 1 : 0; }
      if (pass < 2) {
        const nb: V3[] = [], nf: V3[] = [];
        for (let i = 0; i < n; i += 2) (fg[i] ? nf : nb).push(lab[i]);
        if (nf.length > 20) fgC = kmeans(nf, 8); if (nb.length > 20) bgC = kmeans(nb, 8);
      }
    }
    // Se queda con las regiones grandes cercanas al centro
    const lbl = new Int32Array(n).fill(-1), sizes: number[] = [], centerHit: boolean[] = [];
    for (let i = 0; i < n; i++) if (fg[i] && lbl[i] < 0) {
      const id = sizes.length; let size = 0, hit = false; const st = [i]; lbl[i] = id;
      while (st.length) { const j = st.pop()!; size++; const x = j % w, y = (j / w) | 0; if (inCenter(x, y)) hit = true;
        for (const q of [j - 1, j + 1, j - w, j + w]) if (q >= 0 && q < n && Math.abs((q % w) - x) <= 1 && fg[q] && lbl[q] < 0) { lbl[q] = id; st.push(q); } }
      sizes.push(size); centerHit.push(hit);
    }
    const maxS = Math.max(0, ...sizes.filter((_, i) => centerHit[i]));
    if (!maxS) return null;
    for (let i = 0; i < n; i++) fg[i] = fg[i] && centerHit[lbl[i]] && sizes[lbl[i]] >= maxS * 0.15 ? 1 : 0;
  }
  // Relleno de huecos: lo que no conecta con el borde es parte del sujeto
  const out = new Uint8Array(n), st: number[] = [];
  for (let x = 0; x < w; x++) { st.push(x, (h - 1) * w + x); } for (let y = 0; y < h; y++) { st.push(y * w, y * w + w - 1); }
  while (st.length) { const j = st.pop()!; if (out[j] || fg[j]) continue; out[j] = 1; const x = j % w; if (x > 0) st.push(j - 1); if (x < w - 1) st.push(j + 1); if (j >= w) st.push(j - w); if (j < n - w) st.push(j + w); }
  let count = 0;
  const m = sc.createImageData(w, h);
  for (let i = 0; i < n; i++) { const v = out[i] ? 0 : 255; if (v) count++; m.data[i * 4] = m.data[i * 4 + 1] = m.data[i * 4 + 2] = 255; m.data[i * 4 + 3] = v; }
  if (count < n * 0.005) return null;
  const small = makeCanvas(w, h); ctx2d(small).putImageData(m, 0, 0);
  // Se amplía con suavizado y se endurece el borde (queda un borde limpio pero no dentado)
  const big = makeCanvas(W, H), bc = ctx2d(big); bc.imageSmoothingEnabled = true; bc.imageSmoothingQuality = 'high'; bc.filter = `blur(${Math.max(0.5, 0.6 / k)}px)`; bc.drawImage(small, 0, 0, W, H); bc.filter = 'none';
  const id = bc.getImageData(0, 0, W, H), a = id.data;
  for (let i = 3; i < a.length; i += 4) a[i] = Math.max(0, Math.min(255, (a[i] - 128) * 3 + 128));
  bc.putImageData(id, 0, 0);
  return big;
}
