// Lazo magnético: el contorno se pega solo a los bordes de la imagen mientras mueves el ratón.
// El camino entre el último punto fijo y el ratón es el de menor coste sobre un mapa de bordes
// (Dijkstra en una ventana local, para que sea instantáneo incluso en imágenes grandes).

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import type { Viewport } from '../ui/viewport';
import { SelMode } from '../core/selection';
import { ctx2d } from '../core/canvas';

type Pt = { x: number; y: number };

/** Mapa de bordes (0 = sin borde, 255 = borde fuerte) de la imagen combinada. */
function edgeMap(src: HTMLCanvasElement) {
  const w = src.width, h = src.height, d = ctx2d(src).getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 0.3 + d[j + 1] * 0.59 + d[j + 2] * 0.11) * d[j + 3] / 255;
  const mag = new Float32Array(w * h); const hist = new Uint32Array(1024);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1];
    const gy = g[i + w - 1] + 2 * g[i + w] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - w] - g[i - w + 1];
    const m = Math.hypot(gx, gy); mag[i] = m; hist[Math.min(1023, m | 0)]++;
  }
  // se normaliza con el percentil 98 para que funcione igual con imágenes suaves o muy contrastadas
  let acc = 0, p98 = 1; const target = w * h * 0.98;
  for (let k = 0; k < 1024; k++) { acc += hist[k]; if (acc >= target) { p98 = Math.max(8, k); break; } }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(255, mag[i] / p98 * 255);
  return { w, h, e: out };
}

/** Camino de menor coste de a a b dentro de una ventana con margen. */
function liveWire(E: { w: number; h: number; e: Uint8Array }, a: Pt, b: Pt, margin: number, contrast: number): Pt[] {
  const ax = Math.round(a.x), ay = Math.round(a.y), bx = Math.round(b.x), by = Math.round(b.y);
  const x0 = Math.max(0, Math.min(ax, bx) - margin), y0 = Math.max(0, Math.min(ay, by) - margin);
  const x1 = Math.min(E.w - 1, Math.max(ax, bx) + margin), y1 = Math.min(E.h - 1, Math.max(ay, by) + margin);
  const W = x1 - x0 + 1, H = y1 - y0 + 1, N = W * H;
  if (W < 1 || H < 1) return [b];
  const inWin = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  if (!inWin(ax, ay) || !inWin(bx, by)) return [b];
  // coste por píxel: bajo en los bordes; el contraste mínimo atenúa los bordes débiles
  const thr = contrast * 2.55;
  const cost = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = E.e[(y + y0) * E.w + x + x0]; v = v < thr ? v * 0.3 : v;
    const t = 1 - v / 255; cost[y * W + x] = 0.15 + t * t * 6;
  }
  const dist = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  // montículo binario de índices
  const heap = new Int32Array(N * 4 + 16), hk = new Float32Array(N * 4 + 16); let hn = 0;
  const push = (i: number, k: number) => { let c = hn++; heap[c] = i; hk[c] = k; while (c > 0) { const p = (c - 1) >> 1; if (hk[p] <= hk[c]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; [hk[p], hk[c]] = [hk[c], hk[p]]; c = p; } };
  const pop = () => { const r = heap[0]; hn--; heap[0] = heap[hn]; hk[0] = hk[hn]; let c = 0; for (;;) { const l = 2 * c + 1, rr = l + 1; let m = c; if (l < hn && hk[l] < hk[m]) m = l; if (rr < hn && hk[rr] < hk[m]) m = rr; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; [hk[m], hk[c]] = [hk[c], hk[m]]; c = m; } return r; };
  const s = (ay - y0) * W + ax - x0, t = (by - y0) * W + bx - x0;
  dist[s] = 0; push(s, 0);
  const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1], DL = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
  while (hn > 0 && hn < heap.length - 8) {
    const i = pop(); if (done[i]) continue; done[i] = 1;
    if (i === t) break;
    const x = i % W, y = (i / W) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k]; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx; if (done[j]) continue;
      const nd = dist[i] + cost[j] * DL[k];
      if (nd < dist[j]) { dist[j] = nd; prev[j] = i; push(j, nd); }
    }
  }
  if (prev[t] < 0 && t !== s) return [b];
  const path: Pt[] = [];
  for (let i = t; i >= 0 && i !== s; i = prev[i]) path.push({ x: i % W + x0 + 0.5, y: ((i / W) | 0) + y0 + 0.5 });
  return path.reverse();
}

