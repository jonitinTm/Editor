// Selección: un lienzo del tamaño del documento cuyo alfa indica cuánto está
// seleccionado cada píxel (0 = nada, 255 = todo). null = sin selección.

import { makeCanvas, ctx2d, cloneCanvas, contentBounds, contentBoundsQuick, Rect, getPixels, putPixels } from './canvas';
import { gaussianBlur } from '../filters/blur';

export type SelMode = 'new' | 'add' | 'subtract' | 'intersect';
/** Caja de la selección y, si es un rectángulo lleno, ese rectángulo. */
export interface SelInfo { bounds: Rect | null; rect: Rect | null; }

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

  /** La selección es exactamente este rectángulo (lleno, sin bordes suaves): el borde y la caja se saben sin leerla. */
  private rectShape: { version: number; rect: Rect } | null = null;
  private changed(known?: Rect) {
    this.version++;
    if (this.mask) {
      // la máscara no debe quedarse con un modo de fusión de la operación anterior
      { const x = ctx2d(this.mask); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.filter = 'none'; }
      if (known) { this.bounds = known.w > 0 && known.h > 0 ? { ...known } : null; if (this.bounds) this.rectShape = { version: this.version, rect: { ...known } }; }
      // búsqueda rápida (sobre una copia reducida y luego exacta en los bordes): no hay que leer la máscara entera
      else this.bounds = contentBoundsQuick(this.mask, this.version);
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

  rect(r: Rect, mode: SelMode) {
    const x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
    if (mode === 'new' || (!this.mask && mode === 'add')) {
      // rectángulo nuevo: su caja (recortada al documento) se conoce sin leer la máscara
      const x0 = Math.max(0, Math.min(x, x + w)), y0 = Math.max(0, Math.min(y, y + h)), x1 = Math.min(this.width, Math.max(x, x + w)), y1 = Math.min(this.height, Math.max(y, y + h));
      const shape = makeCanvas(this.width, this.height), c = ctx2d(shape); c.fillStyle = '#fff'; c.fillRect(x, y, w, h);
      this.mask = shape; this.changed({ x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) });
      return;
    }
    this.combine(mode, ctx => ctx.fillRect(x, y, w, h));
  }
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
  selectAll() { this.selectAllInternal(); this.changed({ x: 0, y: 0, w: this.width, h: this.height }); }
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
    // si la selección es más estrecha que el borde, al encogerla desaparece: el borde es entonces todo lo de fuera
    const inner = this.mask;
    const c = ctx2d(outer); c.globalCompositeOperation = 'destination-out'; if (inner) c.drawImage(inner, 0, 0);
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
    // contraer = lo mismo que expandir lo de fuera, pero sin invertir la selección (si ocupaba toda la imagen, al
    // invertirla quedaba vacía y fallaba): se desenfoca y solo queda lo que estaba del todo dentro
    const shrink = r < 0;
    const img = getPixels(this.mask);
    gaussianBlur(img, Math.abs(r) / 2, true);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = shrink ? (d[i] < 247 ? 0 : 255) : (d[i] > 8 ? 255 : 0);
    // al contraer, el borde de la imagen también cuenta como borde de la selección (como «aplicar en los límites del
    // lienzo»): así «Borde» o «Contraer» con toda la imagen seleccionada dan un marco y no una selección vacía
    if (shrink) {
      const W = img.width, H = img.height, k = Math.min(Math.round(Math.abs(r)), W, H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < k || y < k || x >= W - k || y >= H - k) d[(y * W + x) * 4 + 3] = 0;
    }
    putPixels(this.mask, img);
    this.changed();
  }
  /** `known`: caja y forma ya conocidas de ese lienzo (p. ej. al deshacer): no hace falta volver a buscarlas. */
  setMask(c: HTMLCanvasElement | null, known?: SelInfo | null) {
    this.mask = c ? cloneCanvas(c) : null;
    if (!known || !this.mask) { this.changed(); return; }
    this.changed(known.rect ?? known.bounds ?? undefined);
    if (!known.rect) this.rectShape = null;
  }
  /** Lo que se sabe de la selección actual (para guardarlo junto a su copia en el historial). */
  info(): SelInfo | null {
    if (!this.mask) return null;
    const rect = this.rectShape && this.rectShape.version === this.version ? { ...this.rectShape.rect } : null;
    return { bounds: this.bounds ? { ...this.bounds } : null, rect };
  }
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
    if (this.rectShape && this.rectShape.version === this.version) {
      const r = this.rectShape.rect, p = new Path2D(); p.rect(r.x, r.y, r.w, r.h);
      this.outline = p; this.outlineVersion = this.version; return p;
    }
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
