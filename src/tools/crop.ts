// Herramienta Recortar: ajusta un marco y pulsa Intro (o ✓) para recortar.

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import type { Viewport } from '../ui/viewport';
import { h } from '../ui/dom';
import { Rect } from '../core/canvas';
import { snapPoint, clearSnap } from './snap';
import { homography } from './transform';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | 'new';

export function handlePoints(r: Rect): [Handle, number, number][] {
  return [
    ['nw', r.x, r.y], ['n', r.x + r.w / 2, r.y], ['ne', r.x + r.w, r.y], ['e', r.x + r.w, r.y + r.h / 2],
    ['se', r.x + r.w, r.y + r.h], ['s', r.x + r.w / 2, r.y + r.h], ['sw', r.x, r.y + r.h], ['w', r.x, r.y + r.h / 2],
  ];
}
const CURSORS: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move', new: 'crosshair' };

export class CropTool implements Tool {
  id = 'crop'; name = 'Recortar'; icon = icon('crop'); key = 'C'; group = 'crop'; cursor = 'crosshair';
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
    const q = [vp.toScreen(r.x, r.y), vp.toScreen(r.x + r.w, r.y), vp.toScreen(r.x + r.w, r.y + r.h), vp.toScreen(r.x, r.y + r.h)];
    const poly = () => { q.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); };
    const a = q[0];
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath(); ctx.rect(0, 0, vp.width, vp.height); poly(); ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.beginPath();
    for (const k of [1 / 3, 2 / 3]) {
      const t1 = vp.toScreen(r.x + r.w * k, r.y), t2 = vp.toScreen(r.x + r.w * k, r.y + r.h), l1 = vp.toScreen(r.x, r.y + r.h * k), l2 = vp.toScreen(r.x + r.w, r.y + r.h * k);
      ctx.moveTo(t1.x, t1.y); ctx.lineTo(t2.x, t2.y); ctx.moveTo(l1.x, l1.y); ctx.lineTo(l2.x, l2.y);
    }
    ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); poly(); ctx.stroke();
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

