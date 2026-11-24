// Herramienta Forma: rectángulo, elipse, polígono, estrella, línea, flecha…
// Por defecto se dibuja en la capa actual (como el pincel); si se elige, va en una capa de forma nueva, editable desde
// Propiedades.

import { shapeD } from '../core/customshapes';
import { CUSTOM_SHAPES } from '../core/customshapes';
import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import { ShapeLayer, ShapeProps, GroupLayer, RasterLayer, isRaster, isParametric, type PathPoint } from '../core/layers';
import { h } from '../ui/dom';
import { ctx2d, cloneCanvas, makeCanvas, rectUnion, type Rect } from '../core/canvas';
import { getPaintTarget, setPreview, clipMask, editInPlace, type PaintTarget } from './paint';
import type { Viewport } from '../ui/viewport';

export class ShapeTool implements Tool {
  id = 'shape'; name = 'Forma'; icon = icon('shape'); key = 'U'; cursor = 'crosshair';
  options = [
    { key: 'target', label: 'Dibujar', type: 'select', default: 'pixels', choices: [{ value: 'pixels', label: 'En la capa actual' }, { value: 'layer', label: 'En una capa de forma nueva' }] },
    { key: 'shape', label: 'Forma', type: 'select', default: 'rect', choices: [
      { value: 'rect', label: 'Rectángulo' },
      { value: 'ellipse', label: 'Elipse' }, { value: 'polygon', label: 'Polígono' }, { value: 'star', label: 'Estrella' },
      { value: 'line', label: 'Línea' }, { value: 'arrow', label: 'Flecha' }, { value: 'heart', label: 'Corazón' },
      ...CUSTOM_SHAPES.map(([id, n]) => ({ value: 'custom:' + id, label: n }))] },
    { key: 'sides', label: 'Lados', type: 'range', min: 3, max: 40, default: 5 },
    { key: 'inner', label: 'Sangría', type: 'range', min: 5, max: 95, default: 45, unit: '%' },
    { key: 'fill', label: 'Relleno (color frontal)', type: 'checkbox', default: true },
    { key: 'stroke', label: 'Trazo', type: 'checkbox', default: false },
    { key: 'strokeColor', type: 'color', default: '#000000' },
    { key: 'strokeWidth', label: 'Grosor', type: 'range', min: 1, max: 200, default: 4, unit: 'px' },
    { key: 'pathOp', label: 'Operación', type: 'select', default: 'new', choices: [{ value: 'new', label: 'Forma nueva' }, { value: 'unite', label: 'Combinar con la forma' }, { value: 'subtract', label: 'Restar de la forma' }, { value: 'intersect', label: 'Intersecar con la forma' }, { value: 'exclude', label: 'Excluir solapamiento' }] },
    { key: 'dash', label: 'Línea', type: 'select', default: 'solid', choices: [{ value: 'solid', label: 'Continua' }, { value: 'dash', label: 'Discontinua' }, { value: 'dot', label: 'Punteada' }, { value: 'dashdot', label: 'Raya y punto' }] },
    { key: 'corner', label: 'Redondear esquinas', type: 'range', min: 0, max: 500, default: 0, unit: 'px' },
  ] as any[];
  private a: { x: number; y: number } | null = null;
  private layer: ShapeLayer | null = null;
  private prev: any = null;
  /** Dibujo en la capa actual: dónde, la última zona dibujada y (en máscaras) la copia de antes. */
  private pix: { t: PaintTarget; box: Rect | null; tmp: HTMLCanvasElement | null; orig: HTMLCanvasElement | null; view: HTMLCanvasElement | null } | null = null;

  private makeShape(x: number, y: number, w: number, h: number) {
    const opt = app.opt<string>('shape', this.id), custom = opt.startsWith('custom:') ? opt.slice(7) : undefined;
    let shape = (custom ? 'custom' : opt === 'round' ? 'rect' : opt) as ShapeProps['shape'];
    const corner = Math.max(0, +(app.opt<number>('corner', this.id) ?? 0) || 0);
    // rectángulo con esquinas redondeadas = «rectángulo redondeado» (así se exporta igual a PSD y SVG)
    if (shape === 'rect' && corner > 0) shape = 'round';
    return new ShapeLayer('Forma', w, h, {
      shape, custom, customD: custom?.startsWith('u') ? shapeD(custom) : undefined, x0: x, y0: y, x1: x, y1: y,
      fill: shape === 'line' ? null : app.opt('fill', this.id) ? app.fg : null,
      stroke: shape === 'line' ? app.fg : app.opt('stroke', this.id) ? app.opt('strokeColor', this.id) : null,
      strokeWidth: app.opt('strokeWidth', this.id), radius: corner, corner: corner || undefined, dash: app.opt('dash', this.id) || 'solid',
      sides: app.opt('sides', this.id), inner: app.opt<number>('inner', this.id) / 100,
    });
  }

