// Ajuste magnético (snap) y guías inteligentes: bordes y centro del lienzo,
// guías y bordes/centros de otras capas.

import { app } from '../ui/app';
import { Rect, contentBoundsQuick } from '../core/canvas';
import { Layer, isRaster } from '../core/layers';
import type { Viewport } from '../ui/viewport';

export interface SnapLines { x: number[]; y: number[]; }
/** Líneas que se dibujan mientras hay un ajuste activo. */
export let activeSnap: SnapLines | null = null;
export function clearSnap() { activeSnap = null; }

export function layerBounds(l: Layer): Rect | null {
  if (!isRaster(l)) return null;
  const f = l.fullContent(), b = contentBoundsQuick(f.canvas, l.version);
  return b ? { x: b.x + f.x, y: b.y + f.y, w: b.w, h: b.h } : null;
}

/** Posiciones a las que engancharse (x e y por separado). */
export function snapTargets(exclude: Layer[], withLayers = true): { x: number[]; y: number[] } {
  const d = app.doc!;
  const x = [0, d.width / 2, d.width], y = [0, d.height / 2, d.height];
  if (app.showGuides) { x.push(...d.guides.v); y.push(...d.guides.h); }
  if (withLayers) for (const l of d.allLayers()) {
    if (exclude.includes(l) || !l.isVisibleInTree()) continue;
    const b = layerBounds(l); if (!b || (b.w >= d.width && b.h >= d.height)) continue;
    x.push(b.x, b.x + b.w / 2, b.x + b.w); y.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { x, y };
}

/** Ajusta el desplazamiento (dx, dy) de una caja para que sus bordes o centro coincidan con algún objetivo. */
export function snapRect(r: Rect, dx: number, dy: number, targets: { x: number[]; y: number[] }): { dx: number; dy: number } {
  if (!app.snapOn) { activeSnap = null; return { dx, dy }; }
  const tol = 6 / app.viewport.zoom;
  const best = (edges: number[], list: number[]) => {
    let off = 0, dist = tol + 1, line: number[] = [];
    for (const e of edges) for (const t of list) {
      const dd = Math.abs(t - e);
      if (dd < dist - 0.01) { dist = dd; off = t - e; line = [t]; }
      else if (Math.abs(dd - dist) < 0.01 && Math.abs(t - e - off) < 0.01) line.push(t);
    }
    return dist <= tol ? { off, line } : null;
  };
  const bx = best([r.x + dx, r.x + r.w / 2 + dx, r.x + r.w + dx], targets.x);
  const by = best([r.y + dy, r.y + r.h / 2 + dy, r.y + r.h + dy], targets.y);
  activeSnap = { x: bx ? bx.line : [], y: by ? by.line : [] };
  return { dx: dx + (bx?.off ?? 0), dy: dy + (by?.off ?? 0) };
}
/** Ajusta un punto suelto (esquinas de selecciones y recortes). */
export function snapPoint(x: number, y: number, withLayers = false): { x: number; y: number } {
  const r = snapRect({ x, y, w: 0, h: 0 }, 0, 0, snapTargets([], withLayers));
  return { x: x + r.dx, y: y + r.dy };
}

export function drawSnap(ctx: CanvasRenderingContext2D, vp: Viewport) {
  if (!activeSnap || !app.doc) return;
  ctx.save(); ctx.strokeStyle = '#ff2ea6'; ctx.lineWidth = 1; ctx.beginPath();
  for (const x of activeSnap.x) { const s = vp.toScreen(x, 0).x; ctx.moveTo(Math.round(s) + .5, 0); ctx.lineTo(Math.round(s) + .5, vp.height); }
  for (const y of activeSnap.y) { const s = vp.toScreen(0, y).y; ctx.moveTo(0, Math.round(s) + .5); ctx.lineTo(vp.width, Math.round(s) + .5); }
  ctx.stroke(); ctx.restore();
}
