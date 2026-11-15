// Herramienta Forma: rectángulo, rectángulo redondeado, elipse y línea.
// Cada forma se crea en una capa nueva.

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import { RasterLayer } from '../core/layers';
import { clearCanvas, ctx2d } from '../core/canvas';

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
  private layer: RasterLayer | null = null;

  down(e: ToolEvent) {
    const doc = app.doc!;
    this.a = { x: e.x, y: e.y };
    this.layer = new RasterLayer('Forma', doc.width, doc.height);
    let n = 1; const names = new Set(doc.allLayers().map(l => l.name));
    while (names.has(`Forma ${n}`)) n++;
    this.layer.name = `Forma ${n}`;
    doc.insertAboveActive(this.layer);
  }
  move(e: ToolEvent) {
    if (!this.a || !this.layer) return;
    const shape = app.opt<string>('shape', this.id);
    let x0 = this.a.x, y0 = this.a.y, x1 = e.x, y1 = e.y;
    if (e.shift) {
      if (shape === 'line') {
        const ang = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) * Math.PI / 4, d = Math.hypot(x1 - x0, y1 - y0);
        x1 = x0 + Math.cos(ang) * d; y1 = y0 + Math.sin(ang) * d;
      } else { const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); x1 = x0 + Math.sign(x1 - x0 || 1) * s; y1 = y0 + Math.sign(y1 - y0 || 1) * s; }
    }
    if (e.alt && shape !== 'line') { x0 = 2 * this.a.x - x1; y0 = 2 * this.a.y - y1; }
    const c = this.layer.canvas;
    clearCanvas(c);
    const ctx = ctx2d(c);
    ctx.save();
    const sw = app.opt<number>('strokeWidth', this.id);
    const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), hh = Math.abs(y1 - y0);
    ctx.beginPath();
    if (shape === 'line') { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
    else if (shape === 'ellipse') ctx.ellipse(x + w / 2, y + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2);
    else if (shape === 'round') (ctx as any).roundRect ? (ctx as any).roundRect(x, y, w, hh, Math.min(app.opt<number>('radius', this.id), w / 2, hh / 2)) : ctx.rect(x, y, w, hh);
    else ctx.rect(x, y, w, hh);
    if (shape === 'line') { ctx.strokeStyle = app.fg; ctx.lineWidth = sw; ctx.lineCap = 'round'; ctx.stroke(); }
    else {
      if (app.opt('fill', this.id)) { ctx.fillStyle = app.fg; ctx.fill(); }
      if (app.opt('stroke', this.id)) { ctx.strokeStyle = app.opt('strokeColor', this.id); ctx.lineWidth = sw; ctx.lineJoin = 'round'; ctx.stroke(); }
    }
    ctx.restore();
    app.doc!.invalidate();
  }
  up(e: ToolEvent) {
    if (!this.a || !this.layer) return;
    const doc = app.doc!;
    const tiny = Math.hypot(e.x - this.a.x, e.y - this.a.y) * app.viewport.zoom < 3;
    if (tiny) { this.layer.parent?.remove(this.layer); doc.setActive(doc.allLayers().pop() ?? null); doc.invalidate(); }
    else { this.layer.touch(); doc.commit('Forma'); }
    this.a = null; this.layer = null;
  }
  cancel() { if (this.layer) { this.layer.parent?.remove(this.layer); app.doc?.invalidate(); } this.a = null; this.layer = null; }
}
