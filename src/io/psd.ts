// Lectura y escritura de archivos PSD (Photoshop), escrito desde cero según
// la especificación pública del formato. Admite documentos RGB o grises de
// 8 bits con capas, grupos, máscaras, opacidad, visibilidad y modos de fusión.
// Lo que el PSD guarda de forma propia (texto editable, objetos inteligentes,
// efectos) se lee como píxeles.

import { EditorDocument } from '../core/document';
import { imageToCanvas } from './files';
import { ShapeLayer, GroupLayer, Layer, LayerMask, LayerStyles, RasterLayer, TextLayer, TextProps, SmartLayer, Matrix, AdjustmentLayer, BlendMode, isRaster, hasStyles } from '../core/layers';
import { cloneCanvas, contentBounds, ctx2d, makeCanvas, getPixels } from '../core/canvas';

const BLEND_KEYS: [string, BlendMode][] = [
  ['pass', 'pass-through'], ['norm', 'source-over'], ['dark', 'darken'], ['mul ', 'multiply'], ['idiv', 'color-burn'], ['lite', 'lighten'],
  ['scrn', 'screen'], ['div ', 'color-dodge'], ['lddg', 'lighter'], ['over', 'overlay'], ['sLit', 'soft-light'],
  ['hLit', 'hard-light'], ['diff', 'difference'], ['smud', 'exclusion'], ['hue ', 'hue'], ['sat ', 'saturation'],
  ['colr', 'color'], ['lum ', 'luminosity'],
];
const keyToBlend = new Map(BLEND_KEYS);
/** Etiquetas de color en el orden que usa Photoshop. */
const LABELS = ['', 'rojo', 'naranja', 'amarillo', 'verde', 'azul', 'violeta', 'gris'];
const blendToKey = new Map(BLEND_KEYS.map(([k, b]) => [b, k]));

// ---- Lectura ------------------------------------------------------------------

class Reader {
  pos = 0;
  view: DataView;
  /** true en archivos PSB (longitudes de 8 bytes). */
  big = false;
  constructor(public buf: ArrayBuffer) { this.view = new DataView(buf); }
  u8() { return this.view.getUint8(this.pos++); }
  u16() { const v = this.view.getUint16(this.pos); this.pos += 2; return v; }
  i16() { const v = this.view.getInt16(this.pos); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos); this.pos += 4; return v; }
  i32() { const v = this.view.getInt32(this.pos); this.pos += 4; return v; }
  f64() { const v = this.view.getFloat64(this.pos); this.pos += 8; return v; }
  u64() { const hi = this.u32(), lo = this.u32(); return hi * 4294967296 + lo; }
  /** Longitud de sección: 4 bytes en PSD, 8 en PSB. */
  len() { return this.big ? this.u64() : this.u32(); }
  str(n: number) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8()); return s; }
  ustr() { const n = this.u32(); let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.u16()); return s.replace(/\0+$/, ''); }
  bytes(n: number) { const b = new Uint8Array(this.buf, this.pos, n); this.pos += n; return b; }
  skipBlock() { const n = this.u32(); this.pos += n; }
  isSig() { if (this.pos + 4 > this.buf.byteLength) return false; const s = String.fromCharCode(...new Uint8Array(this.buf, this.pos, 4)); return s === '8BIM' || s === '8B64'; }
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new (window as any).DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function unpackBits(src: Uint8Array, dst: Uint8Array, off: number, len: number) {
  let i = 0, o = off; const end = off + len;
  while (i < src.length && o < end) {
    const n = src[i++];
    if (n < 128) { for (let k = 0; k <= n && o < end; k++) dst[o++] = src[i++]; }
    else if (n > 128) { const v = src[i++]; for (let k = 0; k < 257 - n && o < end; k++) dst[o++] = v; }
  }
}

/** Convierte muestras de 8/16/32 bits a 8 bits. `linear` = sin corrección gamma (alfa y máscaras). */
function to8(raw: Uint8Array, n: number, depth: number, linear: boolean): Uint8Array {
  if (depth === 8) return raw.length === n ? raw : raw.subarray(0, n);
  const out = new Uint8Array(n);
  if (depth === 16) { for (let i = 0; i < n; i++) out[i] = raw[i * 2]; return out; }
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let i = 0; i < n; i++) { const v = Math.max(0, Math.min(1, dv.getFloat32(i * 4))); out[i] = Math.round((linear ? v : Math.pow(v, 1 / 2.2)) * 255); }
  return out;
}

/** Lee un canal (sin comprimir, RLE o ZIP con/sin predicción) y lo devuelve en 8 bits. */
async function readChannel(r: Reader, w: number, h: number, end: number, depth: number, linear: boolean): Promise<Uint8Array> {
  const n = w * h, bps = depth / 8, row = w * bps;
  if (n === 0) return new Uint8Array(0);
  const comp = r.u16();
  let raw = new Uint8Array(n * bps);
  if (comp === 0) raw.set(r.bytes(Math.min(n * bps, end - r.pos)));
  else if (comp === 1) {
    const counts: number[] = [];
    for (let y = 0; y < h; y++) counts.push(r.big ? r.u32() : r.u16());
    for (let y = 0; y < h; y++) unpackBits(r.bytes(counts[y]), raw, y * row, row);
  } else {
    const data = await inflate(r.bytes(end - r.pos));
    raw.set(data.subarray(0, n * bps));
    if (comp === 3) {
      // Deshacer la predicción (diferencias entre píxeles vecinos de cada fila)
      if (depth === 16) for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) {
        const i = y * row + x * 2; const v = ((raw[i] << 8 | raw[i + 1]) + (raw[i - 2] << 8 | raw[i - 1])) & 0xffff; raw[i] = v >> 8; raw[i + 1] = v & 255;
      } else {
        for (let y = 0; y < h; y++) for (let x = 1; x < row; x++) raw[y * row + x] = (raw[y * row + x] + raw[y * row + x - 1]) & 255;
        if (depth === 32) { // los 4 bytes de cada número van en planos separados
          const fixed = new Uint8Array(raw.length);
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) fixed[y * row + x * 4 + k] = raw[y * row + k * w + x];
          raw = fixed;
        }
      }
    }
  }
  return to8(raw, n, depth, linear);
}

// ---- Descriptores (formato interno de Photoshop para efectos, etc.) -----------------

function readId(r: Reader) { const n = r.u32(); return r.str(n || 4); }
function readDescriptor(r: Reader): any {
  r.ustr(); readId(r);
  const n = r.u32(); const o: any = {};
  for (let i = 0; i < n; i++) { const key = readId(r).trim(); o[key] = readItem(r, r.str(4)); }
  return o;
}
function readItem(r: Reader, type: string): any {
  switch (type) {
    case 'Objc': case 'GlbO': return readDescriptor(r);
    case 'VlLs': { const n = r.u32(); const a = []; for (let i = 0; i < n; i++) a.push(readItem(r, r.str(4))); return a; }
    case 'doub': return r.f64();
    case 'UntF': r.pos += 4; return r.f64();
    case 'TEXT': return r.ustr();
    case 'enum': readId(r); return readId(r).trim();
    case 'long': return r.i32();
    case 'comp': return r.u64();
    case 'bool': return r.u8() !== 0;
    case 'type': case 'GlbC': r.ustr(); return readId(r);
    case 'alis': case 'tdta': { const n = r.u32(); return r.bytes(n); }
    default: throw new Error('descriptor: tipo ' + type);
  }
}
const descColor = (c: any) => !c ? '#000000' : c['Gry'] !== undefined && c['Rd'] === undefined ? (() => { const g = Math.round(255 * (1 - c['Gry'] / 100)).toString(16).padStart(2, '0'); return '#' + g + g + g; })() : '#' + [c['Rd'], c['Grn'], c['Bl']].map((v: number) => Math.max(0, Math.min(255, Math.round(v ?? 0))).toString(16).padStart(2, '0')).join('');

