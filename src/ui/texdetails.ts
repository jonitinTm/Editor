// Detalles para texturas propias: musgo, grietas, suciedad, óxido, humedad, hollín, arañazos, pintura desconchada,
// nieve y polvo. Se calculan sobre la imagen que ya hay (el musgo y la suciedad se meten en las grietas y zonas
// hundidas; la nieve se queda en los bordes de arriba), van en una capa aparte para poder cambiarlos y son repetibles
// (lo que sale por un borde entra por el otro). En estilo pixel art salen sin bordes suaves y con pocos tonos.
import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog } from './dialog';
import { ctx2d, makeCanvas } from '../core/canvas';
import { RasterLayer } from '../core/layers';
import { EditorDocument } from '../core/document';
import { fbm, fbm2, voronoi, clamp, sstep, rgb, mix, mul, hash, setTilePreview } from './textures';

export type DetailParams = { type: string; amount: number; scale: number; color: string; seed: number; pixel: boolean };
type Ctx = { W: number; H: number; L: Float32Array; cav: Float32Array; top: Float32Array; p: DetailParams; c: number[] };
type Det = { id: string; name: string; color: string; /** en pixel art, multiplica la opacidad (detalles muy tenues) */ boost?: number; fn?: (u: number, v: number, i: number, x: Ctx) => [number, number[]]; draw?: (x: Ctx, put: (px: number, py: number, a: number, c: number[]) => void) => void };

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
export const DETAILS: Det[] = [
  { id: 'moss', name: 'Musgo', color: '#4f7a2a', fn: (u, v, i, x) => {
    const s = x.p.scale, n = fbm(u, v, s * 2, s * 2, 5, x.p.seed), f = fbm(u, v, s * 8, s * 8, 3, x.p.seed + 3), th = 1.05 - x.p.amount * 0.8;
    const m = sstep(th, th + 0.12, n * 0.85 + x.cav[i] * 0.6 + (f - 0.5) * 0.3);
    return [m * 0.92, mix(mul(x.c, 0.7), mul(x.c, 1.25), f)];
  } },
  { id: 'cracks', name: 'Grietas', color: '#1d1a16', fn: (u, v, i, x) => {
    const s = Math.max(1, x.p.scale), wu = u + (fbm(u, v, 4, 4, 3, x.p.seed + 21) - 0.5) * 0.12, wv = v + (fbm(u, v, 4, 4, 3, x.p.seed + 22) - 0.5) * 0.12;
    const vo = voronoi(wu, wv, s, x.p.seed + 23), w = x.p.pixel ? Math.max(0.03, 0.7 * s / x.W) : 0.03, line = 1 - sstep(w * 0.2, w, vo.f2 - vo.f1);
    const th = 0.7 - x.p.amount * 0.45, m = sstep(th, th + 0.06, fbm(u, v, 3, 3, 3, x.p.seed + 24));
    return [line * m * 0.9, x.c];
  } },
  { id: 'dirt', name: 'Suciedad', color: '#3b2d20', boost: 1.3, fn: (u, v, i, x) => {
    const s = x.p.scale, n = fbm(u, v, s, s, 5, x.p.seed), th = 1 - x.p.amount * 0.75;
    const m = sstep(th, th + 0.3, n * 0.9 + x.cav[i] * 0.5);
    return [m * 0.75, mix(x.c, mul(x.c, 1.4), fbm(u, v, s * 6, s * 6, 3, x.p.seed + 1))];
  } },
  { id: 'rust', name: 'Óxido', color: '#9a4216', fn: (u, v, i, x) => {
    const s = x.p.scale, n = fbm(u, v, s * 1.5, s * 1.5, 6, x.p.seed), f = fbm(u, v, s * 10, s * 10, 3, x.p.seed + 4), th = 1.05 - x.p.amount * 0.75;
    const m = sstep(th, th + 0.1, n * 0.95 + x.cav[i] * 0.4 + (f - 0.5) * 0.35);
    return [m * 0.9, mix(mul(x.c, 0.75), [0.85, 0.48, 0.18], f)];
  } },
  { id: 'damp', name: 'Humedad (chorretones)', color: '#000000', boost: 2.4, fn: (u, v, i, x) => {
    const s = x.p.scale, n = fbm2(u, v, s * 6, Math.max(1, Math.round(s / 2)), 4, x.p.seed), th = 1 - x.p.amount * 0.75;
    const m = sstep(th, th + 0.2, n * 0.85 + x.cav[i] * 0.3);
    return [m * 0.38, x.c];
  } },
  { id: 'soot', name: 'Hollín (quemado)', color: '#121110', fn: (u, v, i, x) => {
    const s = x.p.scale, n = fbm(u, v, s, s, 6, x.p.seed), th = 1 - x.p.amount * 0.7;
    return [sstep(th, th + 0.25, n) * 0.85, x.c];
  } },
  { id: 'scratches', name: 'Arañazos', color: '#e8e2d6', draw: (x, put) => {
    // líneas finas al azar (también envuelven por los bordes)
    let seed = x.p.seed * 7919 + 13; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const n = Math.round(8 + x.p.amount * 90 * (x.W * x.H) / (256 * 256) / Math.max(1, x.p.scale / 4)), maxLen = Math.min(x.W, x.H) * 0.25;
    for (let k = 0; k < n; k++) {
      const x0 = r() * x.W, y0 = r() * x.H, ang = r() * Math.PI * 2, len = maxLen * (0.2 + r() * 0.8), light = r() < 0.65, a = 0.35 + r() * 0.45;
      const steps = Math.ceil(len), bend = (r() - 0.5) * 0.004;
      let px = x0, py = y0, an = ang;
      for (let t = 0; t < steps; t++) { put(px, py, a * (1 - t / steps * 0.5), light ? x.c : mul(x.c, 0.25)); px += Math.cos(an); py += Math.sin(an); an += bend; }
    }
  } },
  { id: 'peel', name: 'Pintura desconchada', color: '#b8b0a2', fn: (u, v, i, x) => {
    // manchas irregulares donde se ha caído la pintura (se ve el yeso), con una línea de sombra en el borde
    const s = Math.max(1, x.p.scale), n = fbm(u, v, s * 1.5, s * 1.5, 6, x.p.seed) + (fbm(u, v, s * 8, s * 8, 3, x.p.seed + 9) - 0.5) * 0.22, th = 0.78 - x.p.amount * 0.3;
    if (n < th) return [0, x.c];
    return n < th + 0.025 ? [0.85, mul(x.c, 0.55)] : n < th + 0.045 ? [1, mul(x.c, 1.15)] : [1, mix(x.c, mul(x.c, 0.9), fbm(u, v, s * 12, s * 12, 2, x.p.seed + 4))];
  } },
  { id: 'snow', name: 'Nieve', color: '#f3f7ff', fn: (u, v, i, x) => {
    const s = x.p.scale, n = fbm(u, v, s * 3, s * 3, 4, x.p.seed), th = 1 - x.p.amount * 0.9;
    const m = sstep(th, th + 0.12, x.top[i] * 0.8 + n * 0.45 + x.p.amount * 0.15);
    return [m, mix(mul(x.c, 0.92), x.c, n)];
  } },
  { id: 'dust', name: 'Polvo', color: '#d6ccb8', fn: (u, v, i, x) => {
    const film = fbm(u, v, x.p.scale, x.p.scale, 4, x.p.seed) * x.p.amount * 0.35, sp = hash(Math.floor(u * x.W), Math.floor(v * x.H), x.p.seed) < x.p.amount * 0.04 ? 0.7 : 0;
    return [Math.max(film, sp), x.c];
  } },
];

