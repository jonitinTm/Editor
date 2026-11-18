// Transformación libre (Ctrl+T): escalar, girar, voltear y mover la capa
// activa o el contenido seleccionado. Intro aplica, Esc cancela.

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import type { Viewport } from '../ui/viewport';
import { cloneCanvas, contentBounds, ctx2d, makeCanvas, Rect, rectUnion } from '../core/canvas';
import { GroupLayer, RasterLayer, SmartLayer, Matrix, matMul, isRaster, isParametric, walkLayers } from '../core/layers';
import { selectedLayers } from '../ui/ops';
import { rasterizeLayer } from './paint';
import { h, numberSlider } from '../ui/dom';
import { drawMesh, drawMeshExact, meshFromQuad, meshInverse, dragSurface, styledMesh, meshPoint, WARP_STYLES } from './warpmesh';

interface TState { cx: number; cy: number; sx: number; sy: number; angle: number; }

interface Item {
  layer: RasterLayer;
  src: HTMLCanvasElement;   // píxeles a transformar
  rect: Rect;               // posición original de esos píxeles
  hole: HTMLCanvasElement;  // la capa sin esos píxeles
  /** Objeto inteligente: no se tocan píxeles, solo se compone su matriz. */
  m0?: Matrix;
  /** Objeto inteligente que se rasterizará al aplicar una distorsión. */
  toRaster?: boolean;
}
type P = { x: number; y: number };
interface Session {
  /** Modo distorsionar/perspectiva: esquinas de destino (sup-izq, sup-der, inf-der, inf-izq). */
  quad?: P[] | null;
  /** Modo deformar: 16 puntos de control del parche Bézier. */
  mesh?: P[] | null;
  items: Item[];
  rect: Rect;                        // caja que engloba todos los elementos
  selMask: HTMLCanvasElement | null; // selección original recortada a rect
  /** Transformar selección (sin píxeles) y la selección de partida para cancelar. */
  selOnly?: boolean; selOrig?: HTMLCanvasElement;
  st: TState;
}

const rot = (x: number, y: number, a: number) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });

/** Prepara el contenido a transformar: la capa activa, varias capas o grupos enteros. */
function prepare(): Session | null {
  const doc = app.doc!;
  if (TransformTool.selectionOnly) {
    // Transformar selección: solo se mueve el contorno, no los píxeles
    TransformTool.selectionOnly = false;
    const sel = doc.selection.mask, b = sel ? contentBounds(sel) : null;
    if (!sel || !b) { app.toast('Haz primero una selección', 'warn'); return null; }
    const selMask = makeCanvas(b.w, b.h); ctx2d(selMask).drawImage(sel, -b.x, -b.y);
    return { items: [], rect: b, selMask, selOnly: true, selOrig: cloneCanvas(sel), st: { cx: b.x + b.w / 2, cy: b.y + b.h / 2, sx: 1, sy: 1, angle: 0 } };
  }
  if (!doc.active) { app.toast('No hay ninguna capa seleccionada', 'warn'); return null; }
  let chosen = selectedLayers();
  if (!chosen.includes(doc.active)) chosen = [doc.active];
  if (chosen.some(l => l.posLocked())) { app.toast(chosen.some(l => l.isLocked()) ? 'La capa está bloqueada' : 'La posición de la capa está bloqueada', 'warn'); return null; }
  const layers = [...new Set(chosen.flatMap(l => l instanceof GroupLayer ? [...walkLayers(l)] : [l]))].filter(l => isRaster(l) && !l.isLocked());
  const sel = doc.selection.mask;
  const items: Item[] = [];
  let union: Rect | null = null;
  for (let layer of layers) {
    if (layer instanceof SmartLayer && !sel) {
      // Caja = contorno del objeto ya transformado
      const m = layer.props.m, w = layer.src.width, h = layer.src.height;
      const xs = [0, w, 0, w].map((x, i) => m[0] * x + m[2] * (i < 2 ? 0 : h) + m[4]), ys = [0, w, 0, w].map((x, i) => m[1] * x + m[3] * (i < 2 ? 0 : h) + m[5]);
      const rect = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      items.push({ layer, src: layer.src, rect, hole: makeCanvas(doc.width, doc.height), m0: m });
      union = rectUnion(union, rect);
      continue;
    }
    if (isParametric(layer)) layer = rasterizeLayer(layer as RasterLayer);
    const l = layer as RasterLayer;
    // Sin selección se usa el contenido completo (incluido lo que esté fuera del lienzo)
    const f = sel ? { canvas: l.canvas, x: 0, y: 0 } : l.fullContent();
    const pixels = cloneCanvas(f.canvas);
    if (sel) { const c = ctx2d(pixels); c.globalCompositeOperation = 'destination-in'; c.drawImage(sel, 0, 0); c.globalCompositeOperation = 'source-over'; }
    const b = contentBounds(pixels);
    if (!b) continue;
    const src = makeCanvas(b.w, b.h);
    ctx2d(src).drawImage(pixels, -b.x, -b.y);
    const hole = cloneCanvas(l.canvas);
    const hc = ctx2d(hole);
    if (sel) { hc.globalCompositeOperation = 'destination-out'; hc.drawImage(sel, 0, 0); hc.globalCompositeOperation = 'source-over'; }
    else hc.clearRect(0, 0, hole.width, hole.height);
    const rect = { x: b.x + f.x, y: b.y + f.y, w: b.w, h: b.h };
    items.push({ layer: l, src, rect, hole });
    union = rectUnion(union, rect);
  }
  if (!items.length || !union) { app.toast('No hay píxeles que transformar', 'warn'); return null; }
  let selMask: HTMLCanvasElement | null = null;
  if (sel) { selMask = makeCanvas(union.w, union.h); ctx2d(selMask).drawImage(sel, -union.x, -union.y); }
  return { items, rect: union, selMask, st: { cx: union.x + union.w / 2, cy: union.y + union.h / 2, sx: 1, sy: 1, angle: 0 } };
}

