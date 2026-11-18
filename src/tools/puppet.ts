// Deformación de posición libre (como en Photoshop): chinchetas sobre la capa; al mover una,
// la imagen se dobla alrededor de las demás (mínimos cuadrados móviles rígidos sobre una malla).

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import type { Viewport } from '../ui/viewport';
import { ctx2d, makeCanvas, contentBounds, Rect } from '../core/canvas';
import { RasterLayer, isRaster, isParametric } from '../core/layers';
import { rasterizeLayer } from './paint';
import { drawGrid, mlsRigid, P } from './warpmesh';
import { h } from '../ui/dom';

interface Session { layer: RasterLayer; crop: HTMLCanvasElement; box: Rect; cols: number; rows: number; grid: P[]; dest: P[]; p: P[]; q: P[]; }

export class PuppetTool implements Tool {
  id = 'puppet'; name = 'Deformación de posición libre'; icon = icon('puppet'); cursor = 'crosshair';
  options = [
    { key: 'density', label: 'Densidad', type: 'select', default: 'normal', choices: [{ value: 'low', label: 'Menos puntos' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'Más puntos' }] },
    { key: 'showMesh', label: 'Mostrar malla', type: 'checkbox', default: true },
  ] as any[];
  private s: Session | null = null;
  private sel = -1;
  private drag: { i: number; start: P; q0: P } | null = null;

