// Herramienta Forma: rectángulo, rectángulo redondeado, elipse y línea.
// Cada forma se crea en una capa vectorial nueva, editable desde Propiedades.

import { CUSTOM_SHAPES } from '../core/customshapes';
import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import { ShapeLayer, ShapeProps, GroupLayer, RasterLayer, type PathPoint } from '../core/layers';
import { h } from '../ui/dom';
import { ctx2d } from '../core/canvas';
import type { Viewport } from '../ui/viewport';

export class ShapeTool implements Tool {
  id = 'shape'; name = 'Forma'; icon = icon('shape'); key = 'U'; cursor = 'crosshair';
  options = [
    { key: 'shape', label: 'Forma', type: 'select', default: 'rect', choices: [
      { value: 'rect', label: 'Rectángulo' }, { value: 'round', label: 'Rect. redondeado' },
      { value: 'ellipse', label: 'Elipse' }, { value: 'polygon', label: 'Polígono' }, { value: 'star', label: 'Estrella' },
      { value: 'line', label: 'Línea' }, { value: 'arrow', label: 'Flecha' }, { value: 'heart', label: 'Corazón' },
      ...CUSTOM_SHAPES.map(([id, n]) => ({ value: 'custom:' + id, label: n }))] },
    { key: 'sides', label: 'Lados', type: 'range', min: 3, max: 40, default: 5 },
    { key: 'inner', label: 'Sangría', type: 'range', min: 5, max: 95, default: 45, unit: '%' },
    { key: 'fill', label: 'Relleno (color frontal)', type: 'checkbox', default: true },
    { key: 'stroke', label: 'Trazo', type: 'checkbox', default: false },
    { key: 'strokeColor', type: 'color', default: '#000000' },
    { key: 'strokeWidth', label: 'Grosor', type: 'range', min: 1, max: 200, default: 4, unit: 'px' },
    { key: 'dash', label: 'Línea', type: 'select', default: 'solid', choices: [{ value: 'solid', label: 'Continua' }, { value: 'dash', label: 'Discontinua' }, { value: 'dot', label: 'Punteada' }, { value: 'dashdot', label: 'Raya y punto' }] },
    { key: 'radius', label: 'Radio', type: 'range', min: 0, max: 500, default: 20, unit: 'px' },
  ] as any[];
  private a: { x: number; y: number } | null = null;
  private layer: ShapeLayer | null = null;

  down(e: ToolEvent) {
    const doc = app.doc!;
    this.a = { x: e.x, y: e.y };
    const opt = app.opt<string>('shape', this.id), custom = opt.startsWith('custom:') ? opt.slice(7) : undefined;
    const shape = (custom ? 'custom' : opt) as ShapeProps['shape'];
    this.layer = new ShapeLayer('Forma', doc.width, doc.height, {
      shape, custom, x0: e.x, y0: e.y, x1: e.x, y1: e.y,
      fill: shape === 'line' ? null : app.opt('fill', this.id) ? app.fg : null,
      stroke: shape === 'line' ? app.fg : app.opt('stroke', this.id) ? app.opt('strokeColor', this.id) : null,
      strokeWidth: app.opt('strokeWidth', this.id), radius: app.opt('radius', this.id), dash: app.opt('dash', this.id) || 'solid',
      sides: app.opt('sides', this.id), inner: app.opt<number>('inner', this.id) / 100,
    });
    let n = 1; const names = new Set(doc.allLayers().map(l => l.name));
    while (names.has(`Forma ${n}`)) n++;
    this.layer.name = `Forma ${n}`;
    doc.insertAboveActive(this.layer);
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
    app.doc!.invalidate();
  }
  up(e: ToolEvent) {
    if (!this.a || !this.layer) return;
    const doc = app.doc!;
    const tiny = Math.hypot(e.x - this.a.x, e.y - this.a.y) * app.viewport.zoom < 3;
    if (tiny) { this.layer.parent?.remove(this.layer); doc.setActive(doc.allLayers().pop() ?? null); doc.invalidate(); }
    else doc.commit('Forma');
    this.a = null; this.layer = null;
  }
  cancel() { if (this.layer) { this.layer.parent?.remove(this.layer); app.doc?.invalidate(); } this.a = null; this.layer = null; }
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
