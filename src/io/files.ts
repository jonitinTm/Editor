// Abrir imágenes y proyectos, exportar y guardar. Todo ocurre en el
// navegador: nada se envía a ningún servidor.

import { EditorDocument } from '../core/document';
import { RasterLayer, TextLayer, ShapeLayer, SmartLayer, AdjustmentLayer, GroupLayer, LayerMask, Layer, bumpLayerId, isRaster, isParametric } from '../core/layers';
import { canvasToBlob, ctx2d, makeCanvas } from '../core/canvas';
import { decodeGifFrames } from './gif';

export const PROJECT_EXT = '.edp';
/** Lo que se ofrece en «Abrir». */
export const OPEN_ACCEPT = 'image/*,.tif,.tiff,.tga,.abr,.pat,.aco,.ase,.psd,.psb,.cr2,.cr3,.nef,.arw,.dng,.orf,.rw2,.raf,.pef,.edp';
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/svg+xml'];

export function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    const img = new Image();
    img.onload = () => { res(img); if (typeof src !== 'string') setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => rej(new Error('No se pudo leer la imagen'));
    img.src = url;
  });
}

export async function imageToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const img = await loadImage(file);
  const c = makeCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
  ctx2d(c).drawImage(img, 0, 0);
  return c;
}

export function baseName(name: string) { return name.replace(/\.[^.]+$/, ''); }

/** Extensiones de archivos RAW de cámara. */
export const RAW_EXT = /\.(cr2|cr3|nef|nrw|arw|sr2|dng|orf|rw2|raf|pef|srw|3fr|erf|kdc|mrw)$/i;
export function isRawFile(f: File) { return RAW_EXT.test(f.name); }
/**
 * Los RAW llevan dentro una vista previa JPEG hecha por la cámara. Se busca la
 * de mayor tamaño y se abre esa (no se revelan los datos en bruto del sensor).
 */
export async function rawPreview(file: Blob): Promise<HTMLCanvasElement> {
  const b = new Uint8Array(await file.arrayBuffer());
  const starts: number[] = [];
  for (let i = 0; i + 3 < b.length && starts.length < 40; i++) if (b[i] === 0xff && b[i + 1] === 0xd8 && b[i + 2] === 0xff && (b[i + 3] === 0xdb || b[i + 3] === 0xe0 || b[i + 3] === 0xe1 || b[i + 3] === 0xc4)) starts.push(i);
  let best: ImageBitmap | null = null;
  for (const s of starts) {
    try { const bmp = await createImageBitmap(new Blob([b.subarray(s)], { type: 'image/jpeg' })); if (!best || bmp.width * bmp.height > best.width * best.height) best = bmp; } catch { /* no era un JPEG completo */ }
  }
  if (!best) throw new Error('Este RAW no contiene una vista previa que se pueda abrir');
  const c = makeCanvas(best.width, best.height); ctx2d(c).drawImage(best, 0, 0);
  return c;
}

export async function documentFromImage(file: File | Blob, name = 'Sin título'): Promise<EditorDocument> {
  if (file.type === 'image/gif') {
    const frames = await decodeGifFrames(file);
    if (frames) { // GIF animado: una capa y un cuadro por fotograma
      const doc = new EditorDocument(baseName(name), frames[0].canvas.width, frames[0].canvas.height);
      frames.forEach((f, i) => { const l = new RasterLayer(`Cuadro ${i + 1}`, doc.width, doc.height); ctx2d(l.canvas).drawImage(f.canvas, 0, 0); l.visible = i === 0; doc.root.add(l); doc.frames.push({ delay: f.delay, visible: [l.id] }); });
      doc.setActive(doc.root.children[0], false);
      return doc;
    }
  }
  const c = await imageToCanvas(file);
  const doc = new EditorDocument(baseName(name), c.width, c.height);
  const l = new RasterLayer('Fondo', c.width, c.height);
  l.canvas = c;
  doc.root.add(l);
  doc.setActive(l, false);
  return doc;
}

export function isProjectFile(f: File) { return f.name.toLowerCase().endsWith(PROJECT_EXT); }
export function isPsdFile(f: File) { return /\.ps[db]$/i.test(f.name); }
/** TIFF y TGA: los abre Editor por su cuenta (el navegador no sabe). */
export function isTiffTga(f: File) { return /\.(tiff?|tga|icb|vda|vst)$/i.test(f.name); }
export function isImageFile(f: File) { return !isPsdFile(f) && f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg|ico|avif)$/i.test(f.name); }

// ---- Formato de proyecto (.edp) ---------------------------------------------
// Un archivo JSON con la estructura de capas; los píxeles de cada capa van como
// PNG en base64. Lleva un número de versión para poder ampliarlo en el futuro.

