// Herramientas de selección: marco rectangular, marco elíptico, lazo y varita.

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import type { Viewport } from '../ui/viewport';
import { SelMode } from '../core/selection';
import { floodMask } from './floodfill';
import { getPixels, makeCanvas, ctx2d } from '../core/canvas';
import { isRaster } from '../core/layers';
import { snapPoint, clearSnap } from './snap';

/** Modo según la opción y las teclas (Mayús = añadir, Alt = restar, ambas = intersecar). */
function selMode(toolId: string, e: ToolEvent): SelMode {
  if (e.shift && e.alt) return 'intersect';
  if (e.shift) return 'add';
  if (e.alt) return 'subtract';
  return app.opt('mode', toolId) ?? 'new';
}

const MODE_OPT = { key: 'mode', type: 'selmode', default: 'new' } as const;
const FEATHER_OPT = { key: 'feather', label: 'Calar', type: 'range', min: 0, max: 250, default: 0, unit: 'px' } as const;

/** Mueve el contorno de la selección (arrastrando dentro de ella). */
class SelectionMover {
  start: { x: number; y: number } | null = null;
  offset = { x: 0, y: 0 };
  begin(e: ToolEvent) {
    const doc = app.doc!;
    const m = doc.selection.mask;
    if (!m) return false;
    const x = Math.floor(e.x), y = Math.floor(e.y);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return false;
    const a = ctx2d(m).getImageData(x, y, 1, 1).data[3];
    if (a < 128) return false;
    this.start = { x: e.x, y: e.y };
    return true;
  }
  move(e: ToolEvent) {
    if (!this.start) return;
    this.offset = { x: Math.round(e.x - this.start.x), y: Math.round(e.y - this.start.y) };
    (app.doc as any).selectionOffset = this.offset;
  }
  end() {
    if (!this.start) return;
    const doc = app.doc!;
    (doc as any).selectionOffset = null;
    this.start = null;
    if (this.offset.x || this.offset.y) {
      const c = makeCanvas(doc.width, doc.height);
      ctx2d(c).drawImage(doc.selection.mask!, this.offset.x, this.offset.y);
      doc.selection.setMask(c);
      doc.commit('Mover selección');
    }
    this.offset = { x: 0, y: 0 };
  }
}

abstract class DragSelectTool implements Tool {
  abstract id: string; abstract name: string; abstract icon: string;
  key = 'M'; group = 'marquee'; cursor = 'crosshair';
  options = [MODE_OPT, FEATHER_OPT,
    { key: 'style', label: 'Estilo', type: 'select', default: 'normal', choices: [{ value: 'normal', label: 'Normal' }, { value: 'ratio', label: 'Proporción fija' }, { value: 'size', label: 'Tamaño fijo' }] },
    { key: 'fw', label: 'An.', type: 'number', min: 1, max: 30000, default: 1, title: 'Anchura (proporción o píxeles)' },
    { key: 'fh', label: 'Al.', type: 'number', min: 1, max: 30000, default: 1, title: 'Altura (proporción o píxeles)' }] as any[];
  protected a: { x: number; y: number } | null = null;
  protected b: { x: number; y: number } | null = null;
  protected mode: SelMode = 'new';
  private fromCenter = false; private square = false;
  private mover = new SelectionMover();

