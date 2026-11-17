// Deformación con malla (Edición › Transformar › Deformar): un parche Bézier de 4×4 puntos de control,
// como el de Photoshop. Aquí están las cuentas y el dibujado; la interacción vive en transform.ts.
import { makeCanvas } from '../core/canvas';

export interface P { x: number; y: number }

const bern = (t: number) => { const s = 1 - t; return [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t]; };

/** Punto del parche para (u, v) en [0, 1]². */
export function meshPoint(m: P[], u: number, v: number): P {
  const bu = bern(u), bv = bern(v); let x = 0, y = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const w = bu[i] * bv[j], p = m[j * 4 + i]; x += p.x * w; y += p.y * w; }
  return { x, y };
}
/** Pesos de cada punto de control en (u, v). */
export function meshWeights(u: number, v: number) { const bu = bern(u), bv = bern(v), w: number[] = []; for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) w.push(bu[i] * bv[j]); return w; }

/** Malla plana a partir de las cuatro esquinas (sup-izq, sup-der, inf-der, inf-izq). */
export function meshFromQuad(q: P[]): P[] {
  const m: P[] = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const u = i / 3, v = j / 3;
    const top = { x: q[0].x + (q[1].x - q[0].x) * u, y: q[0].y + (q[1].y - q[0].y) * u }, bot = { x: q[3].x + (q[2].x - q[3].x) * u, y: q[3].y + (q[2].y - q[3].y) * u };
    m.push({ x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v });
  }
  return m;
}

/** Estilos predefinidos (como los de Photoshop): devuelven la malla deformada a partir de la caja. */
export const WARP_STYLES: Record<string, string> = { none: 'Personalizada', arc: 'Arco', arcLower: 'Arco inferior', arcUpper: 'Arco superior', bulge: 'Abultamiento', flag: 'Bandera', wave: 'Onda', fish: 'Pez', rise: 'Ascender', inflate: 'Inflar', squeeze: 'Comprimir', twist: 'Giro' };
export function styledMesh(style: string, box: { x: number; y: number; w: number; h: number }, bend: number): P[] {
  const k = bend / 100, { x, y, w, h } = box;
  const m: P[] = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const u = i / 3, v = j / 3, cu = u - 0.5, cv = v - 0.5;
    let dx = 0, dy = 0;
    const mid = (i === 1 || i === 2) ? 1 : 0, midV = (j === 1 || j === 2) ? 1 : 0;
    switch (style) {
      case 'arc': dy = -k * h * 0.5 * (1 - 4 * cu * cu) * 1.33; break;
      case 'arcLower': dy = j === 3 ? k * h * 0.5 * (mid ? 1.33 : 0) : j === 2 ? k * h * 0.17 * mid : 0; break;
      case 'arcUpper': dy = j === 0 ? -k * h * 0.5 * (mid ? 1.33 : 0) : j === 1 ? -k * h * 0.17 * mid : 0; break;
      case 'bulge': dy = mid ? (j === 0 ? -1 : j === 3 ? 1 : 0) * k * h * 0.45 : 0; break;
      case 'flag': dy = (i === 1 ? -1 : i === 2 ? 1 : 0) * k * h * 0.5; break;
      case 'wave': dy = (i === 1 ? -1 : i === 2 ? 1 : 0) * k * h * 0.5 * (j === 0 || j === 3 ? 1 : 0.4) * (j < 2 ? 1 : 1); dx = 0; break;
      case 'fish': dy = (j === 0 ? -1 : j === 3 ? 0.3 : -0.3) * k * h * 0.5 * (mid ? 1 : 0); break;
      case 'rise': dy = -k * h * 0.5 * (2 * u - 1) * (1 - Math.abs(cv)); break;
      case 'inflate': dx = mid ? 0 : (i === 0 ? -1 : 1) * k * w * 0.35 * midV; dy = midV ? 0 : (j === 0 ? -1 : 1) * k * h * 0.45 * mid; break;
      case 'squeeze': dx = (i === 0 ? 1 : i === 3 ? -1 : 0) * k * w * 0.3 * midV; dy = (j === 0 ? 1 : j === 3 ? -1 : 0) * k * h * 0.3 * mid; break;
      case 'twist': { const a = k * Math.PI / 3 * (1 - 2 * Math.hypot(cu, cv)); const ca = Math.cos(a), sa = Math.sin(a); dx = (cu * ca - cv * sa - cu) * w; dy = (cu * sa + cv * ca - cv) * h; break; }
    }
    m.push({ x: x + u * w + dx, y: y + v * h + dy });
  }
  return m;
}