/** Recorte con perspectiva: arrastra un marco, mueve cada esquina sobre los bordes del objeto inclinado e Intro. */
export class PerspectiveCropTool implements Tool {
  id = 'perspCrop'; name = 'Recorte con perspectiva'; icon = icon('perspCrop'); key = 'C'; group = 'crop'; cursor = 'crosshair';
  options = [
    { key: 'pw', label: 'Anchura', type: 'number', min: 0, max: 30000, default: 0, unit: 'px', title: '0 = automática' },
    { key: 'ph', label: 'Altura', type: 'number', min: 0, max: 30000, default: 0, unit: 'px', title: '0 = automática' },
    { key: 'grid', label: 'Mostrar cuadrícula', type: 'checkbox', default: true },
  ] as any[];
  quad: { x: number; y: number }[] | null = null;
  private drag: { k: number; start: { x: number; y: number }; orig: { x: number; y: number }[] } | null = null;
  activate() { this.quad = null; }
  docChanged() { this.quad = null; app.viewport?.requestRender(); }
  extraOptions(bar: HTMLElement) {
    bar.append(
      h('span', { class: 'hint' }, 'Arrastra un marco y coloca cada esquina sobre el objeto inclinado. Intro aplica.'),
      h('button', { class: 'btn icon-btn ok', title: 'Aplicar (Intro)', html: icon('check'), onclick: () => this.apply() }),
      h('button', { class: 'btn icon-btn', title: 'Cancelar (Esc)', html: icon('close'), onclick: () => { this.quad = null; app.viewport.requestRender(); } }),
    );
  }
  private hit(e: ToolEvent): number {
    const q = this.quad; if (!q) return -1;
    for (let i = 0; i < 4; i++) { const s = app.viewport.toScreen(q[i].x, q[i].y); if (Math.abs(s.x - e.sx) < 9 && Math.abs(s.y - e.sy) < 9) return i; }
    // punto dentro del cuadrilátero (convexo o no): regla del número de cruces
    let inside = false;
    for (let i = 0, j = 3; i < 4; j = i++) { const a = q[i], b = q[j]; if ((a.y > e.y) !== (b.y > e.y) && e.x < (b.x - a.x) * (e.y - a.y) / (b.y - a.y) + a.x) inside = !inside; }
    return inside ? 4 : -1;
  }
  hover(e: ToolEvent) { const k = this.hit(e); this.cursor = k === 4 ? 'move' : k >= 0 ? 'pointer' : 'crosshair'; }
  down(e: ToolEvent) {
    if (e.detail >= 2 && this.hit(e) === 4) { this.apply(); return; }
    let k = this.hit(e);
    if (k < 0) { this.quad = [0, 1, 2, 3].map(() => ({ x: e.x, y: e.y })); k = 5; }
    this.drag = { k, start: { x: e.x, y: e.y }, orig: this.quad!.map(p => ({ ...p })) };
  }
  move(e: ToolEvent) {
    const g = this.drag; if (!g || !this.quad) return;
    const dx = e.x - g.start.x, dy = e.y - g.start.y;
    if (g.k === 5) { const x0 = Math.min(g.start.x, e.x), x1 = Math.max(g.start.x, e.x), y0 = Math.min(g.start.y, e.y), y1 = Math.max(g.start.y, e.y); this.quad = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]; }
    else if (g.k === 4) this.quad = g.orig.map(p => ({ x: p.x + dx, y: p.y + dy }));
    else this.quad[g.k] = { x: g.orig[g.k].x + dx, y: g.orig[g.k].y + dy };
  }
  up() {
    this.drag = null;
    const q = this.quad; if (q && Math.hypot(q[2].x - q[0].x, q[2].y - q[0].y) < 3) this.quad = null;
  }
  /** Tamaño del resultado: la media de los lados opuestos (o lo que se pida). */
  outSize() {
    const q = this.quad!, L = (a: number, b: number) => Math.hypot(q[a].x - q[b].x, q[a].y - q[b].y);
    const w = app.opt<number>('pw', this.id) || (L(0, 1) + L(3, 2)) / 2, hh = app.opt<number>('ph', this.id) || (L(0, 3) + L(1, 2)) / 2;
    return { w: Math.round(w), h: Math.round(hh) };
  }
  async apply() {
    const q = this.quad; if (!q || !app.doc) return;
    const { w, h: hh } = this.outSize(); if (w < 2 || hh < 2) return;
    const { perspectiveCrop } = await import('../ui/ops');
    this.quad = null; await perspectiveCrop(q, w, hh);
  }
  key_(e: KeyboardEvent) {
    if (e.key === 'Enter' && this.quad) { this.apply(); return true; }
    if (e.key === 'Escape' && this.quad) { this.quad = null; app.viewport.requestRender(); return true; }
    return false;
  }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const q = this.quad; if (!q) return;
    const s = q.map(p => vp.toScreen(p.x, p.y));
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.rect(0, 0, vp.width, vp.height);
    s.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fill('evenodd');
    if (app.opt('grid', this.id)) {
      // cuadrícula en perspectiva (ayuda a alinear con las líneas del objeto)
      const P = homography(s);
      ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let k = 1; k < 8; k++) { const t = k / 8; let a = P(t, 0), b = P(t, 1); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); a = P(0, t); b = P(1, t); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke();
    }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); s.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
    for (const p of s) { ctx.fillStyle = '#fff'; ctx.fillRect(p.x - 5, p.y - 5, 10, 10); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(p.x - 5, p.y - 5, 10, 10); }
    const { w, h: hh } = this.outSize(), m = s.reduce((a, p) => ({ x: Math.max(a.x, p.x), y: Math.max(a.y, p.y) }), { x: -1e9, y: -1e9 });
    ctx.font = '12px system-ui'; ctx.fillStyle = 'rgba(0,0,0,.7)'; const txt = `${w} × ${hh} px`; ctx.fillRect(m.x + 8, m.y + 6, ctx.measureText(txt).width + 10, 20); ctx.fillStyle = '#fff'; ctx.fillText(txt, m.x + 13, m.y + 20);
    ctx.restore();
  }
}

