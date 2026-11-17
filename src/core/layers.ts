// Modelo de capas. Cada tipo de capa es una clase; añadir nuevos tipos
// (capas de ajuste, objetos inteligentes, formas vectoriales…) consiste en
// crear otra subclase con su propio `kind` y enseñarle al compositor a pintarla.

import { makeCanvas, ctx2d, clearCanvas, Rect } from './canvas';
import { FILTERS } from '../filters/registry';

/** 'pass-through' solo vale para grupos: sus capas se mezclan directamente con lo de debajo. */
export type BlendMode = GlobalCompositeOperation | 'pass-through';
export const canvasBlend = (b: BlendMode): GlobalCompositeOperation => b === 'pass-through' ? 'source-over' : b;

export const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'pass-through', label: 'Pasar (solo grupos)' },
  { id: 'source-over', label: 'Normal' },
  { id: 'darken', label: 'Oscurecer' },
  { id: 'multiply', label: 'Multiplicar' },
  { id: 'color-burn', label: 'Subexponer color' },
  { id: 'lighten', label: 'Aclarar' },
  { id: 'screen', label: 'Trama' },
  { id: 'color-dodge', label: 'Sobreexponer color' },
  { id: 'lighter', label: 'Sumar (lineal)' },
  { id: 'overlay', label: 'Superponer' },
  { id: 'soft-light', label: 'Luz suave' },
  { id: 'hard-light', label: 'Luz fuerte' },
  { id: 'difference', label: 'Diferencia' },
  { id: 'exclusion', label: 'Exclusión' },
  { id: 'hue', label: 'Tono' },
  { id: 'saturation', label: 'Saturación' },
  { id: 'color', label: 'Color' },
  { id: 'luminosity', label: 'Luminosidad' },
];

let nextId = 1;
export function newLayerId() { return nextId++; }
export function bumpLayerId(min: number) { if (nextId <= min) nextId = min + 1; }

/**
 * Máscara de capa. Internamente se guarda como un lienzo blanco cuyo canal
 * alfa indica la visibilidad (opaco = visible, transparente = oculto). Así el
 * compositor puede aplicarla directamente con `destination-in`.
 */
export class LayerMask {
  canvas: HTMLCanvasElement;
  enabled = true;
  version = 0;
  constructor(w: number, h: number, fill: 'white' | 'black' = 'white') {
    this.canvas = makeCanvas(w, h);
    if (fill === 'white') this.fillAll();
  }
  fillAll() {
    const ctx = ctx2d(this.canvas);
    ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); ctx.restore();
    this.touch();
  }
  touch() { this.version++; }
}

export interface TextProps {
  text: string;
  font: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  x: number;
  y: number;
  /** Interletraje en milésimas de em (como en los editores profesionales). */
  tracking?: number;
  underline?: boolean;
  strike?: boolean;
  /** Todo en mayúsculas. */
  caps?: boolean;
  /** Texto de párrafo: ancho de la caja (las líneas se ajustan solas). Sin valor = texto de punto. */
  boxWidth?: number;
  /** true = se muestran los píxeles originales (p. ej. de un PSD) hasta que se edite el texto. */
  keepPixels?: boolean;
  /** Datos originales del texto de Photoshop (base64), para devolverlos intactos al guardar en PSD. */
  psdTySh?: string;
}

export interface LayerStyles {
  shadow?: { enabled: boolean; color: string; opacity: number; angle: number; distance: number; blur: number };
  stroke?: { enabled: boolean; color: string; size: number };
  glow?: { enabled: boolean; color: string; opacity: number; size: number };
  innerShadow?: { enabled: boolean; color: string; opacity: number; angle: number; distance: number; blur: number };
  innerGlow?: { enabled: boolean; color: string; opacity: number; size: number };
  colorOverlay?: { enabled: boolean; color: string; opacity: number };
  /** Degradado sobre la capa; `stops` = [posición 0-1, color]. */
  gradientOverlay?: { enabled: boolean; opacity: number; angle: number; stops: [number, string][] };
}
export function hasStyles(s: LayerStyles | null | undefined): s is LayerStyles {
  return !!s && !!(s.shadow?.enabled || s.stroke?.enabled || s.glow?.enabled || s.innerShadow?.enabled || s.innerGlow?.enabled || s.colorOverlay?.enabled || s.gradientOverlay?.enabled);
}

