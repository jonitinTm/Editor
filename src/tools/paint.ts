// Utilidades compartidas por las herramientas que modifican píxeles:
// a qué lienzo se pinta (capa o máscara) y el motor de trazos.

import { app } from '../ui/app';
import { cloneCanvas, ctx2d, makeCanvas, Rect, rectInt, rectIntersect, luminance } from '../core/canvas';
import { Layer, RasterLayer, isRaster, isParametric } from '../core/layers';

export interface PaintTarget {
  layer: Layer;
  isMask: boolean;
  canvas: HTMLCanvasElement;
  /** Máscara rápida: el "lienzo" es la propia selección. */
  quick?: boolean;
  /** La capa tiene la transparencia bloqueada. */
  lockAlpha?: boolean;
}

/** Selección que limita la pintura (no aplica en máscara rápida, donde se pinta la selección misma). */
export function clipMask(t: PaintTarget): HTMLCanvasElement | null { return t.quick ? null : app.doc!.selection.mask; }

/** Convierte una capa de texto en una capa normal de píxeles. */
export function rasterizeLayer(l: RasterLayer): RasterLayer {
  const doc = app.doc!;
  const r = new RasterLayer(l.name, doc.width, doc.height);
  r.canvas = cloneCanvas(l.canvas);
  r.id = l.id; r.visible = l.visible; r.opacity = l.opacity; r.blendMode = l.blendMode; r.locked = l.locked; r.lockPos = l.lockPos; r.lockPixels = l.lockPixels; r.fillOpacity = l.fillOpacity; r.mask = l.mask;
  const parent = l.parent!;
  const i = parent.children.indexOf(l);
  parent.remove(l); parent.add(r, i);
  if (doc.active === l) doc.active = r;
  return r;
}

/**
 * Lienzo sobre el que pintar ahora mismo. Muestra un aviso y devuelve null si
 * no se puede (capa bloqueada, grupo, oculta…).
 */
export function getPaintTarget(opts: { allowText?: boolean } = {}): PaintTarget | null {
  const doc = app.doc;
  if (!doc) return null;
  if (doc.quickMask) {
    if (!doc.selection.mask) { doc.selection.selectAll(); }
    return { layer: doc.active ?? doc.root, isMask: true, canvas: doc.selection.mask!, quick: true };
  }
  let layer = doc.active;
  if (!layer) { app.toast('No hay ninguna capa seleccionada', 'warn'); return null; }
  if (layer.isLocked()) { app.toast('La capa está bloqueada', 'warn'); return null; }
  if (!layer.isVisibleInTree()) { app.toast('La capa está oculta', 'warn'); return null; }
  if (doc.editMask && layer.mask) return { layer, isMask: true, canvas: layer.mask.canvas };
  if (layer.lockPixels) { app.toast('Los píxeles de la capa están bloqueados', 'warn'); return null; }
  if (!isRaster(layer)) { app.toast(layer.kind === 'group' ? 'Selecciona una capa de píxeles (no un grupo)' : 'Las capas de ajuste no tienen píxeles: pinta en su máscara', 'warn'); return null; }
  if (isParametric(layer) && !opts.allowText) {
    app.toast(layer.kind === 'text' ? 'Capa de texto rasterizada para poder editarla' : layer.kind === 'smart' ? 'Objeto inteligente rasterizado para poder pintar en él (para conservarlo, edita su contenido con doble clic)' : 'Forma rasterizada para poder editarla');
    layer = rasterizeLayer(layer);
  }
  return { layer, isMask: false, canvas: (layer as RasterLayer).canvas, lockAlpha: layer.lockAlpha };
}

/** Marca el objetivo como modificado (para el historial). */
export function touchTarget(t: PaintTarget) {
  if (t.quick) return;
  if (t.isMask) t.layer.mask!.touch(); else t.layer.touch();
}

/** Sustituye el contenido del objetivo por un lienzo nuevo. */
export function setTargetCanvas(t: PaintTarget, c: HTMLCanvasElement) {
  // el lienzo pasa a ser el de la capa: se deja su estado de dibujo como nuevo (modo normal, opacidad 1)
  { const x = ctx2d(c); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.filter = 'none'; x.setTransform(1, 0, 0, 1, 0, 0); }
  if (t.quick) { app.doc!.selection.setMask(c); t.canvas = app.doc!.selection.mask ?? c; return; }
  if (t.isMask) t.layer.mask!.canvas = c; else (t.layer as RasterLayer).canvas = c;
  t.canvas = c;
  touchTarget(t);
}