/** (u, v) aproximado del punto (x, y) dentro del parche, o null si cae fuera. */
export function meshInverse(m: P[], x: number, y: number): { u: number; v: number } | null {
  const N = 24; let best = Infinity, bu = 0, bv = 0;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const p = meshPoint(m, i / N, j / N), d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < best) { best = d; bu = i / N; bv = j / N; } }
  // refinado local
  let step = 1 / N;
  for (let it = 0; it < 12; it++) {
    step /= 2;
    for (const [du, dv] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const u = Math.min(1, Math.max(0, bu + du)), v = Math.min(1, Math.max(0, bv + dv)), p = meshPoint(m, u, v), d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < best) { best = d; bu = u; bv = v; }
    }
  }
  return best < 4 ? { u: bu, v: bv } : null;
}

/** Arrastre de la superficie: mueve los puntos de control para que el punto (u, v) siga al ratón. */
export function dragSurface(m0: P[], u: number, v: number, dx: number, dy: number): P[] {
  const w = meshWeights(u, v), s = w.reduce((a, b) => a + b * b, 0) || 1;
  // las esquinas se quedan donde están (como en Photoshop)
  const corner = new Set([0, 3, 12, 15]);
  const ss = w.reduce((a, b, k) => a + (corner.has(k) ? 0 : b * b), 0) || s;
  return m0.map((p, k) => corner.has(k) ? { ...p } : { x: p.x + dx * w[k] / ss, y: p.y + dy * w[k] / ss });
}

/** Rejilla de puntos del parche para dibujar (N×N celdas). */
function grid(m: P[], N: number) {
  const pts: P[][] = [];
  for (let j = 0; j <= N; j++) { const row: P[] = []; for (let i = 0; i <= N; i++) row.push(meshPoint(m, i / N, j / N)); pts.push(row); }
  return pts;
}

/** Vista previa rápida: triángulos con transformaciones afines del lienzo. */
export function drawMesh(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, ox: number, oy: number, U: { w: number; h: number }, m: P[], N = 20) {
  const pts = grid(m, N), cw = U.w / N, ch = U.h / N;
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const tri = (s0: P, s1: P, s2: P, d0: P, d1: P, d2: P) => {
    const det = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y); if (Math.abs(det) < 1e-9) return;
    const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / det, c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / det;
    const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / det, d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / det;
    const e = d0.x - a * s0.x - c * s0.y, f = d0.y - b * s0.x - d * s0.y;
    const cx = (d0.x + d1.x + d2.x) / 3, cy = (d0.y + d1.y + d2.y) / 3, grow = (q: P) => { const l = Math.hypot(q.x - cx, q.y - cy) || 1; return { x: q.x + (q.x - cx) / l * 1.2, y: q.y + (q.y - cy) / l * 1.2 }; };
    const [g0, g1, g2] = [grow(d0), grow(d1), grow(d2)];
    ctx.save(); ctx.beginPath(); ctx.moveTo(g0.x, g0.y); ctx.lineTo(g1.x, g1.y); ctx.lineTo(g2.x, g2.y); ctx.closePath(); ctx.clip();
    ctx.transform(a, b, c, d, e, f); ctx.drawImage(img, 0, 0); ctx.restore();
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x0 = i * cw, y0 = j * ch;
    if (x0 + cw < ox - cw || x0 > ox + img.width + cw || y0 + ch < oy - ch || y0 > oy + img.height + ch) continue;
    const s00 = { x: x0 - ox, y: y0 - oy }, s10 = { x: x0 + cw - ox, y: y0 - oy }, s11 = { x: x0 + cw - ox, y: y0 + ch - oy }, s01 = { x: x0 - ox, y: y0 + ch - oy };
    tri(s00, s10, s11, pts[j][i], pts[j][i + 1], pts[j + 1][i + 1]);
    tri(s00, s11, s01, pts[j][i], pts[j + 1][i + 1], pts[j + 1][i]);
  }
  ctx.restore();
}

