// Herramienta Parche y Movimiento con detección de contenido (grupo de los correctores, J).
// Parche: rodea la zona a arreglar y arrástrala hasta una zona buena; la textura de allí se copia y
// su color y luz se adaptan al entorno. Movimiento con detección de contenido: selecciona un objeto y
// arrástralo; se funde en el sitio nuevo y el hueco que deja se rellena solo.

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import type { Viewport } from '../ui/viewport';
import { cloneCanvas, ctx2d, getPixels, makeCanvas, putPixels, Rect } from '../core/canvas';
import { getPaintTarget, setPreview, setTargetCanvas, PaintTarget } from './paint';
import { heal } from '../filters/heal';
import { healCanvas, inpaintCanvas } from '../ui/ops';

function insideSelection(e: ToolEvent) {
  const d = app.doc!, m = d.selection.mask; if (!m) return false;
  const x = Math.floor(e.x), y = Math.floor(e.y);
  if (x < 0 || y < 0 || x >= d.width || y >= d.height) return false;
  return ctx2d(m).getImageData(x, y, 1, 1).data[3] >= 128;
}

/** Máscara suavizada (para que el borde del parche se funda). */
function softMask(mask: HTMLCanvasElement, dx = 0, dy = 0, blur = 2) {
  const c = makeCanvas(mask.width, mask.height), x = ctx2d(c);
  x.filter = `blur(${blur}px)`; x.drawImage(mask, dx, dy); x.filter = 'none'; x.drawImage(mask, dx, dy);
  return c;
}

/**
 * Pega en `dst` la textura de `tex` tomada con desplazamiento (sx, sy) dentro del hueco `hole`,
 * corrigiendo color y luz para que encaje con el borde (como el pincel corrector).
 */
function patchInto(dst: HTMLCanvasElement, tex: HTMLCanvasElement, hole: HTMLCanvasElement, box: Rect, sx: number, sy: number, adapt = true) {
  const W = dst.width, H = dst.height, m = Math.max(4, Math.round(Math.max(box.w, box.h) * 0.08));
  const x0 = Math.max(0, box.x - m), y0 = Math.max(0, box.y - m), x1 = Math.min(W, box.x + box.w + m), y1 = Math.min(H, box.y + box.h + m);
  const reg = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; if (reg.w < 2 || reg.h < 2) return;
  const O = getPixels(dst, reg);
  const cc = makeCanvas(reg.w, reg.h); ctx2d(cc).drawImage(tex, -(reg.x + sx), -(reg.y + sy));
  const C = ctx2d(cc).getImageData(0, 0, reg.w, reg.h);
  // donde la copia cae fuera de la imagen se usa el original
  for (let i = 0; i < C.data.length; i += 4) if (C.data[i + 3] === 0 && O.data[i + 3] > 0) { C.data[i] = O.data[i]; C.data[i + 1] = O.data[i + 1]; C.data[i + 2] = O.data[i + 2]; C.data[i + 3] = O.data[i + 3]; }
  const ha = getPixels(hole, reg).data, hw = new Float32Array(reg.w * reg.h);
  for (let i = 0; i < hw.length; i++) hw[i] = ha[i * 4 + 3] / 255;
  let res: ImageData;
  if (adapt) res = heal(O, C, hw);
  else { res = new ImageData(new Uint8ClampedArray(O.data), reg.w, reg.h); for (let i = 0; i < hw.length; i++) for (let k = 0; k < 4; k++) res.data[i * 4 + k] = O.data[i * 4 + k] * (1 - hw[i]) + C.data[i * 4 + k] * hw[i]; }
  putPixels(dst, res, reg.x, reg.y);
}

