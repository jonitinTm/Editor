// Bote de pintura, degradado, cuentagotas, mano y zoom.

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import type { Viewport } from '../ui/viewport';
import { getPaintTarget, setPreview, setTargetCanvas, strokeSetup, PaintTarget, clipMask } from './paint';
import { floodMask } from './floodfill';
import { cloneCanvas, ctx2d, getPixels, makeCanvas, rgbToHex, hexToRgb } from '../core/canvas';
import { gradientEditor, GradStop } from '../ui/gradienteditor';
import { allPatterns, getPattern } from '../core/patterns';

/** Dibuja `src` sobre el objetivo respetando selección, opacidad y modo (capa/máscara). */
export function applyOnTarget(t: PaintTarget, base: HTMLCanvasElement, src: HTMLCanvasElement, opacity: number, maskValue: number, blend: GlobalCompositeOperation = 'source-over'): HTMLCanvasElement {
  const out = cloneCanvas(base);
  const sel = clipMask(t);
  let s = src;
  if (sel) {
    s = cloneCanvas(src);
    const c = ctx2d(s); c.globalCompositeOperation = 'destination-in'; c.drawImage(sel, 0, 0);
  }
  const ctx = ctx2d(out);
  ctx.globalAlpha = opacity;
  if (t.isMask) {
    ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(s, 0, 0);
    ctx.globalAlpha = opacity * maskValue; ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(s, 0, 0);
  } else if (blend !== 'source-over') {
    ctx.globalCompositeOperation = blend; ctx.drawImage(s, 0, 0);
    if (t.lockAlpha) { ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(base, 0, 0); }
  } else { if (t.lockAlpha) ctx.globalCompositeOperation = 'source-atop'; ctx.drawImage(s, 0, 0); }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  return out;
}

export class BucketTool implements Tool {
  id = 'bucket'; name = 'Bote de pintura'; icon = icon('bucket'); key = 'G'; group = 'fill'; cursor = 'crosshair';
  options = [
    { key: 'tolerance', label: 'Tolerancia', type: 'range', min: 0, max: 255, default: 32 },
    { key: 'opacity', label: 'Opacidad', type: 'range', min: 1, max: 100, default: 100, unit: '%' },
    { key: 'contiguous', label: 'Contiguo', type: 'checkbox', default: true },
    { key: 'all', label: 'Todas las capas', type: 'checkbox', default: false },
    { key: 'source', label: 'Relleno', type: 'select', default: 'fg', choices: [{ value: 'fg', label: 'Color frontal' }, { value: 'pattern', label: 'Motivo' }] },
    { key: 'pattern', label: 'Motivo', type: 'select', default: 'base:Damero', choices: [] },
  ] as any[];
  activate() {
    // La lista de motivos puede cambiar (motivos definidos por el usuario)
    const o = this.options.find((x: any) => x.key === 'pattern'); o.choices = allPatterns().map(p => ({ value: p.id, label: p.name }));
  }
  down(e: ToolEvent) {
    const t = getPaintTarget();
    if (!t) return;
    const doc = app.doc!;
    const src = app.opt('all', this.id) && !t.isMask ? doc.flatten() : t.canvas;
    const res = floodMask(getPixels(src), e.x, e.y, app.opt('tolerance', this.id), app.opt('contiguous', this.id));
    if (!res) return;
    const st = strokeSetup(t, false);
    const fill = res.canvas; const fc = ctx2d(fill);
    const pat = app.opt('source', this.id) === 'pattern' && !t.isMask ? getPattern(app.opt('pattern', this.id)) : null;
    fc.globalCompositeOperation = 'source-in';
    if (pat) { fc.fillStyle = fc.createPattern(pat.canvas, 'repeat')!; } else fc.fillStyle = st.color;
    fc.fillRect(0, 0, fill.width, fill.height);
    setTargetCanvas(t, applyOnTarget(t, t.canvas, fill, app.opt<number>('opacity', this.id) / 100, st.maskValue));
    doc.commit('Bote de pintura');
  }
}

