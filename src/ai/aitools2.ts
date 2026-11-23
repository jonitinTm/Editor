// Más IA con los modelos que ya se usan (sin descargas nuevas):
// · Refinar bordes con filtro guiado (He, Sun y Tang, 2010): la máscara del sujeto se ajusta a los bordes de la foto
//   (pelo, pelusa, hojas) en vez de quedar como una silueta borrosa.
// · Iluminación con IA: con el mapa de profundidad se calcula la orientación de cada superficie y se ilumina
//   con una luz que se coloca tocando la foto.
// · Niebla por profundidad y Seleccionar cielo con IA (lo lejano y conectado con el borde de arriba).

import { app } from '../ui/app';
import { h, numberSlider } from '../ui/dom';
import { showDialog, row } from '../ui/dialog';
import { RasterLayer, isRaster } from '../core/layers';
import { ctx2d, makeCanvas } from '../core/canvas';
import { aiDepth } from './ai';

// ---- Filtro guiado ----------------------------------------------------------------------------------------------
/** Media en una ventana de (2r+1)² con sumas acumuladas (coste constante por píxel). */
function boxMean(a: Float32Array, w: number, h: number, r: number) {
  const out = new Float32Array(w * h), tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) { let s = 0; const o = y * w; for (let x = -r; x <= r; x++) s += a[o + Math.min(w - 1, Math.max(0, x))]; for (let x = 0; x < w; x++) { tmp[o + x] = s; s += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)]; } }
  const k = 1 / ((2 * r + 1) * (2 * r + 1));
  for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]; for (let y = 0; y < h; y++) { out[y * w + x] = s * k; s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
  return out;
}
/** Filtro guiado: suaviza `p` (la máscara) siguiendo los bordes de `I` (la foto en grises). */
export function guidedFilter(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number) {
  const n = w * h, Ip = new Float32Array(n), II = new Float32Array(n);
  for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mI = boxMean(I, w, h, r), mp = boxMean(p, w, h, r), mIp = boxMean(Ip, w, h, r), mII = boxMean(II, w, h, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = mII[i] - mI[i] * mI[i], c = mIp[i] - mI[i] * mp[i]; a[i] = c / (v + eps); b[i] = mp[i] - a[i] * mI[i]; }
  const ma = boxMean(a, w, h, r), mb = boxMean(b, w, h, r), q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = Math.max(0, Math.min(1, ma[i] * I[i] + mb[i]));
  return q;
}
/** Máscara (transparencia) ajustada a los bordes de la foto. Trabaja a ≤ 2000 px por velocidad. */
export function refineMask(src: HTMLCanvasElement, mask: HTMLCanvasElement): HTMLCanvasElement {
  const W = src.width, H = src.height, k = Math.min(1, 2000 / Math.max(W, H)), w = Math.max(1, Math.round(W * k)), hh = Math.max(1, Math.round(H * k));
  const s = makeCanvas(w, hh), sx = ctx2d(s); sx.drawImage(src, 0, 0, w, hh); const sd = sx.getImageData(0, 0, w, hh).data;
  const m = makeCanvas(w, hh), mx = ctx2d(m); mx.drawImage(mask, 0, 0, w, hh); const md = mx.getImageData(0, 0, w, hh).data;
  const n = w * hh, I = new Float32Array(n), p = new Float32Array(n);
  for (let i = 0; i < n; i++) { I[i] = (sd[i * 4] * 0.299 + sd[i * 4 + 1] * 0.587 + sd[i * 4 + 2] * 0.114) / 255; p[i] = md[i * 4 + 3] / 255; }
  const r = Math.max(2, Math.round(Math.max(w, hh) / 220)), q = guidedFilter(I, p, w, hh, r, 1e-3);
  const out = mx.createImageData(w, hh);
  // la zona claramente dentro o fuera se queda como estaba; el filtro solo decide en el borde
  // solo se ajusta la franja de transición que ya marcó el modelo: lo claramente dentro o fuera no se toca (si no, un fondo
  // de color parecido al sujeto se volvía semitransparente y quedaban halos)
  for (let i = 0; i < n; i++) { const v = p[i] > 0.97 || p[i] < 0.03 ? p[i] : Math.max(0, Math.min(1, (q[i] - 0.04) / 0.92)); out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = 255; out.data[i * 4 + 3] = Math.round(v * 255); }
  mx.putImageData(out, 0, 0);
  if (k === 1) return m;
  const big = makeCanvas(W, H), bx = ctx2d(big); bx.imageSmoothingQuality = 'high'; bx.drawImage(m, 0, 0, W, H); return big;
}

