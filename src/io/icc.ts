// Perfiles de color ICC (versión reducida, sin bibliotecas):
//  - lee perfiles RGB «de matriz y curvas» (sRGB, Adobe RGB, Display P3, ProPhoto…: los que usan las cámaras y Photoshop)
//    y convierte los píxeles a sRGB, el espacio en el que trabaja el editor;
//  - genera un perfil sRGB para incrustarlo al guardar (PSD, JPG y PNG), así otros programas saben qué colores son.
// Los perfiles con tablas (LUT, típicos de impresoras) no se convierten: se avisa y los píxeles quedan como están.

export interface IccProfile { name: string; m: number[]; trc: ((x: number) => number)[] }

const S15 = (v: DataView, p: number) => v.getInt32(p) / 65536;
// sRGB adaptado a D50 (el blanco de las conexiones ICC), columnas = primarios R, G y B
const SRGB_D50 = [0.4360747, 0.3850649, 0.1430804, 0.2225045, 0.7168786, 0.0606169, 0.0139322, 0.0971045, 0.7141733];

function inv3(a: number[]): number[] {
  const [b, c, d, e, f, g, h, i, j] = a, A = f * j - g * i, B = -(e * j - g * h), C = e * i - f * h, det = b * A + c * B + d * C;
  return [A, -(c * j - d * i), c * g - d * f, B, b * j - d * h, -(b * g - d * e), C, -(b * i - c * h), b * f - c * e].map(x => x / det);
}
function mul3(a: number[], b: number[]): number[] {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
}
const srgbDecode = (x: number) => x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
const srgbEncode = (x: number) => x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;

/** Curva de un perfil: tipo «curv» (gamma o tabla) o «para» (función paramétrica). */
function readCurve(v: DataView, p: number, size: number): ((x: number) => number) | null {
  const type = String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3));
  if (type === 'curv') {
    const n = v.getUint32(p + 8);
    if (n === 0) return x => x;
    if (n === 1) { const g = v.getUint16(p + 12) / 256; return x => Math.pow(x, g); }
    if (12 + n * 2 > size) return null;
    const t = new Float32Array(n); for (let i = 0; i < n; i++) t[i] = v.getUint16(p + 12 + i * 2) / 65535;
    return x => { const f = Math.max(0, Math.min(1, x)) * (n - 1), i = Math.floor(f), k = f - i; return i >= n - 1 ? t[n - 1] : t[i] + (t[i + 1] - t[i]) * k; };
  }
  if (type === 'para') {
    const fn = v.getUint16(p + 8), q = (k: number) => S15(v, p + 12 + k * 4);
    const g = q(0);
    if (fn === 0) return x => Math.pow(x, g);
    const a = q(1), b = q(2);
    if (fn === 1) return x => x >= -b / a ? Math.pow(a * x + b, g) : 0;
    const c = q(3);
    if (fn === 2) return x => x >= -b / a ? Math.pow(a * x + b, g) + c : c;
    const d = q(4);
    if (fn === 3) return x => x >= d ? Math.pow(a * x + b, g) : c * x;
    const e = q(5), f = q(6);
    if (fn === 4) return x => x >= d ? Math.pow(a * x + b, g) + e : c * x + f;
  }
  return null;
}

/** Lee un perfil RGB de matriz y curvas; null si no es de ese tipo (o está dañado). */
export function parseIcc(bytes: Uint8Array): IccProfile | null {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 132 || v.getUint32(36) !== 0x61637370 /* acsp */) return null;
    const space = String.fromCharCode(...bytes.subarray(16, 20)), pcs = String.fromCharCode(...bytes.subarray(20, 24));
    if (space !== 'RGB ' || pcs !== 'XYZ ') return null;
    const n = v.getUint32(128), tags = new Map<string, { p: number; s: number }>();
    for (let i = 0; i < n && 132 + i * 12 + 12 <= bytes.length; i++) {
      const o = 132 + i * 12, sig = String.fromCharCode(...bytes.subarray(o, o + 4)), p = v.getUint32(o + 4), s = v.getUint32(o + 8);
      if (p + s <= bytes.length) tags.set(sig, { p, s });
    }
    const xyz = (k: string) => { const t = tags.get(k); if (!t || t.s < 20) throw 0; return [S15(v, t.p + 8), S15(v, t.p + 12), S15(v, t.p + 16)]; };
    const r = xyz('rXYZ'), g = xyz('gXYZ'), b = xyz('bXYZ');
    const trc = ['rTRC', 'gTRC', 'bTRC'].map(k => { const t = tags.get(k); return t ? readCurve(v, t.p, t.s) : null; });
    if (trc.some(f => !f)) return null;
    return { name: profileName(bytes, tags.get('desc')), m: [r[0], g[0], b[0], r[1], g[1], b[1], r[2], g[2], b[2]], trc: trc as ((x: number) => number)[] };
  } catch { return null; }
}