/** Degradados predefinidos (posición, color, opacidad). */
export const GRAD_PRESETS: Record<string, { name: string; stops: [number, string, number?][] }> = {
  spectrum: { name: 'Espectro', stops: [[0, '#ff0000'], [0.17, '#ffff00'], [0.33, '#00ff00'], [0.5, '#00ffff'], [0.67, '#0000ff'], [0.83, '#ff00ff'], [1, '#ff0000']] },
  chrome: { name: 'Cromado', stops: [[0, '#2b3a4a'], [0.45, '#ffffff'], [0.5, '#5e4a33'], [0.7, '#c9a77c'], [1, '#ffffff']] },
  copper: { name: 'Cobre', stops: [[0, '#97462a'], [0.35, '#f2c9a0'], [0.65, '#8a3d22'], [1, '#f0d0b0']] },
  gold: { name: 'Oro', stops: [[0, '#8a6212'], [0.3, '#f8e08e'], [0.6, '#b8862b'], [1, '#fff3c4']] },
  sunset: { name: 'Puesta de sol', stops: [[0, '#2c1450'], [0.45, '#d9455f'], [0.75, '#f79a3e'], [1, '#ffe28a']] },
  violetOrange: { name: 'Violeta → Naranja', stops: [[0, '#5a1aa0'], [1, '#ff8a00']] },
  blueYellow: { name: 'Azul → Amarillo', stops: [[0, '#0a3bd6'], [1, '#ffe600']] },
  sea: { name: 'Mar', stops: [[0, '#012a4a'], [0.5, '#2a9dc2'], [1, '#bdf0ff']] },
  pastel: { name: 'Pastel', stops: [[0, '#ffb3c6'], [0.5, '#b8c0ff'], [1, '#b9fbc0']] },
  stripes: { name: 'Bandas transparentes', stops: [[0, '#000000', 1], [0.2, '#000000', 1], [0.2, '#000000', 0], [0.4, '#000000', 0], [0.4, '#000000', 1], [0.6, '#000000', 1], [0.6, '#000000', 0], [0.8, '#000000', 0], [0.8, '#000000', 1], [1, '#000000', 1]] },
};

