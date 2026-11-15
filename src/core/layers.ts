// Modelo de capas. Cada tipo de capa es una clase; añadir nuevos tipos
// (capas de ajuste, objetos inteligentes, formas vectoriales…) consiste en
// crear otra subclase con su propio `kind` y enseñarle al compositor a pintarla.

import { makeCanvas, ctx2d, clearCanvas } from './canvas';

export type BlendMode = GlobalCompositeOperation;

export const BLEND_MODES: { id: BlendMode; label: string }[] = [
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
}

export abstract class Layer {
  id = newLayerId();
  name: string;
  visible = true;
  opacity = 1;
  blendMode: BlendMode = 'source-over';
  locked = false;
  mask: LayerMask | null = null;
  parent: GroupLayer | null = null;
  /** Se incrementa cada vez que cambian los píxeles; lo usa el historial. */
  version = 0;
  abstract readonly kind: 'raster' | 'text' | 'group';
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
  readonly kind: 'raster' | 'text' = 'raster';
  canvas: HTMLCanvasElement;
  constructor(name: string, w: number, h: number) {
    super(name);
    this.canvas = makeCanvas(w, h);
  }
}

export class TextLayer extends RasterLayer {
  readonly kind = 'text' as const;
  props: TextProps;
  constructor(name: string, w: number, h: number, props: TextProps) {
    super(name, w, h);
    this.props = props;
    this.render();
  }
  fontString() {
    const p = this.props;
    return `${p.italic ? 'italic ' : ''}${p.bold ? 'bold ' : ''}${p.size}px ${JSON.stringify(p.font)}, sans-serif`;
  }
  /** Caja aproximada que ocupa el texto (coordenadas del documento). */
  bounds() {
    const p = this.props;
    const ctx = ctx2d(this.canvas);
    ctx.font = this.fontString();
    const lines = p.text.split('\n');
    const w = Math.max(1, ...lines.map(l => ctx.measureText(l).width));
    const lh = p.size * p.lineHeight;
    const x = p.align === 'left' ? p.x : p.align === 'center' ? p.x - w / 2 : p.x - w;
    return { x, y: p.y, w, h: lh * lines.length };
  }
  render() {
    clearCanvas(this.canvas);
    const p = this.props;
    const ctx = ctx2d(this.canvas);
    ctx.save();
    ctx.font = this.fontString();
    ctx.fillStyle = p.color;
    ctx.textAlign = p.align;
    ctx.textBaseline = 'top';
    const lh = p.size * p.lineHeight;
    p.text.split('\n').forEach((line, i) => ctx.fillText(line, p.x, p.y + i * lh + (lh - p.size) / 2));
    ctx.restore();
    this.touch();
  }
}

export class GroupLayer extends Layer {
  readonly kind = 'group' as const;
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
  return !!l && (l.kind === 'raster' || l.kind === 'text');
}
