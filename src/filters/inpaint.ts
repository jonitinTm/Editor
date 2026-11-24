// Relleno por parches (inpainting): reconstruye el hueco copiando trocitos de 7×7 px del resto de la imagen.
// Se busca para cada parche del hueco el parche más parecido de fuera (búsqueda aleatoria con propagación, tipo
// PatchMatch) y cada píxel se rehace como la media de los parches que lo cubren. Se hace de lo más reducido a lo
// más detallado para que las estructuras grandes (líneas, bordes) continúen bien.

const P = 3; // radio del parche (7×7)

interface Level { w: number; h: number; img: Float32Array; hole: Uint8Array }

function downLevel(L: Level): Level {
  const w = Math.max(1, L.w >> 1), h = Math.max(1, L.h >> 1), img = new Float32Array(w * h * 4), hole = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, n = 0, hh = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const xx = Math.min(L.w - 1, x * 2 + dx), yy = Math.min(L.h - 1, y * 2 + dy), i = yy * L.w + xx;
      if (L.hole[i]) { hh++; continue; }
      s0 += L.img[i * 4]; s1 += L.img[i * 4 + 1]; s2 += L.img[i * 4 + 2]; s3 += L.img[i * 4 + 3]; n++;
    }
    const o = y * w + x;
    if (hh) hole[o] = 1;
    if (n) { img[o * 4] = s0 / n; img[o * 4 + 1] = s1 / n; img[o * 4 + 2] = s2 / n; img[o * 4 + 3] = s3 / n; }
  }
  return { w, h, img, hole };
}

/** Relleno inicial del nivel más reducido: se extiende el borde hacia dentro. */
function diffuseFill(L: Level) {
  const { w, h, img } = L, known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) known[i] = L.hole[i] ? 0 : 1;
  for (let it = 0, left = 1; left && it < w + h; it++) {
    left = 0; const nk = known.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (known[i]) continue;
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, n = 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && known[j]) { s0 += img[j * 4]; s1 += img[j * 4 + 1]; s2 += img[j * 4 + 2]; s3 += img[j * 4 + 3]; n++; }
      if (n) { img[i * 4] = s0 / n; img[i * 4 + 1] = s1 / n; img[i * 4 + 2] = s2 / n; img[i * 4 + 3] = s3 / n; nk[i] = 1; } else left++;
    }
    known.set(nk);
  }
}

