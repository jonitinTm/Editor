// Selección: un lienzo del tamaño del documento cuyo alfa indica cuánto está
// seleccionado cada píxel (0 = nada, 255 = todo). null = sin selección.

import { makeCanvas, ctx2d, cloneCanvas, contentBounds, contentBoundsQuick, Rect, getPixels, putPixels } from './canvas';
import { gaussianBlur } from '../filters/blur';

export type SelMode = 'new' | 'add' | 'subtract' | 'intersect';

const OPS: Record<Exclude<SelMode, 'new'>, GlobalCompositeOperation> = {
  add: 'source-over', subtract: 'destination-out', intersect: 'destination-in',
};

/** Se llama cuando el borde mostrado se ha quedado atrás y conviene repintar (lo conecta el visor). */
export let onOutlineStale: (() => void) | null = null;
export function setOnOutlineStale(f: () => void) { onOutlineStale = f; }

export class Selection {
  mask: HTMLCanvasElement | null = null;
  version = 0;
  private outlineVersion = -1;
  private outline: Path2D | null = null;
  private outlineAt = 0;
  private outlineTimer = 0;
  bounds: Rect | null = null;

  constructor(public width: number, public height: number) {}

  get active() { return this.mask !== null; }

  private changed() {
    this.version++;
    if (this.mask) {
      // la máscara no debe quedarse con un modo de fusión de la operación anterior
      { const x = ctx2d(this.mask); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.filter = 'none'; }
      // búsqueda rápida (sobre una copia reducida y luego exacta en los bordes): no hay que leer la máscara entera
      this.bounds = contentBoundsQuick(this.mask, this.version);
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
  /** La última selección que se quitó (para «Volver a seleccionar»). */
  last: HTMLCanvasElement | null = null;
  clear() { if (this.mask) this.last = this.mask; this.mask = null; this.changed(); }
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
  /** Borde: una franja de `w` px alrededor del contorno de la selección. */
  border(w: number) {
    if (!this.mask || w <= 0) return;
    const orig = cloneCanvas(this.mask);
    this.grow(Math.max(1, Math.round(w / 2)));
    const outer = cloneCanvas(this.mask!);
    this.mask = cloneCanvas(orig); this.grow(-Math.max(1, Math.round(w / 2)));
    const inner = this.mask!;
    const c = ctx2d(outer); c.globalCompositeOperation = 'destination-out'; c.drawImage(inner, 0, 0);
    this.mask = outer; this.feather(0.7);
    this.changed();
  }
  /** Suavizar: redondea las esquinas y quita los picos de la selección. */
  smooth(r: number) {
    if (!this.mask || r <= 0) return;
    const img = getPixels(this.mask);
    gaussianBlur(img, r, true);
    const d = img.data; for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 128 ? 255 : 0;
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
  /** Usa el lienzo tal cual, sin copiarlo (para herramientas que lo van construyendo mientras se arrastra). */
  setMaskShared(c: HTMLCanvasElement, bounds?: Rect | null) {
    if (bounds === undefined) { this.mask = c; this.changed(); return; }
    // con la zona ya conocida no hace falta buscarla en la máscara (más rápido mientras se arrastra)
    this.mask = c; this.version++; this.bounds = bounds;
  }

  /** Trazado del borde de la selección (para las "hormigas en marcha"). */
  getOutline(): Path2D | null {
    if (!this.mask) return null;
    if (this.outlineVersion === this.version && this.outline) return this.outline;
    // mientras una herramienta la va cambiando a cada fotograma, el borde se recalcula como mucho cada 120 ms
    // (al dejar de cambiar se pone al día enseguida)
    const now = performance.now();
    if (this.outline && now - this.outlineAt < 120) { if (!this.outlineTimer) this.outlineTimer = window.setTimeout(() => { this.outlineTimer = 0; onOutlineStale?.(); }, 130); return this.outline; }
    this.outlineAt = now;
    // solo se lee la zona seleccionada, con un borde de un píxel de «fuera» alrededor
    const b = this.bounds!, bw = b.w, bh = b.h, PW = bw + 2;
    const d = ctx2d(this.mask).getImageData(b.x, b.y, bw, bh).data, ins = new Uint8Array(PW * (bh + 2));
    for (let y = 0; y < bh; y++) for (let x = 0, i = y * bw * 4 + 3, o = (y + 1) * PW + 1; x < bw; x++, i += 4, o++) ins[o] = d[i] >= 128 ? 1 : 0;
    const p = new Path2D();
    // bordes horizontales: entre la fila y-1 y la fila y (en coordenadas con margen)
    for (let y = 1; y <= bh + 1; y++) {
      let start = -1; const r0 = (y - 1) * PW, r1 = y * PW;
      for (let x = 1; x <= bw + 1; x++) {
        const edge = x <= bw && ins[r0 + x] !== ins[r1 + x];
        if (edge && start < 0) start = x;
        else if (!edge && start >= 0) { p.moveTo(b.x + start - 1, b.y + y - 1); p.lineTo(b.x + x - 1, b.y + y - 1); start = -1; }
      }
    }
    // bordes verticales: entre la columna x-1 y la columna x
    for (let x = 1; x <= bw + 1; x++) {
      let start = -1;
      for (let y = 1; y <= bh + 1; y++) {
        const edge = y <= bh && ins[y * PW + x - 1] !== ins[y * PW + x];
        if (edge && start < 0) start = y;
        else if (!edge && start >= 0) { p.moveTo(b.x + x - 1, b.y + start - 1); p.lineTo(b.x + x - 1, b.y + y - 1); start = -1; }
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
