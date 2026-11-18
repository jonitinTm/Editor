// Panorámica sencilla: une fotos tomadas de izquierda a derecha (o de arriba abajo) buscando el desplazamiento
// que mejor encaja cada par en su zona común, iguala la exposición y mezcla las uniones con una transición suave.
// No corrige perspectiva ni giros grandes: va bien con fotos hechas girando con cuidado o desde lejos.

const gray = (c: HTMLCanvasElement, k: number) => {
  const w = Math.max(8, Math.round(c.width * k)), h = Math.max(8, Math.round(c.height * k));
  const t = document.createElement('canvas'); t.width = w; t.height = h; const x = t.getContext('2d')!; x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
  // bordes (gradiente): menos sensibles a diferencias de exposición
  const e = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) { const i = y * w + xx; e[i] = Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w]); }
  return { e, w, h };
};
/** Diferencia media entre A y B (B desplazado dx, dy) en la zona común. */
function cost(A: { e: Float32Array; w: number; h: number }, B: typeof A, dx: number, dy: number) {
  const x0 = Math.max(0, dx), x1 = Math.min(A.w, B.w + dx), y0 = Math.max(0, dy), y1 = Math.min(A.h, B.h + dy);
  const ow = x1 - x0, oh = y1 - y0; if (ow < A.w * 0.08 || oh < A.h * 0.5) return Infinity;
  let s = 0, n = 0; const st = Math.max(1, Math.floor(Math.sqrt(ow * oh / 6000)));
  for (let y = y0; y < y1; y += st) for (let x = x0; x < x1; x += st) { s += Math.abs(A.e[y * A.w + x] - B.e[(y - dy) * B.w + x - dx]); n++; }
  return s / n - Math.min(ow / A.w, 1) * 0.5; // a igualdad, se prefiere más solape
}

export function findOffset(a: HTMLCanvasElement, b: HTMLCanvasElement, vertical = false): { dx: number; dy: number } {
  const levels = [1 / 8, 1 / 4, 1 / 2, 1].filter(k => k === 1 || Math.max(a.width, a.height) * k >= 64);
  let dx = 0, dy = 0;
  levels.forEach((k, li) => {
    const A = gray(a, k), B = gray(b, k);
    let best = Infinity, bx = Math.round(dx * k), by = Math.round(dy * k);
    if (li === 0) {
      // primer nivel: se recorre todo el solape posible (de 10 % a 95 %) y un poco de desajuste en el otro eje
      const rngA = vertical ? A.h : A.w, rngO = Math.round((vertical ? A.w : A.h) * 0.12);
      for (let t = Math.round(rngA * 0.05); t <= Math.round(rngA * 0.9); t++) for (let o = -rngO; o <= rngO; o++) {
        const x = vertical ? o : t, y = vertical ? t : o, c = cost(A, B, x, y); if (c < best) { best = c; bx = x; by = y; }
      }
    } else {
      const cx = bx, cy = by;
      for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) { const c = cost(A, B, x, y); if (c < best) { best = c; bx = x; by = y; } }
    }
    dx = bx / k; dy = by / k;
  });
  return { dx: Math.round(dx), dy: Math.round(dy) };
}

export function stitch(imgs: HTMLCanvasElement[], vertical = false): HTMLCanvasElement {
  // posiciones acumuladas
  const pos = [{ x: 0, y: 0 }];
  for (let i = 1; i < imgs.length; i++) { const o = findOffset(imgs[i - 1], imgs[i], vertical); pos.push({ x: pos[i - 1].x + o.dx, y: pos[i - 1].y + o.dy }); }
  const minX = Math.min(...pos.map(p => p.x)), minY = Math.min(...pos.map(p => p.y));
  const maxX = Math.max(...pos.map((p, i) => p.x + imgs[i].width)), maxY = Math.max(...pos.map((p, i) => p.y + imgs[i].height));
  const W = maxX - minX, H = maxY - minY;
  const acc = new Float32Array(W * H * 4), wsum = new Float32Array(W * H);
  // exposición: cada foto se ajusta para que su zona común tenga el mismo brillo que la anterior
  let gain = 1;
  const datas = imgs.map(c => c.getContext('2d')!.getImageData(0, 0, c.width, c.height));
  imgs.forEach((c, i) => {
    const d = datas[i].data, ox = pos[i].x - minX, oy = pos[i].y - minY, w = c.width, h = c.height;
    if (i > 0) {
      const p = datas[i - 1].data, pw = imgs[i - 1].width, px = pos[i - 1].x - minX, py = pos[i - 1].y - minY;
      let s1 = 0, s2 = 0;
      for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) { const gx = ox + x - px, gy = oy + y - py; if (gx < 0 || gy < 0 || gx >= pw || gy >= imgs[i - 1].height) continue; const a = (gy * pw + gx) * 4, b = (y * w + x) * 4; s1 += p[a] + p[a + 1] + p[a + 2]; s2 += d[b] + d[b + 1] + d[b + 2]; }
      // s1 es de la foto anterior sin corregir: la corrección se acumula
      if (s1 > 0 && s2 > 0) gain *= Math.max(0.5, Math.min(2, s1 / s2));
    }
    const g = i === 0 ? 1 : gain;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4; if (!d[si + 3]) continue;
      // peso: más en el centro de cada foto (transición suave en las uniones)
      const e = Math.min(x + 1, w - x, y + 1, h - y), wt = Math.min(1, e / (Math.min(w, h) * 0.15)) + 1e-3;
      const o = (oy + y) * W + ox + x;
      acc[o * 4] += d[si] * g * wt; acc[o * 4 + 1] += d[si + 1] * g * wt; acc[o * 4 + 2] += d[si + 2] * g * wt; wsum[o] += wt;
    }
  });
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const x = out.getContext('2d')!, img = x.createImageData(W, H);
  for (let i = 0; i < W * H; i++) if (wsum[i] > 0) { img.data[i * 4] = acc[i * 4] / wsum[i]; img.data[i * 4 + 1] = acc[i * 4 + 1] / wsum[i]; img.data[i * 4 + 2] = acc[i * 4 + 2] / wsum[i]; img.data[i * 4 + 3] = 255; }
  x.putImageData(img, 0, 0);
  return out;
}
