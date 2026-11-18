// Escala según el contenido (talla de costuras): se quitan o duplican, una a una, las «costuras»
// verticales u horizontales que atraviesan las zonas con menos detalle.

/** Imagen RGBA (ancho, alto, datos) que se va reduciendo o ampliando. */
interface Img { w: number; h: number; d: Uint8ClampedArray; prot: Float32Array }

function energy(im: Img): Float32Array {
  const { w, h, d, prot } = im, e = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, l = (x > 0 ? i - 1 : i) * 4, r = (x < w - 1 ? i + 1 : i) * 4, u = (y > 0 ? i - w : i) * 4, dn = (y < h - 1 ? i + w : i) * 4;
    let g = 0; for (let c = 0; c < 3; c++) g += Math.abs(d[r + c] - d[l + c]) + Math.abs(d[dn + c] - d[u + c]);
    // lo transparente apenas cuenta; lo protegido cuenta muchísimo
    e[i] = g * (0.2 + d[i * 4 + 3] / 255) + prot[i];
  }
  return e;
}
/** Costura vertical de menor energía (una x por fila). */
function seam(im: Img): Int32Array {
  const { w, h } = im, e = energy(im), M = new Float32Array(w * h), back = new Int8Array(w * h);
  for (let x = 0; x < w; x++) M[x] = e[x];
  for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, up = i - w; let best = M[up], k = 0;
    if (x > 0 && M[up - 1] < best) { best = M[up - 1]; k = -1; }
    if (x < w - 1 && M[up + 1] < best) { best = M[up + 1]; k = 1; }
    M[i] = e[i] + best; back[i] = k;
  }
  let x = 0, best = Infinity; for (let i = 0; i < w; i++) { const v = M[(h - 1) * w + i]; if (v < best) { best = v; x = i; } }
  const s = new Int32Array(h);
  for (let y = h - 1; y >= 0; y--) { s[y] = x; x += back[y * w + x]; }
  return s;
}
function removeSeam(im: Img, s: Int32Array): Img {
  const { w, h, d, prot } = im, nw = w - 1, nd = new Uint8ClampedArray(nw * h * 4), np = new Float32Array(nw * h);
  for (let y = 0; y < h; y++) {
    const cut = s[y];
    for (let x = 0, k = 0; x < w; x++) { if (x === cut) continue; const i = (y * w + x) * 4, j = (y * nw + k) * 4; nd[j] = d[i]; nd[j + 1] = d[i + 1]; nd[j + 2] = d[i + 2]; nd[j + 3] = d[i + 3]; np[y * nw + k] = prot[y * w + x]; k++; }
  }
  return { w: nw, h, d: nd, prot: np };
}
/** Duplica varias costuras a la vez (se eligen las de menor energía sin repetir). */
function insertSeams(im: Img, n: number): Img {
  // se buscan n costuras sobre una copia que se va reduciendo, recordando su posición original
  let tmp: Img = { ...im, d: new Uint8ClampedArray(im.d), prot: new Float32Array(im.prot) };
  const idx: Int32Array[] = []; const map: Int32Array[] = [];
  for (let y = 0; y < im.h; y++) { const r = new Int32Array(im.w); for (let x = 0; x < im.w; x++) r[x] = x; map.push(r); }
  const seams: Int32Array[] = [];
  for (let k = 0; k < n && tmp.w > 2; k++) {
    const s = seam(tmp), orig = new Int32Array(im.h);
    for (let y = 0; y < im.h; y++) { orig[y] = map[y][s[y]]; map[y] = Int32Array.from([...map[y].subarray(0, s[y]), ...map[y].subarray(s[y] + 1)]); }
    seams.push(orig); tmp = removeSeam(tmp, s);
  }
  void idx;
  // cada fila: se duplica cada píxel elegido (mezclado con su vecino)
  const nw = im.w + seams.length, nd = new Uint8ClampedArray(nw * im.h * 4), np = new Float32Array(nw * im.h);
  for (let y = 0; y < im.h; y++) {
    const dup = new Uint8Array(im.w); for (const s of seams) dup[s[y]]++;
    for (let x = 0, k = 0; x < im.w; x++) {
      const i = (y * im.w + x) * 4;
      for (let t = 0; t <= dup[x]; t++) {
        const j = (y * nw + k) * 4, nx = Math.min(im.w - 1, x + 1), i2 = (y * im.w + nx) * 4;
        for (let c = 0; c < 4; c++) nd[j + c] = t === 0 ? im.d[i + c] : (im.d[i + c] + im.d[i2 + c]) / 2;
        np[y * nw + k] = im.prot[y * im.w + x]; k++;
      }
    }
  }
  return { w: nw, h: im.h, d: nd, prot: np };
}
function transpose(im: Img): Img {
  const { w, h, d, prot } = im, nd = new Uint8ClampedArray(d.length), np = new Float32Array(prot.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, j = (x * h + y) * 4; nd[j] = d[i]; nd[j + 1] = d[i + 1]; nd[j + 2] = d[i + 2]; nd[j + 3] = d[i + 3]; np[x * h + y] = prot[y * w + x]; }
  return { w: h, h: w, d: nd, prot: np };
}

/** Cambia el tamaño de `src` a tw × th con talla de costuras. `protect` (0-1 por píxel) marca lo que no debe tocarse. */
export async function contentAwareScale(src: ImageData, tw: number, th: number, protect: Float32Array | null, onProgress?: (f: number) => void): Promise<ImageData> {
  let im: Img = { w: src.width, h: src.height, d: new Uint8ClampedArray(src.data), prot: protect ? Float32Array.from(protect, v => v * 1e6) : new Float32Array(src.width * src.height) };
  const total = Math.abs(tw - im.w) + Math.abs(th - im.h); let done = 0;
  const tick = async () => { done++; if (done % 8 === 0) { onProgress?.(done / Math.max(1, total)); await new Promise(r => setTimeout(r, 0)); } };
  // ancho
  if (tw < im.w) while (im.w > tw) { im = removeSeam(im, seam(im)); await tick(); }
  else if (tw > im.w) { while (im.w < tw) { const n = Math.min(tw - im.w, Math.max(1, Math.floor(im.w * 0.45))); im = insertSeams(im, n); done += n - 1; await tick(); } }
  // alto (se trabaja con la imagen girada)
  if (th !== im.h) {
    im = transpose(im);
    if (th < im.w) while (im.w > th) { im = removeSeam(im, seam(im)); await tick(); }
    else while (im.w < th) { const n = Math.min(th - im.w, Math.max(1, Math.floor(im.w * 0.45))); im = insertSeams(im, n); done += n - 1; await tick(); }
    im = transpose(im);
  }
  return new ImageData(im.d, im.w, im.h);
}