export class GradientTool implements Tool {
  id = 'gradient'; name = 'Degradado'; icon = icon('gradient'); key = 'G'; group = 'fill'; cursor = 'crosshair';
  options = [
    { key: 'type', label: 'Tipo', type: 'select', default: 'linear', choices: [
      { value: 'linear', label: 'Lineal' }, { value: 'radial', label: 'Radial' }, { value: 'angle', label: 'Angular' },
      { value: 'reflected', label: 'Reflejado' }, { value: 'diamond', label: 'Diamante' }] },
    { key: 'colors', label: 'Colores', type: 'select', default: 'fgbg', choices: [
      { value: 'fgbg', label: 'Frontal → Fondo' }, { value: 'fgtrans', label: 'Frontal → Transparente' }, { value: 'bw', label: 'Negro → Blanco' },
      ...Object.entries(GRAD_PRESETS).map(([value, g]) => ({ value, label: g.name })), { value: 'custom', label: 'Personalizado' }] },
    { key: 'blendMode', label: 'Modo', type: 'select', default: 'source-over', choices: [{ value: 'source-over', label: 'Normal' }, { value: 'destination-over', label: 'Detrás' }, { value: 'multiply', label: 'Multiplicar' }, { value: 'screen', label: 'Trama' }, { value: 'overlay', label: 'Superponer' }, { value: 'soft-light', label: 'Luz suave' }, { value: 'color', label: 'Color' }, { value: 'luminosity', label: 'Luminosidad' }, { value: 'difference', label: 'Diferencia' }] },
    { key: 'opacity', label: 'Opacidad', type: 'range', min: 1, max: 100, default: 100, unit: '%' },
    { key: 'reverse', label: 'Invertir', type: 'checkbox', default: false },
    { key: 'dither', label: 'Tramado', type: 'checkbox', default: true },
  ] as any[];
  extraOptions(bar: HTMLElement) {
    const prev = document.createElement('canvas'); prev.width = 120; prev.height = 18; prev.className = 'grad-prev';
    const paint = () => { const c = prev.getContext('2d')!; c.clearRect(0, 0, 120, 18); const g = c.createLinearGradient(0, 0, 120, 0); for (const st of this.stops(false)) g.addColorStop(st.t, `rgba(${hexToRgb(st.color).join(',')},${st.a})`); c.fillStyle = g; c.fillRect(0, 0, 120, 18); };
    paint(); app.onBar('colors', paint); app.onBar('options', paint);
    prev.title = 'Editar degradado'; prev.onclick = () => gradientEditor(this.stops(false), st => { app.setOpt(this.id, 'stops', st); app.setOpt(this.id, 'colors', 'custom'); });
    const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Editar…'; b.onclick = () => prev.click();
    bar.append(prev, b);
  }
  /** Paradas del degradado actual (posición 0-1, color, opacidad 0-1). */
  stops(forMask: boolean): GradStop[] {
    const mode = app.opt('colors', this.id);
    let st: GradStop[] = mode === 'custom' && Array.isArray(app.opt('stops', this.id)) ? app.opt<GradStop[]>('stops', this.id).map(x => ({ ...x }))
      : mode === 'fgtrans' ? [{ t: 0, color: app.fg, a: 1 }, { t: 1, color: app.fg, a: 0 }]
      : mode === 'bw' ? [{ t: 0, color: '#000000', a: 1 }, { t: 1, color: '#ffffff', a: 1 }]
      : GRAD_PRESETS[mode as string] ? GRAD_PRESETS[mode as string].stops.map(([t, color, a]) => ({ t, color, a: a ?? 1 }))
      : [{ t: 0, color: app.fg, a: 1 }, { t: 1, color: app.bg, a: 1 }];
    if (forMask) st = st.map(x => { const [r, g, b] = hexToRgb(x.color); return { t: x.t, color: '#ffffff', a: x.a * (0.299 * r + 0.587 * g + 0.114 * b) / 255 }; });
    if (app.opt('reverse', this.id)) st = st.map(x => ({ ...x, t: 1 - x.t }));
    return st.sort((p, q) => p.t - q.t);
  }
  private a: { x: number; y: number } | null = null;
  private b: { x: number; y: number } | null = null;
  private t: PaintTarget | null = null;
  private base: HTMLCanvasElement | null = null;
  private preview: HTMLCanvasElement | null = null;