  down(e: ToolEvent) {
    this.mode = selMode(this.id, e);
    if (this.mode === 'new' && !e.shift && !e.alt && this.mover.begin(e)) return;
    const p = snapPoint(e.x, e.y);
    this.a = { x: Math.round(p.x), y: Math.round(p.y) }; this.b = { ...this.a };
  }
  move(e: ToolEvent) {
    if (this.mover.start) { this.mover.move(e); return; }
    if (!this.a) return;
    const p = snapPoint(e.x, e.y);
    this.b = { x: Math.round(p.x), y: Math.round(p.y) };
    // Tras empezar, Mayús fuerza proporción y Alt dibuja desde el centro
    this.square = e.shift && this.mode !== 'add' ? true : e.shift && this.mode === 'add' && false;
    this.square = e.shift; this.fromCenter = e.alt && this.mode !== 'subtract';
  }
  protected rect() {
    const a = this.a!, b = this.b!;
    let w = b.x - a.x, h = b.y - a.y;
    const st = app.opt<string>('style', this.id), fw = Math.max(1, app.opt<number>('fw', this.id) || 1), fh = Math.max(1, app.opt<number>('fh', this.id) || 1);
    if (st === 'size') { w = fw * (w < 0 ? -1 : 1); h = fh * (h < 0 ? -1 : 1); }
    else if (st === 'ratio') { const s = Math.max(Math.abs(w) / fw, Math.abs(h) / fh); w = Math.sign(w || 1) * Math.round(s * fw); h = Math.sign(h || 1) * Math.round(s * fh); }
    else if (this.square && this.mode === 'new') { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
    let x = a.x, y = a.y;
    if (this.fromCenter && this.mode === 'new') { x = a.x - w; y = a.y - h; w *= 2; h *= 2; }
    if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
    return { x, y, w, h };
  }
  protected abstract apply(r: { x: number; y: number; w: number; h: number }): void;
  up() {
    clearSnap();
    if (this.mover.start) { this.mover.end(); return; }
    if (!this.a) return;
    const doc = app.doc!;
    const r = this.rect();
    this.a = this.b = null;
    if (r.w < 1 || r.h < 1) {
      if (this.mode === 'new' && doc.selection.active) { doc.selection.clear(); doc.commit('Deseleccionar'); }
      return;
    }
    this.apply(r);
    const f = app.opt<number>('feather', this.id);
    if (f > 0) doc.selection.feather(f / 2);
    doc.commit(this.name);
  }
  cancel() { this.a = this.b = null; }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (!this.a || !this.b) return;
    const r = this.rect();
    const p = vp.toScreen(r.x, r.y);
    const path = new Path2D();
    this.shape(path, r);
    vp.drawAnts(path);
    ctx.fillStyle = '#ddd'; ctx.font = '11px system-ui';
    ctx.fillText(`${r.w} × ${r.h}`, p.x + 4, p.y - 6);
  }
  protected abstract shape(p: Path2D, r: { x: number; y: number; w: number; h: number }): void;
}

export class RectSelectTool extends DragSelectTool {
  id = 'marqueeRect'; name = 'Marco rectangular'; icon = icon('marqueeRect');
  protected apply(r: any) { app.doc!.selection.rect(r, this.mode); }
  protected shape(p: Path2D, r: any) { p.rect(r.x, r.y, r.w, r.h); }
}
export class EllipseSelectTool extends DragSelectTool {
  id = 'marqueeEllipse'; name = 'Marco elíptico'; icon = icon('marqueeEllipse');
  protected apply(r: any) { app.doc!.selection.ellipse(r, this.mode); }
  protected shape(p: Path2D, r: any) { p.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); }
}

/** Marco de fila única / columna única: un clic selecciona una línea de 1 píxel de alto (o ancho) en toda la imagen. */
abstract class SingleLineSelectTool implements Tool {
  abstract id: string; abstract name: string; abstract icon: string; protected abstract vertical: boolean;
  key = 'M'; group = 'marquee'; cursor = 'crosshair';
  options = [MODE_OPT] as any[];
  private p: { x: number; y: number } | null = null;
  private r(p: { x: number; y: number }) { const d = app.doc!; return this.vertical ? { x: Math.floor(p.x), y: 0, w: 1, h: d.height } : { x: 0, y: Math.floor(p.y), w: d.width, h: 1 }; }
  down(e: ToolEvent) { this.p = { x: e.x, y: e.y }; app.viewport.requestRender(); }
  move(e: ToolEvent) { if (this.p) { this.p = { x: e.x, y: e.y }; app.viewport.requestRender(); } }
  up(e: ToolEvent) {
    if (!this.p) return; this.p = null; const d = app.doc!;
    d.selection.rect(this.r({ x: e.x, y: e.y }), selMode(this.id, e)); d.commit(this.name);
  }
  cancel() { this.p = null; }
  drawOverlay(_ctx: CanvasRenderingContext2D, vp: Viewport) { if (!this.p) return; const r = this.r(this.p), path = new Path2D(); path.rect(r.x, r.y, r.w, r.h); vp.drawAnts(path); }
}
export class SingleRowSelectTool extends SingleLineSelectTool { id = 'marqueeRow'; name = 'Marco de fila única'; icon = icon('marqueeRow'); protected vertical = false; }
export class SingleColSelectTool extends SingleLineSelectTool { id = 'marqueeCol'; name = 'Marco de columna única'; icon = icon('marqueeCol'); protected vertical = true; }