function solveLevel(L: Level, nnf: Int32Array, iters: number, rnd: () => number) {
  const { w, h, img, hole } = L;
  // parches válidos como origen: enteros fuera del hueco
  const valid = new Uint8Array(w * h);
  for (let y = P; y < h - P; y++) for (let x = P; x < w - P; x++) {
    let ok = 1; for (let dy = -P; dy <= P && ok; dy++) for (let dx = -P; dx <= P; dx++) if (hole[(y + dy) * w + x + dx]) { ok = 0; break; }
    valid[y * w + x] = ok;
  }
  const vlist: number[] = []; for (let i = 0; i < w * h; i++) if (valid[i]) vlist.push(i);
  if (!vlist.length) return;
  // píxeles cuyo parche toca el hueco (los que hay que resolver)
  const targets: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let t = 0; for (let dy = -P; dy <= P && !t; dy++) for (let dx = -P; dx <= P; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && xx >= 0 && yy < h && xx < w && hole[yy * w + xx]) { t = 1; break; } }
    if (t) targets.push(y * w + x);
  }
  const dist = (p: number, q: number, cut: number) => {
    const px = p % w, py = (p - px) / w, qx = q % w, qy = (q - qx) / w; let s = 0, n = 0;
    for (let dy = -P; dy <= P; dy++) { const ay = py + dy; if (ay < 0 || ay >= h) continue; for (let dx = -P; dx <= P; dx++) { const ax = px + dx; if (ax < 0 || ax >= w) continue; const a = (ay * w + ax) * 4, b = ((qy + dy) * w + qx + dx) * 4; const e0 = img[a] - img[b], e1 = img[a + 1] - img[b + 1], e2 = img[a + 2] - img[b + 2], e3 = img[a + 3] - img[b + 3]; s += e0 * e0 + e1 * e1 + e2 * e2 + e3 * e3; n++; if (s > cut * n) return Infinity; } }
    return n ? s / n : Infinity;
  };
  const cost = new Float32Array(w * h).fill(Infinity);
  for (const p of targets) { let q = nnf[p]; if (q < 0 || !valid[q]) q = vlist[(rnd() * vlist.length) | 0]; nnf[p] = q; cost[p] = dist(p, q, Infinity); }
  const acc = new Float32Array(w * h * 5);
  for (let it = 0; it < iters; it++) {
    // búsqueda: propagación desde los vecinos y búsqueda aleatoria en radios decrecientes
    const order = it % 2 ? targets.slice().reverse() : targets, dir = it % 2 ? 1 : -1;
    for (const p of order) {
      const px = p % w, py = (p - px) / w;
      for (const [nx, ny] of [[px + dir, py], [px, py + dir]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nq = nnf[ny * w + nx]; if (nq < 0) continue;
        const cand = nq - dir * (nx !== px ? 1 : w); if (cand < 0 || cand >= w * h || !valid[cand]) continue;
        const c = dist(p, cand, cost[p]); if (c < cost[p]) { cost[p] = c; nnf[p] = cand; }
      }
      let r = Math.max(w, h);
      const bq = nnf[p], bx = bq % w, by = (bq - bx) / w;
      while (r >= 1) {
        const cx = Math.round(bx + (rnd() * 2 - 1) * r), cy = Math.round(by + (rnd() * 2 - 1) * r);
        if (cx >= 0 && cy >= 0 && cx < w && cy < h) { const cand = cy * w + cx; if (valid[cand]) { const c = dist(p, cand, cost[p]); if (c < cost[p]) { cost[p] = c; nnf[p] = cand; } } }
        r = Math.floor(r / 2);
      }
    }
    // votación: cada píxel del hueco = media ponderada de lo que dicen los parches que lo cubren
    acc.fill(0);
    for (const p of targets) {
      const q = nnf[p], px = p % w, py = (p - px) / w, qx = q % w, qy = (q - qx) / w, wt = Math.exp(-cost[p] / 800);
      for (let dy = -P; dy <= P; dy++) { const ay = py + dy; if (ay < 0 || ay >= h) continue; for (let dx = -P; dx <= P; dx++) { const ax = px + dx; if (ax < 0 || ax >= w) continue; const a = ay * w + ax; if (!hole[a]) continue; const b = ((qy + dy) * w + qx + dx) * 4; acc[a * 5] += img[b] * wt; acc[a * 5 + 1] += img[b + 1] * wt; acc[a * 5 + 2] += img[b + 2] * wt; acc[a * 5 + 3] += img[b + 3] * wt; acc[a * 5 + 4] += wt; } }
    }
    for (let i = 0; i < w * h; i++) if (hole[i] && acc[i * 5 + 4] > 0) { const q = acc[i * 5 + 4]; img[i * 4] = acc[i * 5] / q; img[i * 4 + 1] = acc[i * 5 + 1] / q; img[i * 4 + 2] = acc[i * 5 + 2] / q; img[i * 4 + 3] = acc[i * 5 + 3] / q; }
    for (const p of targets) cost[p] = dist(p, nnf[p], Infinity);
  }
}

/**
 * Rellena el hueco de `img` (hole[i] = 1 donde hay que inventar). Trabaja como mucho con `maxSide` px de lado;
 * si la zona es mayor, el resultado se calcula reducido y se amplía solo dentro del hueco.
 */