export abstract class Layer {
  id = newLayerId();
  name: string;
  visible = true;
  opacity = 1;
  blendMode: BlendMode = 'source-over';
  locked = false;
  /** Bloquear transparencia: solo se puede pintar donde ya hay píxeles. */
  lockAlpha = false;
  /** Etiqueta de color en el panel de capas (rojo, naranja, amarillo, verde, azul, violeta, gris). */
  label: string | null = null;
  /** Máscara de recorte: la capa solo se ve donde la capa de debajo tiene píxeles. */
  clip = false;
  mask: LayerMask | null = null;
  parent: GroupLayer | null = null;
  /** Se incrementa cada vez que cambian los píxeles; lo usa el historial. */
  version = 0;
  abstract readonly kind: 'raster' | 'text' | 'shape' | 'smart' | 'group' | 'adjust';
  /** Estilos de capa (sombra, trazo, resplandor). null = ninguno. */
  styles: LayerStyles | null = null;
  constructor(name: string) { this.name = name; }
  touch() { this.version++; }
  /** ¿Está bloqueada esta capa o alguno de sus grupos padre? */
  isLocked(): boolean {
    let l: Layer | null = this;
    while (l) { if (l.locked) return true; l = l.parent; }
    return false;
  }
  isVisibleInTree(): boolean {
    let l: Layer | null = this;
    while (l) { if (!l.visible) return false; l = l.parent; }
    return true;
  }
}

export class RasterLayer extends Layer {
  readonly kind: 'raster' | 'text' | 'shape' | 'smart' = 'raster';
  canvas: HTMLCanvasElement;
  /**
   * Contenido completo de la capa cuando parte queda fuera del lienzo (tras
   * moverla). Solo es válido mientras los píxeles no se editen (misma versión).
   */
  full: { canvas: HTMLCanvasElement; x: number; y: number; version: number } | null = null;
  constructor(name: string, w: number, h: number) {
    super(name);
    this.canvas = makeCanvas(w, h);
  }
  /** Contenido con lo que haya fuera del lienzo, y su posición. */
  fullContent(): { canvas: HTMLCanvasElement; x: number; y: number } {
    if (this.full && this.full.version === this.version) return this.full;
    return { canvas: this.canvas, x: 0, y: 0 };
  }
  /** Coloca el contenido completo en (x, y) y recorta la parte visible. */
  placeFull(src: HTMLCanvasElement, x: number, y: number, w = this.canvas.width, h = this.canvas.height) {
    const c = makeCanvas(w, h);
    ctx2d(c).drawImage(src, x, y);
    this.canvas = c; this.touch();
    const clipped = x < 0 || y < 0 || x + src.width > w || y + src.height > h;
    this.full = clipped ? { canvas: src, x, y, version: this.version } : null;
  }
}

/** Capas "paramétricas": se redibujan a partir de sus propiedades (texto, formas). */
export interface Parametric { props: any; render(): void; translate(dx: number, dy: number): void; scale(sx: number, sy: number): void; }
export function isParametric(l: Layer | null | undefined): l is RasterLayer & Parametric {
  return !!l && (l.kind === 'text' || l.kind === 'shape' || l.kind === 'smart');
}

