// Lectura y escritura de archivos PSD (Photoshop), escrito desde cero según
// la especificación pública del formato. Admite documentos RGB o grises de
// 8 bits con capas, grupos, máscaras, opacidad, visibilidad y modos de fusión.
// Lo que el PSD guarda de forma propia (texto editable, objetos inteligentes,
// efectos) se lee como píxeles.

import { EditorDocument } from '../core/document';
import { GroupLayer, Layer, LayerMask, RasterLayer, AdjustmentLayer, BlendMode, isRaster, hasStyles } from '../core/layers';
import { cloneCanvas, contentBounds, ctx2d, makeCanvas, getPixels } from '../core/canvas';
import { renderStyles } from '../core/compositor';

const BLEND_KEYS: [string, BlendMode][] = [
  ['norm', 'source-over'], ['dark', 'darken'], ['mul ', 'multiply'], ['idiv', 'color-burn'], ['lite', 'lighten'],
  ['scrn', 'screen'], ['div ', 'color-dodge'], ['lddg', 'lighter'], ['over', 'overlay'], ['sLit', 'soft-light'],
  ['hLit', 'hard-light'], ['diff', 'difference'], ['smud', 'exclusion'], ['hue ', 'hue'], ['sat ', 'saturation'],
  ['colr', 'color'], ['lum ', 'luminosity'],
];
const keyToBlend = new Map(BLEND_KEYS);
const blendToKey = new Map(BLEND_KEYS.map(([k, b]) => [b, k]));

// ---- Lectura ------------------------------------------------------------------

class Reader {
  pos = 0;
  view: DataView;
  constructor(public buf: ArrayBuffer) { this.view = new DataView(buf); }
  u8() { return this.view.getUint8(this.pos++); }
  u16() { const v = this.view.getUint16(this.pos); this.pos += 2; return v; }
  i16() { const v = this.view.getInt16(this.pos); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos); this.pos += 4; return v; }
  i32() { const v = this.view.getInt32(this.pos); this.pos += 4; return v; }
  str(n: number) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8()); return s; }
  bytes(n: number) { const b = new Uint8Array(this.buf, this.pos, n); this.pos += n; return b; }
  /** Salta un bloque precedido por su longitud (4 bytes). */
  skipBlock() { const n = this.u32(); this.pos += n; }
}

/** Descomprime un canal (sin comprimir o RLE PackBits) a w×h bytes. */
function readChannel(r: Reader, w: number, h: number, end: number): Uint8Array | null {
  const out = new Uint8Array(w * h);
  if (w === 0 || h === 0) return out;
  const comp = r.u16();
  if (comp === 0) { out.set(r.bytes(Math.min(w * h, end - r.pos))); return out; }
  if (comp !== 1) return null; // ZIP no admitido
  const counts: number[] = [];
  for (let y = 0; y < h; y++) counts.push(r.u16());
  for (let y = 0; y < h; y++) { unpackBits(r.bytes(counts[y]), out, y * w, w); }
  return out;
}
function unpackBits(src: Uint8Array, dst: Uint8Array, off: number, len: number) {
  let i = 0, o = off; const end = off + len;
  while (i < src.length && o < end) {
    const n = src[i++];
    if (n < 128) { for (let k = 0; k <= n && o < end; k++) dst[o++] = src[i++]; }
    else if (n > 128) { const v = src[i++]; for (let k = 0; k < 257 - n && o < end; k++) dst[o++] = v; }
  }
}

interface Rec {
  top: number; left: number; bottom: number; right: number;
  channels: { id: number; len: number }[];
  blend: string; opacity: number; flags: number; name: string;
  mask: { top: number; left: number; bottom: number; right: number; def: number; flags: number } | null;
  section: number; keys: string[];
}

export interface PsdResult { doc: EditorDocument; warnings: string[]; }

