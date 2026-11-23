// Compositor: combina todas las capas visibles en una sola imagen.

import { isCustomBlend, drawCustomBlend } from './blend';
import { borrowCanvas, returnCanvas, ctx2d, Rect } from './canvas';
import { canvasBlend, GroupLayer, Layer, AdjustmentLayer, LayerStyles, hasStyles, isRaster, blendIfActive, effectiveMask } from './layers';
import { FILTERS } from '../filters/registry';
import { hexToRgb, makeCanvas } from './canvas';
import { bevelLayers } from './bevel';
import { getPattern } from './patterns';
import { POINTWISE, applyLutSteps, LutStep } from './adjlut';

/** Sustituciones temporales usadas por las herramientas para previsualizar. */
export interface LayerOverride {
  canvas?: HTMLCanvasElement;
  mask?: HTMLCanvasElement;
  offset?: { x: number; y: number };
  /** Dibujo extra encima del contenido de la capa (p. ej. contenido flotante). */
  extra?: (ctx: CanvasRenderingContext2D) => void;
  /** Desplazamiento provisional de la máscara vectorial (al mover la capa). */
  vmOffset?: { x: number; y: number };
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
    if (layer instanceof AdjustmentLayer) {
      // varias capas de ajuste seguidas se aplican juntas (una sola tabla de color)
      const run = [layer];
      while (i + 1 < ch.length && ch[i + 1] instanceof AdjustmentLayer && !ch[i + 1].clip && (i + 2 >= ch.length || !ch[i + 2].clip)) { const n = ch[++i] as AdjustmentLayer; if (n.visible && n.opacity > 0) run.push(n); }
      applyAdjustRun(run, ctx, w, h, opts);
    }
    else if (layer instanceof GroupLayer && layer.artboard) {
      // Mesa de trabajo: fondo propio y todo recortado a su rectángulo
      const a = layer.artboard, r = borrowCanvas(w, h), rc = ctx2d(r);
      rc.save(); clipTo(rc, opts); rc.beginPath(); rc.rect(a.x, a.y, a.w, a.h); rc.clip();
      if (a.bg) { rc.fillStyle = a.bg; rc.fillRect(a.x, a.y, a.w, a.h); }
      compositeGroup(layer, rc, w, h, opts);
      rc.restore();
      ctx.save(); ctx.globalAlpha = layer.opacity; ctx.drawImage(r, 0, 0); ctx.restore();
      returnCanvas(r);
    }
    else if (layer instanceof GroupLayer && layer.blendMode === 'pass-through' && !clipped.length && !hasStyles(layer.styles)) {
      // Grupo en modo «Pasar»: sus capas actúan directamente sobre lo de debajo
      const mask = effectiveMask(layer, opts.overrides?.get(layer)?.mask ?? (layer.mask?.enabled ? layer.mask.canvas : null), w, h);
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
  let ov = opts.overrides?.get(layer);
  const mask = effectiveMask(layer, ov?.mask ?? (layer.mask?.enabled ? layer.mask.canvas : null), w, h, ov?.vmOffset);
  // vista previa a tamaño reducido (p. ej. del degradado mientras se arrastra): se estira al tamaño del documento
  if (ov?.canvas && (ov.canvas.width !== w || ov.canvas.height !== h) && isRaster(layer) && !ov.offset) {
    const big = borrowCanvas(w, h), bx = ctx2d(big); bx.imageSmoothingQuality = 'low'; bx.drawImage(ov.canvas, 0, 0, w, h);
    ov = { ...ov, canvas: big };
  }
  if (isRaster(layer) && !mask && !ov?.extra) return { canvas: ov?.canvas ?? layer.canvas, off: ov?.offset ?? { x: 0, y: 0 }, temp: null };
  // Sin estilos, todo lo que se dibuje queda recortado a la zona: basta con vaciar esa zona
  const temp = borrowCanvas(w, h, hasStyles(layer.styles) ? null : opts.rect);
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
      if (c instanceof AdjustmentLayer) { applyAdjustRun([c], gctx, w, h, opts); continue; }
      const cs = layerSurface(c, w, h, opts);
      const t = borrowCanvas(w, h), tc = ctx2d(t);
      tc.drawImage(cs.canvas, cs.off.x, cs.off.y);
      tc.globalCompositeOperation = 'destination-in'; tc.drawImage(surface, off.x, off.y); tc.globalCompositeOperation = 'source-over';
      if (isCustomBlend(c.blendMode)) drawCustomBlend(gctx, t, 0, 0, c.blendMode, c.opacity, opts.rect);
      else { gctx.globalAlpha = c.opacity; gctx.globalCompositeOperation = canvasBlend(c.blendMode); gctx.drawImage(t, 0, 0); }
      gctx.globalAlpha = 1; gctx.globalCompositeOperation = 'source-over';
      returnCanvas(t); if (cs.temp) returnCanvas(cs.temp);
    }
    gctx.restore();
    if (hasStyles(layer.styles)) {
      const st = borrowCanvas(w, h), sc = ctx2d(st); extra.push(st);
      composeStyled(sc, surface, layer.styles, off.x, off.y, w, h, g, layer.fillOpacity);
      surface = st;
    } else surface = g;
    off = { x: 0, y: 0 };
  } else if (hasStyles(layer.styles)) {
    // Con estilos: sombra/resplandor/trazo por debajo y la capa encima. Se guarda en caché si nada cambia.
    const key = ov || !isRaster(layer) ? null : `${layer.version}|${layer.mask?.version}|${layer.mask?.enabled}|${w}x${h}|${layer.fillOpacity}|${JSON.stringify(layer.styles)}`;
    const cached = key ? styleCache.get(layer) : undefined;
    if (cached && cached.key === key) surface = cached.canvas;
    else {
      let out: HTMLCanvasElement;
      if (key) out = makeCanvas(w, h); else { out = borrowCanvas(w, h); extra.push(out); }
      const sctx = ctx2d(out);
      composeStyled(sctx, surface, layer.styles, off.x, off.y, w, h, undefined, layer.fillOpacity);
      if (key) styleCache.set(layer, { key, canvas: out });
      surface = out;
    }
    off = { x: 0, y: 0 };
  }
  if (blendIfActive(layer.styles)) {
    // Fusionar si: la capa se ve según su luminosidad y la de lo que tiene debajo
    const bi = layer.styles!.blendIf!;
    let x = 0, y = 0, x1 = w, y1 = h;
    if (opts.rect) { x = Math.max(0, Math.floor(opts.rect.x)); y = Math.max(0, Math.floor(opts.rect.y)); x1 = Math.min(w, Math.ceil(opts.rect.x + opts.rect.w)); y1 = Math.min(h, Math.ceil(opts.rect.y + opts.rect.h)); }
    if (x1 > x && y1 > y) {
      const t = borrowCanvas(w, h), tc = ctx2d(t); extra.push(t);
      tc.drawImage(surface, off.x, off.y);
      const sd = tc.getImageData(x, y, x1 - x, y1 - y), ud = ctx.getImageData(x, y, x1 - x, y1 - y).data, a = sd.data;
      const ramp = (v: number, r: number[]) => v < r[0] ? 0 : v < r[1] ? (v - r[0]) / Math.max(1, r[1] - r[0]) : v <= r[2] ? 1 : v <= r[3] ? (r[3] - v) / Math.max(1, r[3] - r[2]) : 0;
      for (let i = 0; i < a.length; i += 4) {
        if (!a[i + 3]) continue;
        const ls = a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11, lu = ud[i] * 0.3 + ud[i + 1] * 0.59 + ud[i + 2] * 0.11;
        a[i + 3] *= ramp(ls, bi.this) * ramp(lu, bi.under);
      }
      tc.putImageData(sd, x, y);
      surface = t; off = { x: 0, y: 0 };
    }
  }
  const alpha = layer.opacity * (hasStyles(layer.styles) ? 1 : layer.fillOpacity);
  if (isCustomBlend(layer.blendMode)) drawCustomBlend(ctx, surface, off.x, off.y, layer.blendMode, alpha, opts.rect);
  else {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = canvasBlend(layer.blendMode);
    ctx.drawImage(surface, off.x, off.y);
    ctx.restore();
  }
  for (const c of extra) returnCanvas(c);
}