export function inpaint(src: ImageData, hole: Uint8Array, maxSide = 420): ImageData {
  const W = src.width, H = src.height, k = Math.min(1, maxSide / Math.max(W, H));
  let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // nivel de trabajo
  const w0 = Math.max(8, Math.round(W * k)), h0 = Math.max(8, Math.round(H * k));
  // cuatro canales: color multiplicado por la opacidad y la opacidad (así lo transparente cuenta como transparente,
  // no como negro, y los bordes semitransparentes no se oscurecen)
  const base: Level = { w: w0, h: h0, img: new Float32Array(w0 * h0 * 4), hole: new Uint8Array(w0 * h0) };
  for (let y = 0; y < h0; y++) for (let x = 0; x < w0; x++) {
    const sx = Math.min(W - 1, Math.floor((x + 0.5) / k)), sy = Math.min(H - 1, Math.floor((y + 0.5) / k)), i = sy * W + sx, o = y * w0 + x;
    // en la reducción, un píxel es hueco si lo es cualquiera de los suyos
    let hh = 0; const r = Math.ceil(0.5 / k);
    for (let dy = -r; dy <= r && !hh; dy++) for (let dx = -r; dx <= r; dx++) { const xx = sx + dx, yy = sy + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && hole[yy * W + xx]) { hh = 1; break; } }
    base.hole[o] = hh;
    const al = src.data[i * 4 + 3] / 255;
    base.img[o * 4] = src.data[i * 4] * al; base.img[o * 4 + 1] = src.data[i * 4 + 1] * al; base.img[o * 4 + 2] = src.data[i * 4 + 2] * al; base.img[o * 4 + 3] = src.data[i * 4 + 3];
  }
  const pyr: Level[] = [base];
  while (Math.min(pyr[pyr.length - 1].w, pyr[pyr.length - 1].h) > 40) pyr.push(downLevel(pyr[pyr.length - 1]));
  diffuseFill(pyr[pyr.length - 1]);
  let nnf: Int32Array | null = null;
  for (let l = pyr.length - 1; l >= 0; l--) {
    const L = pyr[l];
    if (l < pyr.length - 1) {
      // el resultado del nivel anterior sirve de punto de partida (dentro del hueco) y su correspondencia se amplía
      const C = pyr[l + 1];
      for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) { const i = y * L.w + x; if (!L.hole[i]) continue; const j = Math.min(C.h - 1, y >> 1) * C.w + Math.min(C.w - 1, x >> 1); L.img[i * 4] = C.img[j * 4]; L.img[i * 4 + 1] = C.img[j * 4 + 1]; L.img[i * 4 + 2] = C.img[j * 4 + 2]; L.img[i * 4 + 3] = C.img[j * 4 + 3]; }
      const up = new Int32Array(L.w * L.h).fill(-1);
      if (nnf) for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) { const j = nnf[Math.min(C.h - 1, y >> 1) * C.w + Math.min(C.w - 1, x >> 1)]; if (j >= 0) { const jx = j % C.w, jy = (j - jx) / C.w; up[y * L.w + x] = Math.min(L.h - 1, jy * 2 + (y & 1)) * L.w + Math.min(L.w - 1, jx * 2 + (x & 1)); } }
      nnf = up;
    } else nnf = new Int32Array(L.w * L.h).fill(-1);
    solveLevel(L, nnf, l === 0 ? 4 : 6, rnd);
  }
  // se vuelve al tamaño original: solo cambian los píxeles del hueco
  const out = new ImageData(new Uint8ClampedArray(src.data), W, H);
  const L = pyr[0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!hole[i]) continue;
    const fx = Math.min(L.w - 1, Math.max(0, (x + 0.5) * k - 0.5)), fy = Math.min(L.h - 1, Math.max(0, (y + 0.5) * k - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(L.w - 1, x0 + 1), y1 = Math.min(L.h - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    const v = [0, 0, 0, 0];
    for (let c = 0; c < 4; c++) v[c] = (L.img[(y0 * L.w + x0) * 4 + c] * (1 - tx) + L.img[(y0 * L.w + x1) * 4 + c] * tx) * (1 - ty) + (L.img[(y1 * L.w + x0) * 4 + c] * (1 - tx) + L.img[(y1 * L.w + x1) * 4 + c] * tx) * ty;
    const al = v[3] / 255;
    for (let c = 0; c < 3; c++) out.data[i * 4 + c] = al > 0.004 ? v[c] / al : 0;
    out.data[i * 4 + 3] = v[3];
  }
  return out;
}