/** Efectos de capa de Photoshop → estilos del editor (sombra, trazo, resplandor). */
function parseEffects(bytes: Uint8Array): LayerStyles | null {
  const r = new Reader(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  r.pos = 8;
  const d = readDescriptor(r);
  if (d.masterFXSwitch === false) return null;
  const st: LayerStyles = {};
  const sh = d.DrSh, gl = d.OrGl, fr = d.FrFX;
  if (sh?.enab) st.shadow = { enabled: true, color: descColor(sh.Clr), opacity: Math.round(sh.Opct ?? 75), angle: Math.round(sh.lagl ?? 120), distance: Math.round(sh.Dstn ?? 5), blur: Math.round(sh.blur ?? 5) };
  if (gl?.enab) st.glow = { enabled: true, color: descColor(gl.Clr), opacity: Math.round(gl.Opct ?? 75), size: Math.round(gl.blur ?? 5) };
  if (fr?.enab) st.stroke = { enabled: true, color: descColor(fr.Clr), size: Math.round(fr.Sz ?? 3) };
  const is = d.IrSh, ig = d.IrGl, so = d.SoFi, gr = d.GrFl;
  if (is?.enab) st.innerShadow = { enabled: true, color: descColor(is.Clr), opacity: Math.round(is.Opct ?? 75), angle: Math.round(is.lagl ?? 120), distance: Math.round(is.Dstn ?? 5), blur: Math.round(is.blur ?? 5) };
  if (ig?.enab) st.innerGlow = { enabled: true, color: descColor(ig.Clr), opacity: Math.round(ig.Opct ?? 75), size: Math.round(ig.blur ?? 5) };
  if (so?.enab) st.colorOverlay = { enabled: true, color: descColor(so.Clr), opacity: Math.round(so.Opct ?? 100) };
  if (gr?.enab && gr.Grad?.Clrs?.length) {
    const stops = (gr.Grad.Clrs as any[]).map(c => [Math.max(0, Math.min(1, (c.Lctn ?? 0) / 4096)), descColor(c.Clr)] as [number, string]);
    if (gr.Rvrs) stops.forEach(x => x[0] = 1 - x[0]);
    st.gradientOverlay = { enabled: true, opacity: Math.round(gr.Opct ?? 100), angle: Math.round(gr.Angl ?? 90), stops: stops.sort((p, q) => p[0] - q[0]) };
  }
  return Object.keys(st).length ? st : null;
}

/** Relleno de color o degradado simple (dos colores) → capa de relleno editable. */
function editableFill(soco?: Uint8Array, gdfl?: Uint8Array): { id: string; params: any } | null {
  try {
    const b = (soco ?? gdfl)!;
    const r = new Reader(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer); r.pos = 4;
    const d = readDescriptor(r);
    if (soco) return { id: 'solidfill', params: { color: descColor(d.Clr) } };
    const stops = (d.Grad?.Clrs ?? []) as any[], tr = (d.Grad?.Trns ?? []) as any[];
    if (stops.length !== 2 || tr.some(t => (t.Opct ?? 100) < 100) || !(d.Type === 'Lnr' || d.Type === 'Rdl')) return null;
    let [a, z] = stops; if ((a.Lctn ?? 0) > (z.Lctn ?? 0)) [a, z] = [z, a];
    if (d.Rvrs) [a, z] = [z, a];
    return { id: 'gradfill', params: { c1: descColor(a.Clr), c2: descColor(z.Clr), angle: d.Angl ?? 90, scale: d.Scl ?? 100, radial: d.Type === 'Rdl' } };
  } catch { return null; }
}

function fillLayer(l: RasterLayer, soco?: Uint8Array, gdfl?: Uint8Array, bounds?: { x: number; y: number; w: number; h: number } | null) {
  const W = l.canvas.width, H = l.canvas.height, ctx = ctx2d(l.canvas);
  const b = (soco ?? gdfl)!;
  const r = new Reader(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  r.pos = 4;
  const d = readDescriptor(r);
  if (soco) { ctx.fillStyle = descColor(d.Clr); ctx.fillRect(0, 0, W, H); return; }
  const stops = (d.Grad?.Clrs ?? []) as any[];
  const ang = -(d.Angl ?? 90) * Math.PI / 180, scale = (d.Scl ?? 100) / 100;
  // El degradado se ajusta a la forma (si "alinear con capa") o al documento
  const bx = d.Algn !== false && bounds ? bounds : { x: 0, y: 0, w: W, h: H };
  const cx = bx.x + bx.w / 2, cy = bx.y + bx.h / 2;
  const half = (Math.abs(Math.cos(ang)) * bx.w + Math.abs(Math.sin(ang)) * bx.h) / 2 * scale;
  const refl = d.Type === 'Rflc';
  const g = d.Type === 'Rdl' ? ctx.createRadialGradient(cx, cy, 0, cx, cy, half)
    : ctx.createLinearGradient(cx - Math.cos(ang) * half, cy - Math.sin(ang) * half, cx + Math.cos(ang) * half, cy + Math.sin(ang) * half);
  for (const st of stops) {
    let t = Math.max(0, Math.min(1, (st.Lctn ?? 0) / 4096)); if (d.Rvrs) t = 1 - t;
    if (refl) { g.addColorStop(0.5 + t / 2, descColor(st.Clr)); g.addColorStop(0.5 - t / 2, descColor(st.Clr)); } else g.addColorStop(t, descColor(st.Clr));
  }
  if (!stops.length) { g.addColorStop(0, '#000'); g.addColorStop(1, '#fff'); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Paradas de transparencia del degradado
  const tr = (d.Grad?.Trns ?? []) as any[];
  if (tr.some(t => (t.Opct ?? 100) < 100)) {
    const ag = d.Type === 'Rdl' ? ctx.createRadialGradient(cx, cy, 0, cx, cy, half)
      : ctx.createLinearGradient(cx - Math.cos(ang) * half, cy - Math.sin(ang) * half, cx + Math.cos(ang) * half, cy + Math.sin(ang) * half);
    for (const t of tr) {
      let u = Math.max(0, Math.min(1, (t.Lctn ?? 0) / 4096)); if (d.Rvrs) u = 1 - u;
      const col = `rgba(0,0,0,${(t.Opct ?? 100) / 100})`;
      if (refl) { ag.addColorStop(0.5 + u / 2, col); ag.addColorStop(0.5 - u / 2, col); } else ag.addColorStop(u, col);
    }
    ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = ag; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over';
  }
}

/** Dibuja una máscara vectorial de Photoshop (curvas de Bézier) como máscara de píxeles. */
function vectorMask(b: Uint8Array, W: number, H: number): HTMLCanvasElement | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const flags = v.getUint32(4);
  if (flags & 4) return null; // desactivada
  const c = makeCanvas(W, H), ctx = ctx2d(c);
  ctx.fillStyle = '#fff';
  type Knot = { x: number; y: number }[];
  interface Sub { knots: Knot[]; closed: boolean; op: number }
  let cur = null as Sub | null;
  const subs: Sub[] = [];
  let startFilled = false;
  const pt = (o: number) => ({ y: v.getInt32(o) / 16777216 * H, x: v.getInt32(o + 4) / 16777216 * W });
  for (let o = 8; o + 26 <= b.length; o += 26) {
    const sel = v.getUint16(o);
    if (sel === 0 || sel === 3) { cur = { knots: [], closed: sel === 0, op: v.getUint16(o + 4) }; subs.push(cur); }
    else if ((sel === 1 || sel === 2 || sel === 4 || sel === 5) && cur) cur.knots.push([pt(o + 2), pt(o + 10), pt(o + 18)]);
    else if (sel === 8) startFilled = v.getUint16(o + 2) === 1;
  }
  if (startFilled && !subs.some(sp => sp.knots.length >= 2)) ctx.fillRect(0, 0, W, H); // solo si no hay trazados
  for (const sp of subs) {
    const k = sp.knots; if (k.length < 2) continue;
    ctx.beginPath(); ctx.moveTo(k[0][1].x, k[0][1].y);
    for (let i = 1; i <= k.length; i++) {
      if (i === k.length && !sp.closed) break;
      const a = k[i - 1], n = k[i % k.length];
      ctx.bezierCurveTo(a[2].x, a[2].y, n[0].x, n[0].y, n[1].x, n[1].y);
    }
    ctx.closePath();
    // 0 = excluir, 1 = unir, 2 = restar, 3 = intersecar
    ctx.globalCompositeOperation = sp.op === 2 ? 'destination-out' : sp.op === 3 ? 'destination-in' : sp.op === 0 ? 'xor' : 'source-over';
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  if (flags & 1) { const inv = makeCanvas(W, H), ic = ctx2d(inv); ic.fillStyle = '#fff'; ic.fillRect(0, 0, W, H); ic.globalCompositeOperation = 'destination-out'; ic.drawImage(c, 0, 0); return inv; }
  return c;
}

/** Capas de ajuste de Photoshop → capas de ajuste del editor. */
function descOf(b: Uint8Array, skip: number): any {
  const r = new Reader(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  r.pos = skip; return readDescriptor(r);
}
function parseAdjustment(key: string, b: Uint8Array, cged?: Uint8Array): { id: string; params: any } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (key === 'brit' && cged) { const d = descOf(cged, 4); if (d.Brgh !== undefined) return { id: 'brightness', params: { brightness: d.Brgh, contrast: d.Cntr ?? 0 } }; }
  if (key === 'expA') return { id: 'exposure', params: { stops: v.getFloat32(2), offset: v.getFloat32(6), gamma: v.getFloat32(10) || 1 } };
  if (key === 'post') return { id: 'posterize', params: { levels: v.getUint16(0) } };
  if (key === 'thrs') return { id: 'threshold', params: { level: v.getUint16(0) } };
  if (key === 'blnc') { const p: any = { preserve: v.getUint8(18) !== 0 }; ['s', 'm', 'h'].forEach((t, i) => { for (let c = 0; c < 3; c++) p[t + c] = v.getInt16((i * 3 + c) * 2); }); return { id: 'colorbalance', params: p }; }
  if (key === 'mixr') {
    const mono = v.getUint16(2) !== 0, p: any = { mono };
    ['r', 'g', 'b'].forEach((o, i) => { const off = 4 + (mono ? 0 : i) * 10; p[o + 'r'] = v.getInt16(off); p[o + 'g'] = v.getInt16(off + 2); p[o + 'b'] = v.getInt16(off + 4); p[o + 'c'] = v.getInt16(off + 8); });
    return { id: 'mixer', params: p };
  }
  if (key === 'vibA') { const d = descOf(b, 4); return { id: 'vibrance', params: { vibrance: d.vibrance ?? 0, sat: d.Strt ?? 0 } }; }
  if (key === 'blwh') { const d = descOf(b, 4); return { id: 'bw', params: { reds: d.Rd ?? 40, yellows: d.Yllw ?? 60, greens: d.Grn ?? 40, cyans: d.Cyn ?? 60, blues: d.Bl ?? 20, magentas: d.Mgnt ?? 80 } }; }
  if (key === 'selc' && b.length >= 84) {
    // versión, método (0 relativo, 1 absoluto) y 10 grupos de cian/magenta/amarillo/negro; el primero no se usa
    const p: any = { group: 'reds', absolute: v.getUint16(2) === 1 };
    ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'].forEach((g, i) => ['c', 'm', 'y', 'k'].forEach((c, k) => { p[g + '_' + c] = v.getInt16(4 + (i + 1) * 8 + k * 2); }));
    return { id: 'selcolor', params: p };
  }
  if (key === 'nvrt') return { id: 'invert', params: {} };
  if (key === 'brit' && b.length >= 4) return { id: 'brightness', params: { brightness: v.getInt16(0), contrast: v.getInt16(2) } };
  if (key === 'levl' && b.length >= 12) return { id: 'levels', params: { inBlack: v.getUint16(2), inWhite: v.getUint16(4), outBlack: v.getUint16(6), outWhite: v.getUint16(8), gamma: Math.max(0.1, v.getUint16(10) / 100) } };
  if (key === 'hue2' && b.length >= 16) {
    const colorize = v.getUint8(2) !== 0, o = colorize ? 4 : 10;
    const hue = v.getInt16(o), sat = v.getInt16(o + 2), light = v.getInt16(o + 4);
    return { id: 'huesat', params: colorize ? { hue, sat: sat * 2 - 100, light, colorize: true } : { hue, sat, light, colorize: false } };
  }
  if (key === 'curv' && b.length >= 7) {
    const params: any = { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] };
    const bits = v.getUint32(3); let o = 7;
    const names = ['rgb', 'r', 'g', 'b'];
    for (let ch = 0; ch < 32 && o + 2 <= b.length; ch++) {
      if (!(bits & (1 << ch))) continue;
      const n = v.getUint16(o); o += 2; const pts: number[][] = [];
      for (let i = 0; i < n && o + 4 <= b.length; i++) { pts.push([v.getUint16(o + 2), v.getUint16(o)]); o += 4; }
      if (names[ch] && pts.length >= 2) params[names[ch]] = pts;
    }
    return { id: 'curves', params };
  }
  return null;
}
const ADJ_KEYS = ['nvrt', 'brit', 'levl', 'hue2', 'curv', 'expA', 'post', 'thrs', 'blnc', 'mixr', 'vibA', 'blwh', 'selc'];
const ADJ_OTHER = ['phfl', 'clrL', 'grdm', 'PtFl'];
const BIG_KEYS = new Set(['LMsk', 'Lr16', 'Lr32', 'Layr', 'Mt16', 'Mt32', 'Mtrn', 'Alph', 'FMsk', 'lnk2', 'FEid', 'FXid', 'PxSD', 'cinf']);

interface Rec {
  top: number; left: number; bottom: number; right: number;
  channels: { id: number; len: number }[];
  blend: string; opacity: number; flags: number; name: string; clip: boolean; fillOpacity: number; protect: number; labelIdx: number;
  mask: { top: number; left: number; bottom: number; right: number; def: number; flags: number; real?: { top: number; left: number; bottom: number; right: number; def: number; flags: number }; density?: number; vdensity?: number } | null;
  section: number; keys: string[]; blocks: Record<string, Uint8Array>;
}

export interface PsdResult { doc: EditorDocument; warnings: string[]; }

/** Lee la sección de capas (registros + píxeles) y las añade al documento. */
const b64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return btoa(s); };
const unb64 = (t: string) => Uint8Array.from(atob(t), c => c.charCodeAt(0));

// ---- Texto de Photoshop ---------------------------------------------------------------

/** Lee los "EngineData" del texto (un formato de diccionarios anidados parecido a PostScript). */
function parseEngine(b: Uint8Array): any {
  let i = 0;
  const ws = () => { while (i < b.length && b[i] <= 32) i++; };
  const value = (): any => {
    ws();
    if (b[i] === 60 && b[i + 1] === 60) { // <<
      i += 2; const o: any = {};
      for (;;) { ws(); if (b[i] === 62 && b[i + 1] === 62) { i += 2; return o; } if (i >= b.length) return o; if (b[i] !== 47) { i++; continue; } i++; let k = ''; while (b[i] > 32 && b[i] !== 47 && b[i] !== 60 && b[i] !== 91 && b[i] !== 40) k += String.fromCharCode(b[i++]); o[k] = value(); }
    }
    if (b[i] === 91) { i++; const a: any[] = []; for (;;) { ws(); if (b[i] === 93) { i++; return a; } if (i >= b.length) return a; a.push(value()); } }
    if (b[i] === 40) { // (cadena)
      i++; const bytes: number[] = [];
      while (i < b.length && b[i] !== 41) { if (b[i] === 92) i++; bytes.push(b[i++]); }
      i++;
      let s = '';
      if (bytes[0] === 0xfe && bytes[1] === 0xff) for (let k = 2; k + 1 < bytes.length; k += 2) s += String.fromCharCode(bytes[k] << 8 | bytes[k + 1]);
      else s = String.fromCharCode(...bytes);
      return s;
    }
    if (b[i] === 47) { i++; let k = ''; while (b[i] > 32) k += String.fromCharCode(b[i++]); return k; }
    let t = ''; while (i < b.length && b[i] > 32 && b[i] !== 93 && b[i] !== 62) t += String.fromCharCode(b[i++]);
    if (t === 'true') return true; if (t === 'false') return false;
    const n = parseFloat(t); return isNaN(n) ? t : n;
  };
  return value();
}

/** Capa de texto de Photoshop → propiedades de texto del editor (null si no se puede representar). */
function parseText(b: Uint8Array): TextProps | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const xx = v.getFloat64(2), xy = v.getFloat64(10), yx = v.getFloat64(18), yy = v.getFloat64(26), tx = v.getFloat64(34), ty = v.getFloat64(42);
  if (Math.abs(xy) > 0.02 || Math.abs(yx) > 0.02 || xx <= 0) return null; // girado o volteado: se deja en píxeles
  const d = descOf(b, 56);
  const text = String(d.Txt ?? '').replace(/\r\n?|\u0003/g, '\n').replace(/\n+$/, '');
  if (!text) return null;
  const e = d.EngineData ? parseEngine(d.EngineData) : {};
  const st = e.EngineDict?.StyleRun?.RunArray?.[0]?.StyleSheet?.StyleSheetData ?? {};
  const fonts = e.ResourceDict?.FontSet ?? e.DocumentResources?.FontSet ?? [];
  const ps = String(fonts[st.Font ?? 0]?.Name ?? 'Arial');
  const just = e.EngineDict?.ParagraphRun?.RunArray?.[0]?.ParagraphSheet?.Properties?.Justification ?? 0;
  const col = st.FillColor?.Values ?? [1, 0, 0, 0];
  const hex = '#' + [col[1], col[2], col[3]].map((c: number) => Math.round(Math.max(0, Math.min(1, c ?? 0)) * 255).toString(16).padStart(2, '0')).join('');
  const size = (st.FontSize ?? 12) * yy;
  // "TimesNewRomanPS-BoldMT" → familia "Times New Roman", negrita
  const family = ps.split('-')[0].replace(/(PS)?MT$|PS$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim() || 'Arial';
  const lh = st.AutoLeading === false && st.Leading ? st.Leading / (st.FontSize || 12) : 1.2;
  return {
    text, font: family, size, color: hex, bold: /Bold|Black|Heavy/i.test(ps) || !!st.FauxBold, italic: /Italic|Oblique/i.test(ps) || !!st.FauxItalic,
    align: just === 1 ? 'right' : just === 2 ? 'center' : 'left', lineHeight: lh, x: tx, y: ty - size * 0.8 - size * (lh - 1) / 2, keepPixels: true,
  };
}

/** Objetos inteligentes de Photoshop pendientes de enlazar con su archivo incrustado. */
interface PendingSmart { layer: RasterLayer; id: string; corners: number[]; }
function smartInfo(blocks: Record<string, Uint8Array>): { id: string; corners: number[] } | null {
  try {
    if (blocks.SoLd) { const d = descOf(blocks.SoLd, 12); if (d.Idnt && d.Trnf?.length === 8) return { id: d.Idnt, corners: d.Trnf }; }
    if (blocks.PlLd) {
      const b = blocks.PlLd, v = new DataView(b.buffer, b.byteOffset, b.byteLength), n = b[8];
      let o = 9 + n + 16; const corners: number[] = [];
      for (let k = 0; k < 8; k++, o += 8) corners.push(v.getFloat64(o));
      return { id: String.fromCharCode(...b.subarray(9, 9 + n)), corners };
    }
  } catch { /* */ }
  return null;
}
/** Archivos incrustados (bloques lnk2/lnkD/lnk3): identificador → datos. */
function readLinked(r: Reader, end: number, out: Map<string, { name: string; data: Uint8Array }>) {
  while (r.pos + 16 < end) {
    const len = r.u64(), start = r.pos;
    const type = r.str(4); const ver = r.u32();
    const idLen = r.u8(); const id = r.str(idLen);
    const name = r.ustr();
    r.pos += 8; // tipo y creador
    const dataLen = r.u64();
    if (r.u8()) { r.pos += 4; readDescriptor(r); }
    if (type === 'liFD' && dataLen > 0 && r.pos + dataLen <= end) out.set(id, { name, data: r.bytes(dataLen) });
    void ver;
    r.pos = start + len + ((4 - (len % 4)) % 4);
  }
}

async function readLayers(r: Reader, doc: EditorDocument, depth: number, mode: number, warnings: string[], pending: PendingSmart[]) {
  const gray = mode === 1, cmyk = mode === 4;
  const W = doc.width, H = doc.height;
  const count = Math.abs(r.i16());
  const recs: Rec[] = [];
  for (let i = 0; i < count; i++) {
    const top = r.i32(), left = r.i32(), bottom = r.i32(), right = r.i32();
    const n = r.u16();
    const channels = []; for (let c = 0; c < n; c++) channels.push({ id: r.i16(), len: r.len() });
    r.pos += 4; // '8BIM'
    const blend = r.str(4), opacity = r.u8(); const clip = r.u8() === 1; const flags = r.u8(); r.u8();
    const extraLen = r.u32(); const extraEnd = r.pos + extraLen;
    let mask: Rec['mask'] = null;
    const mLen = r.u32(), mEnd = r.pos + mLen;
    if (mLen >= 18) {
      mask = { top: r.i32(), left: r.i32(), bottom: r.i32(), right: r.i32(), def: r.u8(), flags: r.u8() };
      if (mLen >= 36) { const rf = r.u8(), rd = r.u8(); mask.real = { flags: rf, def: rd, top: r.i32(), left: r.i32(), bottom: r.i32(), right: r.i32() }; }
      if (mask.flags & 0x10 && r.pos < mEnd) { // parámetros: densidad y calado
        const pf = r.u8();
        if (pf & 1) mask.density = r.u8();
        if (pf & 2) r.pos += 8;
        if (pf & 4) mask.vdensity = r.u8();
      }
    }
    r.pos = mEnd;
    r.skipBlock(); // rangos de fusión
    const nl = r.u8(); let lname = r.str(nl); r.pos += (4 - ((nl + 1) % 4)) % 4;
    let section = 0, fillOpacity = 255, sectionBlend = '', protect = 0, labelIdx = 0; const keys: string[] = []; const blocks: Rec['blocks'] = {};
    while (r.pos + 12 <= extraEnd && r.isSig()) {
      r.pos += 4; const key = r.str(4); const len = r.big && BIG_KEYS.has(key) ? r.u64() : r.u32(); const start = r.pos;
      keys.push(key);
      if (key === 'luni') lname = r.ustr();
      else if (key === 'lsct' || key === 'lsdk') { section = r.u32(); if (len >= 12) { r.pos += 4; sectionBlend = r.str(4); } }
      else if (key === 'iOpa') fillOpacity = r.u8();
      else if (key === 'lspf') protect = r.u32();
      else if (key === 'lclr') labelIdx = r.u16();
      else if (ADJ_KEYS.includes(key) || ['vstk', 'lfx2', 'SoCo', 'GdFl', 'vmsk', 'vsms', 'CgEd', 'TySh', 'SoLd', 'PlLd', 'artb', 'artd'].includes(key)) blocks[key] = new Uint8Array(r.buf, start, len);
      // El relleno tras cada bloque varía según el programa: se busca la siguiente firma
      r.pos = start + len;
      for (let pad = 0; pad < 4; pad++) { r.pos = start + len + pad; if (r.pos >= extraEnd || r.isSig()) break; }
    }
    r.pos = extraEnd;
    recs.push({ labelIdx, protect, fillOpacity, top, left, bottom, right, channels, blend: sectionBlend || blend, opacity, flags, clip, name: lname, mask, section, keys, blocks });
  }
  const stack: GroupLayer[] = [doc.root];
  let skippedAdj = 0, textAsPixels = 0;
  for (const rec of recs) {
    const w = Math.max(0, rec.right - rec.left), h = Math.max(0, rec.bottom - rec.top);
    const data: Record<number, Uint8Array> = {};
    for (const ch of rec.channels) {
      const end = r.pos + ch.len;
      try {
        if (ch.id === -3 && rec.mask?.real) data[-3] = await readChannel(r, Math.max(0, rec.mask.real.right - rec.mask.real.left), Math.max(0, rec.mask.real.bottom - rec.mask.real.top), end, depth, true);
        else if (ch.id === -2 && rec.mask) data[-2] = await readChannel(r, Math.max(0, rec.mask.right - rec.mask.left), Math.max(0, rec.mask.bottom - rec.mask.top), end, depth, true);
        else if (ch.id >= -1 && ch.id <= (cmyk ? 3 : 2)) data[ch.id] = await readChannel(r, w, h, end, depth, ch.id === -1);
      } catch { if (!warnings.includes('Alguna capa no se pudo descomprimir y puede aparecer vacía')) warnings.push('Alguna capa no se pudo descomprimir y puede aparecer vacía'); }
      r.pos = end;
    }
    let layer: Layer;
    let pendingFill: RasterLayer | null = null;
    if (rec.section === 3) { stack.push(new GroupLayer('')); continue; }
    if (rec.section === 1 || rec.section === 2) {
      const g = stack.length > 1 ? stack.pop()! : new GroupLayer('');
      g.name = rec.name || 'Grupo'; g.expanded = rec.section === 1;
      // Mesa de trabajo de Photoshop: rectángulo y color de fondo
      const ab = rec.blocks.artb ?? rec.blocks.artd;
      if (ab) try {
        const rr = new Reader(ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength) as ArrayBuffer); rr.pos = 4;
        const dd = readDescriptor(rr), R = dd.artboardRect;
        if (R) g.artboard = { x: Math.round(R.Left ?? 0), y: Math.round(R.Top ?? 0), w: Math.round((R.Rght ?? 0) - (R.Left ?? 0)), h: Math.round((R.Btom ?? 0) - (R.Top ?? 0)), bg: dd.artboardBackgroundType === 1 || dd.artboardBackgroundType === undefined ? '#ffffff' : dd.artboardBackgroundType === 2 ? '#000000' : dd.artboardBackgroundType === 4 && dd.Clr ? descColor(dd.Clr) : null };
        if (g.artboard && (g.artboard.w <= 0 || g.artboard.h <= 0)) g.artboard = undefined;
      } catch { /* formato inesperado */ }
      layer = g;
    } else {
      const adjKey = ADJ_KEYS.find(k => rec.blocks[k]);
      let adj: ReturnType<typeof parseAdjustment> = null;
      try { adj = adjKey ? parseAdjustment(adjKey, rec.blocks[adjKey], rec.blocks.CgEd) : null; } catch { /* formato inesperado */ }
      if (adj) layer = new AdjustmentLayer(rec.name || 'Ajuste', adj.id, adj.params);
      else if (rec.keys.some(k => ADJ_OTHER.includes(k) || ADJ_KEYS.includes(k))) { skippedAdj++; continue; }
      else if ((rec.blocks.SoCo || rec.blocks.GdFl) && !rec.blocks.vmsk && !rec.blocks.vsms && editableFill(rec.blocks.SoCo, rec.blocks.GdFl)) {
        const ef = editableFill(rec.blocks.SoCo, rec.blocks.GdFl)!;
        layer = new AdjustmentLayer(rec.name || 'Relleno', ef.id, ef.params);
      }
      else if (rec.blocks.SoCo || rec.blocks.GdFl) {
        // Capa de relleno (color o degradado): se convierte en píxeles
        const l = new RasterLayer(rec.name || 'Relleno', W, H);
        pendingFill = l; layer = l;
      }
      else {
        let l = new RasterLayer(rec.name || 'Capa', W, H);
        let tp: TextProps | null = null;
        if (rec.blocks.TySh) { try { tp = parseText(rec.blocks.TySh); } catch { tp = null; } if (!tp) textAsPixels++; }
        if (tp) l = new TextLayer(rec.name || 'Texto', W, H, tp);
        if (w > 0 && h > 0) {
          const img = new ImageData(w, h), d = img.data;
          const R = data[0], G = gray ? data[0] : data[1], B = gray ? data[0] : data[2], A = data[-1];
          const K = data[3];
          if (cmyk && K) for (let i = 0, j = 0; i < w * h; i++, j += 4) { const k = K[i] / 255; d[j] = (R ? R[i] : 255) * k; d[j + 1] = (G ? G[i] : 255) * k; d[j + 2] = (B ? B[i] : 255) * k; d[j + 3] = A ? A[i] : 255; }
          else for (let i = 0, j = 0; i < w * h; i++, j += 4) { d[j] = R ? R[i] : 0; d[j + 1] = G ? G[i] : 0; d[j + 2] = B ? B[i] : 0; d[j + 3] = A ? A[i] : 255; }
          const tmp = makeCanvas(w, h); ctx2d(tmp).putImageData(img, 0, 0);
          if (tp) { ctx2d(l.canvas).clearRect(0, 0, W, H); ctx2d(l.canvas).drawImage(tmp, rec.left, rec.top); l.touch(); const tpp = (l as TextLayer).props; tpp.keepPixels = true; tpp.psdTySh = b64(rec.blocks.TySh); }
          else l.placeFull(tmp, rec.left, rec.top, W, H);
        } else if (tp) (l as TextLayer).props.keepPixels = false;
        const si = !tp ? smartInfo(rec.blocks) : null;
        if (si) pending.push({ layer: l, ...si });
        layer = l;
      }
    }
    layer.opacity = rec.opacity / 255 * (rec.blocks.lfx2 ? 1 : rec.fillOpacity / 255);
    if (!(layer instanceof GroupLayer) && rec.blend === 'pass') rec.blend = 'norm';
    layer.visible = !(rec.flags & 2);
    layer.blendMode = keyToBlend.get(rec.blend) ?? 'source-over';
    layer.clip = rec.clip;
    if (rec.protect & 0x80000000 || rec.protect & 2) layer.locked = true;
    if (rec.protect & 1) layer.lockAlpha = true;
    if (rec.labelIdx > 0 && rec.labelIdx < 8) layer.label = LABELS[rec.labelIdx];
    if (rec.blocks.lfx2 && layer.kind !== 'adjust') {
      try { layer.styles = parseEffects(rec.blocks.lfx2); } catch { /* efecto no reconocido */ }
    }
    if (rec.blocks.vstk) {
      // Trazo de las formas vectoriales → estilo de trazo
      try {
        const d = descOf(rec.blocks.vstk, 4);
        if (d.strokeEnabled && d.strokeStyleContent?.Clr) (layer.styles ??= {}).stroke = { enabled: true, color: descColor(d.strokeStyleContent.Clr), size: Math.max(1, Math.round((d.strokeStyleLineWidth ?? 1) * (d.strokeStyleLineAlignment === 'strokeStyleAlignOutside' ? 1 : 0.5))) };
        if (d.fillEnabled === false && isRaster(layer)) { ctx2d(layer.canvas).clearRect(0, 0, W, H); layer.touch(); }
      } catch { /* */ }
    }
    const pixelMask = (m: { top: number; left: number; bottom: number; right: number; def: number }, src: Uint8Array, density?: number) => {
      const mw = m.right - m.left, mh = m.bottom - m.top;
      const k = density === undefined ? 1 : density / 255;
      const c = makeCanvas(W, H), cx = ctx2d(c);
      cx.fillStyle = `rgba(255,255,255,${1 - (1 - m.def / 255) * k})`; cx.fillRect(0, 0, W, H);
      if (mw > 0 && mh > 0) {
        const img = new ImageData(mw, mh), d = img.data;
        for (let i = 0, j = 0; i < mw * mh; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = 255; d[j + 3] = 255 - (255 - src[i]) * k; }
        const tmp = makeCanvas(mw, mh); ctx2d(tmp).putImageData(img, 0, 0);
        cx.clearRect(m.left, m.top, mw, mh); cx.drawImage(tmp, m.left, m.top);
      }
      return c;
    };
    const addMask = (c: HTMLCanvasElement) => {
      if (layer.mask) { const x = ctx2d(layer.mask.canvas); x.globalCompositeOperation = 'destination-in'; x.drawImage(c, 0, 0); x.globalCompositeOperation = 'source-over'; layer.mask.touch(); }
      else { const lm = new LayerMask(W, H, 'black'); lm.canvas = c; lm.touch(); layer.mask = lm; }
    };
    const m0 = rec.mask;
    // Si la máscara principal procede de un trazado vectorial (bit 3), la de píxeles real va en el canal -3
    const fromVector = !!m0 && !!(m0.flags & 8);
    if (m0 && data[-2] && (data[-2].length || !fromVector) && !(m0.flags & 2)) addMask(pixelMask(m0, data[-2], fromVector ? m0.vdensity : m0.density));
    if (m0?.real && data[-3] && !(m0.real.flags & 2)) addMask(pixelMask(m0.real, data[-3], m0.density));
    const vm = rec.blocks.vmsk ?? rec.blocks.vsms;
    let shapeBounds = null as ReturnType<typeof contentBounds>;
    if (vm) {
      // Máscara vectorial (formas): se dibuja como máscara, salvo que el PSD ya la traiga dibujada
      const shape = vectorMask(vm, W, H);
      if (shape) { shapeBounds = contentBounds(shape); if (!(fromVector && data[-2]?.length)) addMask(shape); }
    }
    if (pendingFill) { try { fillLayer(pendingFill, rec.blocks.SoCo, rec.blocks.GdFl, shapeBounds); } catch { warnings.push('Un relleno de degradado no se pudo interpretar'); } pendingFill.touch(); }
    stack[stack.length - 1].add(layer);
  }
  while (stack.length > 1) { const g = stack.pop()!; g.name ||= 'Grupo'; stack[stack.length - 1].add(g); }
  if (skippedAdj) warnings.push(`${skippedAdj} capa(s) de ajuste de un tipo aún no admitido no se han importado`);
  if (recs.some(x => x.keys.includes('TySh'))) warnings.push('El texto es editable: se ve como en Photoshop hasta que lo cambies; al editarlo se redibuja con las fuentes de tu equipo' + (textAsPixels ? ` (${textAsPixels} texto(s) girados o especiales se quedan como píxeles)` : ''));
  if (recs.some(x => (x.keys.includes('lfx2') || x.keys.includes('lrFX')))) warnings.push('De los efectos de capa no se importan biselado, satinado ni superposición de motivo');
}