const styleCache = new WeakMap<Layer, { key: string; canvas: HTMLCanvasElement }>();
const rgba = (hex: string, a: number) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };


/** Silueta de `src` ensanchada `r` px (en un lienzo de w×h, ya coloreada). */
function dilated(src: HTMLCanvasElement, ox: number, oy: number, r: number, w: number, h: number, color: string): HTMLCanvasElement {
  const t = borrowCanvas(w, h), tc = ctx2d(t);
  if (r <= 0.5) tc.drawImage(src, ox, oy);
  else for (const rr of r > 3 ? [r, r * 0.66, r * 0.33] : [r]) {
    const n = Math.max(12, Math.ceil(rr * 2.5));
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; tc.drawImage(src, ox + Math.cos(a) * rr, oy + Math.sin(a) * rr); }
  }
  tc.drawImage(src, ox, oy);
  tc.globalCompositeOperation = 'source-in'; tc.fillStyle = color; tc.fillRect(0, 0, w, h); tc.globalCompositeOperation = 'source-over';
  return t;
}

/** Dibuja los efectos de estilo de `src` (sin la propia capa). Sirve también para exportar. */
export function renderStyles(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, st: LayerStyles, ox: number, oy: number, w: number, h: number, bl?: { hi: HTMLCanvasElement; sh: HTMLCanvasElement } | null, knock = false) {
  const FAR = w + 4096; // la imagen se dibuja fuera y solo su "sombra" cae dentro del lienzo
  const cast = (color: string, blur: number, dx: number, dy: number, times = 1) => {
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.shadowOffsetX = FAR + dx; ctx.shadowOffsetY = dy;
    for (let i = 0; i < times; i++) ctx.drawImage(src, ox - FAR, oy);
    ctx.restore();
  };
  // Extensión: la silueta se ensancha antes de difuminar (sombra o resplandor más duros)
  const castSpread = (color: string, size: number, spread: number, dx: number, dy: number, times = 1) => {
    if (!spread) { cast(color, size, dx, dy, times); return; }
    const grow = size * spread / 100, blur = size * (1 - spread / 100);
    const big = dilated(src, ox, oy, grow, w, h, '#000');
    ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.shadowOffsetX = FAR + dx; ctx.shadowOffsetY = dy;
    for (let i = 0; i < times; i++) ctx.drawImage(big, -FAR, 0);
    ctx.restore(); returnCanvas(big);
  };
  if (st.shadow?.enabled) {
    const s = st.shadow, a = s.angle * Math.PI / 180;
    castSpread(rgba(s.color, s.opacity / 100), s.blur, s.spread ?? 0, -Math.cos(a) * s.distance, Math.sin(a) * s.distance);
  }
  if (st.glow?.enabled) castSpread(rgba(st.glow.color, st.glow.opacity / 100), st.glow.size, st.glow.spread ?? 0, 0, 0, 2);
  const sk = st.stroke;
  if (sk?.enabled && sk.size > 0 && (sk.position ?? 'outside') !== 'inside') {
    // exterior: todo el grosor por fuera; centro: la mitad (la otra mitad va por dentro)
    const r = (sk.position ?? 'outside') === 'center' ? sk.size / 2 : sk.size;
    const t = dilated(src, ox, oy, r, w, h, sk.color);
    // con el relleno bajado, el contorno no debe verse por dentro de la forma
    if (knock) { const tc = ctx2d(t); tc.globalCompositeOperation = 'destination-out'; tc.drawImage(src, ox, oy); tc.globalCompositeOperation = 'source-over'; }
    ctx.save(); ctx.globalAlpha = (sk.opacity ?? 100) / 100; ctx.drawImage(t, 0, 0); ctx.restore();
    returnCanvas(t);
  }
  // Parte exterior del bisel (exterior, relieve, almohadillado): fuera de la forma de la capa
  if (bl && st.bevel!.style !== 'inner') {
    for (const [c, mode] of [[bl.hi, 'screen'], [bl.sh, 'multiply']] as const) {
      const t = borrowCanvas(w, h), tc = ctx2d(t);
      tc.drawImage(c, 0, 0); tc.globalCompositeOperation = 'destination-out'; tc.drawImage(src, ox, oy);
      ctx.save(); ctx.globalCompositeOperation = mode; ctx.drawImage(t, 0, 0); ctx.restore();
      returnCanvas(t);
    }
  }
}

