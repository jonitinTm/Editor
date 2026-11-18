// Formatos de imagen que el navegador no abre solo: TIFF (lectura y escritura) y TGA (lectura y escritura),
// además de la escritura de BMP e ICO. Todo se hace en el equipo.

import { Tiff } from './dng';

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** Descompresor LZW de TIFF (códigos de 9 a 12 bits, primero el bit más alto). */
function lzw(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected); let o = 0;
  const dict: Uint8Array[] = []; for (let i = 0; i < 256; i++) dict[i] = new Uint8Array([i]);
  let size = 258, width = 9, bitPos = 0, prev: Uint8Array | null = null;
  const total = src.length * 8;
  const read = () => {
    if (bitPos + width > total) return 257;
    let v = 0;
    for (let i = 0; i < width; i++) { const p = bitPos + i; v = (v << 1) | ((src[p >> 3] >> (7 - (p & 7))) & 1); }
    bitPos += width; return v;
  };
  for (;;) {
    const code = read();
    if (code === 257) break;
    if (code === 256) { size = 258; width = 9; prev = null; continue; }
    let entry: Uint8Array;
    if (code < size && (code < 256 || dict[code])) entry = dict[code];
    else if (prev) { entry = new Uint8Array(prev.length + 1); entry.set(prev); entry[prev.length] = prev[0]; }
    else break;
    if (o + entry.length > expected) { out.set(entry.subarray(0, expected - o), o); o = expected; break; }
    out.set(entry, o); o += entry.length;
    if (prev) { const n = new Uint8Array(prev.length + 1); n.set(prev); n[prev.length] = entry[0]; dict[size++] = n; }
    prev = entry;
    if (size + 1 >= (1 << width) && width < 12) width++;
  }
  return out;
}

function packbits(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected); let i = 0, o = 0;
  while (i < src.length && o < expected) {
    const n = (src[i++] << 24) >> 24;
    if (n >= 0) { for (let k = 0; k <= n && o < expected; k++) out[o++] = src[i++]; }
    else if (n !== -128) { const v = src[i++]; for (let k = 0; k < 1 - n && o < expected; k++) out[o++] = v; }
  }
  return out;
}

export function isTiff(b: Uint8Array) { return (b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42); }

