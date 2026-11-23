// Más funciones profesionales: texto dentro de una forma, pegar en un plano en perspectiva (punto de fuga),
// desenfoque de trazado, estilos de texto, comparar con otro documento abierto y Cálculos (mezclar canales).

import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog, row, promptDialog } from './dialog';
import { TextLayer, ShapeLayer, RasterLayer, isRaster, type Layer, type TextProps } from '../core/layers';
import { ctx2d, makeCanvas } from '../core/canvas';
import { homography, drawWarpExact } from '../tools/transform';
import { layerBox } from './ops';
import { icon } from './icons';

type P = { x: number; y: number };

// ---- Texto dentro de una forma ---------------------------------------------------------------------------
/** Contorno (polígono) de una capa: el trazado mayor, con las curvas convertidas en puntos. */
async function outlinePolygon(l: Layer): Promise<P[] | null> {
  let subs: { closed: boolean; pts: import('../core/layers').PathPoint[] }[];
  if (l instanceof ShapeLayer && l.props.shape === 'path' && l.props.path) subs = [l.props.path];
  else { const ops = await import('./ops'); subs = await ops.layerOutlines(l); }
  const polys = subs.map(s => { const P = s.pts, out: P[] = [], n = P.length; for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; for (let k = 0; k < 10; k++) { const t = k / 10, u = 1 - t; out.push({ x: u * u * u * a.x + 3 * u * u * t * a.ox + 3 * u * t * t * b.ix + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * a.oy + 3 * u * t * t * b.iy + t * t * t * b.y }); } } return out; });
  const area = (q: P[]) => Math.abs(q.reduce((s, p, i) => { const r = q[(i + 1) % q.length]; return s + p.x * r.y - r.x * p.y; }, 0)) / 2;
  const best = polys.sort((a, b) => area(b) - area(a))[0];
  return best && best.length > 2 ? best : null;
}
export async function textInShape() {
  const d = app.doc, l = d?.active;
  if (!d || !l || !(l instanceof ShapeLayer || (isRaster(l) && !(l instanceof TextLayer)))) { app.toast('Elige una capa de forma (un círculo, una estrella, un bocadillo…)', 'warn'); return; }
  const poly = await outlinePolygon(l); if (!poly) { app.toast('No encuentro el contorno de la forma', 'warn'); return; }
  const xs = poly.map(p => p.x), ys = poly.map(p => p.y), x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, hh = Math.max(...ys) - y0;
  const size = Math.max(10, Math.round(Math.min(w, hh) / 12));
  const t = new TextLayer('Texto en forma', d.width, d.height, {
    text: 'Escribe aquí tu texto: las líneas se adaptan al contorno de la forma, más cortas arriba y abajo y más largas en el centro.',
    font: 'Arial', size, color: app.fg === '#ffffff' ? '#000000' : app.fg, bold: false, italic: false, align: 'center', lineHeight: 1.2, tracking: 0,
    x: Math.round(x0), y: Math.round(y0), boxWidth: Math.round(w), area: poly.map(p => ({ x: +p.x.toFixed(1), y: +p.y.toFixed(1) })),
  } as TextProps);
  l.parent!.add(t, l.parent!.children.indexOf(l) + 1); d.setActive(t); d.invalidate(); d.commit('Texto en forma');
  app.setTool('text'); (app.tool as any)?.editLayer?.(t);
  app.toast('Escribe tu texto: se ajusta solo a la forma');
}

