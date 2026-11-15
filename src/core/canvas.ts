// Utilidades básicas para trabajar con lienzos (canvas) de píxeles.

export interface Rect { x: number; y: number; w: number; h: number; }

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

const ctxCache = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();

/** Devuelve el contexto 2D de un lienzo (siempre el mismo objeto). */
export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  let ctx = ctxCache.get(c);
  if (!ctx) {
    ctx = c.getContext('2d', { willReadFrequently: false })!;
    ctxCache.set(c, ctx);
  }
  return ctx;
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

export function clearCanvas(c: HTMLCanvasElement) {
  const ctx = ctx2d(c);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.restore();
}

export function getPixels(c: HTMLCanvasElement, r?: Rect): ImageData {
  const rr = r ?? { x: 0, y: 0, w: c.width, h: c.height };
  return ctx2d(c).getImageData(rr.x, rr.y, Math.max(1, rr.w), Math.max(1, rr.h));
}

export function putPixels(c: HTMLCanvasElement, data: ImageData, x = 0, y = 0) {
  ctx2d(c).putImageData(data, x, y);
}

/** Pool de lienzos temporales reutilizables, para no crear objetos en cada fotograma. */
const pool: HTMLCanvasElement[] = [];
export function borrowCanvas(w: number, h: number): HTMLCanvasElement {
  const c = pool.pop() ?? document.createElement('canvas');
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  else clearCanvas(c);
  return c;
}
export function returnCanvas(c: HTMLCanvasElement) {
  if (pool.length < 12) pool.push(c);
}

export function rectUnion(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b; if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function rectIntersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w), btm = Math.min(a.y + a.h, b.y + b.h);
  if (r <= x || btm <= y) return null;
  return { x, y, w: r - x, h: btm - y };
}

/** Redondea un rectángulo hacia fuera a píxeles enteros. */
export function rectInt(r: Rect): Rect {
  const x = Math.floor(r.x), y = Math.floor(r.y);
  return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y };
}

/** Caja que contiene los píxeles no transparentes de un lienzo, o null si está vacío. */
export function contentBounds(c: HTMLCanvasElement, threshold = 0): Rect | null {
  const { width: w, height: h } = c;
  const d = getPixels(c).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    let row = y * w * 4 + 3;
    for (let x = 0; x < w; x++, row += 4) {
      if (d[row] > threshold) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function canvasToBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('No se pudo codificar la imagen')), type, quality));
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
