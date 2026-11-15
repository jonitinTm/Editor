// Compositor: combina todas las capas visibles en una sola imagen.

import { borrowCanvas, returnCanvas, ctx2d, Rect } from './canvas';
import { GroupLayer, Layer, isRaster } from './layers';

/** Sustituciones temporales usadas por las herramientas para previsualizar. */
export interface LayerOverride {
  canvas?: HTMLCanvasElement;
  mask?: HTMLCanvasElement;
  offset?: { x: number; y: number };
  /** Dibujo extra encima del contenido de la capa (p. ej. contenido flotante). */
  extra?: (ctx: CanvasRenderingContext2D) => void;
}

export interface CompositeOptions {
  overrides?: Map<Layer, LayerOverride>;
  /** Si se indica, solo se pinta ese rectángulo. */
  rect?: Rect | null;
  /** Ignorar la visibilidad de una capa concreta (para miniaturas, etc.). */
  only?: Layer;
}

export function compositeGroup(group: GroupLayer, ctx: CanvasRenderingContext2D, w: number, h: number, opts: CompositeOptions) {
  for (const layer of group.children) {
    if (!layer.visible) continue;
    if (layer.opacity <= 0) continue;
    drawLayer(layer, ctx, w, h, opts);
  }
}

function drawLayer(layer: Layer, ctx: CanvasRenderingContext2D, w: number, h: number, opts: CompositeOptions) {
  const ov = opts.overrides?.get(layer);
  const mask = ov?.mask ?? (layer.mask?.enabled ? layer.mask.canvas : null);
  const needsTemp = layer.kind === 'group' || !!mask || !!ov?.extra;
  let surface: HTMLCanvasElement;
  let temp: HTMLCanvasElement | null = null;

  if (isRaster(layer) && !needsTemp) {
    surface = ov?.canvas ?? layer.canvas;
  } else {
    temp = borrowCanvas(w, h);
    const tctx = ctx2d(temp);
    if (opts.rect) { tctx.save(); tctx.beginPath(); tctx.rect(opts.rect.x, opts.rect.y, opts.rect.w, opts.rect.h); tctx.clip(); }
    if (layer instanceof GroupLayer) compositeGroup(layer, tctx, w, h, opts);
    else if (isRaster(layer)) {
      const src = ov?.canvas ?? layer.canvas;
      tctx.drawImage(src, ov?.offset?.x ?? 0, ov?.offset?.y ?? 0);
      ov?.extra?.(tctx);
    }
    if (mask) {
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(mask, 0, 0);
      tctx.globalCompositeOperation = 'source-over';
    }
    if (opts.rect) tctx.restore();
    surface = temp;
  }

  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = layer.blendMode;
  const off = !temp && ov?.offset ? ov.offset : { x: 0, y: 0 };
  ctx.drawImage(surface, off.x, off.y);
  ctx.restore();
  if (temp) returnCanvas(temp);
}

/** Pinta el documento completo (o un rectángulo) en el lienzo de destino. */
export function renderComposite(root: GroupLayer, target: HTMLCanvasElement, opts: CompositeOptions = {}) {
  const ctx = ctx2d(target);
  ctx.save();
  if (opts.rect) {
    ctx.beginPath(); ctx.rect(opts.rect.x, opts.rect.y, opts.rect.w, opts.rect.h); ctx.clip();
    ctx.clearRect(opts.rect.x, opts.rect.y, opts.rect.w, opts.rect.h);
  } else ctx.clearRect(0, 0, target.width, target.height);
  compositeGroup(root, ctx, target.width, target.height, opts);
  ctx.restore();
}