// ---- Punto de fuga: pegar en un plano en perspectiva ----------------------------------------------------
export function vanishingDialog() {
  const d = app.doc; if (!d) return;
  const layers = d.allLayers().filter(l => isRaster(l) && l.visible) as RasterLayer[];
  if (layers.length < 1) { app.toast('Necesitas una capa con la imagen que quieres pegar', 'warn'); return; }
  app.setTool('vanish', true);
}
export class VanishingTool {
  id = 'vanish'; name = 'Punto de fuga'; icon = icon('perspCrop'); cursor = 'crosshair';
  private q: P[] = []; private drag = -1; private src: RasterLayer | null = null; private fit: 'fill' | 'fit' = 'fill'; private layer: RasterLayer | null = null;
  activate() {
    const d = app.doc!; const W = d.width, H = d.height;
    this.q = [{ x: W * 0.3, y: H * 0.25 }, { x: W * 0.7, y: H * 0.3 }, { x: W * 0.7, y: H * 0.7 }, { x: W * 0.3, y: H * 0.75 }];
    const a = d.active; this.src = a && isRaster(a) ? a as RasterLayer : null; this.layer = null;
    app.toast('Coloca las 4 esquinas sobre la pared, el suelo o la pantalla donde quieras pegar la imagen; elige la imagen arriba y pulsa ✓');
    app.emit('tool');
  }
  extraOptions(bar: HTMLElement) {
    const d = app.doc!; const ls = d.allLayers().filter(l => isRaster(l)) as RasterLayer[];
    const sel = h('select', { title: 'Imagen que se pega en el plano' }, ...ls.map(l => h('option', { value: String(l.id), selected: l === this.src }, l.name))) as HTMLSelectElement;
    sel.onchange = () => { this.src = ls.find(l => String(l.id) === sel.value) ?? null; this.preview(); };
    const fit = h('select', {}, h('option', { value: 'fill' }, 'Llenar el plano'), h('option', { value: 'fit' }, 'Encajar sin deformar')) as HTMLSelectElement;
    fit.onchange = () => { this.fit = fit.value as any; this.preview(); };
    bar.append(h('span', { class: 'lbl' }, 'Pegar'), sel, fit,
      h('button', { class: 'btn icon-btn ok', type: 'button', title: 'Aplicar (Intro)', html: icon('check'), onclick: () => this.apply() }),
      h('button', { class: 'btn icon-btn', type: 'button', title: 'Cancelar (Esc)', html: icon('close'), onclick: () => this.cancel() }));
  }
  private render(): HTMLCanvasElement | null {
    const d = app.doc!, s = this.src; if (!s) return null;
    const b = layerBox(s) ?? { x: 0, y: 0, w: d.width, h: d.height };
    const crop = makeCanvas(Math.max(1, b.w), Math.max(1, b.h)); ctx2d(crop).drawImage(s.canvas, -b.x, -b.y);
    let quad = this.q;
    if (this.fit === 'fit') {
      // se mantiene la proporción de la imagen dentro del plano (en sus propias coordenadas)
      const Hm = homography(this.q), wq = (Math.hypot(this.q[1].x - this.q[0].x, this.q[1].y - this.q[0].y) + Math.hypot(this.q[2].x - this.q[3].x, this.q[2].y - this.q[3].y)) / 2, hq = (Math.hypot(this.q[3].x - this.q[0].x, this.q[3].y - this.q[0].y) + Math.hypot(this.q[2].x - this.q[1].x, this.q[2].y - this.q[1].y)) / 2;
      const ar = (crop.width / crop.height) / (wq / hq); let u0 = 0, v0 = 0, u1 = 1, v1 = 1;
      if (ar > 1) { const hh = 1 / ar; v0 = (1 - hh) / 2; v1 = v0 + hh; } else { const ww = ar; u0 = (1 - ww) / 2; u1 = u0 + ww; }
      quad = [Hm(u0, v0), Hm(u1, v0), Hm(u1, v1), Hm(u0, v1)];
    }
    const out = makeCanvas(d.width, d.height); drawWarpExact(ctx2d(out), crop, 0, 0, { w: crop.width, h: crop.height }, quad);
    return out;
  }
  private preview() {
    const d = app.doc!; const c = this.render(); if (!c) return;
    if (!this.layer) { this.layer = new RasterLayer('En perspectiva', d.width, d.height); d.root.add(this.layer); }
    this.layer.canvas = c; this.layer.touch(); d.invalidate();
  }
  down(e: any) { const vp = app.viewport; this.drag = this.q.findIndex(p => { const s = vp.toScreen(p.x, p.y); return Math.hypot(s.x - e.sx, s.y - e.sy) < 14; }); }
  move(e: any) { if (this.drag < 0) return; this.q[this.drag] = { x: e.x, y: e.y }; app.viewport.requestRender(); }
  up() { if (this.drag >= 0) this.preview(); this.drag = -1; }
  apply() {
    const d = app.doc!; this.preview();
    if (this.layer) { const src = this.src; if (src) this.layer.name = `${src.name} (en perspectiva)`; d.setActive(this.layer); d.commit('Punto de fuga'); }
    this.layer = null; app.restoreTool();
  }
  cancel() { const d = app.doc; if (this.layer && d) { this.layer.parent?.remove(this.layer); d.invalidate(); } this.layer = null; app.restoreTool(); }
  deactivate() { if (this.layer) this.cancel(); }
  key_(e: KeyboardEvent) { if (e.key === 'Enter') { this.apply(); return true; } if (e.key === 'Escape') { this.cancel(); return true; } return false; }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: import('./viewport').Viewport) {
    const q = this.q.map(p => vp.toScreen(p.x, p.y)); ctx.save();
    ctx.strokeStyle = '#3d8bfd'; ctx.lineWidth = 2; ctx.beginPath(); q.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
    const Hm = homography(this.q); ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.beginPath();
    for (let k = 1; k < 6; k++) { const a = vp.toScreen(Hm(k / 6, 0).x, Hm(k / 6, 0).y), b = vp.toScreen(Hm(k / 6, 1).x, Hm(k / 6, 1).y), c = vp.toScreen(Hm(0, k / 6).x, Hm(0, k / 6).y), dd = vp.toScreen(Hm(1, k / 6).x, Hm(1, k / 6).y); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.moveTo(c.x, c.y); ctx.lineTo(dd.x, dd.y); }
    ctx.stroke(); ctx.globalAlpha = 1;
    for (const p of q) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, 7); ctx.fill(); ctx.strokeStyle = '#222'; ctx.stroke(); }
    ctx.restore();
  }
}

