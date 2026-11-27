import { beginLinear, encLin } from './rawlinear';
// Revelado de DNG (el formato RAW abierto: móviles, muchas cámaras y los RAW convertidos por Adobe).
// Lee los datos del sensor (sin comprimir o JPEG sin pérdida), corrige negros y blancos, equilibra el
// blanco como la cámara, reconstruye el color del mosaico de Bayer, aplica la matriz de color de la
// cámara hacia sRGB, la orientación y una curva de tono suave.

export interface Ifd { [tag: number]: number[] | string; }

export class Tiff {
  v: DataView; le: boolean;
  constructor(public b: Uint8Array) { this.v = new DataView(b.buffer, b.byteOffset, b.byteLength); this.le = b[0] === 0x49; }
  u16(o: number) { return this.v.getUint16(o, this.le); }
  u32(o: number) { return this.v.getUint32(o, this.le); }
  ifd(o: number): { tags: Ifd; next: number } {
    const n = this.u16(o), tags: Ifd = {};
    const size = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12, tag = this.u16(e), type = this.u16(e + 2), count = this.u32(e + 4);
      const bytes = (size[type] ?? 1) * count, at = bytes > 4 ? this.u32(e + 8) : e + 8;
      if (at + bytes > this.b.length) continue;
      if (type === 2) { let s = ''; for (let k = 0; k < count - 1; k++) s += String.fromCharCode(this.b[at + k]); tags[tag] = s; continue; }
      const vals: number[] = [];
      for (let k = 0; k < Math.min(count, 4096 * 4); k++) {
        const p = at + k * (size[type] ?? 1);
        vals.push(type === 1 || type === 7 ? this.b[p] : type === 6 ? this.v.getInt8(p) : type === 3 ? this.u16(p) : type === 8 ? this.v.getInt16(p, this.le) : type === 4 ? this.u32(p) : type === 9 ? this.v.getInt32(p, this.le)
          : type === 5 ? this.u32(p) / (this.u32(p + 4) || 1) : type === 10 ? this.v.getInt32(p, this.le) / (this.v.getInt32(p + 4, this.le) || 1) : type === 11 ? this.v.getFloat32(p, this.le) : type === 12 ? this.v.getFloat64(p, this.le) : 0);
      }
      tags[tag] = vals;
    }
    return { tags, next: this.u32(o + 2 + n * 12) };
  }
}

/** Descompresor JPEG sin pérdida (ITU T.81, proceso 14), el que usan los DNG comprimidos. */
export function ljpeg(b: Uint8Array, start: number, end: number): { w: number; h: number; comps: number; data: Uint16Array } {
  let p = start;
  const huff: { [id: number]: { maxcode: Int32Array; valptr: Int32Array; mincode: Int32Array; vals: Uint8Array } } = {};
  let w = 0, h = 0, comps = 0, bits = 0, pred = 1; const compTable: number[] = [];
  if (b[p] !== 0xff || b[p + 1] !== 0xd8) throw new Error('JPEG sin pérdida no válido');
  p += 2;
  for (;;) {
    while (b[p] !== 0xff) p++;
    const m = b[p + 1]; p += 2;
    const len = (b[p] << 8) | b[p + 1];
    if (m === 0xc3) { bits = b[p + 2]; h = (b[p + 3] << 8) | b[p + 4]; w = (b[p + 5] << 8) | b[p + 6]; comps = b[p + 7]; }
    else if (m === 0xc4) {
      let q = p + 2;
      while (q < p + len) {
        const id = b[q] & 15; q++;
        const counts = b.subarray(q, q + 16); q += 16;
        const total = counts.reduce((a, c) => a + c, 0), vals = b.slice(q, q + total); q += total;
        const maxcode = new Int32Array(18).fill(-1), valptr = new Int32Array(17), mincode = new Int32Array(17);
        let code = 0, k = 0;
        for (let l = 1; l <= 16; l++) { valptr[l] = k; mincode[l] = code; code += counts[l - 1]; k += counts[l - 1]; maxcode[l] = counts[l - 1] ? code - 1 : -1; code <<= 1; }
        maxcode[17] = 0x7fffffff;
        huff[id] = { maxcode, valptr, mincode, vals };
      }
    } else if (m === 0xda) {
      const ns = b[p + 2]; for (let i = 0; i < ns; i++) compTable.push(b[p + 4 + i * 2] >> 4);
      pred = b[p + 3 + ns * 2]; p += len; break;
    } else if (m === 0xd9) throw new Error('JPEG sin datos');
    p += len;
  }
  // lectura de bits (con el relleno 0xff00)
  let acc = 0, nbits = 0;
  const bit = () => {
    if (nbits === 0) { let c = p < end ? b[p++] : 0; if (c === 0xff) { const d = b[p]; if (d === 0) p++; else if (d >= 0xd0 && d <= 0xd7) { p++; c = p < end ? b[p++] : 0; } } acc = c; nbits = 8; }
    nbits--; return (acc >> nbits) & 1;
  };
  const decode = (t: typeof huff[number]) => { let code = bit(), l = 1; while (code > t.maxcode[l]) { code = (code << 1) | bit(); l++; if (l > 16) return 0; } return t.vals[t.valptr[l] + code - t.mincode[l]]; };
  const recv = (s: number) => { if (s === 0) return 0; if (s === 16) return -32768; let v = 0; for (let i = 0; i < s; i++) v = (v << 1) | bit(); return v < (1 << (s - 1)) ? v - (1 << s) + 1 : v; };
  const out = new Uint16Array(w * h * comps), init = 1 << (bits - 1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < comps; c++) {
    const t = huff[compTable[c] ?? 0] ?? huff[0];
    const diff = recv(decode(t)), i = (y * w + x) * comps + c;
    let P: number;
    if (y === 0 && x === 0) P = init;
    else if (y === 0) P = out[i - comps];
    else if (x === 0) P = out[i - w * comps];
    else { const Ra = out[i - comps], Rb = out[i - w * comps], Rc = out[i - w * comps - comps]; P = pred === 1 ? Ra : pred === 2 ? Rb : pred === 3 ? Rc : pred === 4 ? Ra + Rb - Rc : pred === 5 ? Ra + ((Rb - Rc) >> 1) : pred === 6 ? Rb + ((Ra - Rc) >> 1) : pred === 7 ? (Ra + Rb) >> 1 : Ra; }
    out[i] = (P + diff) & 0xffff;
  }
  return { w, h, comps, data: out };
}