/** Resultado final, píxel a píxel (sin costuras): cada triángulo se rasteriza y se muestrea con interpolación bilineal. */
export function drawMeshExact(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, ox: number, oy: number, U: { w: number; h: number }, m: P[], N = 48) {
  const W = ctx.canvas.width, H = ctx.canvas.height, pts = grid(m, N);
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const row of pts) for (const p of row) { bx0 = Math.min(bx0, p.x); by0 = Math.min(by0, p.y); bx1 = Math.max(bx1, p.x); by1 = Math.max(by1, p.y); }
  const x0 = Math.max(0, Math.floor(bx0)), y0 = Math.max(0, Math.floor(by0)), x1 = Math.min(W, Math.ceil(bx1)), y1 = Math.min(H, Math.ceil(by1));
  const bw = x1 - x0, bh = y1 - y0; if (bw < 1 || bh < 1 || img.width < 1 || img.height < 1) return;
  const sw = img.width, sh = img.height, src = img.getContext('2d')!.getImageData(0, 0, sw, sh).data;
  const out = new ImageData(bw, bh), o = out.data, done = new Uint8Array(bw * bh);
  const cw = U.w / N, ch = U.h / N;
  const tri = (s0: P, s1: P, s2: P, d0: P, d1: P, d2: P) => {
    const den = (d1.y - d2.y) * (d0.x - d2.x) + (d2.x - d1.x) * (d0.y - d2.y); if (Math.abs(den) < 1e-12) return;
    const tx0 = Math.max(x0, Math.floor(Math.min(d0.x, d1.x, d2.x))), tx1 = Math.min(x1, Math.ceil(Math.max(d0.x, d1.x, d2.x)));
    const ty0 = Math.max(y0, Math.floor(Math.min(d0.y, d1.y, d2.y))), ty1 = Math.min(y1, Math.ceil(Math.max(d0.y, d1.y, d2.y)));
    const eps = -1e-6;
    for (let Y = ty0; Y < ty1; Y++) for (let X = tx0; X < tx1; X++) {
      const k = (Y - y0) * bw + (X - x0); if (done[k]) continue;
      const px = X + 0.5, py = Y + 0.5;
      const l0 = ((d1.y - d2.y) * (px - d2.x) + (d2.x - d1.x) * (py - d2.y)) / den, l1 = ((d2.y - d0.y) * (px - d2.x) + (d0.x - d2.x) * (py - d2.y)) / den, l2 = 1 - l0 - l1;
      if (l0 < eps || l1 < eps || l2 < eps) continue;
      done[k] = 1;
      const sx = l0 * s0.x + l1 * s1.x + l2 * s2.x - 0.5, sy = l0 * s0.y + l1 * s1.y + l2 * s2.y - 0.5;
      const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
      let r = 0, g = 0, b = 0, al = 0;
      for (let q = 0; q < 4; q++) {
        const qx = ix + (q & 1), qy = iy + (q >> 1); if (qx < 0 || qy < 0 || qx >= sw || qy >= sh) continue;
        const wt = ((q & 1) ? fx : 1 - fx) * ((q >> 1) ? fy : 1 - fy), j = (qy * sw + qx) * 4, aa = src[j + 3] * wt;
        r += src[j] * aa; g += src[j + 1] * aa; b += src[j + 2] * aa; al += aa;
      }
      if (al <= 0) continue;
      const z = k * 4; o[z] = r / al; o[z + 1] = g / al; o[z + 2] = b / al; o[z + 3] = al;
    }
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const sx0 = i * cw - ox, sy0 = j * ch - oy;
    if (sx0 + cw < -1 || sx0 > sw + 1 || sy0 + ch < -1 || sy0 > sh + 1) continue;
    const s00 = { x: sx0, y: sy0 }, s10 = { x: sx0 + cw, y: sy0 }, s11 = { x: sx0 + cw, y: sy0 + ch }, s01 = { x: sx0, y: sy0 + ch };
    tri(s00, s10, s11, pts[j][i], pts[j][i + 1], pts[j + 1][i + 1]);
    tri(s00, s11, s01, pts[j][i], pts[j + 1][i + 1], pts[j + 1][i]);
  }
  const t = makeCanvas(bw, bh); t.getContext('2d')!.putImageData(out, 0, 0);
  ctx.drawImage(t, x0, y0);
}