interface ProjLayer {
  id: number; type: string; name: string; visible: boolean; opacity: number; blendMode: string; locked: boolean; lockAlpha?: boolean; lockPos?: boolean; lockPixels?: boolean; fillOpacity?: number; link?: number | null; clip?: boolean; label?: string | null;
  image?: string; mask?: { image: string; enabled: boolean } | null; text?: any; shape?: any; smart?: { m: number[]; doc: ProjFile; filters?: any[] }; styles?: any; adjust?: { filterId: string; params: any }; children?: ProjLayer[]; expanded?: boolean; artboard?: any; frame?: boolean;
}
interface ProjFile {
  format: 'editor-proyecto'; version: 1; name: string; width: number; height: number;
  guides: { h: number[]; v: number[] }; activeId: number | null; layers: ProjLayer[]; frames?: { delay: number; visible: number[] }[];
  channels?: { name: string; image: string }[];
  paths?: any[];
  layerComps?: any[];
  slices?: any[];
  ppi?: number;
}

async function canvasToDataURL(c: HTMLCanvasElement) {
  const blob = await canvasToBlob(c, 'image/png');
  return await new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob); });
}

async function layerToProj(l: Layer): Promise<ProjLayer> {
  const p: ProjLayer = {
    id: l.id, type: l.kind, name: l.name, visible: l.visible, opacity: l.opacity, blendMode: l.blendMode, locked: l.locked, lockAlpha: l.lockAlpha, lockPos: l.lockPos, lockPixels: l.lockPixels, fillOpacity: l.fillOpacity, link: l.link, clip: l.clip, label: l.label,
    mask: l.mask ? { image: await canvasToDataURL(l.mask.canvas), enabled: l.mask.enabled } : null,
  };
  if (l.styles) p.styles = l.styles;
  if (l.vmask) (p as any).vmask = l.vmask;
  if (l instanceof AdjustmentLayer) p.adjust = { filterId: l.filterId, params: l.params };
  if (l instanceof GroupLayer) { p.children = await Promise.all(l.children.map(layerToProj)); p.expanded = l.expanded; if (l.artboard) p.artboard = l.artboard; if (l.frame) p.frame = true; }
  else if (l instanceof SmartLayer) p.smart = { m: l.props.m, doc: await projectData(l.inner as EditorDocument), filters: l.filters };
  else if (isRaster(l)) { p.image = await canvasToDataURL(l.canvas); if (l instanceof TextLayer) p.text = { ...l.props }; if (l instanceof ShapeLayer) p.shape = { ...l.props }; }
  return p;
}

export async function serializeProject(doc: EditorDocument): Promise<Blob> {
  return new Blob([JSON.stringify(await projectData(doc))], { type: 'application/json' });
}
async function projectData(doc: EditorDocument): Promise<ProjFile> {
  return {
    format: 'editor-proyecto', version: 1, name: doc.name, width: doc.width, height: doc.height, ppi: doc.ppi,
    guides: doc.guides, activeId: doc.active?.id ?? null, frames: doc.frames,
    channels: await Promise.all(doc.channels.map(async c => ({ name: c.name, image: await canvasToDataURL(c.canvas) }))),
    paths: doc.paths,
    layerComps: doc.layerComps,
    ...({ notes: (doc as any).notes, counts: (doc as any).counts, samplers: (doc as any).samplers } as any),
    slices: doc.slices,
    layers: await Promise.all(doc.root.children.map(layerToProj)),
  };
}

async function projToLayer(p: ProjLayer, w: number, h: number): Promise<Layer> {
  let l: Layer;
  if (p.type === 'group') {
    const g = new GroupLayer(p.name); g.expanded = p.expanded ?? true; if (p.artboard) g.artboard = { ...p.artboard }; if (p.frame) g.frame = true;
    for (const c of p.children ?? []) g.add(await projToLayer(c, w, h));
    l = g;
  } else if (p.type === 'smart') {
    const inner = await docFromData(p.smart!.doc); inner.embedded = true;
    l = new SmartLayer(p.name, w, h, inner, p.smart!.m as any, p.smart!.filters ?? []);
  } else if (p.type === 'adjust') {
    l = new AdjustmentLayer(p.name, p.adjust!.filterId, p.adjust!.params);
  } else {
    const r = p.type === 'text' ? new TextLayer(p.name, w, h, p.text) : p.type === 'shape' ? new ShapeLayer(p.name, w, h, p.shape) : new RasterLayer(p.name, w, h);
    if (p.image && (!isParametric(r) || (r as any).props?.keepPixels)) { const img = await loadImage(p.image); ctx2d(r.canvas).clearRect(0, 0, w, h); ctx2d(r.canvas).drawImage(img, 0, 0); }
    l = r;
  }
  l.id = p.id; bumpLayerId(p.id);
  l.styles = p.styles ?? null; l.clip = !!p.clip; if ((p as any).vmask) l.vmask = (p as any).vmask;
  l.visible = p.visible; l.opacity = p.opacity; l.blendMode = p.blendMode as any; l.locked = p.locked; l.lockAlpha = !!p.lockAlpha; l.lockPos = !!(p as any).lockPos; l.lockPixels = !!(p as any).lockPixels; l.fillOpacity = p.fillOpacity ?? 1; l.link = p.link ?? null; l.label = p.label ?? null;
  if (p.mask) {
    const m = new LayerMask(w, h, 'black');
    ctx2d(m.canvas).drawImage(await loadImage(p.mask.image), 0, 0);
    m.enabled = p.mask.enabled; l.mask = m;
  }
  return l;
}

