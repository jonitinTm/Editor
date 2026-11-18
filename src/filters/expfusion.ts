// Fusión de exposiciones (tipo HDR): de cada foto se toma lo que está bien expuesto, con buen contraste y color,
// y se mezclan con pirámides (por bandas de detalle) para que no aparezcan halos ni costuras.

type Img = { w: number; h: number; c: Float32Array[] }; // canales en 0..1

function down(a: Float32Array, w: number, h: number): [Float32Array, number, number] {
  const W = Math.max(1, Math.ceil(w / 2)), H = Math.max(1, Math.ceil(h / 2)), o = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) {
      const xx = Math.min(w - 1, Math.max(0, x * 2 + dx)), yy = Math.min(h - 1, Math.max(0, y * 2 + dy)), k = (dx === 0 || dx === 1 ? 3 : 1) * (dy === 0 || dy === 1 ? 3 : 1);
      s += a[yy * w + xx] * k; n += k;
    }
    o[y * W + x] = s / n;
  }
  return [o, W, H];
}
function up(a: Float32Array, w: number, h: number, W: number, H: number): Float32Array {
  const o = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fx = Math.min(w - 1, Math.max(0, (x - 0.5) / 2)), fy = Math.min(h - 1, Math.max(0, (y - 0.5) / 2));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    o[y * W + x] = (a[y0 * w + x0] * (1 - tx) + a[y0 * w + x1] * tx) * (1 - ty) + (a[y1 * w + x0] * (1 - tx) + a[y1 * w + x1] * tx) * ty;
  }
  return o;
}

export function exposureFusion(imgs: ImageData[]): ImageData {
  const w = imgs[0].width, h = imgs[0].height, n = w * h, N = imgs.length;
  // pesos por foto
  const weights: Float32Array[] = imgs.map(im => {
    const d = im.data, wt = new Float32Array(n), L = new Float32Array(n);
    for (let i = 0; i < n; i++) L[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4;
      const lap = Math.abs(4 * L[i] - L[y * w + Math.max(0, x - 1)] - L[y * w + Math.min(w - 1, x + 1)] - L[Math.max(0, y - 1) * w + x] - L[Math.min(h - 1, y + 1) * w + x]);
      const r = d[o] / 255, g = d[o + 1] / 255, b = d[o + 2] / 255, m = (r + g + b) / 3;
      const sat = Math.sqrt(((r - m) ** 2 + (g - m) ** 2 + (b - m) ** 2) / 3);
      const ex = Math.exp(-((r - 0.5) ** 2) * 12.5) * Math.exp(-((g - 0.5) ** 2) * 12.5) * Math.exp(-((b - 0.5) ** 2) * 12.5);
      wt[i] = (lap + 0.02) * (sat + 0.05) * (ex + 1e-4) * (d[o + 3] / 255);
    }
    return wt;
  });
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < N; k++) s += weights[k][i]; s = s || 1; for (let k = 0; k < N; k++) weights[k][i] /= s; }
  const levels = Math.max(1, Math.min(8, Math.floor(Math.log2(Math.min(w, h))) - 2));
  // pirámide resultado por canal
  const out: Float32Array[][] = [[], [], []];
  const sizes: [number, number][] = [[w, h]];
  for (let l = 1; l < levels; l++) { const [pw, ph] = sizes[l - 1]; sizes.push([Math.max(1, Math.ceil(pw / 2)), Math.max(1, Math.ceil(ph / 2))]); }
  for (let k = 0; k < N; k++) {
    // pirámide gaussiana de los pesos
    const G: Float32Array[] = [weights[k]];
    for (let l = 1; l < levels; l++) G.push(down(G[l - 1], sizes[l - 1][0], sizes[l - 1][1])[0]);
    for (let c = 0; c < 3; c++) {
      let cur = new Float32Array(n); const d = imgs[k].data; for (let i = 0; i < n; i++) cur[i] = d[i * 4 + c] / 255;
      // pirámide laplaciana de la imagen
      for (let l = 0; l < levels; l++) {
        const [cw, ch] = sizes[l];
        let lapL: Float32Array, next: Float32Array | null = null;
        if (l < levels - 1) { next = down(cur, cw, ch)[0]; const u = up(next, sizes[l + 1][0], sizes[l + 1][1], cw, ch); lapL = new Float32Array(cw * ch); for (let i = 0; i < cw * ch; i++) lapL[i] = cur[i] - u[i]; }
        else lapL = cur;
        const acc = out[c][l] ??= new Float32Array(cw * ch), g = G[l];
        for (let i = 0; i < cw * ch; i++) acc[i] += lapL[i] * g[i];
        if (next) cur = next;
      }
    }
  }
  // se reconstruye de lo más grueso a lo más fino
  const res = new ImageData(w, h), o = res.data;
  for (let c = 0; c < 3; c++) {
    let cur = out[c][levels - 1];
    for (let l = levels - 2; l >= 0; l--) { const [cw, ch] = sizes[l], u = up(cur, sizes[l + 1][0], sizes[l + 1][1], cw, ch), L = out[c][l]; for (let i = 0; i < cw * ch; i++) u[i] += L[i]; cur = u; }
    for (let i = 0; i < n; i++) o[i * 4 + c] = Math.max(0, Math.min(255, cur[i] * 255));
  }
  for (let i = 0; i < n; i++) o[i * 4 + 3] = 255;
  return res;
}