  down(e: ToolEvent) {
    const t = getPaintTarget();
    if (!t) return;
    this.t = t; this.base = cloneCanvas(t.canvas);
    this.a = { x: e.x, y: e.y }; this.b = { ...this.a };
  }
  private gbuf: HTMLCanvasElement | null = null;
  private baseSmall: HTMLCanvasElement | null = null;
  /** `quick`: vista previa mientras se arrastra (a menos resolución y sin tramado, para que vaya fluido). */
  private render(quick = false) {
    const t = this.t!, doc = app.doc!;
    const k = quick ? Math.min(1, 1000 / Math.max(doc.width, doc.height)) : 1;
    const W = Math.max(1, Math.round(doc.width * k)), Hh = Math.max(1, Math.round(doc.height * k));
    const a = { x: this.a!.x * k, y: this.a!.y * k }, b = { x: this.b!.x * k, y: this.b!.y * k };
    const g = makeCanvas(W, Hh), ctx = ctx2d(g);
    const stops = this.stops(t.isMask);
    const rgba = (st: GradStop) => `rgba(${hexToRgb(st.color).join(',')},${st.a})`;
    const type = app.opt('type', this.id);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (type === 'diamond' || (type === 'angle' && !(ctx as any).createConicGradient)) {
      // Se calcula píxel a píxel con una tabla de 256 colores
      const lut = makeCanvas(256, 1), lc = ctx2d(lut), lg = lc.createLinearGradient(0, 0, 256, 0);
      for (const st of stops) lg.addColorStop(st.t, rgba(st)); lc.fillStyle = lg; lc.fillRect(0, 0, 256, 1);
      const L = lc.getImageData(0, 0, 256, 1).data, img = ctx.createImageData(W, Hh), o = img.data;
      const cs = Math.cos(-ang), sn = Math.sin(-ang);
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
        const dx = x - a.x, dy = y - a.y;
        let tt = type === 'diamond' ? (Math.abs(dx * cs - dy * sn) + Math.abs(dx * sn + dy * cs)) / len : (((Math.atan2(dy, dx) - ang) / (Math.PI * 2)) % 1 + 1) % 1;
        const kk = Math.min(255, Math.max(0, Math.round(tt * 255))) * 4, i = (y * W + x) * 4;
        o[i] = L[kk]; o[i + 1] = L[kk + 1]; o[i + 2] = L[kk + 2]; o[i + 3] = L[kk + 3];
      }
      ctx.putImageData(img, 0, 0);
    } else {
      let grad: CanvasGradient;
      if (type === 'radial') grad = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, len);
      else if (type === 'angle') grad = (ctx as any).createConicGradient(ang, a.x, a.y);
      else if (type === 'reflected') grad = ctx.createLinearGradient(2 * a.x - b.x, 2 * a.y - b.y, b.x, b.y);
      else grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      if (type === 'reflected') for (const st of stops) { grad.addColorStop(0.5 + st.t / 2, rgba(st)); grad.addColorStop(0.5 - st.t / 2, rgba(st)); }
      else for (const st of stops) grad.addColorStop(st.t, rgba(st));
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, Hh);
    }
    if (quick) {
      const blend = (app.opt<string>('blendMode', this.id) || 'source-over') as GlobalCompositeOperation;
      if (!t.isMask && !clipMask(t) && !(t.lockAlpha && blend !== 'source-over')) {
        // caso normal: la vista previa se hace al tamaño reducido del degradado (W×Hh) y se estira al mostrarla
        if (!this.baseSmall || this.baseSmall.width !== W || this.baseSmall.height !== Hh) { this.baseSmall = makeCanvas(W, Hh); const bs = ctx2d(this.baseSmall); bs.imageSmoothingQuality = 'high'; bs.drawImage(this.base!, 0, 0, W, Hh); }
        if (!this.gbuf || this.gbuf.width !== W || this.gbuf.height !== Hh) this.gbuf = makeCanvas(W, Hh);
        const bx = ctx2d(this.gbuf), op = app.opt<number>('opacity', this.id) / 100;
        bx.globalCompositeOperation = 'copy'; bx.drawImage(this.baseSmall, 0, 0);
        bx.globalAlpha = op; bx.globalCompositeOperation = t.lockAlpha ? 'source-atop' : blend; bx.drawImage(g, 0, 0);
        bx.globalAlpha = 1; bx.globalCompositeOperation = 'source-over';
        return this.gbuf;
      }
      if (k < 1) { const big = makeCanvas(doc.width, doc.height), bx = ctx2d(big); bx.drawImage(g, 0, 0, doc.width, doc.height); return this.finish(big); }
      return this.finish(g);
    }
    // tramado: un poco de ruido para que no salgan bandas en degradados suaves
    if (app.opt('dither', this.id) !== false && doc.width * doc.height <= 16e6) {
      const id = ctx.getImageData(0, 0, W, Hh), o = id.data; let sd = 12345;
      for (let i = 0; i < o.length; i += 4) { if (!o[i + 3]) continue; sd = (sd * 1103515245 + 12345) & 0x7fffffff; const n = ((sd >> 16) & 3) - 1.5; o[i] += n; o[i + 1] += n; o[i + 2] += n; }
      ctx.putImageData(id, 0, 0);
    }
    return this.finish(g);
  }
  /** Combina el degradado ya calculado con la capa (o la máscara), respetando selección, opacidad y modo. */
  private finish(g: HTMLCanvasElement) {
    const t = this.t!, doc = app.doc!;
    const op = app.opt<number>('opacity', this.id) / 100;
    if (t.isMask) {
      // Sustituye el valor de la máscara por el del degradado dentro de la selección
      const out = cloneCanvas(this.base!);
      const sel = clipMask(t);
      const oc = ctx2d(out);
      let s = g;
      if (sel) { s = cloneCanvas(g); const sc = ctx2d(s); sc.globalCompositeOperation = 'destination-in'; sc.drawImage(sel, 0, 0); }
      const cover = makeCanvas(doc.width, doc.height); const cc = ctx2d(cover);
      cc.fillStyle = '#fff'; cc.fillRect(0, 0, doc.width, doc.height);
      if (sel) { cc.globalCompositeOperation = 'destination-in'; cc.drawImage(sel, 0, 0); }
      oc.globalAlpha = op; oc.globalCompositeOperation = 'destination-out'; oc.drawImage(cover, 0, 0);
      oc.globalCompositeOperation = 'lighter'; oc.drawImage(s, 0, 0);
      return out;
    }
    return applyOnTarget(t, this.base!, g, op, 1, (app.opt<string>('blendMode', this.id) || 'source-over') as GlobalCompositeOperation);
  }
  move(e: ToolEvent) {
    if (!this.a) return;
    let x = e.x, y = e.y;
    if (e.shift) { // ángulos de 45°
      const ang = Math.round(Math.atan2(y - this.a.y, x - this.a.x) / (Math.PI / 4)) * Math.PI / 4;
      const d = Math.hypot(x - this.a.x, y - this.a.y);
      x = this.a.x + Math.cos(ang) * d; y = this.a.y + Math.sin(ang) * d;
    }
    this.b = { x, y };
    // un cálculo por fotograma como mucho, aunque el dedo o el ratón manden más movimientos
    if (!this.raf) this.raf = requestAnimationFrame(() => {
      this.raf = 0; if (!this.a || !this.t) return;
      setPreview(this.t, this.render(true)); app.viewport?.requestRender(); app.doc!.invalidate();
    });
  }
  private raf = 0;
  up() {
    if (!this.a || !this.t) return;
    const t = this.t;
    setPreview(t, null);
    const moved = this.b && Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y) > 1;
    cancelAnimationFrame(this.raf); this.raf = 0;
    if (moved) { setTargetCanvas(t, this.render(false)); app.doc!.commit('Degradado'); }
    this.a = this.b = null; this.t = null; this.preview = null; this.base = null; this.gbuf = null; this.baseSmall = null;
    app.doc!.invalidate();
  }
  cancel() { cancelAnimationFrame(this.raf); this.raf = 0; if (this.t) setPreview(this.t, null); this.gbuf = null; this.a = this.b = null; this.t = null; app.doc?.invalidate(); }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (!this.a || !this.b) return;
    const p = vp.toScreen(this.a.x, this.a.y), q = vp.toScreen(this.b.x, this.b.y);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
    for (const s of [p, q]) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x, s.y, 3.5, 0, 7); ctx.fill(); ctx.stroke(); }
  }
}

