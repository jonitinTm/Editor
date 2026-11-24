// Herramientas de retoque local: desenfocar, enfocar, dedo, sobreexponer y subexponer.
// Modifican los píxeles que hay bajo el pincel, con más fuerza en el centro.

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import type { Viewport } from '../ui/viewport';
import { cloneCanvas, ctx2d } from '../core/canvas';
import { getPaintTarget, setPreview, setTargetCanvas, PaintTarget } from './paint';
import { drawBrushCursor } from './brush';

type Mode = 'blur' | 'sharpen' | 'smudge' | 'dodge' | 'burn' | 'sponge';

class RetouchTool implements Tool {
  cursor = 'none';
  options = [
    { key: 'size', label: 'Tamaño', type: 'range', min: 1, max: 500, default: 40, unit: 'px' },
    { key: 'strength', label: this.mode === 'dodge' || this.mode === 'burn' ? 'Exposición' : this.mode === 'sponge' ? 'Flujo' : 'Intensidad', type: 'range', min: 1, max: 100, default: 50, unit: '%' },
    { key: 'hardness', label: 'Dureza', type: 'range', min: 0, max: 100, default: 0, unit: '%' },
    ...(this.mode === 'sponge' ? [{ key: 'spongeMode', label: 'Modo', type: 'select', default: 'desat', choices: [{ value: 'desat', label: 'Reducir saturación' }, { value: 'sat', label: 'Saturar' }] },
      { key: 'vibrance', label: 'Intensidad natural', type: 'checkbox', default: true }] : []),
    ...(this.mode === 'dodge' || this.mode === 'burn' ? [{ key: 'range', label: 'Rango', type: 'select', default: 'mid', choices: [{ value: 'shadows', label: 'Sombras' }, { value: 'mid', label: 'Medios tonos' }, { value: 'high', label: 'Iluminaciones' }] },
      { key: 'protect', label: 'Proteger tonos', type: 'checkbox', default: true }] : []),
    ...(this.mode === 'smudge' ? [{ key: 'finger', label: 'Pintura con los dedos', type: 'checkbox', default: false }] : []),
    ...(this.mode === 'sharpen' ? [{ key: 'protect', label: 'Proteger detalles', type: 'checkbox', default: true }] : []),
  ] as any[];
  private t: PaintTarget | null = null;
  private work: HTMLCanvasElement | null = null;
  private last: { x: number; y: number } | null = null;
  private carry: Float32Array | null = null; // color arrastrado por el dedo
  private changed = false;
  private fingered = false;
  constructor(public id: string, public name: string, public icon: string, private mode: Mode, public group: string, public key?: string) {}

