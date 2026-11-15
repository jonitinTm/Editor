// Pincel, lápiz, borrador y tampón de clonar: comparten el motor de trazos.

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import { Stroke, getPaintTarget, brushTip, strokeSetup, PaintTarget } from './paint';
import { ctx2d, makeCanvas, cloneCanvas } from '../core/canvas';
import type { Viewport } from '../ui/viewport';

const SIZE = { key: 'size', label: 'Tamaño', type: 'range' as const, min: 1, max: 1000, default: 20, unit: 'px' };
const HARD = { key: 'hardness', label: 'Dureza', type: 'range' as const, min: 0, max: 100, default: 80, unit: '%' };
const OPAC = { key: 'opacity', label: 'Opacidad', type: 'range' as const, min: 1, max: 100, default: 100, unit: '%' };
const FLOW = { key: 'flow', label: 'Flujo', type: 'range' as const, min: 1, max: 100, default: 100, unit: '%' };
const PRESS = { key: 'pressure', label: 'Presión = tamaño', type: 'checkbox' as const, default: true };

/** Círculo del tamaño del pincel que sigue al ratón. */
export function drawBrushCursor(ctx: CanvasRenderingContext2D, vp: Viewport, size: number) {
  if (!vp.mouseScreen) return;
  const r = size * vp.zoom / 2;
  const { x, y } = vp.mouseScreen;
  ctx.lineWidth = 1;
  if (r > 3) {
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.beginPath(); ctx.arc(x, y, r + .5, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(x, y, r - .5, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.beginPath();
  ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.stroke();
}

abstract class StrokeTool implements Tool {
  abstract id: string; abstract name: string; abstract icon: string;
  cursor = 'none';
  options = [SIZE, HARD, OPAC, FLOW, PRESS] as any[];
  protected stroke: Stroke | null = null;
  protected target: PaintTarget | null = null;
  protected lastPoint: { x: number; y: number } | null = null;
  protected erase = false;
  protected aliased = false;
  abstract historyName: string;

  protected size(p: number) {
    const s = app.opt<number>('size', this.id);
    return app.opt('pressure', this.id) ? Math.max(1, s * p) : s;
  }

  protected makeDab(color: string): (x: number, y: number, p: number) => any {
    const hard = (app.opt<number>('hardness', this.id) ?? 100) / 100;
    const flow = (app.opt<number>('flow', this.id) ?? 100) / 100;
    const ctx = ctx2d(this.stroke!.buffer);
    return (x, y, p) => {
      const size = this.size(p);
      const tip = brushTip(size, hard, color, this.aliased);
      let dx = x - tip.width / 2, dy = y - tip.height / 2;
      if (this.aliased) { dx = Math.round(dx); dy = Math.round(dy); }
      ctx.globalAlpha = flow;
      ctx.drawImage(tip, dx, dy);
      return { x: dx, y: dy, w: tip.width, h: tip.height };
    };
  }

  private dab: ((x: number, y: number, p: number) => any) | null = null;

  down(e: ToolEvent) {
    const t = getPaintTarget();
    if (!t) return;
    this.target = t;
    const s = strokeSetup(t, this.erase);
    this.stroke = new Stroke(t, s.mode, app.opt<number>('opacity', this.id) / 100, s.maskValue);
    this.dab = this.makeDab(s.color);
    const sp = Math.max(1, this.size(e.pressure) * (this.aliased ? 0.25 : 0.12));
    if (e.shift && this.lastPoint) {
      // Mayús + clic: línea recta desde el punto anterior
      this.stroke.lineTo(this.lastPoint.x, this.lastPoint.y, e.pressure, sp, this.dab);
    }
    this.stroke.lineTo(e.x, e.y, e.pressure, sp, this.dab);
    this.stroke.update();
    this.lastPoint = { x: e.x, y: e.y };
  }
  move(e: ToolEvent) {
    if (!this.stroke || !this.dab) return;
    const sp = Math.max(1, this.size(e.pressure) * (this.aliased ? 0.25 : 0.12));
    this.stroke.lineTo(e.x, e.y, e.pressure, sp, this.dab);
    this.stroke.update();
    this.lastPoint = { x: e.x, y: e.y };
  }
  up() {
    if (!this.stroke) return;
    const changed = this.stroke.finish();
    this.stroke = null;
    if (changed) app.doc!.commit(this.historyName);
  }
  cancel() { this.stroke?.cancel(); this.stroke = null; }
  hover() { /* el cursor se dibuja en drawOverlay */ }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) { drawBrushCursor(ctx, vp, app.opt<number>('size', this.id)); }
  docChanged() { this.lastPoint = null; }
}

export class BrushTool extends StrokeTool {
  id = 'brush'; name = 'Pincel'; icon = icon('brush'); key = 'B'; group = 'brush'; historyName = 'Pincel';
}

export class PencilTool extends StrokeTool {
  id = 'pencil'; name = 'Lápiz'; icon = icon('pencil'); key = 'B'; group = 'brush'; historyName = 'Lápiz';
  aliased = true;
  options = [{ ...SIZE, default: 1 }, OPAC, { ...PRESS, default: false }] as any[];
}

export class EraserTool extends StrokeTool {
  id = 'eraser'; name = 'Borrador'; icon = icon('eraser'); key = 'E'; historyName = 'Borrador';
  erase = true;
}

/** Tampón de clonar: Alt + clic marca el origen; luego se pinta copiando de él. */
export class CloneTool extends StrokeTool {
  id = 'clone'; name = 'Tampón de clonar'; icon = icon('clone'); key = 'S'; historyName = 'Tampón de clonar';
  options = [SIZE, { ...HARD, default: 50 }, OPAC, FLOW,
    { key: 'aligned', label: 'Alineado', type: 'checkbox', default: true },
    { key: 'sample', label: 'Muestra', type: 'select', default: 'layer', choices: [{ value: 'layer', label: 'Capa actual' }, { value: 'all', label: 'Todas las capas' }] },
  ] as any[];
  private source: { x: number; y: number } | null = null;
  private offset: { x: number; y: number } | null = null;
  private srcCanvas: HTMLCanvasElement | null = null;
  private current: { x: number; y: number } | null = null;

  down(e: ToolEvent) {
    if (e.alt) {
      this.source = { x: e.x, y: e.y }; this.offset = null;
      app.toast('Origen del tampón fijado'); return;
    }
    if (!this.source) { app.toast('Mantén pulsado Alt y haz clic para elegir el origen', 'warn'); return; }
    const t = getPaintTarget();
    if (!t) return;
    if (!this.offset || !app.opt('aligned', this.id)) this.offset = { x: this.source.x - e.x, y: this.source.y - e.y };
    this.srcCanvas = app.opt('sample', this.id) === 'all' ? cloneCanvas(app.doc!.flatten()) : cloneCanvas(t.canvas);
    this.target = t;
    const s = strokeSetup(t, false);
    this.stroke = new Stroke(t, s.mode === 'mask' ? 'mask' : 'paint', app.opt<number>('opacity', this.id) / 100, s.maskValue);
    (this as any).dabFn = this.makeCloneDab();
    this.current = { x: e.x, y: e.y };
    this.stroke.lineTo(e.x, e.y, e.pressure, this.spacing(), (this as any).dabFn);
    this.stroke.update();
  }
  private spacing() { return Math.max(1, app.opt<number>('size', this.id) * 0.12); }
  private makeCloneDab() {
    const hard = app.opt<number>('hardness', this.id) / 100;
    const flow = app.opt<number>('flow', this.id) / 100;
    const ctx = ctx2d(this.stroke!.buffer);
    const scratch = makeCanvas(4, 4);
    return (x: number, y: number) => {
      const size = app.opt<number>('size', this.id);
      const tip = brushTip(size, hard, '#ffffff');
      const w = tip.width, hh = tip.height;
      if (scratch.width !== w || scratch.height !== hh) { scratch.width = w; scratch.height = hh; }
      const sc = ctx2d(scratch);
      const dx = Math.round(x - w / 2), dy = Math.round(y - hh / 2);
      sc.globalCompositeOperation = 'copy';
      sc.drawImage(this.srcCanvas!, -(dx + this.offset!.x), -(dy + this.offset!.y));
      sc.globalCompositeOperation = 'destination-in';
      sc.drawImage(tip, 0, 0);
      ctx.globalAlpha = flow;
      ctx.drawImage(scratch, dx, dy);
      return { x: dx, y: dy, w, h: hh };
    };
  }
  move(e: ToolEvent) {
    this.current = { x: e.x, y: e.y };
    if (!this.stroke) return;
    this.stroke.lineTo(e.x, e.y, e.pressure, this.spacing(), (this as any).dabFn);
    this.stroke.update();
  }
  up() { super.up(); this.srcCanvas = null; }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    super.drawOverlay(ctx, vp);
    // Marca del punto de origen
    let p: { x: number; y: number } | null = null;
    if (this.offset && vp.mouse) p = { x: vp.mouse.x + this.offset.x, y: vp.mouse.y + this.offset.y };
    else if (this.source) p = this.source;
    if (!p) return;
    const s = vp.toScreen(p.x, p.y);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(s.x - 7, s.y); ctx.lineTo(s.x + 7, s.y); ctx.moveTo(s.x, s.y - 7); ctx.lineTo(s.x, s.y + 7); ctx.stroke();
    ctx.strokeStyle = '#000'; ctx.lineWidth = .7; ctx.stroke();
  }
}