/** Descontaminar colores (como en Photoshop): en el borde semitransparente del sujeto, el color se sustituye por el del
 *  sujeto cercano, para que no quede un halo del color del fondo. Solo cambia esos píxeles (los demás no se tocan). */
export function decontaminate(layer: HTMLCanvasElement, mask: HTMLCanvasElement) {
  const W = layer.width, H = layer.height, lx = ctx2d(layer), img = lx.getImageData(0, 0, W, H), d = img.data, m = ctx2d(mask).getImageData(0, 0, W, H).data, n = W * H;
  const r = Math.max(3, Math.round(Math.max(W, H) / 250)), A = new Float32Array(n), C = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  // color del sujeto ponderado por lo «seguro» que es (alfa al cubo: lo del borde apenas cuenta)
  for (let i = 0; i < n; i++) { const a = (m[i * 4 + 3] / 255) ** 3; A[i] = a; for (let c = 0; c < 3; c++) C[c][i] = d[i * 4 + c] * a; }
  const mA = boxMean(A, W, H, r), mC = C.map(c => boxMean(c, W, H, r));
  let changed = 0;
  for (let i = 0; i < n; i++) {
    const a = m[i * 4 + 3]; if (a < 8 || a > 245 || mA[i] < 1e-4) continue;
    const k = 1 - a / 255;   // cuanto más transparente, más se sustituye
    for (let c = 0; c < 3; c++) d[i * 4 + c] = d[i * 4 + c] * (1 - k) + (mC[c][i] / mA[i]) * k;
    changed++;
  }
  lx.putImageData(img, 0, 0); return changed;
}

// ---- Profundidad → normales -------------------------------------------------------------------------------------
function normals(depth0: Float32Array, w: number, h: number, strength: number) {
  const n = w * h, N = new Float32Array(n * 3);
  // profundidad suavizada (mismo radio relativo a cualquier tamaño) y pendiente limitada: en los saltos bruscos
  // (el borde entre el sujeto y el fondo) la superficie no debe «mirar hacia atrás» y quedar negra
  const depth = boxMean(boxMean(depth0, w, h, Math.max(1, Math.round(Math.max(w, h) / 220))), w, h, Math.max(1, Math.round(Math.max(w, h) / 220)));
  const cap = 4 / Math.max(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, dx = Math.max(-cap, Math.min(cap, depth[y * w + Math.min(w - 1, x + 1)] - depth[y * w + Math.max(0, x - 1)])), dy = Math.max(-cap, Math.min(cap, depth[Math.min(h - 1, y + 1) * w + x] - depth[Math.max(0, y - 1) * w + x]));
    // la profundidad es «cercanía» (1 = cerca): una superficie que se acerca hacia la derecha mira a la izquierda
    let nx = -dx * strength, ny = -dy * strength, nz = 1; const l = Math.hypot(nx, ny, nz); N[i * 3] = nx / l; N[i * 3 + 1] = ny / l; N[i * 3 + 2] = nz / l;
  }
  return N;
}
const hexRgb = (s: string) => { const v = parseInt(s.slice(1), 16); return [v >> 16 & 255, v >> 8 & 255, v & 255].map(c => c / 255); };