/** Dibuja `src` (situado originalmente en `rect`) con la transformación de la sesión. */
function drawTransformed(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, rect: Rect, s: Session, m0?: Matrix) {
  const st = s.st;
  ctx.save();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.translate(st.cx, st.cy); ctx.rotate(st.angle); ctx.scale(st.sx, st.sy);
  if (m0) { ctx.translate(-(s.rect.x + s.rect.w / 2), -(s.rect.y + s.rect.h / 2)); ctx.transform(...m0); ctx.drawImage(src, 0, 0); }
  else ctx.drawImage(src, rect.x - (s.rect.x + s.rect.w / 2), rect.y - (s.rect.y + s.rect.h / 2));
  ctx.restore();
}
/** Matriz de la transformación de la sesión (espacio del documento → documento). */
function sessionMatrix(s: Session): Matrix {
  const { cx, cy, sx, sy, angle } = s.st, c = Math.cos(angle), n = Math.sin(angle);
  const ux = s.rect.x + s.rect.w / 2, uy = s.rect.y + s.rect.h / 2;
  return matMul([c * sx, n * sx, -n * sy, c * sy, cx, cy], [1, 0, 0, 1, -ux, -uy]);
}

/** Proyección del cuadrado unidad sobre un cuadrilátero (para perspectiva). */
export function homography(q: P[]) {
  const [p0, p1, p2, p3] = q;
  const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
  let a, b, c, d, e, f, g = 0, h = 0;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) { a = p1.x - p0.x; b = p3.x - p0.x; c = p0.x; d = p1.y - p0.y; e = p3.y - p0.y; f = p0.y; }
  else {
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, den = dx1 * dy2 - dx2 * dy1 || 1e-9;
    g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den;
    a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + h * p3.x; c = p0.x; d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + h * p3.y; f = p0.y;
  }
  const fn = (u: number, v: number): P => { const w = g * u + h * v + 1; return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w }; };
  return Object.assign(fn, { m: [a, b, c, d, e, f, g, h, 1] });
}

/** Igual que drawWarp pero calculando cada píxel (sin costuras); se usa al aplicar. */
export function drawWarpExact(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, ox: number, oy: number, U: { w: number; h: number }, quad: P[]) {
  const W = ctx.canvas.width, Hh = ctx.canvas.height;
  const x0 = Math.max(0, Math.floor(Math.min(...quad.map(q => q.x)))), x1 = Math.min(W, Math.ceil(Math.max(...quad.map(q => q.x))));
  const y0 = Math.max(0, Math.floor(Math.min(...quad.map(q => q.y)))), y1 = Math.min(Hh, Math.ceil(Math.max(...quad.map(q => q.y))));
  const bw = x1 - x0, bh = y1 - y0; if (bw < 1 || bh < 1 || img.width < 1 || img.height < 1) return;
  const [a, b, c, d, e, f, g, h, i] = homography(quad).m;
  // inversa de la matriz 3×3 (adjunta)
  const A = e * i - f * h, B = c * h - b * i, C = b * f - c * e, D = f * g - d * i, E = a * i - c * g, F = c * d - a * f, G = d * h - e * g, Hm = b * g - a * h, I = a * e - b * d;
  const sw = img.width, sh = img.height, src = img.getContext('2d')!.getImageData(0, 0, sw, sh).data;
  const out = new ImageData(bw, bh), o = out.data;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const X = x0 + x + 0.5, Y = y0 + y + 0.5, w = G * X + Hm * Y + I;
    const u = (A * X + B * Y + C) / w, v = (D * X + E * Y + F) / w;
    if (u < -0.002 || v < -0.002 || u > 1.002 || v > 1.002) continue;
    const sx = u * U.w - ox - 0.5, sy = v * U.h - oy - 0.5;
    const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
    let r = 0, gg = 0, bb = 0, al = 0;
    for (let k = 0; k < 4; k++) {
      const px = ix + (k & 1), py = iy + (k >> 1); if (px < 0 || py < 0 || px >= sw || py >= sh) continue;
      const wt = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy), j = (py * sw + px) * 4, aa = src[j + 3] * wt;
      r += src[j] * aa; gg += src[j + 1] * aa; bb += src[j + 2] * aa; al += aa;
    }
    if (al <= 0) continue;
    const q = (y * bw + x) * 4; o[q] = r / al; o[q + 1] = gg / al; o[q + 2] = bb / al; o[q + 3] = al;
  }
  const t = makeCanvas(bw, bh); t.getContext('2d')!.putImageData(out, 0, 0);
  ctx.drawImage(t, x0, y0);
}