/** Aplica la previsualización temporal al compositor. */
export function setPreview(t: PaintTarget, c: HTMLCanvasElement | null) {
  const doc = app.doc!;
  if (t.quick) { doc.quickPreview = c; return; }
  const ov = doc.overrides.get(t.layer) ?? {};
  if (t.isMask) ov.mask = c ?? undefined; else ov.canvas = c ?? undefined;
  if (!ov.mask && !ov.canvas && !ov.extra && !ov.offset) doc.overrides.delete(t.layer);
  else doc.overrides.set(t.layer, ov);
}

// ---- Puntas de pincel ---------------------------------------------------

const tipCache = new Map<string, HTMLCanvasElement>();
export function brushTip(size: number, hardness: number, color: string, aliased = false, roundness = 1, angle = 0): HTMLCanvasElement {
  if (!aliased && (roundness < 0.999 || (angle % 180) !== 0) && roundness < 0.999) {
    // Punta elíptica: la redonda, aplastada y girada
    const key = `e|${size}|${hardness}|${color}|${roundness}|${angle}`;
    let e = tipCache.get(key);
    if (e) return e;
    const base = brushTip(size, hardness, color), d = base.width;
    e = makeCanvas(d, d); const c = ctx2d(e);
    c.translate(d / 2, d / 2); c.rotate(-angle * Math.PI / 180); c.scale(1, Math.max(0.01, roundness)); c.drawImage(base, -d / 2, -d / 2);
    tipCache.set(key, e);
    return e;
  }
  const d = Math.max(1, Math.ceil(size));
  const key = `${d}|${hardness}|${color}|${aliased}|${size}`;
  let c = tipCache.get(key);
  if (c) return c;
  if (tipCache.size > 64) tipCache.clear();
  c = makeCanvas(d + 2, d + 2);
  const ctx = ctx2d(c);
  const r = size / 2, cx = (d + 2) / 2;
  if (aliased) {
    ctx.fillStyle = color;
    const rr = Math.max(0.5, r);
    for (let y = 0; y < d + 2; y++) for (let x = 0; x < d + 2; x++) {
      const dx = x + .5 - cx, dy = y + .5 - cx;
      if (dx * dx + dy * dy <= rr * rr || d <= 1) ctx.fillRect(x, y, 1, 1);
    }
    if (d <= 1) { ctx.clearRect(0, 0, d + 2, d + 2); ctx.fillRect(1, 1, 1, 1); }
  } else if (hardness >= 0.99) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx, cx, Math.max(0.5, r), 0, Math.PI * 2); ctx.fill();
  } else {
    const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, Math.max(0.5, r));
    const [cr, cg, cb] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const alpha = t <= hardness ? 1 : smooth((1 - t) / (1 - hardness));
      g.addColorStop(t, `rgba(${cr},${cg},${cb},${alpha})`);
    }
    ctx.fillStyle = g; ctx.fillRect(0, 0, d + 2, d + 2);
  }
  tipCache.set(key, c);
  return c;
}
const smooth = (x: number) => x * x * (3 - 2 * x);

// ---- Motor de trazos ------------------------------------------------------

export type StrokeMode = 'paint' | 'erase' | 'mask';

/**
 * Un trazo pinta "toques" (dabs) en un búfer; la vista previa combina el
 * original con el búfer usando la opacidad del trazo, que así no se acumula
 * al pasar varias veces por el mismo sitio (como en los editores profesionales).
 */
