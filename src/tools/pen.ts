// Pluma y selección directa: trazados vectoriales con curvas Bézier.
// La pluma crea una capa de forma de tipo "trazado"; la selección directa
// permite mover después sus puntos de ancla y sus tiradores.

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import type { Viewport } from '../ui/viewport';
import { PathPoint, ShapeLayer, tracePath } from '../core/layers';
import { h } from '../ui/dom';

function drawPathOverlay(ctx: CanvasRenderingContext2D, vp: Viewport, pts: PathPoint[], closed: boolean, active = -1) {
  const z = vp.zoom, v = vp.doc!.view;
  ctx.save();
  vp.docTransform(ctx); void v;
  ctx.beginPath(); tracePath(ctx, pts, closed);
  ctx.lineWidth = 1.5 / z; ctx.strokeStyle = '#3d8bfd'; ctx.stroke();
  ctx.restore();
  pts.forEach((p, i) => {
    const a = vp.toScreen(p.x, p.y);
    if (i === active || active === -2) for (const [hx, hy] of [[p.ix, p.iy], [p.ox, p.oy]]) {
      if (hx === p.x && hy === p.y) continue;
      const s = vp.toScreen(hx, hy);
      ctx.strokeStyle = '#3d8bfd'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(s.x, s.y); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x, s.y, 3.5, 0, 7); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = i === active ? '#3d8bfd' : '#fff'; ctx.strokeStyle = '#3d8bfd'; ctx.lineWidth = 1.5;
    ctx.fillRect(a.x - 4, a.y - 4, 8, 8); ctx.strokeRect(a.x - 4, a.y - 4, 8, 8);
  });
}

export class PenTool implements Tool {
  id = 'pen'; name = 'Pluma'; icon = icon('pen'); key = 'P'; group = 'pen'; cursor = 'crosshair';
  options = [
    { key: 'mode', label: 'Crear', type: 'select', default: 'shape', choices: [{ value: 'shape', label: 'Forma' }, { value: 'path', label: 'Trazado' }] },
    { key: 'fill', label: 'Relleno (color frontal)', type: 'checkbox', default: true },
    { key: 'stroke', label: 'Trazo', type: 'checkbox', default: false },
    { key: 'strokeColor', type: 'color', default: '#000000' },
    { key: 'strokeWidth', label: 'Grosor', type: 'range', min: 1, max: 200, default: 4, unit: 'px' },
  ] as any[];
  protected pts: PathPoint[] = [];
  protected dragging = false;
  /** Los siguientes subtrazados se añaden al trazado recién creado (hasta cambiar de herramienta). */
  private appendToActive = false;
  activate() { this.appendToActive = false; }

