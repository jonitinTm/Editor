// Abrir SVG como capas vectoriales editables (no como una imagen plana).
// Cada forma con relleno (path, rect, circle, ellipse, polygon, polyline) pasa a ser una capa de color con máscara
// vectorial (con sus huecos según la regla de relleno); las que solo tienen trazo, a formas con trazo. Se respetan las
// transformaciones (de la propia forma y de los grupos) porque el navegador las calcula al poner el SVG en la página.

import { EditorDocument } from '../core/document';
import { AdjustmentLayer, GroupLayer, PathPoint, RasterLayer, ShapeLayer } from '../core/layers';
import { FILTERS, defaultParams } from '../filters/registry';
import { ctx2d } from '../core/canvas';

type Sub = { closed: boolean; pts: PathPoint[]; op?: number };
const P = (x: number, y: number): PathPoint => ({ x, y, ix: x, iy: y, ox: x, oy: y });

/** Atributo «d» de un SVG → subtrayectos Bézier (M L H V C S Q T A Z, absolutos y relativos). */
export function parsePathD(d: string): Sub[] {
  const toks = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const subs: Sub[] = []; let cur: Sub | null = null, i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, lcx = 0, lcy = 0, lq: [number, number] | null = null;
  const num = () => parseFloat(toks[i++]);
  const start = (nx: number, ny: number) => { cur = { closed: false, pts: [P(nx, ny)] }; subs.push(cur); sx = nx; sy = ny; };
  const last = () => cur!.pts[cur!.pts.length - 1];
  const cubic = (c1x: number, c1y: number, c2x: number, c2y: number, nx: number, ny: number) => { const l = last(); l.ox = c1x; l.oy = c1y; cur!.pts.push({ x: nx, y: ny, ix: c2x, iy: c2y, ox: nx, oy: ny }); lcx = c2x; lcy = c2y; x = nx; y = ny; };
  const line = (nx: number, ny: number) => { cur!.pts.push(P(nx, ny)); x = nx; y = ny; lcx = nx; lcy = ny; };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'Z') { if (cur) { (cur as Sub).closed = true; const f = (cur as Sub).pts[0], l = last(); if ((cur as Sub).pts.length > 1 && Math.hypot(l.x - f.x, l.y - f.y) < 1e-6) { f.ix = l.ix; f.iy = l.iy; (cur as Sub).pts.pop(); } } x = sx; y = sy; lq = null; continue; }
    if (i >= toks.length || /[a-zA-Z]/.test(toks[i])) { if (C !== 'Z') i++; continue; }
    if (C === 'M') { const nx = num() + ox, ny = num() + oy; start(nx, ny); x = nx; y = ny; cmd = rel ? 'l' : 'L'; lq = null; continue; }
    if (!cur) start(x, y);
    if (C === 'L') { line(num() + ox, num() + oy); lq = null; }
    else if (C === 'H') { line(num() + ox, y); lq = null; }
    else if (C === 'V') { line(x, num() + oy); lq = null; }
    else if (C === 'C') { const a = num() + ox, b = num() + oy, c = num() + ox, e = num() + oy, f = num() + ox, g = num() + oy; cubic(a, b, c, e, f, g); lq = null; }
    else if (C === 'S') { const c = num() + ox, e = num() + oy, f = num() + ox, g = num() + oy; cubic(2 * x - lcx, 2 * y - lcy, c, e, f, g); lq = null; }
    else if (C === 'Q' || C === 'T') {
      let qx: number, qy: number; if (C === 'Q') { qx = num() + ox; qy = num() + oy; } else { qx = lq ? 2 * x - lq[0] : x; qy = lq ? 2 * y - lq[1] : y; }
      const nx = num() + ox, ny = num() + oy; cubic(x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), nx + 2 / 3 * (qx - nx), ny + 2 / 3 * (qy - ny), nx, ny); lq = [qx, qy];
    } else if (C === 'A') {
      const rx0 = Math.abs(num()), ry0 = Math.abs(num()), rot = num() * Math.PI / 180, large = num(), sweep = num(), nx = num() + ox, ny = num() + oy;
      arcTo(x, y, rx0, ry0, rot, !!large, !!sweep, nx, ny, cubic); if (!(rx0 && ry0)) line(nx, ny); lq = null;
    } else i++;
  }
  return subs.filter(s => s.pts.length > 1);
}
/** Arco elíptico de SVG → curvas cúbicas (conversión estándar de la especificación SVG, apéndice F.6). */
function arcTo(x1: number, y1: number, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, x2: number, y2: number, cubic: (a: number, b: number, c: number, d: number, e: number, f: number) => void) {
  if (!rx || !ry) return;
  const cp = Math.cos(phi), sp = Math.sin(phi), dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  const lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry); if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p, den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den)), cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  let t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry), dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2))), d = dt / segs, k = 4 / 3 * Math.tan(d / 4);
  const pt = (t: number) => [cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp];
  const der = (t: number) => [-rx * Math.sin(t) * cp - ry * Math.cos(t) * sp, -rx * Math.sin(t) * sp + ry * Math.cos(t) * cp];
  for (let s = 0; s < segs; s++) {
    const a = t1 + s * d, b = a + d, [ax, ay] = pt(a), [bx, by] = pt(b), [dax, day] = der(a), [dbx, dby] = der(b);
    cubic(ax + k * dax, ay + k * day, bx - k * dbx, by - k * dby, bx, by);
  }
}
/** Cualquier forma básica de SVG → atributo «d». */
function shapeD(el: Element): string | null {
  const n = (a: string) => parseFloat(el.getAttribute(a) || '0') || 0, t = el.tagName.toLowerCase();
  if (t === 'path') return el.getAttribute('d');
  if (t === 'rect') { const x = n('x'), y = n('y'), w = n('width'), h = n('height'); let rx = n('rx'), ry = n('ry'); if (!el.hasAttribute('ry')) ry = rx; if (!el.hasAttribute('rx')) rx = ry; rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
    return rx || ry ? `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z` : `M${x} ${y}H${x + w}V${y + h}H${x}Z`; }
  if (t === 'circle' || t === 'ellipse') { const cx = n('cx'), cy = n('cy'), rx = t === 'circle' ? n('r') : n('rx'), ry = t === 'circle' ? n('r') : n('ry'); return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`; }
  if (t === 'line') return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`;
  if (t === 'polygon' || t === 'polyline') { const v = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number); if (v.length < 4) return null; let d = `M${v[0]} ${v[1]}`; for (let i = 2; i + 1 < v.length; i += 2) d += `L${v[i]} ${v[i + 1]}`; return d + (t === 'polygon' ? 'Z' : ''); }
  return null;
}
const toHex = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a] = m[1].split(',').map(s => parseFloat(s)); if (a === 0) return null; return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join(''); };

