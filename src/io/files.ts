// Abrir imágenes y proyectos, exportar y guardar. Todo ocurre en el
// navegador: nada se envía a ningún servidor.

import { EditorDocument } from '../core/document';
import { RasterLayer, TextLayer, ShapeLayer, GroupLayer, LayerMask, Layer, bumpLayerId, isRaster, isParametric } from '../core/layers';
import { canvasToBlob, ctx2d, makeCanvas } from '../core/canvas';

export const PROJECT_EXT = '.edp';
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

export async function documentFromImage(file: File | Blob, name = 'Sin título'): Promise<EditorDocument> {
  const c = await imageToCanvas(file);
  const doc = new EditorDocument(baseName(name), c.width, c.height);
  const l = new RasterLayer('Fondo', c.width, c.height);
  l.canvas = c;
  doc.root.add(l);
  doc.setActive(l, false);
  return doc;
}

export function isProjectFile(f: File) { return f.name.toLowerCase().endsWith(PROJECT_EXT); }
export function isImageFile(f: File) { return f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(f.name); }

// ---- Formato de proyecto (.edp) ---------------------------------------------
// Un archivo JSON con la estructura de capas; los píxeles de cada capa van como
// PNG en base64. Lleva un número de versión para poder ampliarlo en el futuro.

interface ProjLayer {
  id: number; type: string; name: string; visible: boolean; opacity: number; blendMode: string; locked: boolean;
  image?: string; mask?: { image: string; enabled: boolean } | null; text?: any; shape?: any; children?: ProjLayer[]; expanded?: boolean;
}
interface ProjFile {
  format: 'editor-proyecto'; version: 1; name: string; width: number; height: number;
  guides: { h: number[]; v: number[] }; activeId: number | null; layers: ProjLayer[];
}

async function canvasToDataURL(c: HTMLCanvasElement) {
  const blob = await canvasToBlob(c, 'image/png');
  return await new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob); });
}

async function layerToProj(l: Layer): Promise<ProjLayer> {
  const p: ProjLayer = {
    id: l.id, type: l.kind, name: l.name, visible: l.visible, opacity: l.opacity, blendMode: l.blendMode, locked: l.locked,
    mask: l.mask ? { image: await canvasToDataURL(l.mask.canvas), enabled: l.mask.enabled } : null,
  };
  if (l instanceof GroupLayer) { p.children = await Promise.all(l.children.map(layerToProj)); p.expanded = l.expanded; }
  else if (isRaster(l)) { p.image = await canvasToDataURL(l.canvas); if (l instanceof TextLayer) p.text = { ...l.props }; if (l instanceof ShapeLayer) p.shape = { ...l.props }; }
  return p;
}

export async function serializeProject(doc: EditorDocument): Promise<Blob> {
  const data: ProjFile = {
    format: 'editor-proyecto', version: 1, name: doc.name, width: doc.width, height: doc.height,
    guides: doc.guides, activeId: doc.active?.id ?? null,
    layers: await Promise.all(doc.root.children.map(layerToProj)),
  };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

async function projToLayer(p: ProjLayer, w: number, h: number): Promise<Layer> {
  let l: Layer;
  if (p.type === 'group') {
    const g = new GroupLayer(p.name); g.expanded = p.expanded ?? true;
    for (const c of p.children ?? []) g.add(await projToLayer(c, w, h));
    l = g;
  } else {
    const r = p.type === 'text' ? new TextLayer(p.name, w, h, p.text) : p.type === 'shape' ? new ShapeLayer(p.name, w, h, p.shape) : new RasterLayer(p.name, w, h);
    if (p.image && !isParametric(r)) { const img = await loadImage(p.image); ctx2d(r.canvas).clearRect(0, 0, w, h); ctx2d(r.canvas).drawImage(img, 0, 0); }
    l = r;
  }
  l.id = p.id; bumpLayerId(p.id);
  l.visible = p.visible; l.opacity = p.opacity; l.blendMode = p.blendMode as any; l.locked = p.locked;
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
  const doc = new EditorDocument(data.name, data.width, data.height);
  for (const p of data.layers) doc.root.add(await projToLayer(p, data.width, data.height));
  doc.guides = data.guides ?? { h: [], v: [] };
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

export async function exportImage(doc: EditorDocument, type: 'image/png' | 'image/jpeg' | 'image/webp', quality: number): Promise<Blob> {
  let c = doc.flatten();
  if (type === 'image/jpeg') {
    // JPG no admite transparencia: se pone fondo blanco
    const bg = makeCanvas(c.width, c.height); const x = ctx2d(bg);
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(c, 0, 0); c = bg;
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