  down(e: ToolEvent) {
    const doc = app.doc!;
    this.a = { x: e.x, y: e.y }; this.prev = doc.active; this.pix = null;
    if (app.opt('target', this.id) !== 'layer') {
      // en la capa actual: solo si es de píxeles (o su máscara); una capa de texto, forma u objeto inteligente no se
      // rasteriza por sorpresa: la forma va entonces en su propia capa
      const a = doc.active, t = pixelTargetForShapes(), pixelsOk = !!t || doc.quickMask || (a && ((doc.editMask && a.mask) || (isRaster(a) && !isParametric(a))));
      if (t) {
        this.layer = this.makeShape(e.x, e.y, doc.width, doc.height);
        this.pix = { t, box: null, tmp: null, orig: null, view: null };
        if (t.isMask || t.quick) { this.pix.orig = cloneCanvas(t.canvas); this.pix.view = cloneCanvas(t.canvas); setPreview(t, this.pix.view); }
        else doc.overrides.set(t.layer, { extra: ctx => { const P = this.pix; if (P?.tmp && P.box) { ctx.save(); if (P.t.lockAlpha) ctx.globalCompositeOperation = 'source-atop'; ctx.drawImage(P.tmp, P.box.x, P.box.y); ctx.restore(); } } });
        return;
      }
      if (pixelsOk) { this.a = null; return; } // capa bloqueada u oculta: ya se ha avisado
      if (a) app.toast('La capa actual no es de píxeles: la forma va en una capa de forma nueva');
    }
    this.layer = this.makeShape(e.x, e.y, doc.width, doc.height);
    let n = 1; const names = new Set(doc.allLayers().map(l => l.name));
    while (names.has(`Forma ${n}`)) n++;
    this.layer.name = `Forma ${n}`;
    doc.insertAboveActive(this.layer);
  }
  /** Zona que ocupa la forma (con margen para el trazo y la punta de la flecha), recortada al documento. */
  private shapeBox(): Rect | null {
    const p = this.layer!.props, d = app.doc!;
    const L = Math.hypot(p.x1 - p.x0, p.y1 - p.y0), pad = Math.ceil((p.stroke || p.shape === 'line' ? p.strokeWidth * 2 : 0) + (p.shape === 'arrow' ? L * 0.2 + p.strokeWidth * 3 : 0) + 4);
    const x0 = Math.max(0, Math.floor(Math.min(p.x0, p.x1) - pad)), y0 = Math.max(0, Math.floor(Math.min(p.y0, p.y1) - pad));
    const x1 = Math.min(d.width, Math.ceil(Math.max(p.x0, p.x1) + pad)), y1 = Math.min(d.height, Math.ceil(Math.max(p.y0, p.y1) + pad));
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }
  /** La forma tal como queda en la capa (recortada a la selección; en máscaras, en gris según el color frontal). */
  private pixelsOf(r: Rect): HTMLCanvasElement {
    const P = this.pix!, d = app.doc!, tmp = makeCanvas(r.w, r.h), x = ctx2d(tmp);
    x.drawImage(this.layer!.canvas, -r.x, -r.y);
    const sel = clipMask(P.t);
    if (sel) { x.globalCompositeOperation = 'destination-in'; x.drawImage(sel, -r.x, -r.y); }
    if (P.t.isMask) { const n = parseInt(app.fg.slice(1), 16), g = Math.round(0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)); x.globalCompositeOperation = 'source-in'; x.fillStyle = P.t.quick ? '#fff' : `rgb(${g},${g},${g})`; x.fillRect(0, 0, r.w, r.h); }
    void d;
    return tmp;
  }
  move(e: ToolEvent) {
    if (!this.a || !this.layer) return;
    const p = this.layer.props;
    let x0 = this.a.x, y0 = this.a.y, x1 = e.x, y1 = e.y;
    if (e.shift) {
      if (p.shape === 'line' || p.shape === 'arrow') {
        const ang = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) * Math.PI / 4, d = Math.hypot(x1 - x0, y1 - y0);
        x1 = x0 + Math.cos(ang) * d; y1 = y0 + Math.sin(ang) * d;
      } else { const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); x1 = x0 + Math.sign(x1 - x0 || 1) * s; y1 = y0 + Math.sign(y1 - y0 || 1) * s; }
    }
    if (e.alt && p.shape !== 'line' && p.shape !== 'arrow') { x0 = 2 * this.a.x - x1; y0 = 2 * this.a.y - y1; }
    Object.assign(p, { x0, y0, x1, y1 });
    this.layer.render();
    const P = this.pix;
    if (!P) { app.doc!.invalidate(); return; }
    // vista previa en la capa actual: solo se recompone la zona antigua y la nueva
    const old = P.box, box = this.shapeBox();
    if (P.view && P.orig) {
      const v = ctx2d(P.view);
      if (old) { v.save(); v.globalCompositeOperation = 'copy'; v.beginPath(); v.rect(old.x, old.y, old.w, old.h); v.clip(); v.drawImage(P.orig, 0, 0); v.restore(); }
      if (box) v.drawImage(this.pixelsOf(box), box.x, box.y);
      P.box = box;
    } else { P.box = box; P.tmp = box ? this.pixelsOf(box) : null; }
    const u = old && box ? rectUnion(old, box) : old ?? box;
    if (u) app.doc!.invalidate(u);
  }
  up(e: ToolEvent) {
    if (!this.a || !this.layer) return;
    const doc = app.doc!;
    const tiny = Math.hypot(e.x - this.a.x, e.y - this.a.y) * app.viewport.zoom < 3;
    const P = this.pix;
    if (P) {
      this.endPreview();
      const box = this.shapeBox();
      if (!tiny && box) {
        const tmp = this.pixelsOf(box);
        const z = editInPlace(P.t, box, c => { if (P.t.lockAlpha) c.globalCompositeOperation = 'source-atop'; c.drawImage(tmp, box.x, box.y); });
        doc.commit('Forma', z);
      } else if (P.box) doc.invalidate(P.box);
      this.a = null; this.layer = null; this.prev = null; this.pix = null;
      return;
    }
    const op = app.opt<string>('pathOp', this.id) || 'new', prev = this.prev, nl = this.layer;
    const combinable = prev && prev !== nl && (prev instanceof ShapeLayer || (prev.kind === 'adjust' && prev.vmask)) && nl.props.shape !== 'line';
    if (tiny) { this.layer.parent?.remove(this.layer); doc.setActive(doc.allLayers().pop() ?? null); doc.invalidate(); }
    else if (op !== 'new' && combinable) {
      // se combina con la forma que estaba seleccionada: el resultado es una sola forma vectorial
      doc.selectedIds = new Set([prev.id, nl.id]); doc.active = nl;
      import('../ui/ops').then(o => o.combineShapes(op as any));
    } else doc.commit('Forma');
    this.a = null; this.layer = null; this.prev = null;
  }
  private endPreview() {
    const P = this.pix, d = app.doc; if (!P || !d) return;
    if (P.view) setPreview(P.t, null); else d.overrides.delete(P.t.layer);
  }
  cancel() {
    if (this.pix) { this.endPreview(); app.doc?.invalidate(this.pix.box ?? undefined); this.pix = null; }
    else if (this.layer) { this.layer.parent?.remove(this.layer); app.doc?.invalidate(); }
    this.a = null; this.layer = null;
  }
}