export async function readPsd(buf: ArrayBuffer, name: string): Promise<PsdResult> {
  const r = new Reader(buf);
  const warnings: string[] = [];
  if (r.str(4) !== '8BPS') throw new Error('No es un archivo PSD válido');
  const version = r.u16();
  if (version !== 1 && version !== 2) throw new Error('Versión de PSD desconocida');
  r.big = version === 2;
  r.pos += 6;
  const nch = r.u16(), H = r.u32(), W = r.u32(), depth = r.u16(), mode = r.u16();
  if (mode !== 3 && mode !== 1 && mode !== 4) throw new Error('Solo se admiten PSD en modo RGB, CMYK o escala de grises (este usa otro modo, como Lab o indexado)');
  if (mode === 4) warnings.push('Documento CMYK convertido a RGB sin perfil de color: los colores pueden variar ligeramente');
  if (W * H > 268e6) throw new Error('La imagen es demasiado grande para el navegador');
  r.skipBlock();              // datos de modo de color
  r.skipBlock();              // recursos de imagen
  const lmLen = r.len();
  const lmEnd = r.pos + lmLen;
  const doc = new EditorDocument(name, W, H);
  const gray = mode === 1, cmyk = mode === 4;
  const pending: PendingSmart[] = [];
  const linked = new Map<string, { name: string; data: Uint8Array }>();

  if (lmLen > 0) {
    try {
      const liLen = r.len(); const liEnd = r.pos + liLen;
      if (liLen > 0) await readLayers(r, doc, depth, mode, warnings, pending);
      r.pos = liEnd;
      if (r.pos + 4 <= lmEnd) r.skipBlock(); // máscara global
      // En 16 y 32 bits las capas van en un bloque aparte (Lr16 / Lr32)
      while (r.pos + 12 <= lmEnd && r.isSig()) {
        r.pos += 4; const key = r.str(4); const len = r.big && BIG_KEYS.has(key) ? r.u64() : r.u32(); const start = r.pos;
        if ((key === 'Lr16' || key === 'Lr32' || key === 'Layr') && doc.root.children.length === 0) await readLayers(r, doc, depth, mode, warnings, pending);
        else if (key === 'lnk2' || key === 'lnkD' || key === 'lnk3') { try { readLinked(r, start + len, linked); } catch { /* */ } }
        for (let pad = 0; pad < 4; pad++) { r.pos = start + len + pad; if (r.pos >= lmEnd || r.isSig()) break; }
      }
    } catch (e) {
      doc.root.children.slice().forEach(c => doc.root.remove(c));
      warnings.push('No se pudieron leer las capas; se abre la imagen acoplada');
    }
    if (depth !== 8 && doc.root.children.length) warnings.push(`El archivo es de ${depth} bits por canal y se ha convertido a 8 bits`);
  }
  if (doc.root.children.length === 0) {
    // Sin capas: se usa la imagen combinada del final del archivo
    if (depth !== 8) warnings.push(`El archivo es de ${depth} bits por canal: se abre acoplado y convertido a 8 bits`);
    r.pos = lmEnd;
    const comp = r.u16();
    if (comp > 1) throw new Error('Compresión de imagen no admitida en este PSD');
    const bps = depth / 8, n = W * H, row = W * bps;
    const planes: Uint8Array[] = [];
    const counts: number[] = [];
    if (comp === 1) for (let i = 0; i < nch * H; i++) counts.push(r.big ? r.u32() : r.u16());
    const colorCh = gray ? 1 : cmyk ? 4 : 3;
    for (let c = 0; c < nch; c++) {
      const raw = new Uint8Array(n * bps);
      for (let y = 0; y < H; y++) { if (comp === 1) unpackBits(r.bytes(counts[c * H + y]), raw, y * row, row); else raw.set(r.bytes(row), y * row); }
      planes.push(to8(raw, n, depth, c >= colorCh));
    }
    const img = new ImageData(W, H), d = img.data;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      d[j] = planes[0][i]; d[j + 1] = planes[gray ? 0 : 1]?.[i] ?? 0; d[j + 2] = planes[gray ? 0 : 2]?.[i] ?? 0;
      if (cmyk && planes[3]) { const k = planes[3][i] / 255; d[j] *= k; d[j + 1] *= k; d[j + 2] *= k; }
      d[j + 3] = nch > colorCh && lmLen > 0 ? planes[colorCh][i] : 255;
    }
    const l = new RasterLayer('Fondo', W, H); ctx2d(l.canvas).putImageData(img, 0, 0); l.touch();
    doc.root.add(l);
  }
  // Objetos inteligentes de Photoshop: se reconstruyen desde su archivo incrustado
  let smartOk = 0, smartPx = 0;
  for (const ps of pending) {
    const f = linked.get(ps.id);
    try {
      if (!f || !ps.layer.parent) throw 0;
      const sig = String.fromCharCode(...f.data.subarray(0, 4));
      let inner: EditorDocument;
      const copy = f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer;
      if (sig === '8BPS') inner = (await readPsd(copy, f.name.replace(/\.[^.]+$/, ''))).doc;
      else if (sig.startsWith('\x89PN') || sig.startsWith('\xff\xd8') || sig.startsWith('GIF') || sig === 'RIFF') {
        const c = await imageToCanvas(new Blob([copy]));
        inner = new EditorDocument(f.name, c.width, c.height);
        const il = new RasterLayer('Fondo', c.width, c.height); il.canvas = c; inner.root.add(il); inner.setActive(il, false);
      } else throw 0;
      inner.embedded = true;
      const [x0, y0, x1, y1, , , x3, y3] = ps.corners, iw = inner.width, ih = inner.height;
      const m: Matrix = [(x1 - x0) / iw, (y1 - y0) / iw, (x3 - x0) / ih, (y3 - y0) / ih, x0, y0];
      const o = ps.layer, sl = new SmartLayer(o.name, doc.width, doc.height, inner, m);
      sl.opacity = o.opacity; sl.visible = o.visible; sl.blendMode = o.blendMode; sl.clip = o.clip; sl.mask = o.mask; sl.styles = o.styles;
      const parent = o.parent!, idx = parent.children.indexOf(o);
      parent.remove(o); parent.add(sl, idx);
      smartOk++;
    } catch { smartPx++; }
  }
  if (smartOk) warnings.push(`${smartOk} objeto(s) inteligente(s) importados con su contenido editable (sin filtros inteligentes ni deformaciones)`);
  if (smartPx) warnings.push(`${smartPx} objeto(s) inteligente(s) con contenido no compatible (vectorial o enlazado a un archivo externo) se quedan como píxeles`);
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
  f32(v: number) { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, v); this.bytes(new Uint8Array(b.buffer)); }
  f64(v: number) { const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, v); this.bytes(new Uint8Array(b.buffer)); }
  ustr(t: string) { this.u32(t.length + 1); for (let i = 0; i < t.length; i++) this.u16(t.charCodeAt(i)); this.u16(0); }
  id(t: string) { if (t.length === 4) { this.u32(0); this.str(t); } else { this.u32(t.length); this.str(t); } }
  flat() { const out = new Uint8Array(this.size); let o = 0; for (const c of this.parts()) { out.set(c, o); o += c.length; } return out; }
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