  down(e: ToolEvent) {
    const t = getPaintTarget(); if (!t) return;
    if (t.isMask) { app.toast('Esta herramienta trabaja sobre los píxeles de la capa, no sobre la máscara', 'warn'); return; }
    this.t = t; this.work = cloneCanvas(t.canvas); this.carry = null; this.changed = false; this.fingered = false;
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
    if (mode === 'smudge' && (!this.carry || this.carry.length !== d.length)) {
      this.carry = Float32Array.from(src);
      // pintura con los dedos: el primer toque lleva el color frontal
      if (app.opt('finger', this.id) && !this.fingered) { const fg = app.fg; const rgb = [1, 3, 5].map(i => parseInt(fg.slice(i, i + 2), 16)); for (let i = 0; i < this.carry.length; i += 4) { this.carry[i] = rgb[0]; this.carry[i + 1] = rgb[1]; this.carry[i + 2] = rgb[2]; this.carry[i + 3] = 255; } this.fingered = true; }
    }
    const hard = (app.opt<number>('hardness', this.id) ?? 0) / 100, range = app.opt<string>('range', this.id) || 'mid', protect = app.opt('protect', this.id) !== false, vib = app.opt('vibrance', this.id) !== false;
    const carry = this.carry;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dist = Math.hypot(x0 + x + 0.5 - cx, y0 + y + 0.5 - cy) / r; if (dist >= 1) continue;
      // dureza: zona central a fuerza completa y caída suave hasta el borde
      const fall = dist <= hard ? 1 : 1 - ((dist - hard) / Math.max(1e-6, 1 - hard)) ** 2;
      let f = fall * k * (sel ? sel[(y * w + x) * 4 + 3] / 255 : 1);
      const i = (y * w + x) * 4;
      if (mode === 'blur' || mode === 'sharpen') {
        const xa = Math.max(0, x - 1), xb = Math.min(w - 1, x + 1), ya = Math.max(0, y - 1), yb = Math.min(h - 1, y + 1);
        for (let ch = 0; ch < 4; ch++) {
          let s = 0; for (const yy of [ya, y, yb]) for (const xx of [xa, x, xb]) s += src[(yy * w + xx) * 4 + ch];
          const avg = s / 9;
          if (mode === 'blur') { d[i + ch] = src[i + ch] + (avg - src[i + ch]) * f; continue; }
          if (ch === 3) { d[i + 3] = src[i + 3]; continue; }
          let v = src[i + ch] + (src[i + ch] - avg) * f * 1.5;
          if (protect) {
            // proteger detalles: sin halos (no se pasa de los vecinos) y sin realzar el ruido fino
            let lo = 255, hi = 0; for (const yy of [ya, y, yb]) for (const xx of [xa, x, xb]) { const q = src[(yy * w + xx) * 4 + ch]; if (q < lo) lo = q; if (q > hi) hi = q; }
            if (hi - lo < 6) v = src[i + ch]; else v = Math.max(lo, Math.min(hi, v));
          }
          d[i + ch] = v;
        }
      } else if (mode === 'dodge' || mode === 'burn') {
        const L = (src[i] * 0.3 + src[i + 1] * 0.59 + src[i + 2] * 0.11) / 255;
        // cuánto afecta según el rango elegido
        const wgt = range === 'shadows' ? (1 - L) ** 2 : range === 'high' ? L * L : 1 - Math.abs(2 * L - 1) ** 1.5;
        f *= 0.35 * wgt;
        if (protect && L > 0.002) {
          // proteger tonos: se cambia la luz conservando el tono y la saturación
          const nL = mode === 'dodge' ? L + (1 - L) * f : L * (1 - f), r0 = nL / L;
          for (let ch = 0; ch < 3; ch++) d[i + ch] = src[i + ch] * r0;
        } else for (let ch = 0; ch < 3; ch++) d[i + ch] = mode === 'dodge' ? src[i + ch] + (255 - src[i + ch]) * f : src[i + ch] * (1 - f);
      } else if (mode === 'sponge') {
        // Esponja: acerca (o aleja) cada canal de la luminosidad del píxel
        const l = src[i] * 0.3 + src[i + 1] * 0.59 + src[i + 2] * 0.11, sat = app.opt('spongeMode', this.id) === 'sat';
        f *= 0.3;
        if (vib && sat) {
          // intensidad natural: los colores ya saturados (y los tonos de piel) cambian poco
          const mx = Math.max(src[i], src[i + 1], src[i + 2]), mn = Math.min(src[i], src[i + 1], src[i + 2]), cs = mx ? (mx - mn) / mx : 0;
          const skin = src[i] > src[i + 1] && src[i + 1] > src[i + 2] && src[i] - src[i + 2] > 15 ? 0.5 : 1;
          f *= (1 - cs) * skin;
        }
        for (let ch = 0; ch < 3; ch++) d[i + ch] = sat ? src[i + ch] + (src[i + ch] - l) * f : src[i + ch] + (l - src[i + ch]) * f;
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
    if (this.changed) { const z = setTargetCanvas(t, this.work, 'auto'); app.doc!.commit(this.name, z); }
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
  new RetouchTool('sponge', 'Esponja', icon('sponge'), 'sponge', 'tone', 'O'),
];
