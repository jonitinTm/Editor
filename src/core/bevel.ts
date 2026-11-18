// Bisel y relieve: se calcula un mapa de alturas a partir de la forma de la capa (su transparencia
// difuminada), se ilumina con la luz del ángulo y altitud indicados, y salen dos imágenes:
// las luces (se combinan en modo Trama) y las sombras (en modo Multiplicar).

import { makeCanvas, ctx2d, hexToRgb } from './canvas';
import { blurChannel } from '../filters/blur';

export interface BevelStyle {
  enabled: boolean;
  style: 'inner' | 'outer' | 'emboss' | 'pillow';
  depth: number;      // %
  size: number;       // px
  soften: number;     // px
  angle: number;      // °
  altitude: number;   // °
  up: boolean;        // dirección arriba (true) o abajo
  highlight: string; highlightOpacity: number;
  shadowColor: string; shadowOpacity: number;
}
export const BEVEL_DEFAULT: BevelStyle = { enabled: false, style: 'inner', depth: 100, size: 8, soften: 0, angle: 120, altitude: 30, up: true, highlight: '#ffffff', highlightOpacity: 75, shadowColor: '#000000', shadowOpacity: 75 };

/** Devuelve las luces y sombras del bisel (lienzos de w×h) o null si no hay nada. */
export function bevelLayers(src: HTMLCanvasElement, ox: number, oy: number, w: number, h: number, b: BevelStyle): { hi: HTMLCanvasElement; sh: HTMLCanvasElement } | null {
  // Zona de trabajo: el contenido más un margen del tamaño del bisel
  const m = Math.ceil(b.size * 2 + b.soften * 2 + 4);
  const sa = ctx2d(src).getImageData(0, 0, src.width, src.height).data;
  let x0 = src.width, y0 = src.height, x1 = -1, y1 = -1;
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) if (sa[(y * src.width + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const bx = Math.max(0, x0 + ox - m), by = Math.max(0, y0 + oy - m), bx1 = Math.min(w, x1 + ox + 1 + m), by1 = Math.min(h, y1 + oy + 1 + m);
  const W = bx1 - bx, H = by1 - by; if (W <= 0 || H <= 0) return null;
  const A = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x + bx - ox, sy = y + by - oy;
    A[y * W + x] = sx >= 0 && sy >= 0 && sx < src.width && sy < src.height ? sa[(sy * src.width + sx) * 4 + 3] / 255 : 0;
  }
  // Mapa de alturas: transparencia difuminada (rampa suave en los bordes)
  const Hm = new Float32Array(A), tmp = new Float32Array(W * H);
  blurChannel(Hm, tmp, W, H, Math.max(0.5, b.size / 2));
  // la transparencia difuminada vale 0,5 justo en el borde: el bisel interior usa la mitad de dentro (0,5…1)
  // y el exterior la de fuera (0…0,5), estiradas a 0…1
  if (b.style === 'inner') for (let i = 0; i < Hm.length; i++) Hm[i] = Math.max(0, Hm[i] * 2 - 1);
  else if (b.style === 'outer') for (let i = 0; i < Hm.length; i++) Hm[i] = Math.min(1, Hm[i] * 2);
  else if (b.style === 'pillow') for (let i = 0; i < Hm.length; i++) Hm[i] = 1 - Math.abs(Hm[i] * 2 - 1);
  if (b.soften > 0) blurChannel(Hm, tmp, W, H, b.soften / 2);
  const depth = (b.depth / 100) * (b.up ? 1 : -1) * Math.max(1, b.size) * 0.9;
  const a = b.angle * Math.PI / 180, al = b.altitude * Math.PI / 180;
  const Lx = Math.cos(a) * Math.cos(al), Ly = -Math.sin(a) * Math.cos(al), Lz = Math.sin(al);
  const hi = makeCanvas(w, h), shc = makeCanvas(w, h);
  const hiD = new ImageData(W, H), shD = new ImageData(W, H);
  const [hr, hg, hb] = hexToRgb(b.highlight), [sr, sg, sb] = hexToRgb(b.shadowColor);
  const ho = b.highlightOpacity / 100, so = b.shadowOpacity / 100;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const xl = x > 0 ? Hm[i - 1] : Hm[i], xr = x < W - 1 ? Hm[i + 1] : Hm[i], yu = y > 0 ? Hm[i - W] : Hm[i], yd = y < H - 1 ? Hm[i + W] : Hm[i];
    const nx = -(xr - xl) / 2 * depth, ny = -(yd - yu) / 2 * depth, len = Math.hypot(nx, ny, 1);
    // luz difusa normalizada: 1 = cara mirando a la luz, -1 = de espaldas
    const dot = (nx * Lx + ny * Ly + Lz) / len, shade = dot >= Lz ? (dot - Lz) / (1 - Lz + 1e-6) : (dot - Lz) / (1 + Lz);
    // dónde se ve: dentro de la capa (interior), fuera (exterior) o ambos (relieve, almohadillado)
    const inside = A[i], vis = b.style === 'inner' ? inside : b.style === 'outer' ? 1 - inside : 1;
    if (vis <= 0 || Math.abs(shade) < 0.002) continue;
    const k = Math.min(1, Math.abs(shade) * 1.3) * vis, j = i * 4;
    if (shade > 0) { hiD.data[j] = hr; hiD.data[j + 1] = hg; hiD.data[j + 2] = hb; hiD.data[j + 3] = 255 * k * ho; }
    else { shD.data[j] = sr; shD.data[j + 1] = sg; shD.data[j + 2] = sb; shD.data[j + 3] = 255 * k * so; }
  }
  ctx2d(hi).putImageData(hiD, bx, by); ctx2d(shc).putImageData(shD, bx, by);
  return { hi, sh: shc };
}
