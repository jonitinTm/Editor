// Seleccionar cielo y cielos para sustituirlo.
// El cielo se busca desde el borde superior: zonas lisas, claras o azuladas/grises, conectadas con la parte de
// arriba. Se modela su color con unos pocos grupos (k-medias) y se rellena desde arriba sin cruzar bordes fuertes.

import { makeCanvas, ctx2d } from '../core/canvas';
import { clouds } from './more';

type V3 = [number, number, number];
function toLab(r: number, g: number, b: number): V3 {
  const f = (c: number) => { c /= 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; };
  const R = f(r), G = f(g), B = f(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const h = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  x = h(x); y = h(y); z = h(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Máscara del cielo (blanco = cielo), del tamaño de `src`, o null si no se encuentra. */
export function selectSky(src: HTMLCanvasElement): HTMLCanvasElement | null {
  const W = src.width, H = src.height, k = Math.min(1, 420 / Math.max(W, H));
  const w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k)), n = w * h;
  const sm = makeCanvas(w, h), sc = ctx2d(sm); sc.imageSmoothingQuality = 'high'; sc.drawImage(src, 0, 0, w, h);
  const d = sc.getImageData(0, 0, w, h).data;
  const lab: V3[] = new Array(n); for (let i = 0; i < n; i++) lab[i] = toLab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  // textura local (gradiente): el cielo es liso
  const grad = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, a = lab[i - 1], b = lab[i + 1], c = lab[i - w], e = lab[i + w];
    grad[i] = Math.hypot(b[0] - a[0], e[0] - c[0]) + 0.5 * Math.hypot(b[1] - a[1], b[2] - a[2], e[1] - c[1], e[2] - c[2]);
  }
  // modelo de color a partir de la franja superior lisa
  const seeds: V3[] = [];
  const band = Math.max(2, Math.round(h * 0.08));
  for (let y = 0; y < band; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (grad[i] < 6 && lab[i][0] > 25) seeds.push(lab[i]); }
  if (seeds.length < w * band * 0.15) return null;
  const K = 4, cs: V3[] = [];
  seeds.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < K; i++) cs.push([...seeds[Math.floor((i + 0.5) / K * seeds.length)]] as V3);
  for (let it = 0; it < 6; it++) {
    const s = cs.map(() => [0, 0, 0, 0]);
    for (const p of seeds) { let bi = 0, bd = Infinity; cs.forEach((c, j) => { const dd = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (dd < bd) { bd = dd; bi = j; } }); const q = s[bi]; q[0] += p[0]; q[1] += p[1]; q[2] += p[2]; q[3]++; }
    cs.forEach((c, j) => { if (s[j][3]) { c[0] = s[j][0] / s[j][3]; c[1] = s[j][1] / s[j][3]; c[2] = s[j][2] / s[j][3]; } });
  }
  // el cielo se oscurece o aclara hacia el horizonte: se admite más diferencia de luz que de tono
  const dist = (p: V3) => { let bd = Infinity; for (const c of cs) { const dd = ((p[0] - c[0]) * 0.45) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (dd < bd) bd = dd; } return Math.sqrt(bd); };
  const skyLike = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = lab[i], blueish = p[2] < 8 && p[0] > 35, gray = Math.hypot(p[1], p[2]) < 12 && p[0] > 45;
    skyLike[i] = dist(p) < 14 + (blueish || gray ? 8 : 0) && grad[i] < 14 ? 1 : 0;
  }
  // relleno desde la fila de arriba (4 vecinos)
  const m = new Uint8Array(n), st: number[] = [];
  for (let x = 0; x < w; x++) if (skyLike[x]) { m[x] = 1; st.push(x); }
  while (st.length) {
    const i = st.pop()!, x = i % w, y = (i - x) / w;
    const tryP = (j: number) => { if (!m[j] && skyLike[j]) { m[j] = 1; st.push(j); } };
    if (x > 0) tryP(i - 1); if (x < w - 1) tryP(i + 1); if (y > 0) tryP(i - w); if (y < h - 1) tryP(i + w);
  }
  // huecos pequeños dentro del cielo (pájaros, cables, nubes con algo de textura) se rellenan
  const out = new Uint8Array(m), lab2 = new Int32Array(n).fill(-1);
  let id = 0;
  for (let s0 = 0; s0 < n; s0++) {
    if (m[s0] || lab2[s0] >= 0) continue;
    const comp: number[] = [s0]; lab2[s0] = id; let touchesBottom = false, minY = h;
    for (let q = 0; q < comp.length; q++) {
      const i = comp[q], x = i % w, y = (i - x) / w; if (y === h - 1) touchesBottom = true; if (y < minY) minY = y;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && !m[j] && lab2[j] < 0) { lab2[j] = id; comp.push(j); }
    }
    if (!touchesBottom) {
      // las nubes (claras y poco saturadas) dentro del cielo también son cielo, aunque sean grandes
      let L = 0, C = 0; for (const i of comp) { L += lab[i][0]; C += Math.hypot(lab[i][1], lab[i][2]); }
      L /= comp.length; C /= comp.length;
      const cloudy = L > 62 && C < 18;
      if (comp.length < n * 0.02 || (cloudy && comp.length < n * 0.3)) for (const i of comp) out[i] = 1;
    }
    id++;
  }
  let cnt = 0; for (let i = 0; i < n; i++) cnt += out[i];
  if (cnt < n * 0.03) return null;
  // a tamaño completo con borde suave
  const smallM = makeCanvas(w, h), mx = ctx2d(smallM), mi = mx.createImageData(w, h);
  for (let i = 0; i < n; i++) { mi.data[i * 4] = mi.data[i * 4 + 1] = mi.data[i * 4 + 2] = 255; mi.data[i * 4 + 3] = out[i] * 255; }
  mx.putImageData(mi, 0, 0);
  const full = makeCanvas(W, H), fx = ctx2d(full); fx.imageSmoothingEnabled = true; fx.imageSmoothingQuality = 'high';
  fx.filter = `blur(${Math.max(0.6, 0.6 / k)}px)`; fx.drawImage(smallM, 0, 0, W, H); fx.filter = 'none';
  // se aprieta la transición para que el borde no quede borroso
  const fd = fx.getImageData(0, 0, W, H), a = fd.data;
  for (let i = 3; i < a.length; i += 4) a[i] = Math.max(0, Math.min(255, (a[i] - 128) * 2.2 + 128));
  fx.putImageData(fd, 0, 0);
  return full;
}