/** Nombre del perfil (etiqueta «desc», en los formatos v2 y v4). */
function profileName(bytes: Uint8Array, t?: { p: number; s: number }): string {
  if (!t) return 'sin nombre';
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), type = String.fromCharCode(...bytes.subarray(t.p, t.p + 4));
  if (type === 'desc') { const n = v.getUint32(t.p + 8); return String.fromCharCode(...bytes.subarray(t.p + 12, t.p + 12 + Math.max(0, n - 1))).trim(); }
  if (type === 'mluc') { const off = v.getUint32(t.p + 20), len = v.getUint32(t.p + 16); let s = ''; for (let i = 0; i < len; i += 2) s += String.fromCharCode(v.getUint16(t.p + off + i)); return s.trim(); }
  return 'sin nombre';
}

/** ¿Es (casi) sRGB? Entonces no hace falta convertir. */
export function isSrgb(p: IccProfile): boolean {
  if (p.m.some((x, i) => Math.abs(x - SRGB_D50[i]) > 0.004)) return false;
  for (const x of [0.02, 0.1, 0.3, 0.5, 0.8]) for (const f of p.trc) if (Math.abs(f(x) - srgbDecode(x)) > 0.006) return false;
  return true;
}

/** Convierte píxeles RGBA del espacio del perfil a sRGB (in situ). */
export function convertToSrgb(d: Uint8ClampedArray, p: IccProfile) {
  const M = mul3(inv3(SRGB_D50), p.m);
  const lin = p.trc.map(f => { const t = new Float32Array(256); for (let i = 0; i < 256; i++) t[i] = f(i / 255); return t; });
  const enc = new Uint8Array(4097); for (let i = 0; i <= 4096; i++) enc[i] = Math.round(srgbEncode(i / 4096) * 255);
  const E = (x: number) => enc[x <= 0 ? 0 : x >= 1 ? 4096 : Math.round(x * 4096)];
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const r = lin[0][d[i]], g = lin[1][d[i + 1]], b = lin[2][d[i + 2]];
    d[i] = E(M[0] * r + M[1] * g + M[2] * b); d[i + 1] = E(M[3] * r + M[4] * g + M[5] * b); d[i + 2] = E(M[6] * r + M[7] * g + M[8] * b);
  }
}

let srgbCache: Uint8Array | null = null;
/** Perfil sRGB IEC61966-2.1 (versión 2, con curvas en tabla) para incrustar al guardar. */
export function srgbIcc(): Uint8Array { return srgbCache ??= makeIcc('sRGB IEC61966-2.1', SRGB_D50, srgbDecode); }
/** Perfil RGB de matriz y curvas: primarios (adaptados a D50, por columnas) y curva de tono. */
export function makeIcc(desc: string, M: number[], curveFn: (x: number) => number): Uint8Array {
  const N = 1024, cprt = 'No copyright, use freely';
  const parts: [string, Uint8Array][] = [];
  const buf = (n: number) => { const b = new Uint8Array(n); return { b, v: new DataView(b.buffer) }; };
  const sig = (v: DataView, p: number, s: string) => { for (let i = 0; i < 4; i++) v.setUint8(p + i, s.charCodeAt(i)); };
  { const { b, v } = buf(12 + desc.length + 1 + 4 + 4 + 2 + 1 + 67); sig(v, 0, 'desc'); v.setUint32(8, desc.length + 1); for (let i = 0; i < desc.length; i++) b[12 + i] = desc.charCodeAt(i); parts.push(['desc', b]); }
  { const { b, v } = buf(8 + cprt.length + 1); sig(v, 0, 'text'); for (let i = 0; i < cprt.length; i++) b[8 + i] = cprt.charCodeAt(i); parts.push(['cprt', b]); }
  const xyzTag = (x: number, y: number, z: number) => { const { b, v } = buf(20); sig(v, 0, 'XYZ '); v.setInt32(8, Math.round(x * 65536)); v.setInt32(12, Math.round(y * 65536)); v.setInt32(16, Math.round(z * 65536)); return b; };
  parts.push(['wtpt', xyzTag(0.9642, 1, 0.8249)]);
  parts.push(['rXYZ', xyzTag(M[0], M[3], M[6])], ['gXYZ', xyzTag(M[1], M[4], M[7])], ['bXYZ', xyzTag(M[2], M[5], M[8])]);
  const { b: curve, v: cv } = buf(12 + N * 2); sig(cv, 0, 'curv'); cv.setUint32(8, N);
  for (let i = 0; i < N; i++) cv.setUint16(12 + i * 2, Math.round(Math.max(0, Math.min(1, curveFn(i / (N - 1)))) * 65535));
  // las tres curvas comparten los mismos datos (como en el perfil sRGB habitual)
  const tags = [...parts.map(([s, b]) => ({ s, b })), { s: 'rTRC', b: curve }, { s: 'gTRC', b: curve }, { s: 'bTRC', b: curve }];
  let off = 128 + 4 + tags.length * 12; const at = new Map<Uint8Array, number>(), layout: { s: string; p: number; n: number }[] = [];
  for (const t of tags) { if (!at.has(t.b)) { at.set(t.b, off); off += t.b.length; off = (off + 3) & ~3; } layout.push({ s: t.s, p: at.get(t.b)!, n: t.b.length }); }
  const out = new Uint8Array(off), v = new DataView(out.buffer);
  v.setUint32(0, off); v.setUint32(8, 0x02100000); sig(v, 12, 'mntr'); sig(v, 16, 'RGB '); sig(v, 20, 'XYZ ');
  v.setUint16(24, 2024); v.setUint16(26, 1); v.setUint16(28, 1); sig(v, 36, 'acsp');
  v.setInt32(68, Math.round(0.9642 * 65536)); v.setInt32(72, 65536); v.setInt32(76, Math.round(0.8249 * 65536));
  v.setUint32(128, tags.length);
  layout.forEach((t, i) => { sig(v, 132 + i * 12, t.s); v.setUint32(136 + i * 12, t.p); v.setUint32(140 + i * 12, t.n); });
  for (const [b, p] of at) out.set(b, p);
  return out;
}