/** Lee todas las páginas de un TIFF (cada una como imagen RGBA). */
export async function decodeTiff(bytes: Uint8Array): Promise<{ name: string; img: ImageData }[]> {
  const t = new Tiff(bytes);
  const pages: { name: string; img: ImageData }[] = [];
  let off = t.u32(4), guard = 0;
  while (off && off < bytes.length && guard++ < 64) {
    const { tags, next } = t.ifd(off); off = next;
    const g = (k: number, d = 0) => { const v = tags[k]; return Array.isArray(v) ? v[0] : d; };
    if (g(254) & 1) continue; // miniatura (subarchivo reducido)
    const W = g(256), H = g(257); if (!W || !H) continue;
    const spp = g(277, 1), bps = g(258, 1), comp = g(259, 1), photo = g(262, spp >= 3 ? 2 : 1), planar = g(284, 1), pred = g(317, 1);
    const fmt = g(339, 1); // 1 entero, 3 coma flotante
    if (comp === 6 || comp === 7) throw new Error('TIFF con compresión JPEG no admitida (guárdalo con LZW, ZIP o sin comprimir)');
    if (![1, 5, 8, 32946, 32773].includes(comp)) throw new Error('compresión de TIFF no admitida (' + comp + ')');
    if (![1, 8, 16, 32].includes(bps)) throw new Error(bps + ' bits por muestra no admitidos');
    const tiled = Array.isArray(tags[322]);
    const tw = tiled ? g(322) : W, th = tiled ? g(323) : g(278, H) || H;
    const offs = (tags[tiled ? 324 : 273] as number[]) ?? [], cnts = (tags[tiled ? 325 : 279] as number[]) ?? [];
    const planes = planar === 2 ? spp : 1, sppChunk = planar === 2 ? 1 : spp;
    const rowBytes = Math.ceil(tw * sppChunk * bps / 8), bytesPerSample = bps / 8;
    // muestras normalizadas a 0..1 por canal
    const S = new Float32Array(W * H * spp);
    const across = Math.ceil(W / tw), down = Math.ceil(H / th), perPlane = across * down;
    for (let pl = 0; pl < planes; pl++) for (let ci = 0; ci < perPlane; ci++) {
      const k = pl * perPlane + ci; if (k >= offs.length) break;
      const raw = bytes.subarray(offs[k], offs[k] + (cnts[k] ?? 0));
      const need = rowBytes * th;
      let d = comp === 1 ? raw : comp === 5 ? lzw(raw, need) : comp === 32773 ? packbits(raw, need) : await inflate(raw);
      if (d.length < need) { const e = new Uint8Array(need); e.set(d); d = e; }
      const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
      const x0 = (ci % across) * tw, y0 = Math.floor(ci / across) * th;
      for (let y = 0; y < th; y++) {
        const yy = y0 + y; if (yy >= H) break;
        const prevVal = new Float64Array(sppChunk);
        for (let x = 0; x < tw; x++) for (let c = 0; c < sppChunk; c++) {
          const si = x * sppChunk + c; let v: number;
          if (bps === 1) v = (d[y * rowBytes + (si >> 3)] >> (7 - (si & 7))) & 1;
          else if (bps === 8) v = d[y * rowBytes + si];
          else if (bps === 16) v = dv.getUint16(y * rowBytes + si * 2, t.le);
          else v = fmt === 3 ? dv.getFloat32(y * rowBytes + si * 4, t.le) : dv.getUint32(y * rowBytes + si * 4, t.le);
          if (pred === 2 && x > 0 && bps >= 8 && fmt !== 3) { const m = bps === 8 ? 256 : bps === 16 ? 65536 : 4294967296; v = (v + prevVal[c]) % m; }
          prevVal[c] = v;
          const xx = x0 + x; if (xx >= W) continue;
          const max = bps === 1 ? 1 : fmt === 3 ? 1 : 2 ** bps - 1;
          S[(yy * W + xx) * spp + (planar === 2 ? pl : c)] = v / max;
        }
      }
      void bytesPerSample;
    }
    const img = new ImageData(W, H), o = img.data;
    const extra = Array.isArray(tags[338]) ? (tags[338] as number[]) : [];
    const pal = tags[320] as number[] | undefined;
    const color = photo === 2 ? 3 : photo === 5 ? 4 : 1;
    const hasAlpha = spp > color && (extra.length ? extra[0] === 1 || extra[0] === 2 : spp === color + 1);
    const premult = extra[0] === 1;
    const gam = (v: number) => fmt === 3 ? (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) : v;
    for (let i = 0; i < W * H; i++) {
      const s = i * spp; let r: number, gg: number, b: number;
      const a = hasAlpha ? Math.max(0, Math.min(1, S[s + color])) : 1;
      if (photo === 3 && pal) { const idx = Math.round(S[s] * (2 ** bps - 1)), n = pal.length / 3; r = pal[idx] / 65535; gg = pal[n + idx] / 65535; b = pal[2 * n + idx] / 65535; }
      else if (photo === 2) { r = gam(S[s]); gg = gam(S[s + 1]); b = gam(S[s + 2]); }
      else if (photo === 5) { const k = S[s + 3]; r = (1 - S[s]) * (1 - k); gg = (1 - S[s + 1]) * (1 - k); b = (1 - S[s + 2]) * (1 - k); }
      else { let v = gam(S[s]); if (photo === 0) v = 1 - v; r = gg = b = v; }
      if (premult && a > 0) { r /= a; gg /= a; b /= a; }
      o[i * 4] = Math.round(Math.max(0, Math.min(1, r)) * 255); o[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, gg)) * 255);
      o[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255); o[i * 4 + 3] = Math.round(a * 255);
    }
    const nm = typeof tags[285] === 'string' ? tags[285] as string : `Página ${pages.length + 1}`;
    pages.push({ name: nm, img });
  }
  if (!pages.length) throw new Error('el TIFF no contiene imágenes legibles');
  return pages;
}

