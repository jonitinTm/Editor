// Modelo de capas. Cada tipo de capa es una clase; añadir nuevos tipos
import { t, tName } from '../i18n/i18n';
// (capas de ajuste, objetos inteligentes, formas vectoriales…) consiste en
// crear otra subclase con su propio `kind` y enseñarle al compositor a pintarla.

import { isCustomBlend } from './blend';
import { makeCanvas, ctx2d, clearCanvas, Rect } from './canvas';
import { FILTERS, filterImplsReady, loadFilterImpls } from '../filters/registry';
/** Lo pone la app: redibuja tras cargar filtros que faltaban. */
export let smartFilterRedraw: (() => void) | null = null;
export const setSmartFilterRedraw = (f: () => void) => { smartFilterRedraw = f; };
import { drawMeshExact, styledMesh } from '../tools/warpmesh';
import { ensureFont, needsDownload } from './fonts';
import { customShapePath } from './customshapes';
import { segments, type TextRun, type RunStyle } from './textruns';


/** 'pass-through' solo vale para grupos: sus capas se mezclan directamente con lo de debajo. */
export type BlendMode = GlobalCompositeOperation | 'pass-through' | import('./blend').CustomBlend;
/** Modo para el lienzo del navegador (los modos propios se calculan aparte y aquí cuentan como normal). */
export const canvasBlend = (b: BlendMode): GlobalCompositeOperation => b === 'pass-through' || isCustomBlend(b) ? 'source-over' : b as GlobalCompositeOperation;

export const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'pass-through', label: 'Pasar (solo grupos)' },
  { id: 'source-over', label: 'Normal' },
  { id: 'dissolve', label: 'Disolver' },
  { id: 'darken', label: 'Oscurecer' },
  { id: 'multiply', label: 'Multiplicar' },
  { id: 'color-burn', label: 'Subexponer color' },
  { id: 'linear-burn', label: 'Subexposición lineal' },
  { id: 'darker-color', label: 'Color más oscuro' },
  { id: 'lighten', label: 'Aclarar' },
  { id: 'screen', label: 'Trama' },
  { id: 'color-dodge', label: 'Sobreexponer color' },
  { id: 'lighter', label: 'Sumar (lineal)' },
  { id: 'lighter-color', label: 'Color más claro' },
  { id: 'overlay', label: 'Superponer' },
  { id: 'soft-light', label: 'Luz suave' },
  { id: 'hard-light', label: 'Luz fuerte' },
  { id: 'vivid-light', label: 'Luz intensa' },
  { id: 'linear-light', label: 'Luz lineal' },
  { id: 'pin-light', label: 'Luz focal' },
  { id: 'hard-mix', label: 'Mezcla definida' },
  { id: 'difference', label: 'Diferencia' },
  { id: 'exclusion', label: 'Exclusión' },
  { id: 'subtract', label: 'Restar' },
  { id: 'divide', label: 'Dividir' },
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
    this.touch(); this.fullVersion = this.version;
  }
  touch() { resetDrawState(this.canvas); this.version++; this.dirty = 'all'; this.pendingBefore = null; }
  /** Zona cambiada desde la última copia del historial y lo que había antes en ella (como en las capas de píxeles). */
  dirty: { x: number; y: number; w: number; h: number } | 'all' | null = 'all';
  pendingBefore: { rect: { x: number; y: number; w: number; h: number }; canvas: HTMLCanvasElement } | null = null;
  touchRect(r: { x: number; y: number; w: number; h: number }, before?: HTMLCanvasElement) {
    resetDrawState(this.canvas); this.version++;
    const d = this.dirty;
    this.pendingBefore = d === null && before ? { rect: { ...r }, canvas: before } : null;
    if (d === 'all') return;
    this.dirty = d ? { x: Math.min(d.x, r.x), y: Math.min(d.y, r.y), w: Math.max(d.x + d.w, r.x + r.w) - Math.min(d.x, r.x), h: Math.max(d.y + d.h, r.y + r.h) - Math.min(d.y, r.y) } : { ...r };
  }
  /** Versión en la que la máscara está entera en blanco (no tapa nada): entonces se puede ignorar al combinar. */
  fullVersion = -1;
  isFull() { return this.fullVersion === this.version; }
}

export interface TextProps {
  text: string;
  font: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right' | 'justify';
  lineHeight: number;
  /** Escala horizontal y vertical de las letras (1 = 100 %). */
  hScale?: number; vScale?: number;
  /** Desplazamiento de la línea base (px, positivo = hacia arriba). */
  baseline?: number;
  /** Versalitas. */
  smallCaps?: boolean;
  /** Párrafo: sangrías (izquierda, derecha, primera línea) y espacio antes/después de cada párrafo, en px. */
  indentLeft?: number; indentRight?: number; indentFirst?: number; spaceBefore?: number; spaceAfter?: number;
  /** Suavizado de los bordes: 'none' = bordes duros (pixel art). */
  antialias?: 'smooth' | 'none';
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
  /** Texto dentro de una forma: polígono (en coordenadas del documento) que limita cada línea. */
  area?: { x: number; y: number }[];
  /** true = se muestran los píxeles originales (p. ej. de un PSD) hasta que se edite el texto. */
  keepPixels?: boolean;
  /** Datos originales del texto de Photoshop (base64), para devolverlos intactos al guardar en PSD. */
  psdTySh?: string;
  /** Deformar texto (Arco, Bandera…): el texto sigue siendo editable. */
  warp?: { style: string; bend: number };
  /** Partes del texto con estilo propio (color, fuente, tamaño…). */
  runs?: TextRun[];
  /** Texto sobre un trazado: las letras siguen la curva; `offset` = dónde empieza (0-100 %). */
  onPath?: { pts: PathPoint[]; closed: boolean; offset: number; flip?: boolean };
  /** Texto vertical (columnas de arriba abajo, de derecha a izquierda). */
  vertical?: boolean;
}