export class EyedropperTool implements Tool {
  id = 'eyedropper'; name = 'Cuentagotas'; icon = icon('eyedropper'); key = 'I'; group = 'eyedropper'; cursor = 'crosshair';
  options = [
    { key: 'sampleSize', label: 'Muestra', type: 'select', default: '1', choices: [
      { value: '1', label: 'Punto' }, { value: '3', label: 'Media 3×3' }, { value: '5', label: 'Media 5×5' }, { value: '11', label: 'Media 11×11' }] },
    { key: 'source', label: 'De', type: 'select', default: 'all', choices: [
      { value: 'all', label: 'Todas las capas' }, { value: 'layer', label: 'Capa actual' }, { value: 'below', label: 'Actual y por debajo' }] },
    { key: 'ring', label: 'Mostrar anillo de muestra', type: 'checkbox', default: true },
  ] as any[];
  private alt = false;
  /** Anillo: arriba el color nuevo, abajo el que había antes. */
  private ring: { sx: number; sy: number; now: string; before: string } | null = null;
  private belowCache: HTMLCanvasElement | null = null;
  private pick(e: ToolEvent) {
    const doc = app.doc!;
    const l = doc.activeRaster();
    const srcOpt = app.opt('source', this.id);
    let src: HTMLCanvasElement = srcOpt === 'layer' && l ? l.canvas : doc.getComposite();
    if (srcOpt === 'below' && this.belowCache) src = this.belowCache;
    else if (srcOpt === 'below' && doc.active) {
      // se combinan solo la capa actual y las que tiene debajo (ocultando temporalmente las de encima)
      const all = doc.allLayers(), idx = all.indexOf(doc.active), above = all.slice(idx + 1).filter(x => x.visible && !all.slice(0, idx + 1).some(y => (y as any).parent === x));
      above.forEach(x => x.visible = false);
      try { doc.invalidate(); src = this.belowCache = cloneCanvas(doc.getComposite()); } finally { above.forEach(x => x.visible = true); doc.invalidate(); }
    }
    const n = parseInt(app.opt('sampleSize', this.id)) || 1;
    const x0 = Math.floor(e.x) - (n >> 1), y0 = Math.floor(e.y) - (n >> 1);
    if (Math.floor(e.x) < 0 || Math.floor(e.y) < 0 || e.x >= doc.width || e.y >= doc.height) return;
    const d = ctx2d(src).getImageData(Math.max(0, x0), Math.max(0, y0), n, n).data;
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < d.length; i += 4) { const al = d[i + 3]; r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al; }
    if (a === 0) return;
    const hex = rgbToHex(r / a, g / a, b / a);
    if (this.ring) { this.ring.now = hex; this.ring.sx = e.sx; this.ring.sy = e.sy; app.viewport.requestRender(); }
    if (this.alt) app.setColors(app.fg, hex); else app.setColors(hex, app.bg);
  }
  down(e: ToolEvent) {
    this.alt = e.alt;
    if (app.opt('ring', this.id) !== false) this.ring = { sx: e.sx, sy: e.sy, now: this.alt ? app.bg : app.fg, before: this.alt ? app.bg : app.fg };
    this.pick(e);
  }
  move(e: ToolEvent) { this.pick(e); }
  up() { this.ring = null; this.belowCache = null; app.viewport.requestRender(); }
  cancel() { this.ring = null; this.belowCache = null; }
  drawOverlay(ctx: CanvasRenderingContext2D) {
    const r = this.ring; if (!r) return;
    const R = 46, w = 16;
    ctx.save(); ctx.lineWidth = w;
    ctx.strokeStyle = r.now; ctx.beginPath(); ctx.arc(r.sx, r.sy, R, Math.PI, 0); ctx.stroke();
    ctx.strokeStyle = r.before; ctx.beginPath(); ctx.arc(r.sx, r.sy, R, 0, Math.PI); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(128,128,128,.9)';
    ctx.beginPath(); ctx.arc(r.sx, r.sy, R - w / 2, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(r.sx, r.sy, R + w / 2, 0, 7); ctx.stroke();
    ctx.restore();
  }
}

