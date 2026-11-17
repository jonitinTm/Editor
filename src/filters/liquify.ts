// Licuar: un campo de desplazamiento dice, para cada píxel, de dónde tomar el
// color (salida(p) = original(p + F(p))). Las herramientas modifican el campo.

export type LiquifyMode = 'push' | 'reconstruct' | 'twirlCW' | 'twirlCCW' | 'pucker' | 'bloat' | 'smooth';

export class LiquifyField {
  dx: Float32Array; dy: Float32Array;
  constructor(public w: number, public h: number) { this.dx = new Float32Array(w * h); this.dy = new Float32Array(w * h); }
  reset() { this.dx.fill(0); this.dy.fill(0); }
  isEmpty() { for (let i = 0; i < this.dx.length; i++) if (this.dx[i] || this.dy[i]) return false; return true; }
  /** Valor del campo con interpolación bilineal (fuera, el borde más cercano). */
  sample(F: Float32Array, x: number, y: number) {
    const w = this.w, h = this.h;
    x = x < 0 ? 0 : x > w - 1 ? w - 1 : x; y = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
    const x0 = x | 0, y0 = y | 0, x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
    return (F[y0 * w + x0] * (1 - fx) + F[y0 * w + x1] * fx) * (1 - fy) + (F[y1 * w + x0] * (1 - fx) + F[y1 * w + x1] * fx) * fy;
  }
  /**
   * Aplica un toque de pincel en (cx, cy) con radio r y fuerza s (0-1).
   * `delta` es el movimiento del ratón (solo para empujar). Devuelve el rectángulo afectado.
   */
  dab(mode: LiquifyMode, cx: number, cy: number, r: number, s: number, delta = { x: 0, y: 0 }) {
    const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r)), x1 = Math.min(this.w, Math.ceil(cx + r)), y1 = Math.min(this.h, Math.ceil(cy + r));
    if (x1 <= x0 || y1 <= y0) return null;
    const odx = this.dx.slice(), ody = this.dy.slice(); // copia para leer valores antiguos
    const old = { dx: odx, dy: ody };
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const vx = x - cx, vy = y - cy, d2 = (vx * vx + vy * vy) / (r * r); if (d2 >= 1) continue;
      const w = (1 - d2) * (1 - d2) * s, i = y * this.w + x;
      let qx = x, qy = y;
      if (mode === 'push') { qx = x - delta.x * w; qy = y - delta.y * w; }
      else if (mode === 'pucker' || mode === 'bloat') { const k = (mode === 'pucker' ? 0.06 : -0.06) * w; qx = cx + vx * (1 + k); qy = cy + vy * (1 + k); }
      else if (mode === 'twirlCW' || mode === 'twirlCCW') { const a = (mode === 'twirlCW' ? -0.08 : 0.08) * w, c = Math.cos(a), sn = Math.sin(a); qx = cx + vx * c - vy * sn; qy = cy + vx * sn + vy * c; }
      else if (mode === 'reconstruct') { this.dx[i] = odx[i] * (1 - 0.18 * w); this.dy[i] = ody[i] * (1 - 0.18 * w); continue; }
      else if (mode === 'smooth') {
        let sx = 0, sy = 0, n = 0;
        for (let k = -2; k <= 2; k++) for (let l = -2; l <= 2; l++) { const xx = Math.min(this.w - 1, Math.max(0, x + l)), yy = Math.min(this.h - 1, Math.max(0, y + k)); sx += odx[yy * this.w + xx]; sy += ody[yy * this.w + xx]; n++; }
        this.dx[i] = odx[i] + (sx / n - odx[i]) * w; this.dy[i] = ody[i] + (sy / n - ody[i]) * w; continue;
      }
      this.dx[i] = this.sample(old.dx, qx, qy) + qx - x;
      this.dy[i] = this.sample(old.dy, qx, qy) + qy - y;
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
}

/** Muestreo bilineal con alfa premultiplicado. */
function bilinear(src: Uint8ClampedArray, w: number, h: number, x: number, y: number, out: Uint8ClampedArray, o: number) {
  x -= 0.5; y -= 0.5;
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  let r = 0, g = 0, b = 0, a = 0;
  for (let k = 0; k < 4; k++) {
    let px = ix + (k & 1), py = iy + (k >> 1);
    px = px < 0 ? 0 : px >= w ? w - 1 : px; py = py < 0 ? 0 : py >= h ? h - 1 : py;
    const wt = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy), j = (py * w + px) * 4, aa = src[j + 3] * wt;
    r += src[j] * aa; g += src[j + 1] * aa; b += src[j + 2] * aa; a += aa;
  }
  if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; } out[o + 3] = a;
}

/** Dibuja en `out` la zona `rect` deformada (imagen y campo del mismo tamaño). */
export function renderLiquify(src: ImageData, f: LiquifyField, out: ImageData, rect = { x: 0, y: 0, w: src.width, h: src.height }) {
  const w = src.width, h = src.height, s = src.data, o = out.data;
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
    const i = y * w + x;
    bilinear(s, w, h, x + 0.5 + f.dx[i], y + 0.5 + f.dy[i], o, i * 4);
  }
}

/** Aplica a tamaño completo un campo calculado a escala `k` (campo = imagen × k). */
export function applyLiquifyFull(src: ImageData, f: LiquifyField, k: number): ImageData {
  const w = src.width, h = src.height, out = new ImageData(new Uint8ClampedArray(src.data), w, h), s = src.data, o = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = (x + 0.5) * k - 0.5, fy = (y + 0.5) * k - 0.5;
    const dx = f.sample(f.dx, fx, fy) / k, dy = f.sample(f.dy, fx, fy) / k;
    if (dx === 0 && dy === 0) continue;
    bilinear(s, w, h, x + 0.5 + dx, y + 0.5 + dy, o, (y * w + x) * 4);
  }
  return out;
}