export class TextLayer extends RasterLayer {
  readonly kind = 'text' as const;
  props: TextProps;
  constructor(name: string, w: number, h: number, props: TextProps) {
    super(name, w, h);
    this.props = props;
    const keep = props.keepPixels, raw = props.psdTySh;
    this.render();
    if (keep) { this.props.keepPixels = true; this.props.psdTySh = raw; }
  }
  fontString() {
    const p = this.props;
    return `${p.italic ? 'italic ' : ''}${p.bold ? 'bold ' : ''}${p.size}px ${JSON.stringify(p.font)}, sans-serif`;
  }
  private setupCtx(ctx: CanvasRenderingContext2D) {
    const p = this.props;
    ctx.font = this.fontString();
    if ('letterSpacing' in ctx) (ctx as any).letterSpacing = `${(p.tracking ?? 0) / 1000 * p.size}px`;
  }
  /** Reparte el texto en líneas (ajustando al ancho de la caja si es texto de párrafo). */
  layout(): { lines: { text: string; w: number }[]; lh: number; width: number } {
    const p = this.props, ctx = ctx2d(this.canvas);
    ctx.save(); this.setupCtx(ctx);
    const txt = p.caps ? p.text.toUpperCase() : p.text, lines: { text: string; w: number }[] = [];
    const m = (t: string) => ctx.measureText(t).width;
    for (const para of txt.split('\n')) {
      if (!p.boxWidth) { lines.push({ text: para, w: m(para) }); continue; }
      let cur = '';
      for (const word of para.split(/(\s+)/)) {
        const next = cur + word;
        if (cur.trim() && m(next.trimEnd()) > p.boxWidth) { lines.push({ text: cur.trimEnd(), w: m(cur.trimEnd()) }); cur = word.trimStart(); }
        else cur = next;
        // palabras más largas que la caja: se cortan por letras
        while (m(cur) > p.boxWidth && cur.length > 1) { let k = cur.length - 1; while (k > 1 && m(cur.slice(0, k)) > p.boxWidth) k--; lines.push({ text: cur.slice(0, k), w: m(cur.slice(0, k)) }); cur = cur.slice(k); }
      }
      lines.push({ text: cur.trimEnd(), w: m(cur.trimEnd()) });
    }
    ctx.restore();
    const width = p.boxWidth ?? Math.max(1, ...lines.map(l => l.w));
    return { lines, lh: p.size * p.lineHeight, width };
  }
  /** Caja que ocupa el texto (coordenadas del documento). */
  bounds() {
    const p = this.props, L = this.layout();
    const x = p.boxWidth ? p.x : p.align === 'left' ? p.x : p.align === 'center' ? p.x - L.width / 2 : p.x - L.width;
    return { x, y: p.y, w: L.width, h: L.lh * Math.max(1, L.lines.length) };
  }
  translate(dx: number, dy: number) {
    this.props.x += dx; this.props.y += dy;
    if (!this.props.keepPixels) { this.render(); return; }
    const c = makeCanvas(this.canvas.width, this.canvas.height); ctx2d(c).drawImage(this.canvas, dx, dy); this.canvas = c; this.touch();
  }
  scale(sx: number, sy: number) {
    const p = this.props; p.x *= sx; p.y *= sy; p.size *= Math.min(sx, sy);
    if (p.keepPixels) this.touch(); else this.render();
  }
  render() {
    clearCanvas(this.canvas);
    const p = this.props;
    p.keepPixels = false; delete p.psdTySh;
    const ctx = ctx2d(this.canvas);
    const L = this.layout(), lh = L.lh;
    ctx.save();
    this.setupCtx(ctx);
    ctx.fillStyle = p.color; ctx.strokeStyle = p.color;
    ctx.textBaseline = 'top';
    const left = p.boxWidth ? p.x : p.align === 'left' ? p.x : p.align === 'center' ? p.x - L.width / 2 : p.x - L.width;
    L.lines.forEach((line, i) => {
      const lx = p.align === 'left' ? left : p.align === 'center' ? left + (L.width - line.w) / 2 : left + L.width - line.w;
      const ty = p.y + i * lh + (lh - p.size) / 2;
      ctx.textAlign = 'left';
      ctx.fillText(line.text, lx, ty);
      const thick = Math.max(1, p.size / 16);
      if (p.underline) ctx.fillRect(lx, ty + p.size * 0.92, line.w, thick);
      if (p.strike) ctx.fillRect(lx, ty + p.size * 0.52, line.w, thick);
    });
    ctx.restore();
    this.touch();
  }
}

/** Punto de un trazado: ancla (x, y) y sus dos tiradores (entrada y salida). */
export interface PathPoint { x: number; y: number; ix: number; iy: number; ox: number; oy: number; }
/** Añade un trazado de curvas Bézier a un contexto o Path2D. */
export function tracePath(ctx: { moveTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void; closePath(): void }, pts: PathPoint[], closed: boolean) {
  if (!pts.length) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.bezierCurveTo(pts[i - 1].ox, pts[i - 1].oy, pts[i].ix, pts[i].iy, pts[i].x, pts[i].y);
  if (closed && pts.length > 1) { const a = pts[pts.length - 1], b = pts[0]; ctx.bezierCurveTo(a.ox, a.oy, b.ix, b.iy, b.x, b.y); ctx.closePath(); }
}

export interface ShapeProps {
  shape: 'rect' | 'round' | 'ellipse' | 'line' | 'path' | 'polygon' | 'star' | 'arrow' | 'heart';
  /** Lados del polígono o puntas de la estrella. */
  sides?: number;
  /** Estrella: radio interior respecto al exterior (0-1). */
  inner?: number;
  /** Solo para shape = 'path' (dibujado con la pluma). */
  path?: { closed: boolean; pts: PathPoint[] };
  x0: number; y0: number; x1: number; y1: number;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  radius: number;
}