  extraOptions(bar: HTMLElement) {
    bar.append(h('span', { class: 'hint' }, 'Clic: punto recto · Arrastrar: curva · Clic en el primer punto: cerrar · Intro: terminar · Retroceso: quitar punto'));
  }
  down(e: ToolEvent) {
    if (this.pts.length >= 2) {
      const f = app.viewport.toScreen(this.pts[0].x, this.pts[0].y);
      if (Math.hypot(f.x - e.sx, f.y - e.sy) < 8) { this.finish(true); return; }
    }
    this.pts.push({ x: e.x, y: e.y, ix: e.x, iy: e.y, ox: e.x, oy: e.y });
    this.dragging = true;
  }
  move(e: ToolEvent) {
    if (!this.dragging) return;
    const p = this.pts[this.pts.length - 1];
    if (Math.hypot(e.x - p.x, e.y - p.y) * app.viewport.zoom < 3) return;
    p.ox = e.x; p.oy = e.y; p.ix = 2 * p.x - e.x; p.iy = 2 * p.y - e.y;
  }
  up() { this.dragging = false; }
  /** Convierte el trazado en una capa de forma. */
  finish(closed: boolean) {
    const doc = app.doc, pts = this.pts; this.pts = []; this.dragging = false;
    if (!doc || pts.length < 2) { app.viewport.requestRender(); return; }
    if (app.opt('mode', this.id) === 'path') {
      // modo Trazado: se añade al trazado activo del panel Trazados (o se crea uno nuevo)
      if (doc.activePath >= 0 && doc.paths[doc.activePath] && this.appendToActive) { doc.paths[doc.activePath].subpaths.push({ closed, pts }); doc.commit('Añadir subtrazado'); }
      else import('../ui/ops').then(o => o.newDocPath([{ closed, pts }]));
      this.appendToActive = true;
      return;
    }
    const fill = closed && app.opt('fill', this.id), stroke = app.opt('stroke', this.id) || !fill;
    let n = 1; const names = new Set(doc.allLayers().map(l => l.name));
    while (names.has(`Trazado ${n}`)) n++;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const layer = new ShapeLayer(`Trazado ${n}`, doc.width, doc.height, {
      shape: 'path', path: { closed, pts }, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys),
      fill: fill ? app.fg : null, stroke: stroke ? (app.opt('stroke', this.id) ? app.opt('strokeColor', this.id) : app.fg) : null,
      strokeWidth: app.opt('strokeWidth', this.id), radius: 0,
    });
    doc.insertAboveActive(layer);
    doc.commit('Pluma');
  }
  cancel() { this.pts = []; this.dragging = false; app.viewport?.requestRender(); }
  deactivate() { if (this.pts.length >= 2) this.finish(false); else this.pts = []; }
  docChanged() { this.pts = []; }
  key_(e: KeyboardEvent) {
    if (!this.pts.length) return false;
    if (e.key === 'Enter') { this.finish(false); return true; }
    if (e.key === 'Escape') { this.cancel(); return true; }
    if (e.key === 'Backspace' || e.key === 'Delete') { this.pts.pop(); app.viewport.requestRender(); return true; }
    return false;
  }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (!this.pts.length) return;
    drawPathOverlay(ctx, vp, this.pts, false, this.pts.length - 1);
    if (vp.mouseScreen && !this.dragging) { // línea elástica hasta el cursor
      const l = this.pts[this.pts.length - 1], a = vp.toScreen(l.x, l.y), c = vp.toScreen(l.ox, l.oy);
      ctx.strokeStyle = 'rgba(61,139,253,.6)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(a.x, a.y);
      ctx.bezierCurveTo(c.x, c.y, vp.mouseScreen.x, vp.mouseScreen.y, vp.mouseScreen.x, vp.mouseScreen.y); ctx.stroke(); ctx.setLineDash([]);
    }
  }
}

/** Selección directa: mueve anclas y tiradores de un trazado ya creado. */
export class NodeTool implements Tool {
  id = 'node'; name = 'Selección directa'; icon = icon('node'); key = 'A'; group = 'pen'; cursor = 'default';
  private active = -1;
  private drag: { i: number; part: 'a' | 'i' | 'o'; moved: boolean } | null = null;