/** Lazo libre propio para que la herramienta pueda hacer la selección sin cambiar de herramienta. */
abstract class LassoDragTool implements Tool {
  abstract id: string; abstract name: string; icon = icon('spotHeal'); key = 'J'; group = 'heal'; cursor = 'crosshair';
  abstract options: any[];
  protected pts: { x: number; y: number }[] = [];
  protected drag: { x: number; y: number; dx: number; dy: number } | null = null;
  protected t: PaintTarget | null = null;
  private addMode = false;
  down(e: ToolEvent) {
    const d = app.doc!;
    if (d.selection.mask && insideSelection(e) && !e.shift && !e.alt) {
      const t = getPaintTarget();
      if (!t || t.isMask || t.quick) { app.toast(`${this.name} trabaja sobre los píxeles de una capa`, 'warn'); return; }
      this.t = t; this.drag = { x: e.x, y: e.y, dx: 0, dy: 0 }; this.preview(); return;
    }
    this.addMode = e.shift; this.pts = [{ x: e.x, y: e.y }];
  }
  move(e: ToolEvent) {
    if (this.drag) {
      const dx = Math.round(e.x - this.drag.x), dy = Math.round(e.y - this.drag.y);
      if (dx !== this.drag.dx || dy !== this.drag.dy) { this.drag.dx = dx; this.drag.dy = dy; (app.doc as any).selectionOffset = { x: dx, y: dy }; this.preview(); }
      return;
    }
    if (!this.pts.length) return;
    const l = this.pts[this.pts.length - 1];
    if (Math.hypot(e.x - l.x, e.y - l.y) * app.viewport.zoom > 1.5) { this.pts.push({ x: e.x, y: e.y }); app.viewport.requestRender(); }
  }
  up() {
    const d = app.doc!;
    if (this.drag) {
      const { dx, dy } = this.drag, t = this.t!; this.drag = null; this.t = null;
      (d as any).selectionOffset = null; setPreview(t, null);
      if (dx || dy) this.apply(t, dx, dy); else d.invalidate();
      return;
    }
    const pts = this.pts; this.pts = [];
    if (pts.length < 3) { if (d.selection.active && !this.addMode) { d.selection.clear(); d.commit('Deseleccionar'); } return; }
    d.selection.polygon(pts, this.addMode ? 'add' : 'new');
    d.commit(this.name + ': selección');
  }
  cancel() {
    this.pts = [];
    if (this.drag && this.t) { setPreview(this.t, null); (app.doc as any).selectionOffset = null; app.doc!.invalidate(); }
    this.drag = null; this.t = null;
  }
  drawOverlay(_ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (this.pts.length < 2) return;
    const p = new Path2D(); this.pts.forEach((q, i) => i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)); vp.drawAnts(p);
  }
  /** Vista previa mientras se arrastra. */
  protected abstract preview(): void;
  protected abstract apply(t: PaintTarget, dx: number, dy: number): void | Promise<void>;
}

export class PatchTool extends LassoDragTool {
  id = 'patch'; name = 'Parche'; icon = icon('patch');
  options = [
    { key: 'mode', label: 'Parche', type: 'select', default: 'source', choices: [{ value: 'source', label: 'Origen (arrastra hacia la zona buena)' }, { value: 'dest', label: 'Destino (copia lo seleccionado)' }] },
    { key: 'adapt', label: 'Adaptar color', type: 'checkbox', default: true },
  ] as any[];
  protected preview() {
    const t = this.t!, { dx, dy } = this.drag!, m = app.doc!.selection.mask!;
    const work = cloneCanvas(t.canvas), x = ctx2d(work);
    const piece = makeCanvas(work.width, work.height), px = ctx2d(piece);
    if (app.opt('mode', this.id) === 'source') { px.drawImage(t.canvas, -dx, -dy); px.globalCompositeOperation = 'destination-in'; px.drawImage(m, 0, 0); }
    else { px.drawImage(t.canvas, 0, 0); px.globalCompositeOperation = 'destination-in'; px.drawImage(m, 0, 0); px.globalCompositeOperation = 'source-over'; const q = cloneCanvas(piece); px.clearRect(0, 0, piece.width, piece.height); px.drawImage(q, dx, dy); }
    x.drawImage(piece, 0, 0);
    setPreview(t, work);
  }
  protected apply(t: PaintTarget, dx: number, dy: number) {
    const d = app.doc!, sel = d.selection, b = sel.bounds!, out = cloneCanvas(t.canvas), adapt = !!app.opt('adapt', this.id);
    if (app.opt('mode', this.id) === 'source') patchInto(out, t.canvas, softMask(sel.mask!), { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 }, dx, dy, adapt);
    else patchInto(out, t.canvas, softMask(sel.mask!, dx, dy), { x: b.x + dx - 2, y: b.y + dy - 2, w: b.w + 4, h: b.h + 4 }, -dx, -dy, adapt);
    const z = setTargetCanvas(t, out, 'auto'); d.commit('Parche', z);
  }
}

