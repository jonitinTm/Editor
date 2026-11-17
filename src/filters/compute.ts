// Cálculo de un filtro sobre una zona: se usa tanto en la página como en el hilo de fondo.

export function computeFilter(orig: ImageData, sel: Uint8ClampedArray | null, apply: (img: ImageData, p: any) => void, params: any, isMask: boolean, lockAlpha: boolean): ImageData {
  const img = new ImageData(new Uint8ClampedArray(orig.data), orig.width, orig.height);
  apply(img, params);
  const o = orig.data, n = img.data;
  if (sel) {
    for (let i = 0; i < n.length; i += 4) {
      const k = sel[i + 3] / 255;
      if (k >= 1) continue;
      for (let c = 0; c < 4; c++) n[i + c] = o[i + c] + (n[i + c] - o[i + c]) * k;
    }
  }
  if (isMask) for (let i = 0; i < n.length; i += 4) { n[i + 3] = n[i]; n[i] = n[i + 1] = n[i + 2] = 255; }
  else if (lockAlpha) for (let i = 3; i < n.length; i += 4) n[i] = o[i];
  return img;
}
