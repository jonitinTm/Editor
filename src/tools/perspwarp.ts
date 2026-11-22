// Deformación de perspectiva (Edición › Deformación de perspectiva):
// 1) «Diseño»: se colocan 4 puntos sobre un plano de la foto (la fachada de un edificio, el suelo, una mesa…).
// 2) «Deformar»: se mueven esos puntos y toda la capa sigue la nueva perspectiva. Con «Verticales rectas» se
//    corrigen al momento las líneas que caen (edificios fotografiados desde abajo).

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import type { Viewport } from '../ui/viewport';
import { h } from '../ui/dom';
import { homography } from './transform';
import { getPaintTarget, setPreview, setTargetCanvas, type PaintTarget } from './paint';
import { makeCanvas, ctx2d } from '../core/canvas';

type P = { x: number; y: number };
const inv3 = (m: number[]) => {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = c * h - b * i, C = b * f - c * e, D = f * g - d * i, E = a * i - c * g, F = c * d - a * f, G = d * h - e * g, H = b * g - a * h, I = a * e - b * d;
  return [A, B, C, D, E, F, G, H, I];
};
const mul3 = (p: number[], q: number[]) => { const r = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += p[i * 3 + k] * q[k * 3 + j]; return r; };

/** Lleva cada punto del cuadrilátero `from` al cuadrilátero `to`, y con él toda la imagen. */
export function warpPerspective(src: HTMLCanvasElement, from: P[], to: P[], scale = 1): HTMLCanvasElement {
  // imagen de salida → (inversa de «to») cuadrado unidad → («from») imagen de origen
  const M = mul3(homography(from).m, inv3(homography(to).m));
  const W = Math.max(1, Math.round(src.width * scale)), H = Math.max(1, Math.round(src.height * scale));
  const sw = src.width, sh = src.height, S = ctx2d(src).getImageData(0, 0, sw, sh).data, out = new ImageData(W, H), o = out.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const X = (x + 0.5) / scale, Y = (y + 0.5) / scale, w = M[6] * X + M[7] * Y + M[8];
    if (w <= 1e-9) continue;
    const fx0 = (M[0] * X + M[1] * Y + M[2]) / w - 0.5, fy0 = (M[3] * X + M[4] * Y + M[5]) / w - 0.5;
    const ix = Math.floor(fx0), iy = Math.floor(fy0), fx = fx0 - ix, fy = fy0 - iy;
    if (ix < -1 || iy < -1 || ix >= sw || iy >= sh) continue;
    let r = 0, g = 0, b = 0, al = 0;
    for (let k = 0; k < 4; k++) {
      const px = ix + (k & 1), py = iy + (k >> 1); if (px < 0 || py < 0 || px >= sw || py >= sh) continue;
      const wt = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy), j = (py * sw + px) * 4, aa = S[j + 3] * wt;
      r += S[j] * aa; g += S[j + 1] * aa; b += S[j + 2] * aa; al += aa;
    }
    if (al <= 0) continue;
    const q = (y * W + x) * 4; o[q] = r / al; o[q + 1] = g / al; o[q + 2] = b / al; o[q + 3] = al;
  }
  const c = makeCanvas(W, H); ctx2d(c).putImageData(out, 0, 0);
  if (scale === 1) return c;
  const full = makeCanvas(src.width, src.height), fx = ctx2d(full); fx.imageSmoothingQuality = 'high'; fx.drawImage(c, 0, 0, src.width, src.height); return full;
}