/** Dibuja `img` (situada en (ox, oy) dentro de la caja U) deformada sobre el cuadrilátero `quad`. */
export function drawWarp(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, ox: number, oy: number, U: { w: number; h: number }, quad: P[], N = 16) {
  const H = homography(quad), pts: P[][] = [];
  for (let j = 0; j <= N; j++) { const row: P[] = []; for (let i = 0; i <= N; i++) row.push(H(i / N, j / N)); pts.push(row); }
  const tri = (s0: P, s1: P, s2: P, d0: P, d1: P, d2: P) => {
    const det = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y); if (Math.abs(det) < 1e-9) return;
    const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / det, c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / det;
    const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / det, d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / det;
    const e = d0.x - a * s0.x - c * s0.y, f = d0.y - b * s0.x - d * s0.y;
    // se amplía el triángulo de recorte 0,6 px para que no se vean costuras
    const cx = (d0.x + d1.x + d2.x) / 3, cy = (d0.y + d1.y + d2.y) / 3, grow = (q: P) => { const l = Math.hypot(q.x - cx, q.y - cy) || 1; return { x: q.x + (q.x - cx) / l * 1.2, y: q.y + (q.y - cy) / l * 1.2 }; };
    const [g0, g1, g2] = [grow(d0), grow(d1), grow(d2)];
    ctx.save(); ctx.beginPath(); ctx.moveTo(g0.x, g0.y); ctx.lineTo(g1.x, g1.y); ctx.lineTo(g2.x, g2.y); ctx.closePath(); ctx.clip();
    ctx.transform(a, b, c, d, e, f); ctx.drawImage(img, 0, 0); ctx.restore();
  };
  const cw = U.w / N, ch = U.h / N;
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x0 = i * cw, y0 = j * ch;
    if (x0 + cw < ox - cw || x0 > ox + img.width + cw || y0 + ch < oy - ch || y0 > oy + img.height + ch) continue;
    const s00 = { x: x0 - ox, y: y0 - oy }, s10 = { x: x0 + cw - ox, y: y0 - oy }, s11 = { x: x0 + cw - ox, y: y0 + ch - oy }, s01 = { x: x0 - ox, y: y0 + ch - oy };
    tri(s00, s10, s11, pts[j][i], pts[j][i + 1], pts[j + 1][i + 1]);
    tri(s00, s11, s01, pts[j][i], pts[j + 1][i + 1], pts[j + 1][i]);
  }
  ctx.restore();
}
/** Dibuja un elemento con la transformación de la sesión (afín o distorsión). */
function drawItem(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, rect: Rect, s: Session, m0?: Matrix, exact = false) {
  if (s.mesh) (exact ? drawMeshExact : drawMesh)(ctx, src, rect.x - s.rect.x, rect.y - s.rect.y, s.rect, s.mesh);
  else if (s.quad) (exact ? drawWarpExact : drawWarp)(ctx, src, rect.x - s.rect.x, rect.y - s.rect.y, s.rect, s.quad);
  else drawTransformed(ctx, src, rect, s, m0);
}

function clearOverrides(s: Session) { for (const it of s.items) app.doc?.overrides.delete(it.layer); }

/** Aplica una sesión: pinta el resultado en las capas y transforma la selección. */
function applySession(s: Session, name: string) {
  const doc = app.doc!;
  clearOverrides(s);
  for (const it of s.items) {
    if (it.m0 && !s.quad && it.layer instanceof SmartLayer) { it.layer.applyMatrix(sessionMatrix(s)); continue; }
    let layer = it.layer;
    if (it.toRaster) layer = rasterizeLayer(layer);
    { const hx = ctx2d(it.hole); hx.globalCompositeOperation = 'source-over'; hx.globalAlpha = 1; drawItem(hx, it.src, it.rect, s, undefined, true); }
    layer.canvas = it.hole; layer.touch();
  }
  if (s.selMask) {
    const m = makeCanvas(doc.width, doc.height);
    drawItem(ctx2d(m), s.selMask, s.rect, s, undefined, true);
    doc.selection.setMask(m);
  }
  doc.commit(name);
}

/** Voltea o gira la capa activa sin pasar por el modo interactivo. */
export function quickTransform(kind: 'flipH' | 'flipV' | 'rot90' | 'rot-90' | 'rot180') {
  const s = prepare(); if (!s) return;
  const names = { flipH: 'Voltear horizontal', flipV: 'Voltear vertical', rot90: 'Rotar 90° horario', 'rot-90': 'Rotar 90° antihorario', rot180: 'Rotar 180°' };
  if (kind === 'flipH') s.st.sx = -1;
  if (kind === 'flipV') s.st.sy = -1;
  if (kind === 'rot90') s.st.angle = Math.PI / 2;
  if (kind === 'rot-90') s.st.angle = -Math.PI / 2;
  if (kind === 'rot180') s.st.angle = Math.PI;
  applySession(s, names[kind]);
}