export class ContentMoveTool extends LassoDragTool {
  id = 'contentMove'; name = 'Movimiento con detección de contenido'; icon = icon('contentMove');
  options = [
    { key: 'mode', label: 'Modo', type: 'select', default: 'move', choices: [{ value: 'move', label: 'Mover' }, { value: 'extend', label: 'Extender (duplicar)' }] },
    { key: 'adapt', label: 'Adaptar color', type: 'checkbox', default: true },
  ] as any[];
  protected preview() {
    const t = this.t!, { dx, dy } = this.drag!, m = app.doc!.selection.mask!;
    const work = cloneCanvas(t.canvas), x = ctx2d(work);
    const piece = makeCanvas(work.width, work.height), px = ctx2d(piece);
    px.drawImage(t.canvas, 0, 0); px.globalCompositeOperation = 'destination-in'; px.drawImage(m, 0, 0);
    x.globalAlpha = 0.85; x.drawImage(piece, dx, dy);
    setPreview(t, work);
  }
  protected async apply(t: PaintTarget, dx: number, dy: number) {
    const d = app.doc!, sel = d.selection, b = sel.bounds!, src = t.canvas;
    let out: HTMLCanvasElement = cloneCanvas(src);
    if (app.opt('mode', this.id) === 'move') {
      // 1) el hueco que deja se rellena con textura del entorno
      const hole = softMask(sel.mask!, 0, 0, 3);
      const box = { x: Math.max(0, b.x - 4), y: Math.max(0, b.y - 4), w: b.w + 8, h: b.h + 8 };
      out = (b.w * b.h < 2500 * 2500 ? await inpaintCanvas(out, hole, box) : healCanvas(out, hole, box)) ?? out;
    }
    // 2) el objeto se coloca en el sitio nuevo; el borde se adapta al entorno y el interior se conserva
    const dest = makeCanvas(src.width, src.height), dc = ctx2d(dest);
    dc.drawImage(sel.mask!, dx, dy);
    const blended = cloneCanvas(out);
    patchInto(blended, src, softMask(sel.mask!, dx, dy, 3), { x: b.x + dx - 4, y: b.y + dy - 4, w: b.w + 8, h: b.h + 8 }, -dx, -dy, !!app.opt('adapt', this.id));
    // dentro del objeto (lejos del borde) se usan sus píxeles exactos
    const core = makeCanvas(src.width, src.height), cx = ctx2d(core);
    cx.drawImage(src, dx, dy); cx.globalCompositeOperation = 'destination-in';
    const shrink = makeCanvas(src.width, src.height), sx = ctx2d(shrink); sx.filter = 'blur(4px)'; sx.drawImage(dest, 0, 0); sx.filter = 'none';
    const sd = sx.getImageData(0, 0, src.width, src.height); for (let i = 3; i < sd.data.length; i += 4) sd.data[i] = Math.max(0, Math.min(255, (sd.data[i] - 200) * 255 / 55)); sx.putImageData(sd, 0, 0);
    cx.drawImage(shrink, 0, 0);
    ctx2d(blended).drawImage(core, 0, 0);
    setTargetCanvas(t, blended, 'auto');
    sel.setMask(dest);
    d.commit(this.name);
  }
}
