// Herramientas de retoque local: desenfocar, enfocar, dedo, sobreexponer y subexponer.
// Modifican los píxeles que hay bajo el pincel, con más fuerza en el centro.

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import type { Viewport } from '../ui/viewport';
import { cloneCanvas, ctx2d } from '../core/canvas';
import { getPaintTarget, setPreview, setTargetCanvas, PaintTarget } from './paint';
import { drawBrushCursor } from './brush';

type Mode = 'blur' | 'sharpen' | 'smudge' | 'dodge' | 'burn';

class RetouchTool implements Tool {
  cursor = 'none';
  options = [
    { key: 'size', label: 'Tamaño', type: 'range', min: 1, max: 500, default: 40, unit: 'px' },
    { key: 'strength', label: this.mode === 'dodge' || this.mode === 'burn' ? 'Exposición' : 'Intensidad', type: 'range', min: 1, max: 100, default: 50, unit: '%' },
  ] as any[];
  private t: PaintTarget | null = null;
  private work: HTMLCanvasElement | null = null;
  private last: { x: number; y: number } | null = null;
  private carry: Float32Array | null = null; // color arrastrado por el dedo
  private changed = false;
  constructor(public id: string, public name: string, public icon: string, private mode: Mode, public group: string, public key?: string) {}

  down(e: ToolEvent) {
    const t = getPaintTarget(); if (!t) return;
    if (t.isMask) { app.toast('Esta herramienta trabaja sobre los píxeles de la capa, no sobre la máscara', 'warn'); return; }
    this.t = t; this.work = cloneCanvas(t.canvas); this.carry = null; this.changed = false;
    setPreview(t, this.work);
    this.last = { x: e.x, y: e.y }; this.dab(e.x, e.y);
  }
  move(e: ToolEvent) {
    if (!this.work || !this.last) return;
    const size = app.opt<number>('size', this.id), step = Math.max(1, size * (this.mode === 'smudge' ? 0.08 : 0.2));
    const d = Math.hypot(e.x - this.last.x, e.y - this.last.y);
    for (let s = step; s <= d; s += step) this.dab(this.last.x + (e.x - this.last.x) * s / d, this.last.y + (e.y - this.last.y) * s / d);
    if (d >= step) this.last = { x: e.x, y: e.y };
  }
  private dab(cx: number, cy: number) {
    const c = this.work!, size = app.opt<number>('size', this.id), r = size / 2, k = app.opt<number>('strength', this.id) / 100;
    const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r)), x1 = Math.min(c.width, Math.ceil(cx + r)), y1 = Math.min(c.height, Math.ceil(cy + r));
    const w = x1 - x0, h = y1 - y0; if (w < 1 || h < 1) return;
    const ctx = ctx2d(c), img = ctx.getImageData(x0, y0, w, h), d = img.data, src = new Uint8ClampedArray(d);
    const sel = app.doc!.selection.mask ? ctx2d(app.doc!.selection.mask).getImageData(x0, y0, w, h).data : null;
    const mode = this.mode;
    if (mode === 'smudge' && (!this.carry || this.carry.length !== d.length)) { this.carry = Float32Array.from(src); }
    const carry = this.carry;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dist = Math.hypot(x0 + x + 0.5 - cx, y0 + y + 0.5 - cy) / r; if (dist >= 1) continue;
      let f = (1 - dist * dist) * k * (sel ? sel[(y * w + x) * 4 + 3] / 255 : 1);
      const i = (y * w + x) * 4;
      if (mode === 'blur' || mode === 'sharpen') {
        const xa = Math.max(0, x - 1), xb = Math.min(w - 1, x + 1), ya = Math.max(0, y - 1), yb = Math.min(h - 1, y + 1);
        for (let ch = 0; ch < 4; ch++) {
          let s = 0; for (const yy of [ya, y, yb]) for (const xx of [xa, x, xb]) s += src[(yy * w + xx) * 4 + ch];
          const avg = s / 9;
          d[i + ch] = mode === 'blur' ? src[i + ch] + (avg - src[i + ch]) * f : ch === 3 ? src[i + 3] : src[i + ch] + (src[i + ch] - avg) * f * 1.5;
        }
      } else if (mode === 'dodge' || mode === 'burn') {
        f *= 0.25;
        for (let ch = 0; ch < 3; ch++) d[i + ch] = mode === 'dodge' ? src[i + ch] + (255 - src[i + ch]) * f * (0.4 + src[i + ch] / 255) : src[i + ch] * (1 - f);
      } else if (carry) {
        f = Math.min(0.95, f * 1.6);
        for (let ch = 0; ch < 4; ch++) { const v = src[i + ch] + (carry[i + ch] - src[i + ch]) * f; carry[i + ch] = carry[i + ch] * 0.75 + src[i + ch] * 0.25; d[i + ch] = v; }
      }
    }
    ctx.putImageData(img, x0, y0);
    this.changed = true;
    app.doc!.invalidate({ x: x0, y: y0, w, h });
  }
  up() {
    const t = this.t; if (!t || !this.work) return;
    setPreview(t, null);
    if (this.changed) { setTargetCanvas(t, this.work); app.doc!.commit(this.name); }
    this.t = null; this.work = null; this.last = null;
  }
  cancel() { if (this.t) setPreview(this.t, null); this.t = null; this.work = null; app.doc?.invalidate(); }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) { drawBrushCursor(ctx, vp, app.opt<number>('size', this.id)); }
}

export const retouchTools = () => [
  new RetouchTool('blurTool', 'Desenfocar', icon('drop'), 'blur', 'focus'),
  new RetouchTool('sharpenTool', 'Enfocar', icon('triangle'), 'sharpen', 'focus'),
  new RetouchTool('smudge', 'Dedo', icon('finger'), 'smudge', 'focus'),
  new RetouchTool('dodge', 'Sobreexponer', icon('dodge'), 'dodge', 'tone', 'O'),
  new RetouchTool('burn', 'Subexponer', icon('burn'), 'burn', 'tone', 'O'),
];
