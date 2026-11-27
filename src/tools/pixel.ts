// Pincel de píxeles: pinta píxeles exactos, sin suavizado, para pixel art.
// · «Píxel perfecto»: en las líneas de 1 píxel quita los escalones dobles (las «L») que dejan las diagonales a mano.
// · Formas: línea, rectángulo y elipse (con o sin relleno), con vista previa mientras se arrastra.
// · Tramado: solo pinta un píxel sí y otro no (efecto de sombreado clásico).
// · Simetría (la misma del pincel), Mayús + clic para una línea recta desde el último punto, Alt + clic para tomar un color.
import { app } from '../ui/app';
import type { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import { Stroke, getPaintTarget, strokeSetup } from './paint';
import { ctx2d, rgbToHex } from '../core/canvas';
import { SYM, symPoints, drawSymAxes } from './brush';
import type { Viewport } from '../ui/viewport';
import { currentPalette } from '../ui/pixelart';

type P = { x: number; y: number };
/** Píxeles de la recta entre dos puntos (Bresenham). */
export function linePixels(a: P, b: P): P[] {
  const out: P[] = []; let x = a.x, y = a.y; const dx = Math.abs(b.x - x), dy = -Math.abs(b.y - y), sx = x < b.x ? 1 : -1, sy = y < b.y ? 1 : -1; let err = dx + dy;
  for (;;) { out.push({ x, y }); if (x === b.x && y === b.y) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x += sx; } if (e2 <= dx) { err += dx; y += sy; } }
  return out;
}
/** Píxeles del borde (o de todo el interior) de una elipse inscrita en el rectángulo a-b. */
export function ellipsePixels(a: P, b: P, fill: boolean): P[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 + 0.5, ry = (y1 - y0) / 2 + 0.5, inside = (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const out: P[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!inside(x, y)) continue;
    // borde: algún vecino (de los 4) queda fuera
    if (fill || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) out.push({ x, y });
  }
  return out;
}
export function rectPixels(a: P, b: P, fill: boolean): P[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y), out: P[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (fill || x === x0 || x === x1 || y === y0 || y === y1) out.push({ x, y });
  return out;
}

export class PixelTool implements Tool {
  id = 'pixel'; name = 'Pincel de píxeles'; icon = icon('pixel'); key = 'B'; group = 'brush'; cursor = 'crosshair';
  options = [
    { key: 'size', label: 'Tamaño', type: 'range', min: 1, max: 32, default: 1, unit: 'px' },
    { key: 'shape', label: 'Forma', type: 'select', default: 'free', choices: [
      { value: 'free', label: 'A mano' }, { value: 'line', label: 'Línea' }, { value: 'rect', label: 'Rectángulo' }, { value: 'rectFill', label: 'Rectángulo relleno' },
      { value: 'ellipse', label: 'Elipse' }, { value: 'ellipseFill', label: 'Elipse rellena' }] },
    { key: 'mode', label: 'Modo', type: 'select', default: 'draw', choices: [{ value: 'draw', label: 'Pintar' }, { value: 'erase', label: 'Borrar' }, { value: 'dither', label: 'Tramado (un píxel sí y otro no)' }, { value: 'dither25', label: 'Tramado suave (1 de cada 4)' }, { value: 'dither75', label: 'Tramado fuerte (3 de cada 4)' }, { value: 'shade', label: 'Sombrear (oscurece con la paleta)' }, { value: 'light', label: 'Iluminar (aclara con la paleta)' }] },
    { key: 'perfect', label: 'Píxel perfecto', type: 'checkbox', default: true },
    SYM,
  ] as any[];
  private stroke: Stroke | null = null;
  private color = '#000000';
  /** Píxeles del trazo a mano (en el orden en que se pintaron) y cuántas veces se ha pintado cada píxel del búfer. */
  private path: P[] = [];
  private count = new Map<number, number>();
  private start: P | null = null;
  private lastEnd: P | null = null;
  private shapeBounds: { x: number; y: number; w: number; h: number } | null = null;
  private hoverPx: P | null = null;
  private ramp: string[] | null = null;
  private dir = -1;
  private under: Uint8ClampedArray | null = null;
  /** Color sombreado para el píxel k (null si está vacío: el sombreado no pinta donde no hay nada). */
  private shadeColor(k: number): string | null {
    const u = this.under!, i = k * 4; if (!u[i + 3]) return null;
    const ramp = this.ramp!; let best = 0, bd = 1e9;
    for (let j = 0; j < ramp.length; j++) { const n = parseInt(ramp[j].slice(1), 16), dd = ((n >> 16) - u[i]) ** 2 + ((n >> 8 & 255) - u[i + 1]) ** 2 + ((n & 255) - u[i + 2]) ** 2; if (dd < bd) { bd = dd; best = j; } }
    return ramp[Math.max(0, Math.min(ramp.length - 1, best + this.dir))];
  }

