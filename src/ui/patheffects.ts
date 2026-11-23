// Capa › Forma › Efectos de trazado: deforman el contorno de una forma vectorial y la dejan editable.
// Son los efectos clásicos de los programas de ilustración (los mismos que tiene VectorCraft —
// https://github.com/storytold/vectorcraft, licencia MIT— en «Distorsionar y transformar» y «Trazado»):
// fruncir y engordar, hacer rugoso, zigzag, retorcer, redondear esquinas y desplazar trazado.

import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog, row } from './dialog';
import { AdjustmentLayer, PathPoint, ShapeLayer, ShapeProps } from '../core/layers';

type Sub = { closed: boolean; pts: PathPoint[]; op?: number };
const P = (x: number, y: number): PathPoint => ({ x, y, ix: x, iy: y, ox: x, oy: y });
const K = 0.5523;   // asas de Bézier para un cuarto de elipse

/** El contorno de una forma como puntos Bézier (null si es una forma de la biblioteca o una línea). */
export function shapeOutline(p: ShapeProps): Sub | null {
  const x = Math.min(p.x0, p.x1), y = Math.min(p.y0, p.y1), w = Math.abs(p.x1 - p.x0), hh = Math.abs(p.y1 - p.y0);
  if (p.shape === 'path') return p.path ? JSON.parse(JSON.stringify(p.path)) : null;
  if (p.shape === 'rect') return { closed: true, pts: [P(x, y), P(x + w, y), P(x + w, y + hh), P(x, y + hh)] };
  if (p.shape === 'ellipse') {
    const cx = x + w / 2, cy = y + hh / 2, rx = w / 2, ry = hh / 2;
    return { closed: true, pts: [
      { x: cx, y: cy - ry, ix: cx - rx * K, iy: cy - ry, ox: cx + rx * K, oy: cy - ry },
      { x: cx + rx, y: cy, ix: cx + rx, iy: cy - ry * K, ox: cx + rx, oy: cy + ry * K },
      { x: cx, y: cy + ry, ix: cx + rx * K, iy: cy + ry, ox: cx - rx * K, oy: cy + ry },
      { x: cx - rx, y: cy, ix: cx - rx, iy: cy + ry * K, ox: cx - rx, oy: cy - ry * K }] };
  }
  if (p.shape === 'round') return roundCorners([{ closed: true, pts: [P(x, y), P(x + w, y), P(x + w, y + hh), P(x, y + hh)] }], Math.min(p.radius, w / 2, hh / 2))[0];
  if (p.shape === 'polygon' || p.shape === 'star') {
    const n = Math.max(3, Math.round(p.sides ?? (p.shape === 'star' ? 5 : 6))), star = p.shape === 'star', k = p.inner ?? 0.45, cnt = star ? n * 2 : n, pts: PathPoint[] = [];
    for (let i = 0; i < cnt; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / cnt, rr = star && i % 2 ? k : 1; pts.push(P(x + w / 2 + Math.cos(a) * w / 2 * rr, y + hh / 2 + Math.sin(a) * hh / 2 * rr)); }
    return { closed: true, pts };
  }
  if (p.shape === 'heart') {
    const cx = x + w / 2;
    return { closed: true, pts: [
      { x: cx, y: y + hh * 0.3, ix: cx, iy: y, ox: cx, oy: y },
      { x, y: y + hh * 0.32, ix: x, iy: y, ox: x, oy: y + hh * 0.62 },
      { x: cx, y: y + hh, ix: cx - w * 0.1, iy: y + hh * 0.78, ox: cx + w * 0.1, oy: y + hh * 0.78 },
      { x: x + w, y: y + hh * 0.32, ix: x + w, iy: y + hh * 0.62, ox: x + w, oy: y }] };
  }
  if (p.shape === 'arrow') {
    const dx = p.x1 - p.x0, dy = p.y1 - p.y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const t = Math.max(2, Math.min(L * 0.12, p.strokeWidth * 2 + L * 0.06)), head = Math.min(L * 0.45, t * 3.2), hw = t * 2.4;
    const Q = (a: number, b: number) => P(p.x0 + ux * a + nx * b, p.y0 + uy * a + ny * b);
    return { closed: true, pts: [Q(0, -t / 2), Q(L - head, -t / 2), Q(L - head, -hw / 2), Q(L, 0), Q(L - head, hw / 2), Q(L - head, t / 2), Q(0, t / 2)] };
  }
  return null;
}