/** Ilumina la foto con una luz en (lx, ly) (coordenadas de la imagen), a una altura y con un color. */
export function relight(src: HTMLCanvasElement, depth: Float32Array, o: { lx: number; ly: number; height: number; intensity: number; ambient: number; color: string; relief: number }) {
  const W = src.width, H = src.height, sd = ctx2d(src).getImageData(0, 0, W, H), d = sd.data, N = normals(depth, W, H, o.relief * Math.max(W, H) / 30), [cr, cg, cb] = hexRgb(o.color);
  const R = Math.max(W, H), lz = o.height * R;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, z = depth[i] * R * 0.25;
    let lx = o.lx - x, ly = o.ly - y, l3 = lz - z; const dist = Math.hypot(lx, ly, l3) || 1; lx /= dist; ly /= dist; l3 /= dist;
    const diff = Math.max(0, N[i * 3] * lx + N[i * 3 + 1] * ly + N[i * 3 + 2] * l3), fall = 1 / (1 + (dist / R) ** 2 * 2);
    const lit = diff * fall * o.intensity, k = o.ambient + lit * 1.6;
    d[i * 4] = Math.min(255, d[i * 4] * (o.ambient + lit * 1.6 * cr)); d[i * 4 + 1] = Math.min(255, d[i * 4 + 1] * (o.ambient + lit * 1.6 * cg)); d[i * 4 + 2] = Math.min(255, d[i * 4 + 2] * (o.ambient + lit * 1.6 * cb)); void k;
  }
  const out = makeCanvas(W, H); ctx2d(out).putImageData(sd, 0, 0); return out;
}
/** Niebla: más cuanto más lejos (profundidad baja). */
export function depthFog(src: HTMLCanvasElement, depth: Float32Array, o: { density: number; start: number; color: string }) {
  const W = src.width, H = src.height, sd = ctx2d(src).getImageData(0, 0, W, H), d = sd.data, [cr, cg, cb] = hexRgb(o.color).map(v => v * 255);
  for (let i = 0; i < W * H; i++) {
    const far = 1 - depth[i], t = Math.max(0, Math.min(1, (far - o.start) / Math.max(0.05, 1 - o.start))) ** 1.3 * o.density;
    d[i * 4] += (cr - d[i * 4]) * t; d[i * 4 + 1] += (cg - d[i * 4 + 1]) * t; d[i * 4 + 2] += (cb - d[i * 4 + 2]) * t;
  }
  const out = makeCanvas(W, H); ctx2d(out).putImageData(sd, 0, 0); return out;
}

// ---- Ventanas ----------------------------------------------------------------------------------------------------
const docKey = () => { const d = app.doc!; return `${(d as any).__aiId ??= Math.random().toString(36).slice(2)}:${d.history.index}:${d.width}x${d.height}`; };
/** Esqueleto común: la capa, su profundidad a tamaño de trabajo y la vista previa rápida. */
async function depthSession(name: string) {
  const d = app.doc, l = d?.active; if (!d || !l || !isRaster(l)) { app.toast('Elige la capa con la foto', 'warn'); return null; }
  const src = (l as RasterLayer).canvas, before = makeCanvas(src.width, src.height); ctx2d(before).drawImage(src, 0, 0);
  const dep = await aiDepth(before, docKey() + ':' + l.id); if (!dep) return null;
  // vista previa a ≤ 700 px
  const k = Math.min(1, 700 / Math.max(src.width, src.height)), sw = Math.max(1, Math.round(src.width * k)), sh = Math.max(1, Math.round(src.height * k));
  const small = makeCanvas(sw, sh); ctx2d(small).drawImage(before, 0, 0, sw, sh);
  const sdep = new Float32Array(sw * sh); for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) sdep[y * sw + x] = dep.d[Math.min(src.height - 1, Math.round(y / k)) * src.width + Math.min(src.width - 1, Math.round(x / k))];
  const show = (c: HTMLCanvasElement) => { if (k < 1) { const big = makeCanvas(src.width, src.height); ctx2d(big).drawImage(c, 0, 0, src.width, src.height); c = big; } (l as RasterLayer).canvas = c; (l as RasterLayer).touch(); d.invalidate(); };
  const restore = () => { (l as RasterLayer).canvas = before; (l as RasterLayer).touch(); d.invalidate(); };
  const commit = (c: HTMLCanvasElement) => { (l as RasterLayer).canvas = c; (l as RasterLayer).touch(); d.invalidate(); d.commit(name); };
  return { d, l, before, dep, k, small, sdep, show, restore, commit };
}

export async function relightDialog() {
  const s = await depthSession('Iluminación con IA'); if (!s) return;
  const W = s.before.width, H = s.before.height;
  const o = { lx: W * 0.25, ly: H * 0.2, height: 0.35, intensity: 1.1, ambient: 0.55, color: '#ffe2b8', relief: 1 };
  let t = 0;
  const run = (full = false) => { clearTimeout(t); t = window.setTimeout(() => { const k = s.k; s.show(relight(s.small, s.sdep, { ...o, lx: o.lx * k, ly: o.ly * k })); void full; }, 40); };
  const pick = (e: PointerEvent) => { const r = app.viewport.canvas.getBoundingClientRect(), p = app.viewport.toDoc(e.clientX - r.left, e.clientY - r.top); if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) return; o.lx = p.x; o.ly = p.y; run(); e.stopPropagation(); e.preventDefault(); };
  app.viewport.canvas.addEventListener('pointerdown', pick, true);
  const col = h('input', { type: 'color', class: 'color-input', value: o.color }) as HTMLInputElement; col.oninput = () => { o.color = col.value; run(); };
  const sl = (key: 'height' | 'intensity' | 'ambient' | 'relief', min: number, max: number, mul: number, unit = '%') => numberSlider({ min, max, value: Math.round((o as any)[key] * mul), unit, onInput: v => { (o as any)[key] = v / mul; run(); } }).el;
  const off = () => app.viewport.canvas.removeEventListener('pointerdown', pick, true);
  showDialog({ title: 'Iluminación con IA', width: 420, side: true, okLabel: 'Aplicar',
    body: [h('div', { class: 'hint' }, 'Toca la foto donde quieras poner la luz. La IA calcula el relieve de la escena (qué está delante y qué detrás) y la ilumina de forma realista.'),
      row('Color de la luz', col), row('Intensidad', sl('intensity', 0, 300, 100)), row('Altura de la luz', sl('height', 2, 200, 100)), row('Luz ambiente', sl('ambient', 0, 150, 100)), row('Relieve', sl('relief', 0, 300, 100))],
    onOk: () => { off(); clearTimeout(t); s.commit(relight(s.before, s.dep.d, o)); },
    onCancel: () => { off(); clearTimeout(t); s.restore(); } });
  run();
}

