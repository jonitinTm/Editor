// Revelado RAW de alta precisión: al revelar un RAW se guarda también la imagen lineal (antes de la curva de tono)
// en 16 bits, para poder volver a revelarla sin las bandas ni la pérdida de luces que tendría trabajar sobre 8 bits.
// Codificación perceptiva (raíz cuadrada) con margen de 2 pasos por encima del blanco: muchísimo detalle en las
// sombras (donde 8 bits se queda corto al aclarar) y luces recuperables por encima del blanco.

export interface RawLinear { w: number; h: number; data: Uint16Array }
export const HEADROOM = 4;
export const encLin = (v: number) => v <= 0 ? 0 : v >= HEADROOM ? 65535 : Math.round(Math.sqrt(v / HEADROOM) * 65535);
/** Tabla para descodificar rápido (65 536 valores). */
let dec: Float32Array | null = null;
export function decTable() { if (!dec) { dec = new Float32Array(65536); for (let u = 0; u < 65536; u++) dec[u] = HEADROOM * (u / 65535) ** 2; } return dec; }

/** ¿Cabe en memoria? (3 canales × 2 bytes por píxel; en aparatos con poca memoria se renuncia antes) */
export function canKeep(w: number, h: number) {
  const bytes = w * h * 6, mem = (navigator as any).deviceMemory ?? 8;
  return bytes <= Math.min(400e6, mem * 1e9 * 0.08);
}
let last: RawLinear | null = null;
/** Reserva el búfer del revelado que se está haciendo (o null si no cabe en memoria). */
export function beginLinear(w: number, h: number): RawLinear | null { last = canKeep(w, h) ? { w, h, data: new Uint16Array(w * h * 3) } : null; return last; }
/** Recoge el búfer del último revelado (una sola vez). */
export function takeLastLinear(): RawLinear | null { const l = last; last = null; return l; }
