// Revelado RAW (16 bits): vuelve a revelar el RAW desde los datos lineales de alta precisión que se guardaron al
// abrirlo (ver io/rawlinear). Todo se calcula en coma flotante y solo al final se pasa a 8 bits, con un ruido
// finísimo (tramado) que evita las bandas. Así se puede aclarar mucho una foto oscura o recuperar luces que en la
// imagen de 8 bits ya estaban quemadas. También exporta un TIFF de 16 bits de verdad.
import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog } from './dialog';
import { ctx2d } from '../core/canvas';
import { decTable } from '../io/rawlinear';
import type { EditorDocument } from '../core/document';

export type RawParams = { exposure: number; temp: number; tint: number; highlights: number; shadows: number; contrast: number; saturation: number };
export const RAW_DEFAULTS: RawParams = { exposure: 0, temp: 0, tint: 0, highlights: 0, shadows: 0, contrast: 0, saturation: 0 };

/** Tabla de la curva sRGB (de lineal 0–1 a 0–1), con 4096 tramos e interpolación. */
const SRGB = (() => { const t = new Float32Array(4097); for (let i = 0; i <= 4096; i++) { const v = i / 4096; t[i] = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; } return t; })();
const srgb = (v: number) => { if (v <= 0) return 0; if (v >= 1) return 1; const f = v * 4096, i = f | 0; return SRGB[i] + (SRGB[i + 1] - SRGB[i]) * (f - i); };

/** Prepara la función que revela un píxel lineal (r, g, b) y devuelve valores 0–1 ya con la curva de tono. */
export function developer(p: RawParams) {
  // equilibrio de blancos relativo (cálido/frío y verde/magenta), sin cambiar el brillo
  let kr = 1 + p.temp / 100 * 0.35, kb = 1 - p.temp / 100 * 0.35, kg = 1 - p.tint / 100 * 0.25;
  const n = 0.2126 * kr + 0.7152 * kg + 0.0722 * kb; kr /= n; kg /= n; kb /= n;
  const ex = Math.pow(2, p.exposure), sh = p.shadows / 100, hi = p.highlights / 100, sat = 1 + p.saturation / 100;
  const k = 0.25 + p.contrast / 100 * 0.5; // 0.25 = la misma curva que al abrir el RAW
  const out = new Float32Array(3);
  return (r: number, g: number, b: number): Float32Array => {
    r *= kr * ex; g *= kg * ex; b *= kb * ex;
    let L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (L > 1e-6 && (sh || hi)) {
      let L2 = L;
      // sombras: aclara (u oscurece) sobre todo los tonos por debajo del gris medio
      if (sh) { const w = L2 < 0.18 ? 1 : Math.max(0, 1 - (L2 - 0.18) / 0.4); L2 *= 1 + sh * 2 * w * w; }
      // luces: en negativo recupera lo que pasa del blanco con una rodilla suave; en positivo las abre
      if (hi < 0) { const t = 0.5, c = -hi * 3; if (L2 > t) L2 = t + (L2 - t) / (1 + c * (L2 - t)); }
      else if (hi > 0) { const w = Math.min(1, Math.max(0, (L2 - 0.3) / 0.7)); L2 *= 1 + hi * 0.6 * w; }
      const f = L2 / L; r *= f; g *= f; b *= f; L = L2;
    }
    if (sat !== 1) { r = L + (r - L) * sat; g = L + (g - L) * sat; b = L + (b - L) * sat; }
    const tone = (v: number) => { const s = srgb(v); return s + (s * s * (3 - 2 * s) - s) * k; };
    out[0] = tone(r); out[1] = tone(g); out[2] = tone(b);
    return out;
  };
}

/** Ruido de tramado determinista (−0,5 … 0,5) por píxel y canal. */
const dither = (i: number) => { let x = (i * 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x & 1023) / 1024 - 0.5; };