/** Valor de descriptor para escribir: [tipo, ...datos]. */
type DV = ['bool', boolean] | ['long', number] | ['doub', number] | ['UntF', string, number] | ['enum', string, string] | ['TEXT', string] | ['Objc', string, Record<string, DV>] | ['VlLs', DV[]];
function writeValue(w: Writer, v: DV) {
  w.str(v[0]);
  switch (v[0]) {
    case 'bool': w.u8(v[1] ? 1 : 0); break;
    case 'long': w.i32(v[1]); break;
    case 'doub': w.f64(v[1]); break;
    case 'UntF': w.str(v[1]); w.f64(v[2]); break;
    case 'enum': w.id(v[1]); w.id(v[2]); break;
    case 'TEXT': w.ustr(v[1]); break;
    case 'Objc': writeDescriptor(w, v[1], v[2]); break;
    case 'VlLs': w.u32(v[1].length); for (const x of v[1]) writeValue(w, x); break;
  }
}
function writeDescriptor(w: Writer, classId: string, items: Record<string, DV>) {
  w.ustr(''); w.id(classId);
  const keys = Object.keys(items); w.u32(keys.length);
  for (const k of keys) { w.id(k); writeValue(w, items[k]); }
}
const rgbDV = (hex: string): DV => { const n = parseInt(hex.slice(1), 16); return ['Objc', 'RGBC', { 'Rd  ': ['doub', n >> 16 & 255], 'Grn ': ['doub', n >> 8 & 255], 'Bl  ': ['doub', n & 255] }]; };

