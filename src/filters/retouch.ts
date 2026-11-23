// Retoque automático sin modelos de IA: suavizar piel y quitar artefactos JPEG.
// Trabaja sobre ImageData (se ejecuta en el hilo de los filtros), sin tocar la interfaz.

import { surfaceBlur } from './more';
import { gaussianBlur } from './blur';

const clamp = (v: number) => v < 0 ? 0 : v > 255 ? 255 : v;
const ramp = (t: number) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

/** Probabilidad (0..1) de que un color sea piel, por su crominancia (YCbCr): sirve para pieles claras y oscuras. */
export function skinWeight(r: number, g: number, b: number) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b, cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  if (y < 35 || y > 250) return 0;
  // núcleo y bordes suaves del rango de la piel: Cb 77–127, Cr 133–173
  const a = ramp((cb - 72) / 10) * ramp((132 - cb) / 10), c = ramp((cr - 128) / 10) * ramp((178 - cr) / 10);
  return a * c;
}

/** Suavizar piel: alisa la piel (manchas, granos, poros grandes) conservando la textura fina para que no parezca plástico.
 *  `amount` 0..100, `radius` en píxeles, `texture` 0..100 (cuánto detalle fino se devuelve), `onlySkin` limita el efecto a los tonos de piel. */
export function skinSmooth(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, n = w * h, amount = Math.max(0, Math.min(100, p.amount ?? 60)) / 100, radius = Math.max(1, p.radius ?? 8), tex = Math.max(0, Math.min(100, p.texture ?? 30)) / 100;
  if (!amount) return;
  const orig = new Uint8ClampedArray(d);
  // capa lisa: desenfoque de superficie (respeta los bordes: ojos, labios, contorno)
  const smooth = new ImageData(new Uint8ClampedArray(d), w, h); surfaceBlur(smooth, radius, 22 + 18 * amount);
  // detalle fino (frecuencias altas) para devolver la textura de la piel
  const low = new ImageData(new Uint8ClampedArray(d), w, h); gaussianBlur(low, Math.max(1, radius * 0.18));
  // dónde hay piel (suavizado para que no se note el límite)
  const mask = new ImageData(w, h);
  for (let i = 0; i < n; i++) { const m = p.onlySkin === false ? 1 : skinWeight(orig[i * 4], orig[i * 4 + 1], orig[i * 4 + 2]); mask.data[i * 4 + 3] = m * 255; }
  gaussianBlur(mask, Math.max(1.5, radius * 0.5), true);
  for (let i = 0; i < n; i++) {
    const k = amount * mask.data[i * 4 + 3] / 255; if (k <= 0.002) continue;
    for (let c = 0; c < 3; c++) {
      const q = i * 4 + c, detail = orig[q] - low.data[q];
      d[q] = clamp(orig[q] + (smooth.data[q] + detail * tex - orig[q]) * k);
    }
  }
}

/** Quitar artefactos JPEG: suaviza los saltos en los bordes de los bloques de 8×8 y los halos alrededor de los bordes,
 *  sin tocar los bordes de verdad. `strength` 0..100. */
export function jpegClean(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, s = Math.max(0, Math.min(100, p.strength ?? 50)) / 100;
  if (!s) return;
  const thr = 12 + 55 * s;
  // 1) desbloqueo: en cada borde de bloque, si el salto es mucho mayor que la variación dentro del bloque (y no enorme,
  //    que sería un borde real), se reparte en una rampa de 4 píxeles a cada lado
  const W4 = [0.5, 0.375, 0.25, 0.125];
  const fix = (at: (k: number) => number) => {   // at(k): índice del píxel k (−4..3) respecto al borde (entre −1 y 0)
    for (let c = 0; c < 3; c++) {
      const b = d[at(-1) + c], e = d[at(0) + c], jump = e - b, inner = Math.max(Math.abs(d[at(-1) + c] - d[at(-2) + c]), Math.abs(d[at(1) + c] - d[at(0) + c]));
      if (Math.abs(jump) > thr || Math.abs(jump) < 1.5 || Math.abs(jump) < inner * 1.6) continue;
      const t = jump * s;
      for (let k = 0; k < 4; k++) { d[at(-1 - k) + c] = clamp(d[at(-1 - k) + c] + t * W4[k]); d[at(k) + c] = clamp(d[at(k) + c] - t * W4[k]); }
    }
  };
  for (let y = 0; y < h; y++) for (let x = 8; x + 4 <= w; x += 8) { const r = y * w + x; fix(k => (r + k) * 4); }
  for (let y = 8; y + 4 <= h; y += 8) for (let x = 0; x < w; x++) fix(k => ((y + k) * w + x) * 4);
  // 2) halos y «mosquitos» junto a los bordes: desenfoque de superficie suave (no cruza los bordes fuertes)
  surfaceBlur(img, 1 + Math.round(2 * s), 6 + 14 * s);
}