/** Efectos que van por encima de la capa, recortados a su forma (superposiciones, sombra y resplandor interiores). */
function innerStyled(src: HTMLCanvasElement, st: LayerStyles, ox: number, oy: number, w: number, h: number, bl?: { hi: HTMLCanvasElement; sh: HTMLCanvasElement } | null): HTMLCanvasElement | null {
  const innerStroke = !!st.stroke?.enabled && (st.stroke.position ?? 'outside') !== 'outside';
  if (!(innerStroke || st.satin?.enabled || st.innerShadow?.enabled || st.innerGlow?.enabled || st.colorOverlay?.enabled || st.gradientOverlay?.enabled || st.patternOverlay?.enabled || (bl && st.bevel!.style !== 'outer'))) return null;
  const o = borrowCanvas(w, h), c = ctx2d(o);
  c.drawImage(src, ox, oy);
  c.globalCompositeOperation = 'source-atop';
  const go = st.gradientOverlay;
  if (go?.enabled && go.stops.length) {
    const b = contentBoundsFast(src, ox, oy, w, h);
    const a = -go.angle * Math.PI / 180, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const half = (Math.abs(Math.cos(a)) * b.w + Math.abs(Math.sin(a)) * b.h) / 2;
    const g = c.createLinearGradient(cx - Math.cos(a) * half, cy - Math.sin(a) * half, cx + Math.cos(a) * half, cy + Math.sin(a) * half);
    for (const [t, col] of go.stops) g.addColorStop(Math.max(0, Math.min(1, t)), col);
    c.globalAlpha = go.opacity / 100; c.fillStyle = g; c.fillRect(0, 0, w, h); c.globalAlpha = 1;
  }
  const po = st.patternOverlay;
  if (po?.enabled) {
    const pat = getPattern(po.pattern);
    if (pat) { const p = c.createPattern(pat.canvas, 'repeat')!; p.setTransform(new DOMMatrix().scale(po.scale / 100)); c.globalAlpha = po.opacity / 100; c.fillStyle = p; c.fillRect(0, 0, w, h); c.globalAlpha = 1; }
  }
  if (st.colorOverlay?.enabled) { c.globalAlpha = st.colorOverlay.opacity / 100; c.fillStyle = st.colorOverlay.color; c.fillRect(0, 0, w, h); c.globalAlpha = 1; }
  if (st.innerGlow?.enabled || st.innerShadow?.enabled) {
    // Silueta invertida: su "sombra" cae hacia dentro de la capa
    const inv = borrowCanvas(w, h), ic = ctx2d(inv);
    ic.fillStyle = '#000'; ic.fillRect(0, 0, w, h);
    ic.globalCompositeOperation = 'destination-out'; ic.drawImage(src, ox, oy); ic.globalCompositeOperation = 'source-over';
    const FAR = w + 4096;
    const cast = (color: string, blur: number, dx: number, dy: number, times: number) => {
      c.shadowColor = color; c.shadowBlur = blur; c.shadowOffsetX = FAR + dx; c.shadowOffsetY = dy;
      // margen extra para que el borde del lienzo no cuente como "fuera"
      for (let i = 0; i < times; i++) c.drawImage(inv, -FAR, 0);
      c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetX = 0; c.shadowOffsetY = 0;
    };
    if (st.innerGlow?.enabled) cast(rgba(st.innerGlow.color, st.innerGlow.opacity / 100), st.innerGlow.size, 0, 0, 2);
    if (st.innerShadow?.enabled) { const s = st.innerShadow, a = s.angle * Math.PI / 180; cast(rgba(s.color, s.opacity / 100), s.blur, -Math.cos(a) * s.distance, Math.sin(a) * s.distance, 1); }
    returnCanvas(inv);
  }
  // Parte interior del bisel: luces en Trama y sombras en Multiplicar, dentro de la forma
  if (bl && st.bevel!.style !== 'outer') {
    for (const [bc, mode] of [[bl.hi, 'screen'], [bl.sh, 'multiply']] as const) {
      const t = borrowCanvas(w, h), tc = ctx2d(t);
      tc.drawImage(bc, 0, 0); tc.globalCompositeOperation = 'destination-in'; tc.drawImage(src, ox, oy);
      c.globalCompositeOperation = mode; c.drawImage(t, 0, 0);
      returnCanvas(t);
    }
  }
  if (st.satin?.enabled) {
    // Satinado: dos copias desplazadas y difuminadas de la forma; donde difieren, sombra
    const sa = st.satin, ang = sa.angle * Math.PI / 180, dx = -Math.cos(ang) * sa.distance, dy = Math.sin(ang) * sa.distance;
    const t = borrowCanvas(w, h), tc = ctx2d(t);
    tc.filter = `blur(${Math.max(0, sa.size / 2)}px)`;
    tc.drawImage(src, ox + dx, oy + dy); tc.globalCompositeOperation = 'xor'; tc.drawImage(src, ox - dx, oy - dy);
    tc.filter = 'none';
    if (sa.invert) { tc.globalCompositeOperation = 'xor'; tc.fillStyle = '#000'; tc.fillRect(0, 0, w, h); }
    tc.globalCompositeOperation = 'source-in'; tc.fillStyle = rgba(sa.color, sa.opacity / 100); tc.fillRect(0, 0, w, h);
    tc.globalCompositeOperation = 'destination-in'; tc.drawImage(src, ox, oy);
    c.globalCompositeOperation = 'multiply'; c.drawImage(t, 0, 0); returnCanvas(t);
  }
  if (innerStroke) {
    // Trazo interior (o la mitad interior del centrado): la silueta invertida ensanchada hacia dentro
    const sk = st.stroke!, r = sk.position === 'center' ? sk.size / 2 : sk.size;
    const inv = borrowCanvas(w, h), ic = ctx2d(inv);
    ic.fillStyle = '#000'; ic.fillRect(0, 0, w, h); ic.globalCompositeOperation = 'destination-out'; ic.drawImage(src, ox, oy);
    const t = dilated(inv, 0, 0, r, w, h, sk.color), tc = ctx2d(t);
    tc.globalCompositeOperation = 'destination-in'; tc.drawImage(src, ox, oy);
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = (sk.opacity ?? 100) / 100; c.drawImage(t, 0, 0); c.globalAlpha = 1;
    returnCanvas(t); returnCanvas(inv);
  }
  c.globalCompositeOperation = 'source-over';
  return o;
}
const boundsCache = new WeakMap<HTMLCanvasElement, { w: number; h: number; b: Rect }>();
/** Caja del contenido para orientar degradados (se recalcula solo si cambia el tamaño del lienzo fuente). */
function contentBoundsFast(src: HTMLCanvasElement, ox: number, oy: number, w: number, h: number): Rect {
  const d = ctx2d(src).getImageData(0, 0, src.width, src.height).data;
  let x0 = src.width, y0 = src.height, x1 = -1, y1 = -1;
  const step = Math.max(1, Math.floor(Math.max(src.width, src.height) / 512));
  for (let y = 0; y < src.height; y += step) for (let x = 0; x < src.width; x += step) if (d[(y * src.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  void boundsCache;
  return x1 < 0 ? { x: 0, y: 0, w, h } : { x: x0 + ox, y: y0 + oy, w: x1 - x0 + step, h: y1 - y0 + step };
}

/** Capa con todos sus estilos: efectos de fondo, la capa (o `body`) y efectos interiores. */
export function composeStyled(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, st: LayerStyles, ox: number, oy: number, w: number, h: number, body?: HTMLCanvasElement, fill = 1) {
  const bl = st.bevel?.enabled ? bevelLayers(src, ox, oy, w, h, st.bevel) : null;
  renderStyles(ctx, src, st, ox, oy, w, h, bl, fill < 1);
  // Relleno: el contenido (y sus efectos interiores) con menos opacidad; los efectos exteriores quedan igual
  ctx.save(); ctx.globalAlpha *= Math.max(0, Math.min(1, fill));
  const top = body ? null : innerStyled(src, st, ox, oy, w, h, bl);
  if (top) { ctx.drawImage(top, 0, 0); returnCanvas(top); }
  else if (body) {
    // Grupo de recorte: los efectos interiores se aplican sobre el conjunto ya recortado
    const t2 = innerStyled(body, st, 0, 0, w, h, bl);
    ctx.drawImage(t2 ?? body, 0, 0); if (t2) returnCanvas(t2);
  } else ctx.drawImage(src, ox, oy);
  ctx.restore();
}

const filterById = new Map(FILTERS.map(f => [f.id, f]));

/** Aplica capas de ajuste seguidas: las «de color» sin máscara se juntan en una tabla; el resto, una a una. */
export function applyAdjustRun(run: AdjustmentLayer[], ctx: CanvasRenderingContext2D, w: number, h: number, opts: CompositeOptions) {
  let x = 0, y = 0, x1 = w, y1 = h;
  if (opts.rect) { x = Math.max(0, Math.floor(opts.rect.x)); y = Math.max(0, Math.floor(opts.rect.y)); x1 = Math.min(w, Math.ceil(opts.rect.x + opts.rect.w)); y1 = Math.min(h, Math.ceil(opts.rect.y + opts.rect.h)); }
  if (x1 <= x || y1 <= y) return;
  let batch: LutStep[] = [];
  const flush = () => { if (batch.length) applyLutSteps(ctx, batch, x, y, x1 - x, y1 - y); batch = []; };
  for (const l of run) {
    const def = filterById.get(l.filterId);
    if (!def) continue;
    const lutable = lutEnabled.on && POINTWISE.has(def.id) && !def.fill && canvasBlend(l.blendMode) === 'source-over' && !isCustomBlend(l.blendMode);
    const mc = lutable ? effectiveMask(l, opts.overrides?.get(l)?.mask ?? (l.mask?.enabled ? l.mask.canvas : null), w, h) : null;
    if (lutable && !mc) { batch.push({ def, params: l.params, opacity: l.opacity }); continue; }
    flush();
    if (lutable && mc) applyLutSteps(ctx, [{ def, params: l.params, opacity: l.opacity }], x, y, x1 - x, y1 - y, mc);
    else applyAdjustment(l, ctx, w, h, opts);
  }
  flush();
}
/** Para comparar con el cálculo exacto (pruebas). */
export const lutEnabled = { on: true };

/** Aplica una capa de ajuste a lo ya pintado en `ctx` (respeta su máscara y opacidad). */
function applyAdjustment(l: AdjustmentLayer, ctx: CanvasRenderingContext2D, w: number, h: number, opts: CompositeOptions) {
  const def = filterById.get(l.filterId);
  if (!def) return;
  let x = 0, y = 0, x1 = w, y1 = h;
  if (opts.rect) { x = Math.max(0, Math.floor(opts.rect.x)); y = Math.max(0, Math.floor(opts.rect.y)); x1 = Math.min(w, Math.ceil(opts.rect.x + opts.rect.w)); y1 = Math.min(h, Math.ceil(opts.rect.y + opts.rect.h)); }
  if (x1 <= x || y1 <= y) return;
  const mc = effectiveMask(l, opts.overrides?.get(l)?.mask ?? (l.mask?.enabled ? l.mask.canvas : null), w, h);
  const params = def.fill ? { ...l.params, _x: x, _y: y, _W: w, _H: h } : l.params;
  if (def.fill || canvasBlend(l.blendMode) !== 'source-over' || isCustomBlend(l.blendMode)) {
    // Relleno o ajuste con modo de fusión: el resultado se dibuja encima con su máscara, opacidad y modo
    const rw = x1 - x, rh = y1 - y;
    const img2 = def.fill ? new ImageData(rw, rh) : ctx.getImageData(x, y, rw, rh);
    def.apply(img2, params);
    const t = makeCanvas(rw, rh), tc = ctx2d(t); tc.putImageData(img2, 0, 0);
    if (mc) { tc.globalCompositeOperation = 'destination-in'; tc.drawImage(mc, -x, -y); }
    if (isCustomBlend(l.blendMode)) drawCustomBlend(ctx, t, x, y, l.blendMode, l.opacity, opts.rect);
    else { ctx.save(); ctx.globalAlpha = l.opacity; ctx.globalCompositeOperation = canvasBlend(l.blendMode); ctx.drawImage(t, x, y); ctx.restore(); }
    return;
  }
  const img = ctx.getImageData(x, y, x1 - x, y1 - y);
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