/** TIFF RGBA de 8 bits, comprimido con ZIP (Deflate) y predictor horizontal: lo abren Photoshop, GIMP, etc. */
export async function encodeTiff(img: ImageData, dpi = 72): Promise<Blob> {
  const { width: W, height: H, data } = img;
  const pix = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = W - 1; x >= 0; x--) for (let c = 0; c < 4; c++) {
    const i = (y * W + x) * 4 + c; pix[i] = x ? (data[i] - data[i - 4]) & 255 : data[i];
  }
  const z = await deflate(pix);
  const entries: [number, number, number[]][] = [
    [256, 4, [W]], [257, 4, [H]], [258, 3, [8, 8, 8, 8]], [259, 3, [8]], [262, 3, [2]], [273, 4, [0]], [277, 3, [4]],
    [278, 4, [H]], [279, 4, [z.length]], [282, 5, [dpi, 1]], [283, 5, [dpi, 1]], [284, 3, [1]], [296, 3, [2]], [317, 3, [2]], [338, 3, [2]]];
  const ifdOff = 8, ifdLen = 2 + entries.length * 12 + 4;
  let extraOff = ifdOff + ifdLen; const extra: number[] = [];
  const head = new Uint8Array(extraOff + 64), dv = new DataView(head.buffer);
  head.set([0x49, 0x49, 42, 0]); dv.setUint32(4, ifdOff, true); dv.setUint16(ifdOff, entries.length, true);
  const extraBuf = new DataView(new ArrayBuffer(64)); let ex = 0;
  let stripPos = 0;
  entries.forEach(([tag, type, vals], i) => {
    const e = ifdOff + 2 + i * 12; dv.setUint16(e, tag, true); dv.setUint16(e + 2, type, true);
    const count = type === 5 ? vals.length / 2 : vals.length; dv.setUint32(e + 4, count, true);
    const size = type === 3 ? 2 : 4, bytes = type === 5 ? 8 * count : size * count;
    const put = (v: DataView, at: number) => vals.forEach((x, k) => type === 3 ? v.setUint16(at + k * 2, x, true) : v.setUint32(at + k * 4, x, true));
    if (bytes <= 4) { put(dv, e + 8); if (tag === 273) stripPos = e + 8; }
    else { dv.setUint32(e + 8, extraOff + ex, true); put(extraBuf, ex); ex += bytes; }
  });
  void extra;
  head.set(new Uint8Array(extraBuf.buffer, 0, ex), extraOff); extraOff += ex;
  dv.setUint32(stripPos, extraOff, true);
  return new Blob([head.subarray(0, extraOff), z], { type: 'image/tiff' });
}

// ---- TGA --------------------------------------------------------------------------------------

export function decodeTga(b: Uint8Array): ImageData {
  const idLen = b[0], cmType = b[1], type = b[2];
  const cmFirst = b[3] | (b[4] << 8), cmLen = b[5] | (b[6] << 8), cmBits = b[7];
  const W = b[12] | (b[13] << 8), H = b[14] | (b[15] << 8), bpp = b[16], desc = b[17];
  if (!W || !H || ![1, 2, 3, 9, 10, 11].includes(type)) throw new Error('TGA no válido');
  let p = 18 + idLen;
  const cm: number[][] = [];
  if (cmType === 1) { const cb = Math.ceil(cmBits / 8); for (let i = 0; i < cmLen; i++, p += cb) cm[cmFirst + i] = px(b, p, cmBits); }
  const bypp = Math.ceil(bpp / 8), n = W * H, src = new Uint8Array(n * bypp);
  if (type >= 9) {
    let o = 0;
    while (o < src.length && p < b.length) {
      const h = b[p++], cnt = (h & 127) + 1;
      if (h & 128) { for (let k = 0; k < cnt; k++) src.set(b.subarray(p, p + bypp), o + k * bypp); p += bypp; }
      else { src.set(b.subarray(p, p + cnt * bypp), o); p += cnt * bypp; }
      o += cnt * bypp;
    }
  } else src.set(b.subarray(p, p + src.length));
  const img = new ImageData(W, H), o = img.data, top = (desc & 32) !== 0, right = (desc & 16) !== 0;
  const alphaBits = desc & 15;
  for (let i = 0; i < n; i++) {
    const x = i % W, y = Math.floor(i / W);
    const dx = right ? W - 1 - x : x, dy = top ? y : H - 1 - y, d = (dy * W + dx) * 4;
    let c: number[];
    if (type === 1 || type === 9) c = cm[src[i * bypp] | (bypp > 1 ? src[i * bypp + 1] << 8 : 0)] ?? [0, 0, 0, 255];
    else if (type === 3 || type === 11) { const v = src[i * bypp]; c = [v, v, v, bypp > 1 ? src[i * bypp + 1] : 255]; }
    else c = px(src, i * bypp, bpp);
    o[d] = c[0]; o[d + 1] = c[1]; o[d + 2] = c[2]; o[d + 3] = bpp === 32 && alphaBits === 0 && type !== 3 ? 255 : c[3];
  }
  // si todo el alfa es 0 (muchos programas lo dejan así), la imagen es opaca
  let anyA = false; for (let i = 3; i < o.length; i += 4) if (o[i]) { anyA = true; break; }
  if (!anyA) for (let i = 3; i < o.length; i += 4) o[i] = 255;
  return img;
}
function px(b: Uint8Array, p: number, bits: number): number[] {
  if (bits === 15 || bits === 16) { const v = b[p] | (b[p + 1] << 8); return [((v >> 10) & 31) * 255 / 31 | 0, ((v >> 5) & 31) * 255 / 31 | 0, (v & 31) * 255 / 31 | 0, bits === 16 && !(v & 0x8000) ? 255 : 255]; }
  return [b[p + 2], b[p + 1], b[p], bits === 32 ? b[p + 3] : 255];
}