type Drag = { kind: 'move' | 'rotate' | 'scale'; hx: number; hy: number; start: { x: number; y: number }; st0: TState };

export class TransformTool implements Tool {
  id = 'transform'; name = 'Transformación libre'; icon = icon('move'); cursor = 'default';
  private s: Session | null = null;
  private drag: Drag | null = null;
  private qdrag: { i: number | 'move'; start: P; q0: P[] } | null = null;
  /** Modo de la transformación: libre, distorsionar o perspectiva. */
  warp: 'free' | 'distort' | 'perspective' | 'warp' | 'skew' = 'free';
  private mdrag: { kind: 'pt'; i: number; start: P; m0: P[] } | { kind: 'surf'; u: number; v: number; start: P; m0: P[] } | null = null;
  private warpStyle = 'none'; private bend = 50; private warpBox: Rect | null = null;
  /** Modo con el que debe empezar la próxima sesión (desde el menú). */
  static startMode: 'free' | 'distort' | 'perspective' | 'warp' | 'skew' = 'free';
  /** La próxima sesión transforma solo la selección. */
  static selectionOnly = false;
  private fields: Record<string, HTMLInputElement> = {};

  activate() {
    this.s = prepare();
    this.warp = 'free';
    if (!this.s) { setTimeout(() => app.restoreTool(), 0); return; }
    const m = TransformTool.startMode; TransformTool.startMode = 'free';
    if (m !== 'free') this.enterQuad(m);
    this.preview();
  }
  deactivate() { if (this.s) this.commit(); }
  docChanged() { if (this.s) { clearOverrides(this.s); this.s = null; } setTimeout(() => app.tool === this && app.restoreTool(), 0); }

  extraOptions(bar: HTMLElement) {
    const num = (key: string, label: string, unit: string) => {
      const inp = h('input', { type: 'number', class: 'num', step: 'any' });
      inp.addEventListener('change', () => this.fromFields());
      this.fields[key] = inp;
      bar.append(h('label', { class: 'opt' }, h('span', { class: 'lbl' }, label), inp, h('span', { class: 'unit' }, unit)));
    };
    if (this.s?.mesh) {
      const styleSel = h('select', { title: 'Estilo de deformación' }, ...Object.entries(WARP_STYLES).map(([k, n]) => h('option', { value: k, selected: k === this.warpStyle }, n)));
      styleSel.onchange = () => { this.warpStyle = styleSel.value; this.applyStyle(); app.emit('tool'); };
      bar.append(h('label', { class: 'opt' }, h('span', { class: 'lbl' }, 'Deformar'), styleSel));
      if (this.warpStyle !== 'none') bar.append(numberSlider({ label: 'Curvatura', min: -100, max: 100, value: this.bend, unit: '%', compact: true, onInput: v => { this.bend = v; this.applyStyle(); } }).el);
      else bar.append(h('span', { class: 'hint' }, 'Arrastra los puntos o directamente la imagen.'));
    }
    else if (this.s?.quad) bar.append(h('span', { class: 'hint' }, this.warp === 'perspective' ? 'Perspectiva: arrastra una esquina (la vecina se mueve en espejo).' : this.warp === 'skew' ? 'Sesgar: arrastra el punto medio de un lado.' : 'Distorsionar: arrastra cada esquina libremente.'));
    else { num('x', 'X', 'px'); num('y', 'Y', 'px'); num('w', 'An', '%'); num('h', 'Al', '%'); num('a', 'Ángulo', '°'); }
    const modeSel = h('select', { title: 'Modo de transformación' }, h('option', { value: 'free' }, 'Libre'), h('option', { value: 'distort' }, 'Distorsionar'), h('option', { value: 'skew' }, 'Sesgar'), h('option', { value: 'perspective' }, 'Perspectiva'), h('option', { value: 'warp' }, 'Deformar'));
    modeSel.value = this.warp;
    modeSel.onchange = () => { if (modeSel.value === 'free') { app.toast('Para volver a la transformación libre, cancela (Esc) y empieza de nuevo', 'warn'); modeSel.value = this.warp; return; } this.enterQuad(modeSel.value as any); };
    bar.append(modeSel);
    bar.append(
      h('button', { class: 'btn icon-btn', title: 'Voltear horizontal', html: icon('flipH'), onclick: () => { if (this.s) { this.s.st.sx *= -1; this.preview(); } } }),
      h('button', { class: 'btn icon-btn', title: 'Voltear vertical', html: icon('flipV'), onclick: () => { if (this.s) { this.s.st.sy *= -1; this.preview(); } } }),
      h('button', { class: 'btn icon-btn ok', title: 'Aplicar (Intro)', html: icon('check'), onclick: () => { this.commit(); app.restoreTool(); } }),
      h('button', { class: 'btn icon-btn', title: 'Cancelar (Esc)', html: icon('close'), onclick: () => { this.cancel(); app.restoreTool(); } }),
    );
    this.syncFields();
  }
  private syncFields() {
    const s = this.s; if (!s || !this.fields.x || s.quad) return;
    this.fields.x.value = String(Math.round(s.st.cx - s.rect.w * Math.abs(s.st.sx) / 2));
    this.fields.y.value = String(Math.round(s.st.cy - s.rect.h * Math.abs(s.st.sy) / 2));
    this.fields.w.value = (s.st.sx * 100).toFixed(1);
    this.fields.h.value = (s.st.sy * 100).toFixed(1);
    this.fields.a.value = (s.st.angle * 180 / Math.PI).toFixed(1);
  }
  private fromFields() {
    const s = this.s; if (!s) return;
    const f = (k: string) => parseFloat(this.fields[k].value);
    s.st.sx = (f('w') || 100) / 100; s.st.sy = (f('h') || 100) / 100; s.st.angle = (f('a') || 0) * Math.PI / 180;
    s.st.cx = f('x') + s.rect.w * Math.abs(s.st.sx) / 2; s.st.cy = f('y') + s.rect.h * Math.abs(s.st.sy) / 2;
    this.preview();
  }

