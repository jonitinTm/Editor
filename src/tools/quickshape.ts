// Forma rápida: al terminar un trazo a mano alzada y mantener el dedo o el lápiz quieto un momento,
// el trazo se convierte en la forma «perfecta» que se quería dibujar: línea recta, círculo/elipse, rectángulo o triángulo.
export type Pt = { x: number; y: number };
export type ShapeKind = 'line' | 'ellipse' | 'rect' | 'triangle' | 'polyline';
export interface FitShape { kind: ShapeKind; pts: Pt[]; name: string }

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
function pathLen(p: Pt[]) { let L = 0; for (let i = 1; i < p.length; i++) L += dist(p[i - 1], p[i]); return L; }
function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
/** Simplificación de Ramer-Douglas-Peucker (para encontrar las esquinas). */
function rdp(p: Pt[], eps: number): Pt[] {
  if (p.length < 3) return p.slice();
  let idx = 0, md = 0;
  for (let i = 1; i < p.length - 1; i++) { const d = segDist(p[i], p[0], p[p.length - 1]); if (d > md) { md = d; idx = i; } }
  if (md <= eps) return [p[0], p[p.length - 1]];
  const a = rdp(p.slice(0, idx + 1), eps), b = rdp(p.slice(idx), eps);
  return a.slice(0, -1).concat(b);
}
/** Puntos de una elipse girada (centro, semiejes, ángulo). */
function ellipsePts(cx: number, cy: number, a: number, b: number, ang: number, n = 96): Pt[] {
  const out: Pt[] = [], c = Math.cos(ang), s = Math.sin(ang);
  for (let i = 0; i <= n; i++) { const t = (i / n) * Math.PI * 2, x = a * Math.cos(t), y = b * Math.sin(t); out.push({ x: cx + x * c - y * s, y: cy + x * s + y * c }); }
  return out;
}

/** Ajusta la forma del trazo. Devuelve null si no se parece a nada claro (el trazo se queda como está).
 *  `minSize` es el tamaño mínimo en píxeles del documento para considerar una forma. */
export function fitShape(raw: Pt[], minSize = 8): FitShape | null {
  if (raw.length < 4) return null;
  const L = pathLen(raw); if (L < minSize * 2) return null;
  const a = raw[0], z = raw[raw.length - 1];
  // ¿línea recta? casi todos los puntos cerca de la recta entre principio y final
  const chord = dist(a, z);
  if (chord > L * 0.82) {
    let md = 0; for (const p of raw) md = Math.max(md, segDist(p, a, z));
    if (md < Math.max(3, chord * 0.09)) return { kind: 'line', pts: [a, z], name: 'línea' };
  }
  const closed = chord < Math.max(minSize, L * 0.18);
  const simple = rdp(raw, Math.max(3, L * 0.035));
  if (closed) {
    // cerrar: el final vuelve al principio
    let corners = simple.slice(); if (corners.length > 2 && dist(corners[0], corners[corners.length - 1]) < L * 0.18) corners = corners.slice(0, -1);
    // elipse: centro y ejes por momentos (vale para elipses giradas)
    let cx = 0, cy = 0; for (const p of raw) { cx += p.x; cy += p.y; } cx /= raw.length; cy /= raw.length;
    let sxx = 0, syy = 0, sxy = 0; for (const p of raw) { const dx = p.x - cx, dy = p.y - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    sxx /= raw.length; syy /= raw.length; sxy /= raw.length;
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const c = Math.cos(ang), s = Math.sin(ang);
    let ea = 0, eb = 0; for (const p of raw) { const dx = p.x - cx, dy = p.y - cy; ea = Math.max(ea, Math.abs(dx * c + dy * s)); eb = Math.max(eb, Math.abs(-dx * s + dy * c)); }
    // los ejes se estiman con la media de la distancia (menos sensible a un punto que se escapa)
    let ma = 0, mb = 0; for (const p of raw) { const dx = p.x - cx, dy = p.y - cy; ma += (dx * c + dy * s) ** 2; mb += (-dx * s + dy * c) ** 2; }
    ea = Math.sqrt(2 * ma / raw.length); eb = Math.sqrt(2 * mb / raw.length);
    let errE = 0; for (const p of raw) { const dx = p.x - cx, dy = p.y - cy, u = (dx * c + dy * s) / ea, v = (-dx * s + dy * c) / eb; errE += Math.abs(Math.hypot(u, v) - 1); } errE /= raw.length;
    const polyErr = (poly: Pt[]) => { let e = 0; for (const p of raw) { let m = Infinity; for (let i = 0; i < poly.length; i++) m = Math.min(m, segDist(p, poly[i], poly[(i + 1) % poly.length])); e += m; } return e / raw.length / Math.max(1, Math.sqrt(ea * eb)); };
    if (corners.length === 3) { const e = polyErr(corners); if (e < 0.08 && e < errE) return { kind: 'triangle', pts: [...corners, corners[0]], name: 'triángulo' }; }
    if (corners.length === 4) {
      // rectángulo: ejes del propio dibujo (puede estar girado); se ajusta a un rectángulo perfecto
      const e = polyErr(corners);
      if (e < 0.09 && e < errE) {
        const g = Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x), gc = Math.cos(g), gs = Math.sin(g);
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (const p of corners) { const u = p.x * gc + p.y * gs, v = -p.x * gs + p.y * gc; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
        // casi horizontal: se endereza del todo
        let G = g; const snap = Math.round(g / (Math.PI / 2)) * (Math.PI / 2); if (Math.abs(g - snap) < 0.09) G = snap;
        const Gc = Math.cos(G), Gs = Math.sin(G);
        const P = (u: number, v: number) => ({ x: u * Gc - v * Gs, y: u * Gs + v * Gc });
        if (G !== g) { u0 = Infinity; u1 = -Infinity; v0 = Infinity; v1 = -Infinity; for (const p of corners) { const u = p.x * Gc + p.y * Gs, v = -p.x * Gs + p.y * Gc; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); } }
        return { kind: 'rect', pts: [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1), P(u0, v0)], name: 'rectángulo' };
      }
    }
    if (errE < 0.16) {
      // casi un círculo: círculo perfecto
      if (Math.min(ea, eb) / Math.max(ea, eb) > 0.86) { const r = (ea + eb) / 2; return { kind: 'ellipse', pts: ellipsePts(cx, cy, r, r, 0), name: 'círculo' }; }
      return { kind: 'ellipse', pts: ellipsePts(cx, cy, ea, eb, ang), name: 'elipse' };
    }
    return null;
  }
  // abierta con pocas esquinas claras: línea quebrada recta (p. ej. una «V» o una «L»)
  if (simple.length >= 3 && simple.length <= 5) {
    let md = 0; for (const p of raw) { let m = Infinity; for (let i = 1; i < simple.length; i++) m = Math.min(m, segDist(p, simple[i - 1], simple[i])); md = Math.max(md, m); }
    if (md < Math.max(3, L * 0.04)) return { kind: 'polyline', pts: simple, name: 'líneas rectas' };
  }
  return null;
}
