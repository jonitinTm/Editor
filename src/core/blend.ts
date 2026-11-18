// Modos de fusión que el navegador no trae (Luz lineal, Luz intensa, Mezcla definida, Restar, Dividir…):
// se calculan píxel a píxel con las fórmulas habituales y se componen como «normal» sobre lo de debajo.

export const CUSTOM_BLENDS = ['linear-burn', 'darker-color', 'lighter-color', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix', 'subtract', 'divide', 'dissolve'] as const;
export type CustomBlend = typeof CUSTOM_BLENDS[number];
export const isCustomBlend = (m: string): m is CustomBlend => (CUSTOM_BLENDS as readonly string[]).includes(m);

const lum = (r: number, g: number, b: number) => r * 0.3 + g * 0.59 + b * 0.11;
function channel(mode: CustomBlend, b: number, s: number): number {
  // b = lo de debajo, s = la capa (0..1)
  switch (mode) {
    case 'linear-burn': return Math.max(0, b + s - 1);
    case 'linear-light': return Math.min(1, Math.max(0, b + 2 * s - 1));
    case 'vivid-light': return s <= 0.5 ? (s === 0 ? 0 : Math.max(0, 1 - (1 - b) / (2 * s))) : (s === 1 ? 1 : Math.min(1, b / (2 * (1 - s))));
    case 'pin-light': return s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1);
    case 'hard-mix': return b + s >= 1 ? 1 : 0;
    case 'subtract': return Math.max(0, b - s);
    case 'divide': return s === 0 ? (b > 0 ? 1 : 0) : Math.min(1, b / s);
    default: return s;
  }
}

let seed = 1;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/**
 * Dibuja `src` (en dx, dy) sobre `ctx` con un modo propio y la opacidad `alpha`, solo dentro de `rect` si se da.
 */
export function drawCustomBlend(ctx: CanvasRenderingContext2D, src: CanvasImageSource & { width: number; height: number }, dx: number, dy: number, mode: CustomBlend, alpha: number, rect?: { x: number; y: number; w: number; h: number } | null) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  let x0 = Math.max(0, Math.floor(dx)), y0 = Math.max(0, Math.floor(dy)), x1 = Math.min(W, Math.ceil(dx + src.width)), y1 = Math.min(H, Math.ceil(dy + src.height));
  if (rect) { x0 = Math.max(x0, Math.floor(rect.x)); y0 = Math.max(y0, Math.floor(rect.y)); x1 = Math.min(x1, Math.ceil(rect.x + rect.w)); y1 = Math.min(y1, Math.ceil(rect.y + rect.h)); }
  const w = x1 - x0, h = y1 - y0; if (w <= 0 || h <= 0) return;
  const t = document.createElement('canvas'); t.width = w; t.height = h; const tc = t.getContext('2d')!; tc.drawImage(src, dx - x0, dy - y0);
  const S = tc.getImageData(0, 0, w, h).data, Dimg = ctx.getImageData(x0, y0, w, h), D = Dimg.data;
  seed = 1 + x0 * 7919 + y0 * 104729;
  for (let i = 0; i < D.length; i += 4) {
    let as = S[i + 3] / 255 * alpha; if (as <= 0) continue;
    const ab = D[i + 3] / 255;
    if (mode === 'dissolve') { if (rnd() < as) { D[i] = S[i]; D[i + 1] = S[i + 1]; D[i + 2] = S[i + 2]; D[i + 3] = 255; } continue; }
    const sr = S[i] / 255, sg = S[i + 1] / 255, sb = S[i + 2] / 255, br = D[i] / 255, bg = D[i + 1] / 255, bb = D[i + 2] / 255;
    let mr: number, mg: number, mb: number;
    if (mode === 'darker-color' || mode === 'lighter-color') {
      const useS = mode === 'darker-color' ? lum(sr, sg, sb) < lum(br, bg, bb) : lum(sr, sg, sb) > lum(br, bg, bb);
      [mr, mg, mb] = useS ? [sr, sg, sb] : [br, bg, bb];
    } else { mr = channel(mode, br, sr); mg = channel(mode, bg, sg); mb = channel(mode, bb, sb); }
    // composición: donde no hay nada debajo se ve la capa tal cual
    const ao = as + ab * (1 - as);
    const mix = (s: number, b: number, m: number) => (as * (1 - ab) * s + as * ab * m + (1 - as) * ab * b) / ao;
    D[i] = mix(sr, br, mr) * 255; D[i + 1] = mix(sg, bg, mg) * 255; D[i + 2] = mix(sb, bb, mb) * 255; D[i + 3] = ao * 255;
  }
  ctx.putImageData(Dimg, x0, y0);
}