export class PerspectiveWarpTool implements Tool {
  id = 'perspWarp'; name = 'Deformación de perspectiva'; icon = icon('perspCrop'); cursor = 'crosshair';
  private mode: 'layout' | 'warp' = 'layout';
  private from: P[] = []; private to: P[] = [];
  private t: PaintTarget | null = null;
  private drag = -1;
  private timer = 0;
  activate() {
    const d = app.doc, t = getPaintTarget();
    if (!d || !t || t.isMask) { app.toast('Elige una capa de imagen', 'warn'); setTimeout(() => app.restoreTool(), 0); return; }
    this.t = t; this.mode = 'layout';
    const W = d.width, H = d.height, mx = W * 0.2, my = H * 0.2;
    this.from = [{ x: mx, y: my }, { x: W - mx, y: my }, { x: W - mx, y: H - my }, { x: mx, y: H - my }];
    this.to = this.from.map(p => ({ ...p }));
    app.toast('Paso 1: arrastra las 4 esquinas sobre un plano de la foto (una fachada, el suelo…) y pulsa «Deformar»');
    app.emit('tool');
  }
  deactivate() { this.cancelPreview(); }
  docChanged() { this.cancelPreview(); this.t = null; }
  extraOptions(bar: HTMLElement) {
    const b = (label: string, on: boolean, fn: () => void, title = '') => h('button', { class: 'btn' + (on ? ' on' : ''), type: 'button', title, onclick: fn }, label);
    bar.append(
      h('div', { class: 'btn-group' }, b('1 · Diseño', this.mode === 'layout', () => this.setMode('layout'), 'Coloca el plano sobre la foto'), b('2 · Deformar', this.mode === 'warp', () => this.setMode('warp'), 'Mueve las esquinas para cambiar la perspectiva')),
      b('Verticales rectas', false, () => this.straighten('v'), 'Pone rectas las líneas verticales del plano (edificios)'),
      b('Horizontales rectas', false, () => this.straighten('h')),
      h('button', { class: 'btn icon-btn ok', type: 'button', title: 'Aplicar (Intro)', html: icon('check'), onclick: () => this.apply() }),
      h('button', { class: 'btn icon-btn', type: 'button', title: 'Cancelar (Esc)', html: icon('close'), onclick: () => this.cancel() }));
  }
  private setMode(m: 'layout' | 'warp') {
    if (m === 'warp' && this.mode === 'layout') this.to = this.from.map(p => ({ ...p }));
    this.mode = m; app.emit('tool'); this.schedule(); app.viewport.requestRender();
  }
  private straighten(kind: 'v' | 'h') {
    if (this.mode === 'layout') this.setMode('warp');
    const q = this.to;
    if (kind === 'v') { const l = (q[0].x + q[3].x) / 2, r = (q[1].x + q[2].x) / 2; q[0].x = q[3].x = l; q[1].x = q[2].x = r; }
    else { const t = (q[0].y + q[1].y) / 2, bb = (q[2].y + q[3].y) / 2; q[0].y = q[1].y = t; q[2].y = q[3].y = bb; }
    this.schedule(); app.viewport.requestRender();
  }
  private pts() { return this.mode === 'layout' ? this.from : this.to; }
  down(e: ToolEvent) {
    const vp = app.viewport; this.drag = this.pts().findIndex(p => { const s = vp.toScreen(p.x, p.y); return Math.hypot(s.x - e.sx, s.y - e.sy) < 14; });
  }
  move(e: ToolEvent) {
    if (this.drag < 0) return;
    const p = this.pts()[this.drag]; p.x = e.x; p.y = e.y;
    if (this.mode === 'warp') this.schedule(); app.viewport.requestRender();
  }
  up() { this.drag = -1; }
  /** Vista previa a resolución reducida mientras se deforma. */
  private schedule() {
    clearTimeout(this.timer);
    if (this.mode !== 'warp' || !this.t) { this.cancelPreview(); return; }
    this.timer = window.setTimeout(() => {
      const t = this.t; if (!t) return;
      const sc = Math.min(1, 900 / Math.max(t.canvas.width, t.canvas.height));
      setPreview(t, warpPerspective(t.canvas, this.from, this.to, sc));
    }, 30);
  }
  private cancelPreview() { clearTimeout(this.timer); if (this.t) setPreview(this.t, null); app.doc?.invalidate(); }
  apply() {
    const t = this.t, d = app.doc; if (!t || !d) return;
    if (this.mode === 'layout' || this.to.every((p, i) => Math.hypot(p.x - this.from[i].x, p.y - this.from[i].y) < 0.5)) { app.toast('Pasa a «Deformar» y mueve las esquinas', 'warn'); return; }
    clearTimeout(this.timer); setPreview(t, null);
    setTargetCanvas(t, warpPerspective(t.canvas, this.from, this.to)); d.commit('Deformación de perspectiva');
    this.t = null; app.restoreTool();
  }
  cancel() { this.cancelPreview(); this.t = null; app.restoreTool(); }
  key_(e: KeyboardEvent) { if (e.key === 'Enter') { this.apply(); return true; } if (e.key === 'Escape') { this.cancel(); return true; } return false; }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const q = this.pts().map(p => vp.toScreen(p.x, p.y)); if (q.length < 4) return;
    ctx.save();
    ctx.strokeStyle = this.mode === 'layout' ? '#3d8bfd' : '#ffb020'; ctx.lineWidth = 2; ctx.beginPath(); q.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
    // rejilla del plano
    ctx.lineWidth = 1; ctx.globalAlpha = 0.6; ctx.beginPath();
    const Hm = homography(this.pts());
    for (let k = 1; k < 4; k++) { const a = vp.toScreen(Hm(k / 4, 0).x, Hm(k / 4, 0).y), b = vp.toScreen(Hm(k / 4, 1).x, Hm(k / 4, 1).y), c = vp.toScreen(Hm(0, k / 4).x, Hm(0, k / 4).y), dd = vp.toScreen(Hm(1, k / 4).x, Hm(1, k / 4).y); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.moveTo(c.x, c.y); ctx.lineTo(dd.x, dd.y); }
    ctx.stroke(); ctx.globalAlpha = 1;
    for (const p of q) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, 7); ctx.fill(); ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5; ctx.stroke(); }
    ctx.restore();
  }
}
