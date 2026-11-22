// Compatibilidad con navegadores que no traen todo (sobre todo Safari en iPhone, iPad y Mac).
//
// · `ctx.filter` (desenfoque y brillo al dibujar): si el navegador no lo aplica, se emula aquí con nuestro propio
//   desenfoque gaussiano. Así funcionan igual los bordes suaves de las selecciones, las sombras, el parche, etc.
// · Límite de tamaño de los lienzos en iPhone/iPad (unos 16,7 megapíxeles): `maxCanvasPixels()` lo indica para
//   que al abrir una foto enorme se reduzca en vez de fallar.

import { gaussianBlur } from '../filters/blur';

/** ¿Aplica de verdad el navegador `ctx.filter = 'blur()'`? */
function nativeFilterWorks(): boolean {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 9;
    const x = c.getContext('2d')!; if (!('filter' in x)) return false;
    const s = document.createElement('canvas'); s.width = s.height = 9; const sx = s.getContext('2d')!; sx.fillStyle = '#000'; sx.fillRect(4, 4, 1, 1);
    x.filter = 'blur(2px)'; x.drawImage(s, 0, 0); x.filter = 'none';
    return x.getImageData(1, 4, 1, 1).data[3] > 0;
  } catch { return false; }
}

type Parsed = { blur: number; brightness: number } | null;
function parseFilter(f: string): Parsed {
  if (!f || f === 'none') return null;
  let blur = 0, brightness = 1, ok = false;
  for (const m of f.matchAll(/(blur|brightness)\(\s*([-\d.]+)(px|%)?\s*\)/g)) {
    ok = true;
    if (m[1] === 'blur') blur += parseFloat(m[2]);
    else brightness *= m[3] === '%' ? parseFloat(m[2]) / 100 : parseFloat(m[2]);
  }
  return ok ? { blur, brightness } : null;
}

export const filterEmulated = typeof document !== 'undefined' && !nativeFilterWorks();
if (typeof window !== 'undefined') (window as any).__filterEmulated = filterEmulated;

if (filterEmulated) {
  const proto = CanvasRenderingContext2D.prototype as any;
  const store = new WeakMap<CanvasRenderingContext2D, string>();
  // si el navegador no conoce la propiedad, la creamos; si la conoce pero no la aplica, la tapamos
  Object.defineProperty(proto, 'filter', {
    configurable: true,
    get() { return store.get(this) ?? 'none'; },
    set(v: string) { store.set(this, String(v)); },
  });
  const draw = proto.drawImage;
  proto.drawImage = function (this: CanvasRenderingContext2D, img: CanvasImageSource, ...a: number[]) {
    const f = parseFilter(store.get(this) ?? 'none');
    if (!f) return draw.call(this, img, ...a);
    const sw = (img as any).width ?? (img as any).videoWidth, sh = (img as any).height ?? (img as any).videoHeight;
    if (!sw || !sh) return draw.call(this, img, ...a);
    // destino en el que acabará la imagen (2, 4 u 8 argumentos)
    let dx = 0, dy = 0, dw = sw, dh = sh, sx = 0, sy = 0, sW = sw, sH = sh;
    if (a.length === 2) [dx, dy] = a; else if (a.length === 4) [dx, dy, dw, dh] = a; else if (a.length >= 8) [sx, sy, sW, sH, dx, dy, dw, dh] = a;
    const pad = Math.ceil(f.blur * 3) + 1, W = Math.max(1, Math.round(Math.abs(dw)) + pad * 2), H = Math.max(1, Math.round(Math.abs(dh)) + pad * 2);
    // límite de seguridad: desenfocar algo enorme en JavaScript sería lento; se dibuja sin efecto
    if (W * H > 40e6) return draw.call(this, img, ...a);
    const t = document.createElement('canvas'); t.width = W; t.height = H;
    const tx = t.getContext('2d')!;
    draw.call(tx, img, sx, sy, sW, sH, pad, pad, Math.abs(dw), Math.abs(dh));
    const id = tx.getImageData(0, 0, W, H);
    if (f.blur > 0) gaussianBlur(id, f.blur);
    if (f.brightness !== 1) { const d = id.data; for (let i = 0; i < d.length; i += 4) { d[i] = Math.min(255, d[i] * f.brightness); d[i + 1] = Math.min(255, d[i + 1] * f.brightness); d[i + 2] = Math.min(255, d[i + 2] * f.brightness); } }
    tx.putImageData(id, 0, 0);
    return draw.call(this, t, dx - pad, dy - pad);
  };
}

/** iPhone / iPad (también los iPad que dicen ser un Mac). */
export const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** Píxeles máximos de un lienzo en este dispositivo (Safari de iPhone/iPad no admite más de unos 16,7 millones). */
export function maxCanvasPixels(): number { return isIOS ? 16_777_216 : 268_435_456; }