  private preview() {
    const s = this.s; if (!s) return;
    const doc = app.doc!;
    if (s.selOnly && s.selMask) {
      // la selección transformada se ve en vivo
      const m = makeCanvas(doc.width, doc.height); drawItem(ctx2d(m), s.selMask, s.rect, s, undefined, false);
      doc.selection.setMask(m);
    }
    for (const it of s.items) doc.overrides.set(it.layer, { canvas: it.hole, extra: ctx => drawItem(ctx, it.src, it.rect, s, it.m0) });
    doc.invalidate();
    this.syncFields();
    app.viewport.requestRender();
  }

  /** Esquinas y puntos medios de la caja en coordenadas del documento. */
  private handles() {
    const s = this.s!; const { st } = s;
    const hw = s.rect.w / 2 * st.sx, hh = s.rect.h / 2 * st.sy;
    const pts: { hx: number; hy: number; x: number; y: number }[] = [];
    for (const hy of [-1, 0, 1]) for (const hx of [-1, 0, 1]) {
      if (!hx && !hy) continue;
      const p = rot(hx * hw, hy * hh, st.angle);
      pts.push({ hx, hy, x: st.cx + p.x, y: st.cy + p.y });
    }
    return pts;
  }
  private local(x: number, y: number) { const st = this.s!.st; return rot(x - st.cx, y - st.cy, -st.angle); }

