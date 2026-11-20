// Herramienta Mover: desplaza la capa activa (o el contenido seleccionado).

import { TextLayer } from '../core/layers';
import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import { cloneCanvas, ctx2d, makeCanvas } from '../core/canvas';
import { GroupLayer, Layer, RasterLayer, isRaster, isParametric, walkLayers } from '../core/layers';
import { selectedLayers, alignLayer, distributeLayers, layerBox } from '../ui/ops';
import { snapRect, snapTargets, layerBounds, clearSnap } from './snap';
import type { Rect } from '../core/canvas';
import type { Viewport } from '../ui/viewport';
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
  id = 'move'; name = 'Mover'; icon = icon('move'); key = 'V'; group = 'move'; cursor = 'move';
  options = [{ key: 'autoSelect', label: 'Selección automática de capa', type: 'checkbox', default: false },
    { key: 'showTransform', label: 'Mostrar controles de transformación', type: 'checkbox', default: false }] as any[];
  private boxCache: { l: Layer; v: number; b: Rect | null } | null = null;
  /** Caja del contenido de la capa activa (para los controles de transformación). */
  private activeBox(): Rect | null {
    const l = app.doc?.active; if (!l || !isRaster(l)) return null;
    const v = (l as any).version ?? 0;
    if (!this.boxCache || this.boxCache.l !== l || this.boxCache.v !== v) this.boxCache = { l, v, b: layerBox(l) };
    return this.boxCache.b;
  }
  private handleHit(e: ToolEvent) {
    if (!app.opt('showTransform', this.id)) return false;
    const b = this.activeBox(); if (!b) return false;
    const vp = app.viewport;
    for (const [x, y] of [[b.x, b.y], [b.x + b.w / 2, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h / 2], [b.x + b.w, b.y + b.h], [b.x + b.w / 2, b.y + b.h], [b.x, b.y + b.h], [b.x, b.y + b.h / 2]]) {
      const s = vp.toScreen(x, y); if (Math.abs(s.x - e.sx) < 8 && Math.abs(s.y - e.sy) < 8) return true;
    }
    return false;
  }
  extraOptions(bar: HTMLElement) {
    const sep = document.createElement('span'); sep.className = 'opt-sep'; bar.append(sep);
    const lbl = document.createElement('span'); lbl.className = 'lbl hint'; lbl.textContent = 'Alinear:'; bar.append(lbl);
    const g = document.createElement('div'); g.className = 'btn-group';
    for (const [m, t, title] of [['left', '⇤', 'Bordes izquierdos'], ['hcenter', '↔', 'Centros horizontales'], ['right', '⇥', 'Bordes derechos'], ['top', '⤒', 'Bordes superiores'], ['vcenter', '↕', 'Centros verticales'], ['bottom', '⤓', 'Bordes inferiores']] as const) {
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = t; b.title = title + ' (varias capas: entre sí; una: respecto a la selección o al lienzo)'; b.dataset.align = m;
      b.onclick = () => alignLayer(m); g.append(b);
    }
    bar.append(g);
    const l2 = document.createElement('span'); l2.className = 'lbl hint'; l2.textContent = 'Distribuir:'; bar.append(l2);
    const g2 = document.createElement('div'); g2.className = 'btn-group';
    for (const [m, t, title] of [['hcenter', '⫼', 'Centros horizontales'], ['vcenter', '☰', 'Centros verticales'], ['hspace', '↔|', 'Mismo espacio horizontal'], ['vspace', '↕|', 'Mismo espacio vertical']] as const) {
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = t; b.title = 'Distribuir: ' + title + ' (3 o más capas seleccionadas)'; b.dataset.dist = m;
      b.onclick = () => distributeLayers(m); g2.append(b);
    }
    bar.append(g2);
  }
  private start: { x: number; y: number } | null = null;
  private offset = { x: 0, y: 0 };
  private layers: Layer[] = [];
  private floating: { layer: RasterLayer; hole: HTMLCanvasElement; pixels: HTMLCanvasElement } | null = null;
  /** Caja de lo que se mueve y objetivos de ajuste, calculados al empezar. */
  private snapBox: Rect | null = null;
  private targets: { x: number[]; y: number[] } | null = null;

  down(e: ToolEvent) {
    const doc = app.doc!;
    // con los controles visibles, tirar de un tirador pasa directamente a Transformación libre
    if (this.handleHit(e)) { app.setTool('transform', true); if (app.tool?.id === 'transform') app.tool.down?.(e); return; }
    // Doble clic sobre un texto: se pasa a editarlo (como en los editores profesionales)
    if (e.detail >= 2) {
      const hit = layerAt(e.x, e.y), l = hit instanceof TextLayer ? hit : doc.active instanceof TextLayer && doc.active.bounds && (() => { const b = (doc.active as TextLayer).bounds(); return e.x >= b.x && e.x <= b.x + b.w && e.y >= b.y && e.y <= b.y + b.h; })() ? doc.active : null;
      if (l instanceof TextLayer) { doc.setActive(l); app.setTool('text'); (app.tool as any)?.editLayer?.(l); return; }
    }
    // Ctrl invierte la opción «Selección automática de capa» (como en los editores profesionales)
    if (!!app.opt('autoSelect', this.id) !== e.ctrl) {
      const l = layerAt(e.x, e.y);
      if (l && l !== doc.active) { doc.setActive(l); }
    }
    if (!this.begin()) return;
    this.start = { x: e.x, y: e.y };
    this.prepareSnap();
  }

  /** Prepara el movimiento. Devuelve false si no se puede mover nada. */
  private begin(): boolean {
    const doc = app.doc!;
    let a = doc.active;
    if (!a) { app.toast('No hay ninguna capa seleccionada', 'warn'); return false; }
    let sel = selectedLayers();
    if (!sel.includes(a)) sel = [a];
    // las capas vinculadas se mueven juntas
    const links = new Set(sel.map(l => l.link).filter(v => v != null));
    if (links.size) sel = [...new Set([...sel, ...doc.allLayers().filter(l => l.link != null && links.has(l.link))])];
    if (sel.some(l => l.posLocked())) { app.toast(sel.some(l => l.isLocked()) ? 'La capa está bloqueada' : 'La posición de la capa está bloqueada', 'warn'); return false; }
    this.offset = { x: 0, y: 0 };
    if (doc.selection.active && sel.length === 1 && !(a instanceof GroupLayer) && !doc.editMask) {
      if (isParametric(a)) a = rasterizeLayer(a);
      const layer = a as RasterLayer;
      const sel = doc.selection.mask!;
      const pixels = cloneCanvas(layer.canvas);
      const pc = ctx2d(pixels); pc.globalCompositeOperation = 'destination-in'; pc.drawImage(sel, 0, 0); pc.globalCompositeOperation = 'source-over';
      const hole = cloneCanvas(layer.canvas);
      const hc = ctx2d(hole); hc.globalCompositeOperation = 'destination-out'; hc.drawImage(sel, 0, 0); hc.globalCompositeOperation = 'source-over';
      this.floating = { layer, hole, pixels };
      doc.overrides.set(layer, { canvas: hole, extra: ctx => ctx.drawImage(pixels, this.offset.x, this.offset.y) });
      this.layers = [layer];
    } else {
      this.layers = [...new Set(sel.flatMap(l => l instanceof GroupLayer ? [l, ...walkLayers(l)] : [l]))];
      this.floating = null;
      // mesas de trabajo: su rectángulo se mueve con ellas
      this.boards = this.layers.filter((l): l is GroupLayer => l instanceof GroupLayer && !!l.artboard).map(g => ({ g, x: g.artboard!.x, y: g.artboard!.y }));
    }
    return true;
  }

  private boards: { g: GroupLayer; x: number; y: number }[] = [];
  private update() {
    const doc = app.doc!;
    for (const b of this.boards) { b.g.artboard!.x = b.x + this.offset.x; b.g.artboard!.y = b.y + this.offset.y; }
    if (this.floating) {
      (doc as any).selectionOffset = this.offset;
    } else {
      for (const l of this.layers) {
        const ov = doc.overrides.get(l) ?? {};
        if (isParametric(l)) ov.offset = this.offset;
        else if (isRaster(l)) { const f = l.fullContent(); ov.canvas = f.canvas; ov.offset = { x: f.x + this.offset.x, y: f.y + this.offset.y }; }
        if (l.mask) ov.mask = shiftCanvas(l.mask.canvas, this.offset.x, this.offset.y, '#fff');
        if (l.vmask) ov.vmOffset = this.offset;
        doc.overrides.set(l, ov);
      }
    }
    doc.invalidate();
  }

  private prepareSnap() {
    const doc = app.doc!;
    let box: Rect | null = null;
    if (this.floating) box = doc.selection.bounds;
    else for (const l of this.layers) { const b = layerBounds(l); if (b) box = box ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), w: Math.max(box.x + box.w, b.x + b.w) - Math.min(box.x, b.x), h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y) } : b; }
    this.snapBox = box;
    this.targets = box ? snapTargets(this.layers) : null;
  }
  move(e: ToolEvent) {
    if (!this.start) return;
    let dx = Math.round(e.x - this.start.x), dy = Math.round(e.y - this.start.y);
    if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    if (this.snapBox && this.targets && !e.ctrl) {
      const s = snapRect(this.snapBox, dx, dy, e.shift ? { x: dy === 0 ? this.targets.x : [], y: dx === 0 ? this.targets.y : [] } : this.targets);
      dx = Math.round(s.dx); dy = Math.round(s.dy);
    } else clearSnap();
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
        const fc = ctx2d(hole); fc.globalCompositeOperation = 'source-over'; fc.globalAlpha = 1; fc.drawImage(pixels, dx, dy);
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
        if (l.vmask) for (const sp of l.vmask.subpaths) for (const q of sp.pts) { q.x += dx; q.y += dy; q.ix += dx; q.iy += dy; q.ox += dx; q.oy += dy; }
      }
    }
    this.floating = null; this.layers = []; this.start = null; this.boards = [];
    doc.invalidate();
    if (dx || dy) doc.commit('Mover');
  }

  up() { clearSnap(); if (this.start) this.finish(); }
  hover(e: ToolEvent) { this.cursor = this.handleHit(e) ? 'nwse-resize' : 'move'; }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (!app.opt('showTransform', this.id) || this.start) return;
    const b = this.activeBox(); if (!b) return;
    const a = vp.toScreen(b.x, b.y), c = vp.toScreen(b.x + b.w, b.y + b.h);
    ctx.save(); ctx.strokeStyle = '#3d8bfd'; ctx.lineWidth = 1; ctx.strokeRect(Math.round(a.x) + .5, Math.round(a.y) + .5, Math.round(c.x - a.x), Math.round(c.y - a.y));
    for (const [x, y] of [[a.x, a.y], [(a.x + c.x) / 2, a.y], [c.x, a.y], [c.x, (a.y + c.y) / 2], [c.x, c.y], [(a.x + c.x) / 2, c.y], [a.x, c.y], [a.x, (a.y + c.y) / 2]]) { ctx.fillStyle = '#fff'; ctx.fillRect(x - 4, y - 4, 8, 8); ctx.strokeRect(x - 4, y - 4, 8, 8); }
    ctx.restore();
  }
  cancel() {
    const doc = app.doc; if (!doc) { this.layers = []; this.start = null; this.floating = null; return; }
    for (const l of this.layers) doc.overrides.delete(l);
    for (const b of this.boards) { b.g.artboard!.x = b.x; b.g.artboard!.y = b.y; } this.boards = [];
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
