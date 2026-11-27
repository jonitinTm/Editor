// Herramientas para quien hace videojuegos: cortar una hoja de sprites en fotogramas, empaquetar capas en un atlas
// (PNG + JSON), contorno de 1 píxel para sprites, cambiar los colores de un sprite (variantes), potencia de 2 y
// cuadrícula de tiles.
import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog } from './dialog';
import { ctx2d, makeCanvas, hexToRgb, rgbToHex } from '../core/canvas';
import { EditorDocument } from '../core/document';
import { RasterLayer } from '../core/layers';
import { prefs, savePrefs } from './prefs';

const row = (label: string, ...els: (HTMLElement | string)[]) => h('div', { class: 'form-row' }, h('label', {}, label), ...els);

// ---- cortar una hoja de sprites ---------------------------------------------------------------
/** Corta la imagen en una rejilla de casillas iguales y crea una animación con un fotograma por casilla. */
export function sliceSheet(src: HTMLCanvasElement, name: string, o: { cols: number; rows: number; margin: number; spacing: number; skipEmpty: boolean; pixel: boolean; fps: number }) {
  const cw = Math.floor((src.width - 2 * o.margin - (o.cols - 1) * o.spacing) / o.cols), ch = Math.floor((src.height - 2 * o.margin - (o.rows - 1) * o.spacing) / o.rows);
  if (cw < 1 || ch < 1) { app.toast('Las casillas quedan demasiado pequeñas', 'warn'); return null; }
  const d = new EditorDocument(`${name} (fotogramas)`, cw, ch), x = ctx2d(src);
  let n = 0;
  for (let r = 0; r < o.rows; r++) for (let c = 0; c < o.cols; c++) {
    const sx = o.margin + c * (cw + o.spacing), sy = o.margin + r * (ch + o.spacing);
    if (o.skipEmpty) { const px = x.getImageData(sx, sy, cw, ch).data; let any = false; for (let i = 3; i < px.length; i += 4) if (px[i]) { any = true; break; } if (!any) continue; }
    const l = new RasterLayer(`Fotograma ${n + 1}`, cw, ch); ctx2d(l.canvas).drawImage(src, sx, sy, cw, ch, 0, 0, cw, ch);
    d.root.add(l); n++;
  }
  if (!n) { app.toast('La hoja está vacía', 'warn'); return null; }
  const layers = d.root.children as RasterLayer[];
  d.frames = layers.map(l => ({ delay: Math.round(1000 / o.fps), visible: [l.id], own: l.id }));
  layers.forEach((l, i) => { l.visible = i === 0; });
  d.setActive(layers[0], false); d.frameIndex = 0;
  if (o.pixel) d.meta.pixelArt = true;
  app.addDocument(d, 'Cortar hoja de sprites');
  return d;
}
export function sliceDialog() {
  const d = app.doc; if (!d) { app.toast('Abre antes la imagen con la hoja de sprites', 'warn'); return; }
  const src = d.flatten(), o = { cols: 4, rows: 1, margin: 0, spacing: 0, skipEmpty: true, pixel: Math.max(src.width, src.height) <= 1024, fps: 8 };
  // si parece una tira, se adivina el número de casillas (casillas cuadradas)
  if (src.width > src.height && src.width % src.height === 0) o.cols = src.width / src.height;
  else if (src.height > src.width && src.height % src.width === 0) { o.cols = 1; o.rows = src.height / src.width; }
  const k = Math.min(1, 420 / src.width, 220 / src.height), pv = h('canvas', { class: 'gd-pv', width: Math.max(1, Math.round(src.width * k)), height: Math.max(1, Math.round(src.height * k)) }) as HTMLCanvasElement;
  const info = h('div', { class: 'hint' });
  const draw = () => {
    const x = ctx2d(pv); x.imageSmoothingEnabled = !o.pixel; x.clearRect(0, 0, pv.width, pv.height); x.drawImage(src, 0, 0, pv.width, pv.height);
    const cw = (src.width - 2 * o.margin - (o.cols - 1) * o.spacing) / o.cols, ch = (src.height - 2 * o.margin - (o.rows - 1) * o.spacing) / o.rows;
    x.strokeStyle = '#3d8bfd'; x.lineWidth = 1;
    for (let r = 0; r < o.rows; r++) for (let c = 0; c < o.cols; c++) x.strokeRect((o.margin + c * (cw + o.spacing)) * k + 0.5, (o.margin + r * (ch + o.spacing)) * k + 0.5, cw * k - 1, ch * k - 1);
    info.textContent = `${o.cols * o.rows} casillas de ${Math.floor(cw)} × ${Math.floor(ch)} px`;
  };
  const num = (key: 'cols' | 'rows' | 'margin' | 'spacing' | 'fps', label: string, min: number, max: number) => row(label, numberSlider({ min, max, value: o[key], onInput: v => { o[key] = v; draw(); } }).el);
  const skip = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement; skip.onchange = () => { o.skipEmpty = skip.checked; };
  const pix = h('input', { type: 'checkbox', checked: o.pixel }) as HTMLInputElement; pix.onchange = () => { o.pixel = pix.checked; draw(); };
  draw();
  showDialog({
    title: 'Cortar hoja de sprites en fotogramas', okLabel: 'Crear animación', width: 480,
    body: [h('div', { class: 'gd-pv-wrap' }, pv), info, num('cols', 'Columnas', 1, 64), num('rows', 'Filas', 1, 64), num('margin', 'Margen', 0, 64), num('spacing', 'Separación', 0, 64), num('fps', 'Velocidad (fps)', 1, 30),
      h('label', { class: 'check' }, skip, ' Saltar casillas vacías'), h('label', { class: 'check' }, pix, ' Es pixel art (sin suavizar)')],
    onOk: () => { if (sliceSheet(src, d.name, o)) app.toast('Animación creada: pulsa reproducir en la barra de abajo'); },
  });
}

