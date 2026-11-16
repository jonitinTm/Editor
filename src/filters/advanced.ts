// Filtros avanzados: desenfoques direccionales, distorsiones, estilizar, pixelizar y "otros".
// Todos trabajan sobre ImageData en el sitio.

import { gaussianBlur } from './blur';

const copyOf = (img: ImageData) => new Uint8ClampedArray(img.data);

/** Lee un píxel con interpolación bilineal (fuera de la imagen repite el borde). */
function sample(src: Uint8ClampedArray, w: number, h: number, x: number, y: number, out: number[]) {
  x = x < 0 ? 0 : x > w - 1 ? w - 1 : x; y = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
  const x0 = x | 0, y0 = y | 0, x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  const a = (y0 * w + x0) * 4, b = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, d = (y1 * w + x1) * 4;
  for (let k = 0; k < 4; k++) out[k] = (src[a + k] * (1 - fx) + src[b + k] * fx) * (1 - fy) + (src[c + k] * (1 - fx) + src[d + k] * fx) * fy;
}

/** Distorsión genérica: para cada píxel de destino, `map` dice de dónde tomar el color. */
function displace(img: ImageData, map: (x: number, y: number, out: number[]) => void) {
  const { width: w, height: h, data: d } = img, src = copyOf(img), p = [0, 0], c = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    map(x, y, p); sample(src, w, h, p[0], p[1], c);
    const i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3];
  }
}

/** Promedia `n` muestras a lo largo de una línea por píxel (base de los desenfoques direccionales). */
function lineBlur(img: ImageData, n: number, step: (x: number, y: number, t: number, out: number[]) => void) {
  const { width: w, height: h, data: d } = img, src = copyOf(img), p = [0, 0], c = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let k = 0; k < n; k++) { step(x, y, n === 1 ? 0 : k / (n - 1) - 0.5, p); sample(src, w, h, p[0], p[1], c); const al = c[3]; r += c[0] * al; g += c[1] * al; b += c[2] * al; a += al; }
    const i = (y * w + x) * 4;
    if (a > 0) { d[i] = r / a; d[i + 1] = g / a; d[i + 2] = b / a; }
    d[i + 3] = a / n;
  }
}

export function motionBlur(img: ImageData, angle: number, distance: number) {
  const a = -angle * Math.PI / 180, dx = Math.cos(a) * distance, dy = Math.sin(a) * distance;
  lineBlur(img, Math.max(2, Math.min(64, Math.round(distance))), (x, y, t, o) => { o[0] = x + dx * t; o[1] = y + dy * t; });
}
/** Desenfoque radial: 'zoom' estira desde el centro, 'spin' gira alrededor de él. */
export function radialBlur(img: ImageData, amount: number, spin: boolean) {
  const cx = img.width / 2, cy = img.height / 2, k = amount / 100;
  lineBlur(img, Math.max(4, Math.min(48, Math.round(amount / 2) + 4)), spin
    ? (x, y, t, o) => { const a = t * k * 0.6, c = Math.cos(a), s = Math.sin(a), dx = x - cx, dy = y - cy; o[0] = cx + dx * c - dy * s; o[1] = cy + dx * s + dy * c; }
    : (x, y, t, o) => { const f = 1 + t * k * 0.5; o[0] = cx + (x - cx) * f; o[1] = cy + (y - cy) * f; });
}

export function highPass(img: ImageData, radius: number) {
  const blurred = new ImageData(copyOf(img), img.width, img.height);
  gaussianBlur(blurred, radius);
  const d = img.data, b = blurred.data;
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = d[i + c] - b[i + c] + 128;
}

const lum = (s: Uint8ClampedArray, i: number) => 0.299 * s[i] + 0.587 * s[i + 1] + 0.114 * s[i + 2];
export function findEdges(img: ImageData) {
  const { width: w, height: h, data: d } = img, src = copyOf(img);
  const at = (x: number, y: number) => lum(src, (Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))) * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
    const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
    const v = 255 - Math.min(255, Math.hypot(gx, gy)), i = (y * w + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
}
export function emboss(img: ImageData, angle: number, height: number, amount: number) {
  const { width: w, height: h, data: d } = img, src = copyOf(img);
  const a = -angle * Math.PI / 180, dx = Math.cos(a) * height, dy = Math.sin(a) * height, k = amount / 100, c1 = [0, 0, 0, 0], c2 = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    sample(src, w, h, x + dx, y + dy, c1); sample(src, w, h, x - dx, y - dy, c2);
    const v = 128 + ((c1[0] + c1[1] + c1[2]) - (c2[0] + c2[1] + c2[2])) / 3 * k, i = (y * w + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
}
export function mosaic(img: ImageData, cell: number) {
  const { width: w, height: h, data: d } = img; cell = Math.max(2, Math.round(cell));
  for (let by = 0; by < h; by += cell) for (let bx = 0; bx < w; bx += cell) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    const x1 = Math.min(w, bx + cell), y1 = Math.min(h, by + cell);
    for (let y = by; y < y1; y++) for (let x = bx; x < x1; x++) { const i = (y * w + x) * 4, al = d[i + 3]; r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al; n++; }
    for (let y = by; y < y1; y++) for (let x = bx; x < x1; x++) { const i = (y * w + x) * 4; if (a > 0) { d[i] = r / a; d[i + 1] = g / a; d[i + 2] = b / a; } d[i + 3] = a / n; }
  }
}