export interface LayerStyles {
  shadow?: { enabled: boolean; color: string; opacity: number; angle: number; distance: number; blur: number; spread?: number };
  stroke?: { enabled: boolean; color: string; size: number; position?: 'outside' | 'inside' | 'center'; opacity?: number };
  glow?: { enabled: boolean; color: string; opacity: number; size: number; spread?: number };
  /** Satinado: sombreado interior ondulado (dos copias desplazadas de la forma). */
  satin?: { enabled: boolean; color: string; opacity: number; angle: number; distance: number; size: number; invert?: boolean };
  innerShadow?: { enabled: boolean; color: string; opacity: number; angle: number; distance: number; blur: number };
  innerGlow?: { enabled: boolean; color: string; opacity: number; size: number };
  colorOverlay?: { enabled: boolean; color: string; opacity: number };
  /** Degradado sobre la capa; `stops` = [posición 0-1, color]. */
  gradientOverlay?: { enabled: boolean; opacity: number; angle: number; stops: [number, string][] };
  /** Bisel y relieve. */
  bevel?: import('./bevel').BevelStyle;
  /** Superposición de motivo. */
  patternOverlay?: { enabled: boolean; pattern: string; scale: number; opacity: number };
  /** Fusionar si (luminosidad): rangos [negro0, negro1, blanco0, blanco1] de esta capa y de la de debajo. */
  blendIf?: { this: [number, number, number, number]; under: [number, number, number, number] };
}
/** ¿«Fusionar si» cambia algo? */
export function blendIfActive(s: LayerStyles | null | undefined) { const b = s?.blendIf; return !!b && (b.this.join() !== '0,0,255,255' || b.under.join() !== '0,0,255,255'); }
export function hasStyles(s: LayerStyles | null | undefined): s is LayerStyles {
  return !!s && !!(s.shadow?.enabled || s.stroke?.enabled || s.glow?.enabled || s.innerShadow?.enabled || s.innerGlow?.enabled || s.colorOverlay?.enabled || s.gradientOverlay?.enabled || s.bevel?.enabled || s.patternOverlay?.enabled || s.satin?.enabled);
}

/** Máscara vectorial: la capa solo se ve dentro de los trazados (se puede editar con la selección directa). */
export interface VectorMask { subpaths: { closed: boolean; pts: PathPoint[]; op?: number }[]; enabled: boolean; invert?: boolean }
const vmCache = new WeakMap<object, { key: string; canvas: HTMLCanvasElement }>();
const comboCache = new WeakMap<object, { pixel: HTMLCanvasElement; ver: number; v: HTMLCanvasElement; canvas: HTMLCanvasElement }>();
/** La máscara vectorial dibujada (blanco = se ve). */
export function vectorMaskCanvas(l: Layer, w: number, h: number): HTMLCanvasElement | null {
  const vm = l.vmask; if (!vm || !vm.enabled) return null;
  const key = `${w}x${h}|${JSON.stringify(vm)}`, c0 = vmCache.get(l);
  if (c0 && c0.key === key) return c0.canvas;
  const c = makeCanvas(w, h), x = ctx2d(c);
  x.fillStyle = '#fff';
  if (vm.invert) { x.fillRect(0, 0, w, h); x.globalCompositeOperation = 'destination-out'; }
  if (vm.subpaths.some(sp => sp.op !== undefined)) {
    // como en Photoshop: cada trazado se une, se resta, se interseca o se excluye (0 excluir, 1 unir, 2 restar, 3 intersecar)
    const t = makeCanvas(w, h), tx = ctx2d(t); tx.fillStyle = '#fff';
    for (const sp of vm.subpaths) {
      tx.globalCompositeOperation = sp.op === 2 ? 'destination-out' : sp.op === 3 ? 'destination-in' : sp.op === 0 ? 'xor' : 'source-over';
      tx.beginPath(); tracePath(tx, sp.pts, true); tx.fill();
    }
    x.drawImage(t, 0, 0);
  } else { x.beginPath(); for (const sp of vm.subpaths) tracePath(x, sp.pts, true); x.fill('evenodd'); }
  vmCache.set(l, { key, canvas: c });
  return c;
}
/** Máscara efectiva de una capa: la de píxeles y la vectorial combinadas. */
export function effectiveMask(l: Layer, pixel: HTMLCanvasElement | null | undefined, w: number, h: number, off?: { x: number; y: number }): HTMLCanvasElement | null {
  let v = vectorMaskCanvas(l, w, h);
  if (v && off && (off.x || off.y)) { const t = makeCanvas(w, h); ctx2d(t).drawImage(v, off.x, off.y); v = t; }
  // una máscara entera en blanco no tapa nada: se ignora (mucho menos trabajo)
  if (pixel && l.mask && pixel === l.mask.canvas && l.mask.isFull()) pixel = null;
  if (!v) return pixel ?? null;
  if (!pixel) return v;
  // se guarda la combinación mientras no cambien ni la máscara de píxeles ni el trazado
  const ver = l.mask?.canvas === pixel ? l.mask.version : -1, c0 = comboCache.get(l);
  if (c0 && c0.pixel === pixel && c0.ver === ver && ver !== -1 && c0.v === v) return c0.canvas;
  const c = makeCanvas(w, h), x = ctx2d(c); x.drawImage(pixel, 0, 0); x.globalCompositeOperation = 'destination-in'; x.drawImage(v, 0, 0);
  comboCache.set(l, { pixel, ver, v, canvas: c });
  return c;
}

/** Deja el estado de dibujo de un lienzo como nuevo (lo que se guarda en una capa no debe arrastrar modos de fusión). */
export function resetDrawState(c: HTMLCanvasElement) { const x = ctx2d(c); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.filter = 'none'; x.shadowColor = 'transparent'; x.shadowBlur = 0; x.setTransform(1, 0, 0, 1, 0, 0); x.setLineDash([]); }

