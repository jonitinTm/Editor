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
/** Lienzo temporal de w×h. Si se indica `only`, solo se garantiza vacía esa zona (más rápido). */
export function borrowCanvas(w: number, h: number, only?: Rect | null): HTMLCanvasElement {
  const c = pool.pop() ?? document.createElement('canvas');
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  else if (only) { const x = ctx2d(c); x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(only.x, only.y, only.w, only.h); x.restore(); }
  else clearCanvas(c);
  // el lienzo se reutiliza: se deja su estado de dibujo como nuevo
  const x = ctx2d(c); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.filter = 'none'; x.shadowColor = 'transparent'; x.shadowBlur = 0; x.shadowOffsetX = 0; x.shadowOffsetY = 0; x.setTransform(1, 0, 0, 1, 0, 0);
  return c;
}
export function returnCanvas(c: HTMLCanvasElement) {
  if (pool.length < 16) pool.push(c);
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
export function contentBounds(c: HTMLCanvasElement, threshold = 0, area?: Rect): Rect | null {
  const ax = Math.max(0, Math.floor(area?.x ?? 0)), ay = Math.max(0, Math.floor(area?.y ?? 0));
  const aw = Math.min(c.width, Math.ceil((area ? area.x + area.w : c.width))) - ax, ah = Math.min(c.height, Math.ceil((area ? area.y + area.h : c.height))) - ay;
  if (aw <= 0 || ah <= 0) return null;
  const ctx = ctx2d(c);
  // se lee por franjas desde cada borde hacia dentro y se para en cuanto aparece algo: en una imagen llena basta
  // con unas pocas filas y columnas en vez de leer todos los píxeles (las franjas crecen si no hay nada)
  const rows = (y: number, h: number, down: boolean): number => {
    const d = ctx.getImageData(ax, y, aw, h).data, row = aw * 4;
    for (let k = 0; k < h; k++) { const r = down ? k : h - 1 - k; for (let i = r * row + 3, e = i + row; i < e; i += 4) if (d[i] > threshold) return y + r; }
    return -1;
  };
  let top = -1, band = 16;
  for (let y = ay; y < ay + ah && top < 0; y += band, band = Math.min(512, band * 2)) top = rows(y, Math.min(band, ay + ah - y), true);
  if (top < 0) return null;
  let bottom = -1; band = 16;
  for (let y1 = ay + ah; y1 > top && bottom < 0; y1 -= band, band = Math.min(512, band * 2)) { const y = Math.max(top, y1 - band); bottom = rows(y, y1 - y, false); }
  if (bottom < 0) bottom = top;
  const H = bottom - top + 1;
  const cols = (x: number, w: number, right: boolean): number => {
    const d = ctx.getImageData(x, top, w, H).data, row = w * 4;
    for (let k = 0; k < w; k++) { const cx = right ? w - 1 - k : k; for (let y = 0, i = cx * 4 + 3; y < H; y++, i += row) if (d[i] > threshold) return x + cx; }
    return -1;
  };
  let left = -1; band = 16;
  for (let x = ax; x < ax + aw && left < 0; x += band, band = Math.min(512, band * 2)) left = cols(x, Math.min(band, ax + aw - x), false);
  if (left < 0) left = ax;
  let right = -1; band = 16;
  for (let x1 = ax + aw; x1 > left && right < 0; x1 -= band, band = Math.min(512, band * 2)) { const x = Math.max(left, x1 - band); right = cols(x, x1 - x, true); }
  if (right < 0) right = left;
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
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

const boundsCache = new WeakMap<HTMLCanvasElement, { key: number; rect: Rect | null }>();
/**
 * Caja del contenido, rápida incluso en lienzos enormes: primero una pasada a
 * baja resolución y luego se afinan los bordes a resolución completa.
 * `key` permite reutilizar el resultado mientras el contenido no cambie.
 */
export function contentBoundsQuick(c: HTMLCanvasElement, key = 0): Rect | null {
  const cached = boundsCache.get(c);
  if (cached && cached.key === key) return cached.rect;
  const W = c.width, H = c.height; let k = Math.max(1, Math.ceil(Math.max(W, H) / 512));
  let rect: Rect | null;
  if (k === 1) rect = contentBounds(c);
  else {
    // reducción a mitades exactas (cada paso promedia 2×2 píxeles): reducir de golpe solo muestrea algunos píxeles
    // y se perdían los bordes finos (las puntas de un círculo, por ejemplo)
    let cur: HTMLCanvasElement = c, f = 1;
    while (f < k) { const nw = Math.ceil(cur.width / 2), nh = Math.ceil(cur.height / 2), n = makeCanvas(nw, nh), nc = ctx2d(n); nc.imageSmoothingEnabled = true; nc.imageSmoothingQuality = 'low'; nc.drawImage(cur, 0, 0, nw * 2, nh * 2, 0, 0, nw, nh); cur = n; f *= 2; }
    k = f;
    const coarse = contentBounds(cur);
    if (!coarse) rect = null;
    else {
      // zona aproximada, ampliada un bloque por cada lado, y búsqueda exacta en las franjas de los bordes
      const x0 = Math.max(0, (coarse.x - 1) * k), y0 = Math.max(0, (coarse.y - 1) * k);
      const x1 = Math.min(W, (coarse.x + coarse.w + 1) * k), y1 = Math.min(H, (coarse.y + coarse.h + 1) * k);
      const ctx = ctx2d(c), band = 3 * k;
      const scan = (x: number, y: number, w: number, h: number, pick: (d: Uint8ClampedArray, w: number, h: number) => number) => {
        w = Math.max(1, Math.min(W - x, w)); h = Math.max(1, Math.min(H - y, h));
        return pick(ctx.getImageData(x, y, w, h).data, w, h);
      };
      const left = scan(x0, y0, band, y1 - y0, (d, w, h) => { for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if (d[(y * w + x) * 4 + 3]) return x0 + x; return x0; });
      const right = scan(Math.max(x0, x1 - band), y0, band, y1 - y0, (d, w, h) => { for (let x = w - 1; x >= 0; x--) for (let y = 0; y < h; y++) if (d[(y * w + x) * 4 + 3]) return Math.max(x0, x1 - band) + x + 1; return x1; });
      const top = scan(x0, y0, x1 - x0, band, (d, w, h) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3]) return y0 + y; return y0; });
      const bottom = scan(x0, Math.max(y0, y1 - band), x1 - x0, band, (d, w, h) => { for (let y = h - 1; y >= 0; y--) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3]) return Math.max(y0, y1 - band) + y + 1; return y1; });
      rect = { x: left, y: top, w: right - left, h: bottom - top };
    }
  }
  boundsCache.set(c, { key, rect });
  return rect;
}