export function twirl(img: ImageData, angle: number) {
  const cx = img.width / 2, cy = img.height / 2, R = Math.min(cx, cy), A = angle * Math.PI / 180;
  displace(img, (x, y, o) => {
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
    if (r >= R) { o[0] = x; o[1] = y; return; }
    const t = 1 - r / R, a = A * t * t, c = Math.cos(a), s = Math.sin(a);
    o[0] = cx + dx * c - dy * s; o[1] = cy + dx * s + dy * c;
  });
}
/** amount > 0 encoge hacia el centro; < 0 abomba (esferizar). */
export function pinch(img: ImageData, amount: number) {
  const cx = img.width / 2, cy = img.height / 2, R = Math.min(cx, cy), k = amount / 100;
  displace(img, (x, y, o) => {
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
    if (r >= R || r === 0) { o[0] = x; o[1] = y; return; }
    const f = Math.pow(Math.sin(Math.PI / 2 * r / R), k > 0 ? -k : -k * 0.9) ;
    o[0] = cx + dx * f; o[1] = cy + dy * f;
  });
}
export function wave(img: ImageData, amplitude: number, wavelength: number) {
  const k = Math.PI * 2 / Math.max(2, wavelength);
  displace(img, (x, y, o) => { o[0] = x + Math.sin(y * k) * amplitude; o[1] = y + Math.sin(x * k) * amplitude; });
}
export function offset(img: ImageData, dx: number, dy: number) {
  const { width: w, height: h, data: d } = img, src = copyOf(img);
  dx = Math.round(dx); dy = Math.round(dy);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = ((x - dx) % w + w) % w, sy = ((y - dy) % h + h) % h, i = (y * w + x) * 4, j = (sy * w + sx) * 4;
    d[i] = src[j]; d[i + 1] = src[j + 1]; d[i + 2] = src[j + 2]; d[i + 3] = src[j + 3];
  }
}

/** Mínimo (max = false) o máximo de la vecindad, en dos pasadas (horizontal y vertical). */
export function minMax(img: ImageData, radius: number, max: boolean) {
  const { width: w, height: h, data: d } = img, r = Math.max(1, Math.round(radius));
  for (const horiz of [true, false]) {
    const src = copyOf(img);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
      let v = max ? 0 : 255;
      for (let k = -r; k <= r; k++) {
        const xx = horiz ? Math.max(0, Math.min(w - 1, x + k)) : x, yy = horiz ? y : Math.max(0, Math.min(h - 1, y + k));
        const s = src[(yy * w + xx) * 4 + c]; if (max ? s > v : s < v) v = s;
      }
      d[(y * w + x) * 4 + c] = v;
    }
  }
}
/** Mediana: quita motas y ruido conservando los bordes. */
export function median(img: ImageData, radius: number) {
  const { width: w, height: h, data: d } = img, src = copyOf(img), r = Math.max(1, Math.min(6, Math.round(radius)));
  const hist = new Uint16Array(256), half = ((2 * r + 1) ** 2) >> 1;
  for (let c = 0; c < 3; c++) for (let y = 0; y < h; y++) {
    hist.fill(0);
    const col = (x: number, sign: number) => { const xx = Math.max(0, Math.min(w - 1, x)); for (let k = -r; k <= r; k++) hist[src[(Math.max(0, Math.min(h - 1, y + k)) * w + xx) * 4 + c]] += sign; };
    for (let x = -r; x <= r; x++) col(x, 1);
    for (let x = 0; x < w; x++) {
      let acc = 0, m = 0; while (m < 255 && (acc += hist[m]) <= half) m++;
      d[(y * w + x) * 4 + c] = m;
      col(x - r, -1); col(x + r + 1, 1);
    }
  }
}