  extraOptions(bar: HTMLElement) {
    bar.append(h('span', { class: 'hint' }, 'Arrastra los puntos o sus tiradores (Alt: tirador independiente) · Doble clic: esquina ↔ curva · Supr: borrar punto'));
  }
  /** Lo que se edita: una capa de trazado o el trazado activo del panel Trazados. */
  private layer(): { props: { path: { closed: boolean; pts: PathPoint[] } }; render(): void; isLocked(): boolean; subs?: { closed: boolean; pts: PathPoint[] }[] } | null {
    const d = app.doc, l = d?.active;
    if (l instanceof ShapeLayer && l.props.shape === 'path' && l.props.path) return l as any;
    // máscara vectorial de la capa (si no se ha elegido otro trazado en el panel)
    if (d && l?.vmask && d.activePath < 0) {
      const subs = l.vmask.subpaths, pts = subs.flatMap(sp => sp.pts);
      return { props: { path: { closed: true, pts } }, render: () => d.invalidate(), isLocked: () => l.isLocked(), subs };
    }
    if (d && d.activePath >= 0 && d.paths[d.activePath]) {
      // todos los subtrazados se tratan como una lista de puntos única
      const subs = d.paths[d.activePath].subpaths, pts = subs.flatMap(sp => sp.pts);
      return { props: { path: { closed: true, pts } }, render: () => d.invalidate(), isLocked: () => false, subs };
    }
    return null;
  }
  activate() { this.active = -1; if (app.doc && !this.layer()) app.toast('Selecciona una capa de trazado, una capa con máscara vectorial o un trazado del panel Trazados'); }
  docChanged() { this.active = -1; this.drag = null; }
  private hit(e: ToolEvent): { i: number; part: 'a' | 'i' | 'o' } | null {
    const l = this.layer(); if (!l) return null;
    const vp = app.viewport, near = (x: number, y: number) => { const s = vp.toScreen(x, y); return Math.hypot(s.x - e.sx, s.y - e.sy) < 8; };
    const pts = l.props.path!.pts;
    if (this.active >= 0 && pts[this.active]) { const p = pts[this.active]; if (near(p.ox, p.oy) && (p.ox !== p.x || p.oy !== p.y)) return { i: this.active, part: 'o' }; if (near(p.ix, p.iy) && (p.ix !== p.x || p.iy !== p.y)) return { i: this.active, part: 'i' }; }
    for (let i = pts.length - 1; i >= 0; i--) if (near(pts[i].x, pts[i].y)) return { i, part: 'a' };
    return null;
  }
  hover(e: ToolEvent) { this.cursor = this.hit(e) ? 'move' : 'default'; }
  down(e: ToolEvent) {
    const l = this.layer(); if (!l) return;
    if (l.isLocked()) { app.toast('La capa está bloqueada', 'warn'); return; }
    const hit = this.hit(e);
    if (!hit) { this.active = -1; return; }
    this.active = hit.i;
    if (e.detail >= 2 && hit.part === 'a') { // esquina ↔ curva
      const pts = l.props.path!.pts, p = pts[hit.i];
      if (p.ix !== p.x || p.iy !== p.y || p.ox !== p.x || p.oy !== p.y) { p.ix = p.ox = p.x; p.iy = p.oy = p.y; }
      else {
        const a = pts[(hit.i - 1 + pts.length) % pts.length], b = pts[(hit.i + 1) % pts.length];
        const dx = (b.x - a.x) / 6, dy = (b.y - a.y) / 6; p.ix = p.x - dx; p.iy = p.y - dy; p.ox = p.x + dx; p.oy = p.y + dy;
      }
      l.render(); app.doc!.commit('Editar trazado'); return;
    }
    this.drag = { ...hit, moved: false };
  }
  move(e: ToolEvent) {
    const l = this.layer(), d = this.drag; if (!l || !d) return;
    const p = l.props.path!.pts[d.i];
    if (d.part === 'a') { const dx = e.x - p.x, dy = e.y - p.y; p.x += dx; p.y += dy; p.ix += dx; p.iy += dy; p.ox += dx; p.oy += dy; }
    else if (d.part === 'o') { p.ox = e.x; p.oy = e.y; if (!e.alt) { p.ix = 2 * p.x - e.x; p.iy = 2 * p.y - e.y; } }
    else { p.ix = e.x; p.iy = e.y; if (!e.alt) { p.ox = 2 * p.x - e.x; p.oy = 2 * p.y - e.y; } }
    d.moved = true;
    l.render(); app.doc!.invalidate();
  }
  up() {
    const d = this.drag; this.drag = null;
    if (d?.moved) app.doc!.commit('Editar trazado');
  }
  key_(e: KeyboardEvent) {
    const l = this.layer();
    if (!l || this.active < 0 || (e.key !== 'Delete' && e.key !== 'Backspace')) return false;
    const pts = l.props.path!.pts;
    if (pts.length <= 2) { app.toast('Un trazado necesita al menos dos puntos', 'warn'); return true; }
    if (l.subs) { let k = this.active; for (const sp of l.subs) { if (k < sp.pts.length) { if (sp.pts.length <= 2) { app.toast('Un trazado necesita al menos dos puntos', 'warn'); return true; } sp.pts.splice(k, 1); break; } k -= sp.pts.length; } }
    else pts.splice(this.active, 1);
    this.active = -1;
    l.render(); app.doc!.commit('Borrar punto');
    return true;
  }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const l = this.layer(); if (!l) return;
    if (l.subs) { let off = 0; for (const sp of l.subs) { drawPathOverlay(ctx, vp, sp.pts, sp.closed, this.active - off); off += sp.pts.length; } }
    else drawPathOverlay(ctx, vp, l.props.path!.pts, l.props.path!.closed, this.active);
  }
}
export { drawPathOverlay };

