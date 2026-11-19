// Ajustes de «modo»: duotono (una, dos o tres tintas), mapa de bits (blanco y negro con tramado)
// y Tonos HDR (realce local de detalle y contraste). Trabajan sobre ImageData, sin interfaz.

import { gaussianBlur } from './blur';

const clamp = (v: number) => v < 0 ? 0 : v > 255 ? 255 : v;
const hex = (s: string) => { const n = parseInt(String(s || '#000').slice(1), 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };

/**
 * Duotono: la imagen pasa a grises y cada tinta se «imprime» encima según su curva
 * (la primera cubre sobre todo las sombras, las siguientes los medios tonos y las luces).
 */
export function duotone(img: ImageData, p: any) {
  const d = img.data, n = Math.max(1, Math.min(3, +(p.inks ?? 2)));
  const inks = [hex(p.ink1 ?? '#1a1a40'), hex(p.ink2 ?? '#e0a040'), hex(p.ink3 ?? '#f0e0c0')].slice(0, n);
  const paper = hex(p.paper ?? '#ffffff');
  const g = (p.gamma ?? 100) / 100;
  // cobertura de cada tinta según la oscuridad (0 = papel, 1 = tinta plena)
  const cover = (k: number, dark: number) => n === 1 ? dark : k === 0 ? Math.pow(dark, 1.6) : k === 1 ? Math.sin(Math.min(1, dark * 1.15) * Math.PI) * (n === 2 ? 1 : 0.8) + (n === 2 ? dark * 0.25 : 0) : Math.sin(Math.min(1, dark * 1.6) * Math.PI / 1.2) * 0.6;
  for (let i = 0; i < d.length; i += 4) {
    const L = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255, dark = Math.pow(1 - L, g);
    let r = paper[0], gg = paper[1], b = paper[2];
    // mezcla sustractiva aproximada: cada tinta multiplica lo que hay debajo
    inks.forEach((ink, k) => { const c = Math.max(0, Math.min(1, cover(k, dark))); r *= 1 - c + c * ink[0] / 255; gg *= 1 - c + c * ink[1] / 255; b *= 1 - c + c * ink[2] / 255; });
    d[i] = clamp(r); d[i + 1] = clamp(gg); d[i + 2] = clamp(b);
  }
}

/** Mapa de bits: solo blanco y negro, con umbral, tramado ordenado, difusión o trama de semitono. */
export function bitmap(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, method = p.method ?? 'diffusion', thr = (p.threshold ?? 50) / 100 * 255;
  const L = new Float32Array(w * h); for (let i = 0; i < w * h; i++) L[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  const out = new Uint8Array(w * h);
  if (method === 'threshold') for (let i = 0; i < w * h; i++) out[i] = L[i] >= thr ? 255 : 0;
  else if (method === 'pattern') {
    // matriz de Bayer 8×8
    const B = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = L[y * w + x] + (thr - 128) * -1 > (B[(y & 7) * 8 + (x & 7)] + 0.5) * 4 ? 255 : 0;
  } else if (method === 'halftone') {
    const cell = Math.max(3, p.cell ?? 8), ang = (p.angle ?? 45) * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x * ca + y * sa) / cell, v = (-x * sa + y * ca) / cell, fu = u - Math.floor(u) - 0.5, fv = v - Math.floor(v) - 0.5;
      const dist = Math.hypot(fu, fv) / 0.7071, dark = 1 - L[y * w + x] / 255;
      out[y * w + x] = dist < Math.sqrt(dark) ? 0 : 255;
    }
  } else {
    // difusión de error (Floyd–Steinberg)
    const E = Float32Array.from(L);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, o = E[i] >= thr ? 255 : 0, err = E[i] - o; out[i] = o;
      if (x + 1 < w) E[i + 1] += err * 7 / 16;
      if (y + 1 < h) { if (x > 0) E[i + w - 1] += err * 3 / 16; E[i + w] += err * 5 / 16; if (x + 1 < w) E[i + w + 1] += err / 16; }
    }
  }
  for (let i = 0; i < w * h; i++) d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = out[i];
}

/** Tonos HDR: separa la luz «de fondo» (muy desenfocada) del detalle y realza el detalle local. */
export function hdrToning(img: ImageData, p: any) {
  const { width: w, height: h, data: d } = img, radius = p.radius ?? 60, strength = (p.strength ?? 50) / 100;
  const gamma = (p.gamma ?? 100) / 100, exposure = (p.exposure ?? 0) / 100, detail = (p.detail ?? 30) / 100, sat = (p.saturation ?? 20) / 100;
  const shadow = (p.shadow ?? 0) / 100, highlight = (p.highlight ?? 0) / 100;
  const base = new ImageData(w, h);
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { const l = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114; L[i] = l; base.data[i * 4] = base.data[i * 4 + 1] = base.data[i * 4 + 2] = l; base.data[i * 4 + 3] = 255; }
  const fine = new ImageData(new Uint8ClampedArray(base.data), w, h);
  gaussianBlur(base, Math.max(1, radius)); gaussianBlur(fine, 2);
  for (let i = 0; i < w * h; i++) {
    const l = L[i] / 255, b = base.data[i * 4] / 255, f = fine.data[i * 4] / 255;
    // la luz de fondo se comprime (menos diferencia entre zonas) y el detalle se amplifica
    let nb = 0.5 + (b - 0.5) * (1 - strength * 0.7);
    nb += shadow * 0.35 * Math.pow(1 - b, 2) - highlight * 0.35 * b * b;
    let nl = nb + (l - b) * (1 + strength * 1.5) + (l - f) * detail * 3;
    nl = Math.pow(Math.max(0, nl * Math.pow(2, exposure * 2)), 1 / gamma);
    const k = l > 0.002 ? nl / l : 1;
    const i4 = i * 4, r = d[i4] * k, g = d[i4 + 1] * k, bb = d[i4 + 2] * k, m = (r + g + bb) / 3;
    d[i4] = clamp(m + (r - m) * (1 + sat)); d[i4 + 1] = clamp(m + (g - m) * (1 + sat)); d[i4 + 2] = clamp(m + (bb - m) * (1 + sat));
  }
}