export class HandTool implements Tool {
  id = 'hand'; name = 'Mano'; icon = icon('hand'); key = 'H'; group = 'hand'; cursor = 'grab';
  extraOptions(bar: HTMLElement) {
    const b = (label: string, fn: () => void) => { const el = document.createElement('button'); el.className = 'btn'; el.textContent = label; el.onclick = fn; bar.append(el); };
    b('100 %', () => app.viewport.setZoom(1, null));
    b('Ajustar a pantalla', () => app.viewport.fit());
    b('Rellenar pantalla', () => app.viewport.fill());
    b('200 %', () => app.viewport.setZoom(2, null, true));
  }
}

export class ZoomTool implements Tool {
  id = 'zoom'; name = 'Zoom'; icon = icon('zoom'); key = 'Z'; cursor = 'zoom-in';
  extraOptions(bar: HTMLElement) { new HandTool().extraOptions(bar); const s = document.createElement('span'); s.className = 'hint'; s.textContent = 'Clic: acercar · Alt+clic: alejar · Arrastrar: zoom continuo'; bar.append(s); }
  private start: { sx: number; sy: number; zoom: number; alt: boolean } | null = null;
  private moved = false;
  down(e: ToolEvent) { this.start = { sx: e.sx, sy: e.sy, zoom: app.viewport.zoom, alt: e.alt }; this.moved = false; }
  move(e: ToolEvent) {
    if (!this.start) return;
    const dx = e.sx - this.start.sx;
    if (Math.abs(dx) > 3) this.moved = true;
    if (this.moved) app.viewport.setZoom(this.start.zoom * Math.exp(dx / 150), { x: this.start.sx, y: this.start.sy });
  }
  up(e: ToolEvent) {
    if (this.start && !this.moved) app.viewport.zoomStep(e.alt || this.start.alt ? -1 : 1, { x: e.sx, y: e.sy });
    this.start = null;
  }
}

