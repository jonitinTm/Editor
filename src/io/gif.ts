// Codificador de GIF animado escrito desde cero: paleta de 255 colores por
// corte de mediana (más un índice transparente) y compresión LZW.

export interface GifFrame { canvas: HTMLCanvasElement; delay: number; }

/** Paleta común a todos los cuadros (corte de mediana sobre un histograma de 15 bits). */
export function buildPalette(frames: ImageData[], maxColors: number): { palette: number[][]; lookup: Int16Array } {
  const hist = new Uint32Array(32768);
  const sr = new Float64Array(32768), sg = new Float64Array(32768), sb = new Float64Array(32768); // suma del color real de cada casilla
  for (const f of frames) { const d = f.data, step = Math.max(1, Math.floor(d.length / 4 / 200000)) * 4; for (let i = 0; i < d.length; i += step) if (d[i + 3] >= 128) { const k = (d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | d[i + 2] >> 3; hist[k]++; sr[k] += d[i]; sg[k] += d[i + 1]; sb[k] += d[i + 2]; } }
  type Box = { idx: number[]; };
  const all: number[] = []; for (let i = 0; i < 32768; i++) if (hist[i]) all.push(i);
  const ch = (v: number, c: number) => c === 0 ? v >> 10 : c === 1 ? (v >> 5) & 31 : v & 31;
  const boxes: Box[] = [{ idx: all }];
  while (boxes.length < maxColors) {
    // se parte la caja con más píxeles por su canal más extendido
    let best = -1, bestCount = 0;
    boxes.forEach((b, i) => { if (b.idx.length < 2) return; let n = 0; for (const v of b.idx) n += hist[v]; if (n > bestCount) { bestCount = n; best = i; } });
    if (best < 0) break;
    const b = boxes[best]; let axis = 0, range = -1;
    for (let c = 0; c < 3; c++) { let mn = 31, mx = 0; for (const v of b.idx) { const x = ch(v, c); if (x < mn) mn = x; if (x > mx) mx = x; } if (mx - mn > range) { range = mx - mn; axis = c; } }
    b.idx.sort((p, q) => ch(p, axis) - ch(q, axis));
    let acc = 0, cut = 1; for (let i = 0; i < b.idx.length; i++) { acc += hist[b.idx[i]]; if (acc >= bestCount / 2) { cut = Math.max(1, Math.min(b.idx.length - 1, i + 1)); break; } }
    boxes.splice(best, 1, { idx: b.idx.slice(0, cut) }, { idx: b.idx.slice(cut) });
  }
  const palette: number[][] = [], lookup = new Int16Array(32768).fill(-1);
  boxes.forEach((b, pi) => {
    let r = 0, g = 0, bl = 0, n = 0;
    for (const v of b.idx) { r += sr[v]; g += sg[v]; bl += sb[v]; n += hist[v]; lookup[v] = pi; }
    palette.push(n ? [r / n, g / n, bl / n].map(Math.round) : [0, 0, 0]);
  });
  return { palette, lookup };
}

function lzw(indices: Uint8Array, minCode: number): number[] {
  const out: number[] = []; let cur = 0, bits = 0;
  const emit = (code: number, size: number) => { cur |= code << bits; bits += size; while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; } };
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, next = eoi + 1, dict = new Map<number, number>();
  emit(clear, size);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prefix << 8 | k, hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix, size);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << size) && size < 12) size++; }
    else { emit(clear, size); dict = new Map(); next = eoi + 1; size = minCode + 1; }
    prefix = k;
  }
  emit(prefix, size); emit(eoi, size);
  if (bits > 0) out.push(cur & 255);
  return out;
}

export function encodeGif(frames: GifFrame[], loop = true): Blob {
  const w = frames[0].canvas.width, h = frames[0].canvas.height;
  const datas = frames.map(f => f.canvas.getContext('2d')!.getImageData(0, 0, w, h));
  const { palette, lookup } = buildPalette(datas, 255);
  const TRANSPARENT = 255;
  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 255, (v >> 8) & 255);
  out.push(...[...'GIF89a'].map(c => c.charCodeAt(0))); u16(w); u16(h); out.push(0xf7, 0, 0);
  for (let i = 0; i < 256; i++) { const c = palette[i] ?? [0, 0, 0]; out.push(c[0], c[1], c[2]); }
  if (loop) { out.push(0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map(c => c.charCodeAt(0)), 3, 1); u16(0); out.push(0); }
  const nearest = (r: number, g: number, b: number) => { let bi = 0, bd = 1e9; for (let i = 0; i < palette.length; i++) { const p = palette[i], d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };
  for (let f = 0; f < frames.length; f++) {
    const d = datas[f].data, idx = new Uint8Array(w * h); let hasAlpha = false;
    for (let i = 0, j = 0; i < idx.length; i++, j += 4) {
      if (d[j + 3] < 128) { idx[i] = TRANSPARENT; hasAlpha = true; continue; }
      const key = (d[j] >> 3) << 10 | (d[j + 1] >> 3) << 5 | d[j + 2] >> 3;
      let pi = lookup[key]; if (pi < 0) { pi = nearest(d[j], d[j + 1], d[j + 2]); lookup[key] = pi; }
      idx[i] = pi;
    }
    out.push(0x21, 0xf9, 4, (2 << 2) | (hasAlpha ? 1 : 0)); u16(Math.max(2, Math.round(frames[f].delay / 10))); out.push(TRANSPARENT, 0);
    out.push(0x2c); u16(0); u16(0); u16(w); u16(h); out.push(0, 8);
    const data = lzw(idx, 8);
    for (let i = 0; i < data.length; i += 255) { const n = Math.min(255, data.length - i); out.push(n); for (let k = 0; k < n; k++) out.push(data[i + k]); }
    out.push(0);
  }
  out.push(0x3b);
  return new Blob([Uint8Array.from(out)], { type: 'image/gif' });
}

/** Cuadros de un GIF animado (si el navegador lo permite). null = no animado o no disponible. */
export async function decodeGifFrames(file: Blob): Promise<GifFrame[] | null> {
  const ID = (window as any).ImageDecoder;
  if (!ID) return null;
  try {
    const dec = new ID({ data: await file.arrayBuffer(), type: 'image/gif' });
    await dec.tracks.ready;
    const n = dec.tracks.selectedTrack.frameCount;
    if (n < 2) return null;
    const out: GifFrame[] = [];
    for (let i = 0; i < Math.min(n, 300); i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const c = document.createElement('canvas'); c.width = image.displayWidth; c.height = image.displayHeight;
      c.getContext('2d')!.drawImage(image, 0, 0);
      out.push({ canvas: c, delay: Math.max(20, Math.round((image.duration ?? 100000) / 1000)) });
      image.close();
    }
    return out;
  } catch { return null; }
}