export function readPsd(buf: ArrayBuffer, name: string): PsdResult {
  const r = new Reader(buf);
  const warnings: string[] = [];
  if (r.str(4) !== '8BPS') throw new Error('No es un archivo PSD válido');
  const version = r.u16();
  if (version !== 1) throw new Error('Los archivos PSB (documento grande) aún no se pueden abrir');
  r.pos += 6;
  const nch = r.u16(), H = r.u32(), W = r.u32(), depth = r.u16(), mode = r.u16();
  if (mode !== 3 && mode !== 1) throw new Error('Solo se admiten PSD en modo RGB o escala de grises (este usa otro modo de color, como CMYK o indexado)');
  r.skipBlock();              // datos de modo de color
  r.skipBlock();              // recursos de imagen
  const lmLen = r.u32();
  const lmEnd = r.pos + lmLen;
  const doc = new EditorDocument(name, W, H);
  const gray = mode === 1;

  if (lmLen > 0 && depth === 8) {
    const liLen = r.u32();
    if (liLen > 0) {
      const count = Math.abs(r.i16());
      const recs: Rec[] = [];
      for (let i = 0; i < count; i++) {
        const top = r.i32(), left = r.i32(), bottom = r.i32(), right = r.i32();
        const n = r.u16();
        const channels = []; for (let c = 0; c < n; c++) channels.push({ id: r.i16(), len: r.u32() });
        r.pos += 4; // '8BIM'
        const blend = r.str(4), opacity = r.u8(); r.u8(); const flags = r.u8(); r.u8();
        const extraLen = r.u32(); const extraEnd = r.pos + extraLen;
        let mask: Rec['mask'] = null;
        const mLen = r.u32(), mEnd = r.pos + mLen;
        if (mLen >= 18) mask = { top: r.i32(), left: r.i32(), bottom: r.i32(), right: r.i32(), def: r.u8(), flags: r.u8() };
        r.pos = mEnd;
        r.skipBlock(); // rangos de fusión
        const nl = r.u8(); let lname = r.str(nl); r.pos += (4 - ((nl + 1) % 4)) % 4;
        let section = 0; const keys: string[] = [];
        while (r.pos + 12 <= extraEnd) {
          r.pos += 4; const key = r.str(4); const len = r.u32(); const end = r.pos + len + (len & 1);
          keys.push(key);
          if (key === 'luni') { const cn = r.u32(); let s = ''; for (let k = 0; k < cn; k++) s += String.fromCharCode(r.u16()); lname = s.replace(/\0+$/, ''); }
          else if (key === 'lsct' || key === 'lsdk') section = r.u32();
          r.pos = end;
        }
        r.pos = extraEnd;
        recs.push({ top, left, bottom, right, channels, blend, opacity, flags, name: lname, mask, section, keys });
      }
      // Datos de píxeles, en el mismo orden
      const stack: GroupLayer[] = [doc.root];
      let skippedAdj = 0, zip = 0;
      for (const rec of recs) {
        const w = Math.max(0, rec.right - rec.left), h = Math.max(0, rec.bottom - rec.top);
        const data: Record<number, Uint8Array | null> = {};
        for (const ch of rec.channels) {
          const end = r.pos + ch.len;
          if (ch.id === -2 && rec.mask) data[-2] = readChannel(r, Math.max(0, rec.mask.right - rec.mask.left), Math.max(0, rec.mask.bottom - rec.mask.top), end);
          else if (ch.id >= -1 && ch.id <= 2) data[ch.id] = readChannel(r, w, h, end);
          r.pos = end;
        }
        if (Object.values(data).some(v => v === null)) zip++;
        let layer: Layer;
        if (rec.section === 3) { stack.push(new GroupLayer('')); continue; }
        if (rec.section === 1 || rec.section === 2) {
          const g = stack.length > 1 ? stack.pop()! : new GroupLayer('');
          g.name = rec.name || 'Grupo'; g.expanded = rec.section === 1;
          layer = g;
        } else {
          const ADJ = ['brit', 'levl', 'curv', 'hue2', 'blwh', 'expA', 'vibA', 'blnc', 'phfl', 'mixr', 'clrL', 'post', 'thrs', 'grdm', 'selc', 'SoCo', 'GdFl', 'PtFl'];
          if (w === 0 && h === 0 && rec.keys.includes('nvrt')) layer = new AdjustmentLayer(rec.name || 'Invertir', 'invert', {});
          else if (w === 0 && h === 0 && rec.keys.some(k => ADJ.includes(k))) { skippedAdj++; continue; }
          else {
            const l = new RasterLayer(rec.name || 'Capa', W, H);
            if (w > 0 && h > 0) {
              const img = new ImageData(w, h), d = img.data;
              const R = data[0], G = gray ? data[0] : data[1], B = gray ? data[0] : data[2], A = data[-1];
              for (let i = 0, j = 0; i < w * h; i++, j += 4) { d[j] = R ? R[i] : 0; d[j + 1] = G ? G[i] : 0; d[j + 2] = B ? B[i] : 0; d[j + 3] = A ? A[i] : 255; }
              const tmp = makeCanvas(w, h); ctx2d(tmp).putImageData(img, 0, 0);
              l.placeFull(tmp, rec.left, rec.top, W, H);
            }
            layer = l;
          }
        }
        layer.opacity = rec.opacity / 255;
        layer.visible = !(rec.flags & 2);
        layer.blendMode = keyToBlend.get(rec.blend) ?? 'source-over';
        if (rec.mask && data[-2]) {
          const m = rec.mask, mw = m.right - m.left, mh = m.bottom - m.top;
          const lm = new LayerMask(W, H, m.def ? 'white' : 'black');
          if (mw > 0 && mh > 0) {
            const img = new ImageData(mw, mh), d = img.data, src = data[-2]!;
            for (let i = 0, j = 0; i < mw * mh; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = 255; d[j + 3] = src[i]; }
            const tmp = makeCanvas(mw, mh); ctx2d(tmp).putImageData(img, 0, 0);
            const c = ctx2d(lm.canvas); c.clearRect(m.left, m.top, mw, mh); c.drawImage(tmp, m.left, m.top);
          }
          lm.enabled = !(m.flags & 2); lm.touch();
          layer.mask = lm;
        }
        stack[stack.length - 1].add(layer);
      }
      while (stack.length > 1) { const g = stack.pop()!; g.name ||= 'Grupo'; stack[stack.length - 1].add(g); }
      if (skippedAdj) warnings.push(`${skippedAdj} capa(s) de ajuste de Photoshop no se han importado`);
      if (zip) warnings.push(`${zip} capa(s) usan una compresión no admitida y pueden aparecer vacías`);
      if (recs.some(x => x.keys.includes('TySh'))) warnings.push('El texto se ha importado como píxeles (no editable)');
      if (recs.some(x => x.keys.includes('lfx2') || x.keys.includes('lrFX'))) warnings.push('Los efectos de capa de Photoshop no se han importado');
    }
  }
  if (doc.root.children.length === 0) {
    // Sin capas (o 16/32 bits): se usa la imagen combinada del final del archivo
    if (depth !== 8) warnings.push(`El archivo es de ${depth} bits por canal: se abre acoplado y convertido a 8 bits`);
    r.pos = lmEnd;
    const comp = r.u16();
    if (comp > 1) throw new Error('Compresión de imagen no admitida en este PSD');
    const bps = depth / 8, n = W * H;
    const planes: Uint8Array[] = [];
    let counts: number[] = [];
    if (comp === 1) for (let i = 0; i < nch * H; i++) counts.push(r.u16());
    for (let c = 0; c < nch; c++) {
      const row = W * bps, plane = new Uint8Array(n);
      const line = new Uint8Array(row);
      for (let y = 0; y < H; y++) {
        if (comp === 1) unpackBits(r.bytes(counts[c * H + y]), line, 0, row); else line.set(r.bytes(row));
        if (depth === 32) { const dv = new DataView(line.buffer); for (let x = 0; x < W; x++) plane[y * W + x] = Math.max(0, Math.min(255, Math.pow(dv.getFloat32(x * 4), 1 / 2.2) * 255)); }
        else for (let x = 0; x < W; x++) plane[y * W + x] = line[x * bps];
      }
      planes.push(plane);
    }
    const img = new ImageData(W, H), d = img.data;
    const colorCh = gray ? 1 : 3;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      d[j] = planes[0][i]; d[j + 1] = planes[gray ? 0 : 1]?.[i] ?? 0; d[j + 2] = planes[gray ? 0 : 2]?.[i] ?? 0;
      d[j + 3] = nch > colorCh && lmLen > 0 ? planes[colorCh][i] : 255;
    }
    const l = new RasterLayer('Fondo', W, H); ctx2d(l.canvas).putImageData(img, 0, 0); l.touch();
    doc.root.add(l);
  }
  doc.setActive(doc.allLayers().pop() ?? null, false);
  return { doc, warnings };
}

