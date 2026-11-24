// Desenfoque gaussiano aproximado con tres pasadas de desenfoque de caja
// (rápido incluso en imágenes grandes). Trabaja con alfa premultiplicado
// para que los bordes transparentes no se oscurezcan.

function boxSizes(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}

function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  // mismas sumas que antes, pero sin comprobar los bordes en cada píxel: tramo inicial, central y final por separado
  const a = Math.min(w, r + 1), b = Math.max(a, w - r);
  for (let y = 0; y < h; y++) {
    const row = y * w, first = src[row], lastI = row + w - 1;
    let acc = (r + 1) * first;
    for (let j = 0; j < r; j++) acc += src[row + Math.min(j, w - 1)];
    let x = 0;
    for (; x < a; x++) { acc += src[Math.min(row + x + r, lastI)] - first; dst[row + x] = acc * iarr; }
    for (; x < b; x++) { acc += src[row + x + r] - src[row + x - r - 1]; dst[row + x] = acc * iarr; }
    for (; x < w; x++) { acc += src[lastI] - src[row + x - r - 1]; dst[row + x] = acc * iarr; }
  }
}
// Pasada vertical fila a fila (todas las columnas a la vez): recorre la memoria en orden, mucho más rápido que ir
// columna por columna en imágenes anchas. Cada columna hace exactamente las mismas sumas en el mismo orden.
let accBuf = new Float64Array(0);
function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  if (accBuf.length < w) accBuf = new Float64Array(w);
  const acc = accBuf;
  for (let x = 0; x < w; x++) acc[x] = (r + 1) * src[x];
  for (let j = 0; j < r; j++) { const o = Math.min(j, h - 1) * w; for (let x = 0; x < w; x++) acc[x] += src[o + x]; }
  for (let y = 0; y < h; y++) {
    const add = Math.min(y + r, h - 1) * w, out = y * w;
    if (y - r - 1 >= 0) { const sub = (y - r - 1) * w; for (let x = 0; x < w; x++) { acc[x] += src[add + x] - src[sub + x]; dst[out + x] = acc[x] * iarr; } }
    else for (let x = 0; x < w; x++) { acc[x] += src[add + x] - src[x]; dst[out + x] = acc[x] * iarr; }
  }
}

export function blurChannel(ch: Float32Array, tmp: Float32Array, w: number, h: number, sigma: number) {
  for (const s of boxSizes(sigma, 3)) {
    const r = (s - 1) / 2;
    boxBlurH(ch, tmp, w, h, r);
    boxBlurV(tmp, ch, w, h, r);
  }
}

/** Desenfoca la imagen en el sitio. `alphaOnly` = solo el canal alfa (máscaras). */
export function gaussianBlur(img: ImageData, radius: number, alphaOnly = false) {
  if (radius <= 0) return;
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const sigma = radius;
  const tmp = new Float32Array(n);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = d[i * 4 + 3];
  if (alphaOnly) {
    blurChannel(a, tmp, w, h, sigma);
    for (let i = 0; i < n; i++) d[i * 4 + 3] = a[i];
    return;
  }
  let opaque = true;
  for (let i = 0; i < n; i++) if (a[i] !== 255) { opaque = false; break; }
  const chans = [0, 1, 2].map(c => {
    const ch = new Float32Array(n);
    if (opaque) for (let i = 0; i < n; i++) ch[i] = d[i * 4 + c]; // ×255/255: el mismo valor
    else for (let i = 0; i < n; i++) ch[i] = d[i * 4 + c] * a[i] / 255; // premultiplicar
    return ch;
  });
  for (const ch of chans) blurChannel(ch, tmp, w, h, sigma);
  if (opaque) {
    // imagen sin transparencia: el alfa desenfocado sale igual en todos los píxeles; se calcula en un trozo pequeño
    // con las mismas operaciones (mismo valor exacto) en vez de desenfocar todo el canal
    const k = new Float32Array(9).fill(255), kt = new Float32Array(9); blurChannel(k, kt, 3, 3, sigma); a.fill(k[4]);
  } else blurChannel(a, tmp, w, h, sigma);
  for (let i = 0; i < n; i++) {
    const al = a[i];
    d[i * 4 + 3] = al;
    if (al > 0.001) for (let c = 0; c < 3; c++) d[i * 4 + c] = chans[c][i] * 255 / al;
  }
}
