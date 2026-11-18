// Contorno de una máscara (para «Selección a trazado»): cuadrados en marcha sobre la máscara
// binarizada, unión de los tramos en lazos cerrados y simplificación de Douglas-Peucker.

type P = { x: number; y: number };

/** Lazos del contorno (en coordenadas del documento) de los píxeles con alfa >= 128. */
export function maskContours(mask: HTMLCanvasElement, eps = 1.2): P[][] {
  const w = mask.width, h = mask.height;
  const a = mask.getContext('2d')!.getImageData(0, 0, w, h).data;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && a[(y * w + x) * 4 + 3] >= 128 ? 1 : 0;
  // puntos medios de los lados de cada celda, con coordenadas dobladas para que sean enteras
  const W2 = 2 * w + 4;
  const key = (x2: number, y2: number) => (y2 + 2) * W2 + (x2 + 2);
  const segA: number[] = [], segB: number[] = [];
  for (let y = -1; y < h; y++) for (let x = -1; x < w; x++) {
    const tl = inside(x, y), tr = inside(x + 1, y), br = inside(x + 1, y + 1), bl = inside(x, y + 1);
    const c = tl * 8 + tr * 4 + br * 2 + bl;
    if (c === 0 || c === 15) continue;
    const T = key(2 * x + 1, 2 * y), R = key(2 * x + 2, 2 * y + 1), B = key(2 * x + 1, 2 * y + 2), L = key(2 * x, 2 * y + 1);
    const add = (p: number, q: number) => { segA.push(p); segB.push(q); };
    switch (c) {
      case 1: case 14: add(L, B); break;
      case 2: case 13: add(B, R); break;
      case 3: case 12: add(L, R); break;
      case 4: case 11: add(T, R); break;
      case 6: case 9: add(T, B); break;
      case 7: case 8: add(T, L); break;
      case 5: add(T, R); add(L, B); break;
      case 10: add(T, L); add(B, R); break;
    }
  }
  // cada punto medio lo comparten exactamente dos tramos: se encadenan
  const at = new Map<number, number[]>();
  for (let i = 0; i < segA.length; i++) for (const k of [segA[i], segB[i]]) { const l = at.get(k); if (l) l.push(i); else at.set(k, [i]); }
  const used = new Uint8Array(segA.length), loops: P[][] = [];
  const toP = (k: number): P => ({ x: (k % W2 - 2) / 2 + 0.5, y: (Math.floor(k / W2) - 2) / 2 + 0.5 });
  for (let s = 0; s < segA.length; s++) {
    if (used[s]) continue;
    const pts: P[] = []; let cur = s, from = segA[s];
    for (;;) {
      used[cur] = 1; pts.push(toP(from));
      const next = segA[cur] === from ? segB[cur] : segA[cur];
      const cand = at.get(next)!.find(i => !used[i]);
      if (cand === undefined) break;
      from = next; cur = cand;
    }
    if (pts.length >= 4) loops.push(simplify(pts, eps));
  }
  // se descartan las motas diminutas
  return loops.filter(l => l.length >= 3 && Math.abs(area(l)) >= 4);
}

function area(p: P[]) { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j].x + p[i].x) * (p[j].y - p[i].y); return s / 2; }

/** Douglas-Peucker sobre un lazo cerrado. */
function simplify(p: P[], eps: number): P[] {
  if (p.length < 8) return p;
  // se parte el lazo por el punto más alejado del primero
  let far = 0, fd = -1; for (let i = 1; i < p.length; i++) { const d = (p[i].x - p[0].x) ** 2 + (p[i].y - p[0].y) ** 2; if (d > fd) { fd = d; far = i; } }
  const rdp = (pts: P[]): P[] => {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    let idx = 0, md = 0;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / L; if (d > md) { md = d; idx = i; } }
    if (md <= eps) return [a, b];
    const l = rdp(pts.slice(0, idx + 1)), r = rdp(pts.slice(idx));
    return [...l.slice(0, -1), ...r];
  };
  const A = rdp(p.slice(0, far + 1)), B = rdp([...p.slice(far), p[0]]);
  return [...A.slice(0, -1), ...B.slice(0, -1)];
}