export class MagneticLassoTool implements Tool {
  id = 'magLasso'; name = 'Lazo magnético'; icon = icon('magLasso'); key = 'L'; group = 'lasso'; cursor = 'crosshair';
  options = [
    { key: 'mode', type: 'selmode', default: 'new' },
    { key: 'feather', label: 'Calar', type: 'range', min: 0, max: 100, default: 0, unit: 'px' },
    { key: 'width', label: 'Anchura', type: 'range', min: 1, max: 40, default: 10, unit: 'px' },
    { key: 'contrast', label: 'Contraste', type: 'range', min: 1, max: 100, default: 10, unit: '%' },
    { key: 'frequency', label: 'Frecuencia', type: 'range', min: 1, max: 100, default: 57 },
  ] as any[];
  /** Puntos ya fijados (contorno definitivo) y anclas (esquinas que puso el usuario o la herramienta). */
  private fixed: Pt[] = [];
  private anchors: Pt[] = [];
  private live: Pt[] = [];
  private mode: SelMode = 'new';
  private E: ReturnType<typeof edgeMap> | null = null;
  private eKey = '';
  private eDoc: object | null = null;

  private edges() {
    const d = app.doc!; const key = d.history.steps.length + ':' + d.history.index;
    if (!this.E || this.eKey !== key || this.eDoc !== d) { this.E = edgeMap(d.getComposite()); this.eKey = key; this.eDoc = d; }
    return this.E;
  }
  private addAnchor(p: Pt) { this.anchors.push(p); this.fixed.push(p); }

  down(e: ToolEvent) {
    const p = { x: e.x, y: e.y };
    if (!this.anchors.length) {
      const sm = app.opt<string>('mode', this.id) as SelMode;
      this.mode = e.shift && e.alt ? 'intersect' : e.shift ? 'add' : e.alt ? 'subtract' : sm;
      this.edges(); this.addAnchor(p); return;
    }
    const f = app.viewport.toScreen(this.anchors[0].x, this.anchors[0].y);
    if (e.detail >= 2 || (this.fixed.length > 6 && Math.hypot(f.x - e.sx, f.y - e.sy) < 9)) { this.close(); return; }
    // clic = fija el camino hasta aquí; Alt+clic = punto recto (como el lazo poligonal)
    if (!e.alt) this.fixed.push(...this.live);
    this.addAnchor(this.live.length && !e.alt ? this.live[this.live.length - 1] : p);
    this.live = [];
  }
  hover(e: ToolEvent) { this.track(e); }
  move(e: ToolEvent) { this.track(e); }
  private track(e: ToolEvent) {
    if (!this.anchors.length) return;
    const E = this.edges(), last = this.fixed[this.fixed.length - 1];
    const width = app.opt<number>('width', this.id), contrast = app.opt<number>('contrast', this.id);
    this.live = liveWire(E, last, { x: e.x, y: e.y }, Math.max(4, Math.round(width * 1.5)), contrast);
    // Frecuencia: cada cierta distancia se fija automáticamente una parte del camino
    const freq = app.opt<number>('frequency', this.id), step = Math.max(12, 220 - freq * 2) / Math.max(0.25, Math.min(4, app.viewport.zoom));
    if (this.live.length > step * 1.5) {
      const cut = Math.floor(this.live.length - step * 0.6);
      this.fixed.push(...this.live.slice(0, cut)); this.anchors.push(this.fixed[this.fixed.length - 1]);
      this.live = this.live.slice(cut);
    }
    app.viewport.requestRender();
  }
  private close() {
    const doc = app.doc!;
    const E = this.edges(), last = this.fixed[this.fixed.length - 1];
    const back = liveWire(E, last, this.anchors[0], 12, app.opt<number>('contrast', this.id));
    const pts = [...this.fixed, ...back];
    this.cancel();
    if (pts.length < 3) return;
    doc.selection.polygon(pts, this.mode);
    const f = app.opt<number>('feather', this.id); if (f > 0) doc.selection.feather(f / 2);
    doc.commit('Lazo magnético');
  }
  cancel() { this.fixed = []; this.anchors = []; this.live = []; app.viewport?.requestRender(); }
  deactivate() { this.cancel(); }
  key_(e: KeyboardEvent) {
    if (!this.anchors.length) return false;
    if (e.key === 'Enter') { this.close(); return true; }
    if (e.key === 'Escape') { this.cancel(); return true; }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      // quita la última ancla y el tramo que llevaba hasta ella
      const a = this.anchors.pop()!; const i = this.fixed.lastIndexOf(a); if (i >= 0) this.fixed.length = i;
      if (!this.anchors.length) this.cancel(); else { if (this.fixed[this.fixed.length - 1] !== this.anchors[this.anchors.length - 1]) this.fixed.push(this.anchors[this.anchors.length - 1]); }
      this.live = []; app.viewport.requestRender(); return true;
    }
    return false;
  }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (!this.anchors.length) return;
    const p = new Path2D();
    [...this.fixed, ...this.live].forEach((q, i) => i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y));
    vp.drawAnts(p);
    ctx.save(); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
    for (const a of this.anchors) { const s = vp.toScreen(a.x, a.y); ctx.fillRect(s.x - 2.5, s.y - 2.5, 5, 5); ctx.strokeRect(s.x - 2.5, s.y - 2.5, 5, 5); }
    ctx.restore();
  }
}