/** PNG con el fragmento «sRGB» (dice a otros programas que los colores son sRGB). */
export async function pngWithSrgb(blob: Blob): Promise<Blob> {
  const b = new Uint8Array(await blob.arrayBuffer());
  if (b.length < 33 || b[12] !== 0x49 || b[13] !== 0x48) return blob; // el primer fragmento debe ser IHDR
  // ¿ya tiene sRGB, iCCP o gAMA? Entonces se deja
  for (let p = 8; p + 8 <= b.length;) { const n = (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0, t = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]); if (t === 'sRGB' || t === 'iCCP') return blob; if (t === 'IDAT') break; p += 12 + n; }
  const chunk = new Uint8Array(13); const v = new DataView(chunk.buffer);
  v.setUint32(0, 1); chunk.set([0x73, 0x52, 0x47, 0x42], 4); chunk[8] = 0; v.setUint32(9, crc32(chunk.subarray(4, 9)));
  return new Blob([b.subarray(0, 33), chunk, b.subarray(33)], { type: 'image/png' });
}
/** JPEG con el perfil sRGB incrustado (segmento APP2 «ICC_PROFILE»), detrás de la cabecera JFIF si la hay. */
export async function jpegWithSrgb(blob: Blob): Promise<Blob> {
  const b = new Uint8Array(await blob.arrayBuffer());
  if (b[0] !== 0xff || b[1] !== 0xd8) return blob;
  let p = 2;
  while (p + 4 < b.length && b[p] === 0xff && (b[p + 1] === 0xe0 || b[p + 1] === 0xe1)) { if (b[p + 1] === 0xe2) break; p += 2 + (b[p + 2] << 8 | b[p + 3]); }
  // si ya trae un perfil, no se toca
  for (let q = 2; q + 4 < b.length && b[q] === 0xff && b[q + 1] !== 0xda; q += 2 + (b[q + 2] << 8 | b[q + 3])) if (b[q + 1] === 0xe2) return blob;
  const icc = srgbIcc(), head = new TextEncoder().encode('ICC_PROFILE\0'), len = 2 + head.length + 2 + icc.length;
  const seg = new Uint8Array(2 + len); seg[0] = 0xff; seg[1] = 0xe2; seg[2] = len >> 8; seg[3] = len & 255; seg.set(head, 4); seg[4 + head.length] = 1; seg[5 + head.length] = 1; seg.set(icc, 6 + head.length);
  return new Blob([b.subarray(0, p), seg, b.subarray(p)], { type: 'image/jpeg' });
}

let crcTable: Uint32Array | null = null;
function crc32(d: Uint8Array): number {
  if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
  let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = crcTable[(c ^ d[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