// ---- Escritura ------------------------------------------------------------------

class Writer {
  private chunks: Uint8Array[] = [];
  private cur = new Uint8Array(1 << 16); private n = 0;
  size = 0;
  private room(k: number) {
    if (this.n + k > this.cur.length) { this.chunks.push(this.cur.subarray(0, this.n)); this.cur = new Uint8Array(Math.max(1 << 16, k)); this.n = 0; }
  }
  u8(v: number) { this.room(1); this.cur[this.n++] = v; this.size++; }
  u16(v: number) { this.u8((v >> 8) & 255); this.u8(v & 255); }
  u32(v: number) { this.u16((v >>> 16) & 65535); this.u16(v & 65535); }
  i32(v: number) { this.u32(v >>> 0); }
  str(s: string) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i) & 255); }
  bytes(b: Uint8Array) { this.room(b.length); this.cur.set(b, this.n); this.n += b.length; this.size += b.length; }
  writer(w: Writer) { for (const c of w.parts()) this.bytes(c); }
  parts() { return [...this.chunks, this.cur.subarray(0, this.n)]; }
}

function packBits(src: Uint8Array, start: number, len: number, out: number[]) {
  let i = start; const end = start + len;
  while (i < end) {
    let run = 1;
    while (i + run < end && run < 128 && src[i + run] === src[i]) run++;
    if (run >= 2) { out.push(257 - run, src[i]); i += run; continue; }
    const litStart = i; i++;
    while (i < end && i - litStart < 128 && !(i + 1 < end && src[i] === src[i + 1])) i++;
    out.push(i - litStart - 1);
    for (let k = litStart; k < i; k++) out.push(src[k]);
  }
}
/** Canal comprimido con RLE: [compresión][longitudes de fila][datos]. */
function encodeChannel(plane: Uint8Array, w: number, h: number, withHeader = true): { counts: number[]; data: Uint8Array } & { bytes: Uint8Array } {
  const counts: number[] = [], all: number[] = [];
  for (let y = 0; y < h; y++) { const before = all.length; packBits(plane, y * w, w, all); counts.push(all.length - before); }
  const wr = new Writer();
  if (withHeader) { wr.u16(1); for (const c of counts) wr.u16(c); wr.bytes(Uint8Array.from(all)); }
  const parts = wr.parts(); const bytes = new Uint8Array(wr.size); let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
  return { counts, data: Uint8Array.from(all), bytes };
}