// ---- utilidades -------------------------------------------------------------------------------------------------
const bez = (a: PathPoint, b: PathPoint, t: number) => { const u = 1 - t; return { x: u * u * u * a.x + 3 * u * u * t * a.ox + 3 * u * t * t * b.ix + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * a.oy + 3 * u * t * t * b.iy + t * t * t * b.y }; };
/** El trazado convertido en una línea quebrada con un punto cada `step` píxeles (aprox.). */
function flatten(sp: Sub, step: number): { x: number; y: number }[] {
  const p = sp.pts, out: { x: number; y: number }[] = [], n = sp.closed ? p.length : p.length - 1;
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % p.length], len = Math.hypot(a.ox - a.x, a.oy - a.y) + Math.hypot(b.ix - a.ox, b.iy - a.oy) + Math.hypot(b.x - b.ix, b.y - b.iy);
    const k = Math.max(1, Math.round(len / step)); for (let j = 0; j < k; j++) out.push(bez(a, b, j / k));
  }
  if (!sp.closed && p.length) out.push({ x: p[p.length - 1].x, y: p[p.length - 1].y });
  return out;
}
function bounds(subs: Sub[]) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const s of subs) for (const q of s.pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); } return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: Math.max(1, Math.hypot(x1 - x0, y1 - y0)) }; }
/** Puntos → curvas suaves (Catmull-Rom) o esquinas. */
function smoothPts(q: { x: number; y: number }[], closed: boolean, smooth: boolean): PathPoint[] {
  const n = q.length;
  return q.map((p, i) => {
    if (!smooth || (!closed && (i === 0 || i === n - 1))) return P(p.x, p.y);
    const a = q[(i - 1 + n) % n], b = q[(i + 1) % n], tx = (b.x - a.x) / 6, ty = (b.y - a.y) / 6;
    return { x: p.x, y: p.y, ix: p.x - tx, iy: p.y - ty, ox: p.x + tx, oy: p.y + ty };
  });
}
function seeded(seed: number) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const area = (q: { x: number; y: number }[]) => { let a = 0; for (let i = 0; i < q.length; i++) { const p = q[i], r = q[(i + 1) % q.length]; a += p.x * r.y - r.x * p.y; } return a / 2; };
function inside(pt: { x: number; y: number }, q: { x: number; y: number }[]) { let c = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) if ((q[i].y > pt.y) !== (q[j].y > pt.y) && pt.x < (q[j].x - q[i].x) * (pt.y - q[i].y) / (q[j].y - q[i].y) + q[i].x) c = !c; return c; }