/** ¿Se puede dibujar en la capa actual (píxeles o su máscara) sin rasterizar nada? Devuelve dónde, o null. */
export function pixelTargetForShapes(): PaintTarget | null {
  const doc = app.doc!, a = doc.active;
  const ok = doc.quickMask || (a && ((doc.editMask && a.mask) || (isRaster(a) && !isParametric(a))));
  return ok ? getPaintTarget() : null;
}
/** Pinta una forma (capa temporal, sin añadir) en la capa actual, en la zona `box`. */
export function stampShape(t: PaintTarget, shape: ShapeLayer, box: Rect, name: string) {
  const d = app.doc!, tmp = makeCanvas(box.w, box.h), x = ctx2d(tmp);
  x.drawImage(shape.canvas, -box.x, -box.y);
  const sel = clipMask(t);
  if (sel) { x.globalCompositeOperation = 'destination-in'; x.drawImage(sel, -box.x, -box.y); }
  if (t.isMask) { const n = parseInt(app.fg.slice(1), 16), g = Math.round(0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)); x.globalCompositeOperation = 'source-in'; x.fillStyle = t.quick ? '#fff' : `rgb(${g},${g},${g})`; x.fillRect(0, 0, box.w, box.h); }
  const z = editInPlace(t, box, c => { if (t.lockAlpha) c.globalCompositeOperation = 'source-atop'; c.drawImage(tmp, box.x, box.y); });
  d.commit(name, z);
}