export async function openProject(file: Blob): Promise<EditorDocument> {
  const data = JSON.parse(await file.text()) as ProjFile;
  if (data.format !== 'editor-proyecto') throw new Error('El archivo no es un proyecto de Editor');
  if (data.version > 1) throw new Error('Este proyecto se creó con una versión más nueva de Editor');
  return docFromData(data);
}
async function docFromData(data: ProjFile): Promise<EditorDocument> {
  const doc = new EditorDocument(data.name, data.width, data.height);
  for (const p of data.layers) doc.root.add(await projToLayer(p, data.width, data.height));
  doc.guides = data.guides ?? { h: [], v: [] };
  doc.frames = data.frames ?? [];
  doc.paths = Array.isArray(data.paths) ? data.paths : [];
  if (Array.isArray((data as any).layerComps)) doc.layerComps = (data as any).layerComps;
  if (Array.isArray((data as any).slices)) doc.slices = (data as any).slices;
  for (const k of ['notes', 'counts', 'samplers']) if (Array.isArray((data as any)[k])) (doc as any)[k] = (data as any)[k];
  if ((data as any).ppi > 0) doc.ppi = (data as any).ppi;
  for (const [i, c] of (data.channels ?? []).entries()) { const cv = makeCanvas(data.width, data.height); ctx2d(cv).drawImage(await loadImage(c.image), 0, 0); doc.channels.push({ id: i + 1, name: c.name, canvas: cv }); }
  doc.setActive(doc.findLayer(data.activeId ?? -1) ?? doc.allLayers().pop() ?? null, false);
  return doc;
}

// ---- Descargas -------------------------------------------------------------

/** Guarda un archivo. Usa el diálogo "Guardar como" del sistema si el navegador lo permite. */
export async function saveBlob(blob: Blob, filename: string, handle?: any): Promise<any> {
  const w = window as any;
  if (handle) {
    const wr = await handle.createWritable(); await wr.write(blob); await wr.close(); return handle;
  }
  if (w.showSaveFilePicker && window.self === window.top) {
    const ext = filename.slice(filename.lastIndexOf('.'));
    try {
      const hnd = await w.showSaveFilePicker({ suggestedName: filename, types: [{ description: ext.toUpperCase().slice(1), accept: { [blob.type || 'application/octet-stream']: [ext] } }] });
      const wr = await hnd.createWritable(); await wr.write(blob); await wr.close();
      return hnd;
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e;
      // Si falla, se usa la descarga normal
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return null;
}

/** Formatos de imagen plana que se pueden exportar. */
export type ExportType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/tiff' | 'image/x-tga' | 'image/bmp' | 'image/x-icon';
export const EXPORT_EXT: Record<ExportType, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/tiff': '.tif', 'image/x-tga': '.tga', 'image/bmp': '.bmp', 'image/x-icon': '.ico' };

export async function exportImage(doc: EditorDocument, type: ExportType, quality: number, scale = 1, src?: HTMLCanvasElement): Promise<Blob> {
  let c = src ?? doc.flatten();
  if (scale !== 1) { // Cambio de tamaño en pasos de como mucho ½ para que quede nítido
    let cur = c, w = c.width, hh = c.height; const tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(hh * scale));
    while (w / 2 > tw && hh / 2 > th) { w = Math.round(w / 2); hh = Math.round(hh / 2); const n = makeCanvas(w, hh), x = ctx2d(n); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, w, hh); cur = n; }
    const n = makeCanvas(tw, th), x = ctx2d(n); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, tw, th); c = n;
  }
  if (type === 'image/jpeg') {
    // JPG no admite transparencia: se pone fondo blanco
    const bg = makeCanvas(c.width, c.height); const x = ctx2d(bg);
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(c, 0, 0); c = bg;
  }
  if (type === 'image/x-icon') { const { encodeIco } = await import('./raster'); return encodeIco(c, [16, 24, 32, 48, 64, 128, 256].filter(s => s <= Math.max(16, Math.max(c.width, c.height)))); }
  if (type === 'image/tiff' || type === 'image/x-tga' || type === 'image/bmp') {
    const r = await import('./raster'), id = ctx2d(c).getImageData(0, 0, c.width, c.height);
    return type === 'image/tiff' ? r.encodeTiff(id, doc.ppi || 72) : type === 'image/x-tga' ? r.encodeTga(id) : r.encodeBmp(id);
  }
  return canvasToBlob(c, type, quality);
}

export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    inp.onchange = () => res([...(inp.files ?? [])]);
    inp.click();
  });
}