// ---- atlas de sprites ---------------------------------------------------------------------------
const box = (c: HTMLCanvasElement) => { const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }; };
const pot = (n: number) => { let p = 1; while (p < n) p *= 2; return p; };
/** Empaqueta los sprites (recortados a lo que tienen dibujado) en filas, de más alto a más bajo. */
export function packAtlas(items: { name: string; canvas: HTMLCanvasElement }[], pad = 2, powerOfTwo = true) {
  const sprites = items.map(it => ({ ...it, b: box(it.canvas) })).filter(s => s.b) as { name: string; canvas: HTMLCanvasElement; b: { x: number; y: number; w: number; h: number } }[];
  if (!sprites.length) return null;
  sprites.sort((a, b) => b.b.h - a.b.h);
  const area = sprites.reduce((s, x) => s + (x.b.w + pad) * (x.b.h + pad), 0), maxW = Math.max(...sprites.map(s => s.b.w + pad * 2));
  let W = Math.max(maxW, Math.ceil(Math.sqrt(area) * 1.15)); if (powerOfTwo) W = pot(W);
  const placed: { name: string; x: number; y: number; s: typeof sprites[0] }[] = [];
  let x = pad, y = pad, rowH = 0;
  for (const s of sprites) { if (x + s.b.w + pad > W) { x = pad; y += rowH + pad; rowH = 0; } placed.push({ name: s.name, x, y, s }); x += s.b.w + pad; rowH = Math.max(rowH, s.b.h); }
  let H = y + rowH + pad; if (powerOfTwo) H = pot(H);
  const sheet = makeCanvas(W, H), sx = ctx2d(sheet), frames: Record<string, unknown> = {};
  for (const p of placed) {
    sx.drawImage(p.s.canvas, p.s.b.x, p.s.b.y, p.s.b.w, p.s.b.h, p.x, p.y, p.s.b.w, p.s.b.h);
    frames[p.name] = { frame: { x: p.x, y: p.y, w: p.s.b.w, h: p.s.b.h }, sourceSize: { w: p.s.canvas.width, h: p.s.canvas.height }, spriteSourceSize: { x: p.s.b.x, y: p.s.b.y, w: p.s.b.w, h: p.s.b.h }, trimmed: p.s.b.w !== p.s.canvas.width || p.s.b.h !== p.s.canvas.height };
  }
  return { sheet, json: { frames, meta: { app: 'Photocap', size: { w: W, h: H }, format: 'RGBA8888', scale: 1 } } };
}
export async function atlasDialog() {
  const d = app.doc; if (!d) return;
  const layers = d.allLayers().filter(l => (l as any).canvas && l.kind !== 'group') as RasterLayer[];
  if (layers.length < 1) { app.toast('No hay capas con imagen', 'warn'); return; }
  const potCb = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement, hidden = h('input', { type: 'checkbox' }) as HTMLInputElement;
  let pad = 2;
  showDialog({
    title: 'Atlas de sprites (capas)', okLabel: 'Exportar (ZIP)', width: 440,
    body: [h('div', { class: 'hint' }, 'Junta cada capa (recortada a lo que tiene dibujado) en una sola imagen y crea un JSON con la posición de cada una, para cargarlas en el motor del juego (Godot, Unity, Phaser…).'),
      row('Separación', numberSlider({ min: 0, max: 16, value: pad, unit: ' px', onInput: v => { pad = v; } }).el),
      h('label', { class: 'check' }, potCb, ' Tamaño en potencia de 2 (256, 512, 1024…)'), h('label', { class: 'check' }, hidden, ' Incluir también las capas ocultas')],
    onOk: async () => {
      const use = layers.filter(l => hidden.checked || l.visible);
      const r = packAtlas(use.map(l => ({ name: l.name, canvas: l.canvas })), pad, potCb.checked); if (!r) { app.toast('Las capas están vacías', 'warn'); return; }
      const { makeZip } = await import('../io/zip'), io = await import('../io/files');
      const png = new Uint8Array(await (await new Promise<Blob>(res => r.sheet.toBlob(b => res(b!), 'image/png'))).arrayBuffer());
      (r.json.meta as any).image = d.name + '_atlas.png';
      try { await io.saveBlob(makeZip([{ name: d.name + '_atlas.png', data: png }, { name: d.name + '_atlas.json', data: new TextEncoder().encode(JSON.stringify(r.json, null, 2)) }]), d.name + '_atlas.zip'); app.toast(`Atlas de ${Object.keys(r.json.frames).length} sprites: ${r.sheet.width} × ${r.sheet.height} px`); }
      catch (e: any) { if (e?.name !== 'AbortError') app.toast('No se pudo exportar: ' + (e?.message ?? e), 'warn'); }
    },
  });
}