/** Girar vista: gira el lienzo en pantalla para dibujar con comodidad (no cambia la imagen). */
export class RotateViewTool implements Tool {
  id = 'rotateView'; name = 'Girar vista'; icon = icon('rotateView'); key = 'R'; group = 'hand'; cursor = 'grab';
  private start: { a: number; rot: number } | null = null;
  extraOptions(bar: HTMLElement) {
    const inp = document.createElement('input'); inp.type = 'number'; inp.className = 'num'; inp.step = '1';
    const sync = () => { inp.value = String(Math.round((app.doc?.view.rot ?? 0) * 180 / Math.PI)); };
    inp.onchange = () => app.viewport.setRotation((+inp.value || 0) * Math.PI / 180);
    const lbl = document.createElement('span'); lbl.className = 'lbl hint'; lbl.textContent = 'Ángulo';
    const deg = document.createElement('span'); deg.className = 'unit'; deg.textContent = '°';
    const reset = document.createElement('button'); reset.className = 'btn'; reset.textContent = 'Restablecer vista'; reset.onclick = () => app.viewport.setRotation(0);
    const hint = document.createElement('span'); hint.className = 'hint'; hint.textContent = 'Arrastra para girar · Mayús: de 15° en 15° · Esc: restablecer';
    bar.append(lbl, inp, deg, reset, hint); sync(); app.onBar('view', sync);
  }
  private angle(e: ToolEvent) { const vp = app.viewport; return Math.atan2(e.sy - vp.height / 2, e.sx - vp.width / 2); }
  down(e: ToolEvent) { this.start = { a: this.angle(e), rot: app.doc!.view.rot ?? 0 }; this.cursor = 'grabbing'; }
  move(e: ToolEvent) {
    if (!this.start) return;
    let r = this.start.rot + this.angle(e) - this.start.a;
    if (e.shift) r = Math.round(r / (Math.PI / 12)) * Math.PI / 12;
    app.viewport.setRotation(r);
  }
  up() { this.start = null; this.cursor = 'grab'; }
  key_(e: KeyboardEvent) { if (e.key === 'Escape') { app.viewport.setRotation(0); return true; } return false; }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (!this.start) return;
    // brújula: la flecha roja señala el "arriba" de la imagen
    const r = vp.rot, cx = vp.width / 2, cy = vp.height / 2;
    ctx.save(); ctx.translate(cx, cy);
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.arc(0, 0, 46, 0, 7); ctx.fill();
    ctx.rotate(r); ctx.fillStyle = '#ff3b30'; ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(8, 0); ctx.lineTo(-8, 0); ctx.fill();
    ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.moveTo(0, 40); ctx.lineTo(8, 0); ctx.lineTo(-8, 0); ctx.fill();
    ctx.restore();
  }
}