  /** Pasa al modo de esquinas libres (distorsionar / perspectiva). */
  enterQuad(mode: 'distort' | 'perspective' | 'warp' | 'skew') {
    const s = this.s; if (!s) return;
    if (s.mesh && mode !== 'warp') { app.toast('Para dejar de deformar, cancela (Esc) y empieza de nuevo', 'warn'); app.emit('tool'); return; }
    this.warp = mode;
    if (!s.quad) {
      const hs = this.handles(), c = (hx: number, hy: number) => { const p = hs.find(q => q.hx === hx && q.hy === hy)!; return { x: p.x, y: p.y }; };
      s.quad = [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
      for (const it of s.items) if (it.m0) {
        // Los objetos inteligentes se distorsionan como píxeles
        const r = { x: Math.floor(it.rect.x), y: Math.floor(it.rect.y), w: Math.ceil(it.rect.w) + 1, h: Math.ceil(it.rect.h) + 1 };
        const crop = makeCanvas(r.w, r.h); ctx2d(crop).drawImage(it.layer.canvas, -r.x, -r.y);
        it.src = crop; it.rect = r; it.m0 = undefined; it.toRaster = true;
      }
      // La caja pasa a ser la unión en coordenadas sin transformar
    }
    if (mode === 'warp' && !s.mesh) {
      s.mesh = meshFromQuad(s.quad!); this.warpStyle = 'none';
      const xs = s.quad!.map(p => p.x), ys = s.quad!.map(p => p.y);
      this.warpBox = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    this.preview();
    app.emit('tool');
  }
  private quadHit(e: ToolEvent): number | 'move' | null {
    const q = this.s!.quad!, vp = app.viewport;
    for (let i = 0; i < 4; i++) { const sp = vp.toScreen(q[i].x, q[i].y); if (Math.abs(sp.x - e.sx) < 9 && Math.abs(sp.y - e.sy) < 9) return i; }
    // puntos medios de los lados (4 + número de lado: arriba, derecha, abajo, izquierda)
    for (let k = 0; k < 4; k++) { const a = q[k], b = q[(k + 1) % 4], sp = vp.toScreen((a.x + b.x) / 2, (a.y + b.y) / 2); if (Math.abs(sp.x - e.sx) < 8 && Math.abs(sp.y - e.sy) < 8) return 4 + k; }
    let inside = false;
    for (let i = 0, j = 3; i < 4; j = i++) if ((q[i].y > e.y) !== (q[j].y > e.y) && e.x < (q[j].x - q[i].x) * (e.y - q[i].y) / (q[j].y - q[i].y) + q[i].x) inside = !inside;
    return inside ? 'move' : null;
  }
  private hit(e: ToolEvent): 'move' | 'rotate' | { hx: number; hy: number } {
    const vp = app.viewport;
    for (const p of this.handles()) {
      const sp = vp.toScreen(p.x, p.y);
      if (Math.abs(sp.x - e.sx) < 8 && Math.abs(sp.y - e.sy) < 8) return { hx: p.hx, hy: p.hy };
    }
    const s = this.s!; const l = this.local(e.x, e.y);
    const hw = Math.abs(s.rect.w / 2 * s.st.sx), hh = Math.abs(s.rect.h / 2 * s.st.sy);
    if (Math.abs(l.x) <= hw && Math.abs(l.y) <= hh) return 'move';
    return 'rotate';
  }
  /** Estilo predefinido de deformación (Arco, Bandera…). */
  private applyStyle() {
    const s = this.s; if (!s?.mesh || !this.warpBox) return;
    s.mesh = this.warpStyle === 'none' ? meshFromQuad(s.quad!) : styledMesh(this.warpStyle, this.warpBox, this.bend);
    this.preview();
  }
  private meshHit(e: ToolEvent): number | 'surf' | null {
    const m = this.s!.mesh!, vp = app.viewport;
    // primero las esquinas (por encima de los tiradores)
    for (const i of [0, 3, 12, 15, 1, 2, 4, 7, 8, 11, 13, 14, 5, 6, 9, 10]) { const sp = vp.toScreen(m[i].x, m[i].y); if (Math.abs(sp.x - e.sx) < 8 && Math.abs(sp.y - e.sy) < 8) return i; }
    return meshInverse(m, e.x, e.y) ? 'surf' : null;
  }
  hover(e: ToolEvent) {
    if (!this.s) return;
    if (this.s.mesh) { const q = this.meshHit(e); this.cursor = q === 'surf' ? 'move' : q === null ? 'default' : 'crosshair'; return; }
    if (this.s.quad) { const q = this.quadHit(e); this.cursor = q === 'move' ? 'move' : q === null ? 'default' : 'crosshair'; return; }
    const r = this.hit(e);
    this.cursor = r === 'move' ? 'move' : r === 'rotate' ? 'alias' : 'crosshair';
  }
  down(e: ToolEvent) {
    if (!this.s) return;
    if (!this.s.quad && e.ctrl) {
      const r0 = this.hit(e);
      if (typeof r0 === 'object' && r0.hx && r0.hy) this.enterQuad(e.alt && e.shift ? 'perspective' : 'distort');
      else if (typeof r0 === 'object') {
        // Ctrl + tirador lateral: sesgar (el lado se desliza en su propia dirección)
        this.enterQuad('skew');
        const side = r0.hy === -1 ? 0 : r0.hx === 1 ? 1 : r0.hy === 1 ? 2 : 3;
        this.qdrag = { i: 4 + side, start: { x: e.x, y: e.y }, q0: this.s.quad!.map(p => ({ ...p })) };
        return;
      }
    }
    if (this.s.mesh) {
      const q = this.meshHit(e), m0 = this.s.mesh.map(p => ({ ...p }));
      if (typeof q === 'number') this.mdrag = { kind: 'pt', i: q, start: { x: e.x, y: e.y }, m0 };
      else if (q === 'surf') { const uv = meshInverse(this.s.mesh, e.x, e.y)!; this.mdrag = { kind: 'surf', u: uv.u, v: uv.v, start: { x: e.x, y: e.y }, m0 }; }
      if (e.detail >= 2 && q === 'surf') { this.mdrag = null; this.commit(); app.restoreTool(); return; }
      if (this.mdrag && this.warpStyle !== 'none') { this.warpStyle = 'none'; app.emit('tool'); }
      return;
    }
    if (this.s.quad) {
      const q = this.quadHit(e);
      if (q !== null) this.qdrag = { i: q, start: { x: e.x, y: e.y }, q0: this.s.quad.map(p => ({ ...p })) };
      if (e.detail >= 2 && q === 'move') { this.commit(); app.restoreTool(); }
      return;
    }
    const r = this.hit(e);
    const st0 = { ...this.s.st };
    if (r === 'move' || r === 'rotate') this.drag = { kind: r, hx: 0, hy: 0, start: { x: e.x, y: e.y }, st0 };
    else this.drag = { kind: 'scale', hx: r.hx, hy: r.hy, start: { x: e.x, y: e.y }, st0 };
    if (e.detail >= 2 && r === 'move') { this.commit(); app.restoreTool(); }
  }
  move(e: ToolEvent) {
    if (this.s?.mesh && this.mdrag) {
      const d = this.mdrag, dx = e.x - d.start.x, dy = e.y - d.start.y;
      if (d.kind === 'surf') this.s.mesh = dragSurface(d.m0, d.u, d.v, dx, dy);
      else {
        const m = d.m0.map(p => ({ ...p }));
        // al mover una esquina la acompañan sus tiradores
        const group = ({ 0: [0, 1, 4, 5], 3: [3, 2, 7, 6], 12: [12, 13, 8, 9], 15: [15, 14, 11, 10] } as Record<number, number[]>)[d.i] ?? [d.i];
        for (const k of group) m[k] = { x: d.m0[k].x + dx, y: d.m0[k].y + dy };
        this.s.mesh = m;
      }
      this.preview(); return;
    }
    if (this.s?.quad && this.qdrag) {
      const { i, start, q0 } = this.qdrag, dx = e.x - start.x, dy = e.y - start.y, q = this.s.quad;
      if (i === 'move') q0.forEach((p, k) => { q[k] = { x: p.x + dx, y: p.y + dy }; });
      else if (typeof i === 'number' && i >= 4) {
        // lado: con Sesgar (o Ctrl) se desliza a lo largo de sí mismo; si no, se mueve libre
        const a = (i - 4), b = (a + 1) % 4, ex = q0[b].x - q0[a].x, ey = q0[b].y - q0[a].y, L = Math.hypot(ex, ey) || 1;
        let mx = dx, my = dy;
        if (this.warp === 'skew' || e.ctrl) { const t = (dx * ex + dy * ey) / L; mx = ex / L * t; my = ey / L * t; }
        q0.forEach((p, k) => { q[k] = { ...p }; }); q[a] = { x: q0[a].x + mx, y: q0[a].y + my }; q[b] = { x: q0[b].x + mx, y: q0[b].y + my };
      }
      else if (this.warp === 'perspective' || (e.alt && e.shift)) {
        // Perspectiva: la esquina vecina se mueve en espejo
        q0.forEach((p, k) => { q[k] = { ...p }; });
        if (Math.abs(dx) >= Math.abs(dy)) { const pair = [1, 0, 3, 2][i]; q[i].x += dx; q[pair].x -= dx; }
        else { const pair = [3, 2, 1, 0][i]; q[i].y += dy; q[pair].y -= dy; }
      } else { q0.forEach((p, k) => { q[k] = { ...p }; }); q[i] = { x: q0[i].x + dx, y: q0[i].y + dy }; }
      this.preview(); return;
    }
    const s = this.s, d = this.drag; if (!s || !d) return;
    const st = s.st, st0 = d.st0;
    if (d.kind === 'move') {
      st.cx = st0.cx + e.x - d.start.x; st.cy = st0.cy + e.y - d.start.y;
    } else if (d.kind === 'rotate') {
      const a0 = Math.atan2(d.start.y - st0.cy, d.start.x - st0.cx);
      const a1 = Math.atan2(e.y - st0.cy, e.x - st0.cx);
      let a = st0.angle + a1 - a0;
      if (e.shift) a = Math.round(a / (Math.PI / 12)) * Math.PI / 12;
      st.angle = a;
    } else {
      // Escalado en el sistema local (sin rotación) de la caja original
      const p = rot(e.x - st0.cx, e.y - st0.cy, -st0.angle);
      const w = s.rect.w, hgt = s.rect.h;
      let L = -w / 2 * st0.sx, R = w / 2 * st0.sx, T = -hgt / 2 * st0.sy, B = hgt / 2 * st0.sy;
      const center = e.alt;
      if (d.hx === 1) { R = p.x; if (center) L = -p.x; }
      if (d.hx === -1) { L = p.x; if (center) R = -p.x; }
      if (d.hy === 1) { B = p.y; if (center) T = -p.y; }
      if (d.hy === -1) { T = p.y; if (center) B = -p.y; }
      let sx = (R - L) / w, sy = (B - T) / hgt;
      if (e.shift && d.hx && d.hy) {
        // Proporcional: usa el factor mayor
        const kx = sx / st0.sx, ky = sy / st0.sy;
        const k = Math.abs(kx) > Math.abs(ky) ? kx : ky;
        sx = st0.sx * k; sy = st0.sy * k;
        if (!center) {
          if (d.hx === 1) R = L + sx * w; else L = R - sx * w;
          if (d.hy === 1) B = T + sy * hgt; else T = B - sy * hgt;
        } else { R = sx * w / 2; L = -R; B = sy * hgt / 2; T = -B; }
      }
      if (Math.abs(sx) < 0.001) sx = 0.001 * Math.sign(sx || 1);
      if (Math.abs(sy) < 0.001) sy = 0.001 * Math.sign(sy || 1);
      const c = rot((L + R) / 2, (T + B) / 2, st0.angle);
      st.sx = sx; st.sy = sy; st.cx = st0.cx + c.x; st.cy = st0.cy + c.y;
    }
    this.preview();
  }
  up() { this.drag = null; this.qdrag = null; this.mdrag = null; }

  commit() {
    const s = this.s; if (!s) return;
    this.s = null;
    const st = s.st;
    if (!s.quad && st.sx === 1 && st.sy === 1 && st.angle === 0 && st.cx === s.rect.x + s.rect.w / 2 && st.cy === s.rect.y + s.rect.h / 2) {
      clearOverrides(s); app.doc!.invalidate(); return;
    }
    applySession(s, s.selOnly ? 'Transformar selección' : s.mesh ? 'Deformar' : 'Transformación libre');
  }
  cancel() {
    const s = this.s; if (!s) return;
    this.s = null;
    if (s.selOnly && s.selOrig) app.doc!.selection.setMask(s.selOrig);
    clearOverrides(s); app.doc!.invalidate(); app.viewport.requestRender();
  }
  key_(e: KeyboardEvent) {
    if (e.key === 'Enter') { this.commit(); app.restoreTool(); return true; }
    if (e.key === 'Escape') { this.cancel(); app.restoreTool(); return true; }
    return false;
  }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (!this.s) return;
    if (this.s.mesh) {
      const m = this.s.mesh, S = (p: P) => vp.toScreen(p.x, p.y);
      ctx.save(); ctx.strokeStyle = '#3d8bfd';
      // rejilla de la malla (bordes más marcados)
      for (let k = 0; k <= 3; k++) for (const dir of [0, 1]) {
        ctx.lineWidth = k === 0 || k === 3 ? 1.5 : 0.8; ctx.beginPath();
        for (let t = 0; t <= 32; t++) { const p = S(dir ? meshPoint(m, k / 3, t / 32) : meshPoint(m, t / 32, k / 3)); t ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
        ctx.stroke();
      }
      // tiradores: líneas de cada esquina a sus dos vecinos
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(61,139,253,0.7)';
      for (const [a, b] of [[0, 1], [0, 4], [3, 2], [3, 7], [12, 13], [12, 8], [15, 14], [15, 11]]) { const p = S(m[a]), q = S(m[b]); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
      m.forEach((pt, i) => {
        const p = S(pt);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#3d8bfd'; ctx.lineWidth = 1;
        if ([0, 3, 12, 15].includes(i)) { ctx.fillRect(p.x - 4, p.y - 4, 8, 8); ctx.strokeRect(p.x - 4, p.y - 4, 8, 8); }
        else { ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, 7); ctx.fill(); ctx.stroke(); }
      });
      ctx.restore();
      return;
    }
    if (this.s.quad) {
      const q = this.s.quad.map(p => vp.toScreen(p.x, p.y));
      ctx.strokeStyle = '#3d8bfd'; ctx.lineWidth = 1.5; ctx.beginPath(); q.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
      for (const p of q) { ctx.fillStyle = '#fff'; ctx.fillRect(p.x - 4, p.y - 4, 8, 8); ctx.strokeStyle = '#3d8bfd'; ctx.lineWidth = 1; ctx.strokeRect(p.x - 4, p.y - 4, 8, 8); }
      for (let k = 0; k < 4; k++) { const a = q[k], b = q[(k + 1) % 4], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(mx, my, 3.5, 0, 7); ctx.fill(); ctx.strokeStyle = '#3d8bfd'; ctx.stroke(); }
      return;
    }
    const hs = this.handles();
    const corner = (hx: number, hy: number) => { const p = hs.find(q => q.hx === hx && q.hy === hy)!; return vp.toScreen(p.x, p.y); };
    const box = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    ctx.strokeStyle = '#3d8bfd'; ctx.lineWidth = 1.5; ctx.beginPath();
    box.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
    for (const p of hs) {
      const s = vp.toScreen(p.x, p.y);
      ctx.fillStyle = '#fff'; ctx.fillRect(s.x - 4, s.y - 4, 8, 8);
      ctx.strokeStyle = '#3d8bfd'; ctx.lineWidth = 1; ctx.strokeRect(s.x - 4, s.y - 4, 8, 8);
    }
    const c = vp.toScreen(this.s.st.cx, this.s.st.cy);
    ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, 7); ctx.strokeStyle = '#3d8bfd'; ctx.stroke();
  }
}

/** Endereza el cuadrilátero `quad` de `src` en un rectángulo de ow × oh (recorte con perspectiva). */
export function warpQuadToRect(src: HTMLCanvasElement, quad: P[], ow: number, oh: number): HTMLCanvasElement {
  const Hm = homography(quad), sw = src.width, sh = src.height;
  const s = src.getContext('2d')!.getImageData(0, 0, sw, sh).data, out = new ImageData(ow, oh), o = out.data;
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const p = Hm((x + 0.5) / ow, (y + 0.5) / oh), fx0 = p.x - 0.5, fy0 = p.y - 0.5;
    const ix = Math.floor(fx0), iy = Math.floor(fy0), fx = fx0 - ix, fy = fy0 - iy;
    let r = 0, g = 0, b = 0, al = 0;
    for (let k = 0; k < 4; k++) {
      const px = ix + (k & 1), py = iy + (k >> 1); if (px < 0 || py < 0 || px >= sw || py >= sh) continue;
      const wt = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy), j = (py * sw + px) * 4, aa = s[j + 3] * wt;
      r += s[j] * aa; g += s[j + 1] * aa; b += s[j + 2] * aa; al += aa;
    }
    if (al <= 0) continue;
    const q = (y * ow + x) * 4; o[q] = r / al; o[q + 1] = g / al; o[q + 2] = b / al; o[q + 3] = al;
  }
  const c = makeCanvas(ow, oh); c.getContext('2d')!.putImageData(out, 0, 0); return c;
}