// ---- Desenfoque de trazado --------------------------------------------------------------------------------------
/** Desenfoca la capa en la dirección del trazado activo (o de la forma de trazado): efecto de movimiento curvo. */
export function pathBlurDialog() {
  const d = app.doc, l = d?.active; if (!d || !l || !isRaster(l)) { app.toast('Elige una capa de imagen', 'warn'); return; }
  const sp = d.activePath >= 0 ? d.paths[d.activePath]?.subpaths : d.paths[0]?.subpaths;
  if (!sp?.length) { app.toast('Dibuja antes con la Pluma (modo Trazado) la dirección del movimiento', 'warn'); return; }
  let len = 30, center = 100;
  const src = (l as RasterLayer).canvas, before = makeCanvas(src.width, src.height); ctx2d(before).drawImage(src, 0, 0);
  const run = (final: boolean) => { const out = pathBlur(before, sp, len, center / 100, final ? 1 : Math.min(1, 700 / Math.max(src.width, src.height))); (l as RasterLayer).canvas = out; (l as RasterLayer).touch(); d.invalidate(); };
  let t = 0; const later = () => { clearTimeout(t); t = window.setTimeout(() => run(false), 50); };
  showDialog({ title: 'Desenfoque de trazado', width: 400, side: true, okLabel: 'Aplicar',
    body: [row('Velocidad', numberSlider({ min: 1, max: 200, value: len, unit: 'px', onInput: v => { len = v; later(); } }).el), row('Centrado', numberSlider({ min: 0, max: 100, value: center, unit: '%', onInput: v => { center = v; later(); } }).el),
      h('div', { class: 'hint' }, 'Cada zona se desenfoca siguiendo la dirección del trazado más cercano: sirve para dar sensación de movimiento a lo largo de una curva (un coche en una curva, agua, pelo…).')],
    onOk: () => { clearTimeout(t); run(true); d.commit('Desenfoque de trazado'); },
    onCancel: () => { clearTimeout(t); (l as RasterLayer).canvas = before; (l as RasterLayer).touch(); d.invalidate(); } });
  run(false);
}
export function pathBlur(src: HTMLCanvasElement, subs: { closed: boolean; pts: import('../core/layers').PathPoint[] }[], len: number, centered: number, scale = 1): HTMLCanvasElement {
  // puntos del trazado con su dirección
  const samples: { x: number; y: number; dx: number; dy: number }[] = [];
  for (const s of subs) { const P = s.pts, n = P.length, seg = s.closed ? n : n - 1; for (let i = 0; i < seg; i++) { const a = P[i], b = P[(i + 1) % n]; for (let k = 0; k < 24; k++) { const t = k / 24, u = 1 - t, x = u * u * u * a.x + 3 * u * u * t * a.ox + 3 * u * t * t * b.ix + t * t * t * b.x, y = u * u * u * a.y + 3 * u * u * t * a.oy + 3 * u * t * t * b.iy + t * t * t * b.y; const dx = 3 * u * u * (a.ox - a.x) + 6 * u * t * (b.ix - a.ox) + 3 * t * t * (b.x - b.ix), dy = 3 * u * u * (a.oy - a.y) + 6 * u * t * (b.iy - a.oy) + 3 * t * t * (b.y - b.iy), L = Math.hypot(dx, dy) || 1; samples.push({ x, y, dx: dx / L, dy: dy / L }); } } }
  const W = Math.max(1, Math.round(src.width * scale)), H = Math.max(1, Math.round(src.height * scale));
  const sc = makeCanvas(W, H); ctx2d(sc).drawImage(src, 0, 0, W, H);
  const S = ctx2d(sc).getImageData(0, 0, W, H).data, out = ctx2d(sc).createImageData(W, H), o = out.data;
  // campo de direcciones en una rejilla gruesa (la dirección del punto del trazado más cercano)
  const G = 16, gw = Math.ceil(W / G) + 1, gh = Math.ceil(H / G) + 1, field = new Float32Array(gw * gh * 2);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const x = i * G / scale, y = j * G / scale; let best = Infinity, bd = { dx: 1, dy: 0 }; for (const s of samples) { const dd = (s.x - x) ** 2 + (s.y - y) ** 2; if (dd < best) { best = dd; bd = s; } } field[(j * gw + i) * 2] = bd.dx; field[(j * gw + i) * 2 + 1] = bd.dy; }
  const L = len * scale, taps = Math.max(3, Math.min(48, Math.round(L))), off = (1 - centered) * 0.5;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const gi = Math.min(gw - 1, Math.round(x / G)), gj = Math.min(gh - 1, Math.round(y / G)), dx = field[(gj * gw + gi) * 2], dy = field[(gj * gw + gi) * 2 + 1];
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let k = 0; k < taps; k++) { const t = (k / (taps - 1) - 0.5 - off) * L, sx = Math.round(x + dx * t), sy = Math.round(y + dy * t); if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue; const q = (sy * W + sx) * 4, al = S[q + 3]; r += S[q] * al; g += S[q + 1] * al; b += S[q + 2] * al; a += al; n++; }
    const q = (y * W + x) * 4; if (a > 0) { o[q] = r / a; o[q + 1] = g / a; o[q + 2] = b / a; o[q + 3] = a / n; }
  }
  ctx2d(sc).putImageData(out, 0, 0);
  if (scale === 1) return sc;
  const full = makeCanvas(src.width, src.height); ctx2d(full).drawImage(sc, 0, 0, src.width, src.height); return full;
}