const inv3 = (m: number[]) => {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C || 1e-9;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
};
const mul3 = (a: number[], b: number[]) => { const r: number[] = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]); return r; };
const XYZ_TO_SRGB = [3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.2040, 1.0570];

/** ¿Es un DNG (o un TIFF con datos de sensor) que se puede revelar? */
export function isDng(b: Uint8Array) {
  if (b.length < 16 || !((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d))) return false;
  try { const t = new Tiff(b); const ifd0 = t.ifd(t.u32(4)).tags; return !!ifd0[50706]; } catch { return false; }
}

/** Revela el DNG. Devuelve la imagen (8 bits) o lanza un error si el formato no se admite. */
export function decodeDng(b: Uint8Array): ImageData {
  const t = new Tiff(b);
  const ifd0 = t.ifd(t.u32(4)).tags;
  // la imagen del sensor puede estar en el IFD principal o en un sub-IFD
  const cands: Ifd[] = [ifd0];
  for (const o of (ifd0[330] as number[] | undefined) ?? []) { try { cands.push(t.ifd(o).tags); } catch { /* */ } }
  const raw = cands.find(c => ((c[254] as number[] | undefined)?.[0] ?? 0) === 0 && [32803, 34892].includes((c[262] as number[] | undefined)?.[0] ?? 0));
  if (!raw) throw new Error('Este DNG no contiene datos del sensor que se puedan revelar');
  const g = (tag: number, d?: number) => (raw[tag] as number[] | undefined)?.[0] ?? (ifd0[tag] as number[] | undefined)?.[0] ?? d;
  const arr = (tag: number) => (raw[tag] as number[] | undefined) ?? (ifd0[tag] as number[] | undefined);
  const W = g(256)!, H = g(257)!, bps = g(258, 16)!, comp = g(259, 1)!, photometric = g(262)!, spp = g(277, 1)!;
  if (![1, 7].includes(comp)) throw new Error('Compresión de DNG no admitida (' + comp + ')');
  const cfa = photometric === 32803;
  const N = cfa ? 1 : spp;
  const sens = new Uint16Array(W * H * N);
  // ---- datos: por tiras o por baldosas
  const tiled = !!arr(322);
  const tw = tiled ? g(322)! : W, th = tiled ? g(323)! : (g(278) ?? H);
  const offs = arr(tiled ? 324 : 273) ?? [], cnts = arr(tiled ? 325 : 279) ?? [];
  const across = Math.ceil(W / tw);
  offs.forEach((off, k) => {
    const tx = tiled ? (k % across) * tw : 0, ty = tiled ? Math.floor(k / across) * th : k * th;
    const put = (x: number, y: number, c: number, v: number) => { const X = tx + x, Y = ty + y; if (X < W && Y < H) sens[(Y * W + X) * N + c] = v; };
    if (comp === 7) {
      const j = ljpeg(b, off, off + cnts[k]);
      // el JPEG puede codificar la baldosa con otra forma (ancho × componentes)
      const total = j.w * j.comps;
      for (let y = 0; y < j.h; y++) for (let q = 0; q < total; q++) { const v = j.data[y * total + q], pix = y * total + q, x = (pix % (tw * N)), yy = Math.floor(pix / (tw * N)); put(Math.floor(x / N), yy, x % N, v); }
    } else {
      const rowsHere = Math.min(th, H - ty), cols = tiled ? tw : W;
      if (bps === 16) { for (let y = 0; y < rowsHere; y++) for (let x = 0; x < cols; x++) for (let c = 0; c < N; c++) { const p = off + ((y * cols + x) * N + c) * 2; put(x, y, c, t.u16(p)); } }
      else if (bps === 8) { for (let y = 0; y < rowsHere; y++) for (let x = 0; x < cols; x++) for (let c = 0; c < N; c++) put(x, y, c, b[off + (y * cols + x) * N + c]); }
      else {
        // empaquetado de N bits, de mayor a menor, cada fila empieza en un byte nuevo
        const rowBytes = Math.ceil(cols * N * bps / 8);
        for (let y = 0; y < rowsHere; y++) { let bitPos = 0; const base = off + y * rowBytes; for (let x = 0; x < cols; x++) for (let c = 0; c < N; c++) { let v = 0; for (let k2 = 0; k2 < bps; k2++) { const byte = b[base + (bitPos >> 3)]; v = (v << 1) | ((byte >> (7 - (bitPos & 7))) & 1); bitPos++; } put(x, y, c, v); } }
      }
    }
  });
  // ---- linealización, negros y blancos
  const lin = arr(50712);
  const blackArr = arr(50714) ?? [0], black = blackArr.reduce((a, v) => a + v, 0) / blackArr.length;
  const white = g(50717, (1 << bps) - 1)!;
  const area = arr(50829) ?? [0, 0, H, W]; // arriba, izquierda, abajo, derecha
  const [aT, aL, aB, aR] = area, w = aR - aL, h = aB - aT;
  const val = new Float32Array(w * h * N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < N; c++) {
    let v = sens[((y + aT) * W + x + aL) * N + c]; if (lin) v = lin[Math.min(lin.length - 1, v)];
    val[(y * w + x) * N + c] = Math.max(0, (v - black) / Math.max(1, white - black));
  }
  // ---- equilibrio de blancos de la cámara
  const neutral = arr(50728) ?? [1, 1, 1], wb = [1 / neutral[0], 1 / neutral[1], 1 / neutral[2]];
  const wbMin = Math.min(...wb); for (let i = 0; i < 3; i++) wb[i] /= wbMin;
  // ---- reconstrucción del color (mosaico de Bayer, interpolación bilineal)
  const rgb = new Float32Array(w * h * 3);
  if (cfa) {
    const dim = arr(33421) ?? [2, 2], pat = arr(33422) ?? [0, 1, 1, 2];
    const col = (x: number, y: number) => pat[((y + aT) % dim[0]) * dim[1] + ((x + aL) % dim[1])];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = [0, 0, 0], n = [0, 0, 0], here = col(x, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const c = col(X, Y);
        if (c === here && (dx || dy)) continue; // el propio color se toma solo del centro
        s[c] += val[Y * w + X]; n[c]++;
      }
      const i = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) rgb[i + c] = (n[c] ? s[c] / n[c] : 0) * wb[c];
    }
  } else for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = val[i * N + Math.min(c, N - 1)] * wb[c];
  // ---- color de la cámara → sRGB (matriz de color del DNG; se conserva el blanco)
  const cm = arr(50722) ?? arr(50721);
  let M = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (cm && cm.length >= 9) {
    M = mul3(XYZ_TO_SRGB, inv3(cm.slice(0, 9)));
    for (let r = 0; r < 3; r++) { const s = M[r * 3] + M[r * 3 + 1] + M[r * 3 + 2] || 1; for (let c = 0; c < 3; c++) M[r * 3 + c] /= s; }
  }
  const exp = Math.pow(2, g(50730, 0)!) ;
  // curva de tono: gamma sRGB con un suave contraste en S
  const tone = (v: number) => { v = v <= 0 ? 0 : v >= 1 ? 1 : v; const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; return s + (s * s * (3 - 2 * s) - s) * 0.25; };
  // ---- orientación
  const ori = (ifd0[274] as number[] | undefined)?.[0] ?? 1, swap = ori >= 5;
  const OW = swap ? h : w, OH = swap ? w : h;
  const out = new ImageData(OW, OH), o = out.data, L = beginLinear(OW, OH)?.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3, r = rgb[i] * exp, gg = rgb[i + 1] * exp, bb = rgb[i + 2] * exp;
    let X = x, Y = y;
    switch (ori) { case 2: X = w - 1 - x; break; case 3: X = w - 1 - x; Y = h - 1 - y; break; case 4: Y = h - 1 - y; break; case 5: X = y; Y = x; break; case 6: X = h - 1 - y; Y = x; break; case 7: X = h - 1 - y; Y = w - 1 - x; break; case 8: X = y; Y = w - 1 - x; break; }
    const j = (Y * OW + X) * 4;
    const R = M[0] * r + M[1] * gg + M[2] * bb, G = M[3] * r + M[4] * gg + M[5] * bb, B = M[6] * r + M[7] * gg + M[8] * bb;
    o[j] = 255 * tone(R); o[j + 1] = 255 * tone(G); o[j + 2] = 255 * tone(B); o[j + 3] = 255;
    if (L) { const q = (Y * OW + X) * 3; L[q] = encLin(R); L[q + 1] = encLin(G); L[q + 2] = encLin(B); }
  }
  return out;
}