// ---- contorno de 1 píxel ----------------------------------------------------------------------
/** Pinta un borde de 1 píxel alrededor de lo dibujado (sin suavizar), por fuera. */
export function outline1px(c: HTMLCanvasElement, color: string, diagonals: boolean) {
  const W = c.width, H = c.height, x = ctx2d(c), img = x.getImageData(0, 0, W, H), d = img.data, a = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) a[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  const [r, g, b] = hexToRgb(color); let n = 0;
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    const i = y * W + xx; if (a[i]) continue;
    const on = (X: number, Y: number) => X >= 0 && Y >= 0 && X < W && Y < H && a[Y * W + X] === 1;
    if (on(xx - 1, y) || on(xx + 1, y) || on(xx, y - 1) || on(xx, y + 1) || (diagonals && (on(xx - 1, y - 1) || on(xx + 1, y - 1) || on(xx - 1, y + 1) || on(xx + 1, y + 1)))) {
      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; n++;
    }
  }
  x.putImageData(img, 0, 0);
  return n;
}
export function outlineDialog() {
  const d = app.doc, l = d?.activeRaster(); if (!d || !l) { app.toast('Elige la capa del sprite', 'warn'); return; }
  const col = h('input', { type: 'color', value: '#000000', class: 'color-input' }) as HTMLInputElement, diag = h('input', { type: 'checkbox' }) as HTMLInputElement;
  showDialog({
    title: 'Contorno de 1 píxel (sprites)', okLabel: 'Aplicar', width: 380,
    body: [row('Color', col), h('label', { class: 'check' }, diag, ' También en diagonal (contorno más grueso en las esquinas)'), h('div', { class: 'hint' }, 'Rodea lo dibujado en la capa con un borde de un píxel, sin bordes suaves: el clásico contorno de los personajes de videojuego.')],
    onOk: () => { const n = outline1px(l.canvas, col.value, diag.checked); l.touch(); d.invalidate(); d.commit('Contorno de 1 píxel'); app.toast(n ? `Contorno: ${n} píxeles` : 'La capa está vacía'); },
  });
}

