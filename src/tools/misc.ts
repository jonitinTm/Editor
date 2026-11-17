// Bote de pintura, degradado, cuentagotas, mano y zoom.

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import type { Viewport } from '../ui/viewport';
import { getPaintTarget, setPreview, setTargetCanvas, strokeSetup, PaintTarget, clipMask } from './paint';
import { floodMask } from './floodfill';
import { cloneCanvas, ctx2d, getPixels, makeCanvas, rgbToHex, hexToRgb } from '../core/canvas';
import { gradientEditor, GradStop } from '../ui/gradienteditor';

/** Dibuja `src` sobre el objetivo respetando selección, opacidad y modo (capa/máscara). */
export function applyOnTarget(t: PaintTarget, base: HTMLCanvasElement, src: HTMLCanvasElement, opacity: number, maskValue: number): HTMLCanvasElement {
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
  ] as any[];
  down(e: ToolEvent) {
    const t = getPaintTarget();
    if (!t) return;
    const doc = app.doc!;
    const src = app.opt('all', this.id) && !t.isMask ? doc.flatten() : t.canvas;
    const res = floodMask(getPixels(src), e.x, e.y, app.opt('tolerance', this.id), app.opt('contiguous', this.id));
    if (!res) return;
    const st = strokeSetup(t, false);
    const fill = res.canvas; const fc = ctx2d(fill);
    fc.globalCompositeOperation = 'source-in'; fc.fillStyle = st.color; fc.fillRect(0, 0, fill.width, fill.height);
    setTargetCanvas(t, applyOnTarget(t, t.canvas, fill, app.opt<number>('opacity', this.id) / 100, st.maskValue));
    doc.commit('Bote de pintura');
  }
}

