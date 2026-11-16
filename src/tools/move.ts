// Herramienta Mover: desplaza la capa activa (o el contenido seleccionado).

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import { cloneCanvas, ctx2d, makeCanvas } from '../core/canvas';
import { GroupLayer, Layer, RasterLayer, isRaster, isParametric, walkLayers } from '../core/layers';
import { selectedLayers, alignLayer } from '../ui/ops';
import { rasterizeLayer } from './paint';

/** Desplaza el contenido de un lienzo (los bordes que quedan vacíos se rellenan con `fill`). */
export function shiftCanvas(c: HTMLCanvasElement, dx: number, dy: number, fill?: string) {
  const out = makeCanvas(c.width, c.height);
  const ctx = ctx2d(out);
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, c.width, c.height); ctx.clearRect(dx, dy, c.width, c.height); }
  ctx.drawImage(c, dx, dy);
  return out;
}

/** Capa más alta con píxeles visibles en (x, y). */
function layerAt(x: number, y: number): RasterLayer | null {
  const doc = app.doc!;
  const all = [...walkLayers(doc.root)].filter(l => isRaster(l) && l.isVisibleInTree()) as RasterLayer[];
  for (let i = all.length - 1; i >= 0; i--) {
    const a = ctx2d(all[i].canvas).getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3];
    if (a > 10) return all[i];
  }
  return null;
}

export class MoveTool implements Tool {
  id = 'move'; name = 'Mover'; icon = icon('move'); key = 'V'; cursor = 'move';
  options = [{ key: 'autoSelect', label: 'Selección automática de capa', type: 'checkbox', default: false }] as any[];
  extraOptions(bar: HTMLElement) {
    const sep = document.createElement('span'); sep.className = 'opt-sep'; bar.append(sep);
    const lbl = document.createElement('span'); lbl.className = 'lbl hint'; lbl.textContent = 'Alinear:'; bar.append(lbl);
    const g = document.createElement('div'); g.className = 'btn-group';
    for (const [m, t, title] of [['left', '⇤', 'Bordes izquierdos'], ['hcenter', '↔', 'Centros horizontales'], ['right', '⇥', 'Bordes derechos'], ['top', '⤒', 'Bordes superiores'], ['vcenter', '↕', 'Centros verticales'], ['bottom', '⤓', 'Bordes inferiores']] as const) {
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = t; b.title = title + ' (respecto a la selección o al lienzo)'; b.dataset.align = m;
      b.onclick = () => alignLayer(m); g.append(b);
    }
    bar.append(g);
  }
  private start: { x: number; y: number } | null = null;
  private offset = { x: 0, y: 0 };
  private layers: Layer[] = [];
  private floating: { layer: RasterLayer; hole: HTMLCanvasElement; pixels: HTMLCanvasElement } | null = null;

  down(e: ToolEvent) {
    const doc = app.doc!;
    if (app.opt('autoSelect', this.id) && !e.ctrl) {
      const l = layerAt(e.x, e.y);
      if (l && l !== doc.active) { doc.setActive(l); }
    }
    if (!this.begin()) return;
    this.start = { x: e.x, y: e.y };
  }

  /** Prepara el movimiento. Devuelve false si no se puede mover nada. */
  private begin(): boolean {
    const doc = app.doc!;
    let a = doc.active;
    if (!a) { app.toast('No hay ninguna capa seleccionada', 'warn'); return false; }
    let sel = selectedLayers();
    if (!sel.includes(a)) sel = [a];
    if (sel.some(l => l.isLocked())) { app.toast('La capa está bloqueada', 'warn'); return false; }
    this.offset = { x: 0, y: 0 };
    if (doc.selection.active && sel.length === 1 && !(a instanceof GroupLayer) && !doc.editMask) {
      if (isParametric(a)) a = rasterizeLayer(a);
      const layer = a as RasterLayer;
      const sel = doc.selection.mask!;
      const pixels = cloneCanvas(layer.canvas);
      const pc = ctx2d(pixels); pc.globalCompositeOperation = 'destination-in'; pc.drawImage(sel, 0, 0);
      const hole = cloneCanvas(layer.canvas);
      const hc = ctx2d(hole); hc.globalCompositeOperation = 'destination-out'; hc.drawImage(sel, 0, 0);
      this.floating = { layer, hole, pixels };
      doc.overrides.set(layer, { canvas: hole, extra: ctx => ctx.drawImage(pixels, this.offset.x, this.offset.y) });
      this.layers = [layer];
    } else {
      this.layers = [...new Set(sel.flatMap(l => l instanceof GroupLayer ? [l, ...walkLayers(l)] : [l]))];
      this.floating = null;
    }
    return true;
  }

  private update() {
    const doc = app.doc!;
    if (this.floating) {
      (doc as any).selectionOffset = this.offset;
    } else {
      for (const l of this.layers) {
        const ov = doc.overrides.get(l) ?? {};
        if (isParametric(l)) ov.offset = this.offset;
        else if (isRaster(l)) { const f = l.fullContent(); ov.canvas = f.canvas; ov.offset = { x: f.x + this.offset.x, y: f.y + this.offset.y }; }
        if (l.mask) ov.mask = shiftCanvas(l.mask.canvas, this.offset.x, this.offset.y, '#fff');
        doc.overrides.set(l, ov);
      }
    }
    doc.invalidate();
  }

  move(e: ToolEvent) {
    if (!this.start) return;
    let dx = Math.round(e.x - this.start.x), dy = Math.round(e.y - this.start.y);
    if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    this.offset = { x: dx, y: dy };
    this.update();
  }

  private finish() {
    const doc = app.doc!;
    const { x: dx, y: dy } = this.offset;
    if (this.floating) {
      const { layer, hole, pixels } = this.floating;
      doc.overrides.delete(layer);
      (doc as any).selectionOffset = null;
      if (dx || dy) {
        ctx2d(hole).drawImage(pixels, dx, dy);
        layer.canvas = hole; layer.touch();
        doc.selection.setMask(shiftCanvas(doc.selection.mask!, dx, dy));
      }
    } else {
      for (const l of this.layers) {
        doc.overrides.delete(l);
        if (!dx && !dy) continue;
        if (isParametric(l)) l.translate(dx, dy);
        else if (isRaster(l)) { const f = l.fullContent(); l.placeFull(f.canvas, f.x + dx, f.y + dy); }
        if (l.mask) { l.mask.canvas = shiftCanvas(l.mask.canvas, dx, dy, '#fff'); l.mask.touch(); }
      }
    }
    this.floating = null; this.layers = []; this.start = null;
    doc.invalidate();
    if (dx || dy) doc.commit('Mover');
  }

  up() { if (this.start) this.finish(); }
  cancel() {
    const doc = app.doc!;
    for (const l of this.layers) doc.overrides.delete(l);
    (doc as any).selectionOffset = null;
    this.floating = null; this.layers = []; this.start = null; doc.invalidate();
  }

  key_(e: KeyboardEvent): boolean {
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dirs[e.key];
    if (!d || !app.doc) return false;
    const k = e.shiftKey ? 10 : 1;
    if (!this.begin()) return true;
    this.offset = { x: d[0] * k, y: d[1] * k };
    this.finish();
    return true;
  }
}