/** Forma vectorial: se puede cambiar de color, trazo y tamaño sin perder calidad. */
export class ShapeLayer extends RasterLayer {
  readonly kind = 'shape' as const;
  props: ShapeProps;
  constructor(name: string, w: number, h: number, props: ShapeProps) {
    super(name, w, h);
    this.props = props;
    this.render();
  }
  private mapPath(f: (x: number, y: number) => [number, number]) {
    const p = this.props; if (!p.path) return;
    p.path = { closed: p.path.closed, pts: p.path.pts.map(q => { const [x, y] = f(q.x, q.y), [ix, iy] = f(q.ix, q.iy), [ox, oy] = f(q.ox, q.oy); return { x, y, ix, iy, ox, oy }; }) };
  }
  translate(dx: number, dy: number) { const p = this.props; p.x0 += dx; p.x1 += dx; p.y0 += dy; p.y1 += dy; this.mapPath((x, y) => [x + dx, y + dy]); this.render(); }
  scale(sx: number, sy: number) {
    const p = this.props; p.x0 *= sx; p.x1 *= sx; p.y0 *= sy; p.y1 *= sy;
    this.mapPath((x, y) => [x * sx, y * sy]);
    const k = Math.min(sx, sy); p.strokeWidth = Math.max(1, p.strokeWidth * k); p.radius *= k; this.render();
  }
  render() {
    clearCanvas(this.canvas);
    const p = this.props, ctx = ctx2d(this.canvas);
    const x = Math.min(p.x0, p.x1), y = Math.min(p.y0, p.y1), w = Math.abs(p.x1 - p.x0), h = Math.abs(p.y1 - p.y0);
    ctx.save();
    ctx.beginPath();
    if (p.shape === 'path') { if (p.path) tracePath(ctx, p.path.pts, p.path.closed); ctx.lineCap = 'round'; }
    else if (p.shape === 'line') { ctx.moveTo(p.x0, p.y0); ctx.lineTo(p.x1, p.y1); }
    else if (p.shape === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (p.shape === 'polygon' || p.shape === 'star') {
      const n = Math.max(3, Math.round(p.sides ?? (p.shape === 'star' ? 5 : 6))), star = p.shape === 'star', k = p.inner ?? 0.45;
      const pts = star ? n * 2 : n;
      for (let i = 0; i < pts; i++) {
        const a = -Math.PI / 2 + i * Math.PI * 2 / pts, rr = star && i % 2 ? k : 1;
        const px = x + w / 2 + Math.cos(a) * w / 2 * rr, py = y + h / 2 + Math.sin(a) * h / 2 * rr;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
    } else if (p.shape === 'arrow') {
      // flecha que apunta del primer punto al segundo
      const dx = p.x1 - p.x0, dy = p.y1 - p.y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
      const t = Math.max(2, Math.min(L * 0.12, p.strokeWidth * 2 + L * 0.06)), head = Math.min(L * 0.45, t * 3.2), hw = t * 2.4;
      const P = (a: number, b: number) => [p.x0 + ux * a + nx * b, p.y0 + uy * a + ny * b];
      const poly = [P(0, -t / 2), P(L - head, -t / 2), P(L - head, -hw / 2), P(L, 0), P(L - head, hw / 2), P(L - head, t / 2), P(0, t / 2)];
      poly.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.closePath();
    } else if (p.shape === 'heart') {
      const cx = x + w / 2;
      ctx.moveTo(cx, y + h * 0.3);
      ctx.bezierCurveTo(cx, y, x, y, x, y + h * 0.32);
      ctx.bezierCurveTo(x, y + h * 0.62, cx - w * 0.1, y + h * 0.78, cx, y + h);
      ctx.bezierCurveTo(cx + w * 0.1, y + h * 0.78, x + w, y + h * 0.62, x + w, y + h * 0.32);
      ctx.bezierCurveTo(x + w, y, cx, y, cx, y + h * 0.3);
      ctx.closePath();
    }
    else if (p.shape === 'round' && (ctx as any).roundRect) (ctx as any).roundRect(x, y, w, h, Math.min(p.radius, w / 2, h / 2));
    else ctx.rect(x, y, w, h);
    if (p.shape === 'line') { ctx.strokeStyle = p.stroke ?? p.fill ?? '#000'; ctx.lineWidth = p.strokeWidth; ctx.lineCap = 'round'; ctx.stroke(); }
    else {
      if (p.fill) { ctx.fillStyle = p.fill; ctx.fill(); }
      if (p.stroke) { ctx.strokeStyle = p.stroke; ctx.lineWidth = p.strokeWidth; ctx.lineJoin = 'round'; ctx.stroke(); }
    }
    ctx.restore();
    this.touch();
  }
}

/** Matriz afín [a, b, c, d, e, f] como la de canvas: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];
/** Composición A∘B (primero se aplica B, luego A). */
export function matMul(A: Matrix, B: Matrix): Matrix {
  return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
}
/** Lo que un objeto inteligente necesita de su documento interno. */
export interface SmartSource { name: string; width: number; height: number; flatten(): HTMLCanvasElement; }

/**
 * Objeto inteligente: guarda dentro un documento completo (con sus capas) y lo
 * muestra transformado. Escalar o girar no pierde calidad porque siempre se
 * redibuja desde el original, y su contenido se puede editar aparte.
 */
/** Filtro inteligente: un filtro o ajuste aplicado a un objeto inteligente que se puede editar o quitar. */
export interface SmartFilter { id: string; params: any; enabled: boolean; }

export class SmartLayer extends RasterLayer {
  readonly kind = 'smart' as const;
  props: { m: Matrix; filters?: SmartFilter[] };
  /** Imagen combinada del documento interno. */
  src!: HTMLCanvasElement;
  constructor(name: string, w: number, h: number, public inner: SmartSource, m: Matrix, filters: SmartFilter[] = []) {
    super(name, w, h);
    this.props = { m: [...m] as Matrix, filters: filters.map(f => ({ ...f, params: JSON.parse(JSON.stringify(f.params)) })) };
    this.refresh();
  }
  get filters(): SmartFilter[] { return (this.props.filters ??= []); }
  /** Vuelve a leer el contenido (tras editarlo) y redibuja. */
  refresh() { this.src = this.inner.flatten(); this.render(); }
  translate(dx: number, dy: number) { this.applyMatrix([1, 0, 0, 1, dx, dy]); }
  scale(sx: number, sy: number) { this.applyMatrix([sx, 0, 0, sy, 0, 0]); }
  applyMatrix(D: Matrix) { this.props = { ...this.props, m: matMul(D, this.props.m) }; this.render(); }
  render() {
    clearCanvas(this.canvas);
    const ctx = ctx2d(this.canvas);
    ctx.save();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(...this.props.m);
    ctx.drawImage(this.src, 0, 0);
    ctx.restore();
    this.applyFilters();
    this.touch();
  }
  /** Aplica los filtros inteligentes activos sobre la zona que ocupa el objeto (y un margen). */
  private applyFilters() {
    const list = this.filters.filter(f => f.enabled);
    if (!list.length) return;
    const m = this.props.m, w = this.src.width, h = this.src.height;
    const xs = [0, w, 0, w].map((x, i) => m[0] * x + m[2] * (i < 2 ? 0 : h) + m[4]), ys = [0, w, 0, w].map((x, i) => m[1] * x + m[3] * (i < 2 ? 0 : h) + m[5]);
    const pad = 64, W = this.canvas.width, H = this.canvas.height;
    const r: Rect = { x: Math.max(0, Math.floor(Math.min(...xs)) - pad), y: Math.max(0, Math.floor(Math.min(...ys)) - pad), w: 0, h: 0 };
    r.w = Math.min(W, Math.ceil(Math.max(...xs)) + pad) - r.x; r.h = Math.min(H, Math.ceil(Math.max(...ys)) + pad) - r.y;
    if (r.w < 1 || r.h < 1) return;
    const ctx = ctx2d(this.canvas), img = ctx.getImageData(r.x, r.y, r.w, r.h);
    for (const f of list) FILTERS.find(d => d.id === f.id)?.apply(img, f.params);
    ctx.putImageData(img, r.x, r.y);
  }
}

/**
 * Capa de ajuste: no tiene píxeles; aplica un ajuste (niveles, curvas…) a
 * todo lo que hay debajo, sin modificarlo. Se puede cambiar o quitar siempre.
 */
export class AdjustmentLayer extends Layer {
  readonly kind = 'adjust' as const;
  constructor(name: string, public filterId: string, public params: any) { super(name); }
}

export class GroupLayer extends Layer {
  readonly kind = 'group' as const;
  blendMode: BlendMode = 'pass-through';
  /** Hijos de abajo (índice 0) hacia arriba. */
  children: Layer[] = [];
  expanded = true;
  add(layer: Layer, index = this.children.length) {
    layer.parent?.remove(layer);
    layer.parent = this;
    this.children.splice(index, 0, layer);
  }
  remove(layer: Layer) {
    const i = this.children.indexOf(layer);
    if (i >= 0) this.children.splice(i, 1);
    layer.parent = null;
  }
}

/** Recorre todas las capas (en profundidad, de abajo arriba). */
export function* walkLayers(group: GroupLayer): Generator<Layer> {
  for (const c of group.children) {
    yield c;
    if (c instanceof GroupLayer) yield* walkLayers(c);
  }
}

export function isRaster(l: Layer | null | undefined): l is RasterLayer {
  return !!l && (l.kind === 'raster' || l.kind === 'text' || l.kind === 'shape' || l.kind === 'smart');
}
