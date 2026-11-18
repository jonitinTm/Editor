// Consulta de colores (LUT 3D): looks de serie y archivos .cube (los que usan cámaras y editores de vídeo).

export const LUT_PRESETS: [string, string][] = [
  ['file', 'Archivo .cube cargado'], ['tealorange', 'Cian y naranja (cine)'], ['warm', 'Cálido'], ['cold', 'Frío'], ['film', 'Película desvaída'],
  ['vintage', 'Vintage'], ['bleach', 'Sin blanqueo'], ['noir', 'Blanco y negro intenso'], ['crossprocess', 'Proceso cruzado'], ['matte', 'Mate'],
];

const clamp = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v;
const lum = (r: number, g: number, b: number) => r * 0.2126 + g * 0.7152 + b * 0.0722;
const sCurve = (v: number, k: number) => { const s = v * v * (3 - 2 * v); return v + (s - v) * k; };

/** Looks de serie como funciones de color (0-1). */
function preset(id: string): ((c: number[]) => void) | null {
  switch (id) {
    case 'tealorange': return c => { const l = lum(c[0], c[1], c[2]); const t = clamp((l - 0.25) / 0.5); c[0] = clamp(c[0] + (t - 0.5) * 0.16); c[1] = clamp(c[1] + (t - 0.5) * 0.03); c[2] = clamp(c[2] - (t - 0.5) * 0.18); for (let i = 0; i < 3; i++) c[i] = sCurve(c[i], 0.35); };
    case 'warm': return c => { c[0] = clamp(c[0] * 1.06 + 0.02); c[1] = clamp(c[1] * 1.01 + 0.01); c[2] = clamp(c[2] * 0.9); };
    case 'cold': return c => { c[0] = clamp(c[0] * 0.92); c[1] = clamp(c[1] * 1.0 + 0.01); c[2] = clamp(c[2] * 1.07 + 0.03); };
    case 'film': return c => { for (let i = 0; i < 3; i++) c[i] = 0.06 + sCurve(c[i], 0.25) * 0.86; const l = lum(c[0], c[1], c[2]); for (let i = 0; i < 3; i++) c[i] = clamp(l + (c[i] - l) * 0.82); c[2] = clamp(c[2] + 0.02); };
    case 'vintage': return c => { const l = lum(c[0], c[1], c[2]); c[0] = clamp(0.08 + (l + (c[0] - l) * 0.6) * 0.9 + 0.04); c[1] = clamp(0.06 + (l + (c[1] - l) * 0.6) * 0.86 + 0.02); c[2] = clamp(0.1 + (l + (c[2] - l) * 0.6) * 0.72); };
    case 'bleach': return c => { const l = lum(c[0], c[1], c[2]); for (let i = 0; i < 3; i++) c[i] = clamp(sCurve(l + (c[i] - l) * 0.45, 0.6)); };
    case 'noir': return c => { const l = sCurve(sCurve(lum(c[0], c[1], c[2]), 0.8), 0.5); c[0] = c[1] = c[2] = l; };
    case 'crossprocess': return c => { c[0] = clamp(sCurve(c[0], 0.5) * 1.05); c[1] = clamp(sCurve(c[1], 0.3) * 1.03 + 0.02); c[2] = clamp(c[2] * 0.75 + 0.12); };
    case 'matte': return c => { for (let i = 0; i < 3; i++) c[i] = 0.1 + c[i] * 0.84; };
  }
  return null;
}

/** Lee un archivo .cube (LUT 3D). Devuelve el tamaño y la tabla en bytes (0-255), rojo variando más rápido. */
export function parseCube(text: string): { size: number; data: Uint8Array; min: number[]; max: number[] } {
  let size = 0; const min = [0, 0, 0], max = [1, 1, 1]; const vals: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line[0] === '#') continue;
    const up = line.toUpperCase();
    if (up.startsWith('LUT_3D_SIZE')) { size = parseInt(line.split(/\s+/)[1]); continue; }
    if (up.startsWith('LUT_1D_SIZE')) throw new Error('Solo se admiten LUT 3D');
    if (up.startsWith('DOMAIN_MIN')) { line.split(/\s+/).slice(1, 4).forEach((v, i) => min[i] = parseFloat(v)); continue; }
    if (up.startsWith('DOMAIN_MAX')) { line.split(/\s+/).slice(1, 4).forEach((v, i) => max[i] = parseFloat(v)); continue; }
    if (/^[A-Z_]/.test(up)) continue; // TITLE y otras palabras clave
    const p = line.split(/\s+/); if (p.length >= 3) vals.push(parseFloat(p[0]), parseFloat(p[1]), parseFloat(p[2]));
  }
  if (!(size >= 2 && size <= 128) || vals.length < size ** 3 * 3) throw new Error('El archivo .cube no es válido');
  const data = new Uint8Array(size ** 3 * 3);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(clamp(vals[i]) * 255);
  return { size, data, min, max };
}
export const lutToB64 = (d: Uint8Array) => { let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000)); return btoa(s); };
const lutCache = new Map<string, Uint8Array>();
const fromB64 = (b: string) => { let d = lutCache.get(b); if (!d) { const s = atob(b); d = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) d[i] = s.charCodeAt(i); if (lutCache.size > 8) lutCache.clear(); lutCache.set(b, d); } return d; };

export function applyLut(img: ImageData, p: any) {
  const k = (p.amount ?? 100) / 100; if (k <= 0) return;
  const d = img.data, c = [0, 0, 0];
  let fn = preset(p.preset);
  if (p.preset === 'file') {
    if (!p.lutData || !p.lutSize) return;
    const N = p.lutSize, T = fromB64(p.lutData), m = N - 1;
    fn = col => {
      // interpolación trilineal en la tabla
      const x = col[0] * m, y = col[1] * m, z = col[2] * m, x0 = Math.min(m - 1, x | 0), y0 = Math.min(m - 1, y | 0), z0 = Math.min(m - 1, z | 0), fx = x - x0, fy = y - y0, fz = z - z0;
      for (let ch = 0; ch < 3; ch++) {
        const at = (i: number, j: number, l: number) => T[((l * N + j) * N + i) * 3 + ch];
        const c00 = at(x0, y0, z0) * (1 - fx) + at(x0 + 1, y0, z0) * fx, c10 = at(x0, y0 + 1, z0) * (1 - fx) + at(x0 + 1, y0 + 1, z0) * fx;
        const c01 = at(x0, y0, z0 + 1) * (1 - fx) + at(x0 + 1, y0, z0 + 1) * fx, c11 = at(x0, y0 + 1, z0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1, z0 + 1) * fx;
        c[ch] = ((c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz) / 255;
      }
      col[0] = c[0]; col[1] = c[1]; col[2] = c[2];
    };
  }
  if (!fn) return;
  const col = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    col[0] = d[i] / 255; col[1] = d[i + 1] / 255; col[2] = d[i + 2] / 255;
    fn(col);
    d[i] += (col[0] * 255 - d[i]) * k; d[i + 1] += (col[1] * 255 - d[i + 1]) * k; d[i + 2] += (col[2] * 255 - d[i + 2]) * k;
  }
}
