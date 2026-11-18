// Igualar color: lleva los colores y la luz de la capa a los de otra imagen (transferencia de estadísticas en Lab).

const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const LIN = new Float32Array(256).map((_, i) => lin(i));
const gam = (v: number) => { const x = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055; return x < 0 ? 0 : x > 1 ? 255 : x * 255; };
const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
const fi = (t: number) => { const c = t * t * t; return c > 0.008856 ? c : (t - 16 / 116) / 7.787; };

function toLab(r: number, g: number, b: number, o: Float32Array, k: number) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fx = f(X), fy = f(Y), fz = f(Z);
  o[k] = 116 * fy - 16; o[k + 1] = 500 * (fx - fy); o[k + 2] = 200 * (fy - fz);
}
function fromLab(L: number, a: number, b: number, out: Uint8ClampedArray, i: number) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const X = fi(fx) * 0.95047, Y = fi(fy), Z = fi(fz) * 1.08883;
  out[i] = gam(3.2406 * X - 1.5372 * Y - 0.4986 * Z); out[i + 1] = gam(-0.9689 * X + 1.8758 * Y + 0.0415 * Z); out[i + 2] = gam(0.0557 * X - 0.204 * Y + 1.057 * Z);
}

export interface LabStats { mean: number[]; std: number[] }
export function labStats(img: ImageData): LabStats {
  const d = img.data, step = Math.max(1, Math.floor(d.length / 4 / 250000)), t = new Float32Array(3);
  const s = [0, 0, 0], q = [0, 0, 0]; let n = 0;
  for (let p = 0; p < d.length / 4; p += step) { const i = p * 4; if (d[i + 3] < 128) continue; toLab(d[i], d[i + 1], d[i + 2], t, 0); for (let c = 0; c < 3; c++) { s[c] += t[c]; q[c] += t[c] * t[c]; } n++; }
  if (!n) return { mean: [50, 0, 0], std: [20, 10, 10] };
  const mean = s.map(v => v / n), std = q.map((v, c) => Math.sqrt(Math.max(1e-6, v / n - mean[c] * mean[c])));
  return { mean, std };
}

export function matchColor(img: ImageData, src: LabStats | null, p: { luminance: number; intensity: number; fade: number; neutralize: boolean }) {
  const d = img.data, tgt = labStats(img), t = new Float32Array(3);
  const S = src ?? { mean: [tgt.mean[0], 0, 0], std: tgt.std };
  const lum = (p.luminance ?? 100) / 100, sat = (p.intensity ?? 100) / 100, fade = (p.fade ?? 0) / 100;
  const tm = p.neutralize ? [tgt.mean[0], tgt.mean[1], tgt.mean[2]] : tgt.mean;
  const sm = p.neutralize && !src ? [S.mean[0], 0, 0] : S.mean;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
    toLab(r0, g0, b0, t, 0);
    const L = ((t[0] - tm[0]) * S.std[0] / tgt.std[0] + sm[0]) * lum;
    const a = ((t[1] - tm[1]) * S.std[1] / tgt.std[1] + sm[1]) * sat, b = ((t[2] - tm[2]) * S.std[2] / tgt.std[2] + sm[2]) * sat;
    fromLab(Math.max(0, Math.min(100, L)), a, b, d, i);
    if (fade) { d[i] += (r0 - d[i]) * fade; d[i + 1] += (g0 - d[i + 1]) * fade; d[i + 2] += (b0 - d[i + 2]) * fade; }
  }
}