// ---- efectos ------------------------------------------------------------------------------------------------------
/** Fruncir (a < 0: picos hacia fuera, curvas hacia dentro) y engordar (a > 0: lo contrario). a en −1..1. */
export function puckerBloat(subs: Sub[], a: number): Sub[] {
  const b = bounds(subs);
  return subs.map(sp => {
    const p = sp.pts, n = p.length, out: PathPoint[] = p.map(q => ({ ...q }));
    for (let i = 0; i < n; i++) {
      const A = p[i], B = p[(i + 1) % n]; if (!sp.closed && i === n - 1) break;
      // asas a un tercio del tramo, desplazadas hacia el centro (fruncir) o hacia fuera (engordar)
      const h1 = { x: A.x + (B.x - A.x) / 3, y: A.y + (B.y - A.y) / 3 }, h2 = { x: A.x + 2 * (B.x - A.x) / 3, y: A.y + 2 * (B.y - A.y) / 3 };
      out[i].ox = h1.x + (h1.x - b.cx) * a; out[i].oy = h1.y + (h1.y - b.cy) * a;
      out[(i + 1) % n].ix = h2.x + (h2.x - b.cx) * a; out[(i + 1) % n].iy = h2.y + (h2.y - b.cy) * a;
      // los puntos de anclaje se mueven al revés que las asas
      if (i === 0 || sp.closed) { out[i].x = A.x - (A.x - b.cx) * a * 0.5; out[i].y = A.y - (A.y - b.cy) * a * 0.5; }
    }
    return { ...sp, pts: out };
  });
}
/** Hacer rugoso: puntos cada `detail` px desplazados al azar hasta `size` % del tamaño. */
export function roughen(subs: Sub[], size: number, detail: number, smooth: boolean, seed = 7): Sub[] {
  const b = bounds(subs), r = seeded(seed), amp = b.size * size / 100;
  return subs.map(sp => { const q = flatten(sp, Math.max(2, detail)).map(p => ({ x: p.x + (r() * 2 - 1) * amp, y: p.y + (r() * 2 - 1) * amp })); return { ...sp, pts: smoothPts(q, sp.closed, smooth) }; });
}
/** Zigzag: ondas regulares a lo largo del contorno, `size` px de alto y una cada `wave` px. */
export function zigzag(subs: Sub[], size: number, wave: number, smooth: boolean): Sub[] {
  return subs.map(sp => {
    const q = flatten(sp, Math.max(1, wave / 6)), n = q.length, out: { x: number; y: number }[] = []; let dist = 0;
    for (let i = 0; i < n; i++) {
      const a = q[(i - 1 + n) % n], c = q[(i + 1) % n], tx = c.x - a.x, ty = c.y - a.y, tl = Math.hypot(tx, ty) || 1;
      if (i) dist += Math.hypot(q[i].x - q[i - 1].x, q[i].y - q[i - 1].y);
      const ph = dist / wave * 2, off = smooth ? Math.sin(ph * Math.PI) * size : (Math.floor(ph) % 2 ? -1 : 1) * size * (1 - 2 * Math.abs(ph % 1 - 0.5));
      out.push({ x: q[i].x - ty / tl * off, y: q[i].y + tx / tl * off });
    }
    return { ...sp, pts: smoothPts(out, sp.closed, smooth) };
  });
}
/** Retorcer: cada punto gira alrededor del centro, más cuanto más cerca está de él. */
export function twist(subs: Sub[], deg: number): Sub[] {
  const b = bounds(subs), R = b.size / 2;
  const rot = (x: number, y: number) => { const dx = x - b.cx, dy = y - b.cy, a = deg * Math.PI / 180 * Math.max(0, 1 - Math.hypot(dx, dy) / R), c = Math.cos(a), s = Math.sin(a); return [b.cx + dx * c - dy * s, b.cy + dx * s + dy * c]; };
  return subs.map(sp => ({ ...sp, pts: flatten(sp, 4).map(q => { const [x, y] = rot(q.x, q.y); return P(x, y); }) })).map(sp => ({ ...sp, pts: smoothPts(sp.pts, sp.closed, true) }));
}
/** Redondear esquinas: cada esquina (punto sin asas) se cambia por un arco de radio `r`. */
export function roundCorners(subs: Sub[], r: number): Sub[] {
  return subs.map(sp => {
    const p = sp.pts, n = p.length, out: PathPoint[] = [];
    for (let i = 0; i < n; i++) {
      const c = p[i], sharp = c.ix === c.x && c.iy === c.y && c.ox === c.x && c.oy === c.y;
      if (!sharp || r <= 0 || (!sp.closed && (i === 0 || i === n - 1))) { out.push({ ...c }); continue; }
      const a = p[(i - 1 + n) % n], b = p[(i + 1) % n], la = Math.hypot(a.x - c.x, a.y - c.y), lb = Math.hypot(b.x - c.x, b.y - c.y);
      const rr = Math.min(r, la / 2, lb / 2); if (rr < 0.5) { out.push({ ...c }); continue; }
      const ua = { x: (a.x - c.x) / la, y: (a.y - c.y) / la }, ub = { x: (b.x - c.x) / lb, y: (b.y - c.y) / lb };
      const s = { x: c.x + ua.x * rr, y: c.y + ua.y * rr }, e = { x: c.x + ub.x * rr, y: c.y + ub.y * rr };
      out.push({ x: s.x, y: s.y, ix: s.x, iy: s.y, ox: s.x - ua.x * rr * K, oy: s.y - ua.y * rr * K });
      out.push({ x: e.x, y: e.y, ix: e.x - ub.x * rr * K, iy: e.y - ub.y * rr * K, ox: e.x, oy: e.y });
    }
    return { ...sp, pts: out };
  });
}
/** Desplazar trazado: el contorno crece (d > 0) o encoge (d < 0) `d` píxeles; los huecos, al revés. */
export function offsetPath(subs: Sub[], d: number, round: boolean): Sub[] {
  const flats = subs.map(sp => flatten(sp, 3));
  return subs.map((sp, k) => {
    let q = flats[k]; if (q.length < 3 || !sp.closed) return sp;
    // ¿es un hueco? (está dentro de un número impar de los otros contornos)
    const hole = flats.reduce((c, o, j) => c + (j !== k && o.length > 2 && inside(q[0], o) ? 1 : 0), 0) % 2 === 1;
    const dir = (area(q) > 0 ? -1 : 1) * (hole ? -1 : 1), n = q.length, out: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = q[(i - 1 + n) % n], p = q[i], b = q[(i + 1) % n];
      const n1 = norm(p.x - a.x, p.y - a.y), n2 = norm(b.x - p.x, b.y - p.y);
      // normal media; en esquinas muy cerradas se limita (como un inglete) para que no salgan picos enormes
      let nx = n1.y + n2.y, ny = -(n1.x + n2.x); const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      const cosH = Math.max(0.35, (n1.x * n2.x + n1.y * n2.y + 1) / 2) ** 0.5, len = round || d < 0 ? d : d / cosH;
      out.push({ x: p.x - nx * len * dir, y: p.y - ny * len * dir });
    }
    // al encoger, en las puntas el contorno se cruza consigo mismo y forma bucles («colas de golondrina»): los tramos
    // que quedan al revés que el original son esos bucles y se quitan
    let pts = out, orig = q;
    for (let pass = 0; pass < 6 && d < 0; pass++) {
      const keep: { x: number; y: number }[] = [], ko: { x: number; y: number }[] = [], m = pts.length; let removed = false;
      for (let i = 0; i < m; i++) {
        const a = pts[i], b = pts[(i + 1) % m], oa = orig[i], ob = orig[(i + 1) % m];
        const flipped = (b.x - a.x) * (ob.x - oa.x) + (b.y - a.y) * (ob.y - oa.y) < 0;
        if (flipped) { removed = true; i++; continue; }   // se quitan los dos extremos del tramo invertido
        keep.push(a); ko.push(oa);
      }
      if (!removed || keep.length < 3) break;
      pts = keep; orig = ko;
    }
    return { ...sp, pts: smoothPts(pts, true, round) };
  });
}
const norm = (x: number, y: number) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };

// ---- ventana --------------------------------------------------------------------------------------------------------
const EFFECTS = [
  ['pucker', 'Fruncir y engordar'], ['roughen', 'Hacer rugoso'], ['zigzag', 'Zigzag'], ['twist', 'Retorcer'], ['round', 'Redondear esquinas'], ['offset', 'Desplazar trazado (contorno más grueso o fino)'],
] as const;
export function pathEffectsDialog() {
  const d = app.doc, l = d?.active; if (!d || !l) return;
  let base: Sub[] | null = null, isShape = false;
  if (l instanceof ShapeLayer && l.props.shape !== 'line') { const o = shapeOutline(l.props); if (o) { base = [o]; isShape = true; } }
  else if (l instanceof AdjustmentLayer && l.vmask?.subpaths?.length) base = JSON.parse(JSON.stringify(l.vmask.subpaths));
  if (!base) { app.toast('Elige una forma vectorial (rectángulo, elipse, estrella, trazado de la pluma…) o una capa con máscara vectorial. Las formas de la biblioteca: conviértelas antes en trazado.', 'warn'); return; }
  const before = l instanceof ShapeLayer ? JSON.parse(JSON.stringify(l.props)) : JSON.parse(JSON.stringify((l as AdjustmentLayer).vmask));
  const b = bounds(base), sz = Math.round(b.size);
  const v: Record<string, number> = { amount: 40, size: 3, detail: Math.max(4, Math.round(sz / 60)), wave: Math.max(6, Math.round(sz / 25)), zsize: Math.max(2, Math.round(sz / 60)), angle: 90, radius: Math.max(2, Math.round(sz / 15)), offset: Math.max(2, Math.round(sz / 40)) };
  let kind = 'pucker', smooth = true;
  const sel = h('select', {}, ...EFFECTS.map(([k, n]) => h('option', { value: k }, n))) as HTMLSelectElement;
  const smoothCb = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const s = (key: string, min: number, max: number, unit = '') => numberSlider({ min, max, value: v[key], unit, onInput: x => { v[key] = x; apply(); } }).el;
  const rows: Record<string, HTMLElement[]> = {
    pucker: [row('Cantidad (− fruncir, + engordar)', numberSlider({ min: -100, max: 100, value: v.amount, unit: '%', onInput: x => { v.amount = x; apply(); } }).el)],
    roughen: [row('Tamaño', s('size', 0, 25, '%')), row('Un punto cada', s('detail', 1, 200, 'px'))],
    zigzag: [row('Altura', s('zsize', 0, 200, 'px')), row('Una onda cada', s('wave', 2, 400, 'px'))],
    twist: [row('Ángulo', s('angle', -720, 720, '°'))],
    round: [row('Radio', s('radius', 0, 500, 'px'))],
    offset: [row('Distancia (− encoger)', numberSlider({ min: -300, max: 300, value: v.offset, unit: 'px', onInput: x => { v.offset = x; apply(); } }).el)],
  };
  const smoothRow = row('', h('label', { class: 'check' }, smoothCb, ' Suave (curvas)')), box = h('div', {});
  const result = (): Sub[] => kind === 'pucker' ? puckerBloat(base!, v.amount / 100) : kind === 'roughen' ? roughen(base!, v.size, v.detail, smooth) : kind === 'zigzag' ? zigzag(base!, v.zsize, v.wave, smooth) : kind === 'twist' ? twist(base!, v.angle) : kind === 'round' ? roundCorners(base!, v.radius) : offsetPath(base!, v.offset, smooth);
  const apply = () => {
    const r = result();
    if (l instanceof ShapeLayer) { l.props = { ...JSON.parse(JSON.stringify(before)), shape: 'path', path: { closed: r[0].closed, pts: r[0].pts } }; l.render(); }
    else (l as AdjustmentLayer).vmask = { ...(l as AdjustmentLayer).vmask!, subpaths: r };
    d.invalidate(); app.viewport.requestRender();
  };
  const show = () => { box.innerHTML = ''; box.append(...rows[kind]); smoothRow.style.display = kind === 'roughen' || kind === 'zigzag' || kind === 'offset' ? '' : 'none'; apply(); };
  sel.onchange = () => { kind = sel.value; show(); };
  smoothCb.onchange = () => { smooth = smoothCb.checked; apply(); };
  void isShape;
  showDialog({ title: 'Efectos de trazado', width: 400, side: true, okLabel: 'Aplicar',
    body: [h('div', { class: 'hint' }, 'Deforma el contorno de la forma. El resultado sigue siendo vectorial: se puede escalar y editar con la pluma.'), row('Efecto', sel), box, smoothRow],
    onOk: () => { apply(); d.commit('Efecto de trazado: ' + (EFFECTS.find(e => e[0] === kind)?.[1] ?? '')); },
    onCancel: () => { if (l instanceof ShapeLayer) { l.props = before; l.render(); } else (l as AdjustmentLayer).vmask = before; d.invalidate(); app.viewport.requestRender(); } });
  show();
}