export async function fogDialog() {
  const s = await depthSession('Niebla por profundidad (IA)'); if (!s) return;
  const o = { density: 0.75, start: 0.25, color: '#dfe6ee' };
  let t = 0; const run = () => { clearTimeout(t); t = window.setTimeout(() => s.show(depthFog(s.small, s.sdep, o)), 40); };
  const col = h('input', { type: 'color', class: 'color-input', value: o.color }) as HTMLInputElement; col.oninput = () => { o.color = col.value; run(); };
  showDialog({ title: 'Niebla por profundidad (IA)', width: 400, side: true, okLabel: 'Aplicar',
    body: [h('div', { class: 'hint' }, 'Añade niebla o bruma que aumenta con la distancia, como en un paisaje real.'),
      row('Densidad', numberSlider({ min: 0, max: 100, value: 75, unit: '%', onInput: v => { o.density = v / 100; run(); } }).el),
      row('Empieza a', numberSlider({ min: 0, max: 95, value: 25, unit: '%', onInput: v => { o.start = v / 100; run(); } }).el), row('Color', col)],
    onOk: () => { clearTimeout(t); s.commit(depthFog(s.before, s.dep.d, o)); }, onCancel: () => { clearTimeout(t); s.restore(); } });
  run();
}

/** Selección › Cielo (IA): lo lejano, conectado con el borde de arriba, y con color de cielo; bordes refinados. */
export async function aiSelectSky() {
  const d = app.doc; if (!d) return;
  const comp = d.getComposite(), dep = await aiDepth(comp, docKey() + ':sky'); if (!dep) return;
  const W = comp.width, H = comp.height, px = ctx2d(comp).getImageData(0, 0, W, H).data, n = W * H;
  // umbral de «lejos»: el más lejano de la fila de arriba y algo más
  let topFar = 1; for (let x = 0; x < W; x++) topFar = Math.min(topFar, dep.d[x]);
  const thr = Math.min(0.5, topFar + 0.18);
  // el cielo puede ser azul, gris, blanco o de atardecer: se descarta solo lo verde (vegetación) y lo muy oscuro
  const skyish = (i: number) => { const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2]; return Math.max(r, g, b) > 45 && !(g > r + 12 && g > b + 12); };
  const m = new Uint8Array(n), stack: number[] = [];
  for (let x = 0; x < W; x++) if (dep.d[x] <= thr && skyish(x)) { m[x] = 1; stack.push(x); }
  while (stack.length) { const p = stack.pop()!, x = p % W, y = (p - x) / W; for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) if (q >= 0 && !m[q] && dep.d[q] <= thr + 0.04 && skyish(q)) { m[q] = 1; stack.push(q); } }
  let cnt = 0; for (let i = 0; i < n; i++) cnt += m[i];
  if (cnt < n * 0.01) { app.toast('No se ha encontrado cielo en esta imagen', 'warn'); return; }
  const mk = makeCanvas(W, H), mc = ctx2d(mk), im = mc.createImageData(W, H); for (let i = 0; i < n; i++) if (m[i]) { im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = im.data[i * 4 + 3] = 255; } mc.putImageData(im, 0, 0);
  d.selection.setMask(refineMask(comp, mk)); d.commit('Seleccionar cielo (IA)');
  app.toast('Cielo seleccionado. Prueba Edición › Sustituir cielo, o un ajuste');
}