/** Lee un SVG y devuelve un documento con una capa vectorial por forma (o null si no tiene formas). */
export async function openSvgAsVectors(text: string, name: string): Promise<{ doc: EditorDocument; count: number; skipped: number } | null> {
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml'), svg = parsed.documentElement;
  if (!svg || svg.tagName.toLowerCase() !== 'svg') return null;
  // tamaño: width/height o el viewBox
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number), hasVB = vb.length === 4 && vb.every(v => isFinite(v));
  const len = (a: string, f: number) => { const v = parseFloat(svg.getAttribute(a) || ''); return isFinite(v) && v > 0 ? v : f; };
  const W = Math.round(Math.min(8000, len('width', hasVB ? vb[2] : 800))), H = Math.round(Math.min(8000, len('height', hasVB ? vb[3] : 600)));
  // el SVG se pone (oculto) en la página para que el navegador calcule estilos y transformaciones
  const host = document.createElement('div'); host.style.cssText = 'position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden';
  const live = document.importNode(svg, true) as unknown as SVGSVGElement; live.setAttribute('width', String(W)); live.setAttribute('height', String(H));
  host.append(live); document.body.append(host);
  const doc = new EditorDocument(name, W, H), group = new GroupLayer(name), fillDef = FILTERS.find(f => f.id === 'solidfill')!;
  let count = 0, skipped = 0;
  try {
    const root = live.getScreenCTM()?.inverse();
    for (const el of live.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line')) {
      if (el.closest('defs,clipPath,mask,symbol,pattern,marker')) continue;
      const d = shapeD(el); if (!d) continue;
      const cs = getComputedStyle(el), m = root && (el as SVGGraphicsElement).getScreenCTM ? root.multiply((el as SVGGraphicsElement).getScreenCTM()!) : null;
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      let subs = parsePathD(d); if (!subs.length) continue;
      if (m) subs = subs.map(s => ({ ...s, pts: s.pts.map(q => { const t = (x: number, y: number) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]; const [x, y] = t(q.x, q.y), [ix, iy] = t(q.ix, q.iy), [ox, oy] = t(q.ox, q.oy); return { x, y, ix, iy, ox, oy }; }) }));
      const fill = toHex(cs.fill), stroke = toHex(cs.stroke), op = parseFloat(cs.opacity || '1') * parseFloat(cs.fillOpacity || '1');
      const label = el.getAttribute('id') || el.tagName.toLowerCase();
      if (fill && el.tagName.toLowerCase() !== 'line') {
        const pr = defaultParams(fillDef); pr.color = fill;
        const l = new AdjustmentLayer(label, 'solidfill', pr);
        const evenodd = cs.fillRule === 'evenodd';
        l.vmask = { subpaths: subs.map((s, i) => ({ ...s, closed: true, op: i === 0 ? 1 : evenodd ? 0 : 1 })), enabled: true };
        l.opacity = Math.max(0, Math.min(1, op)); group.add(l); count++;
      }
      if (stroke && cs.stroke !== 'none') {
        const sw = (parseFloat(cs.strokeWidth) || 1) * (m ? Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) : 1);
        for (const s of subs) {
          const xs = s.pts.map(q => q.x), ys = s.pts.map(q => q.y);
          const sl = new ShapeLayer(label + ' (trazo)', W, H, { shape: 'path', path: { closed: s.closed, pts: s.pts }, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), fill: null, stroke, strokeWidth: sw, radius: 0 } as any);
          sl.render(); group.add(sl); count++;
        }
      }
      if (!fill && !stroke) skipped++;
    }
    // texto e imágenes incrustadas no se convierten: se avisa
    skipped += live.querySelectorAll('text,image,foreignObject').length;
  } finally { host.remove(); }
  if (!count) return null;
  // fondo blanco por debajo (como al abrir un SVG en un programa de diseño); se puede ocultar
  const bg = new RasterLayer('Fondo', W, H); const bx = ctx2d(bg.canvas); bx.fillStyle = '#ffffff'; bx.fillRect(0, 0, W, H); bg.touch();
  doc.root.add(bg); doc.root.add(group); doc.setActive(group, false);
  return { doc, count, skipped };
}
