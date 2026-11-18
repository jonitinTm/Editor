// Pinceles de Photoshop (.abr): se leen las puntas con imagen (versiones 1, 2 y 6 a 10). Cada punta es una
// imagen en escala de grises donde el valor indica cuánto pinta. Las puntas «calculadas» (redondas) se omiten
// porque Editor ya tiene las suyas.

function packbitsRow(b: Uint8Array, p: number, end: number, out: Uint8Array, o: number, n: number) {
  let x = 0;
  while (p < end && x < n) {
    const c = (b[p] << 24) >> 24; p++;
    if (c >= 0) { for (let k = 0; k <= c && x < n; k++) out[o + x++] = b[p++]; }
    else if (c !== -128) { const v = b[p++]; for (let k = 0; k < 1 - c && x < n; k++) out[o + x++] = v; }
  }
}

/** Imagen de una punta: rectángulo, profundidad, compresión y datos. */
function readBitmap(b: Uint8Array, v: DataView, p: number, end: number, rect32 = true): Uint8Array & { w?: number; h?: number } | null {
  let top: number, left: number, bottom: number, right: number;
  if (rect32) { top = v.getInt32(p); left = v.getInt32(p + 4); bottom = v.getInt32(p + 8); right = v.getInt32(p + 12); p += 16; }
  else { top = v.getInt16(p); left = v.getInt16(p + 2); bottom = v.getInt16(p + 4); right = v.getInt16(p + 6); p += 8; }
  const w = right - left, h = bottom - top;
  if (w <= 0 || h <= 0 || w > 10000 || h > 10000) return null;
  const depth = v.getUint16(p); p += 2; const comp = b[p]; p += 1;
  if (depth !== 8 && depth !== 16) return null;
  const bpp = depth / 8, row = w * bpp, raw = new Uint8Array(row * h);
  if (comp === 0) raw.set(b.subarray(p, Math.min(end, p + raw.length)));
  else {
    const counts: number[] = []; for (let r = 0; r < h; r++) { counts.push(v.getUint16(p)); p += 2; }
    for (let r = 0; r < h; r++) { packbitsRow(b, p, Math.min(end, p + counts[r]), raw, r * row, row); p += counts[r]; }
  }
  let out: Uint8Array;
  if (bpp === 1) out = raw; else { out = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) out[i] = raw[i * 2]; }
  return Object.assign(out, { w, h });
}

function toCanvas(px: Uint8Array & { w?: number; h?: number }): HTMLCanvasElement {
  const w = px.w!, h = px.h!, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d')!, img = x.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = px[i]; }
  x.putImageData(img, 0, 0); return c;
}

/** Nombres de los pinceles en el descriptor («Nm  » de tipo texto), en orden. */
function descNames(b: Uint8Array, v: DataView, p: number, end: number): string[] {
  const names: string[] = [];
  for (let i = p; i + 12 < end; i++) {
    if (b[i] === 0x4e && b[i + 1] === 0x6d && b[i + 2] === 0x20 && b[i + 3] === 0x20 && b[i + 4] === 0x54 && b[i + 5] === 0x45 && b[i + 6] === 0x58 && b[i + 7] === 0x54) {
      const n = v.getUint32(i + 8); if (n > 500 || i + 12 + n * 2 > end) continue;
      let s = ''; for (let k = 0; k < n; k++) { const c = v.getUint16(i + 12 + k * 2); if (c) s += String.fromCharCode(c); }
      names.push(s); i += 12 + n * 2 - 1;
    }
  }
  return names;
}

export function readAbr(buf: ArrayBuffer): { name: string; canvas: HTMLCanvasElement }[] {
  const b = new Uint8Array(buf), v = new DataView(buf), version = v.getUint16(0), out: { name: string; canvas: HTMLCanvasElement }[] = [];
  if (version === 1 || version === 2) {
    const count = v.getUint16(2); let p = 4;
    for (let i = 0; i < count && p + 6 <= b.length; i++) {
      const type = v.getUint16(p), size = v.getUint32(p + 2); p += 6; const end = p + size;
      if (type === 2) {
        let q = p + 4 + 2; // varios, espaciado
        let name = '';
        if (version === 2) { const n = v.getUint32(q); q += 4; for (let k = 0; k < n; k++) { const c = v.getUint16(q + k * 2); if (c) name += String.fromCharCode(c); } q += n * 2; }
        q += 1 + 8; // suavizado y rectángulo corto
        const px = readBitmap(b, v, q, end, true);
        if (px) out.push({ name: name || `Pincel ${out.length + 1}`, canvas: toCanvas(px) });
      }
      p = end;
    }
    return out;
  }
  if (version < 6 || version > 10) throw new Error('versión de pinceles no admitida (' + version + ')');
  const minor = v.getUint16(2); let p = 4; let names: string[] = [];
  const samples: HTMLCanvasElement[] = [];
  while (p + 12 <= b.length) {
    if (String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]) !== '8BIM') break;
    const key = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]), size = v.getUint32(p + 8);
    const start = p + 12, end = Math.min(b.length, start + size);
    if (key === 'samp') {
      let q = start;
      while (q + 4 <= end) {
        let len = v.getUint32(q); q += 4; while (len & 3) len++;
        const bEnd = Math.min(q + len, end);
        try {
          const il = b[q]; let r = q + 1 + il; r += minor === 1 ? 10 : 264;
          const px = readBitmap(b, v, r, bEnd, true); if (px) samples.push(toCanvas(px));
        } catch { /* punta dañada */ }
        q = bEnd;
      }
    } else if (key === 'desc') names = descNames(b, v, start, end);
    p = end + (size & 1);
  }
  // los nombres del descriptor solo se usan si cuadran uno a uno con las puntas
  const useNames = names.length === samples.length;
  samples.forEach((c, i) => out.push({ name: (useNames && names[i]) || `Pincel ${i + 1}`, canvas: c }));
  return out;
}