/** Prepara el brillo de la imagen: zonas hundidas (más oscuras que su entorno) y bordes de arriba. */
function analyse(base: HTMLCanvasElement, W: number, H: number) {
  const c = makeCanvas(W, H), x = ctx2d(c); x.drawImage(base, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data, L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = d[i * 4 + 3] ? (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255 : 0.5;
  // media del entorno (caja repetible), en dos pasadas
  const r = Math.max(1, Math.round(Math.min(W, H) / 48)), tmp = new Float32Array(W * H), blur = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) { let s = 0; for (let k = -r; k <= r; k++) s += L[y * W + ((xx + k) % W + W) % W]; tmp[y * W + xx] = s / (2 * r + 1); }
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) { let s = 0; for (let k = -r; k <= r; k++) s += tmp[((y + k) % H + H) % H * W + xx]; blur[y * W + xx] = s / (2 * r + 1); }
  const cav = new Float32Array(W * H), top = new Float32Array(W * H), k2 = Math.max(1, Math.round(r / 2));
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    const i = y * W + xx; cav[i] = clamp((blur[i] - L[i]) * 5);
    // borde de arriba: más claro que lo que tiene encima (donde se posa la nieve o el polvo)
    top[i] = clamp((L[i] - L[((y - k2) % H + H) % H * W + xx]) * 4 + 0.15);
  }
  return { L, cav, top };
}
/** Capa de detalle (RGBA) del tamaño indicado. */
export function renderDetail(base: HTMLCanvasElement, p: DetailParams, W = base.width, H = base.height): HTMLCanvasElement {
  const det = DETAILS.find(d => d.id === p.type) ?? DETAILS[0], { L, cav, top } = analyse(base, W, H);
  const cx: Ctx = { W, H, L, cav, top, p, c: rgb(p.color) };
  const out = makeCanvas(W, H), o = ctx2d(out), img = o.createImageData(W, H), D = img.data;
  const put = (px: number, py: number, a: number, c: number[]) => {
    const X = ((Math.round(px) % W) + W) % W, Y = ((Math.round(py) % H) + H) % H, i = (Y * W + X) * 4;
    const na = a + (D[i + 3] / 255) * (1 - a); if (na <= 0) return;
    for (let k = 0; k < 3; k++) D[i + k] = (c[k] * 255 * a + D[i + k] * (D[i + 3] / 255) * (1 - a)) / na;
    D[i + 3] = na * 255;
  };
  if (det.fn) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [a, c] = det.fn((x + 0.5) / W, (y + 0.5) / H, y * W + x, cx); if (a > 0.003) put(x, y, clamp(a), c); }
  if (det.draw) det.draw(cx, put);
  if (p.pixel) {
    // pixel art: sin semitransparencias (tramado ordenado para los bordes) y solo 3 tonos del color del detalle
    const shades = [0.72, 1, 1.22].map(k => mul(cx.c, k).map(v => clamp(v) * 255));
    // los detalles tenues (humedad, suciedad) oscurecen lo que hay debajo en vez de pintar su color tal cual
    let B: Uint8ClampedArray | null = null;
    if (det.boost) { const bc = makeCanvas(W, H), bx = ctx2d(bc); bx.imageSmoothingEnabled = false; bx.drawImage(base, 0, 0, W, H); B = bx.getImageData(0, 0, W, H).data; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, a = Math.min(1, D[i + 3] / 255 * (det.boost ?? 1)); if (!a) continue;
      // lo muy tenue se quita (si no, sale una rejilla de puntos); el resto se trama
      if (a < 0.3 || (a - 0.3) / 0.7 < BAYER[(y % 4) * 4 + (x % 4)]) { D[i + 3] = 0; continue; }
      if (B) { const k = Math.min(0.85, D[i + 3] / 255 * 1.6); for (let c = 0; c < 3; c++) D[i + c] = B[i + c] * (1 - k) + D[i + c] * k; D[i + 3] = 255; continue; }
      const l = D[i] * 0.299 + D[i + 1] * 0.587 + D[i + 2] * 0.114; let best = shades[1], bd = 1e9;
      for (const s of shades) { const dd = Math.abs(s[0] * 0.299 + s[1] * 0.587 + s[2] * 0.114 - l); if (dd < bd) { bd = dd; best = s; } }
      D[i] = best[0]; D[i + 1] = best[1]; D[i + 2] = best[2]; D[i + 3] = 255;
    }
  }
  o.putImageData(img, 0, 0);
  return out;
}