interface OutRec { name: string; layer: Layer | null; section: number; rect: { x: number; y: number; w: number; h: number }; chans: { id: number; bytes: Uint8Array }[]; hasMask: boolean; }

export function writePsd(doc: EditorDocument): { blob: Blob; warnings: string[] } {
  const W = doc.width, H = doc.height;
  const warnings: string[] = [];
  const recs: OutRec[] = [];
  let skipped = 0, baked = 0;
  const maskChan = (l: Layer): { id: number; bytes: Uint8Array } | null => {
    if (!l.mask) return null;
    const d = getPixels(l.mask.canvas).data, plane = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) plane[i] = d[i * 4 + 3];
    return { id: -2, bytes: encodeChannel(plane, W, H).bytes };
  };
  const visit = (g: GroupLayer) => {
    for (const l of g.children) {
      if (l instanceof GroupLayer) {
        recs.push({ name: '</Layer group>', layer: null, section: 3, rect: { x: 0, y: 0, w: 0, h: 0 }, chans: [], hasMask: false });
        visit(l);
        const m = maskChan(l);
        recs.push({ name: l.name, layer: l, section: l.expanded ? 1 : 2, rect: { x: 0, y: 0, w: 0, h: 0 }, chans: m ? [m] : [], hasMask: !!m });
      } else if (isRaster(l)) {
        let c = l.canvas;
        if (hasStyles(l.styles)) { baked++; const out = makeCanvas(W, H), x = ctx2d(out); renderStyles(x, c, l.styles, 0, 0, W, H); x.drawImage(c, 0, 0); c = out; }
        const b = contentBounds(c) ?? { x: 0, y: 0, w: 0, h: 0 };
        const chans: OutRec['chans'] = [];
        if (b.w > 0) {
          const d = getPixels(c, b).data, n = b.w * b.h;
          for (const [id, off] of [[-1, 3], [0, 0], [1, 1], [2, 2]]) {
            const plane = new Uint8Array(n);
            for (let i = 0; i < n; i++) plane[i] = d[i * 4 + off];
            chans.push({ id, bytes: encodeChannel(plane, b.w, b.h).bytes });
          }
        } else for (const id of [-1, 0, 1, 2]) chans.push({ id, bytes: new Uint8Array([0, 0]) });
        const m = maskChan(l); if (m) chans.push(m);
        recs.push({ name: l.name, layer: l, section: 0, rect: b, chans, hasMask: !!m });
      } else if (l instanceof AdjustmentLayer && l.filterId === 'invert') {
        const m = maskChan(l);
        recs.push({ name: l.name, layer: l, section: -1, rect: { x: 0, y: 0, w: 0, h: 0 }, chans: [...[-1, 0, 1, 2].map(id => ({ id, bytes: new Uint8Array([0, 0]) })), ...(m ? [m] : [])], hasMask: !!m });
      } else skipped++;
    }
  };
  visit(doc.root);
  if (skipped) warnings.push(`${skipped} capa(s) de ajuste no se pueden guardar en PSD todavía y se han omitido`);
  if (baked) warnings.push('Los estilos de capa se han guardado ya aplicados sobre los píxeles');
  if (doc.allLayers().some(l => l.kind === 'text' || l.kind === 'shape')) warnings.push('El texto y las formas se guardan como píxeles en el PSD');

  const li = new Writer();
  li.u16(recs.length);
  for (const rc of recs) {
    const l = rc.layer, b = rc.rect;
    li.i32(b.y); li.i32(b.x); li.i32(b.y + b.h); li.i32(b.x + b.w);
    li.u16(rc.chans.length);
    for (const c of rc.chans) { li.u16(c.id & 0xffff); li.u32(c.bytes.length); }
    li.str('8BIM');
    li.str(rc.section === 3 ? 'norm' : rc.section > 0 && l!.blendMode === 'source-over' ? 'pass' : blendToKey.get(l!.blendMode) ?? 'norm');
    li.u8(l ? Math.round(l.opacity * 255) : 255); li.u8(0);
    li.u8((l && !l.visible ? 2 : 0) | (rc.section !== 0 ? 0x18 : 0)); li.u8(0);
    const ex = new Writer();
    if (rc.hasMask) { ex.u32(20); ex.i32(0); ex.i32(0); ex.i32(H); ex.i32(W); ex.u8(255); ex.u8(l!.mask!.enabled ? 0 : 2); ex.u16(0); }
    else ex.u32(0);
    ex.u32(0);
    const ascii = rc.name.replace(/[^\x20-\x7e]/g, '?').slice(0, 255);
    ex.u8(ascii.length); ex.str(ascii); for (let k = (ascii.length + 1) % 4; k % 4 !== 0; k++) ex.u8(0);
    ex.str('8BIM'); ex.str('luni'); const ul = 4 + rc.name.length * 2; ex.u32(ul + (ul & 1 ? 1 : 0) + (ul % 4 === 2 ? 2 : 0));
    ex.u32(rc.name.length); for (let k = 0; k < rc.name.length; k++) ex.u16(rc.name.charCodeAt(k)); if (ul % 4 === 2) ex.u16(0);
    if (rc.section > 0 || rc.section === 3) { ex.str('8BIM'); ex.str('lsct'); ex.u32(4); ex.u32(rc.section); }
    if (rc.section === -1) { ex.str('8BIM'); ex.str('nvrt'); ex.u32(0); }
    li.u32(ex.size); li.writer(ex);
  }
  for (const rc of recs) for (const c of rc.chans) li.bytes(c.bytes);
  if (li.size & 1) li.u8(0);

  const out = new Writer();
  out.str('8BPS'); out.u16(1); for (let i = 0; i < 6; i++) out.u8(0);
  out.u16(3); out.u32(H); out.u32(W); out.u16(8); out.u16(3);
  out.u32(0); out.u32(0);
  out.u32(4 + li.size + 4); out.u32(li.size); out.writer(li); out.u32(0);
  // Imagen combinada (sobre blanco), para los programas que no leen capas
  const flat = makeCanvas(W, H), fx = ctx2d(flat);
  fx.fillStyle = '#fff'; fx.fillRect(0, 0, W, H); fx.drawImage(doc.flatten(), 0, 0);
  const fd = getPixels(flat).data;
  out.u16(1);
  const enc = [0, 1, 2].map(c => { const plane = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) plane[i] = fd[i * 4 + c]; return encodeChannel(plane, W, H, false); });
  for (const e of enc) for (const c of e.counts) out.u16(c);
  for (const e of enc) out.bytes(e.data);
  return { blob: new Blob(out.parts() as BlobPart[], { type: 'image/vnd.adobe.photoshop' }), warnings };
}

void cloneCanvas;