/** Marco: dibuja un hueco (rectangular o elíptico) donde luego se colocan imágenes, que se recortan a su forma. */
export class FrameTool implements Tool {
  id = 'frame'; name = 'Marco'; icon = icon('frame'); key = 'K'; cursor = 'crosshair';
  options = [{ key: 'shape', label: 'Forma', type: 'select', default: 'rect', choices: [{ value: 'rect', label: 'Rectángulo' }, { value: 'ellipse', label: 'Elipse' }] }] as any[];
  private a: { x: number; y: number } | null = null; private b: { x: number; y: number } | null = null;
  extraOptions(bar: HTMLElement) { bar.append(h('span', { class: 'hint' }, 'Arrastra para crear un marco. Después, con el marco seleccionado, arrastra una imagen o usa Archivo › Colocar: se ajusta dentro.')); }
  down(e: ToolEvent) { this.a = { x: e.x, y: e.y }; this.b = { ...this.a }; }
  move(e: ToolEvent) { if (!this.a) return; this.b = { x: e.x, y: e.y }; if (e.shift) { const s = Math.max(Math.abs(this.b.x - this.a.x), Math.abs(this.b.y - this.a.y)); this.b = { x: this.a.x + Math.sign(this.b.x - this.a.x || 1) * s, y: this.a.y + Math.sign(this.b.y - this.a.y || 1) * s }; } app.viewport.requestRender(); }
  up() {
    const a = this.a, b = this.b; this.a = this.b = null; if (!a || !b) return;
    const x0 = Math.round(Math.min(a.x, b.x)), y0 = Math.round(Math.min(a.y, b.y)), x1 = Math.round(Math.max(a.x, b.x)), y1 = Math.round(Math.max(a.y, b.y));
    if (x1 - x0 < 4 || y1 - y0 < 4) { app.viewport.requestRender(); return; }
    createFrame(app.opt('shape', this.id) === 'ellipse' ? 'ellipse' : 'rect', { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (!this.a || !this.b) return;
    const p = vp.toScreen(Math.min(this.a.x, this.b.x), Math.min(this.a.y, this.b.y)), q = vp.toScreen(Math.max(this.a.x, this.b.x), Math.max(this.a.y, this.b.y));
    ctx.save(); ctx.strokeStyle = '#3d8bfd'; ctx.lineWidth = 1.5; ctx.beginPath();
    if (app.opt('shape', this.id) === 'ellipse') ctx.ellipse((p.x + q.x) / 2, (p.y + q.y) / 2, (q.x - p.x) / 2, (q.y - p.y) / 2, 0, 0, 7); else ctx.rect(p.x, p.y, q.x - p.x, q.y - p.y);
    ctx.stroke(); ctx.restore();
  }
}

/** Puntos Bézier de un rectángulo o una elipse (para la máscara vectorial del marco). */
function framePath(kind: 'rect' | 'ellipse', r: { x: number; y: number; w: number; h: number }): PathPoint[] {
  if (kind === 'rect') return [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(([x, y]) => ({ x, y, ix: x, iy: y, ox: x, oy: y }));
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2, ry = r.h / 2, k = 0.5523;
  return [
    { x: cx, y: cy - ry, ix: cx - rx * k, iy: cy - ry, ox: cx + rx * k, oy: cy - ry },
    { x: cx + rx, y: cy, ix: cx + rx, iy: cy - ry * k, ox: cx + rx, oy: cy + ry * k },
    { x: cx, y: cy + ry, ix: cx + rx * k, iy: cy + ry, ox: cx - rx * k, oy: cy + ry },
    { x: cx - rx, y: cy, ix: cx - rx, iy: cy + ry * k, ox: cx - rx, oy: cy - ry * k },
  ];
}

export function createFrame(kind: 'rect' | 'ellipse', r: { x: number; y: number; w: number; h: number }) {
  const d = app.doc; if (!d) return;
  let n = 1; const names = new Set(d.allLayers().map(l => l.name)); while (names.has(`Marco ${n}`)) n++;
  const g = new GroupLayer(`Marco ${n}`); g.frame = true;
  g.vmask = { subpaths: [{ closed: true, pts: framePath(kind, r) }], enabled: true };
  // relleno provisional (gris con una cruz) hasta que se coloque una imagen
  const ph = new RasterLayer('Vacío', d.width, d.height), x = ctx2d(ph.canvas);
  x.fillStyle = '#d9dce1'; x.fillRect(r.x, r.y, r.w, r.h);
  x.strokeStyle = '#9aa0a8'; x.lineWidth = Math.max(1, Math.min(r.w, r.h) / 120); x.beginPath(); x.moveTo(r.x, r.y); x.lineTo(r.x + r.w, r.y + r.h); x.moveTo(r.x + r.w, r.y); x.lineTo(r.x, r.y + r.h); x.stroke();
  ph.touch(); (ph as any).framePlaceholder = true;
  g.add(ph);
  d.insertAboveActive(g); d.setActive(g, false);
  d.commit('Crear marco');
}

/** Si la capa activa es un marco (o está dentro de uno), devuelve el marco. */
export function activeFrame(): GroupLayer | null {
  let l = app.doc?.active ?? null;
  while (l) { if (l instanceof GroupLayer && l.frame) return l; l = l.parent; }
  return null;
}