/** Datos de una capa de ajuste en el formato de Photoshop (null = tipo no admitido). */
/** Actualiza la posición dentro del bloque de texto original de Photoshop (por si la capa se movió). */
function patchTySh(b: Uint8Array, p: TextProps): Uint8Array {
  const out = b.slice(), v = new DataView(out.buffer);
  v.setFloat64(34, p.x); v.setFloat64(42, p.y + p.size * 0.8 + p.size * (p.lineHeight - 1) / 2);
  return out.length & 1 ? Uint8Array.from([...out, 0]) : out;
}

function adjustmentBlock(l: AdjustmentLayer): { key: string; bytes: Uint8Array } | null {
  const w = new Writer(), p = l.params;
  const done = (key: string) => { if (w.size & 1) w.u8(0); const parts = w.parts(); const out = new Uint8Array(w.size); let o = 0; for (const c of parts) { out.set(c, o); o += c.length; } return { key, bytes: out }; };
  const i16 = (v: number) => w.u16(Math.round(v) & 0xffff);
  switch (l.filterId) {
    case 'solidfill': w.u32(16); writeDescriptor(w, 'null', { 'Clr ': rgbDV(p.color) }); return done('SoCo');
    case 'gradfill': w.u32(16); writeDescriptor(w, 'null', {
      Angl: ['UntF', '#Ang', p.angle], Type: ['enum', 'GrdT', p.radial ? 'Rdl ' : 'Lnr '], Algn: ['bool', false], 'Scl ': ['UntF', '#Prc', p.scale],
      Grad: ['Objc', 'Grdn', { 'Nm  ': ['TEXT', 'Editor'], GrdF: ['enum', 'GrdF', 'CstS'], Intr: ['doub', 4096],
        Clrs: ['VlLs', [[0, p.c1], [4096, p.c2]].map(([l, c]) => ['Objc', 'Clrt', { 'Clr ': rgbDV(c as string), Type: ['enum', 'Clry', 'UsrS'], Lctn: ['long', l as number], Mdpn: ['long', 50] }] as DV)],
        Trns: ['VlLs', [0, 4096].map(l => ['Objc', 'TrnS', { Opct: ['UntF', '#Prc', 100], Lctn: ['long', l], Mdpn: ['long', 50] }] as DV)] }] });
      return done('GdFl');
    case 'selcolor': w.u16(1); w.u16(p.absolute ? 1 : 0); for (let k = 0; k < 4; k++) w.u16(0);
      for (const g of ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks']) for (const c of ['c', 'm', 'y', 'k']) i16(p[g + '_' + c] ?? 0);
      return done('selc');
    case 'invert': return done('nvrt');
    case 'exposure': w.u16(1); w.f32(p.stops); w.f32(p.offset); w.f32(p.gamma); return done('expA');
    case 'posterize': w.u16(Math.round(p.levels)); w.u16(0); return done('post');
    case 'threshold': w.u16(Math.round(p.level)); w.u16(0); return done('thrs');
    case 'colorbalance': for (const t of ['s', 'm', 'h']) for (let c = 0; c < 3; c++) i16(p[t + c] ?? 0); w.u8(p.preserve === false ? 0 : 1); return done('blnc');
    case 'mixer':
      w.u16(1); w.u16(p.mono ? 1 : 0);
      for (const o of p.mono ? ['r'] : ['r', 'g', 'b']) { i16(p[o + 'r']); i16(p[o + 'g']); i16(p[o + 'b']); i16(0); i16(p[o + 'c'] ?? 0); }
      if (p.mono) for (let k = 0; k < 10; k++) i16(0);
      return done('mixr');
    case 'vibrance': w.u32(16); writeDescriptor(w, 'null', { vibrance: ['long', Math.round(p.vibrance)], 'Strt': ['long', Math.round(p.sat)] }); return done('vibA');
    case 'bw': if (p.reds === undefined) return null;
      w.u32(16); writeDescriptor(w, 'null', { 'Rd  ': ['long', Math.round(p.reds)], 'Yllw': ['long', Math.round(p.yellows)], 'Grn ': ['long', Math.round(p.greens)], 'Cyn ': ['long', Math.round(p.cyans)], 'Bl  ': ['long', Math.round(p.blues)], 'Mgnt': ['long', Math.round(p.magentas)], useTint: ['bool', false], tintColor: rgbDV('#e1d3b3'), bwPresetKind: ['long', 1], blackAndWhitePresetFileName: ['TEXT', ''] }); return done('blwh');
    case 'brightness': i16(p.brightness); i16(p.contrast); i16(127); w.u8(0); return done('brit');
    case 'levels':
      w.u16(2);
      for (let i = 0; i < 29; i++) {
        if (i === 0) { w.u16(Math.round(p.inBlack)); w.u16(Math.round(p.inWhite)); w.u16(Math.round(p.outBlack)); w.u16(Math.round(p.outWhite)); w.u16(Math.round(p.gamma * 100)); }
        else { w.u16(0); w.u16(255); w.u16(0); w.u16(255); w.u16(100); }
      }
      return done('levl');
    case 'huesat': case 'desaturate': {
      const q = l.filterId === 'desaturate' ? { hue: 0, sat: -100, light: 0, colorize: false } : p;
      w.u16(2); w.u8(q.colorize ? 1 : 0); w.u8(0);
      if (q.colorize) { i16((q.hue + 360) % 360); i16((q.sat + 100) / 2); i16(q.light); i16(0); i16(0); i16(0); }
      else { i16(0); i16(25); i16(0); i16(q.hue); i16(q.sat); i16(q.light); }
      for (const rg of [[315, 345, 15, 45], [15, 45, 75, 105], [75, 105, 135, 165], [135, 165, 195, 225], [195, 225, 255, 285], [255, 285, 315, 345]]) { for (const v of rg) i16(v); i16(0); i16(0); i16(0); }
      return done('hue2');
    }
    case 'curves': {
      const chans = ['rgb', 'r', 'g', 'b'].map((k, i) => ({ i, pts: (p[k] as number[][]).slice().sort((a, b) => a[0] - b[0]) }))
        .filter(c => !(c.pts.length === 2 && c.pts[0][0] === 0 && c.pts[0][1] === 0 && c.pts[1][0] === 255 && c.pts[1][1] === 255));
      w.u8(0); w.u16(1); w.u32(chans.reduce((m, c) => m | (1 << c.i), 0));
      for (const c of chans) { const pts = c.pts.slice(0, 19); w.u16(pts.length); for (const [inp, out] of pts) { w.u16(Math.round(out)); w.u16(Math.round(inp)); } }
      return done('curv');
    }
  }
  return null;
}

/** Efectos de capa en el formato de Photoshop (bloque lfx2). */
function effectsBlock(st: LayerStyles): Uint8Array {
  const pc = (v: number): DV => ['UntF', '#Prc', v], px = (v: number): DV => ['UntF', '#Pxl', v], ang = (v: number): DV => ['UntF', '#Ang', v];
  const md = (m: string): DV => ['enum', 'BlnM', m];
  const items: Record<string, DV> = { 'Scl ': pc(100), masterFXSwitch: ['bool', true] };
  const shadow = (s: NonNullable<LayerStyles['shadow']>, cls: string): DV => ['Objc', cls, { enab: ['bool', true], present: ['bool', true], showInDialog: ['bool', true], 'Md  ': md('Mltp'), 'Clr ': rgbDV(s.color), Opct: pc(s.opacity), uglg: ['bool', false], lagl: ang(s.angle), Dstn: px(s.distance), Ckmt: px(0), blur: px(s.blur), Nose: pc(0), AntA: ['bool', false] }];
  const glow = (g: NonNullable<LayerStyles['glow']>, cls: string, inner: boolean): DV => ['Objc', cls, { enab: ['bool', true], present: ['bool', true], showInDialog: ['bool', true], 'Md  ': md('Scrn'), 'Clr ': rgbDV(g.color), Opct: pc(g.opacity), GlwT: ['enum', 'BETE', 'SfBL'], Ckmt: px(0), blur: px(g.size), Nose: pc(0), ShdN: pc(0), AntA: ['bool', false], ...(inner ? { glwS: ['enum', 'IGSr', 'SrcE'] as DV } : {}) }];
  if (st.shadow?.enabled) items.DrSh = shadow(st.shadow, 'DrSh');
  if (st.innerShadow?.enabled) items.IrSh = shadow(st.innerShadow, 'IrSh');
  if (st.glow?.enabled) items.OrGl = glow(st.glow, 'OrGl', false);
  if (st.innerGlow?.enabled) items.IrGl = glow(st.innerGlow, 'IrGl', true);
  if (st.colorOverlay?.enabled) items.SoFi = ['Objc', 'SoFi', { enab: ['bool', true], present: ['bool', true], showInDialog: ['bool', true], 'Md  ': md('Nrml'), Opct: pc(st.colorOverlay.opacity), 'Clr ': rgbDV(st.colorOverlay.color) }];
  if (st.gradientOverlay?.enabled) {
    const g = st.gradientOverlay;
    items.GrFl = ['Objc', 'GrFl', { enab: ['bool', true], present: ['bool', true], showInDialog: ['bool', true], 'Md  ': md('Nrml'), Opct: pc(g.opacity), Grad: ['Objc', 'Grdn', {
      'Nm  ': ['TEXT', 'Editor'], GrdF: ['enum', 'GrdF', 'CstS'], Intr: ['doub', 4096],
      Clrs: ['VlLs', g.stops.map(([t, c]) => ['Objc', 'Clrt', { 'Clr ': rgbDV(c), Type: ['enum', 'Clry', 'UsrS'], Lctn: ['long', Math.round(t * 4096)], Mdpn: ['long', 50] }] as DV)],
      Trns: ['VlLs', [0, 4096].map(l => ['Objc', 'TrnS', { Opct: pc(100), Lctn: ['long', l], Mdpn: ['long', 50] }] as DV)],
    }], Angl: ang(g.angle), Type: ['enum', 'GrdT', 'Lnr '], Rvrs: ['bool', false], Algn: ['bool', true], 'Scl ': pc(100), Ofst: ['Objc', 'Pnt ', { Hrzn: pc(0), Vrtc: pc(0) }] }];
  }
  if (st.stroke?.enabled) items.FrFX = ['Objc', 'FrFX', { enab: ['bool', true], present: ['bool', true], showInDialog: ['bool', true], Styl: ['enum', 'FStl', 'OutF'], PntT: ['enum', 'FrFl', 'SClr'], 'Md  ': md('Nrml'), Opct: pc(100), 'Sz  ': px(st.stroke.size), 'Clr ': rgbDV(st.stroke.color) }];
  const w = new Writer(); w.u32(0); w.u32(16); writeDescriptor(w, 'null', items);
  if (w.size & 1) w.u8(0);
  return w.flat();
}

/** Forma del editor → relleno de color + máscara vectorial de Photoshop (null si lleva trazo o es una línea). */
function shapeBlocks(l: ShapeLayer, W: number, H: number): { soco: Uint8Array; vmsk: Uint8Array } | null {
  const p = l.props;
  if (p.shape === 'line' || p.stroke || !p.fill || ['polygon', 'star', 'arrow', 'heart'].includes(p.shape)) return null;
  const x = Math.min(p.x0, p.x1), y = Math.min(p.y0, p.y1), w = Math.abs(p.x1 - p.x0), h = Math.abs(p.y1 - p.y0);
  type P = [number, number];
  const knots: [P, P, P][] = []; // [control anterior, ancla, control siguiente]
  const K = 0.5523;
  if (p.shape === 'path') {
    if (!p.path?.closed) return null;
    for (const q of p.path.pts) knots.push([[q.ix, q.iy], [q.x, q.y], [q.ox, q.oy]]);
  } else if (p.shape === 'ellipse') {
    const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
    knots.push([[cx - rx * K, y], [cx, y], [cx + rx * K, y]], [[x + w, cy - ry * K], [x + w, cy], [x + w, cy + ry * K]],
      [[cx + rx * K, y + h], [cx, y + h], [cx - rx * K, y + h]], [[x, cy + ry * K], [x, cy], [x, cy - ry * K]]);
  } else {
    const r = p.shape === 'round' ? Math.min(p.radius, w / 2, h / 2) : 0, k = r * (1 - K);
    if (!r) for (const c of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as P[]) knots.push([c, c, c]);
    else knots.push(
      [[x + r, y], [x + r, y], [x + r, y]], [[x + w - r, y], [x + w - r, y], [x + w - k, y]], [[x + w, y + k], [x + w, y + r], [x + w, y + r]],
      [[x + w, y + h - r], [x + w, y + h - r], [x + w, y + h - k]], [[x + w - k, y + h], [x + w - r, y + h], [x + w - r, y + h]],
      [[x + r, y + h], [x + r, y + h], [x + k, y + h]], [[x, y + h - k], [x, y + h - r], [x, y + h - r]], [[x, y + r], [x, y + r], [x, y + k]]);
    if (r) knots[0][0] = [x + k, y];
  }
  const v = new Writer(); v.u32(3); v.u32(0);
  const pad = (n: number) => { for (let i = 0; i < n; i++) v.u8(0); };
  v.u16(6); pad(24);
  v.u16(8); v.u16(0); pad(22);
  v.u16(0); v.u16(knots.length); v.u16(1); v.u16(1); pad(18);
  const fx = (val: number, size: number) => v.i32(Math.round(val / size * 16777216));
  for (const kn of knots) { v.u16(kn[0][0] === kn[1][0] && kn[0][1] === kn[1][1] && kn[2][0] === kn[1][0] && kn[2][1] === kn[1][1] ? 2 : 1); for (const pt of kn) { fx(pt[1], H); fx(pt[0], W); } }
  const s = new Writer(); s.u32(16); writeDescriptor(s, 'null', { 'Clr ': rgbDV(p.fill) });
  if (s.size & 1) s.u8(0);
  return { soco: s.flat(), vmsk: v.flat() };
}

interface OutRec { extra?: [string, Uint8Array][]; name: string; layer: Layer | null; section: number; rect: { x: number; y: number; w: number; h: number }; chans: { id: number; bytes: Uint8Array }[]; hasMask: boolean; }

export function writePsd(doc: EditorDocument): { blob: Blob; warnings: string[] } {
  const W = doc.width, H = doc.height;
  const warnings: string[] = [];
  const recs: OutRec[] = [];
  let skipped = 0, vectors = 0, asPixels = 0;
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
        const extra: [string, Uint8Array][] = [];
        const sb = l instanceof ShapeLayer ? shapeBlocks(l, W, H) : null;
        if (sb) { extra.push(['SoCo', sb.soco], ['vmsk', sb.vmsk]); vectors++; }
        else if (l.kind === 'shape' || l.kind === 'smart') asPixels++;
        if (l instanceof TextLayer) { if (l.props.keepPixels && l.props.psdTySh) { extra.push(['TySh', patchTySh(unb64(l.props.psdTySh), l.props)]); } else asPixels++; }
        if (hasStyles(l.styles)) extra.push(['lfx2', effectsBlock(l.styles)]);
        const c = l.canvas;
        const b = (sb ? null : contentBounds(c)) ?? { x: 0, y: 0, w: 0, h: 0 };
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
        recs.push({ extra, name: l.name, layer: l, section: 0, rect: b, chans, hasMask: !!m });
      } else if (l instanceof AdjustmentLayer && adjustmentBlock(l)) {
        const m = maskChan(l);
        recs.push({ name: l.name, layer: l, section: -1, rect: { x: 0, y: 0, w: 0, h: 0 }, chans: [...[-1, 0, 1, 2].map(id => ({ id, bytes: new Uint8Array([0, 0]) })), ...(m ? [m] : [])], hasMask: !!m });
      } else skipped++;
    }
  };
  visit(doc.root);
  if (skipped) warnings.push(`${skipped} capa(s) no se pueden guardar en PSD y se han omitido`);
  if (asPixels) warnings.push(`${asPixels} capa(s) se guardan como píxeles: texto creado o editado en Editor, objetos inteligentes y formas con trazo`);
  void vectors;

  const li = new Writer();
  li.u16(recs.length);
  for (const rc of recs) {
    const l = rc.layer, b = rc.rect;
    li.i32(b.y); li.i32(b.x); li.i32(b.y + b.h); li.i32(b.x + b.w);
    li.u16(rc.chans.length);
    for (const c of rc.chans) { li.u16(c.id & 0xffff); li.u32(c.bytes.length); }
    li.str('8BIM');
    li.str(rc.section === 3 ? 'norm' : blendToKey.get(l!.blendMode) ?? 'norm');
    li.u8(l ? Math.round(l.opacity * 255) : 255); li.u8(l?.clip ? 1 : 0);
    li.u8((l && !l.visible ? 2 : 0) | (rc.section !== 0 ? 0x18 : 0)); li.u8(0);
    const ex = new Writer();
    if (rc.hasMask) { ex.u32(20); ex.i32(0); ex.i32(0); ex.i32(H); ex.i32(W); ex.u8(255); ex.u8(l!.mask!.enabled ? 0 : 2); ex.u16(0); }
    else ex.u32(0);
    ex.u32(0);
    const ascii = rc.name.replace(/[^\x20-\x7e]/g, '?').slice(0, 255);
    ex.u8(ascii.length); ex.str(ascii); for (let k = (ascii.length + 1) % 4; k % 4 !== 0; k++) ex.u8(0);
    ex.str('8BIM'); ex.str('luni'); const ul = 4 + rc.name.length * 2; ex.u32(ul + (ul & 1 ? 1 : 0) + (ul % 4 === 2 ? 2 : 0));
    ex.u32(rc.name.length); for (let k = 0; k < rc.name.length; k++) ex.u16(rc.name.charCodeAt(k)); if (ul % 4 === 2) ex.u16(0);
    if (rc.section === 3) { ex.str('8BIM'); ex.str('lsct'); ex.u32(4); ex.u32(3); }
    if (rc.section > 0 && rc.section < 3) { ex.str('8BIM'); ex.str('lsct'); ex.u32(12); ex.u32(rc.section); ex.str('8BIM'); ex.str(blendToKey.get(l!.blendMode) ?? 'norm'); }
    if (l?.label && LABELS.indexOf(l.label) > 0) { ex.str('8BIM'); ex.str('lclr'); ex.u32(8); ex.u16(LABELS.indexOf(l.label)); ex.u16(0); ex.u32(0); }
    if (l && (l.locked || l.lockAlpha)) { ex.str('8BIM'); ex.str('lspf'); ex.u32(4); ex.u32((l.locked ? 0x80000000 : 0) | (l.lockAlpha ? 1 : 0)); }
    for (const [k, bytes] of rc.extra ?? []) { ex.str('8BIM'); ex.str(k); ex.u32(bytes.length); ex.bytes(bytes); }
    if (rc.section === -1) { const ab = adjustmentBlock(l as AdjustmentLayer)!; ex.str('8BIM'); ex.str(ab.key); ex.u32(ab.bytes.length); ex.bytes(ab.bytes); }
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