export abstract class Layer {
  id = newLayerId();
  /** Máscara vectorial (opcional, además de la de píxeles). */
  vmask?: VectorMask;
  name: string;
  visible = true;
  opacity = 1;
  blendMode: BlendMode = 'source-over';
  locked = false;
  /** Bloquear transparencia: solo se puede pintar donde ya hay píxeles. */
  lockAlpha = false;
  /** Bloquear posición (no se mueve ni se transforma) y bloquear píxeles (no se pinta). */
  lockPos = false;
  lockPixels = false;
  /** Relleno (0-1): opacidad del contenido sin afectar a la sombra, el contorno ni el resplandor exteriores. */
  fillOpacity = 1;
  /** Capas vinculadas: las que comparten este número se mueven juntas. */
  link: number | null = null;
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
  constructor(name: string) { this.name = tName(name); }
  touch() { this.version++; }
  /** ¿Está bloqueada esta capa o alguno de sus grupos padre? */
  isLocked(): boolean {
    let l: Layer | null = this;
    while (l) { if (l.locked) return true; l = l.parent; }
    return false;
  }
  posLocked(): boolean { return this.isLocked() || this.lockPos; }
  pixelsLocked(): boolean { return this.isLocked() || this.lockPixels; }
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
  touch() { resetDrawState(this.canvas); super.touch(); this.dirty = 'all'; this.pendingBefore = null; }
  /** Zona cambiada desde la última copia del historial ('all' = toda o desconocida; null = nada). */
  dirty: { x: number; y: number; w: number; h: number } | 'all' | null = 'all';
  /** Como touch(), pero indicando que solo cambió esa zona (el historial guardará solo ese parche). */
  /** Píxeles de antes de la zona cambiada (si solo hubo un cambio desde la última copia): deshacer es instantáneo. */
  pendingBefore: { rect: { x: number; y: number; w: number; h: number }; canvas: HTMLCanvasElement } | null = null;
  touchRect(r: { x: number; y: number; w: number; h: number }, before?: HTMLCanvasElement) {
    resetDrawState(this.canvas); this.version++;
    const d = this.dirty;
    this.pendingBefore = d === null && before ? { rect: { ...r }, canvas: before } : null;
    if (d === 'all') return;
    this.dirty = d ? { x: Math.min(d.x, r.x), y: Math.min(d.y, r.y), w: Math.max(d.x + d.w, r.x + r.w) - Math.min(d.x, r.x), h: Math.max(d.y + d.h, r.y + r.h) - Math.min(d.y, r.y) } : { ...r };
  }
  constructor(name: string, w: number, h: number) {
    super(name);
    this.canvas = makeCanvas(w, h);
  }
  // Capa creada vacía a propósito («Nueva capa») y aún sin tocar: no hace falta dibujarla al combinar ni copiarla
  // en el historial. Deja de estar vacía en cuanto se edita (touch) o se le cambia el lienzo.
  private blankOf: HTMLCanvasElement | null = null; private blankVer = -1;
  markBlank() { this.blankOf = this.canvas; this.blankVer = this.version; }
  isBlank() { return this.kind === 'raster' && this.blankOf === this.canvas && this.blankVer === this.version; }
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
    if ('fontVariantCaps' in ctx) (ctx as any).fontVariantCaps = p.smallCaps ? 'small-caps' : 'normal';
  }
  /** Reparte el texto en líneas (ajustando al ancho de la caja si es texto de párrafo). */
  /** Fuente de un trozo con estilo propio. */
  private runFont(st: RunStyle) {
    const p = this.props;
    return `${(st.italic ?? p.italic) ? 'italic ' : ''}${(st.bold ?? p.bold) ? 'bold ' : ''}${st.size ?? p.size}px ${JSON.stringify(st.font ?? p.font)}, sans-serif`;
  }
  /** Maquetación con varios estilos: cada línea guarda qué parte del texto ocupa. */
  private richLayout(runs: TextRun[]) {
    const p = this.props, ctx = ctx2d(this.canvas);
    ctx.save();
    const txt = p.caps ? p.text.toUpperCase() : p.text;
    const m = (a: number, b: number) => {
      let w = 0;
      for (const sg of segments(runs, a, b)) { ctx.font = this.runFont(sg.st); if ('letterSpacing' in ctx) (ctx as any).letterSpacing = `${(p.tracking ?? 0) / 1000 * (sg.st.size ?? p.size)}px`; w += ctx.measureText(txt.slice(sg.a, sg.b)).width; }
      return w;
    };
    const lines: { text: string; w: number; start: number; end: number }[] = [];
    let pos = 0;
    for (const para of txt.split('\n')) {
      const a0 = pos, b0 = pos + para.length;
      if (!p.boxWidth) lines.push({ text: para, w: m(a0, b0), start: a0, end: b0 });
      else {
        let ls = a0, k = a0;
        const words = para.split(/(\s+)/);
        for (const word of words) {
          const we = k + word.length;
          if (k > ls && /\S/.test(txt.slice(ls, k)) && m(ls, we) > p.boxWidth && /\S/.test(word)) { let e = k; while (e > ls && /\s/.test(txt[e - 1])) e--; lines.push({ text: txt.slice(ls, e), w: m(ls, e), start: ls, end: e }); ls = k; }
          k = we;
        }
        let e = b0; while (e > ls && /\s/.test(txt[e - 1])) e--;
        lines.push({ text: txt.slice(ls, e), w: m(ls, e), start: ls, end: e });
      }
      pos = b0 + 1;
    }
    ctx.restore();
    const maxSize = Math.max(p.size, ...runs.map(r => r.size ?? 0));
    return { lines, lh: maxSize * p.lineHeight, width: p.boxWidth ?? Math.max(1, ...lines.map(l => l.w)), maxSize };
  }
  layout(): { lines: { text: string; w: number; para?: number; first?: boolean; last?: boolean }[]; lh: number; width: number } {
    if (this.props.runs?.length) return this.richLayout(this.props.runs);
    const p = this.props, ctx = ctx2d(this.canvas);
    ctx.save(); this.setupCtx(ctx);
    const txt = p.caps ? p.text.toUpperCase() : p.text, lines: { text: string; w: number; para: number; first: boolean; last: boolean }[] = [];
    const m = (t: string) => ctx.measureText(t).width;
    const hs = p.hScale ?? 1, il = p.indentLeft ?? 0, ir = p.indentRight ?? 0, ifl = p.indentFirst ?? 0;
    // texto dentro de una forma: cada línea tiene el hueco que deja la forma a su altura
    const lhA = p.size * p.lineHeight, area = p.area && p.area.length > 2 ? p.area : null;
    const spanAt = (i: number): { x: number; w: number } => {
      if (!area) return { x: p.x, w: p.boxWidth ?? 0 };
      const ys = [p.y + i * lhA + lhA * 0.15, p.y + i * lhA + lhA * 0.5, p.y + i * lhA + lhA * 0.85];
      let lo = -Infinity, hi = Infinity;
      for (const y of ys) {
        const xs: number[] = [];
        for (let k = 0; k < area.length; k++) { const a = area[k], b = area[(k + 1) % area.length]; if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x)); }
        xs.sort((u, v) => u - v);
        // el tramo más ancho que hay dentro de la forma a esa altura
        let bl = 0, br = -1; for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > br - bl) { bl = xs[k]; br = xs[k + 1]; }
        if (br <= bl) return { x: 0, w: 0 };
        lo = Math.max(lo, bl); hi = Math.min(hi, br);
      }
      const pad = p.size * 0.15; return hi - lo > pad * 2 ? { x: lo + pad, w: hi - lo - pad * 2 } : { x: 0, w: 0 };
    };
    const areaBottom = area ? Math.max(...area.map(q => q.y)) : Infinity;
    txt.split('\n').forEach((para, pi) => {
      const start = lines.length;
      if (!p.boxWidth && !area) { lines.push({ text: para, w: m(para), para: pi, first: true, last: true }); return; }
      // en una forma, se saltan las líneas donde aún no cabe nada (la parte de arriba de un círculo, por ejemplo)
      if (area) while (spanAt(lines.length).w < p.size * 1.2 && p.y + lines.length * lhA < areaBottom) lines.push({ text: '', w: 0, para: pi, first: false, last: false, lx: 0, room: 0 } as any);
      // ancho útil (sin escalar) de cada línea: la caja menos las sangrías
      const avail = (first: boolean) => area ? Math.max(4, spanAt(lines.length).w / hs) : Math.max(10, (p.boxWidth! - il - ir - (first ? ifl : 0)) / hs);
      let cur = '';
      const push = (t: string) => { const sp = spanAt(lines.length); lines.push({ text: t, w: m(t), para: pi, first: lines.length === start, last: false, ...(area ? { lx: sp.x, room: sp.w } : {}) } as any); };
      for (const word of para.split(/(\s+)/)) {
        const next = cur + word, bw = avail(lines.length === start);
        if (cur.trim() && m(next.trimEnd()) > bw) { push(cur.trimEnd()); cur = word.trimStart(); }
        else cur = next;
        // en una forma, si la palabra no cabe en esta línea pero sí más abajo, se deja la línea vacía y se sigue
        if (area && !cur.trim().includes(' ')) { let guard = 0; while (m(cur) > avail(false) && p.y + lines.length * lhA < areaBottom && guard++ < 200) { lines.push({ text: '', w: 0, para: pi, first: false, last: false, lx: 0, room: 0 } as any); } }
        // palabras más largas que la caja: se cortan por letras
        while (m(cur) > avail(lines.length === start) && cur.length > 1) { const b2 = avail(lines.length === start); let k = cur.length - 1; while (k > 1 && m(cur.slice(0, k)) > b2) k--; push(cur.slice(0, k)); cur = cur.slice(k); }
      }
      push(cur.trimEnd());
      lines[lines.length - 1].last = true;
    });
    ctx.restore();
    // lo que no cabe en la forma no se dibuja
    if (area) for (let i = lines.length - 1; i >= 0; i--) if (p.y + (i + 1) * lhA > areaBottom + lhA * 0.2) lines.splice(i, 1);
    const width = p.boxWidth ? p.boxWidth / hs : Math.max(1, ...lines.map(l => l.w));
    return { lines, lh: p.size * p.lineHeight, width };
  }
  /** Altura extra antes de cada línea (espacio entre párrafos). */
  private paraOffsets(lines: { para?: number; first?: boolean }[]) {
    const p = this.props, sb = p.spaceBefore ?? 0, sa = p.spaceAfter ?? 0, out: number[] = []; let acc = 0;
    lines.forEach((l, i) => { if (i > 0 && l.first) acc += sb + sa; out.push(acc); });
    return { off: out, total: acc };
  }
  /** Posición del cursor (índice en el texto) más cercana a un punto del documento, para editar donde se toca.
   *  null en los casos especiales (sobre trazado, vertical, deformado, con varios estilos o justificado). */
  indexAt(x: number, y: number): number | null {
    const p = this.props;
    if (p.onPath || p.vertical || p.runs?.length || p.align === 'justify' || (p.warp && p.warp.style !== 'none' && p.warp.bend !== 0)) return null;
    const L = this.layout(), lh = L.lh, hs = p.hScale ?? 1, vs = p.vScale ?? 1, blS = p.baseline ?? 0;
    // el punto, en las coordenadas del texto sin escalar (como se dibuja en render)
    const ux = p.x + (x - p.x) / hs, uy = p.y + (y - (p.y - blS)) / vs;
    const po = this.paraOffsets(L.lines);
    let li = 0; for (let i = 0; i < L.lines.length; i++) if (uy >= p.y + i * lh + po.off[i]) li = i;
    // dónde empieza cada línea dentro del texto original
    const cmp = p.caps ? p.text.toUpperCase() : p.text, starts: number[] = []; let from = 0;
    for (const line of L.lines) { const k = line.text ? cmp.indexOf(line.text, from) : from; const st = k < 0 ? from : k; starts.push(st); from = st + line.text.length; }
    const line = L.lines[li]; if (!line) return null;
    const il = (p.indentLeft ?? 0) / hs, ir = (p.indentRight ?? 0) / hs, ifl = (p.indentFirst ?? 0) / hs;
    const left = p.boxWidth ? p.x : p.align === 'center' ? p.x - L.width / 2 : p.align === 'right' ? p.x - L.width : p.x;
    const inArea = (line as any).room !== undefined, ind = il + (line.first ? ifl : 0);
    const room = inArea ? (line as any).room / hs : L.width - (p.boxWidth ? ind + ir : 0);
    const x0 = inArea ? p.x + ((line as any).lx - p.x) / hs : left + (p.boxWidth ? ind : 0);
    const lx = p.align === 'center' ? x0 + (room - line.w) / 2 : p.align === 'right' ? x0 + room - line.w : x0;
    const ctx = ctx2d(this.canvas); ctx.save(); this.setupCtx(ctx);
    // se elige el hueco entre letras más cercano (sin partir letras compuestas ni emojis)
    let best = 0, bd = Infinity, k = 0;
    for (const ch of ['', ...Array.from(line.text)]) { k += ch.length; const d = Math.abs(lx + ctx.measureText(line.text.slice(0, k)).width - ux); if (d < bd) { bd = d; best = k; } }
    ctx.restore();
    return Math.min(p.text.length, starts[li] + best);
  }
  /** Caja que ocupa el texto (coordenadas del documento). */
  bounds() {
    const p = this.props;
    if (p.onPath || p.vertical) { const b = this.specialBounds(); if (b) return b; }
    const L = this.layout(), hs = p.hScale ?? 1, vs = p.vScale ?? 1, W = L.width * hs;
    const x = p.boxWidth ? p.x : p.align === 'center' ? p.x - W / 2 : p.align === 'right' ? p.x - W : p.x;
    return { x, y: p.y - (p.baseline ?? 0), w: W, h: (L.lh * Math.max(1, L.lines.length) + this.paraOffsets(L.lines).total) * vs };
  }
  translate(dx: number, dy: number) {
    this.props.x += dx; this.props.y += dy;
    if (this.props.onPath) for (const q of this.props.onPath.pts) { q.x += dx; q.y += dy; q.ix += dx; q.iy += dy; q.ox += dx; q.oy += dy; }
    if (!this.props.keepPixels) { this.render(); return; }
    const c = makeCanvas(this.canvas.width, this.canvas.height); ctx2d(c).drawImage(this.canvas, dx, dy); this.canvas = c; this.touch();
  }
  scale(sx: number, sy: number) {
    const p = this.props; p.x *= sx; p.y *= sy; p.size *= Math.min(sx, sy);
    if (p.onPath) for (const q of p.onPath.pts) { q.x *= sx; q.y *= sy; q.ix *= sx; q.iy *= sy; q.ox *= sx; q.oy *= sy; }
    if (p.keepPixels) this.touch(); else this.render();
  }
  /** Puntos del trazado del texto, aplanado en tramos rectos, con su longitud acumulada. */
  private pathPoly(): { pts: { x: number; y: number }[]; acc: number[] } {
    const op = this.props.onPath!, src = op.pts, pts: { x: number; y: number }[] = [];
    const seg = (a: PathPoint, b: PathPoint) => { for (let t = (pts.length ? 1 : 0); t <= 24; t++) { const u = t / 24, v = 1 - u; pts.push({ x: v * v * v * a.x + 3 * v * v * u * a.ox + 3 * v * u * u * b.ix + u * u * u * b.x, y: v * v * v * a.y + 3 * v * v * u * a.oy + 3 * v * u * u * b.iy + u * u * u * b.y }); } };
    for (let i = 1; i < src.length; i++) seg(src[i - 1], src[i]);
    if (op.closed && src.length > 1) seg(src[src.length - 1], src[0]);
    if (op.flip) pts.reverse();
    const acc = [0]; for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    return { pts, acc };
  }
  /** Posición y ángulo a una distancia `d` a lo largo del trazado. */
  private along(P: { pts: { x: number; y: number }[]; acc: number[] }, d: number) {
    const { pts, acc } = P; let i = 1; while (i < acc.length - 1 && acc[i] < d) i++;
    const a = pts[i - 1], b = pts[i], f = (d - acc[i - 1]) / Math.max(1e-6, acc[i] - acc[i - 1]);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, ang: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  /** Caja aproximada del texto sobre trazado o vertical. */
  private specialBounds() {
    const p = this.props;
    if (p.onPath) {
      const P = this.pathPoly(); if (P.pts.length < 2) return null;
      const xs = P.pts.map(q => q.x), ys = P.pts.map(q => q.y), m = p.size * 1.1;
      return { x: Math.min(...xs) - m, y: Math.min(...ys) - m, w: Math.max(...xs) - Math.min(...xs) + 2 * m, h: Math.max(...ys) - Math.min(...ys) + 2 * m };
    }
    const lines = (p.caps ? p.text.toUpperCase() : p.text).split('\n'), colW = p.size * p.lineHeight, step = p.size * (1 + (p.tracking ?? 0) / 1000);
    const h = Math.max(1, ...lines.map(l => [...l].length)) * step;
    return { x: p.x - colW * lines.length, y: p.y, w: colW * lines.length, h };
  }
  // Zona del lienzo donde quedó dibujado el texto la última vez (válida mientras nadie más toque los píxeles):
  // al reescribir solo se borra y se avisa de esa zona, no de la imagen entera.
  private drawn: { canvas: HTMLCanvasElement; version: number; rect: Rect } | null = null;
  /** Zona que cambió en el último render (null = toda la capa). */
  lastChange: Rect | null = null;
  render() {
    const p = this.props;
    const warped0 = p.warp && p.warp.style !== 'none' && p.warp.bend !== 0;
    const boxed = !p.onPath && !p.vertical && !warped0 && !p.area?.length;
    const old = boxed && this.drawn && this.drawn.canvas === this.canvas && this.drawn.version === this.version ? this.drawn.rect : null;
    this.drawn = null;
    if (old) ctx2d(this.canvas).clearRect(old.x, old.y, old.w, old.h); else clearCanvas(this.canvas);
    this.renderInner();
    if (!boxed || !old) { this.lastChange = null; if (boxed) this.drawn = { canvas: this.canvas, version: this.version, rect: this.drawnRect() }; return; }
    const nw = this.drawnRect(), x = Math.min(old.x, nw.x), y = Math.min(old.y, nw.y);
    const u = { x, y, w: Math.max(old.x + old.w, nw.x + nw.w) - x, h: Math.max(old.y + old.h, nw.y + nw.h) - y };
    // renderInner ya llamó a touch(): se rebaja a un cambio solo en esa zona para el historial
    this.version--; this.dirty = this.dirtyBefore; this.pendingBefore = null; this.touchRect(u);
    this.lastChange = u;
    this.drawn = { canvas: this.canvas, version: this.version, rect: nw };
  }
  private dirtyBefore: RasterLayer['dirty'] = 'all';
  /** Caja con margen (las letras pueden salirse un poco de su caja: cursivas, acentos, colas), en píxeles enteros. */
  private drawnRect(): Rect {
    const p = this.props, b = this.bounds(), pad = Math.ceil(Math.max(p.size, ...(p.runs ?? []).map(r => r.size ?? 0)) * 0.8 * Math.max(1, p.hScale ?? 1, p.vScale ?? 1) + Math.abs(p.tracking ?? 0) / 1000 * p.size + 4);
    const x0 = Math.max(0, Math.floor(b.x - pad)), y0 = Math.max(0, Math.floor(b.y - pad));
    const x1 = Math.min(this.canvas.width, Math.ceil(b.x + b.w + pad)), y1 = Math.min(this.canvas.height, Math.ceil(b.y + b.h + pad));
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  }
  private renderInner() {
    const p = this.props;
    this.dirtyBefore = this.dirty;
    // fuente de la biblioteca aún sin descargar: se pide y el texto se redibuja al llegar
    if (needsDownload(p.font)) ensureFont(p.font);
    p.keepPixels = false; delete p.psdTySh;
    const warped = p.warp && p.warp.style !== 'none' && p.warp.bend !== 0;
    // Con deformación, el texto se dibuja aparte y luego se pasa por la malla
    const target = warped ? makeCanvas(this.canvas.width, this.canvas.height) : this.canvas;
    const ctx = ctx2d(target);
    if (p.onPath || p.vertical) {
      ctx.save(); this.setupCtx(ctx); ctx.fillStyle = p.color; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      const txt = p.caps ? p.text.toUpperCase() : p.text;
      if (p.onPath) {
        // cada letra en su sitio del trazado, girada según la dirección de la curva
        const P = this.pathPoly(), total = P.acc[P.acc.length - 1] ?? 0;
        let d = (p.onPath.offset ?? 0) / 100 * total;
        const flat = txt.replace(/\n/g, ' ');
        for (const ch of flat) {
          const w = ctx.measureText(ch).width;
          if (d + w / 2 > total) break;
          const at = this.along(P, d + w / 2);
          ctx.save(); ctx.translate(at.x, at.y); ctx.rotate(at.ang); ctx.fillText(ch, 0, 0); ctx.restore();
          d += w;
        }
      } else {
        // vertical: cada línea es una columna, de derecha a izquierda
        const colW = p.size * p.lineHeight, step = p.size * (1 + (p.tracking ?? 0) / 1000);
        txt.split('\n').forEach((line, c) => {
          const cx = p.x - colW * c - colW / 2;
          [...line].forEach((ch, k) => ctx.fillText(ch, cx, p.y + (k + 1) * step - step * 0.2));
        });
      }
      ctx.restore();
      if (target !== this.canvas) ctx2d(this.canvas).drawImage(target, 0, 0);
      this.touch(); return;
    }
    const L = this.layout(), lh = L.lh;
    ctx.save();
    // escala horizontal/vertical y línea base: se aplican alrededor del punto de anclaje
    const hs = p.hScale ?? 1, vs = p.vScale ?? 1, blS = p.baseline ?? 0;
    if (hs !== 1 || vs !== 1 || blS) { ctx.translate(p.x, p.y - blS); ctx.scale(hs, vs); ctx.translate(-p.x, -p.y); }
    this.setupCtx(ctx);
    ctx.fillStyle = p.color; ctx.strokeStyle = p.color;
    ctx.textBaseline = 'top';
    const left = p.boxWidth ? p.x : p.align === 'center' ? p.x - L.width / 2 : p.align === 'right' ? p.x - L.width : p.x;
    if (p.runs?.length) {
      // Varios estilos: cada trozo con su fuente y color, sobre una línea base común
      const R = L as ReturnType<TextLayer['richLayout']>, txt = p.caps ? p.text.toUpperCase() : p.text;
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      R.lines.forEach((line, i) => {
        let x = p.align === 'center' ? left + (L.width - line.w) / 2 : p.align === 'right' ? left + L.width - line.w : left;
        const base = p.y + i * lh + (lh - R.maxSize) / 2 + R.maxSize * 0.8;
        for (const sg of segments(p.runs!, line.start, line.end)) {
          const size = sg.st.size ?? p.size, t = txt.slice(sg.a, sg.b);
          ctx.font = this.runFont(sg.st); if ('letterSpacing' in ctx) (ctx as any).letterSpacing = `${(p.tracking ?? 0) / 1000 * size}px`;
          ctx.fillStyle = sg.st.color ?? p.color;
          ctx.fillText(t, x, base);
          const w = ctx.measureText(t).width, thick = Math.max(1, size / 16);
          if (sg.st.underline ?? p.underline) ctx.fillRect(x, base + size * 0.12, w, thick);
          if (sg.st.strike ?? p.strike) ctx.fillRect(x, base - size * 0.28, w, thick);
          x += w;
        }
      });
    } else
    {
      const po = this.paraOffsets(L.lines), il = (p.indentLeft ?? 0) / hs, ir = (p.indentRight ?? 0) / hs, ifl = (p.indentFirst ?? 0) / hs;
      L.lines.forEach((line, i) => {
        const inArea = (line as any).room !== undefined;
        const ind = il + (line.first ? ifl : 0), room = inArea ? (line as any).room / hs : L.width - (p.boxWidth ? ind + ir : 0);
        const x0 = inArea ? p.x + ((line as any).lx - p.x) / hs : left + (p.boxWidth ? ind : 0);
        const lx = p.align === 'center' ? x0 + (room - line.w) / 2 : p.align === 'right' ? x0 + room - line.w : x0;
        const ty = p.y + i * lh + (lh - p.size) / 2 + po.off[i];
        ctx.textAlign = 'left';
        let w = line.w;
        if (p.align === 'justify' && p.boxWidth && !line.last && /\s/.test(line.text.trim())) {
          // justificado: el espacio que sobra se reparte entre las palabras
          const words = line.text.split(/\s+/).filter(Boolean), sw = words.reduce((a, t) => a + ctx.measureText(t).width, 0), gap = (room - sw) / Math.max(1, words.length - 1);
          let x = x0; for (const t of words) { ctx.fillText(t, x, ty); x += ctx.measureText(t).width + gap; }
          w = room;
        } else ctx.fillText(line.text, lx, ty);
        const thick = Math.max(1, p.size / 16), ux = p.align === 'justify' && p.boxWidth && !line.last ? x0 : lx;
        if (p.underline) ctx.fillRect(ux, ty + p.size * 0.92, w, thick);
        if (p.strike) ctx.fillRect(ux, ty + p.size * 0.52, w, thick);
      });
    }
    ctx.restore();
    if (warped) {
      const b = this.bounds(), pad = Math.ceil(p.size * 0.25);
      const box = { x: Math.floor(b.x) - pad, y: Math.floor(b.y) - pad, w: Math.ceil(b.w) + pad * 2, h: Math.ceil(b.h) + pad * 2 };
      const crop = makeCanvas(box.w, box.h); ctx2d(crop).drawImage(target, -box.x, -box.y);
      drawMeshExact(ctx2d(this.canvas), crop, 0, 0, box, styledMesh(p.warp!.style, box, p.warp!.bend), 40);
    }
    if (p.antialias === 'none') {
      // sin suavizado: cada píxel es todo o nada (útil para pixel art)
      const b = this.bounds(), x0 = Math.max(0, Math.floor(b.x - p.size)), y0 = Math.max(0, Math.floor(b.y - p.size)), x1 = Math.min(this.canvas.width, Math.ceil(b.x + b.w + p.size)), y1 = Math.min(this.canvas.height, Math.ceil(b.y + b.h + p.size));
      if (x1 > x0 && y1 > y0) { const c = ctx2d(this.canvas), id = c.getImageData(x0, y0, x1 - x0, y1 - y0), a = id.data; for (let i = 3; i < a.length; i += 4) a[i] = a[i] >= 128 ? 255 : 0; c.putImageData(id, x0, y0); }
    }
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
  shape: 'rect' | 'round' | 'ellipse' | 'line' | 'path' | 'polygon' | 'star' | 'arrow' | 'heart' | 'custom';
  /** Forma personalizada (biblioteca de formas). */
  custom?: string;
  /** Su trazado SVG (por si se abre en un navegador que no tiene esa forma). */
  customD?: string;
  /** Lados del polígono o puntas de la estrella. */
  sides?: number;
  /** Estrella: radio interior respecto al exterior (0-1). */
  inner?: number;
  /** Polígono, estrella y flecha: radio para redondear las esquinas (px). */
  corner?: number;
  /** Solo para shape = 'path' (dibujado con la pluma). */
  path?: { closed: boolean; pts: PathPoint[] };
  x0: number; y0: number; x1: number; y1: number;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  radius: number;
  /** Estilo del trazo: continuo, discontinuo o punteado. */
  dash?: 'solid' | 'dash' | 'dot' | 'dashdot';
}
/** Patrón de guiones del trazo según su grosor. */
export function dashPattern(dash: ShapeProps['dash'], w: number): number[] {
  if (dash === 'dash') return [w * 3, w * 2];
  if (dash === 'dot') return [0.001, w * 2];
  if (dash === 'dashdot') return [w * 3, w * 1.6, 0.001, w * 1.6];
  return [];
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
      const pts = star ? n * 2 : n, poly: [number, number][] = [];
      for (let i = 0; i < pts; i++) {
        const a = -Math.PI / 2 + i * Math.PI * 2 / pts, rr = star && i % 2 ? k : 1;
        poly.push([x + w / 2 + Math.cos(a) * w / 2 * rr, y + h / 2 + Math.sin(a) * h / 2 * rr]);
      }
      tracePoly(ctx, poly, p.corner ?? 0);
    } else if (p.shape === 'arrow') {
      // flecha que apunta del primer punto al segundo
      const dx = p.x1 - p.x0, dy = p.y1 - p.y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
      const t = Math.max(2, Math.min(L * 0.12, p.strokeWidth * 2 + L * 0.06)), head = Math.min(L * 0.45, t * 3.2), hw = t * 2.4;
      const P = (a: number, b: number) => [p.x0 + ux * a + nx * b, p.y0 + uy * a + ny * b];
      const poly = [P(0, -t / 2), P(L - head, -t / 2), P(L - head, -hw / 2), P(L, 0), P(L - head, hw / 2), P(L - head, t / 2), P(0, t / 2)];
      tracePoly(ctx, poly as [number, number][], p.corner ?? 0);
    } else if (p.shape === 'heart') {
      const cx = x + w / 2;
      ctx.moveTo(cx, y + h * 0.3);
      ctx.bezierCurveTo(cx, y, x, y, x, y + h * 0.32);
      ctx.bezierCurveTo(x, y + h * 0.62, cx - w * 0.1, y + h * 0.78, cx, y + h);
      ctx.bezierCurveTo(cx + w * 0.1, y + h * 0.78, x + w, y + h * 0.62, x + w, y + h * 0.32);
      ctx.bezierCurveTo(x + w, y, cx, y, cx, y + h * 0.3);
      ctx.closePath();
    }
    else if (p.shape === 'custom') {
      // la forma de la biblioteca se estira a la caja (como en Photoshop)
      const base = customShapePath(p.custom ?? '', p.customD), path = new Path2D();
      if (base && w > 0 && h > 0) path.addPath(base, new DOMMatrix([w / 100, 0, 0, h / 100, x, y]));
      if (p.fill) { ctx.fillStyle = p.fill; ctx.fill(path, 'evenodd'); }
      if (p.stroke) { ctx.strokeStyle = p.stroke; ctx.lineWidth = p.strokeWidth; ctx.setLineDash(dashPattern(p.dash, p.strokeWidth)); if (p.dash === 'dot' || p.dash === 'dashdot') ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(path); }
      ctx.restore(); this.touch(); return;
    }
    else if (p.shape === 'round' && (ctx as any).roundRect) (ctx as any).roundRect(x, y, w, h, Math.min(p.radius, w / 2, h / 2));
    else ctx.rect(x, y, w, h);
    if (p.shape === 'line') { ctx.strokeStyle = p.stroke ?? p.fill ?? '#000'; ctx.lineWidth = p.strokeWidth; ctx.lineCap = 'round'; ctx.setLineDash(dashPattern(p.dash, p.strokeWidth)); ctx.stroke(); }
    else {
      if (p.fill) { ctx.fillStyle = p.fill; ctx.fill(); }
      if (p.stroke) { ctx.strokeStyle = p.stroke; ctx.lineWidth = p.strokeWidth; ctx.setLineDash(dashPattern(p.dash, p.strokeWidth)); if (p.dash === 'dot' || p.dash === 'dashdot') ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); }
    }
    ctx.restore();
    this.touch();
  }
}

