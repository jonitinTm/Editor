// Transformación libre (Ctrl+T): escalar, girar, voltear y mover la capa
// activa o el contenido seleccionado. Intro aplica, Esc cancela.

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import type { Viewport } from '../ui/viewport';
import { cloneCanvas, contentBounds, ctx2d, makeCanvas, Rect } from '../core/canvas';
import { GroupLayer, RasterLayer, TextLayer } from '../core/layers';
import { rasterizeLayer } from './paint';
import { h } from '../ui/dom';

interface TState { cx: number; cy: number; sx: number; sy: number; angle: number; }

interface Session {
  layer: RasterLayer;
  src: HTMLCanvasElement;      // píxeles a transformar, recortados a `rect`
  rect: Rect;                  // posición original de esos píxeles
  hole: HTMLCanvasElement;     // la capa sin esos píxeles
  selMask: HTMLCanvasElement | null; // selección original recortada a rect
  st: TState;
}

const rot = (x: number, y: number, a: number) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });

/** Prepara el contenido a transformar. */
function prepare(): Session | null {
  const doc = app.doc!;
  let layer = doc.active;
  if (!layer) { app.toast('No hay ninguna capa seleccionada', 'warn'); return null; }
  if (layer instanceof GroupLayer) { app.toast('Transformar grupos aún no está disponible: selecciona una capa', 'warn'); return null; }
  if (layer.isLocked()) { app.toast('La capa está bloqueada', 'warn'); return null; }
  if (layer instanceof TextLayer) layer = rasterizeLayer(layer);
  const l = layer as RasterLayer;
  const sel = doc.selection.mask;
  const pixels = cloneCanvas(l.canvas);
  if (sel) { const c = ctx2d(pixels); c.globalCompositeOperation = 'destination-in'; c.drawImage(sel, 0, 0); }
  const rect = contentBounds(pixels);
  if (!rect) { app.toast('No hay píxeles que transformar en la capa', 'warn'); return null; }
  const src = makeCanvas(rect.w, rect.h);
  ctx2d(src).drawImage(pixels, -rect.x, -rect.y);
  const hole = cloneCanvas(l.canvas);
  const hc = ctx2d(hole);
  if (sel) { hc.globalCompositeOperation = 'destination-out'; hc.drawImage(sel, 0, 0); }
  else hc.clearRect(0, 0, hole.width, hole.height);
  let selMask: HTMLCanvasElement | null = null;
  if (sel) { selMask = makeCanvas(rect.w, rect.h); ctx2d(selMask).drawImage(sel, -rect.x, -rect.y); }
  return { layer: l, src, rect, hole, selMask, st: { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, sx: 1, sy: 1, angle: 0 } };
}

function drawTransformed(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, st: TState) {
  ctx.save();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.translate(st.cx, st.cy); ctx.rotate(st.angle); ctx.scale(st.sx, st.sy);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  ctx.restore();
}

/** Aplica una sesión: pinta el resultado en la capa y transforma la selección. */
function applySession(s: Session, name: string) {
  const doc = app.doc!;
  doc.overrides.delete(s.layer);
  const out = s.hole;
  drawTransformed(ctx2d(out), s.src, s.st);
  s.layer.canvas = out; s.layer.touch();
  if (s.selMask) {
    const m = makeCanvas(doc.width, doc.height);
    drawTransformed(ctx2d(m), s.selMask, s.st);
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
  private fields: Record<string, HTMLInputElement> = {};

  activate() {
    this.s = prepare();
    if (!this.s) { setTimeout(() => app.restoreTool(), 0); return; }
    this.preview();
  }
  deactivate() { if (this.s) this.commit(); }
  docChanged() { if (this.s) { app.doc && app.doc.overrides.delete(this.s.layer); this.s = null; } setTimeout(() => app.tool === this && app.restoreTool(), 0); }

  extraOptions(bar: HTMLElement) {
    const num = (key: string, label: string, unit: string) => {
      const inp = h('input', { type: 'number', class: 'num', step: 'any' });
      inp.addEventListener('change', () => this.fromFields());
      this.fields[key] = inp;
      bar.append(h('label', { class: 'opt' }, h('span', { class: 'lbl' }, label), inp, h('span', { class: 'unit' }, unit)));
    };
    num('x', 'X', 'px'); num('y', 'Y', 'px'); num('w', 'An', '%'); num('h', 'Al', '%'); num('a', 'Ángulo', '°');
    bar.append(
      h('button', { class: 'btn icon-btn', title: 'Voltear horizontal', html: icon('flipH'), onclick: () => { if (this.s) { this.s.st.sx *= -1; this.preview(); } } }),
      h('button', { class: 'btn icon-btn', title: 'Voltear vertical', html: icon('flipV'), onclick: () => { if (this.s) { this.s.st.sy *= -1; this.preview(); } } }),
      h('button', { class: 'btn icon-btn ok', title: 'Aplicar (Intro)', html: icon('check'), onclick: () => { this.commit(); app.restoreTool(); } }),
      h('button', { class: 'btn icon-btn', title: 'Cancelar (Esc)', html: icon('close'), onclick: () => { this.cancel(); app.restoreTool(); } }),
    );
    this.syncFields();
  }
  private syncFields() {
    const s = this.s; if (!s || !this.fields.x) return;
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
    doc.overrides.set(s.layer, { canvas: s.hole, extra: ctx => drawTransformed(ctx, s.src, s.st) });
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
  hover(e: ToolEvent) {
    if (!this.s) return;
    const r = this.hit(e);
    this.cursor = r === 'move' ? 'move' : r === 'rotate' ? 'alias' : 'crosshair';
  }
  down(e: ToolEvent) {
    if (!this.s) return;
    const r = this.hit(e);
    const st0 = { ...this.s.st };
    if (r === 'move' || r === 'rotate') this.drag = { kind: r, hx: 0, hy: 0, start: { x: e.x, y: e.y }, st0 };
    else this.drag = { kind: 'scale', hx: r.hx, hy: r.hy, start: { x: e.x, y: e.y }, st0 };
    if (e.detail >= 2 && r === 'move') { this.commit(); app.restoreTool(); }
  }
  move(e: ToolEvent) {
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
  up() { this.drag = null; }

  commit() {
    const s = this.s; if (!s) return;
    this.s = null;
    const st = s.st;
    if (st.sx === 1 && st.sy === 1 && st.angle === 0 && st.cx === s.rect.x + s.rect.w / 2 && st.cy === s.rect.y + s.rect.h / 2) {
      app.doc!.overrides.delete(s.layer); app.doc!.invalidate(); return;
    }
    applySession(s, 'Transformación libre');
  }
  cancel() {
    const s = this.s; if (!s) return;
    this.s = null;
    app.doc!.overrides.delete(s.layer); app.doc!.invalidate(); app.viewport.requestRender();
  }
  key_(e: KeyboardEvent) {
    if (e.key === 'Enter') { this.commit(); app.restoreTool(); return true; }
    if (e.key === 'Escape') { this.cancel(); app.restoreTool(); return true; }
    return false;
  }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (!this.s) return;
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
