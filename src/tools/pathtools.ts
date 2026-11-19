// Herramientas de trazados del grupo de la Pluma: añadir, eliminar y convertir puntos, mover un trazado entero
// (selección de trazado) y la pluma de curvatura (el trazado pasa por los puntos que pones, con curvas suaves).

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import type { Viewport } from '../ui/viewport';
import { ShapeLayer, type PathPoint } from '../core/layers';
import { PenTool, smoothPath, drawPathOverlay } from './pen';
import { h } from '../ui/dom';

type Sub = { closed: boolean; pts: PathPoint[] };
/** Lo que se edita: una capa de trazado, la máscara vectorial de la capa o el trazado activo del panel Trazados. */
function editable(): { subs: Sub[]; render(): void; locked: boolean; single?: boolean } | null {
  const d = app.doc, l = d?.active; if (!d) return null;
  if (l instanceof ShapeLayer && l.props.shape === 'path' && l.props.path) return { subs: [l.props.path], render: () => { l.render(); d.invalidate(); }, locked: l.isLocked(), single: true };
  if (l?.vmask && d.activePath < 0) return { subs: l.vmask.subpaths, render: () => d.invalidate(), locked: l.isLocked() };
  if (d.activePath >= 0 && d.paths[d.activePath]) return { subs: d.paths[d.activePath].subpaths, render: () => d.invalidate(), locked: false };
  return null;
}
const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const bez = (a: PathPoint, b: PathPoint, t: number) => { const u = 1 - t; return { x: u * u * u * a.x + 3 * u * u * t * a.ox + 3 * u * t * t * b.ix + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * a.oy + 3 * u * t * t * b.iy + t * t * t * b.y }; };
const isCorner = (p: PathPoint) => p.ix === p.x && p.iy === p.y && p.ox === p.x && p.oy === p.y;

function hitPoint(E: NonNullable<ReturnType<typeof editable>>, e: ToolEvent): { s: number; i: number } | null {
  const vp = app.viewport;
  for (let s = 0; s < E.subs.length; s++) for (let i = E.subs[s].pts.length - 1; i >= 0; i--) { const p = E.subs[s].pts[i], q = vp.toScreen(p.x, p.y); if (Math.hypot(q.x - e.sx, q.y - e.sy) < 8) return { s, i }; }
  return null;
}
function hitSegment(E: NonNullable<ReturnType<typeof editable>>, e: ToolEvent): { s: number; i: number; t: number } | null {
  const vp = app.viewport; let best: { s: number; i: number; t: number; d: number } | null = null;
  E.subs.forEach((sp, s) => {
    const n = sp.pts.length, segs = sp.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = sp.pts[i], b = sp.pts[(i + 1) % n];
      for (let k = 1; k < 48; k++) { const t = k / 48, p = bez(a, b, t), q = vp.toScreen(p.x, p.y), dd = Math.hypot(q.x - e.sx, q.y - e.sy); if (dd < 7 && (!best || dd < best.d)) best = { s, i, t, d: dd }; }
    }
  });
  return best;
}
function overlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
  const E = editable(); if (!E) return;
  for (const sp of E.subs) drawPathOverlay(ctx, vp, sp.pts, sp.closed, -1);
}

/** Añadir punto de ancla: clic sobre el trazado para partir ese tramo en dos sin cambiar su forma. */
export class AddAnchorTool implements Tool {
  id = 'addAnchor'; name = 'Añadir punto de ancla'; icon = icon('addAnchor'); key = 'P'; group = 'pen'; cursor = 'copy';
  down(e: ToolEvent) {
    const E = editable(); if (!E) { app.toast('Selecciona una capa de trazado, una máscara vectorial o un trazado del panel Trazados', 'warn'); return; }
    if (E.locked) { app.toast('La capa está bloqueada', 'warn'); return; }
    const hs = hitSegment(E, e); if (!hs) return;
    const sp = E.subs[hs.s], n = sp.pts.length, a = sp.pts[hs.i], b = sp.pts[(hs.i + 1) % n], t = hs.t;
    // división de la curva por De Casteljau: el trazado queda exactamente igual
    const A = { x: a.x, y: a.y }, B = { x: a.ox, y: a.oy }, C = { x: b.ix, y: b.iy }, D = { x: b.x, y: b.y };
    const E1 = lerp(A, B, t), F = lerp(B, C, t), G = lerp(C, D, t), H1 = lerp(E1, F, t), J = lerp(F, G, t), K = lerp(H1, J, t);
    a.ox = E1.x; a.oy = E1.y; b.ix = G.x; b.iy = G.y;
    sp.pts.splice(hs.i + 1, 0, { x: K.x, y: K.y, ix: H1.x, iy: H1.y, ox: J.x, oy: J.y });
    E.render(); app.doc!.commit('Añadir punto de ancla');
  }
  drawOverlay = overlay;
}

