// Selección rápida: pintas sobre lo que quieres seleccionar y la selección
// crece sola por las zonas de color parecido, deteniéndose en los bordes.

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import type { Viewport } from '../ui/viewport';
import { makeCanvas, ctx2d, getPixels, cloneCanvas } from '../core/canvas';
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
    { key: 'enhance', label: 'Mejora automática', type: 'checkbox', default: false },
  ] as any[];
  private data: Uint8ClampedArray | null = null;
  private mark: Uint8Array | null = null;
  private maskCanvas: HTMLCanvasElement | null = null;
  private base: HTMLCanvasElement | null = null;
  private mode: SelMode = 'add';
  private last: { x: number; y: number } | null = null;
  private timer = 0;
  private dirty = false;
  /** Selección resultante, que se va construyendo por trozos mientras se arrastra (sin rehacer la imagen entera). */
  private result: HTMLCanvasElement | null = null;
  private pending: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private bounds: { x: number; y: number; w: number; h: number } | null = null;

  down(e: ToolEvent) {
    const d = app.doc!;
    const src = app.opt('all', this.id) || !d.activeRaster() ? d.flatten() : d.activeRaster()!.canvas;
    this.data = getPixels(src).data;
    this.mark = new Uint8Array(d.width * d.height);
    this.maskCanvas = makeCanvas(1, 1); // solo indica que hay un trazo en curso (las marcas están en this.mark)
    this.mode = e.alt ? 'subtract' : (e.shift || d.selection.active) ? 'add' : 'new';
    this.base = d.selection.mask;
    this.result = this.mode !== 'new' && this.base ? cloneCanvas(this.base) : makeCanvas(d.width, d.height);
    this.bounds = this.mode !== 'new' && this.base ? d.selection.bounds : null;
    this.last = null;
    this.dab(e.x, e.y);
    this.apply();
  }
  move(e: ToolEvent) {
    if (!this.mark || !this.last) return;
    const r = app.opt<number>('size', this.id) / 2, dist = Math.hypot(e.x - this.last.x, e.y - this.last.y), step = Math.max(2, r * 1.0);
    for (let t = step; t <= dist; t += step) this.dab(this.last.x + (e.x - this.last.x) * t / dist, this.last.y + (e.y - this.last.y) * t / dist);
    if (dist >= step) this.dab(e.x, e.y);
    // la selección en pantalla se pone al día una vez por fotograma como mucho
    if (!this.timer) this.timer = requestAnimationFrame(() => { this.timer = 0; this.apply(); });
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
    const LW = x1 - x0 + 1;
    // vecino (qx, qy) del píxel p: se añade si se parece al color del pincel y no hay un borde entre los dos
    const visit = (i: number, qx: number, qy: number) => {
      const l = (qy - y0) * LW + qx - x0; if (seen[l]) return; seen[l] = 1;
      const q = qy * W + qx, j = q * 4;
      const a = px[j] - mr, b = px[j + 1] - mg, c = px[j + 2] - mb, e = px[j] - px[i], f = px[j + 1] - px[i + 1], g = px[j + 2] - px[i + 2];
      if (a * a + b * b + c * c <= tol2 && e * e + f * f + g * g <= edge2) stack.push(q);
    };
    while (stack.length) {
      const p = stack.pop()!, x = p % W, y = (p - x) / W, i = p * 4;
      mark[p] = 1;
      if (x > x0) visit(i, x - 1, y); if (x < x1) visit(i, x + 1, y);
      if (y > y0) visit(i, x, y - 1); if (y < y1) visit(i, x, y + 1);
    }
    // la zona marcada se pasa al lienzo una vez por fotograma (en apply), no en cada toque
    const pd = this.pending; this.pending = pd ? { x0: Math.min(pd.x0, x0), y0: Math.min(pd.y0, y0), x1: Math.max(pd.x1, x1), y1: Math.max(pd.y1, y1) } : { x0, y0, x1, y1 };
    this.dirty = true;
  }
  private apply() {
    if (!this.dirty || !this.maskCanvas || !this.result) return;
    this.dirty = false;
    const d = app.doc!, sel = d.selection, pd = this.pending; this.pending = null;
    if (pd) {
      // solo la zona que cambió: las marcas pasan a imagen y (con el borde suavizado) a la selección resultante
      const m = 2, x = Math.max(0, pd.x0 - m), y = Math.max(0, pd.y0 - m), w = Math.min(d.width, pd.x1 + m + 1) - x, h = Math.min(d.height, pd.y1 + m + 1) - y;
      const mark = this.mark!, W = d.width, src = makeCanvas(w, h), sc = ctx2d(src), img = sc.createImageData(w, h), o = img.data;
      for (let yy = 0; yy < h; yy++) for (let xx = 0, k = (y + yy) * W + x, q = yy * w * 4 + 3; xx < w; xx++, k++, q += 4) if (mark[k]) { o[q - 3] = o[q - 2] = o[q - 1] = o[q] = 255; }
      sc.putImageData(img, 0, 0);
      const tmp = makeCanvas(w, h), t = ctx2d(tmp); t.filter = 'blur(0.6px)'; t.drawImage(src, 0, 0); t.filter = 'none';
      const r = ctx2d(this.result); r.save(); r.globalCompositeOperation = this.mode === 'subtract' ? 'destination-out' : 'lighten'; r.drawImage(tmp, x, y); r.restore();
    }
    // zona de la selección: la anterior más lo pintado (al restar, la anterior basta como margen)
    const b0 = this.bounds, add = pd && this.mode !== 'subtract' ? { x: Math.max(0, pd.x0 - 2), y: Math.max(0, pd.y0 - 2), w: Math.min(d.width, pd.x1 + 3) - Math.max(0, pd.x0 - 2), h: Math.min(d.height, pd.y1 + 3) - Math.max(0, pd.y0 - 2) } : null;
    this.bounds = !b0 ? add : !add ? b0 : { x: Math.min(b0.x, add.x), y: Math.min(b0.y, add.y), w: Math.max(b0.x + b0.w, add.x + add.w) - Math.min(b0.x, add.x), h: Math.max(b0.y + b0.h, add.y + add.h) - Math.min(b0.y, add.y) };
    if (this.bounds) sel.setMaskShared(this.result, this.bounds); else sel.setMaskShared(this.result);
    d.changed();
  }
  up() {
    if (!this.mark) return;
    cancelAnimationFrame(this.timer); this.timer = 0; this.dirty = true; this.apply();
    // la selección se queda con su propia copia
    if (this.result) app.doc!.selection.setMask(this.result);
    this.data = null; this.mark = null; this.maskCanvas = null; this.base = null; this.result = null;
    // mejora automática: borde menos escalonado y más ajustado
    if (app.opt('enhance', this.id) && app.doc!.selection.mask) app.doc!.selection.smooth(2);
    app.doc!.commit('Selección rápida');
  }
  cancel() { cancelAnimationFrame(this.timer); this.timer = 0; if (this.mark) { app.doc!.selection.setMask(this.base); this.data = null; this.mark = null; this.maskCanvas = null; this.result = null; } }
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
