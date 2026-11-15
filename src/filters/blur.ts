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
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    const first = src[row], last = src[row + w - 1];
    acc = (r + 1) * first;
    for (let j = 0; j < r; j++) acc += src[row + Math.min(j, w - 1)];
    for (let x = 0; x < w; x++) {
      acc += src[row + Math.min(x + r, w - 1)] - (x - r - 1 >= 0 ? src[row + x - r - 1] : first);
      dst[row + x] = acc * iarr;
    }
    void last;
  }
}
function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    const first = src[x];
    let acc = (r + 1) * first;
    for (let j = 0; j < r; j++) acc += src[Math.min(j, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      acc += src[Math.min(y + r, h - 1) * w + x] - (y - r - 1 >= 0 ? src[(y - r - 1) * w + x] : first);
      dst[y * w + x] = acc * iarr;
    }
  }
}

function blurChannel(ch: Float32Array, tmp: Float32Array, w: number, h: number, sigma: number) {
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
  const chans = [0, 1, 2].map(c => {
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) ch[i] = d[i * 4 + c] * a[i] / 255; // premultiplicar
    return ch;
  });
  for (const ch of chans) blurChannel(ch, tmp, w, h, sigma);
  blurChannel(a, tmp, w, h, sigma);
  for (let i = 0; i < n; i++) {
    const al = a[i];
    d[i * 4 + 3] = al;
    if (al > 0.001) for (let c = 0; c < 3; c++) d[i * 4 + c] = chans[c][i] * 255 / al;
  }
}