// ---- diálogo -----------------------------------------------------------------------------------
export function detailsDialog() {
  const d = app.doc; if (!d) { app.toast('Abre o crea antes la textura', 'warn'); return; }
  const base = d.flatten();
  let saved: Partial<DetailParams> = {}; try { saved = JSON.parse(localStorage.getItem('editor.texDetail') || '{}'); } catch { /* */ }
  const p: DetailParams = { type: 'moss', amount: 0.5, scale: 4, color: '#4f7a2a', seed: 1, pixel: !!d.meta.pixelArt, ...saved };
  if (saved.pixel === undefined) p.pixel = !!d.meta.pixelArt;
  const PV = 260, k = Math.min(1, PV / Math.max(base.width, base.height)), pw = Math.max(1, Math.round(base.width * k)), ph = Math.max(1, Math.round(base.height * k));
  const tile = !!d.meta.tileable, pv = h('canvas', { class: 'tex-pv', width: tile ? pw * 2 : pw, height: tile ? ph * 2 : ph }) as HTMLCanvasElement;
  const small = makeCanvas(pw, ph); { const x = ctx2d(small); x.imageSmoothingEnabled = !p.pixel; x.drawImage(base, 0, 0, pw, ph); }
  let pending = 0;
  const redraw = () => { if (pending) return; pending = requestAnimationFrame(() => {
    pending = 0; const ov = renderDetail(small, p), x = ctx2d(pv); x.imageSmoothingEnabled = false;
    const n = tile ? 2 : 1; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { x.drawImage(small, i * pw, j * ph); x.drawImage(ov, i * pw, j * ph); }
  }); };
  const color = h('input', { type: 'color', value: p.color, class: 'color-input', 'aria-label': 'Color del detalle' }) as HTMLInputElement;
  color.oninput = () => { p.color = color.value; redraw(); };
  const types = h('div', { class: 'tex-chips' });
  for (const t of DETAILS) { const b = h('button', { type: 'button', class: 'btn tex-chip' + (t.id === p.type ? ' on' : ''), 'data-d': t.id }, t.name); b.onclick = () => { p.type = t.id; p.color = t.color; color.value = t.color; types.querySelectorAll('.tex-chip').forEach(x => x.classList.toggle('on', x === b)); redraw(); }; types.append(b); }
  const row = (label: string, ...els: (HTMLElement | string)[]) => h('div', { class: 'form-row' }, h('label', {}, label), ...els);
  const pix = h('input', { type: 'checkbox', checked: p.pixel }) as HTMLInputElement; pix.onchange = () => { p.pixel = pix.checked; redraw(); };
  const seed = h('button', { type: 'button', class: 'btn' }, 'Otra variante'); seed.onclick = () => { p.seed = 1 + Math.floor(Math.random() * 9999); redraw(); };
  const merge = h('input', { type: 'checkbox' }) as HTMLInputElement;
  redraw();
  showDialog({
    title: 'Añadir detalles a la textura', okLabel: 'Añadir', width: 640,
    body: [h('div', { class: 'tex-wrap' },
      h('div', { class: 'tex-left' }, types, h('div', { class: 'hint' }, 'Se adaptan a la imagen: el musgo y la suciedad se meten en las juntas y zonas hundidas, y la nieve se queda en los bordes de arriba. Puedes añadir varios, uno detrás de otro.')),
      h('div', { class: 'tex-right' }, h('div', { class: 'tex-pv-wrap' }, pv),
        row('Cantidad', numberSlider({ min: 0, max: 100, value: Math.round(p.amount * 100), unit: '%', onInput: v => { p.amount = v / 100; redraw(); } }).el),
        row('Escala', numberSlider({ min: 1, max: 16, value: p.scale, onInput: v => { p.scale = v; redraw(); } }).el),
        row('Color', color), row('', seed),
        h('label', { class: 'check' }, pix, ' Estilo pixel art (sin bordes suaves)'),
        h('label', { class: 'check' }, merge, ' Pintar sobre la capa actual (si no, va en una capa nueva que puedes cambiar o borrar)')))],
    onOk: () => {
      try { localStorage.setItem('editor.texDetail', JSON.stringify(p)); } catch { /* */ }
      const ov = renderDetail(d.flatten(), p), name = DETAILS.find(t => t.id === p.type)!.name;
      const cur = d.activeRaster();
      if (merge.checked && cur) { ctx2d(cur.canvas).drawImage(ov, 0, 0); cur.touch(); }
      else { const l = new RasterLayer(name, d.width, d.height); ctx2d(l.canvas).drawImage(ov, 0, 0); const parent = (cur?.parent ?? d.root) as any; parent.add(l, cur ? parent.children.indexOf(cur) + 1 : parent.children.length); d.setActive(l, false); }
      d.invalidate(); d.commit(`Detalle: ${name}`); app.emit('docs');
    },
  });
}