/** Revela todo el RAW a una imagen de 8 bits (por bloques de filas para no congelar la página). */
export async function renderRaw(src: NonNullable<EditorDocument['raw16']>, p: RawParams, progress?: (f: number) => void): Promise<ImageData> {
  const { w, h, data } = src, D = decTable(), dev = developer(p), img = new ImageData(w, h), o = img.data;
  const rows = Math.max(1, Math.floor(400000 / w));
  for (let y0 = 0; y0 < h; y0 += rows) {
    const y1 = Math.min(h, y0 + rows);
    for (let i = y0 * w; i < y1 * w; i++) {
      const q = i * 3, v = dev(D[data[q]], D[data[q + 1]], D[data[q + 2]]), j = i * 4;
      o[j] = v[0] * 255 + dither(q) + 0.5; o[j + 1] = v[1] * 255 + dither(q + 1) + 0.5; o[j + 2] = v[2] * 255 + dither(q + 2) + 0.5; o[j + 3] = 255;
    }
    progress?.(y1 / h);
    if (y1 < h) await new Promise(r => setTimeout(r, 0));
  }
  return img;
}

/** Vista previa reducida (como mucho `max` píxeles de lado). */
function preview(src: NonNullable<EditorDocument['raw16']>, p: RawParams, c: HTMLCanvasElement) {
  const { w, h, data } = src, D = decTable(), dev = developer(p), x = ctx2d(c), img = x.createImageData(c.width, c.height), o = img.data;
  for (let y = 0; y < c.height; y++) {
    const sy = Math.min(h - 1, Math.floor((y + 0.5) * h / c.height));
    for (let xx = 0; xx < c.width; xx++) {
      const sx = Math.min(w - 1, Math.floor((xx + 0.5) * w / c.width)), q = (sy * w + sx) * 3, v = dev(D[data[q]], D[data[q + 1]], D[data[q + 2]]), j = (y * c.width + xx) * 4;
      o[j] = v[0] * 255 + 0.5; o[j + 1] = v[1] * 255 + 0.5; o[j + 2] = v[2] * 255 + 0.5; o[j + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
}

/** TIFF RGB de 16 bits por canal, sin comprimir (lo abren Photoshop, Lightroom, GIMP, Affinity…). */
export async function tiff16(src: NonNullable<EditorDocument['raw16']>, p: RawParams): Promise<Blob> {
  const { w, h, data } = src, D = decTable(), dev = developer(p);
  const N = 11, ifdOff = 8, bpsOff = ifdOff + 2 + N * 12 + 4, dataOff = bpsOff + 6 + 16; // + resolución
  const head = new DataView(new ArrayBuffer(dataOff));
  head.setUint16(0, 0x4949, true); head.setUint16(2, 42, true); head.setUint32(4, ifdOff, true); head.setUint16(ifdOff, N, true);
  let k = ifdOff + 2;
  const tag = (t: number, type: number, count: number, v: number) => { head.setUint16(k, t, true); head.setUint16(k + 2, type, true); head.setUint32(k + 4, count, true); if (type === 3 && count === 1) head.setUint16(k + 8, v, true); else head.setUint32(k + 8, v, true); k += 12; };
  tag(256, 4, 1, w); tag(257, 4, 1, h); tag(258, 3, 3, bpsOff); tag(259, 3, 1, 1); tag(262, 3, 1, 2);
  tag(273, 4, 1, dataOff); tag(277, 3, 1, 3); tag(278, 4, 1, h); tag(279, 4, 1, w * h * 6); tag(284, 3, 1, 1); tag(296, 3, 1, 1);
  head.setUint32(k, 0, true);
  for (let i = 0; i < 3; i++) head.setUint16(bpsOff + i * 2, 16, true);
  const parts: BlobPart[] = [head.buffer];
  const rows = Math.max(1, Math.floor(200000 / w));
  for (let y0 = 0; y0 < h; y0 += rows) {
    const y1 = Math.min(h, y0 + rows), buf = new Uint16Array((y1 - y0) * w * 3);
    for (let i = y0 * w, o = 0; i < y1 * w; i++) { const q = i * 3, v = dev(D[data[q]], D[data[q + 1]], D[data[q + 2]]); buf[o++] = v[0] * 65535 + 0.5; buf[o++] = v[1] * 65535 + 0.5; buf[o++] = v[2] * 65535 + 0.5; }
    parts.push(buf.buffer);
    if (y1 < h) await new Promise(r => setTimeout(r, 0));
  }
  return new Blob(parts, { type: 'image/tiff' });
}

/** Filtro › Revelado RAW (16 bits). */
export function rawDevelopDialog() {
  const d = app.doc; if (!d) return;
  const src = d.raw16;
  if (!src) { app.toast('Solo para fotos RAW abiertas en esta sesión (DNG, CR2, NEF, ARW). Para otras fotos usa Filtro › Revelado', 'warn'); return; }
  const layer = d.allLayers().find(l => l.id === src.layerId) as any;
  if (!layer || !layer.canvas || layer.canvas.width !== src.w || layer.canvas.height !== src.h || d.width !== src.w || d.height !== src.h) {
    app.toast('La foto ha cambiado de tamaño o se ha borrado su capa: el revelado de 16 bits solo funciona antes de recortar o cambiar el tamaño', 'warn'); return;
  }
  const p: RawParams = { ...RAW_DEFAULTS, ...(src.params as Partial<RawParams> ?? {}) };
  const k = Math.min(1, 520 / src.w, 340 / src.h), pv = h('canvas', { class: 'raw-pv', width: Math.max(1, Math.round(src.w * k)), height: Math.max(1, Math.round(src.h * k)) }) as HTMLCanvasElement;
  let pending = 0;
  const redraw = () => { if (pending) return; pending = requestAnimationFrame(() => { pending = 0; preview(src, p, pv); }); };
  const rows: HTMLElement[] = [];
  const sliders: [keyof RawParams, string, number, number, number, string][] = [
    ['exposure', 'Exposición', -4, 4, 0.05, ' EV'], ['highlights', 'Luces', -100, 100, 1, ''], ['shadows', 'Sombras', -100, 100, 1, ''],
    ['contrast', 'Contraste', -50, 100, 1, ''], ['temp', 'Temperatura', -100, 100, 1, ''], ['tint', 'Matiz', -100, 100, 1, ''], ['saturation', 'Saturación', -100, 100, 1, ''],
  ];
  for (const [key, label, min, max, step, unit] of sliders) {
    const s = numberSlider({ min, max, step, value: p[key], unit, def: 0, onInput: v => { p[key] = v; redraw(); } });
    rows.push(h('div', { class: 'form-row' }, h('label', {}, label), s.el));
  }
  preview(src, p, pv);
  const tiffBtn = h('button', { type: 'button', class: 'btn', title: 'Guarda el revelado como TIFF de 16 bits por canal, para seguir en otro programa sin perder calidad' }, 'Exportar TIFF de 16 bits…');
  tiffBtn.onclick = async () => {
    tiffBtn.setAttribute('disabled', ''); app.toast('Preparando el TIFF de 16 bits…');
    try { const b = await tiff16(src, p); const io = await import('../io/files'); await io.saveBlob(b, d.name + '-16bits.tif'); app.toast('Exportado'); }
    catch (e: any) { if (e?.name !== 'AbortError') app.toast('No se pudo exportar: ' + (e?.message ?? e), 'warn'); }
    finally { tiffBtn.removeAttribute('disabled'); }
  };
  showDialog({
    title: 'Revelado RAW (16 bits)', okLabel: 'Revelar', width: 560, extraButtons: [tiffBtn],
    body: [
      h('div', { class: 'raw-pv-wrap' }, pv),
      ...rows,
      h('div', { class: 'hint' }, 'Se revela desde los datos del RAW con 16 bits de precisión: puedes aclarar mucho las sombras o recuperar luces sin que aparezcan bandas. Sustituye la imagen de la capa del RAW: haz los retoques en otras capas o después de revelar.'),
    ],
    onOk: async () => {
      const img = await renderRaw(src, p, f => { if (f < 1) app.toast(`Revelando… ${Math.round(f * 100)} %`); });
      ctx2d(layer.canvas).putImageData(img, 0, 0); layer.touch();
      src.params = { ...p };
      d.invalidate(); d.commit('Revelado RAW (16 bits)');
      app.toast('Revelado');
    },
  });
}