/** Polígono cerrado; con `r` > 0 las esquinas se redondean (sin pasarse de la mitad de cada lado). */
export function tracePoly(ctx: CanvasRenderingContext2D, pts: [number, number][], r: number) {
  const n = pts.length; if (n < 3) return;
  if (!(r > 0)) { pts.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.closePath(); return; }
  const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[n - 1], pts[0]); ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const P = pts[i], A = pts[(i - 1 + n) % n], B = pts[(i + 1) % n];
    const ax = A[0] - P[0], ay = A[1] - P[1], bx = B[0] - P[0], by = B[1] - P[1], la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    const ang = la && lb ? Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)))) : 0;
    // el arco toca cada lado a r/tan(ángulo/2) de la esquina: se limita para que quepa en la mitad del lado
    const rr = ang > 1e-3 && ang < Math.PI - 1e-3 ? Math.min(r, Math.min(la, lb) / 2 * Math.tan(ang / 2)) : 0;
    const M = mid(P, B);
    ctx.arcTo(P[0], P[1], M[0], M[1], rr);
  }
  ctx.closePath();
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
    // los filtros de efectos se cargan al usarlos: si aún no están, se piden y se vuelve a dibujar al llegar
    if (!filterImplsReady()) { loadFilterImpls().then(() => { this.render(); smartFilterRedraw?.(); }); }
    const ctx = ctx2d(this.canvas), img = ctx.getImageData(r.x, r.y, r.w, r.h);
    for (const f of list) { try { FILTERS.find(d => d.id === f.id)?.apply(img, f.params); } catch (e) { if (filterImplsReady()) throw e; } }
    ctx.putImageData(img, r.x, r.y);
  }
}

/**
 * Capa de ajuste: no tiene píxeles; aplica un ajuste (niveles, curvas…) a
 * todo lo que hay debajo, sin modificarlo. Se puede cambiar o quitar siempre.
 */
export class AdjustmentLayer extends Layer {
  readonly kind = 'adjust' as const;
  constructor(name: string, public filterId: string, public params: any) { super(name); const e = t(name + '…'); if (e !== name + '…') this.name = e.replace('…', ''); else if (this.name === name) this.name = t(name); }
}

export class GroupLayer extends Layer {
  readonly kind = 'group' as const;
  blendMode: BlendMode = 'pass-through';
  /** Hijos de abajo (índice 0) hacia arriba. */
  children: Layer[] = [];
  expanded = true;
  /** Mesa de trabajo: el grupo se recorta a este rectángulo y tiene fondo propio. */
  artboard?: { x: number; y: number; w: number; h: number; bg: string | null };
  /** Marco: grupo con máscara vectorial donde se colocan imágenes (se ajustan a su forma). */
  frame?: boolean;
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
