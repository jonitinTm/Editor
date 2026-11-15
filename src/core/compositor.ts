// Compositor: combina todas las capas visibles en una sola imagen.

import { borrowCanvas, returnCanvas, ctx2d, Rect } from './canvas';
import { GroupLayer, Layer, AdjustmentLayer, LayerStyles, hasStyles, isRaster } from './layers';
import { FILTERS } from '../filters/registry';
import { hexToRgb, makeCanvas } from './canvas';

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
    if (layer instanceof AdjustmentLayer) applyAdjustment(layer, ctx, w, h, opts);
    else drawLayer(layer, ctx, w, h, opts);
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

  let off = !temp && ov?.offset ? ov.offset : { x: 0, y: 0 };
  let styled: HTMLCanvasElement | null = null;
  if (hasStyles(layer.styles)) {
    // Con estilos: sombra/resplandor/trazo por debajo y la capa encima. Se guarda en caché si nada cambia.
    const key = ov || !isRaster(layer) ? null : `${layer.version}|${layer.mask?.version}|${layer.mask?.enabled}|${w}x${h}|${JSON.stringify(layer.styles)}`;
    const cached = key ? styleCache.get(layer) : undefined;
    if (cached && cached.key === key) surface = cached.canvas;
    else {
      const out = key ? makeCanvas(w, h) : (styled = borrowCanvas(w, h));
      const sctx = ctx2d(out);
      renderStyles(sctx, surface, layer.styles, off.x, off.y, w, h);
      sctx.drawImage(surface, off.x, off.y);
      if (key) styleCache.set(layer, { key, canvas: out });
      surface = out;
    }
    off = { x: 0, y: 0 };
  }
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = layer.blendMode;
  ctx.drawImage(surface, off.x, off.y);
  ctx.restore();
  if (temp) returnCanvas(temp);
  if (styled) returnCanvas(styled);
}

const styleCache = new WeakMap<Layer, { key: string; canvas: HTMLCanvasElement }>();
const rgba = (hex: string, a: number) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };

/** Dibuja los efectos de estilo de `src` (sin la propia capa). Sirve también para exportar. */
export function renderStyles(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, st: LayerStyles, ox: number, oy: number, w: number, h: number) {
  const FAR = w + 4096; // la imagen se dibuja fuera y solo su "sombra" cae dentro del lienzo
  const cast = (color: string, blur: number, dx: number, dy: number, times = 1) => {
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.shadowOffsetX = FAR + dx; ctx.shadowOffsetY = dy;
    for (let i = 0; i < times; i++) ctx.drawImage(src, ox - FAR, oy);
    ctx.restore();
  };
  if (st.shadow?.enabled) {
    const s = st.shadow, a = s.angle * Math.PI / 180;
    cast(rgba(s.color, s.opacity / 100), s.blur, -Math.cos(a) * s.distance, Math.sin(a) * s.distance);
  }
  if (st.glow?.enabled) cast(rgba(st.glow.color, st.glow.opacity / 100), st.glow.size, 0, 0, 2);
  if (st.stroke?.enabled && st.stroke.size > 0) {
    const t = borrowCanvas(w, h), tc = ctx2d(t), size = st.stroke.size;
    for (const r of size > 3 ? [size, size * 0.5] : [size]) {
      const n = Math.max(12, Math.ceil(r * 2.5));
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; tc.drawImage(src, ox + Math.cos(a) * r, oy + Math.sin(a) * r); }
    }
    tc.globalCompositeOperation = 'source-in'; tc.fillStyle = st.stroke.color; tc.fillRect(0, 0, w, h);
    tc.globalCompositeOperation = 'source-over';
    ctx.drawImage(t, 0, 0);
    returnCanvas(t);
  }
}

const filterById = new Map(FILTERS.map(f => [f.id, f]));

/** Aplica una capa de ajuste a lo ya pintado en `ctx` (respeta su máscara y opacidad). */
function applyAdjustment(l: AdjustmentLayer, ctx: CanvasRenderingContext2D, w: number, h: number, opts: CompositeOptions) {
  const def = filterById.get(l.filterId);
  if (!def) return;
  let x = 0, y = 0, x1 = w, y1 = h;
  if (opts.rect) { x = Math.max(0, Math.floor(opts.rect.x)); y = Math.max(0, Math.floor(opts.rect.y)); x1 = Math.min(w, Math.ceil(opts.rect.x + opts.rect.w)); y1 = Math.min(h, Math.ceil(opts.rect.y + opts.rect.h)); }
  if (x1 <= x || y1 <= y) return;
  const img = ctx.getImageData(x, y, x1 - x, y1 - y);
  const mc = opts.overrides?.get(l)?.mask ?? (l.mask?.enabled ? l.mask.canvas : null);
  const orig = mc || l.opacity < 1 ? new Uint8ClampedArray(img.data) : null;
  def.apply(img, l.params);
  if (orig) {
    const m = mc ? ctx2d(mc).getImageData(x, y, x1 - x, y1 - y).data : null;
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const k = l.opacity * (m ? m[i + 3] / 255 : 1);
      if (k >= 1) continue;
      d[i] = orig[i] + (d[i] - orig[i]) * k; d[i + 1] = orig[i + 1] + (d[i + 1] - orig[i + 1]) * k; d[i + 2] = orig[i + 2] + (d[i + 2] - orig[i + 2]) * k;
    }
  }
  ctx.putImageData(img, x, y);
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