/** Eliminar punto de ancla: clic sobre un punto para quitarlo. */
export class DeleteAnchorTool implements Tool {
  id = 'delAnchor'; name = 'Eliminar punto de ancla'; icon = icon('delAnchor'); key = 'P'; group = 'pen'; cursor = 'pointer';
  down(e: ToolEvent) {
    const E = editable(); if (!E || E.locked) return;
    const hp = hitPoint(E, e); if (!hp) return;
    const sp = E.subs[hp.s];
    if (sp.pts.length <= 2) { app.toast('Un trazado necesita al menos dos puntos', 'warn'); return; }
    sp.pts.splice(hp.i, 1); E.render(); app.doc!.commit('Eliminar punto de ancla');
  }
  drawOverlay = overlay;
}

/** Convertir punto: clic = esquina; arrastrar desde un punto = sacar tiradores simétricos (curva suave). */
export class ConvertPointTool implements Tool {
  id = 'convertPoint'; name = 'Convertir punto'; icon = icon('convertPoint'); key = 'P'; group = 'pen'; cursor = 'crosshair';
  private drag: { p: PathPoint; moved: boolean } | null = null;
  down(e: ToolEvent) {
    const E = editable(); if (!E || E.locked) return;
    const hp = hitPoint(E, e); if (!hp) return;
    this.drag = { p: E.subs[hp.s].pts[hp.i], moved: false };
  }
  move(e: ToolEvent) {
    const g = this.drag; if (!g) return;
    const p = g.p; p.ox = e.x; p.oy = e.y; p.ix = 2 * p.x - e.x; p.iy = 2 * p.y - e.y; g.moved = true;
    editable()?.render();
  }
  up() {
    const g = this.drag; this.drag = null; if (!g) return;
    if (!g.moved) { const p = g.p; if (!isCorner(p)) { p.ix = p.ox = p.x; p.iy = p.oy = p.y; } }
    editable()?.render(); app.doc!.commit('Convertir punto');
  }
  drawOverlay = overlay;
}

/** Selección de trazado: arrastra un trazado (subtrazado) entero para moverlo; Alt+arrastrar lo duplica. */
export class PathSelectTool implements Tool {
  id = 'pathSelect'; name = 'Selección de trazado'; icon = icon('pathSelect'); key = 'A'; group = 'pen'; cursor = 'default';
  private drag: { sub: Sub; x: number; y: number; moved: boolean } | null = null;
  extraOptions(bar: HTMLElement) { bar.append(h('span', { class: 'hint' }, 'Arrastra un trazado para moverlo entero · Alt+arrastrar: duplicarlo · Supr: borrarlo')); }
  private sel: Sub | null = null;
  down(e: ToolEvent) {
    const E = editable(); if (!E || E.locked) return;
    const hs = hitSegment(E, e), hp = hitPoint(E, e), s = hs?.s ?? hp?.s;
    let sub = s !== undefined ? E.subs[s] : null;
    // también vale hacer clic dentro de una forma cerrada
    if (!sub) { const ctx = app.viewport.canvas.getContext('2d')!; for (const sp of E.subs) { if (!sp.closed) continue; const p = new Path2D(); sp.pts.forEach((q, i) => { if (!i) p.moveTo(q.x, q.y); else { const a = sp.pts[i - 1]; p.bezierCurveTo(a.ox, a.oy, q.ix, q.iy, q.x, q.y); } }); const a = sp.pts[sp.pts.length - 1], b = sp.pts[0]; p.bezierCurveTo(a.ox, a.oy, b.ix, b.iy, b.x, b.y); if (ctx.isPointInPath(p, e.x, e.y)) { sub = sp; break; } } }
    this.sel = sub;
    if (!sub) { app.viewport.requestRender(); return; }
    if (e.alt && !E.single) { const copy: Sub = JSON.parse(JSON.stringify(sub)); E.subs.push(copy); sub = copy; this.sel = copy; }
    this.drag = { sub, x: e.x, y: e.y, moved: false };
  }
  move(e: ToolEvent) {
    const g = this.drag; if (!g) return;
    const dx = e.x - g.x, dy = e.y - g.y; g.x = e.x; g.y = e.y; g.moved = true;
    for (const p of g.sub.pts) { p.x += dx; p.y += dy; p.ix += dx; p.iy += dy; p.ox += dx; p.oy += dy; }
    editable()?.render();
  }
  up() { const g = this.drag; this.drag = null; if (g?.moved) app.doc!.commit('Mover trazado'); }
  key_(e: KeyboardEvent) {
    const E = editable(); if (!E || !this.sel || (e.key !== 'Delete' && e.key !== 'Backspace')) return false;
    if (E.single || E.subs.length <= 1) { app.toast('Es el único trazado: borra la capa o el trazado desde su panel', 'warn'); return true; }
    E.subs.splice(E.subs.indexOf(this.sel), 1); this.sel = null; E.render(); app.doc!.commit('Borrar trazado'); return true;
  }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    overlay(ctx, vp);
    if (this.sel) { ctx.save(); ctx.strokeStyle = '#3d8bfd'; ctx.lineWidth = 2; ctx.beginPath(); this.sel.pts.forEach((q, i) => { const s = vp.toScreen(q.x, q.y); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); if (this.sel.closed) ctx.closePath(); ctx.stroke(); ctx.restore(); }
  }
}

