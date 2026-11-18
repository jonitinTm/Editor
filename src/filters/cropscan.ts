// Recortar y enderezar fotos escaneadas: separa las fotos de un escaneo (que se distinguen del fondo del
// escáner) y calcula para cada una el rectángulo girado que mejor la encierra.

export interface ScanPiece { cx: number; cy: number; w: number; h: number; angle: number }

export function findScannedPhotos(src: HTMLCanvasElement): ScanPiece[] {
  const W = src.width, H = src.height, k = Math.min(1, 700 / Math.max(W, H));
  const w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k)), n = w * h;
  const t = document.createElement('canvas'); t.width = w; t.height = h;
  const x = t.getContext('2d')!; x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  // color del fondo: la mediana del borde
  const border: number[][] = [];
  for (let i = 0; i < w; i++) { border.push([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]); const j = ((h - 1) * w + i) * 4; border.push([d[j], d[j + 1], d[j + 2]]); }
  for (let i = 0; i < h; i++) { const a = i * w * 4, b = (i * w + w - 1) * 4; border.push([d[a], d[a + 1], d[a + 2]], [d[b], d[b + 1], d[b + 2]]); }
  const med = [0, 1, 2].map(c => { const v = border.map(p => p[c]).sort((p, q) => p - q); return v[v.length >> 1]; });
  // lo que se aparta del fondo (o tiene textura) es foto
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const dr = d[i * 4] - med[0], dg = d[i * 4 + 1] - med[1], db = d[i * 4 + 2] - med[2]; if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) > 45) m[i] = 1; }
  // cierre: rellena huecos pequeños dentro de cada foto
  const dil = (src: Uint8Array, val: number) => { const o = new Uint8Array(n); for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) { let v = val ? 0 : 1; for (let dy = -2; dy <= 2 && (val ? !v : v); dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + dy, x2 = xx + dx; if (yy < 0 || x2 < 0 || yy >= h || x2 >= w) continue; if (val ? src[yy * w + x2] : !src[yy * w + x2]) { v = val ? 1 : 0; break; } } o[y * w + xx] = v; } return o; };
  const closed = dil(dil(m, 1), 0);
  // componentes conexas
  const lab = new Int32Array(n).fill(-1), pieces: ScanPiece[] = [];
  for (let s = 0; s < n; s++) {
    if (!closed[s] || lab[s] >= 0) continue;
    const pts: number[] = [s]; lab[s] = s;
    for (let q = 0; q < pts.length; q++) { const i = pts[q], px = i % w, py = (i - px) / w; for (const j of [px > 0 ? i - 1 : -1, px < w - 1 ? i + 1 : -1, py > 0 ? i - w : -1, py < h - 1 ? i + w : -1]) if (j >= 0 && closed[j] && lab[j] < 0) { lab[j] = s; pts.push(j); } }
    if (pts.length < n * 0.01) continue;
    // ángulo con el rectángulo de menor área (de -45° a 45°)
    const step = Math.max(1, Math.floor(pts.length / 4000)), P: [number, number][] = [];
    for (let q = 0; q < pts.length; q += step) { const i = pts[q]; P.push([i % w, Math.floor(i / w)]); }
    let best = { area: Infinity, a: 0, x0: 0, y0: 0, x1: 0, y1: 0 };
    for (let deg = -45; deg <= 45; deg += 0.5) {
      const a = deg * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const [px, py] of P) { const u = px * c + py * sn, v = -px * sn + py * c; if (u < x0) x0 = u; if (u > x1) x1 = u; if (v < y0) y0 = v; if (v > y1) y1 = v; }
      const area = (x1 - x0) * (y1 - y0); if (area < best.area - 1e-6) best = { area, a, x0, y0, x1, y1 };
    }
    const { a, x0, y0, x1, y1 } = best, c = Math.cos(a), sn = Math.sin(a), uc = (x0 + x1) / 2, vc = (y0 + y1) / 2;
    // centro en coordenadas de la imagen (el pixel del fondo reducido mide 1/k)
    const cxs = uc * c - vc * sn + 0.5, cys = uc * sn + vc * c + 0.5;
    pieces.push({ cx: cxs / k, cy: cys / k, w: (x1 - x0 + 1) / k, h: (y1 - y0 + 1) / k, angle: a });
  }
  // de arriba abajo y de izquierda a derecha
  return pieces.sort((p, q) => (Math.abs(p.cy - q.cy) > Math.min(p.h, q.h) / 2 ? p.cy - q.cy : p.cx - q.cx));
}