export class GradientTool implements Tool {
  id = 'gradient'; name = 'Degradado'; icon = icon('gradient'); key = 'G'; group = 'fill'; cursor = 'crosshair';
  options = [
    { key: 'type', label: 'Tipo', type: 'select', default: 'linear', choices: [
      { value: 'linear', label: 'Lineal' }, { value: 'radial', label: 'Radial' }, { value: 'angle', label: 'Angular' },
      { value: 'reflected', label: 'Reflejado' }, { value: 'diamond', label: 'Diamante' }] },
    { key: 'colors', label: 'Colores', type: 'select', default: 'fgbg', choices: [
      { value: 'fgbg', label: 'Frontal → Fondo' }, { value: 'fgtrans', label: 'Frontal → Transparente' }, { value: 'custom', label: 'Personalizado' }] },
    { key: 'opacity', label: 'Opacidad', type: 'range', min: 1, max: 100, default: 100, unit: '%' },
    { key: 'reverse', label: 'Invertir', type: 'checkbox', default: false },
  ] as any[];
  extraOptions(bar: HTMLElement) {
    const prev = document.createElement('canvas'); prev.width = 120; prev.height = 18; prev.className = 'grad-prev';
    const paint = () => { const c = prev.getContext('2d')!; c.clearRect(0, 0, 120, 18); const g = c.createLinearGradient(0, 0, 120, 0); for (const st of this.stops(false)) g.addColorStop(st.t, `rgba(${hexToRgb(st.color).join(',')},${st.a})`); c.fillStyle = g; c.fillRect(0, 0, 120, 18); };
    paint(); app.on('colors', paint); app.on('options', paint);
    prev.title = 'Editar degradado'; prev.onclick = () => gradientEditor(this.stops(false), st => { app.setOpt(this.id, 'stops', st); app.setOpt(this.id, 'colors', 'custom'); });
    const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Editar…'; b.onclick = () => prev.click();
    bar.append(prev, b);
  }
  /** Paradas del degradado actual (posición 0-1, color, opacidad 0-1). */
  stops(forMask: boolean): GradStop[] {
    const mode = app.opt('colors', this.id);
    let st: GradStop[] = mode === 'custom' && Array.isArray(app.opt('stops', this.id)) ? app.opt<GradStop[]>('stops', this.id).map(x => ({ ...x }))
      : mode === 'fgtrans' ? [{ t: 0, color: app.fg, a: 1 }, { t: 1, color: app.fg, a: 0 }] : [{ t: 0, color: app.fg, a: 1 }, { t: 1, color: app.bg, a: 1 }];
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
  private render() {
    const t = this.t!, a = this.a!, b = this.b!;
    const doc = app.doc!;
    const g = makeCanvas(doc.width, doc.height), ctx = ctx2d(g);
    const stops = this.stops(t.isMask);
    const rgba = (st: GradStop) => `rgba(${hexToRgb(st.color).join(',')},${st.a})`;
    const type = app.opt('type', this.id);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (type === 'diamond' || (type === 'angle' && !(ctx as any).createConicGradient)) {
      // Se calcula píxel a píxel con una tabla de 256 colores
      const lut = makeCanvas(256, 1), lc = ctx2d(lut), lg = lc.createLinearGradient(0, 0, 256, 0);
      for (const st of stops) lg.addColorStop(st.t, rgba(st)); lc.fillStyle = lg; lc.fillRect(0, 0, 256, 1);
      const L = lc.getImageData(0, 0, 256, 1).data, img = ctx.createImageData(doc.width, doc.height), o = img.data;
      const cs = Math.cos(-ang), sn = Math.sin(-ang);
      for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
        const dx = x - a.x, dy = y - a.y;
        let tt = type === 'diamond' ? (Math.abs(dx * cs - dy * sn) + Math.abs(dx * sn + dy * cs)) / len : (((Math.atan2(dy, dx) - ang) / (Math.PI * 2)) % 1 + 1) % 1;
        const k = Math.min(255, Math.max(0, Math.round(tt * 255))) * 4, i = (y * doc.width + x) * 4;
        o[i] = L[k]; o[i + 1] = L[k + 1]; o[i + 2] = L[k + 2]; o[i + 3] = L[k + 3];
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
      ctx.fillStyle = grad; ctx.fillRect(0, 0, doc.width, doc.height);
    }
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
    return applyOnTarget(t, this.base!, g, op, 1);
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
    this.preview = this.render();
    setPreview(this.t!, this.preview);
    app.doc!.invalidate();
  }
  up() {
    if (!this.a || !this.t) return;
    const t = this.t;
    setPreview(t, null);
    const moved = this.b && Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y) > 1;
    if (moved && this.preview) { setTargetCanvas(t, this.preview); app.doc!.commit('Degradado'); }
    this.a = this.b = null; this.t = null; this.preview = null; this.base = null;
    app.doc!.invalidate();
  }
  cancel() { if (this.t) setPreview(this.t, null); this.a = this.b = null; this.t = null; app.doc?.invalidate(); }
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
  id = 'eyedropper'; name = 'Cuentagotas'; icon = icon('eyedropper'); key = 'I'; cursor = 'crosshair';
  options = [
    { key: 'sampleSize', label: 'Muestra', type: 'select', default: '1', choices: [
      { value: '1', label: 'Punto' }, { value: '3', label: 'Media 3×3' }, { value: '5', label: 'Media 5×5' }, { value: '11', label: 'Media 11×11' }] },
    { key: 'source', label: 'De', type: 'select', default: 'all', choices: [
      { value: 'all', label: 'Todas las capas' }, { value: 'layer', label: 'Capa actual' }] },
  ] as any[];
  private alt = false;
  private pick(e: ToolEvent) {
    const doc = app.doc!;
    const l = doc.activeRaster();
    const src = app.opt('source', this.id) === 'layer' && l ? l.canvas : doc.getComposite();
    const n = parseInt(app.opt('sampleSize', this.id)) || 1;
    const x0 = Math.floor(e.x) - (n >> 1), y0 = Math.floor(e.y) - (n >> 1);
    if (Math.floor(e.x) < 0 || Math.floor(e.y) < 0 || e.x >= doc.width || e.y >= doc.height) return;
    const d = ctx2d(src).getImageData(Math.max(0, x0), Math.max(0, y0), n, n).data;
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < d.length; i += 4) { const al = d[i + 3]; r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al; }
    if (a === 0) return;
    const hex = rgbToHex(r / a, g / a, b / a);
    if (this.alt) app.setColors(app.fg, hex); else app.setColors(hex, app.bg);
  }
  down(e: ToolEvent) { this.alt = e.alt; this.pick(e); }
  move(e: ToolEvent) { this.pick(e); }
}

export class HandTool implements Tool {
  id = 'hand'; name = 'Mano'; icon = icon('hand'); key = 'H'; cursor = 'grab';
  extraOptions(bar: HTMLElement) {
    const b = (label: string, fn: () => void) => { const el = document.createElement('button'); el.className = 'btn'; el.textContent = label; el.onclick = fn; bar.append(el); };
    b('100 %', () => app.viewport.setZoom(1, null));
    b('Ajustar a pantalla', () => app.viewport.fit());
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
