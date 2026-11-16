// Compositor: combina todas las capas visibles en una sola imagen.

import { borrowCanvas, returnCanvas, ctx2d, Rect } from './canvas';
import { canvasBlend, GroupLayer, Layer, AdjustmentLayer, LayerStyles, hasStyles, isRaster } from './layers';
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
  const ch = group.children;
  for (let i = 0; i < ch.length; i++) {
    const layer = ch[i];
    // Capas recortadas por esta (máscara de recorte): las siguientes con `clip`
    const clipped: Layer[] = [];
    while (i + 1 < ch.length && ch[i + 1].clip) clipped.push(ch[++i]);
    if (layer.clip) continue; // recortada sin base válida
    if (!layer.visible || layer.opacity <= 0) continue;
    if (layer instanceof AdjustmentLayer) applyAdjustment(layer, ctx, w, h, opts);
    else if (layer instanceof GroupLayer && layer.blendMode === 'pass-through' && !clipped.length && !hasStyles(layer.styles)) {
      // Grupo en modo «Pasar»: sus capas actúan directamente sobre lo de debajo
      const mask = opts.overrides?.get(layer)?.mask ?? (layer.mask?.enabled ? layer.mask.canvas : null);
      if (layer.opacity >= 1 && !mask) compositeGroup(layer, ctx, w, h, opts);
      else {
        const r = borrowCanvas(w, h), rc = ctx2d(r);
        rc.save(); clipTo(rc, opts);
        rc.drawImage(ctx.canvas, 0, 0);
        compositeGroup(layer, rc, w, h, opts);
        if (mask) { rc.globalCompositeOperation = 'destination-in'; rc.drawImage(mask, 0, 0); }
        rc.restore();
        ctx.save(); ctx.globalAlpha = layer.opacity; ctx.drawImage(r, 0, 0); ctx.restore();
        returnCanvas(r);
      }
    }
    else drawLayer(layer, ctx, w, h, opts, clipped.filter(c => c.visible && c.opacity > 0));
  }
}

function clipTo(ctx: CanvasRenderingContext2D, opts: CompositeOptions) {
  if (opts.rect) { ctx.beginPath(); ctx.rect(opts.rect.x, opts.rect.y, opts.rect.w, opts.rect.h); ctx.clip(); }
}

/** Contenido de una capa (con su máscara aplicada) sin opacidad ni modo de fusión. */
function layerSurface(layer: Layer, w: number, h: number, opts: CompositeOptions): { canvas: HTMLCanvasElement; off: { x: number; y: number }; temp: HTMLCanvasElement | null } {
  const ov = opts.overrides?.get(layer);
  const mask = ov?.mask ?? (layer.mask?.enabled ? layer.mask.canvas : null);
  if (isRaster(layer) && !mask && !ov?.extra) return { canvas: ov?.canvas ?? layer.canvas, off: ov?.offset ?? { x: 0, y: 0 }, temp: null };
  const temp = borrowCanvas(w, h);
  const tctx = ctx2d(temp);
  tctx.save(); clipTo(tctx, opts);
  if (layer instanceof GroupLayer) compositeGroup(layer, tctx, w, h, opts);
  else if (isRaster(layer)) {
    tctx.drawImage(ov?.canvas ?? layer.canvas, ov?.offset?.x ?? 0, ov?.offset?.y ?? 0);
    ov?.extra?.(tctx);
  }
  if (mask) { tctx.globalCompositeOperation = 'destination-in'; tctx.drawImage(mask, 0, 0); }
  tctx.restore();
  return { canvas: temp, off: { x: 0, y: 0 }, temp };
}

function drawLayer(layer: Layer, ctx: CanvasRenderingContext2D, w: number, h: number, opts: CompositeOptions, clipped: Layer[] = []) {
  const ov = opts.overrides?.get(layer);
  const base = layerSurface(layer, w, h, opts);
  let surface = base.canvas, off = base.off;
  const extra: HTMLCanvasElement[] = [];
  if (base.temp) extra.push(base.temp);

  if (clipped.length) {
    // Grupo de recorte: las capas de encima solo se ven donde la base tiene píxeles
    const g = borrowCanvas(w, h), gctx = ctx2d(g);
    extra.push(g);
    gctx.save(); clipTo(gctx, opts);
    gctx.drawImage(surface, off.x, off.y);
    for (const c of clipped) {
      if (c instanceof AdjustmentLayer) { applyAdjustment(c, gctx, w, h, opts); continue; }
      const cs = layerSurface(c, w, h, opts);
      const t = borrowCanvas(w, h), tc = ctx2d(t);
      tc.drawImage(cs.canvas, cs.off.x, cs.off.y);
      tc.globalCompositeOperation = 'destination-in'; tc.drawImage(surface, off.x, off.y); tc.globalCompositeOperation = 'source-over';
      gctx.globalAlpha = c.opacity; gctx.globalCompositeOperation = canvasBlend(c.blendMode);
      gctx.drawImage(t, 0, 0);
      gctx.globalAlpha = 1; gctx.globalCompositeOperation = 'source-over';
      returnCanvas(t); if (cs.temp) returnCanvas(cs.temp);
    }
    gctx.restore();
    if (hasStyles(layer.styles)) {
      const st = borrowCanvas(w, h), sc = ctx2d(st); extra.push(st);
      renderStyles(sc, surface, layer.styles, off.x, off.y, w, h); sc.drawImage(g, 0, 0);
      surface = st;
    } else surface = g;
    off = { x: 0, y: 0 };
  } else if (hasStyles(layer.styles)) {
    // Con estilos: sombra/resplandor/trazo por debajo y la capa encima. Se guarda en caché si nada cambia.
    const key = ov || !isRaster(layer) ? null : `${layer.version}|${layer.mask?.version}|${layer.mask?.enabled}|${w}x${h}|${JSON.stringify(layer.styles)}`;
    const cached = key ? styleCache.get(layer) : undefined;
    if (cached && cached.key === key) surface = cached.canvas;
    else {
      let out: HTMLCanvasElement;
      if (key) out = makeCanvas(w, h); else { out = borrowCanvas(w, h); extra.push(out); }
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
  ctx.globalCompositeOperation = canvasBlend(layer.blendMode);
  ctx.drawImage(surface, off.x, off.y);
  ctx.restore();
  for (const c of extra) returnCanvas(c);
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
