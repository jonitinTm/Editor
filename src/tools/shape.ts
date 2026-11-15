// Herramienta Forma: rectángulo, rectángulo redondeado, elipse y línea.
// Cada forma se crea en una capa vectorial nueva, editable desde Propiedades.

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import { ShapeLayer, ShapeProps } from '../core/layers';

export class ShapeTool implements Tool {
  id = 'shape'; name = 'Forma'; icon = icon('shape'); key = 'U'; cursor = 'crosshair';
  options = [
    { key: 'shape', label: 'Forma', type: 'select', default: 'rect', choices: [
      { value: 'rect', label: 'Rectángulo' }, { value: 'round', label: 'Rect. redondeado' },
      { value: 'ellipse', label: 'Elipse' }, { value: 'line', label: 'Línea' }] },
    { key: 'fill', label: 'Relleno (color frontal)', type: 'checkbox', default: true },
    { key: 'stroke', label: 'Trazo', type: 'checkbox', default: false },
    { key: 'strokeColor', type: 'color', default: '#000000' },
    { key: 'strokeWidth', label: 'Grosor', type: 'range', min: 1, max: 200, default: 4, unit: 'px' },
    { key: 'radius', label: 'Radio', type: 'range', min: 0, max: 500, default: 20, unit: 'px' },
  ] as any[];
  private a: { x: number; y: number } | null = null;
  private layer: ShapeLayer | null = null;

  down(e: ToolEvent) {
    const doc = app.doc!;
    this.a = { x: e.x, y: e.y };
    const shape = app.opt<ShapeProps['shape']>('shape', this.id);
    this.layer = new ShapeLayer('Forma', doc.width, doc.height, {
      shape, x0: e.x, y0: e.y, x1: e.x, y1: e.y,
      fill: shape === 'line' ? null : app.opt('fill', this.id) ? app.fg : null,
      stroke: shape === 'line' ? app.fg : app.opt('stroke', this.id) ? app.opt('strokeColor', this.id) : null,
      strokeWidth: app.opt('strokeWidth', this.id), radius: app.opt('radius', this.id),
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
      if (p.shape === 'line') {
        const ang = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) * Math.PI / 4, d = Math.hypot(x1 - x0, y1 - y0);
        x1 = x0 + Math.cos(ang) * d; y1 = y0 + Math.sin(ang) * d;
      } else { const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); x1 = x0 + Math.sign(x1 - x0 || 1) * s; y1 = y0 + Math.sign(y1 - y0 || 1) * s; }
    }
    if (e.alt && p.shape !== 'line') { x0 = 2 * this.a.x - x1; y0 = 2 * this.a.y - y1; }
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