export class LassoTool implements Tool {
  id = 'lasso'; name = 'Lazo'; icon = icon('lasso'); key = 'L'; group = 'lasso'; cursor = 'crosshair';
  options = [MODE_OPT, FEATHER_OPT] as any[];
  private pts: { x: number; y: number }[] = [];
  private mode: SelMode = 'new';
  private mover = new SelectionMover();
  down(e: ToolEvent) {
    this.mode = selMode(this.id, e);
    if (this.mode === 'new' && this.mover.begin(e)) return;
    this.pts = [{ x: e.x, y: e.y }];
  }
  move(e: ToolEvent) {
    if (this.mover.start) { this.mover.move(e); return; }
    if (!this.pts.length) return;
    const l = this.pts[this.pts.length - 1];
    if (Math.hypot(e.x - l.x, e.y - l.y) * app.viewport.zoom > 1.5) this.pts.push({ x: e.x, y: e.y });
  }
  up() {
    if (this.mover.start) { this.mover.end(); return; }
    const doc = app.doc!;
    const pts = this.pts; this.pts = [];
    if (pts.length < 3) {
      if (this.mode === 'new' && doc.selection.active) { doc.selection.clear(); doc.commit('Deseleccionar'); }
      return;
    }
    doc.selection.polygon(pts, this.mode);
    const f = app.opt<number>('feather', this.id);
    if (f > 0) doc.selection.feather(f / 2);
    doc.commit('Lazo');
  }
  cancel() { this.pts = []; }
  drawOverlay(_ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (this.pts.length < 2) return;
    const p = new Path2D();
    this.pts.forEach((q, i) => i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y));
    vp.drawAnts(p);
  }
}

/** Lazo poligonal: cada clic añade un vértice; doble clic, Intro o clic en el inicio cierran. */
export class PolyLassoTool implements Tool {
  id = 'polyLasso'; name = 'Lazo poligonal'; icon = icon('polyLasso'); key = 'L'; group = 'lasso'; cursor = 'crosshair';
  options = [MODE_OPT, FEATHER_OPT] as any[];
  private pts: { x: number; y: number }[] = [];
  private mode: SelMode = 'new';
  down(e: ToolEvent) {
    if (!this.pts.length) this.mode = selMode(this.id, e);
    else {
      const f = app.viewport.toScreen(this.pts[0].x, this.pts[0].y);
      if (e.detail >= 2 || (this.pts.length > 2 && Math.hypot(f.x - e.sx, f.y - e.sy) < 8)) { this.close(); return; }
    }
    let x = e.x, y = e.y;
    if (e.shift && this.pts.length) { const l = this.pts[this.pts.length - 1], a = Math.round(Math.atan2(y - l.y, x - l.x) / (Math.PI / 4)) * Math.PI / 4, d = Math.hypot(x - l.x, y - l.y); x = l.x + Math.cos(a) * d; y = l.y + Math.sin(a) * d; }
    this.pts.push({ x, y });
  }
  private close() {
    const doc = app.doc!, pts = this.pts; this.pts = [];
    if (pts.length < 3) return;
    doc.selection.polygon(pts, this.mode);
    const f = app.opt<number>('feather', this.id); if (f > 0) doc.selection.feather(f / 2);
    doc.commit('Lazo poligonal');
  }
  cancel() { this.pts = []; app.viewport?.requestRender(); }
  deactivate() { this.pts = []; }
  key_(e: KeyboardEvent) {
    if (!this.pts.length) return false;
    if (e.key === 'Enter') { this.close(); return true; }
    if (e.key === 'Escape') { this.cancel(); return true; }
    if (e.key === 'Backspace' || e.key === 'Delete') { this.pts.pop(); app.viewport.requestRender(); return true; }
    return false;
  }
  drawOverlay(_ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (!this.pts.length) return;
    const p = new Path2D();
    this.pts.forEach((q, i) => i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y));
    if (vp.mouse) p.lineTo(vp.mouse.x, vp.mouse.y);
    vp.drawAnts(p);
  }
}

