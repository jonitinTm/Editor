// Gradación de color (como en los programas de revelado): tres ruedas de color para sombras, medios tonos
// e iluminaciones, más una global. Cada rueda tiñe su zona de tonos con un tono (ángulo) y una cantidad
// (distancia al centro); cada zona tiene además su propia luminancia. «Equilibrio» desplaza la frontera
// entre sombras e iluminaciones y «Fusión» decide cuánto se solapan las zonas.

export type Wheel = [number, number]; // [tono en grados, cantidad 0–100]

/** Desplazamiento de color (media cero) para un tono: así teñir no cambia el brillo de por sí. */
function tint(hDeg: number, amt: number): [number, number, number] {
  if (!amt) return [0, 0, 0];
  const h = ((hDeg % 360) + 360) % 360 / 60, x = 1 - Math.abs(h % 2 - 1);
  const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
  const m = (r + g + b) / 3, k = amt / 100 * 0.45 * 255;
  return [(r - m) * k, (g - m) * k, (b - m) * k];
}

export function colorGrade(img: ImageData, p: any) {
  const S = tint(...(p.shadows as Wheel ?? [0, 0])), M = tint(...(p.mids as Wheel ?? [0, 0])), H = tint(...(p.highs as Wheel ?? [0, 0])), G = tint(...(p.global as Wheel ?? [0, 0]));
  const ls = (p.lumS ?? 0) / 100 * 70, lm = (p.lumM ?? 0) / 100 * 70, lh = (p.lumH ?? 0) / 100 * 70;
  const bal = (p.balance ?? 0) / 100 * 0.35, blend = 0.6 + (p.blending ?? 50) / 100 * 1.4, keep = p.preserve !== false;
  // pesos por luminosidad (tabla de 256): sombras abajo, iluminaciones arriba, medios en el centro
  const ws = new Float32Array(256), wm = new Float32Array(256), wh = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const L = Math.min(1, Math.max(0, i / 255 - bal));
    let s = Math.pow(1 - L, 2 * blend), hh = Math.pow(L, 2 * blend);
    let m = Math.max(0, 1 - s - hh); const t = s + m + hh; s /= t; m /= t; hh /= t;
    ws[i] = s; wm[i] = m; wh[i] = hh;
  }
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, k = Y | 0, s = ws[k], m = wm[k], hh = wh[k];
    let R = r + s * S[0] + m * M[0] + hh * H[0] + G[0], Gc = g + s * S[1] + m * M[1] + hh * H[1] + G[1], B = b + s * S[2] + m * M[2] + hh * H[2] + G[2];
    if (keep) { const Y2 = 0.2126 * R + 0.7152 * Gc + 0.0722 * B, dY = Y - Y2; R += dY; Gc += dY; B += dY; }
    const dl = s * ls + m * lm + hh * lh; R += dl; Gc += dl; B += dl;
    d[i] = R; d[i + 1] = Gc; d[i + 2] = B; // Uint8ClampedArray recorta solo
  }
}