/** Simplifica una polilínea (Ramer–Douglas–Peucker). */
function rdp(pts: { x: number; y: number }[], eps: number): { x: number; y: number }[] {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  let mi = 0, md = 0;
  const same = Math.hypot(dx, dy) < 1e-6;
  for (let i = 1; i < pts.length - 1; i++) { const d = same ? Math.hypot(pts[i].x - a.x, pts[i].y - a.y) : Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / L; if (d > md) { md = d; mi = i; } }
  if (md <= eps) return [a, b];
  return [...rdp(pts.slice(0, mi + 1), eps).slice(0, -1), ...rdp(pts.slice(mi), eps)];
}
/** Convierte puntos en un trazado Bézier suave (tiradores de Catmull-Rom). */
export function smoothPath(raw: { x: number; y: number }[], closed: boolean): PathPoint[] {
  const n = raw.length, k = 1 / 6;
  return raw.map((p, i) => {
    const prev = raw[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], next = raw[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const tx = (next.x - prev.x) * k, ty = (next.y - prev.y) * k;
    return { x: p.x, y: p.y, ix: p.x - tx, iy: p.y - ty, ox: p.x + tx, oy: p.y + ty };
  });
}

/** Pluma de forma libre: se dibuja a mano alzada y se convierte en un trazado de curvas editable. */
export class FreeformPenTool extends PenTool {
  id = 'freePen'; name = 'Pluma de forma libre'; icon = icon('freePen');
  options = [...this.options, { key: 'fit', label: 'Ajuste de curva', type: 'range', min: 1, max: 10, default: 2, unit: 'px' }] as any[];
  private raw: { x: number; y: number }[] = [];
  extraOptions(bar: HTMLElement) { bar.append(h('span', { class: 'hint' }, 'Arrastra para dibujar; termina cerca del inicio para cerrar la forma. Después se edita con la Selección directa (A).')); }
  down(e: ToolEvent) { this.raw = [{ x: e.x, y: e.y }]; this.dragging = true; }
  move(e: ToolEvent) {
    if (!this.dragging) return;
    const l = this.raw[this.raw.length - 1];
    if (Math.hypot(e.x - l.x, e.y - l.y) * app.viewport.zoom > 2) { this.raw.push({ x: e.x, y: e.y }); app.viewport.requestRender(); }
  }
  up() {
    if (!this.dragging) return; this.dragging = false;
    const raw = this.raw; this.raw = [];
    if (raw.length < 3) { app.viewport.requestRender(); return; }
    const a = app.viewport.toScreen(raw[0].x, raw[0].y), b = app.viewport.toScreen(raw[raw.length - 1].x, raw[raw.length - 1].y);
    const closed = Math.hypot(a.x - b.x, a.y - b.y) < 14 && raw.length > 6;
    if (closed) raw.push({ ...raw[0] });
    let simp = rdp(raw, app.opt<number>('fit', this.id) / Math.max(0.05, app.viewport.zoom));
    if (closed && simp.length > 2) simp = simp.slice(0, -1);
    if (simp.length < 2) return;
    this.pts = smoothPath(simp, closed);
    this.finish(closed);
  }
  key_() { return false; }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (this.raw.length < 2) return;
    ctx.save(); ctx.strokeStyle = '#3d8bfd'; ctx.lineWidth = 1.5; ctx.beginPath();
    this.raw.forEach((q, i) => { const s = vp.toScreen(q.x, q.y); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.stroke(); ctx.restore();
  }
}