export class Stroke {
  buffer: HTMLCanvasElement;
  original: HTMLCanvasElement;
  /** Capa resultante; en modo rápido solo se crea al terminar (ver ensurePreview). */
  preview!: HTMLCanvasElement;
  /** Modo rápido: pintura normal; el búfer se dibuja encima de la capa sin copiarla. */
  private fast: boolean;
  dirty: Rect | null = null;
  bounds: Rect | null = null;
  /** Retoque del trazo entero al terminar (p. ej. bordes húmedos). */
  post?: (buffer: HTMLCanvasElement, bounds: Rect) => void;
  private last: { x: number; y: number; p: number } | null = null;
  private residue = 0;
  private sel: HTMLCanvasElement | null;
  private tmp: HTMLCanvasElement | null = null;
  constructor(
    public target: PaintTarget,
    public mode: StrokeMode,
    public opacity: number,
    /** Valor de gris (0-1) al pintar en máscaras. */
    public maskValue = 1,
    /** Modo de fusión de la pintura (Multiplicar, Color…); «source-over» = normal. */
    public blend: GlobalCompositeOperation = 'source-over',
  ) {
    const w = target.canvas.width, h = target.canvas.height;
    this.buffer = makeCanvas(w, h);
    // El lienzo de la capa no se modifica durante el trazo (se pinta sobre la vista previa), así que no hace falta copiarlo
    this.original = target.canvas;
    this.sel = clipMask(target);
    // modo rápido (pintar normal y borrar): el búfer se aplica al vuelo al componer, sin copiar la capa en cada fotograma
    this.fast = (mode === 'paint' || mode === 'erase') && !target.lockAlpha && !target.quick && !target.isMask && blend === 'source-over';
    if (this.fast) {
      const doc = app.doc!, ov = doc.overrides.get(target.layer) ?? {}, erase = mode === 'erase';
      ov.extra = ctx => { ctx.save(); ctx.globalAlpha = this.opacity; if (erase) ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(this.sel ? this.tmp! : this.buffer, 0, 0); ctx.restore(); };
      doc.overrides.set(target.layer, ov);
    } else {
      this.preview = cloneCanvas(target.canvas);
      setPreview(target, this.preview);
    }
  }
  /** Limita todo el trazo con una máscara más (p. ej. la textura del pincel), además de la selección. */
  addMask(m: HTMLCanvasElement) {
    if (this.sel) { const c = cloneCanvas(this.sel), x = ctx2d(c); x.globalCompositeOperation = 'destination-in'; x.drawImage(m, 0, 0); this.sel = c; } else this.sel = m;
  }
  private clearExtra() {
    const doc = app.doc!, ov = doc.overrides.get(this.target.layer);
    if (!ov) return;
    delete ov.extra;
    if (!ov.mask && !ov.canvas && !ov.offset) doc.overrides.delete(this.target.layer);
  }
  /** Crea la capa resultante (si aún no existe) y deja de usar el modo rápido. */
  ensurePreview() {
    if (!this.fast) return;
    this.clearExtra(); this.fast = false;
    this.preview = cloneCanvas(this.original);
    if (this.bounds) this.composeInto(this.preview, this.bounds);
    setPreview(this.target, this.preview);
  }

  /** Recorre el segmento desde el último punto colocando toques cada `spacing` píxeles. */
  lineTo(x: number, y: number, pressure: number, spacing: number, dab: (x: number, y: number, p: number) => Rect) {
    if (!this.last) {
      this.addDirty(dab(x, y, pressure));
      this.last = { x, y, p: pressure };
      return;
    }
    const l = this.last;
    const dist = Math.hypot(x - l.x, y - l.y);
    let t = spacing - this.residue;
    while (t <= dist) {
      const k = t / dist;
      this.addDirty(dab(l.x + (x - l.x) * k, l.y + (y - l.y) * k, l.p + (pressure - l.p) * k));
      t += spacing;
    }
    this.residue = dist - (t - spacing);
    this.last = { x, y, p: pressure };
  }

  private addDirty(r: Rect) {
    const ri = rectInt(r);
    const d = this.dirty;
    this.dirty = d ? { x: Math.min(d.x, ri.x), y: Math.min(d.y, ri.y), w: Math.max(d.x + d.w, ri.x + ri.w) - Math.min(d.x, ri.x), h: Math.max(d.y + d.h, ri.y + ri.h) - Math.min(d.y, ri.y) } : ri;
  }