  extraOptions(bar: HTMLElement) {
    bar.append(h('span', { class: 'hint' }, 'Clic: poner chincheta · Arrastrar: mover · Alt+clic o Supr: quitar · Intro: aplicar'),
      h('button', { class: 'btn primary', onclick: () => { this.commit(); app.restoreTool(); } }, 'Aplicar'),
      h('button', { class: 'btn', onclick: () => { this.cancel(); app.restoreTool(); } }, 'Cancelar'));
  }
  activate() {
    const d = app.doc; let l = d?.active;
    if (!d || !l || !isRaster(l) || l.isLocked()) { app.toast('Selecciona una capa de píxeles (no bloqueada)', 'warn'); setTimeout(() => app.restoreTool(), 0); return; }
    if (isParametric(l)) { l = rasterizeLayer(l as RasterLayer); app.toast('La capa se ha rasterizado para poder deformarla'); }
    const layer = l as RasterLayer, b = contentBounds(layer.canvas);
    if (!b) { app.toast('La capa está vacía', 'warn'); setTimeout(() => app.restoreTool(), 0); return; }
    // margen para que la malla pueda estirarse más allá del contenido
    const m = Math.round(Math.max(b.w, b.h) * 0.04) + 4;
    const box = { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m };
    const crop = makeCanvas(box.w, box.h); ctx2d(crop).drawImage(layer.canvas, -box.x, -box.y);
    const k = ({ low: 14, normal: 26, high: 44 } as Record<string, number>)[app.opt<string>('density', this.id) ?? 'normal'] ?? 26;
    const cols = Math.max(2, Math.round(k * box.w / Math.max(box.w, box.h))), rows = Math.max(2, Math.round(k * box.h / Math.max(box.w, box.h)));
    const grid: P[] = [];
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) grid.push({ x: box.x + i * box.w / cols, y: box.y + j * box.h / rows });
    this.s = { layer, crop, box, cols, rows, grid, dest: grid.map(g => ({ ...g })), p: [], q: [] };
    this.sel = -1; this.preview();
  }
  deactivate() { if (this.s) this.commit(); }
  docChanged() { if (this.s) { app.doc?.overrides.delete(this.s.layer); this.s = null; } }
  private update() {
    const s = this.s!;
    s.dest = s.p.length ? s.grid.map(g => mlsRigid(g, s.p, s.q)) : s.grid.map(g => ({ ...g }));
    this.preview();
  }
  private preview() {
    const s = this.s; if (!s) return;
    const d = app.doc!;
    d.overrides.set(s.layer, { canvas: makeCanvas(1, 1), extra: ctx => drawGrid(ctx, s.crop, s.box.x, s.box.y, s.cols, s.rows, s.dest, false) });
    d.invalidate(); app.viewport.requestRender();
  }
  private pinAt(e: ToolEvent) {
    const s = this.s!, vp = app.viewport;
    for (let i = s.q.length - 1; i >= 0; i--) { const sp = vp.toScreen(s.q[i].x, s.q[i].y); if (Math.hypot(sp.x - e.sx, sp.y - e.sy) < 9) return i; }
    return -1;
  }
  hover(e: ToolEvent) { if (this.s) this.cursor = this.pinAt(e) >= 0 ? 'move' : 'crosshair'; }
  down(e: ToolEvent) {
    const s = this.s; if (!s) return;
    let i = this.pinAt(e);
    if (i >= 0 && e.alt) { this.remove(i); return; }
    if (i < 0) {
      // la nueva chincheta se clava en el punto original de la imagen bajo el cursor
      const orig = this.inverse({ x: e.x, y: e.y });
      s.p.push(orig); s.q.push({ x: e.x, y: e.y }); i = s.p.length - 1;
    }
    this.sel = i; this.drag = { i, start: { x: e.x, y: e.y }, q0: { ...s.q[i] } };
    app.viewport.requestRender();
  }
  move(e: ToolEvent) {
    const s = this.s, d = this.drag; if (!s || !d) return;
    s.q[d.i] = { x: d.q0.x + e.x - d.start.x, y: d.q0.y + e.y - d.start.y };
    this.update();
  }
  up() { this.drag = null; }
  /** Punto de la imagen original que ahora se ve en `v` (búsqueda en la malla deformada). */
  private inverse(v: P): P {
    const s = this.s!;
    if (!s.p.length) return v;
    let best = Infinity, bi = 0;
    for (let k = 0; k < s.dest.length; k++) { const dd = (s.dest[k].x - v.x) ** 2 + (s.dest[k].y - v.y) ** 2; if (dd < best) { best = dd; bi = k; } }
    // corrección local con la diferencia
    return { x: s.grid[bi].x + (v.x - s.dest[bi].x), y: s.grid[bi].y + (v.y - s.dest[bi].y) };
  }
  private remove(i: number) {
    const s = this.s!; s.p.splice(i, 1); s.q.splice(i, 1); this.sel = -1; this.update();
  }
  key_(e: KeyboardEvent) {
    if (!this.s) return false;
    if (e.key === 'Enter') { this.commit(); app.restoreTool(); return true; }
    if (e.key === 'Escape') { this.cancel(); app.restoreTool(); return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel >= 0) { this.remove(this.sel); return true; }
    return false;
  }
  commit() {
    const s = this.s; if (!s) return;
    this.s = null;
    const d = app.doc!;
    d.overrides.delete(s.layer);
    if (s.p.every((p, i) => p.x === s.q[i].x && p.y === s.q[i].y)) { d.invalidate(); return; }
    const out = makeCanvas(s.layer.canvas.width, s.layer.canvas.height);
    drawGrid(ctx2d(out), s.crop, s.box.x, s.box.y, s.cols, s.rows, s.dest, true);
    s.layer.canvas = out; s.layer.touch();
    d.invalidate(); d.commit('Deformación de posición libre');
  }
  cancel() { const s = this.s; if (!s) return; this.s = null; app.doc?.overrides.delete(s.layer); app.doc?.invalidate(); app.viewport.requestRender(); }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const s = this.s; if (!s) return;
    if (app.opt('showMesh', this.id)) {
      ctx.save(); ctx.strokeStyle = 'rgba(61,139,253,0.45)'; ctx.lineWidth = 0.7; ctx.beginPath();
      const S = (k: number) => vp.toScreen(s.dest[k].x, s.dest[k].y);
      for (let j = 0; j <= s.rows; j++) for (let i = 0; i <= s.cols; i++) {
        const k = j * (s.cols + 1) + i, a = S(k);
        if (i < s.cols) { const b = S(k + 1); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
        if (j < s.rows) { const b = S(k + s.cols + 1); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      }
      ctx.stroke(); ctx.restore();
    }
    s.q.forEach((q, i) => {
      const p = vp.toScreen(q.x, q.y);
      ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 7); ctx.fillStyle = i === this.sel ? '#3d8bfd' : '#ffd400'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#000'; ctx.stroke(); ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, 7); ctx.fillStyle = '#000'; ctx.fill();
    });
  }
}