// ---- Estilos de texto -------------------------------------------------------------------------------------------
const TS_KEY = 'editor.textStyles';
const STYLE_KEYS: (keyof TextProps)[] = ['font', 'size', 'color', 'bold', 'italic', 'underline', 'caps', 'tracking', 'lineHeight', 'align', 'hScale', 'vScale', 'smallCaps'];
type TStyle = { name: string; props: Partial<TextProps> };
const loadTS = (): TStyle[] => { try { const v = JSON.parse(localStorage.getItem(TS_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const saveTS = (l: TStyle[]) => { try { localStorage.setItem(TS_KEY, JSON.stringify(l)); } catch { /* */ } };
const BUILTIN_TS: TStyle[] = [
  { name: 'Título', props: { font: 'Arial', size: 72, bold: true, tracking: -20, lineHeight: 1.05 } },
  { name: 'Subtítulo', props: { font: 'Playfair Display', size: 36, italic: true, bold: false, lineHeight: 1.2 } },
  { name: 'Texto normal', props: { font: 'Arial', size: 18, bold: false, italic: false, tracking: 0, lineHeight: 1.45 } },
  { name: 'Pie de foto', props: { font: 'Arial', size: 13, italic: true, color: '#666666', lineHeight: 1.3 } },
  { name: 'Cartel', props: { font: 'Anton', size: 96, caps: true, tracking: 40, lineHeight: 1 } },
];
export function textStylesDialog() {
  const d = app.doc;
  const list = h('div', { class: 'ts-list' });
  const apply = (s: TStyle) => {
    const sel = (d?.allLayers() ?? []).filter(l => d!.selectedIds.has(l.id) && l instanceof TextLayer) as TextLayer[];
    const targets = sel.length ? sel : d?.active instanceof TextLayer ? [d.active] : [];
    if (!targets.length) { app.toast('Selecciona una o varias capas de texto', 'warn'); return; }
    for (const t of targets) { Object.assign(t.props, s.props); t.render(); }
    d!.invalidate(); d!.commit(`Estilo de texto: ${s.name}`); app.toast(`«${s.name}» aplicado a ${targets.length} ${targets.length === 1 ? 'texto' : 'textos'}`);
  };
  const render = () => {
    list.innerHTML = '';
    const all = [...BUILTIN_TS.map(s => ({ s, user: false })), ...loadTS().map(s => ({ s, user: true }))];
    for (const { s, user } of all) {
      const p = s.props, prev = h('span', { class: 'ts-prev', style: { fontFamily: `${JSON.stringify(p.font ?? 'Arial')}, sans-serif`, fontWeight: p.bold ? 'bold' : 'normal', fontStyle: p.italic ? 'italic' : 'normal', textTransform: p.caps ? 'uppercase' : 'none', color: p.color ?? '' } }, s.name);
      const row2 = h('div', { class: 'ts-row' }, prev, h('span', { class: 'hint' }, `${p.font ?? ''} ${p.size ? p.size + ' px' : ''}`), h('button', { class: 'btn', type: 'button', onclick: () => apply(s) }, 'Aplicar'),
        user ? h('button', { class: 'btn icon-btn', type: 'button', title: 'Borrar estilo', onclick: () => { saveTS(loadTS().filter(x => x.name !== s.name)); render(); }, html: icon('trash') }) : null);
      list.append(row2);
    }
  };
  const saveBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    const t = app.doc?.active; if (!(t instanceof TextLayer)) { app.toast('Selecciona la capa de texto con el estilo que quieres guardar', 'warn'); return; }
    const name = (await promptDialog('Nuevo estilo de texto', 'Nombre', 'Mi estilo'))?.trim(); if (!name) return;
    const props: Partial<TextProps> = {}; for (const k of STYLE_KEYS) if (t.props[k] !== undefined) (props as any)[k] = t.props[k];
    saveTS([...loadTS().filter(x => x.name !== name), { name, props }]); render(); app.toast('Estilo guardado');
  } }, '＋ Guardar el estilo del texto seleccionado');
  render();
  showDialog({ title: 'Estilos de texto', width: 460, side: true, okLabel: 'Cerrar', cancelLabel: null, body: [h('div', { class: 'hint' }, 'Aplica de una vez fuente, tamaño, color, interletraje… a los textos seleccionados (como los estilos de carácter y de párrafo).'), list, saveBtn] });
}

// ---- Comparar con otro documento abierto ----------------------------------------------------------------------
export function compareWithDoc() {
  const d = app.doc; const others = app.docs.filter(x => x !== d);
  if (!d || !others.length) { app.toast('Abre otro documento para compararlo con este', 'warn'); return; }
  const sel = h('select', {}, ...others.map((o, i) => h('option', { value: String(i) }, o.name))) as HTMLSelectElement;
  showDialog({ title: 'Comparar con otro documento', width: 380, body: [row('Documento', sel), h('div', { class: 'hint' }, 'Se ve uno a cada lado de una línea que puedes arrastrar. Doble clic en el tirador para salir.')],
    onOk: async () => { const o = others[+sel.value]; const { startCompareWith } = await import('./compare'); startCompareWith(o.getComposite(), o.name); } });
}

// ---- Cálculos ----------------------------------------------------------------------------------------------------
export function calculationsDialog() {
  const d = app.doc; if (!d) return;
  const layers = d.allLayers().filter(l => isRaster(l)) as RasterLayer[];
  const srcOpts = () => [h('option', { value: 'merged' }, 'Imagen combinada'), ...layers.map(l => h('option', { value: String(l.id) }, l.name)), ...d.channels.map(c => h('option', { value: 'ch' + c.id }, 'Canal: ' + c.name))];
  const chOpts = () => [['gray', 'Gris'], ['r', 'Rojo'], ['g', 'Verde'], ['b', 'Azul'], ['a', 'Transparencia']].map(([v, n]) => h('option', { value: v }, n));
  const s1 = h('select', {}, ...srcOpts()) as HTMLSelectElement, c1 = h('select', {}, ...chOpts()) as HTMLSelectElement, i1 = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const s2 = h('select', {}, ...srcOpts()) as HTMLSelectElement, c2 = h('select', {}, ...chOpts()) as HTMLSelectElement, i2 = h('input', { type: 'checkbox' }) as HTMLInputElement;
  c2.value = 'r';
  const mode = h('select', {}, ...[['multiply', 'Multiplicar'], ['screen', 'Trama'], ['overlay', 'Superponer'], ['add', 'Añadir'], ['subtract', 'Restar'], ['difference', 'Diferencia'], ['darken', 'Oscurecer'], ['lighten', 'Aclarar'], ['normal', 'Normal']].map(([v, n]) => h('option', { value: v }, n))) as HTMLSelectElement;
  const out = h('select', {}, h('option', { value: 'channel' }, 'Canal nuevo'), h('option', { value: 'selection' }, 'Selección'), h('option', { value: 'layer' }, 'Capa nueva (en gris)')) as HTMLSelectElement;
  let opacity = 100;
  const get = (s: string, c: string, inv: boolean): Float32Array => {
    const W = d.width, H = d.height;
    const cv = s === 'merged' ? d.getComposite() : s.startsWith('ch') ? d.channels.find(x => 'ch' + x.id === s)!.canvas : (layers.find(l => String(l.id) === s) as RasterLayer).canvas;
    const D = ctx2d(cv).getImageData(0, 0, W, H).data, o = new Float32Array(W * H), isCh = s.startsWith('ch');
    for (let i = 0; i < W * H; i++) { const q = i * 4; let v = isCh ? D[q + 3] : c === 'r' ? D[q] : c === 'g' ? D[q + 1] : c === 'b' ? D[q + 2] : c === 'a' ? D[q + 3] : D[q] * 0.299 + D[q + 1] * 0.587 + D[q + 2] * 0.114; v /= 255; o[i] = inv ? 1 - v : v; }
    return o;
  };
  showDialog({ title: 'Cálculos', width: 460,
    body: [h('div', { class: 'dlg-section' }, 'Origen 1'), row('Capa', s1), row('Canal', c1), h('label', { class: 'check' }, i1, ' Invertir'),
      h('div', { class: 'dlg-section' }, 'Origen 2'), row('Capa', s2), row('Canal', c2), h('label', { class: 'check' }, i2, ' Invertir'),
      h('div', { class: 'dlg-section' }, 'Mezcla'), row('Modo', mode), row('Opacidad', numberSlider({ min: 0, max: 100, value: opacity, unit: '%', onInput: v => opacity = v }).el), row('Resultado', out),
      h('div', { class: 'hint' }, 'Mezcla dos canales para crear una máscara o una selección muy precisa (por ejemplo, para recortar pelo o cielos).')],
    onOk: () => {
      const A = get(s1.value, c1.value, i1.checked), B = get(s2.value, c2.value, i2.checked), k = opacity / 100, m = mode.value, W = d.width, H = d.height;
      const img = new ImageData(W, H), o = img.data;
      for (let i = 0; i < W * H; i++) {
        const a = A[i], b = B[i];
        let v = m === 'multiply' ? a * b : m === 'screen' ? 1 - (1 - a) * (1 - b) : m === 'overlay' ? (b < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)) : m === 'add' ? a + b : m === 'subtract' ? b - a : m === 'difference' ? Math.abs(a - b) : m === 'darken' ? Math.min(a, b) : m === 'lighten' ? Math.max(a, b) : a;
        v = b + (Math.max(0, Math.min(1, v)) - b) * k; const q = i * 4, g = Math.round(v * 255);
        if (out.value === 'layer') { o[q] = o[q + 1] = o[q + 2] = g; o[q + 3] = 255; } else { o[q] = o[q + 1] = o[q + 2] = 255; o[q + 3] = g; }
      }
      const c = makeCanvas(W, H); ctx2d(c).putImageData(img, 0, 0);
      if (out.value === 'selection') { d.selection.setMask(c); d.commit('Cálculos (selección)'); }
      else if (out.value === 'layer') { const l = d.newRasterLayer('Cálculos'); l.canvas = c; l.touch(); d.invalidate(); d.commit('Cálculos'); }
      else { const id = Math.max(0, ...d.channels.map(x => x.id)) + 1; d.channels.push({ id, name: `Alfa ${d.channels.length + 1}`, canvas: c }); d.changed(); d.commit('Cálculos (canal)'); app.toast('Canal creado: míralo en el panel Canales'); }
    } });
}