export class WandTool implements Tool {
  id = 'wand'; name = 'Varita mágica'; icon = icon('wand'); key = 'W'; group = 'wand'; cursor = 'crosshair';
  options = [MODE_OPT,
    { key: 'tolerance', label: 'Tolerancia', type: 'range', min: 0, max: 255, default: 32 },
    { key: 'contiguous', label: 'Contiguo', type: 'checkbox', default: true },
    { key: 'all', label: 'Todas las capas', type: 'checkbox', default: false },
    { key: 'sample', label: 'Muestra', type: 'select', default: '1', choices: [{ value: '1', label: 'Punto' }, { value: '3', label: 'Media 3×3' }, { value: '5', label: 'Media 5×5' }, { value: '11', label: 'Media 11×11' }] },
    { key: 'antialias', label: 'Suavizar', type: 'checkbox', default: true },
  ] as any[];
  extraOptions(bar: HTMLElement) { const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Seleccionar sujeto'; b.onclick = () => import('../ui/ops').then(o => o.selectSubjectOp()); bar.append(b); }
  down(e: ToolEvent) {
    const doc = app.doc!;
    const mode = selMode(this.id, e);
    const layer = doc.active;
    const src = app.opt('all', this.id) || !isRaster(layer) ? doc.flatten() : layer.canvas;
    const px = getPixels(src), n = parseInt(app.opt('sample', this.id)) || 1;
    const sx = Math.floor(e.x), sy = Math.floor(e.y);
    if (n > 1 && sx >= 0 && sy >= 0 && sx < px.width && sy < px.height) {
      // el color de referencia es la media de la zona, no solo el píxel
      const acc = [0, 0, 0, 0]; let k = 0;
      for (let y = Math.max(0, sy - (n >> 1)); y <= Math.min(px.height - 1, sy + (n >> 1)); y++) for (let x = Math.max(0, sx - (n >> 1)); x <= Math.min(px.width - 1, sx + (n >> 1)); x++) { const i = (y * px.width + x) * 4; for (let c = 0; c < 4; c++) acc[c] += px.data[i + c]; k++; }
      const i = (sy * px.width + sx) * 4; for (let c = 0; c < 4; c++) px.data[i + c] = acc[c] / k;
    }
    const res = floodMask(px, e.x, e.y, app.opt('tolerance', this.id), app.opt('contiguous', this.id));
    if (!res) { if (mode === 'new') { doc.selection.clear(); doc.commit('Deseleccionar'); } return; }
    let m = res.canvas;
    if (app.opt('antialias', this.id) !== false) {
      // bordes suavizados: los píxeles de fuera que tocan el borde quedan a medias (según cuántos vecinos estén dentro)
      const c = makeCanvas(m.width, m.height), x = ctx2d(c), W = m.width, H = m.height;
      const md = ctx2d(m).getImageData(0, 0, W, H), d = x.createImageData(W, H), A = md.data, O = d.data;
      for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
        const i = (y * W + xx) * 4; if (A[i + 3] >= 128) { O[i + 3] = 255; continue; }
        let n = 0; if (xx > 0 && A[i - 1] >= 128) n++; if (xx < W - 1 && A[i + 7] >= 128) n++; if (y > 0 && A[i - W * 4 + 3] >= 128) n++; if (y < H - 1 && A[i + W * 4 + 3] >= 128) n++;
        O[i + 3] = n ? Math.min(160, 64 * n) : 0;
      }
      x.putImageData(d, 0, 0); m = c;
    }
    doc.selection.combineCanvas(mode, m);
    doc.commit('Varita mágica');
  }
}