/** Cielos de serie, generados al momento (degradado + nubes). */
export const SKY_PRESETS: { id: string; name: string; top: string; bottom: string; cloud?: string; cover?: number; sun?: string }[] = [
  { id: 'clear', name: 'Azul despejado', top: '#2f6fd0', bottom: '#a9d3ff' },
  { id: 'clouds', name: 'Azul con nubes', top: '#3a78d4', bottom: '#b8dcff', cloud: '#ffffff', cover: 0.55 },
  { id: 'sunset', name: 'Atardecer', top: '#2c2a6b', bottom: '#ff9a3c', cloud: '#ffb47a', cover: 0.35, sun: '#fff0b0' },
  { id: 'pink', name: 'Amanecer rosa', top: '#6b8fe0', bottom: '#ffc2d6', cloud: '#ffe3ec', cover: 0.45 },
  { id: 'golden', name: 'Hora dorada', top: '#5d8bd1', bottom: '#ffd27a', cloud: '#fff2cf', cover: 0.3, sun: '#fff8d8' },
  { id: 'storm', name: 'Tormenta', top: '#2b3038', bottom: '#7d8794', cloud: '#59626e', cover: 0.85 },
  { id: 'night', name: 'Noche', top: '#050a1f', bottom: '#1f2f5c' },
];

export function renderSky(id: string, w: number, h: number): HTMLCanvasElement {
  const p = SKY_PRESETS.find(s => s.id === id) ?? SKY_PRESETS[0];
  const c = makeCanvas(w, h), x = ctx2d(c);
  const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, p.top); g.addColorStop(1, p.bottom); x.fillStyle = g; x.fillRect(0, 0, w, h);
  if (p.sun) { const r = Math.max(w, h) * 0.5, rg = x.createRadialGradient(w * 0.7, h * 0.85, 0, w * 0.7, h * 0.85, r); rg.addColorStop(0, p.sun); rg.addColorStop(0.08, p.sun + 'cc'); rg.addColorStop(1, p.sun + '00'); x.fillStyle = rg; x.fillRect(0, 0, w, h); }
  if (p.cloud) {
    // nubes más anchas que altas: se generan estrechas y se estiran a lo ancho
    const ch = Math.max(8, Math.round(Math.min(w, 900) * h / w)), cw = Math.max(8, Math.round(Math.min(w, 900) / 2.2)), cl = new ImageData(cw, ch);
    clouds(cl, '#000000', '#ffffff', Math.round(ch / 3.5), 3);
    const cc = p.cloud, cr = parseInt(cc.slice(1, 3), 16), cg = parseInt(cc.slice(3, 5), 16), cb = parseInt(cc.slice(5, 7), 16), cov = p.cover ?? 0.5;
    for (let i = 0; i < cl.data.length; i += 4) { const v = cl.data[i] / 255, a = Math.max(0, Math.min(1, (v - (1 - cov)) / 0.35)); cl.data[i] = cr; cl.data[i + 1] = cg; cl.data[i + 2] = cb; cl.data[i + 3] = a * 235; }
    const t = makeCanvas(cw, ch); ctx2d(t).putImageData(cl, 0, 0);
    x.imageSmoothingQuality = 'high'; x.drawImage(t, 0, 0, w, h);
  }
  if (id === 'night') {
    let s = 11; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < w * h / 900; i++) { x.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`; const z = r() < 0.08 ? 2 : 1; x.fillRect(r() * w, r() * h * 0.85, z, z); }
  }
  return c;
}