/** Pluma de curvatura: cada clic añade un punto por el que pasa una curva suave; doble clic = esquina. */
export class CurvaturePenTool extends PenTool {
  id = 'curvPen'; name = 'Pluma de curvatura'; icon = icon('curvPen');
  private raw: { x: number; y: number; corner: boolean }[] = [];
  extraOptions(bar: HTMLElement) { bar.append(h('span', { class: 'hint' }, 'Clic: punto de curva · Doble clic: esquina · Clic en el primer punto: cerrar · Intro: terminar · Retroceso: quitar punto')); }
  private rebuild(closed: boolean) {
    const sm = smoothPath(this.raw.map(p => ({ x: p.x, y: p.y })), closed);
    this.raw.forEach((p, i) => { if (p.corner) { const q = sm[i]; q.ix = q.ox = q.x; q.iy = q.oy = q.y; } });
    // los extremos de un trazado abierto no llevan tirador hacia fuera
    if (!closed && sm.length) { const a = sm[0], z = sm[sm.length - 1]; a.ix = a.x; a.iy = a.y; z.ox = z.x; z.oy = z.y; }
    this.pts = sm;
  }
  down(e: ToolEvent) {
    if (this.raw.length >= 2) { const f = app.viewport.toScreen(this.raw[0].x, this.raw[0].y); if (Math.hypot(f.x - e.sx, f.y - e.sy) < 8) { this.rebuild(true); this.raw = []; this.finish(true); return; } }
    if (e.detail >= 2 && this.raw.length) { this.raw[this.raw.length - 1].corner = true; this.rebuild(false); app.viewport.requestRender(); return; }
    this.raw.push({ x: e.x, y: e.y, corner: false }); this.rebuild(false); app.viewport.requestRender();
  }
  move() { /* sin arrastre: la curva se calcula sola */ }
  up() { /* nada */ }
  cancel() { this.raw = []; super.cancel(); }
  deactivate() { if (this.raw.length >= 2) { this.rebuild(false); this.raw = []; this.finish(false); } else { this.raw = []; this.pts = []; } }
  key_(e: KeyboardEvent) {
    if (!this.raw.length) return false;
    if (e.key === 'Enter') { this.rebuild(false); this.raw = []; this.finish(false); return true; }
    if (e.key === 'Escape') { this.cancel(); return true; }
    if (e.key === 'Backspace' || e.key === 'Delete') { this.raw.pop(); this.rebuild(false); app.viewport.requestRender(); return true; }
    return false;
  }
}

/** Para la Pluma con «Añadir/eliminar automáticamente»: clic en un punto lo quita, clic en el trazado añade uno. */
const autoAdd = new AddAnchorTool(), autoDel = new DeleteAnchorTool();
(app as any).penAutoEdit = (e: ToolEvent) => {
  const E = editable(); if (!E || E.locked) return false;
  if (hitPoint(E, e)) { autoDel.down(e); return true; }
  if (hitSegment(E, e)) { autoAdd.down(e); return true; }
  return false;
};