export function encodeTga(img: ImageData): Blob {
  const { width: W, height: H, data } = img;
  const out = new Uint8Array(18 + W * H * 4);
  out[2] = 2; out[12] = W & 255; out[13] = W >> 8; out[14] = H & 255; out[15] = H >> 8; out[16] = 32; out[17] = 8 | 32;
  for (let i = 0; i < W * H; i++) { out[18 + i * 4] = data[i * 4 + 2]; out[19 + i * 4] = data[i * 4 + 1]; out[20 + i * 4] = data[i * 4]; out[21 + i * 4] = data[i * 4 + 3]; }
  return new Blob([out], { type: 'image/x-tga' });
}

// ---- BMP e ICO --------------------------------------------------------------------------------

export function encodeBmp(img: ImageData): Blob {
  const { width: W, height: H, data } = img;
  const size = 14 + 108 + W * H * 4, b = new Uint8Array(size), v = new DataView(b.buffer);
  b[0] = 0x42; b[1] = 0x4d; v.setUint32(2, size, true); v.setUint32(10, 14 + 108, true);
  v.setUint32(14, 108, true); v.setInt32(18, W, true); v.setInt32(22, -H, true); v.setUint16(26, 1, true); v.setUint16(28, 32, true);
  v.setUint32(30, 3, true); v.setUint32(34, W * H * 4, true); v.setUint32(38, 2835, true); v.setUint32(42, 2835, true);
  v.setUint32(54, 0x00ff0000, true); v.setUint32(58, 0x0000ff00, true); v.setUint32(62, 0x000000ff, true); v.setUint32(66, 0xff000000, true);
  v.setUint32(70, 0x73524742, true); // 'sRGB'
  for (let i = 0; i < W * H; i++) { const o = 122 + i * 4; b[o] = data[i * 4 + 2]; b[o + 1] = data[i * 4 + 1]; b[o + 2] = data[i * 4]; b[o + 3] = data[i * 4 + 3]; }
  return new Blob([b], { type: 'image/bmp' });
}

/** Icono .ico con varios tamaños (cada uno guardado como PNG dentro, como hacen Windows Vista y posteriores). */
export async function encodeIco(src: HTMLCanvasElement, sizes = [16, 32, 48, 64, 128, 256]): Promise<Blob> {
  const pngs: Uint8Array[] = [];
  for (const s of sizes) {
    const c = document.createElement('canvas'); c.width = c.height = s;
    const x = c.getContext('2d')!; x.imageSmoothingQuality = 'high';
    const k = Math.min(s / src.width, s / src.height), w = src.width * k, h = src.height * k;
    x.drawImage(src, (s - w) / 2, (s - h) / 2, w, h);
    const blob: Blob = await new Promise(r => c.toBlob(b => r(b!), 'image/png'));
    pngs.push(new Uint8Array(await blob.arrayBuffer()));
  }
  const head = new Uint8Array(6 + 16 * sizes.length), v = new DataView(head.buffer);
  v.setUint16(2, 1, true); v.setUint16(4, sizes.length, true);
  let off = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16; head[e] = s >= 256 ? 0 : s; head[e + 1] = s >= 256 ? 0 : s; v.setUint16(e + 4, 1, true); v.setUint16(e + 6, 32, true);
    v.setUint32(e + 8, pngs[i].length, true); v.setUint32(e + 12, off, true); off += pngs[i].length;
  });
  return new Blob([head, ...pngs], { type: 'image/x-icon' });
}