/** Nueva textura en blanco (repetible): dibujas tú y luego le añades detalles. */
export function newTextureDialog() {
  const size = h('select', {}, ...[16, 32, 64, 128, 256, 512, 1024].map(n => h('option', { value: String(n) }, `${n} × ${n}`))); size.value = '256';
  const col = h('input', { type: 'color', value: '#8c8578', class: 'color-input' }) as HTMLInputElement;
  const pix = h('input', { type: 'checkbox' }) as HTMLInputElement;
  pix.onchange = () => { if (pix.checked && +size.value > 128) size.value = '32'; };
  const row = (label: string, ...els: (HTMLElement | string)[]) => h('div', { class: 'form-row' }, h('label', {}, label), ...els);
  showDialog({
    title: 'Nueva textura', okLabel: 'Crear', width: 420,
    body: [h('div', { class: 'hint' }, 'Una textura vacía que se repite: lo que pintes cerca de un borde aparece también por el lado contrario, así no quedan cortes. Después añade detalles con Juegos › Añadir detalles a la textura.'),
      row('Tamaño', size), row('Color de fondo', col), h('label', { class: 'check' }, pix, ' Pixel art')],
    onOk: async () => {
      const n = +size.value, d = new EditorDocument(`Textura ${n}`, n, n), bg = new RasterLayer('Fondo', n, n), x = ctx2d(bg.canvas); x.fillStyle = col.value; x.fillRect(0, 0, n, n);
      const l = new RasterLayer('Capa 1', n, n); d.root.add(bg); d.root.add(l); d.setActive(l, false);
      d.meta.tileable = true; if (pix.checked) d.meta.pixelArt = true;
      app.addDocument(d, 'Nueva textura'); setTilePreview(true);
      app.setTool(pix.checked ? 'pixel' : 'brush');
      requestAnimationFrame(() => app.viewport.fit());
    },
  });
}
