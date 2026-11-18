// Selección rápida: pintas sobre lo que quieres seleccionar y la selección
// crece sola por las zonas de color parecido, deteniéndose en los bordes.

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import type { Viewport } from '../ui/viewport';
import { makeCanvas, ctx2d, getPixels } from '../core/canvas';
import { SelMode } from '../core/selection';
import { isRaster } from '../core/layers';
import { drawBrushCursor } from './brush';

export class QuickSelectTool implements Tool {
  id = 'quickSel'; name = 'Selección rápida'; icon = icon('quickSel'); key = 'W'; group = 'wand'; cursor = 'none';
  extraOptions(bar: HTMLElement) { const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Seleccionar sujeto'; b.onclick = () => import('../ui/ops').then(o => o.selectSubjectOp()); bar.append(b); }
  options = [
    { key: 'size', label: 'Tamaño', type: 'range', min: 2, max: 500, default: 30, unit: 'px' },
    { key: 'tolerance', label: 'Tolerancia', type: 'range', min: 5, max: 120, default: 32 },
    { key: 'all', label: 'Todas las capas', type: 'checkbox', default: true },
  ] as any[];
  private data: Uint8ClampedArray | null = null;
  private mark: Uint8Array | null = null;
  private maskCanvas: HTMLCanvasElement | null = null;
  private base: HTMLCanvasElement | null = null;
  private mode: SelMode = 'add';
  private last: { x: number; y: number } | null = null;
  private timer = 0;
  private dirty = false;

  down(e: ToolEvent) {
    const d = app.doc!;
    const src = app.opt('all', this.id) || !d.activeRaster() ? d.flatten() : d.activeRaster()!.canvas;
    this.data = getPixels(src).data;
    this.mark = new Uint8Array(d.width * d.height);
    this.maskCanvas = makeCanvas(d.width, d.height);
    this.mode = e.alt ? 'subtract' : (e.shift || d.selection.active) ? 'add' : 'new';
    this.base = d.selection.mask;
    this.last = null;
    this.dab(e.x, e.y);
    this.apply();
  }
  move(e: ToolEvent) {
    if (!this.mark || !this.last) return;
    const r = app.opt<number>('size', this.id) / 2, dist = Math.hypot(e.x - this.last.x, e.y - this.last.y), step = Math.max(2, r * 0.6);
    for (let t = step; t <= dist; t += step) this.dab(this.last.x + (e.x - this.last.x) * t / dist, this.last.y + (e.y - this.last.y) * t / dist);
    if (dist >= step) this.dab(e.x, e.y);
    if (!this.timer) this.timer = window.setTimeout(() => { this.timer = 0; this.apply(); }, 60);
  }
  /** Un toque: crecimiento por color desde los píxeles bajo el pincel. */
  private dab(cx: number, cy: number) {
    this.last = { x: cx, y: cy };
    const d = app.doc!, W = d.width, H = d.height, px = this.data!, mark = this.mark!;
    const r = Math.max(1, app.opt<number>('size', this.id) / 2), R = Math.round(Math.max(r * 6, 60));
    const x0 = Math.max(0, Math.round(cx - R)), y0 = Math.max(0, Math.round(cy - R)), x1 = Math.min(W - 1, Math.round(cx + R)), y1 = Math.min(H - 1, Math.round(cy + R));
    // color medio y dispersión bajo el pincel
    let n = 0, mr = 0, mg = 0, mb = 0, vr = 0;
    const seeds: number[] = [];
    for (let y = Math.max(0, Math.round(cy - r)); y <= Math.min(H - 1, Math.round(cy + r)); y++) for (let x = Math.max(0, Math.round(cx - r)); x <= Math.min(W - 1, Math.round(cx + r)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = (y * W + x) * 4; mr += px[i]; mg += px[i + 1]; mb += px[i + 2]; n++; seeds.push(y * W + x);
    }
    if (!n) return;
    mr /= n; mg /= n; mb /= n;
    // ruido local: diferencia media entre píxeles vecinos bajo el pincel
    let nd = 0, sd = 0;
    for (const s of seeds) {
      const i = s * 4; vr += (px[i] - mr) ** 2 + (px[i + 1] - mg) ** 2 + (px[i + 2] - mb) ** 2;
      if (s % W < W - 1) { const j = i + 4; sd += Math.sqrt((px[i] - px[j]) ** 2 + (px[i + 1] - px[j + 1]) ** 2 + (px[i + 2] - px[j + 2]) ** 2); nd++; }
    }
    const base = app.opt<number>('tolerance', this.id), std = Math.sqrt(vr / n), noise = nd ? sd / nd : 0;
    // color: margen amplio (los degradados suaves deben pasar); borde: depende del ruido
    const tol = base * 2.5 + std * 2, tol2 = tol * tol, edge = Math.max(base * 0.8, noise * 2.6 + 6), edge2 = edge * edge;
    const seen = new Uint8Array((x1 - x0 + 1) * (y1 - y0 + 1)), stack: number[] = [];
    const local = (p: number) => ((p / W | 0) - y0) * (x1 - x0 + 1) + (p % W) - x0;
    for (const s of seeds) { seen[local(s)] = 1; stack.push(s); }
    while (stack.length) {
      const p = stack.pop()!, x = p % W, y = p / W | 0, i = p * 4;
      mark[p] = 1;
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        const qx = q % W, qy = q / W | 0;
        if (q < 0 || qy < y0 || qy > y1 || qx < x0 || qx > x1 || Math.abs(qx - x) > 1) continue;
        const l = local(q); if (seen[l]) continue; seen[l] = 1;
        const j = q * 4;
        const dm = (px[j] - mr) ** 2 + (px[j + 1] - mg) ** 2 + (px[j + 2] - mb) ** 2;
        const de = (px[j] - px[i]) ** 2 + (px[j + 1] - px[i + 1]) ** 2 + (px[j + 2] - px[i + 2]) ** 2;
        if (dm <= tol2 && de <= edge2) stack.push(q);
      }
    }
    // pasa la zona marcada al lienzo de la máscara
    const w = x1 - x0 + 1, h = y1 - y0 + 1, img = ctx2d(this.maskCanvas!).getImageData(x0, y0, w, h), o = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mark[(y0 + y) * W + x0 + x]) { const k = (y * w + x) * 4; o[k] = o[k + 1] = o[k + 2] = o[k + 3] = 255; }
    ctx2d(this.maskCanvas!).putImageData(img, x0, y0);
    this.dirty = true;
  }
  private apply() {
    if (!this.dirty || !this.maskCanvas) return;
    this.dirty = false;
    const d = app.doc!, sel = d.selection;
    sel.setMask(this.base);
    const m = makeCanvas(d.width, d.height), c = ctx2d(m);
    c.filter = 'blur(0.6px)'; c.drawImage(this.maskCanvas, 0, 0); c.filter = 'none';
    sel.combineCanvas(this.mode, m);
    d.changed();
  }
  up() {
    if (!this.mark) return;
    clearTimeout(this.timer); this.timer = 0; this.dirty = true; this.apply();
    this.data = null; this.mark = null; this.maskCanvas = null; this.base = null;
    app.doc!.commit('Selección rápida');
  }
  cancel() { if (this.mark) { app.doc!.selection.setMask(this.base); this.data = null; this.mark = null; this.maskCanvas = null; } }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    drawBrushCursor(ctx, vp, app.opt<number>('size', this.id));
    if (vp.mouseScreen) { const { x, y } = vp.mouseScreen; ctx.fillStyle = '#fff'; ctx.font = 'bold 12px system-ui'; ctx.fillText(app.viewport.isSpaceDown() ? '' : '+', x + 6, y - 6); }
  }
}