// ---- cambiar colores (variantes de un sprite) -------------------------------------------------
export function recolorDialog() {
  const d = app.doc, l = d?.activeRaster(); if (!d || !l) { app.toast('Elige la capa del sprite', 'warn'); return; }
  const W = l.canvas.width, H = l.canvas.height, before = ctx2d(l.canvas).getImageData(0, 0, W, H), src = before.data;
  const count = new Map<number, number>();
  for (let i = 0; i < src.length; i += 4) if (src[i + 3]) { const k = (src[i] << 16) | (src[i + 1] << 8) | src[i + 2]; count.set(k, (count.get(k) ?? 0) + 1); }
  if (count.size > 64) { app.toast(`La capa tiene ${count.size} colores: esta función es para sprites con pocos colores (hasta 64)`, 'warn'); return; }
  if (!count.size) { app.toast('La capa está vacía', 'warn'); return; }
  const colors = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k), map = new Map<number, number>(colors.map(k => [k, k]));
  const apply = () => { const img = new ImageData(new Uint8ClampedArray(src), W, H), o = img.data; for (let i = 0; i < o.length; i += 4) if (o[i + 3]) { const k = (o[i] << 16) | (o[i + 1] << 8) | o[i + 2], v = map.get(k)!; o[i] = v >> 16; o[i + 1] = v >> 8 & 255; o[i + 2] = v & 255; } ctx2d(l.canvas).putImageData(img, 0, 0); l.touch(); d.invalidate(); app.viewport.requestRender(); };
  const grid = h('div', { class: 'gd-colors' });
  for (const k of colors) {
    const hex = rgbToHex(k >> 16, k >> 8 & 255, k & 255), inp = h('input', { type: 'color', value: hex, class: 'color-input', title: hex, 'aria-label': hex }) as HTMLInputElement;
    inp.oninput = () => { const [r, g, b] = hexToRgb(inp.value); map.set(k, (r << 16) | (g << 8) | b); apply(); };
    grid.append(h('div', { class: 'gd-swap' }, h('span', { class: 'gd-old', style: { background: hex } }), '→', inp));
  }
  const shift = h('div', {}, numberSlider({ min: -180, max: 180, value: 0, unit: '°', onInput: v => { for (const k of colors) { const [r, g, b] = [k >> 16, k >> 8 & 255, k & 255], hs = hueShift(r, g, b, v); map.set(k, (hs[0] << 16) | (hs[1] << 8) | hs[2]); } grid.querySelectorAll<HTMLInputElement>('input').forEach((inp, i) => { const v2 = map.get(colors[i])!; inp.value = rgbToHex(v2 >> 16, v2 >> 8 & 255, v2 & 255); }); apply(); } }).el);
  showDialog({
    title: 'Cambiar colores del sprite', okLabel: 'Aplicar', width: 460, side: true,
    body: [h('div', { class: 'hint' }, 'Cada color del sprite se puede cambiar por otro: así haces variantes (enemigo rojo, azul, dorado…) sin volver a dibujar.'), row('Girar todos los tonos', shift), grid],
    onOk: () => { d.commit('Cambiar colores del sprite'); },
    onCancel: () => { ctx2d(l.canvas).putImageData(before, 0, 0); l.touch(); d.invalidate(); app.viewport.requestRender(); },
  });
}
function hueShift(r: number, g: number, b: number, deg: number): [number, number, number] {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2, dd = mx - mn;
  if (!dd) return [r, g, b];
  const s = dd / (1 - Math.abs(2 * l - 1)); let hh = mx === r / 255 ? ((g - b) / 255 / dd) % 6 : mx === g / 255 ? (b - r) / 255 / dd + 2 : (r - g) / 255 / dd + 4;
  hh = (hh * 60 + deg + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((hh / 60) % 2 - 1)), m = l - c / 2;
  const [r1, g1, b1] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

// ---- potencia de 2 y cuadrícula de tiles ------------------------------------------------------
export function potDialog() {
  const d = app.doc; if (!d) return;
  const P = (n: number) => { let p = 1; while (p < n) p *= 2; return p; }, Pd = (n: number) => { let p = 1; while (p * 2 <= n) p *= 2; return p; };
  const W = P(d.width), H = P(d.height);
  if (W === d.width && H === d.height) { app.toast(`Ya mide ${d.width} × ${d.height}: es potencia de 2`); return; }
  const mode = h('select', {}, h('option', { value: 'canvas' }, `Ampliar el lienzo a ${W} × ${H} (sin estirar la imagen)`), h('option', { value: 'up' }, `Escalar la imagen a ${W} × ${H}`), h('option', { value: 'down' }, `Escalar la imagen a ${Pd(d.width)} × ${Pd(d.height)}`));
  showDialog({
    title: 'Tamaño en potencia de 2', okLabel: 'Aplicar', width: 440,
    body: [h('div', { class: 'hint' }, 'Muchos motores de juego y tarjetas gráficas funcionan mejor con texturas de 64, 128, 256, 512, 1024… píxeles de lado.'), row('Cómo', mode)],
    onOk: () => {
      if (mode.value === 'canvas') d.resizeCanvas(W, H, 0, 0); else if (mode.value === 'up') d.resample(W, H); else d.resample(Pd(d.width), Pd(d.height));
      d.commit('Potencia de 2'); app.viewport.fit(true); app.emit('docs');
    },
  });
}
export function tileGridDialog() {
  const sel = h('select', {}, ...[8, 16, 24, 32, 48, 64, 128].map(n => h('option', { value: String(n) }, `${n} × ${n} px`))); sel.value = String([8, 16, 24, 32, 48, 64, 128].includes(prefs.gridSize) ? prefs.gridSize : 16);
  showDialog({
    title: 'Cuadrícula de tiles', okLabel: 'Mostrar', width: 360,
    body: [row('Tamaño del tile', sel), h('div', { class: 'hint' }, 'Muestra una cuadrícula del tamaño de las casillas del mapa del juego. Con Vista › Ajustar, lo que dibujes se pega a ella.')],
    onOk: () => { prefs.gridSize = +sel.value; savePrefs(); app.showGrid = true; app.viewport.requestRender(); app.toast(`Cuadrícula de ${sel.value} px`); },
  });
}