/** Sector: divide el diseño en zonas que se exportan cada una en su archivo (Archivo › Exportar sectores). */
export class SliceTool implements Tool {
  id = 'slice'; name = 'Sector'; icon = icon('slice'); key = 'C'; group = 'crop'; cursor = 'crosshair';
  sel = -1;
  private drag: { mode: 'new' | 'move' | Handle; start: { x: number; y: number }; orig: Rect } | null = null;
  extraOptions(bar: HTMLElement) {
    bar.append(
      h('span', { class: 'hint' }, 'Arrastra para crear un sector · clic para elegirlo · Supr lo borra · doble clic para cambiar el nombre.'),
      h('button', { class: 'btn', onclick: () => this.fromGuides() }, 'Sectores desde guías'),
      h('button', { class: 'btn', onclick: () => { const d = app.doc; if (d) { d.slices = []; this.sel = -1; d.changed(); app.viewport.requestRender(); } } }, 'Borrar todos'),
      h('button', { class: 'btn primary', onclick: async () => { const { exportSlicesDialog } = await import('../ui/dialogs'); exportSlicesDialog(); } }, 'Exportar…'),
    );
  }
  private fromGuides() {
    const d = app.doc; if (!d) return;
    const xs = [0, ...d.guides.v.filter(v => v > 0 && v < d.width), d.width].sort((a, b) => a - b), ys = [0, ...d.guides.h.filter(v => v > 0 && v < d.height), d.height].sort((a, b) => a - b);
    if (xs.length < 3 && ys.length < 3) { app.toast('Primero pon guías (Vista › Nueva disposición de guías)', 'warn'); return; }
    d.slices = [];
    for (let j = 0; j < ys.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) if (xs[i + 1] - xs[i] >= 1 && ys[j + 1] - ys[j] >= 1)
      d.slices.push({ x: Math.round(xs[i]), y: Math.round(ys[j]), w: Math.round(xs[i + 1] - xs[i]), h: Math.round(ys[j + 1] - ys[j]), name: `${d.name}_${String(d.slices.length + 1).padStart(2, '0')}` });
    d.changed(); app.viewport.requestRender(); app.toast(`${d.slices.length} sectores`);
  }
  private hitSlice(e: ToolEvent) { const L = app.doc!.slices; for (let i = L.length - 1; i >= 0; i--) { const s = L[i]; if (e.x >= s.x && e.x < s.x + s.w && e.y >= s.y && e.y < s.y + s.h) return i; } return -1; }
  private hitHandle(e: ToolEvent): Handle | null {
    const s = app.doc!.slices[this.sel]; if (!s) return null;
    for (const [n, x, y] of handlePoints(s)) { const p = app.viewport.toScreen(x, y); if (Math.abs(p.x - e.sx) < 7 && Math.abs(p.y - e.sy) < 7) return n; }
    return null;
  }
  hover(e: ToolEvent) { const hnd = this.hitHandle(e); this.cursor = hnd ? CURSORS[hnd] : this.hitSlice(e) >= 0 ? 'move' : 'crosshair'; }
  down(e: ToolEvent) {
    const d = app.doc!;
    const hnd = this.hitHandle(e);
    if (hnd) { this.drag = { mode: hnd, start: { x: e.x, y: e.y }, orig: { ...d.slices[this.sel] } }; return; }
    const k = this.hitSlice(e);
    if (k >= 0) {
      this.sel = k;
      if (e.detail >= 2) { import('../ui/dialog').then(async m => { const n = await m.promptDialog('Nombre del sector', 'Nombre del archivo', d.slices[k].name); if (n) { d.slices[k].name = n.trim(); d.changed(); app.viewport.requestRender(); } }); return; }
      this.drag = { mode: 'move', start: { x: e.x, y: e.y }, orig: { ...d.slices[k] } }; app.viewport.requestRender(); return;
    }
    d.slices.push({ x: Math.round(e.x), y: Math.round(e.y), w: 0, h: 0, name: `${d.name}_${String(d.slices.length + 1).padStart(2, '0')}` });
    this.sel = d.slices.length - 1;
    this.drag = { mode: 'new', start: { x: e.x, y: e.y }, orig: { x: Math.round(e.x), y: Math.round(e.y), w: 0, h: 0 } };
  }
  move(e: ToolEvent) {
    const g = this.drag, d = app.doc!, s = d.slices[this.sel]; if (!g || !s) return;
    const sp = snapPoint(e.x, e.y, true), dx = Math.round(sp.x - g.start.x), dy = Math.round(sp.y - g.start.y);
    let { x, y, w, h: hh } = g.orig;
    if (g.mode === 'new') { x = Math.round(g.start.x); y = Math.round(g.start.y); w = Math.round(sp.x) - x; hh = Math.round(sp.y) - y; }
    else if (g.mode === 'move') { x += dx; y += dy; }
    else { if (g.mode.includes('w')) { x += dx; w -= dx; } if (g.mode.includes('e')) w += dx; if (g.mode.includes('n')) { y += dy; hh -= dy; } if (g.mode.includes('s')) hh += dy; }
    if (w < 0) { x += w; w = -w; } if (hh < 0) { y += hh; hh = -hh; }
    // dentro del documento
    const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(d.width, x + w), y1 = Math.min(d.height, y + hh);
    Object.assign(s, { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) });
  }
  up() {
    clearSnap(); const d = app.doc!, s = d.slices[this.sel];
    if (this.drag?.mode === 'new' && s && (s.w < 2 || s.h < 2)) { d.slices.splice(this.sel, 1); this.sel = -1; }
    if (this.drag) d.changed();
    this.drag = null;
  }
  key_(e: KeyboardEvent) {
    const d = app.doc; if (!d) return false;
    if ((e.key === 'Delete' || e.key === 'Backspace') && d.slices[this.sel]) { d.slices.splice(this.sel, 1); this.sel = -1; d.changed(); app.viewport.requestRender(); return true; }
    return false;
  }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const d = app.doc; if (!d) return;
    ctx.save(); ctx.font = '11px system-ui';
    d.slices.forEach((s, i) => {
      const a = vp.toScreen(s.x, s.y), b = vp.toScreen(s.x + s.w, s.y + s.h), on = i === this.sel;
      ctx.fillStyle = on ? 'rgba(61,139,253,.12)' : 'rgba(0,0,0,.05)'; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.strokeStyle = on ? '#3d8bfd' : '#58a6ff'; ctx.lineWidth = on ? 2 : 1; ctx.strokeRect(a.x + .5, a.y + .5, b.x - a.x - 1, b.y - a.y - 1);
      const label = `${String(i + 1).padStart(2, '0')} ${s.name}`, tw = ctx.measureText(label).width + 8;
      ctx.fillStyle = on ? '#3d8bfd' : 'rgba(30,60,110,.85)'; ctx.fillRect(a.x + 1, a.y + 1, Math.min(tw, Math.max(20, b.x - a.x - 2)), 16);
      ctx.fillStyle = '#fff'; ctx.save(); ctx.beginPath(); ctx.rect(a.x + 1, a.y + 1, Math.max(20, b.x - a.x - 2), 16); ctx.clip(); ctx.fillText(label, a.x + 5, a.y + 13); ctx.restore();
      if (on) for (const [, x, y] of handlePoints(s)) { const p = vp.toScreen(x, y); ctx.fillStyle = '#fff'; ctx.fillRect(p.x - 4, p.y - 4, 8, 8); ctx.strokeStyle = '#3d8bfd'; ctx.lineWidth = 1; ctx.strokeRect(p.x - 4, p.y - 4, 8, 8); }
    });
    ctx.restore();
  }
}