/** Selección de objetos: arrastra un rectángulo alrededor de algo y se selecciona solo el objeto de dentro. */
export class ObjectSelectTool implements Tool {
  id = 'objectSel'; name = 'Selección de objetos'; icon = icon('objectSel'); key = 'W'; group = 'wand'; cursor = 'crosshair';
  options = [{ key: 'all', label: 'Todas las capas', type: 'checkbox', default: true }] as any[];
  private a: { x: number; y: number } | null = null; private b: { x: number; y: number } | null = null; private mode: 'new' | 'add' | 'subtract' = 'new';
  extraOptions(bar: HTMLElement) { bar.append(Object.assign(document.createElement('span'), { className: 'hint', textContent: 'Arrastra un rectángulo alrededor del objeto · Mayús: añadir · Alt: restar' })); }
  down(e: ToolEvent) { this.a = { x: e.x, y: e.y }; this.b = { ...this.a }; this.mode = e.shift ? 'add' : e.alt ? 'subtract' : 'new'; }
  move(e: ToolEvent) { if (this.a) { this.b = { x: e.x, y: e.y }; app.viewport.requestRender(); } }
  async up() {
    const a = this.a, b = this.b, d = app.doc; this.a = this.b = null; if (!a || !b || !d) return;
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x))), y0 = Math.max(0, Math.floor(Math.min(a.y, b.y))), x1 = Math.min(d.width, Math.ceil(Math.max(a.x, b.x))), y1 = Math.min(d.height, Math.ceil(Math.max(a.y, b.y)));
    if (x1 - x0 < 6 || y1 - y0 < 6) { app.viewport.requestRender(); return; }
    app.toast('Buscando el objeto…'); await new Promise(r => setTimeout(r, 20));
    const src = app.opt('all', this.id) || !d.active || !isRaster(d.active) ? d.getComposite() : d.active.canvas;
    // un margen alrededor del rectángulo hace de «fondo» para distinguir el objeto
    const mx = Math.round((x1 - x0) * 0.08) + 4, my = Math.round((y1 - y0) * 0.08) + 4;
    const cx0 = Math.max(0, x0 - mx), cy0 = Math.max(0, y0 - my), cx1 = Math.min(d.width, x1 + mx), cy1 = Math.min(d.height, y1 + my);
    const crop = makeCanvas(cx1 - cx0, cy1 - cy0); ctx2d(crop).drawImage(src, -cx0, -cy0);
    const { selectSubject } = await import('../filters/subject');
    const m = selectSubject(crop);
    if (!m) { app.toast('No se ha encontrado un objeto claro dentro del rectángulo', 'warn'); app.viewport.requestRender(); return; }
    const full = makeCanvas(d.width, d.height), fx = ctx2d(full);
    fx.save(); fx.beginPath(); fx.rect(x0, y0, x1 - x0, y1 - y0); fx.clip(); fx.drawImage(m, cx0, cy0); fx.restore();
    d.selection.combineCanvas(this.mode, full);
    d.commit('Selección de objetos');
  }
  cancel() { this.a = this.b = null; }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (!this.a || !this.b) return;
    const p = vp.toScreen(Math.min(this.a.x, this.b.x), Math.min(this.a.y, this.b.y)), q = vp.toScreen(Math.max(this.a.x, this.b.x), Math.max(this.a.y, this.b.y));
    ctx.save(); ctx.strokeStyle = '#3d8bfd'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeRect(p.x, p.y, q.x - p.x, q.y - p.y); ctx.restore();
  }
}