  /** Actualiza la vista previa en la zona modificada desde la última vez. */
  update() {
    const d0 = this.dirty;
    if (!d0) return;
    this.dirty = null;
    const r = rectIntersect(d0, { x: 0, y: 0, w: this.buffer.width, h: this.buffer.height });
    if (!r) return;
    const b = this.bounds;
    this.bounds = b ? { x: Math.min(b.x, r.x), y: Math.min(b.y, r.y), w: Math.max(b.x + b.w, r.x + r.w) - Math.min(b.x, r.x), h: Math.max(b.y + b.h, r.y + r.h) - Math.min(b.y, r.y) } : r;
    if (this.fast) { if (this.sel) this.clipToSelection(r); }
    else this.composeInto(this.preview, r);
    app.doc!.invalidate(r);
  }
  /** Búfer recortado por la selección, en la zona r. */
  private clipToSelection(r: Rect) {
    this.tmp ??= makeCanvas(this.buffer.width, this.buffer.height);
    const t = ctx2d(this.tmp);
    t.save(); t.beginPath(); t.rect(r.x, r.y, r.w, r.h); t.clip();
    t.globalCompositeOperation = 'copy'; t.drawImage(this.buffer, 0, 0);
    t.globalCompositeOperation = 'destination-in'; t.drawImage(this.sel!, 0, 0);
    t.restore();
  }

  private composeInto(dest: HTMLCanvasElement, r: Rect) {
    const ctx = ctx2d(dest);
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(this.original, 0, 0);
    // Búfer recortado por la selección
    let src = this.buffer;
    if (this.sel) { this.clipToSelection(r); src = this.tmp!; }
    ctx.globalAlpha = this.opacity;
    if (this.mode === 'paint') {
      if (this.blend !== 'source-over' && !this.target.isMask && !this.target.quick) {
        // con modo de fusión: la pintura se mezcla con lo que ya hay (solo en la zona que cambia)
        const rx = Math.floor(r.x), ry = Math.floor(r.y), rw = Math.ceil(r.w) + 1, rh = Math.ceil(r.h) + 1;
        const k = makeCanvas(rw, rh), kx = ctx2d(k);
        kx.drawImage(this.original, -rx, -ry); kx.globalAlpha = this.opacity; kx.globalCompositeOperation = this.blend; kx.drawImage(src, -rx, -ry);
        if (this.target.lockAlpha) { kx.globalAlpha = 1; kx.globalCompositeOperation = 'destination-in'; kx.drawImage(this.original, -rx, -ry); }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'copy'; ctx.drawImage(k, rx, ry);
      } else { ctx.globalCompositeOperation = this.target.lockAlpha ? 'source-atop' : 'source-over'; ctx.drawImage(src, 0, 0); }
    } else if (this.mode === 'erase') {
      ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(src, 0, 0);
    } else {
      ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(src, 0, 0);
      ctx.globalAlpha = this.opacity * this.maskValue;
      ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(src, 0, 0);
    }
    ctx.restore();
  }

  /** Termina el trazo y devuelve true si cambió algo. */
  finish(): boolean {
    this.update();
    if (this.post && this.bounds) {
      this.post(this.buffer, this.bounds);
      if (this.sel) { const t = this.tmp ?? (this.tmp = makeCanvas(this.buffer.width, this.buffer.height)), x = ctx2d(t); x.clearRect(0, 0, t.width, t.height); x.drawImage(this.buffer, 0, 0); x.globalCompositeOperation = 'destination-in'; x.drawImage(this.sel, 0, 0); x.globalCompositeOperation = 'source-over'; }
      if (this.fast) { this.clearExtra(); this.fast = false; }
      this.preview = cloneCanvas(this.original);
      this.composeInto(this.preview, this.bounds);
    } else if (this.fast) {
      this.clearExtra(); this.fast = false;
      if (!this.bounds) { app.doc!.invalidate(); return false; }
      this.preview = cloneCanvas(this.original);
      this.composeInto(this.preview, this.bounds);
    }
    setPreview(this.target, null);
    if (!this.bounds) return false;
    setTargetCanvas(this.target, this.preview);
    app.doc!.invalidate(this.bounds);
    return true;
  }
  cancel() {
    if (this.fast) this.clearExtra();
    setPreview(this.target, null);
    app.doc!.invalidate();
  }
}

/** Color con el que pinta el pincel según el objetivo (en máscaras, gris). */
export function strokeSetup(t: PaintTarget, erase: boolean): { mode: StrokeMode; color: string; maskValue: number } {
  if (t.isMask) {
    const col = erase ? app.bg : app.fg;
    return { mode: 'mask', color: '#ffffff', maskValue: luminance(col) };
  }
  // Con la transparencia bloqueada, el borrador pinta con el color de fondo
  if (erase && t.lockAlpha) return { mode: 'paint', color: app.bg, maskValue: 1 };
  return { mode: erase ? 'erase' : 'paint', color: app.fg, maskValue: 1 };
}