  private opt<T>(k: string) { return app.opt<T>(k, this.id); }
  private size() { return Math.max(1, Math.round(this.opt<number>('size') ?? 1)); }
  private px(e: { x: number; y: number }): P { return { x: Math.floor(e.x), y: Math.floor(e.y) }; }

  /** Pinta (o despinta) un píxel del trazo con su tamaño y sus copias simétricas. */
  private plot(p: P, add: boolean) {
    const st = this.stroke; if (!st) return;
    const s = this.size(), off = Math.floor((s - 1) / 2), ctx = ctx2d(st.buffer), W = st.buffer.width, H = st.buffer.height;
    const mode = this.opt<string>('mode'), sym = this.opt<string>('symmetry') || 'none';
    const skip = (x: number, y: number) => mode === 'dither' ? (x + y) % 2 !== 0 : mode === 'dither25' ? !(x % 2 === 0 && y % 2 === 0) : mode === 'dither75' ? (x % 2 === 1 && y % 2 === 1) : false;
    const pts = sym === 'none' ? [p] : symPoints(sym, p.x + 0.5, p.y + 0.5).map(q => ({ x: Math.floor(q.x), y: Math.floor(q.y) }));
    ctx.fillStyle = this.color;
    for (const q of pts) {
      const x0 = q.x - off, y0 = q.y - off;
      for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (skip(x, y)) continue;
        const k = y * W + x, n = this.count.get(k) ?? 0;
        if (add) {
          if (n === 0) {
            if (this.ramp) { const c = this.shadeColor(k); if (!c) { this.count.set(k, n + 1); continue; } ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); ctx.fillStyle = this.color; }
            else ctx.fillRect(x, y, 1, 1);
          }
          this.count.set(k, n + 1);
        }
        else if (n > 0) { if (n === 1) { ctx.clearRect(x, y, 1, 1); this.count.delete(k); } else this.count.set(k, n - 1); }
      }
      (st as any).addDirty({ x: x0, y: y0, w: s, h: s });
    }
  }
  /** Añade un píxel al trazo a mano, quitando la «L» si el píxel perfecto está activo. */
  private addFree(p: P) {
    const path = this.path, last = path[path.length - 1];
    if (last && last.x === p.x && last.y === p.y) return;
    path.push(p); this.plot(p, true);
    if (this.size() === 1 && this.opt('perfect') !== false && path.length >= 3) {
      const a = path[path.length - 3], b = path[path.length - 2], c = p;
      // b está en la esquina de una «L»: a y c se tocan en diagonal y b toca a ambos de lado
      if (Math.abs(a.x - c.x) === 1 && Math.abs(a.y - c.y) === 1 && (b.x === a.x || b.y === a.y) && (b.x === c.x || b.y === c.y)) {
        this.plot(b, false); path.splice(path.length - 2, 1);
      }
    }
  }
  private drawShape(to: P, shift: boolean) {
    const st = this.stroke, a = this.start; if (!st || !a) return;
    // se borra la forma anterior y se dibuja la nueva
    const ctx = ctx2d(st.buffer);
    if (this.shapeBounds) { const b = this.shapeBounds; ctx.clearRect(b.x, b.y, b.w, b.h); (st as any).addDirty(b); }
    this.count.clear();
    let b = to; const shape = this.opt<string>('shape');
    if (shift && shape !== 'line') { const d = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)); b = { x: a.x + Math.sign(b.x - a.x || 1) * d, y: a.y + Math.sign(b.y - a.y || 1) * d }; } // Mayús: cuadrado o círculo
    const pts = shape === 'line' ? linePixels(a, b) : shape === 'rect' || shape === 'rectFill' ? rectPixels(a, b, shape === 'rectFill') : ellipsePixels(a, b, shape === 'ellipseFill');
    for (const p of pts) this.plot(p, true);
    // zona que ocupa la forma (con sus copias simétricas, por si hay que borrarla en el siguiente movimiento)
    const W = st.buffer.width, H = st.buffer.height, sym = this.opt<string>('symmetry') || 'none', pad = this.size();
    if (sym === 'none') { const x0 = Math.min(a.x, b.x) - pad, y0 = Math.min(a.y, b.y) - pad; this.shapeBounds = { x: x0, y: y0, w: Math.abs(b.x - a.x) + 2 * pad + 1, h: Math.abs(b.y - a.y) + 2 * pad + 1 }; }
    else this.shapeBounds = { x: 0, y: 0, w: W, h: H };
    st.update();
  }

  down(e: ToolEvent) {
    const doc = app.doc; if (!doc) return;
    const p = this.px(e);
    if (e.alt) { // tomar el color de la imagen
      const flat = doc.flatten(); if (p.x < 0 || p.y < 0 || p.x >= flat.width || p.y >= flat.height) return;
      const d = ctx2d(flat).getImageData(p.x, p.y, 1, 1).data;
      if (d[3] > 0) app.setColors(rgbToHex(d[0], d[1], d[2]));
      return;
    }
    const t = getPaintTarget(); if (!t) return;
    const erase = this.opt<string>('mode') === 'erase', s = strokeSetup(t, erase);
    this.color = s.color;
    this.stroke = new Stroke(t, s.mode, 1, s.maskValue);
    this.ramp = null; this.under = null;
    const md = this.opt<string>('mode');
    if ((md === 'shade' || md === 'light') && !t.isMask) {
      // sombrear: cada píxel pasa al color siguiente (más oscuro o más claro) de la paleta, ordenada por brillo
      const lum = (c: string) => { const n = parseInt(c.slice(1), 16); return (n >> 16) * 0.299 + (n >> 8 & 255) * 0.587 + (n & 255) * 0.114; };
      const ramp = [...currentPalette().colors].sort((a, b) => lum(a) - lum(b));
      if (ramp.length >= 2) { this.ramp = ramp; this.dir = md === 'shade' ? -1 : 1; this.under = ctx2d(t.canvas).getImageData(0, 0, t.canvas.width, t.canvas.height).data; }
    }
    this.path = []; this.count.clear(); this.shapeBounds = null;
    const shape = this.opt<string>('shape') || 'free';
    if (shape !== 'free') { this.start = p; this.drawShape(p, e.shift); return; }
    this.start = null;
    if (e.shift && this.lastEnd) { for (const q of linePixels(this.lastEnd, p)) this.addFree(q); }
    else this.addFree(p);
    this.stroke.update();
  }
  move(e: ToolEvent) {
    this.hoverPx = this.px(e);
    const st = this.stroke; if (!st) return;
    const p = this.px(e);
    if (this.start) { this.drawShape(p, e.shift); return; }
    const last = this.path[this.path.length - 1] ?? p;
    for (const q of linePixels(last, p).slice(1)) this.addFree(q);
    st.update();
  }
  up(e?: ToolEvent) {
    const st = this.stroke; if (!st) return;
    if (e && this.start) this.drawShape(this.px(e), e.shift);
    this.lastEnd = this.start ? null : this.path[this.path.length - 1] ?? null;
    this.stroke = null; this.start = null; this.shapeBounds = null; this.count.clear();
    const changed = st.finish();
    if (changed) { app.doc!.commit(this.name, st.bounds ?? undefined); if (this.opt<string>('mode') !== 'erase') import('../ui/artist').then(m => m.addRecentColor(app.fg)); }
  }
  cancel() { this.stroke?.cancel(); this.stroke = null; this.start = null; this.count.clear(); }
  hover(e: ToolEvent) { this.hoverPx = this.px(e); app.viewport.requestRender(); }
  docChanged() { this.lastEnd = null; }
  /** Recuadro del píxel (o píxeles) que se va a pintar, siempre visible aunque el lápiz tape el punto. */
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    drawSymAxes(ctx, vp, this.opt<string>('symmetry'));
    const p = this.hoverPx; if (!p || !app.doc) return;
    const s = this.size(), off = Math.floor((s - 1) / 2), a = vp.toScreen(p.x - off, p.y - off), b = vp.toScreen(p.x - off + s, p.y - off + s);
    ctx.save(); ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeRect(Math.round(a.x) - 0.5, Math.round(a.y) - 0.5, Math.round(b.x - a.x) + 1, Math.round(b.y - a.y) + 1);
    ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(b.x - a.x) - 1, Math.round(b.y - a.y) - 1);
    ctx.restore();
  }
}
