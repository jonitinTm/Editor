// Selección: un lienzo del tamaño del documento cuyo alfa indica cuánto está
// seleccionado cada píxel (0 = nada, 255 = todo). null = sin selección.

import { makeCanvas, ctx2d, cloneCanvas, contentBounds, Rect, getPixels, putPixels } from './canvas';
import { gaussianBlur } from '../filters/blur';

export type SelMode = 'new' | 'add' | 'subtract' | 'intersect';

const OPS: Record<Exclude<SelMode, 'new'>, GlobalCompositeOperation> = {
  add: 'source-over', subtract: 'destination-out', intersect: 'destination-in',
};

export class Selection {
  mask: HTMLCanvasElement | null = null;
  version = 0;
  private outlineVersion = -1;
  private outline: Path2D | null = null;
  bounds: Rect | null = null;

  constructor(public width: number, public height: number) {}

  get active() { return this.mask !== null; }

  private changed() {
    this.version++;
    if (this.mask) {
      this.bounds = contentBounds(this.mask, 0);
      if (!this.bounds) this.mask = null;
    } else this.bounds = null;
  }

  /** Combina una forma dibujada mediante `draw` con la selección actual. */
  combine(mode: SelMode, draw: (ctx: CanvasRenderingContext2D) => void, antialias = true) {
    const shape = makeCanvas(this.width, this.height);
    const sctx = ctx2d(shape);
    sctx.imageSmoothingEnabled = antialias;
    sctx.fillStyle = '#fff';
    draw(sctx);
    this.combineCanvas(mode, shape);
  }

  combineCanvas(mode: SelMode, shape: HTMLCanvasElement) {
    if (mode === 'new' || (!this.mask && mode !== 'subtract' && mode !== 'intersect')) {
      this.mask = shape;
    } else if (!this.mask) {
      // Restar o intersecar sin selección previa: se parte de "todo seleccionado".
      if (mode === 'intersect') this.mask = shape;
      else { this.selectAllInternal(); ctx2d(this.mask!).globalCompositeOperation = OPS.subtract; ctx2d(this.mask!).drawImage(shape, 0, 0); ctx2d(this.mask!).globalCompositeOperation = 'source-over'; }
    } else {
      const ctx = ctx2d(this.mask);
      ctx.save();
      ctx.globalCompositeOperation = OPS[mode];
      ctx.drawImage(shape, 0, 0);
      ctx.restore();
    }
    this.changed();
  }

  rect(r: Rect, mode: SelMode) { this.combine(mode, ctx => ctx.fillRect(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h))); }
  ellipse(r: Rect, mode: SelMode) {
    this.combine(mode, ctx => { ctx.beginPath(); ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.abs(r.w / 2), Math.abs(r.h / 2), 0, 0, Math.PI * 2); ctx.fill(); });
  }
  polygon(pts: { x: number; y: number }[], mode: SelMode) {
    if (pts.length < 3) return;
    this.combine(mode, ctx => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fill(); });
  }

  private selectAllInternal() {
    this.mask = makeCanvas(this.width, this.height);
    const ctx = ctx2d(this.mask); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, this.width, this.height);
  }
  selectAll() { this.selectAllInternal(); this.changed(); }
  clear() { this.mask = null; this.changed(); }
  invert() {
    if (!this.mask) { this.selectAll(); return; }
    const inv = makeCanvas(this.width, this.height);
    const ctx = ctx2d(inv);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, this.width, this.height);
    ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(this.mask, 0, 0);
    this.mask = inv; this.changed();
  }
  /** Calar (difuminar el borde). */
  feather(radius: number) {
    if (!this.mask || radius <= 0) return;
    const img = getPixels(this.mask);
    gaussianBlur(img, radius, true);
    putPixels(this.mask, img); this.changed();
  }
  /** Expandir (r>0) o contraer (r<0) la selección. */
  grow(r: number) {
    if (!this.mask || r === 0) return;
    const shrink = r < 0;
    if (shrink) this.invert();
    const img = getPixels(this.mask!);
    gaussianBlur(img, Math.abs(r) / 2, true);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 8 ? 255 : 0;
    putPixels(this.mask!, img);
    this.changed();
    if (shrink) this.invert();
  }
  setMask(c: HTMLCanvasElement | null) { this.mask = c ? cloneCanvas(c) : null; this.changed(); }

  /** Trazado del borde de la selección (para las "hormigas en marcha"). */
  getOutline(): Path2D | null {
    if (!this.mask) return null;
    if (this.outlineVersion === this.version && this.outline) return this.outline;
    const w = this.width, h = this.height;
    const b = this.bounds!;
    const d = getPixels(this.mask).data;
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] >= 128;
    const p = new Path2D();
    // Bordes horizontales
    for (let y = b.y; y <= b.y + b.h; y++) {
      let start = -1;
      for (let x = b.x; x <= b.x + b.w; x++) {
        const edge = x < b.x + b.w && inside(x, y) !== inside(x, y - 1);
        if (edge && start < 0) start = x;
        else if (!edge && start >= 0) { p.moveTo(start, y); p.lineTo(x, y); start = -1; }
      }
    }
    // Bordes verticales
    for (let x = b.x; x <= b.x + b.w; x++) {
      let start = -1;
      for (let y = b.y; y <= b.y + b.h; y++) {
        const edge = y < b.y + b.h && inside(x, y) !== inside(x - 1, y);
        if (edge && start < 0) start = y;
        else if (!edge && start >= 0) { p.moveTo(x, start); p.lineTo(x, y); start = -1; }
      }
    }
    this.outline = p; this.outlineVersion = this.version;
    return p;
  }

  resize(w: number, h: number, dx = 0, dy = 0) {
    this.width = w; this.height = h;
    if (this.mask) {
      const m = makeCanvas(w, h); ctx2d(m).drawImage(this.mask, dx, dy); this.mask = m;
    }
    this.changed();
  }
}
