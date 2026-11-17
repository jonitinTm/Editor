// Herramienta Recortar: ajusta un marco y pulsa Intro (o ✓) para recortar.

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import type { Viewport } from '../ui/viewport';
import { h } from '../ui/dom';
import { Rect } from '../core/canvas';
import { snapPoint, clearSnap } from './snap';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | 'new';

export function handlePoints(r: Rect): [Handle, number, number][] {
  return [
    ['nw', r.x, r.y], ['n', r.x + r.w / 2, r.y], ['ne', r.x + r.w, r.y], ['e', r.x + r.w, r.y + r.h / 2],
    ['se', r.x + r.w, r.y + r.h], ['s', r.x + r.w / 2, r.y + r.h], ['sw', r.x, r.y + r.h], ['w', r.x, r.y + r.h / 2],
  ];
}
const CURSORS: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move', new: 'crosshair' };

export class CropTool implements Tool {
  id = 'crop'; name = 'Recortar'; icon = icon('crop'); key = 'C'; cursor = 'crosshair';
  rect: Rect | null = null;
  private drag: { h: Handle; start: { x: number; y: number }; orig: Rect } | null = null;

  activate() { this.reset(); }
  docChanged() { this.reset(); }
  private reset() { const d = app.doc; this.rect = d ? { x: 0, y: 0, w: d.width, h: d.height } : null; app.viewport?.requestRender(); }

  extraOptions(bar: HTMLElement) {
    bar.append(
      h('span', { class: 'hint' }, 'Arrastra los bordes del marco. Intro para aplicar, Esc para cancelar.'),
      h('button', { class: 'btn icon-btn ok', title: 'Aplicar recorte (Intro)', html: icon('check'), onclick: () => this.apply() }),
      h('button', { class: 'btn icon-btn', title: 'Cancelar (Esc)', html: icon('close'), onclick: () => this.reset() }),
    );
  }

  private hit(e: ToolEvent): Handle {
    const r = this.rect!;
    const vp = app.viewport;
    for (const [name, x, y] of handlePoints(r)) {
      const s = vp.toScreen(x, y);
      if (Math.abs(s.x - e.sx) < 8 && Math.abs(s.y - e.sy) < 8) return name;
    }
    if (e.x > r.x && e.x < r.x + r.w && e.y > r.y && e.y < r.y + r.h) return 'move';
    return 'new';
  }
  hover(e: ToolEvent) { if (this.rect) this.cursor = CURSORS[this.hit(e)]; }
  down(e: ToolEvent) {
    if (!this.rect) this.reset();
    const hnd = this.hit(e);
    this.drag = { h: hnd, start: { x: e.x, y: e.y }, orig: { ...this.rect! } };
    if (hnd === 'new') this.rect = { x: Math.round(e.x), y: Math.round(e.y), w: 0, h: 0 };
    if (e.detail >= 2 && hnd === 'move') this.apply();
  }
  move(e: ToolEvent) {
    if (!this.drag) return;
    const { h: hnd, start, orig } = this.drag;
    const sp = hnd === 'move' ? { x: e.x, y: e.y } : snapPoint(e.x, e.y, true);
    const dx = Math.round(sp.x - start.x), dy = Math.round(sp.y - start.y);
    let { x, y, w, h: hh } = orig;
    if (hnd === 'new') { x = Math.round(start.x); y = Math.round(start.y); w = dx; hh = dy; if (e.shift) { const s = Math.max(Math.abs(w), Math.abs(hh)); w = Math.sign(w || 1) * s; hh = Math.sign(hh || 1) * s; } }
    else if (hnd === 'move') { x += dx; y += dy; }
    else {
      if (hnd.includes('w')) { x += dx; w -= dx; }
      if (hnd.includes('e')) w += dx;
      if (hnd.includes('n')) { y += dy; hh -= dy; }
      if (hnd.includes('s')) hh += dy;
    }
    if (w < 0) { x += w; w = -w; } if (hh < 0) { y += hh; hh = -hh; }
    this.rect = { x, y, w, h: hh };
  }
  up() {
    clearSnap();
    this.drag = null;
    if (this.rect && (this.rect.w < 1 || this.rect.h < 1)) this.reset();
  }
  apply() {
    const doc = app.doc, r = this.rect;
    if (!doc || !r || r.w < 1 || r.h < 1) return;
    if (r.x === 0 && r.y === 0 && r.w === doc.width && r.h === doc.height) return;
    doc.resizeCanvas(Math.round(r.w), Math.round(r.h), -Math.round(r.x), -Math.round(r.y));
    doc.commit('Recortar');
    this.reset();
    app.viewport.fit(true);
  }
  key_(e: KeyboardEvent) {
    if (e.key === 'Enter') { this.apply(); return true; }
    if (e.key === 'Escape') { this.reset(); return true; }
    return false;
  }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const r = this.rect; if (!r || !app.doc) return;
    const a = vp.toScreen(r.x, r.y), b = vp.toScreen(r.x + r.w, r.y + r.h);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath(); ctx.rect(0, 0, vp.width, vp.height); ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.beginPath();
    for (const k of [1 / 3, 2 / 3]) {
      ctx.moveTo(a.x + (b.x - a.x) * k, a.y); ctx.lineTo(a.x + (b.x - a.x) * k, b.y);
      ctx.moveTo(a.x, a.y + (b.y - a.y) * k); ctx.lineTo(b.x, a.y + (b.y - a.y) * k);
    }
    ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    for (const [, x, y] of handlePoints(r)) {
      const s = vp.toScreen(x, y);
      ctx.fillStyle = '#fff'; ctx.fillRect(s.x - 4, s.y - 4, 8, 8);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(s.x - 4, s.y - 4, 8, 8);
    }
    ctx.fillStyle = '#fff'; ctx.font = '11px system-ui';
    ctx.fillText(`${Math.round(r.w)} × ${Math.round(r.h)} px`, a.x + 4, a.y - 6);
    ctx.restore();
  }
}
