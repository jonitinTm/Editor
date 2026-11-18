// Operaciones del editor (capas, edición, imagen, selección, archivos).
// Los menús y los atajos de teclado llaman a estas funciones.

import { app } from './app';
import { EditorDocument, type LayerComp } from '../core/document';
import { effectiveMask } from '../core/layers';
import { GroupLayer, Layer, LayerMask, LayerStyles, AdjustmentLayer, SmartLayer, SmartFilter, Matrix, RasterLayer, TextLayer, ShapeLayer, isRaster, isParametric, walkLayers } from '../core/layers';
import { cloneCanvas, ctx2d, makeCanvas, contentBounds, getPixels, putPixels, canvasToBlob, Rect } from '../core/canvas';
import { compositeGroup, composeStyled } from '../core/compositor';
import { hasStyles, canvasBlend, tracePath } from '../core/layers';
import { getPaintTarget, setTargetCanvas, setPreview, PaintTarget, rasterizeLayer, clipMask } from '../tools/paint';
import { FilterDef, defaultParams } from '../filters/registry';
import * as io from '../io/files';
import { readPsd, writePsd } from '../io/psd';
import { heal, findSource } from '../filters/heal';
import { computeFilter } from '../filters/compute';
import FilterWorker from '../filters/worker?worker&inline';
import { record } from './macros';
import { snapshot, restore } from '../core/history';
import { FILTERS } from '../filters/registry';
const FILTERS_BY_ID = new Map(FILTERS.map(x => [x.id, x]));
import { addPattern, getPattern, patternFill } from '../core/patterns';
import { applyOnTarget } from '../tools/misc';
import { forget } from '../io/autosave';
import { encodeGif } from '../io/gif';
import { renderFrames } from './timeline';
import { alertDialog, confirmDialog, promptDialog } from './dialog';

const doc = () => app.doc;

/** Llamar tras deshacer/rehacer o cambiar de documento. */
export function notifyToolDocChanged() { app.tool?.docChanged?.(); }

export function undo() { const d = doc(); if (!d) return; app.tool?.cancel?.(); d.undo(); notifyToolDocChanged(); }
export function redo() { const d = doc(); if (!d) return; app.tool?.cancel?.(); d.redo(); notifyToolDocChanged(); }
export function gotoHistory(i: number) { const d = doc(); if (!d) return; app.tool?.cancel?.(); d.gotoHistory(i); notifyToolDocChanged(); }

// ---- Documentos -------------------------------------------------------------

export function newDocument(name: string, w: number, h: number, bg: string | null) {
  const d = new EditorDocument(name, w, h);
  const l = new RasterLayer(bg ? 'Fondo' : 'Capa 1', w, h);
  if (bg) { const c = ctx2d(l.canvas); c.fillStyle = bg; c.fillRect(0, 0, w, h); }
  d.root.add(l); d.setActive(l, false);
  app.addDocument(d, 'Nuevo');
}

export async function openFiles(files: File[], asLayers = false) {
  for (const f of files) {
    try {
      if (io.isProjectFile(f)) { app.addDocument(await io.openProject(f)); continue; }
      if (io.isPsdFile(f)) {
        if (asLayers && app.doc) { app.toast('Los PSD se abren en una pestaña aparte'); }
        const { doc: pd, warnings } = await readPsd(await f.arrayBuffer(), io.baseName(f.name));
        app.addDocument(pd);
        if (warnings.length) alertDialog('PSD abierto con avisos', warnings.join('. ') + '.');
        continue;
      }
      if (io.isRawFile(f)) {
        // DNG: revelado completo de los datos del sensor
        const bytes = new Uint8Array(await f.arrayBuffer());
        const { isDng, decodeDng } = await import('../io/dng');
        const { isCr2, decodeCr2 } = await import('../io/cr2');
        const { isArw, decodeArw } = await import('../io/arw');
        const { isNef, decodeNef } = await import('../io/nef');
        const cam = isCr2(bytes) ? 'Canon' : isDng(bytes) ? null : isArw(bytes) ? 'Sony' : isNef(bytes) ? 'Nikon' : null;
        if (cam) {
          try {
            app.toast(`Revelando el RAW de ${cam}…`); await new Promise(r => setTimeout(r, 30));
            const img = cam === 'Canon' ? decodeCr2(bytes) : cam === 'Sony' ? decodeArw(bytes) : decodeNef(bytes);
            const rd = new EditorDocument(io.baseName(f.name), img.width, img.height);
            const rl = new RasterLayer('Fondo', img.width, img.height); ctx2d(rl.canvas).putImageData(img, 0, 0); rd.root.add(rl); rd.setActive(rl, false);
            app.addDocument(rd);
            app.toast('RAW revelado. Ajusta exposición, blancos y color con Filtro › Revelado (Mayús+Ctrl+A)');
            continue;
          } catch (er: any) { app.toast('No se pudo revelar este RAW (' + (er?.message ?? er) + '); se abre su vista previa', 'warn'); }
        }
        if (isDng(bytes)) {
          try {
            app.toast('Revelando el RAW…'); await new Promise(r => setTimeout(r, 30));
            const img = decodeDng(bytes);
            const rd = new EditorDocument(io.baseName(f.name), img.width, img.height);
            const rl = new RasterLayer('Fondo', img.width, img.height); ctx2d(rl.canvas).putImageData(img, 0, 0); rd.root.add(rl); rd.setActive(rl, false);
            app.addDocument(rd);
            app.toast('RAW revelado. Para ajustar exposición, blancos y color: Filtro › Revelado (Mayús+Ctrl+A)');
            continue;
          } catch (er: any) { app.toast('No se pudo revelar este DNG (' + (er?.message ?? er) + '); se abre su vista previa', 'warn'); }
        }
        const c = await io.rawPreview(f);
        const rd = new EditorDocument(io.baseName(f.name), c.width, c.height);
        const rl = new RasterLayer('Fondo', c.width, c.height); rl.canvas = c; rd.root.add(rl); rd.setActive(rl, false);
        app.addDocument(rd);
        alertDialog('Archivo RAW', `Se ha abierto la vista previa JPEG que la cámara guardó dentro del RAW (${c.width} × ${c.height} px). Editor revela por completo los archivos DNG; de este formato de cámara se usa la vista previa, así que no hay margen extra de exposición ni de balance de blancos. (Consejo: si conviertes tus RAW a DNG con el conversor gratuito de Adobe, Editor los revela por completo.)`);
        continue;
      }
      if (io.isTiffTga(f)) {
        const r = await import('../io/raster'), bytes = new Uint8Array(await f.arrayBuffer());
        const pages = /\.tiff?$/i.test(f.name) || r.isTiff(bytes) ? await r.decodeTiff(bytes) : [{ name: 'Fondo', img: r.decodeTga(bytes) }];
        const canv = pages.map(pg => { const c = makeCanvas(pg.img.width, pg.img.height); ctx2d(c).putImageData(pg.img, 0, 0); return { name: pg.name, c }; });
        if (asLayers && app.doc) { await placeImage(canv[0].c, io.baseName(f.name), undefined, true); continue; }
        const W = Math.max(...canv.map(p => p.c.width)), H = Math.max(...canv.map(p => p.c.height));
        const td = new EditorDocument(io.baseName(f.name), W, H);
        canv.forEach((pg, i) => { const l = new RasterLayer(canv.length > 1 ? pg.name : 'Fondo', W, H); ctx2d(l.canvas).drawImage(pg.c, 0, 0); if (i) l.visible = false; td.root.add(l); td.setActive(l, false); });
        app.addDocument(td);
        if (canv.length > 1) app.toast(`TIFF de ${canv.length} páginas: cada una es una capa (solo la primera visible)`);
        continue;
      }
      if (!io.isImageFile(f)) { app.toast(`Formato no admitido: ${f.name}`, 'warn'); continue; }
      if (asLayers && app.doc) await placeImage(f, io.baseName(f.name), undefined, true);
      else app.addDocument(await io.documentFromImage(f, f.name));
    } catch (e: any) {
      alertDialog('No se pudo abrir', `${f.name}: ${e?.message ?? e}`);
    }
  }
}

/** Coloca una imagen como capa nueva, centrada (o en la posición indicada). */
export async function placeImage(src: Blob | HTMLCanvasElement, name: string, pos?: { x: number; y: number }, smart = false) {
  const d = doc(); if (!d) return;
  const c = src instanceof HTMLCanvasElement ? src : await io.imageToCanvas(src);
  if (smart) {
    // Como objeto inteligente: conserva la imagen original y se ajusta al lienzo si es más grande
    const inner = new EditorDocument(name, c.width, c.height);
    const il = new RasterLayer('Fondo', c.width, c.height); il.canvas = c; inner.root.add(il); inner.setActive(il, false); inner.embedded = true;
    const k = Math.min(1, d.width / c.width, d.height / c.height);
    const sl = new SmartLayer(name, d.width, d.height, inner, [k, 0, 0, k, Math.round((d.width - c.width * k) / 2), Math.round((d.height - c.height * k) / 2)]);
    d.insertAboveActive(sl);
    d.commit('Colocar objeto inteligente');
    return;
  }
  const l = new RasterLayer(name, d.width, d.height);
  const x = pos?.x ?? Math.round((d.width - c.width) / 2), y = pos?.y ?? Math.round((d.height - c.height) / 2);
  ctx2d(l.canvas).drawImage(c, x, y);
  d.insertAboveActive(l);
  d.commit('Pegar');
}

export async function closeDocument(d = doc()) {
  if (!d) return;
  if (!d.embedded && d.modified && !(await confirmDialog('Cerrar documento', `«${d.name}» tiene cambios sin guardar. ¿Cerrarlo de todas formas?`, 'Cerrar sin guardar'))) return;
  forget(d);
  app.closeDocument(d);
}

const handles = new WeakMap<EditorDocument, any>();
export async function saveProject(saveAs = false) {
  const d = doc(); if (!d) return;
  if (d.embedded) { app.toast('Es el contenido de un objeto inteligente: los cambios ya se aplican solos al documento principal'); return; }
  try {
    const blob = await io.serializeProject(d);
    const h = await io.saveBlob(blob, d.name + io.PROJECT_EXT, saveAs ? undefined : handles.get(d));
    if (h) { handles.set(d, h); if (h.name) d.name = io.baseName(h.name); }
    d.modified = false; app.emit('docs');
    forget(d);
    app.toast('Proyecto guardado');
  } catch (e: any) { if (e?.name !== 'AbortError') alertDialog('Error al guardar', String(e?.message ?? e)); }
}

export async function saveGif(name: string) {
  const d = doc(); if (!d) return;
  try {
    const frames = d.frames.length ? renderFrames(d) : [{ canvas: d.flatten(), delay: 100 }];
    await io.saveBlob(encodeGif(frames), name + '.gif');
    app.toast(frames.length > 1 ? `GIF animado guardado (${frames.length} cuadros)` : 'GIF guardado');
  } catch (e: any) { if (e?.name !== 'AbortError') alertDialog('Error al guardar', String(e?.message ?? e)); }
}

/** Imagen › Duplicar: copia completa del documento en una pestaña nueva. */
export async function duplicateDocument() {
  const d = doc(); if (!d) return;
  const copy = await io.openProject(await io.serializeProject(d));
  copy.name = d.name + ' copia';
  app.addDocument(copy, 'Duplicar');
}

/** Archivo › Exportar › Capas a archivos: un PNG por capa, dentro de un ZIP. */
export async function exportLayers(trim: boolean, onlyVisible: boolean) {
  const d = doc(); if (!d) return;
  const layers = d.allLayers().filter(l => isRaster(l) && (!onlyVisible || l.isVisibleInTree()));
  if (!layers.length) { app.toast('No hay capas que exportar', 'warn'); return; }
  const files: { name: string; data: Uint8Array }[] = [], used = new Set<string>();
  for (const l of layers) {
    const c = makeCanvas(d.width, d.height), ctx = ctx2d(c);
    const r = l as RasterLayer;
    if (hasStyles(l.styles)) composeStyled(ctx, r.canvas, l.styles, 0, 0, d.width, d.height); else ctx.drawImage(r.canvas, 0, 0);
    if (l.mask?.enabled) { ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(l.mask.canvas, 0, 0); }
    let out = c;
    if (trim) { const b = contentBounds(c); if (!b) continue; out = makeCanvas(b.w, b.h); ctx2d(out).drawImage(c, -b.x, -b.y); }
    let name = (l.name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'capa');
    let n = name, k = 2; while (used.has(n)) n = `${name} (${k++})`; used.add(n);
    files.push({ name: n + '.png', data: new Uint8Array(await (await canvasToBlob(out, 'image/png')).arrayBuffer()) });
  }
  const { makeZip } = await import('../io/zip');
  await io.saveBlob(makeZip(files), d.name + ' - capas.zip');
  app.toast(`${files.length} capas exportadas`);
}

export async function savePsd(name: string) {
  const d = doc(); if (!d) return;
  try {
    const { blob, warnings } = writePsd(d);
    await io.saveBlob(blob, name + '.psd');
    if (warnings.length) alertDialog('PSD guardado con avisos', warnings.join('. ') + '.'); else app.toast('PSD guardado');
  } catch (e: any) { if (e?.name !== 'AbortError') alertDialog('Error al guardar', String(e?.message ?? e)); }
}

// ---- Capas ------------------------------------------------------------------

export function newLayer() { const d = doc(); if (!d) return; d.newRasterLayer(); d.commit('Nueva capa'); }

export function newGroup() {
  const d = doc(); if (!d) return;
  let n = 1; const names = new Set(d.allLayers().map(l => l.name));
  while (names.has(`Grupo ${n}`)) n++;
  const g = new GroupLayer(`Grupo ${n}`);
  d.insertAboveActive(g);
  d.commit('Nuevo grupo');
}

function cloneLayer(l: Layer, d: EditorDocument): Layer {
  let c: Layer;
  if (l instanceof GroupLayer) { const g = new GroupLayer(l.name); g.expanded = l.expanded; if (l.artboard) g.artboard = { ...l.artboard }; for (const ch of l.children) g.add(cloneLayer(ch, d)); c = g; }
  else if (l instanceof AdjustmentLayer) { c = new AdjustmentLayer(l.name, l.filterId, JSON.parse(JSON.stringify(l.params))); }
  else if (l instanceof SmartLayer) { c = new SmartLayer(l.name, d.width, d.height, l.inner, l.props.m, l.filters); }
  else if (l instanceof TextLayer) { const t = new TextLayer(l.name, d.width, d.height, { ...l.props }); if (l.props.keepPixels) t.canvas = cloneCanvas(l.canvas); c = t; }
  else if (l instanceof ShapeLayer) { c = new ShapeLayer(l.name, d.width, d.height, { ...l.props }); }
  else { const r = new RasterLayer(l.name, d.width, d.height); r.canvas = cloneCanvas((l as RasterLayer).canvas); c = r; }
  c.visible = l.visible; c.opacity = l.opacity; c.blendMode = l.blendMode;
  c.styles = l.styles ? JSON.parse(JSON.stringify(l.styles)) : null; c.clip = l.clip; c.lockAlpha = l.lockAlpha; c.label = l.label;
  if (l.vmask) c.vmask = JSON.parse(JSON.stringify(l.vmask));
  if (l.mask) { const m = new LayerMask(d.width, d.height, 'black'); m.canvas = cloneCanvas(l.mask.canvas); m.enabled = l.mask.enabled; c.mask = m; }
  return c;
}

/** Capas seleccionadas en el panel, sin incluir las que ya están dentro de otro grupo seleccionado. */
export function selectedLayers(): Layer[] {
  const d = doc(); if (!d) return [];
  const sel = d.allLayers().filter(l => d.selectedIds.has(l.id));
  return sel.filter(l => { let p = l.parent; while (p) { if (sel.includes(p)) return false; p = p.parent; } return true; });
}

export function duplicateLayer() {
  const d = doc(); if (!d) return;
  const layers = selectedLayers(); if (!layers.length) return;
  let last: Layer | null = null;
  for (const l of layers) {
    const c = cloneLayer(l, d);
    c.name = l.name + ' copia';
    l.parent!.add(c, l.parent!.children.indexOf(l) + 1);
    last = c;
  }
  d.setActive(last, false);
  d.commit('Duplicar capa');
}

export function deleteLayers() {
  const d = doc(); if (!d) return;
  const layers = selectedLayers(); if (!layers.length) return;
  const first = layers[0];
  const parent = first.parent!;
  const idx = parent.children.indexOf(first);
  for (const l of layers) l.parent?.remove(l);
  const next = parent.children[Math.max(0, idx - 1)] ?? (parent !== d.root ? parent : d.allLayers().pop()) ?? null;
  d.setActive(next ?? null, false);
  d.commit('Eliminar capa');
}

export function renameLayer(l: Layer, name: string) {
  const d = doc(); if (!d || !name.trim() || name === l.name) return;
  l.name = name.trim(); d.commit('Cambiar nombre de capa');
}

export function groupLayers() {
  const d = doc(); if (!d) return;
  const layers = selectedLayers(); if (!layers.length) return;
  const top = layers[layers.length - 1];
  const parent = top.parent!;
  let n = 1; const names = new Set(d.allLayers().map(l => l.name));
  while (names.has(`Grupo ${n}`)) n++;
  const g = new GroupLayer(`Grupo ${n}`);
  parent.add(g, parent.children.indexOf(top) + 1);
  // Mantener el orden visual
  const ordered = d.allLayers().filter(l => layers.includes(l));
  for (const l of ordered) g.add(l);
  d.setActive(g, false);
  d.commit('Agrupar capas');
}

export function ungroup() {
  const d = doc(); if (!d) return;
  const g = d.active;
  if (!(g instanceof GroupLayer)) { app.toast('Selecciona un grupo para desagrupar', 'warn'); return; }
  const parent = g.parent!;
  let i = parent.children.indexOf(g);
  const kids = [...g.children];
  parent.remove(g);
  for (const k of kids) parent.add(k, i++);
  d.setActive(kids[kids.length - 1] ?? null, false);
  d.selectedIds = new Set(kids.map(k => k.id));
  d.commit('Desagrupar capas');
}

/** Mueve la capa activa: 'up', 'down', 'top', 'bottom'. */
export function arrangeLayer(where: 'up' | 'down' | 'top' | 'bottom') {
  const d = doc(); const l = d?.active; if (!d || !l || !l.parent) return;
  const p = l.parent; const i = p.children.indexOf(l);
  const to = where === 'up' ? i + 1 : where === 'down' ? i - 1 : where === 'top' ? p.children.length - 1 : 0;
  if (to < 0 || to >= p.children.length || to === i) return;
  p.children.splice(i, 1); p.children.splice(to, 0, l);
  d.commit('Organizar capa');
}

/** Mueve `layer` a una posición en `parent` (usado al arrastrar en el panel). */
export function moveLayerTo(layer: Layer, parent: GroupLayer, index: number) {
  const d = doc(); if (!d) return;
  // No se puede meter un grupo dentro de sí mismo
  let p: Layer | null = parent; while (p) { if (p === layer) return; p = p.parent; }
  const old = layer.parent!;
  const oi = old.children.indexOf(layer);
  if (old === parent && oi < index) index--;
  old.remove(layer);
  parent.add(layer, Math.max(0, Math.min(index, parent.children.length)));
  d.commit('Mover capa');
}

export function setLayerProp(l: Layer, prop: 'opacity' | 'blendMode' | 'visible' | 'locked' | 'lockAlpha', value: any, record = true) {
  const d = doc(); if (!d) return;
  (l as any)[prop] = value;
  d.invalidate();
  if (record) d.commit({ opacity: 'Opacidad de capa', blendMode: 'Modo de fusión', visible: value ? 'Mostrar capa' : 'Ocultar capa', locked: value ? 'Bloquear capa' : 'Desbloquear capa', lockAlpha: value ? 'Bloquear transparencia' : 'Desbloquear transparencia' }[prop]);
  else d.changed();
}

/** Aplica la máscara de una capa a sus píxeles (para combinar). */
function bakeLayer(l: Layer, d: EditorDocument): HTMLCanvasElement {
  const c = makeCanvas(d.width, d.height);
  const ctx = ctx2d(c);
  if (l instanceof GroupLayer) compositeGroup(l, ctx, d.width, d.height, {});
  else ctx.drawImage((l as RasterLayer).canvas, 0, 0);
  if (l.mask?.enabled) { ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(l.mask.canvas, 0, 0); }
  return c;
}

export function mergeDown() {
  const d = doc(); const l = d?.active; if (!d || !l || !l.parent) return;
  const p = l.parent; const i = p.children.indexOf(l);
  const below = p.children[i - 1];
  if (!below) { app.toast('No hay ninguna capa debajo', 'warn'); return; }
  if (below instanceof GroupLayer) { app.toast('No se puede combinar con un grupo', 'warn'); return; }
  if (l instanceof AdjustmentLayer || below instanceof AdjustmentLayer) { app.toast('Las capas de ajuste no se combinan así: usa «Combinar visibles» o «Acoplar imagen»', 'warn'); return; }
  const base = bakeLayer(below, d);
  const top = bakeLayer(l, d);
  const ctx = ctx2d(base);
  for (const [layer, c] of [[below, base], [l, top]] as const) if (hasStyles(layer.styles)) {
    // Los estilos se "hornean" en los píxeles al combinar
    const plain = cloneCanvas(c), cc = ctx2d(c);
    cc.clearRect(0, 0, d.width, d.height); composeStyled(cc, plain, layer.styles, 0, 0, d.width, d.height);
  }
  ctx.globalAlpha = l.opacity; ctx.globalCompositeOperation = canvasBlend(l.blendMode);
  if (l.visible) ctx.drawImage(top, 0, 0);
  let target = below as RasterLayer;
  if (isParametric(target)) target = rasterizeLayer(target);
  target.canvas = base; target.mask = null; target.styles = null; target.touch();
  p.remove(l);
  d.setActive(target, false);
  d.commit('Combinar hacia abajo');
}

export function mergeVisible() {
  const d = doc(); if (!d) return;
  const merged = d.flatten();
  const visibleTop = d.root.children.filter(l => l.visible);
  if (visibleTop.length < 2) { app.toast('Hace falta más de una capa visible', 'warn'); return; }
  const idx = d.root.children.indexOf(visibleTop[visibleTop.length - 1]);
  const l = new RasterLayer('Combinada', d.width, d.height);
  l.canvas = merged;
  d.root.add(l, idx + 1);
  for (const v of visibleTop) d.root.remove(v);
  d.setActive(l, false);
  d.commit('Combinar visibles');
}

export function flattenImage() {
  const d = doc(); if (!d) return;
  const c = makeCanvas(d.width, d.height);
  const ctx = ctx2d(c);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, d.width, d.height);
  ctx.drawImage(d.flatten(), 0, 0);
  const l = new RasterLayer('Fondo', d.width, d.height); l.canvas = c;
  d.root.children.slice().forEach(ch => d.root.remove(ch));
  d.root.add(l); d.setActive(l, false);
  d.commit('Acoplar imagen');
}

export function rasterize() {
  const d = doc(); const l = d?.active;
  if (!d || !isParametric(l)) { app.toast('Solo se rasterizan capas de texto, formas u objetos inteligentes', 'warn'); return; }
  rasterizeLayer(l); d.commit('Rasterizar capa');
}

/** Capa › Nueva capa de relleno: color, degradado o motivo (editable desde Propiedades). */
export function newFillLayer(id: 'solidfill' | 'gradfill' | 'patternfill') {
  const d = doc(); if (!d) return;
  const def = FILTERS_BY_ID.get(id)!;
  const p = defaultParams(def);
  if (id === 'solidfill') p.color = app.fg;
  if (id === 'gradfill') p.grad = [{ t: 0, color: app.fg, a: 1 }, { t: 1, color: app.bg, a: 1 }];
  const l = new AdjustmentLayer(`${def.name} ${d.allLayers().filter(x => x instanceof AdjustmentLayer && x.filterId === id).length + 1}`, id, p);
  l.mask = new LayerMask(d.width, d.height, 'white');
  if (d.selection.mask) { l.mask.canvas = cloneCanvas(d.selection.mask); l.mask.touch(); d.selection.clear(); }
  d.insertAboveActive(l);
  d.commit('Nueva capa de relleno');
}

/** Capa › Objeto inteligente › Reemplazar contenido: la misma posición y tamaño, otra imagen. */
export async function replaceSmartContents(file: File) {
  const d = doc(); const l = d?.active;
  if (!d || !(l instanceof SmartLayer)) { app.toast('Selecciona un objeto inteligente', 'warn'); return; }
  const inner = io.isPsdFile(f(file)) ? (await readPsd(await file.arrayBuffer(), io.baseName(file.name))).doc : await io.documentFromImage(file, file.name);
  inner.embedded = true;
  const ow = l.inner.width, oh = l.inner.height, m = l.props.m;
  // se escala para que ocupe exactamente la misma caja que el contenido anterior
  const sx = ow / inner.width, sy = oh / inner.height;
  const nm: Matrix = [m[0] * sx, m[1] * sx, m[2] * sy, m[3] * sy, m[4], m[5]];
  const nl = new SmartLayer(l.name, d.width, d.height, inner, nm, l.filters);
  nl.id = l.id; nl.opacity = l.opacity; nl.visible = l.visible; nl.blendMode = l.blendMode; nl.mask = l.mask; nl.styles = l.styles; nl.clip = l.clip; nl.label = l.label;
  const parent = l.parent!, i = parent.children.indexOf(l);
  parent.remove(l); parent.add(nl, i);
  d.setActive(nl, false);
  d.commit('Reemplazar contenido');
}
const f = (x: File) => x;

/** Crea una capa de ajuste (con máscara) encima de la capa activa. */
export function newAdjustmentLayer(def: FilterDef) {
  const d = doc(); if (!d) return;
  const l = new AdjustmentLayer(def.name.replace('…', ''), def.id, defaultParams(def));
  l.mask = new LayerMask(d.width, d.height, 'white');
  if (d.selection.mask) { l.mask.canvas = cloneCanvas(d.selection.mask); l.mask.touch(); }
  d.insertAboveActive(l);
  d.editMask = true;
  d.commit('Nueva capa de ajuste');
}

// ---- Objetos inteligentes -----------------------------------------------------------

/** Convierte las capas seleccionadas en un objeto inteligente. */
export function convertToSmart() {
  const d = doc(); if (!d) return;
  const layers = selectedLayers(); if (!layers.length) return;
  if (layers.length === 1 && layers[0] instanceof SmartLayer) { app.toast('La capa ya es un objeto inteligente'); return; }
  const ordered = d.allLayers().filter(l => layers.includes(l));
  const top = ordered[ordered.length - 1];
  const parent = top.parent!; const index = parent.children.indexOf(top);
  const name = layers.length === 1 ? top.name : 'Objeto inteligente';
  const inner = new EditorDocument(name, d.width, d.height);
  inner.embedded = true;
  const marker = new GroupLayer('');           // guarda el sitio mientras se mueven las capas
  parent.add(marker, index + 1);
  for (const l of ordered) inner.root.add(l);
  inner.setActive(inner.allLayers().pop() ?? null, false);
  // El documento interno se recorta a su contenido
  const b = contentBounds(inner.flatten());
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  if (b && (b.w < d.width || b.h < d.height)) { inner.resizeCanvas(b.w, b.h, -b.x, -b.y); m = [1, 0, 0, 1, b.x, b.y]; }
  const sl = new SmartLayer(name, d.width, d.height, inner, m);
  parent.add(sl, parent.children.indexOf(marker)); parent.remove(marker);
  d.setActive(sl, false);
  d.commit('Convertir en objeto inteligente');
}

const watched = new WeakSet<object>();
/** Abre el contenido de un objeto inteligente en su propia pestaña. */
export function editSmartContents(l = doc()?.active) {
  if (!(l instanceof SmartLayer)) { app.toast('Selecciona un objeto inteligente', 'warn'); return; }
  const inner = l.inner as EditorDocument;
  if (!watched.has(inner)) {
    watched.add(inner);
    let last: unknown = null, pending = false;
    inner.onChange(() => {
      const step = inner.history.steps[inner.history.index];
      if (step === last || pending) return;
      pending = true;
      setTimeout(() => { pending = false; last = inner.history.steps[inner.history.index]; refreshSmart(inner); }, 0);
    });
  }
  if (app.docs.includes(inner)) app.setDocument(inner); else app.addDocument(inner);
  notifyToolDocChanged();
  app.toast('Edita el contenido: el documento principal se actualiza solo');
}
/** Redibuja todos los objetos inteligentes que usan `inner` (en cualquier documento abierto). */
function refreshSmart(inner: EditorDocument) {
  const seen = new Set<EditorDocument>();
  const visit = (d: EditorDocument): boolean => {
    if (seen.has(d)) return false; seen.add(d);
    let changed = false;
    for (const l of d.allLayers()) if (l instanceof SmartLayer) {
      const sub = l.inner as EditorDocument;
      if (sub === inner || visit(sub)) { l.refresh(); changed = true; }
    }
    if (changed) { d.invalidate(); if (app.docs.includes(d)) d.changed(); }
    return changed;
  };
  for (const d of app.docs) if (d !== inner) visit(d);
  inner.modified = false;
  app.viewport.requestRender();
}

export function setLayerLabel(label: string | null) {
  const d = doc(); if (!d) return;
  for (const l of selectedLayers()) l.label = label;
  d.commit('Etiqueta de color');
}

/** Historial › Nueva instantánea: guarda el estado actual para volver a él cuando se quiera. */
export function newSnapshot() {
  const d = doc(); if (!d) return;
  d.snapshots.push({ name: `Instantánea ${d.snapshots.length + 1}`, snap: snapshot(d) });
  d.changed();
}
export function gotoSnapshot(i: number) {
  const d = doc(); const s = d?.snapshots[i]; if (!d || !s) return;
  app.tool?.cancel?.();
  restore(d, s.snap); d.invalidate();
  d.commit('Volver a ' + s.name);
  notifyToolDocChanged();
}

export function toggleClip() {
  const d = doc(); const l = d?.active; if (!d || !l || !l.parent) return;
  if (!l.clip && l.parent.children.indexOf(l) === 0) { app.toast('No hay ninguna capa debajo a la que recortar', 'warn'); return; }
  l.clip = !l.clip; d.commit(l.clip ? 'Crear máscara de recorte' : 'Soltar máscara de recorte');
}

export function setLayerStyles(l: Layer, styles: LayerStyles | null, record: boolean) {
  const d = doc(); if (!d) return;
  l.styles = styles;
  d.invalidate();
  if (record) d.commit('Estilo de capa'); else d.changed();
}

// ---- Máscaras -----------------------------------------------------------------

export function addMask(mode: 'reveal' | 'hide' | 'selection') {
  const d = doc(); const l = d?.active; if (!d || !l) return;
  if (l.mask) { app.toast('La capa ya tiene una máscara', 'warn'); return; }
  const m = new LayerMask(d.width, d.height, mode === 'hide' ? 'black' : 'white');
  if (mode === 'selection' || (mode === 'reveal' && d.selection.active)) {
    if (d.selection.mask) { m.canvas = cloneCanvas(d.selection.mask); m.touch(); }
  }
  l.mask = m; d.editMask = true;
  d.commit('Añadir máscara de capa');
}
export function deleteMask(apply: boolean) {
  const d = doc(); const l = d?.active; if (!d || !l || !l.mask) return;
  if (apply) {
    if (l instanceof GroupLayer) { app.toast('No se puede aplicar la máscara de un grupo', 'warn'); return; }
    let r = l as RasterLayer;
    if (isParametric(r)) r = rasterizeLayer(r);
    const c = ctx2d(r.canvas); c.globalCompositeOperation = 'destination-in'; c.drawImage(l.mask.canvas, 0, 0); c.globalCompositeOperation = 'source-over';
    r.touch(); r.mask = null;
  } else l.mask = null;
  d.editMask = false;
  d.commit(apply ? 'Aplicar máscara de capa' : 'Eliminar máscara de capa');
}
export function toggleMask() {
  const d = doc(); const l = d?.active; if (!d || !l?.mask) return;
  l.mask.enabled = !l.mask.enabled; d.commit(l.mask.enabled ? 'Activar máscara' : 'Desactivar máscara');
}
export function invertMask(l: Layer) {
  const d = doc(); if (!d || !l.mask) return;
  const inv = makeCanvas(d.width, d.height); const c = ctx2d(inv);
  c.fillStyle = '#fff'; c.fillRect(0, 0, d.width, d.height);
  c.globalCompositeOperation = 'destination-out'; c.drawImage(l.mask.canvas, 0, 0);
  l.mask.canvas = inv; l.mask.touch(); d.commit('Invertir máscara');
}

// ---- Selección ----------------------------------------------------------------

export function selectAll() { const d = doc(); if (!d) return; d.selection.selectAll(); d.commit('Seleccionar todo'); }
export function deselect() { const d = doc(); if (!d || !d.selection.active) return; d.selection.clear(); d.commit('Deseleccionar'); }
export function invertSelection() { const d = doc(); if (!d) return; d.selection.invert(); d.commit('Invertir selección'); }
/** Pinta el borde de la selección con el color frontal. */
export function strokeSelection(width: number, pos: 'center' | 'inside' | 'outside') {
  const d = doc(); if (!d || !d.selection.mask) return;
  const t = getPaintTarget(); if (!t || t.isMask) return;
  const sel = d.selection.mask, line = makeCanvas(d.width, d.height), lc = ctx2d(line);
  const outline = d.selection.getOutline()!;
  lc.strokeStyle = app.fg; lc.lineWidth = pos === 'center' ? width : width * 2; lc.lineCap = 'square'; lc.lineJoin = 'round';
  lc.stroke(outline);
  if (pos !== 'center') { lc.globalCompositeOperation = pos === 'inside' ? 'destination-in' : 'destination-out'; lc.drawImage(sel, 0, 0); }
  const out = cloneCanvas(t.canvas); ctx2d(out).drawImage(line, 0, 0);
  setTargetCanvas(t, out);
  d.commit('Contornear');
}

/** Selecciona los píxeles de la imagen parecidos al color frontal. */
export function colorRange(tolerance: number, record: boolean) {
  const d = doc(); if (!d) return;
  const src = getPixels(d.flatten()), s = src.data, n = parseInt(app.fg.slice(1), 16), r0 = n >> 16 & 255, g0 = n >> 8 & 255, b0 = n & 255;
  const m = makeCanvas(d.width, d.height), img = ctx2d(m).createImageData(d.width, d.height), o = img.data;
  for (let i = 0; i < s.length; i += 4) {
    const dist = Math.max(Math.abs(s[i] - r0), Math.abs(s[i + 1] - g0), Math.abs(s[i + 2] - b0));
    // borde suave: del todo dentro hasta la tolerancia, y se desvanece un poco más allá
    const a = s[i + 3] === 0 ? 0 : dist <= tolerance ? 255 : Math.max(0, 255 - (dist - tolerance) * 12);
    o[i] = o[i + 1] = o[i + 2] = 255; o[i + 3] = a;
  }
  ctx2d(m).putImageData(img, 0, 0);
  d.selection.setMask(m);
  if (record) d.commit('Gama de colores'); else d.changed();
}

type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
/** Caja del contenido de una capa (coordenadas del documento). */
function layerBox(l: Layer): Rect | null {
  if (!isRaster(l)) return null;
  const f = l.fullContent(), cb = contentBounds(f.canvas); if (!cb) return null;
  return { x: cb.x + f.x, y: cb.y + f.y, w: cb.w, h: cb.h };
}
/** Desplaza una capa con su máscara de píxeles y su máscara vectorial. */
function shiftLayer(l: Layer, dx: number, dy: number) {
  const d = doc()!; dx = Math.round(dx); dy = Math.round(dy); if (!dx && !dy) return;
  if (isParametric(l)) l.translate(dx, dy); else if (isRaster(l)) { const f = l.fullContent(); l.placeFull(f.canvas, f.x + dx, f.y + dy); }
  if (l.mask) { const m = makeCanvas(d.width, d.height), mc = ctx2d(m); mc.fillStyle = '#fff'; mc.fillRect(0, 0, d.width, d.height); mc.clearRect(dx, dy, d.width, d.height); mc.drawImage(l.mask.canvas, dx, dy); l.mask.canvas = m; l.mask.touch(); }
  if (l.vmask) for (const sp of l.vmask.subpaths) for (const q of sp.pts) { q.x += dx; q.y += dy; q.ix += dx; q.iy += dy; q.ox += dx; q.oy += dy; }
}
/** Alinear: una capa respecto a la selección o al lienzo; varias, entre sí (o a la selección si la hay). */
export function alignLayer(mode: AlignMode) {
  const d = doc(); if (!d || !d.active) return;
  const layers = (selectedLayers().includes(d.active) ? selectedLayers() : [d.active]).filter(l => isRaster(l) && !l.isLocked());
  if (!layers.length) { app.toast('Selecciona capas de píxeles, texto o formas (no bloqueadas)', 'warn'); return; }
  const boxes = layers.map(layerBox);
  let box = d.selection.bounds;
  if (!box) {
    if (layers.length > 1) { const bs = boxes.filter(Boolean) as Rect[]; if (!bs.length) return; const x = Math.min(...bs.map(b => b.x)), y = Math.min(...bs.map(b => b.y)); box = { x, y, w: Math.max(...bs.map(b => b.x + b.w)) - x, h: Math.max(...bs.map(b => b.y + b.h)) - y }; }
    else box = { x: 0, y: 0, w: d.width, h: d.height };
  }
  layers.forEach((l, k) => {
    const b = boxes[k]; if (!b) return;
    let dx = 0, dy = 0;
    if (mode === 'left') dx = box!.x - b.x; if (mode === 'right') dx = box!.x + box!.w - b.x - b.w; if (mode === 'hcenter') dx = box!.x + (box!.w - b.w) / 2 - b.x;
    if (mode === 'top') dy = box!.y - b.y; if (mode === 'bottom') dy = box!.y + box!.h - b.y - b.h; if (mode === 'vcenter') dy = box!.y + (box!.h - b.h) / 2 - b.y;
    shiftLayer(l, dx, dy);
  });
  d.invalidate(); d.commit(layers.length > 1 ? 'Alinear capas' : 'Alinear capa');
}
/** Distribuir (3 o más capas): mismos intervalos entre bordes o centros, o el mismo espacio entre ellas. */
export function distributeLayers(mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'hspace' | 'vspace') {
  const d = doc(); if (!d) return;
  const items = selectedLayers().filter(l => isRaster(l) && !l.isLocked()).map(l => ({ l, b: layerBox(l)! })).filter(x => x.b);
  if (items.length < 3) { app.toast('Selecciona al menos tres capas (Ctrl+clic en el panel Capas)', 'warn'); return; }
  const horiz = ['left', 'hcenter', 'right', 'hspace'].includes(mode);
  const key = (b: Rect) => mode === 'left' ? b.x : mode === 'right' ? b.x + b.w : mode === 'top' ? b.y : mode === 'bottom' ? b.y + b.h : horiz ? b.x + b.w / 2 : b.y + b.h / 2;
  items.sort((p, q) => key(p.b) - key(q.b));
  const n = items.length;
  if (mode === 'hspace' || mode === 'vspace') {
    // mismo hueco entre una capa y la siguiente
    const pos = (b: Rect) => horiz ? b.x : b.y, size = (b: Rect) => horiz ? b.w : b.h;
    const total = pos(items[n - 1].b) + size(items[n - 1].b) - pos(items[0].b), used = items.reduce((a, x) => a + size(x.b), 0), gap = (total - used) / (n - 1);
    let cur = pos(items[0].b) + size(items[0].b) + gap;
    for (let k = 1; k < n - 1; k++) { const b = items[k].b, delta = cur - pos(b); shiftLayer(items[k].l, horiz ? delta : 0, horiz ? 0 : delta); cur += size(b) + gap; }
  } else {
    const a = key(items[0].b), z = key(items[n - 1].b);
    for (let k = 1; k < n - 1; k++) { const target = a + (z - a) * k / (n - 1), delta = target - key(items[k].b); shiftLayer(items[k].l, horiz ? delta : 0, horiz ? 0 : delta); }
  }
  d.invalidate(); d.commit('Distribuir capas');
}

/** Convierte el trazado de la capa activa en selección. */
/**
 * Corrige un hueco (máscara `holeCanvas`, alfa = cuánto) copiando textura de una
 * zona cercana y adaptando su color. Lo usan el corrector puntual y "Rellenar según contenido".
 */
export function healHole(t: PaintTarget, holeCanvas: HTMLCanvasElement, box: Rect, name: string) {
  const d = doc()!;
  const W = d.width, H = d.height;
  const m = Math.max(6, Math.round(Math.max(box.w, box.h) * 0.35));
  const reg = { x: Math.max(0, box.x - m), y: Math.max(0, box.y - m), w: 0, h: 0 };
  reg.w = Math.min(W, box.x + box.w + m) - reg.x; reg.h = Math.min(H, box.y + box.h + m) - reg.y;
  if (reg.w < 2 || reg.h < 2) return;
  const ha = getPixels(holeCanvas, reg).data, hole = new Float32Array(reg.w * reg.h);
  for (let i = 0; i < hole.length; i++) hole[i] = ha[i * 4 + 3] / 255;
  const full = getPixels(t.canvas);
  const { dx, dy } = findSource(full, reg, hole, { x: box.x - reg.x, y: box.y - reg.y, w: box.w, h: box.h });
  const O = getPixels(t.canvas, reg);
  const sx = Math.max(0, Math.min(W - reg.w, reg.x + dx)), sy = Math.max(0, Math.min(H - reg.h, reg.y + dy));
  const C = getPixels(t.canvas, { x: sx, y: sy, w: reg.w, h: reg.h });
  const out = cloneCanvas(t.canvas);
  putPixels(out, heal(O, C, hole), reg.x, reg.y);
  setTargetCanvas(t, out);
  d.commit(name);
}

/** Edición › Rellenar según contenido: rellena la selección con textura del entorno. */
export function contentAwareFill() {
  const d = doc(); if (!d || !d.selection.mask || !d.selection.bounds) { app.toast('Haz primero una selección', 'warn'); return; }
  const t = getPaintTarget(); if (!t) return;
  if (t.isMask) { app.toast('Rellenar según contenido trabaja sobre los píxeles de la capa', 'warn'); return; }
  // Se amplía un poco la selección para que el borde también se corrija
  const hole = cloneCanvas(d.selection.mask), b = d.selection.bounds;
  const g = ctx2d(hole); g.filter = 'blur(2px)'; g.drawImage(d.selection.mask, 0, 0); g.filter = 'none';
  healHole(t, hole, { x: Math.max(0, b.x - 3), y: Math.max(0, b.y - 3), w: b.w + 6, h: b.h + 6 }, 'Rellenar según contenido');
}

// ---- Canales alfa -----------------------------------------------------------------------

export function saveSelectionAsChannel(name?: string) {
  const d = doc(); if (!d || !d.selection.mask) { app.toast('Haz primero una selección', 'warn'); return; }
  const id = Math.max(0, ...d.channels.map(c => c.id)) + 1;
  d.channels = [...d.channels, { id, name: name || `Alfa ${id}`, canvas: cloneCanvas(d.selection.mask) }];
  d.commit('Guardar selección');
}
export function loadChannel(id: number, mode: 'new' | 'add' | 'subtract' | 'intersect' = 'new', invert = false) {
  const d = doc(); const c = d?.channels.find(x => x.id === id); if (!d || !c) return;
  let m = c.canvas;
  if (invert) { m = makeCanvas(d.width, d.height); const x = ctx2d(m); x.fillStyle = '#fff'; x.fillRect(0, 0, d.width, d.height); x.globalCompositeOperation = 'destination-out'; x.drawImage(c.canvas, 0, 0); }
  d.selection.combineCanvas(mode, cloneCanvas(m));
  d.commit('Cargar selección');
}
export function deleteChannel(id: number) {
  const d = doc(); if (!d) return;
  d.channels = d.channels.filter(c => c.id !== id); d.commit('Eliminar canal');
}
export function renameChannel(id: number, name: string) {
  const d = doc(); if (!d || !name.trim()) return;
  d.channels = d.channels.map(c => c.id === id ? { ...c, name: name.trim() } : c); d.commit('Cambiar nombre de canal');
}

/** Entra o sale de la máscara rápida (Q). */
export function toggleQuickMask() {
  const d = doc(); if (!d) return;
  app.tool?.cancel?.();
  if (!d.quickMask) { d.quickMask = true; d.commit('Entrar en máscara rápida'); app.toast('Máscara rápida: pinta en negro para quitar de la selección y en blanco para añadir. Q para salir.'); return; }
  d.quickMask = false; d.quickPreview = null;
  const m = d.selection.mask;
  if (m) { const a = getPixels(m).data; let full = true; for (let i = 3; i < a.length; i += 4) if (a[i] < 255) { full = false; break; } if (full) d.selection.clear(); }
  d.commit('Salir de máscara rápida');
}

export function pathToSelection() {
  const d = doc(); const l = d?.active;
  if (d && !(l instanceof ShapeLayer && l.props.shape === 'path') && d.activePath >= 0) { docPathToSelection(d.activePath); return; }
  if (!d || !(l instanceof ShapeLayer) || l.props.shape !== 'path' || !l.props.path) { app.toast('Selecciona una capa de trazado o un trazado del panel Trazados', 'warn'); return; }
  const path = l.props.path;
  d.selection.combine('new', ctx => { ctx.beginPath(); tracePath(ctx, path.pts, true); ctx.fill(); });
  d.commit('Trazado a selección');
}
export function selectionFromLayer(l: Layer) {
  const d = doc(); if (!d || !isRaster(l)) return;
  d.selection.setMask(l.canvas); d.commit('Cargar selección');
}

// ---- Edición ------------------------------------------------------------------

let clipboard: { canvas: HTMLCanvasElement; x: number; y: number } | null = null;
let clipboardFresh = false;
export const hasFreshClipboard = () => !!clipboard && clipboardFresh;
window.addEventListener('blur', () => { clipboardFresh = false; });

/** Píxeles seleccionados de la capa activa (o de todas si `merged`). */
function selectedPixels(merged: boolean): { canvas: HTMLCanvasElement; rect: Rect } | null {
  const d = doc(); if (!d) return null;
  const src = merged ? d.flatten() : d.activeRaster()?.canvas;
  if (!src) { app.toast('Selecciona una capa de píxeles', 'warn'); return null; }
  const tmp = cloneCanvas(src);
  if (d.selection.mask) { const c = ctx2d(tmp); c.globalCompositeOperation = 'destination-in'; c.drawImage(d.selection.mask, 0, 0); }
  const rect = d.selection.active ? (contentBounds(tmp) ?? null) : { x: 0, y: 0, w: d.width, h: d.height };
  if (!rect) { app.toast('La zona seleccionada está vacía', 'warn'); return null; }
  const out = makeCanvas(rect.w, rect.h); ctx2d(out).drawImage(tmp, -rect.x, -rect.y);
  return { canvas: out, rect };
}

export async function copy(merged = false) {
  const p = selectedPixels(merged); if (!p) return;
  clipboard = { canvas: p.canvas, x: p.rect.x, y: p.rect.y };
  clipboardFresh = true;
  try {
    const blob = await canvasToBlob(p.canvas, 'image/png');
    await (navigator.clipboard as any)?.write?.([new (window as any).ClipboardItem({ 'image/png': blob })]);
  } catch { /* el portapapeles del sistema puede no estar disponible */ }
}
export async function cut() {
  const d = doc(); if (!d) return;
  // La copia interna es inmediata; el portapapeles del sistema se escribe en segundo plano
  const pending = copy(false);
  if (clipboard) clearSelection('Cortar');
  await pending;
}

/** Se llama desde el evento "paste" del navegador. */
/** Modo del próximo pegado: normal (centro de la vista), en el sitio, o dentro de la selección. */
export let pasteMode: 'center' | 'inPlace' | 'into' = 'center';
export function setPasteMode(m: typeof pasteMode) { pasteMode = m; }

/** Posición para pegar una imagen de w×h según el modo. */
function pastePos(w: number, h: number, orig?: { x: number; y: number }) {
  const d = app.doc!;
  if (pasteMode === 'inPlace' && orig) return orig;
  if (pasteMode === 'into' && d.selection.bounds) { const b = d.selection.bounds; return { x: Math.round(b.x + (b.w - w) / 2), y: Math.round(b.y + (b.h - h) / 2) }; }
  // como en Photoshop: si el sitio original está a la vista, se pega ahí; si no, en el centro de la vista
  const vp = app.viewport, a = vp.toDoc(0, 0), z = vp.toDoc(vp.width, vp.height);
  const vx0 = Math.max(0, Math.min(a.x, z.x)), vy0 = Math.max(0, Math.min(a.y, z.y)), vx1 = Math.min(d.width, Math.max(a.x, z.x)), vy1 = Math.min(d.height, Math.max(a.y, z.y));
  if (orig && orig.x + w > vx0 && orig.x < vx1 && orig.y + h > vy0 && orig.y < vy1 && w <= d.width * 1.5) return orig;
  const c = vp.toDoc(vp.width / 2, vp.height / 2);
  return { x: Math.round(Math.min(Math.max(c.x - w / 2, -w / 2), d.width - w / 2)), y: Math.round(Math.min(Math.max(c.y - h / 2, -h / 2), d.height - h / 2)) };
}
async function pasteCanvas(c: HTMLCanvasElement, orig?: { x: number; y: number }) {
  const d = app.doc!;
  const mode = pasteMode, sel = d.selection.mask ? cloneCanvas(d.selection.mask) : null;
  await placeImage(c, d.nextLayerName(), pastePos(c.width, c.height, orig));
  if (mode === 'into' && sel) { const l = d.active!; const m = new LayerMask(d.width, d.height, 'black'); m.canvas = sel; m.touch(); l.mask = m; d.selection.clear(); d.commit('Pegar dentro'); }
}

/** Pega lo copiado dentro del editor (si lo hay) con el modo indicado. */
export async function pasteInternal(mode: typeof pasteMode): Promise<boolean> {
  if (!clipboard || !app.doc) return false;
  pasteMode = mode;
  try { await pasteCanvas(clipboard.canvas, { x: clipboard.x, y: clipboard.y }); } finally { pasteMode = 'center'; }
  return true;
}

export async function pasteFromEvent(e: ClipboardEvent) {
  const files = [...(e.clipboardData?.files ?? [])].filter(f => f.type.startsWith('image/'));
  try {
  if (clipboard && clipboardFresh && app.doc) { await pasteCanvas(clipboard.canvas, { x: clipboard.x, y: clipboard.y }); return; }
  if (files.length) {
    if (!app.doc) { app.addDocument(await io.documentFromImage(files[0], 'Pegado')); return; }
    await pasteCanvas(await io.imageToCanvas(files[0]));
    return;
  }
  if (clipboard && app.doc) await pasteCanvas(clipboard.canvas, { x: clipboard.x, y: clipboard.y });
  } finally { pasteMode = 'center'; }
}

/** Borra el contenido seleccionado (o pinta la máscara con el color de fondo). */
export function clearSelection(name = 'Borrar') {
  const d = doc(); if (!d) return;
  if (!d.selection.active) { app.toast('Haz primero una selección', 'warn'); return; }
  const t = getPaintTarget(); if (!t) return;
  const out = cloneCanvas(t.canvas); const c = ctx2d(out);
  c.globalCompositeOperation = 'destination-out'; c.drawImage(d.selection.mask!, 0, 0);
  if (t.isMask) {
    // En máscaras "borrar" = pintar con el color de fondo
    const lum = luminanceOf(app.bg);
    c.globalCompositeOperation = 'lighter'; c.globalAlpha = lum; c.drawImage(d.selection.mask!, 0, 0);
  }
  setTargetCanvas(t, out);
  d.commit(name);
}
function luminanceOf(hex: string) { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255; }

/** Edición › Definir motivo: la selección (o la imagen entera) pasa a ser un motivo. */
export function definePattern(name: string) {
  const d = doc(); if (!d) return;
  const src = d.flatten(), b = d.selection.bounds ?? { x: 0, y: 0, w: d.width, h: d.height };
  if (b.w * b.h > 2048 * 2048) { app.toast('La zona es demasiado grande para un motivo (máximo 2048 × 2048)', 'warn'); return; }
  const c = makeCanvas(b.w, b.h); ctx2d(c).drawImage(src, -b.x, -b.y);
  addPattern(name, c);
  app.toast(`Motivo «${name}» definido`);
}
/** Rellena la selección (o la capa) con un motivo. */
export function fillPattern(id: string, opacity = 1, scale = 1) {
  const d = doc(); if (!d) return;
  const p = getPattern(id); if (!p) return;
  const t = getPaintTarget(); if (!t) return;
  const area = patternFill(p, d.width, d.height, scale);
  const out = applyOnTarget(t, t.canvas, area, opacity, 1);
  setTargetCanvas(t, out);
  d.commit('Rellenar con motivo');
}

export function fill(color: string, opacity = 1, name = 'Rellenar') {
  const d = doc(); if (!d) return;
  const t = getPaintTarget(); if (!t) return;
  const out = cloneCanvas(t.canvas); const c = ctx2d(out);
  const area = makeCanvas(d.width, d.height); const ac = ctx2d(area);
  ac.fillStyle = t.isMask ? '#fff' : color; ac.fillRect(0, 0, d.width, d.height);
  const sm = clipMask(t);
  if (sm) { ac.globalCompositeOperation = 'destination-in'; ac.drawImage(sm, 0, 0); }
  c.globalAlpha = opacity;
  if (t.lockAlpha) c.globalCompositeOperation = 'source-atop';
  if (t.isMask) {
    c.globalCompositeOperation = 'destination-out'; c.drawImage(area, 0, 0);
    c.globalAlpha = opacity * luminanceOf(color); c.globalCompositeOperation = 'lighter'; c.drawImage(area, 0, 0);
  } else c.drawImage(area, 0, 0);
  setTargetCanvas(t, out);
  d.commit(name);
}

/** Capa vía copiar (Ctrl+J) o vía cortar (Mayús+Ctrl+J). */
export function layerVia(cutting: boolean) {
  const d = doc(); if (!d) return;
  if (!d.selection.active) { if (!cutting) duplicateLayer(); return; }
  const p = selectedPixels(false); if (!p) return;
  if (cutting) {
    const t = getPaintTarget(); if (!t || t.isMask) return;
    const out = cloneCanvas(t.canvas); const c = ctx2d(out);
    c.globalCompositeOperation = 'destination-out'; c.drawImage(d.selection.mask!, 0, 0);
    setTargetCanvas(t, out);
  }
  const l = new RasterLayer(d.nextLayerName(), d.width, d.height);
  ctx2d(l.canvas).drawImage(p.canvas, p.rect.x, p.rect.y);
  d.insertAboveActive(l);
  d.commit(cutting ? 'Capa vía cortar' : 'Capa vía copiar');
}

// ---- Imagen ---------------------------------------------------------------------

export function cropToSelection() {
  const d = doc(); if (!d) return;
  const b = d.selection.bounds;
  if (!b) { app.toast('Haz primero una selección', 'warn'); return; }
  d.resizeCanvas(b.w, b.h, -b.x, -b.y);
  d.selection.clear();
  d.commit('Recortar');
  app.viewport.fit(true);
}

/** Amplía el lienzo para que se vea todo lo que quedó fuera al mover capas. */
export function revealAll() {
  const d = doc(); if (!d) return;
  let x0 = 0, y0 = 0, x1 = d.width, y1 = d.height;
  for (const l of d.allLayers()) if (isRaster(l) && !isParametric(l)) {
    const f = l.fullContent();
    if (f.canvas === l.canvas) continue;
    const b = contentBounds(f.canvas); if (!b) continue;
    x0 = Math.min(x0, f.x + b.x); y0 = Math.min(y0, f.y + b.y); x1 = Math.max(x1, f.x + b.x + b.w); y1 = Math.max(y1, f.y + b.y + b.h);
  }
  if (x0 === 0 && y0 === 0 && x1 === d.width && y1 === d.height) { app.toast('No hay nada fuera del lienzo'); return; }
  d.resizeCanvas(x1 - x0, y1 - y0, -x0, -y0); d.commit('Revelar todo'); app.viewport.fit(true);
}

export function trimTransparent() {
  const d = doc(); if (!d) return;
  const b = contentBounds(d.flatten());
  if (!b) { app.toast('La imagen está vacía', 'warn'); return; }
  d.resizeCanvas(b.w, b.h, -b.x, -b.y); d.commit('Cortar transparencia'); app.viewport.fit(true);
}

/** Gira o voltea el documento entero. */
export function transformImage(kind: 'rot90' | 'rot-90' | 'rot180' | 'flipH' | 'flipV') {
  const d = doc(); if (!d) return;
  const W = d.width, H = d.height;
  const swap = kind === 'rot90' || kind === 'rot-90';
  const nw = swap ? H : W, nh = swap ? W : H;
  const tf = (src: HTMLCanvasElement, bg?: string) => {
    const c = makeCanvas(nw, nh); const ctx = ctx2d(c);
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, nw, nh); ctx.globalCompositeOperation = 'source-over'; }
    ctx.save();
    ctx.translate(nw / 2, nh / 2);
    if (kind === 'rot90') ctx.rotate(Math.PI / 2);
    if (kind === 'rot-90') ctx.rotate(-Math.PI / 2);
    if (kind === 'rot180') ctx.rotate(Math.PI);
    if (kind === 'flipH') ctx.scale(-1, 1);
    if (kind === 'flipV') ctx.scale(1, -1);
    if (bg) ctx.clearRect(-W / 2, -H / 2, W, H);
    ctx.drawImage(src, -W / 2, -H / 2);
    ctx.restore();
    return c;
  };
  for (const l of d.allLayers()) {
    if (isParametric(l) && !(l instanceof SmartLayer)) rasterizeLayer(l);
  }
  const D: Matrix = kind === 'rot90' ? [0, 1, -1, 0, H, 0] : kind === 'rot-90' ? [0, -1, 1, 0, 0, W] : kind === 'rot180' ? [-1, 0, 0, -1, W, H] : kind === 'flipH' ? [-1, 0, 0, 1, W, 0] : [1, 0, 0, -1, 0, H];
  for (const l of d.allLayers()) {
    if (l instanceof SmartLayer) { l.canvas = makeCanvas(nw, nh); l.applyMatrix(D); }
    else if (isRaster(l)) { l.canvas = tf(l.canvas); l.touch(); }
    if (l.mask) { l.mask.canvas = tf(l.mask.canvas); l.mask.touch(); }
  }
  const sel = d.selection.mask ? tf(d.selection.mask) : null;
  d.channels = d.channels.map(c => ({ ...c, canvas: tf(c.canvas) }));
  d.width = nw; d.height = nh;
  d.selection.width = nw; d.selection.height = nh;
  d.selection.setMask(sel);
  d.guides = { h: [], v: [] };
  d.invalidate();
  const names = { rot90: 'Rotar lienzo 90° horario', 'rot-90': 'Rotar lienzo 90° antihorario', rot180: 'Rotar lienzo 180°', flipH: 'Voltear lienzo horizontal', flipV: 'Voltear lienzo vertical' };
  d.commit(names[kind]);
  if (swap) app.viewport.fit(true);
}

// ---- Filtros --------------------------------------------------------------------

/** Aplica un filtro con vista previa; respeta la selección y funciona también sobre máscaras. */
let filterWorker: Worker | null | undefined;
function getFilterWorker(): Worker | null {
  if (filterWorker !== undefined) return filterWorker;
  try { filterWorker = new FilterWorker(); } catch { filterWorker = null; }
  return filterWorker;
}
let sessionSeq = 0;

export class FilterSession {
  t: PaintTarget;
  region: Rect;
  private orig: ImageData;
  private sel: ImageData | null;
  private preview: HTMLCanvasElement;
  private seed = (Math.random() * 1e9) | 0;
  /** En imágenes grandes el cálculo va a un hilo de fondo. */
  private worker: Worker | null = null;
  private id = ++sessionSeq;
  private job = 0;
  private waiting = new Map<number, (img: ImageData) => void>();
  private last: { key: string; img: ImageData } | null = null;
  constructor(t: PaintTarget, public def: FilterDef, useWorker = true) {
    const d = doc()!;
    this.t = t;
    this.region = (!t.quick && d.selection.bounds) || { x: 0, y: 0, w: d.width, h: d.height };
    this.orig = getPixels(t.canvas, this.region);
    if (t.isMask) { // máscara -> imagen en grises
      const a = this.orig.data;
      for (let i = 0; i < a.length; i += 4) { a[i] = a[i + 1] = a[i + 2] = a[i + 3]; a[i + 3] = 255; }
    }
    this.sel = d.selection.mask && !t.quick ? getPixels(d.selection.mask, this.region) : null;
    this.preview = cloneCanvas(t.canvas);
    if (useWorker && this.region.w * this.region.h > 400_000) {
      this.worker = getFilterWorker();
      if (this.worker) {
        this.worker.postMessage({ type: 'init', session: this.id, w: this.orig.width, h: this.orig.height, data: this.orig.data.buffer.slice(0), sel: this.sel ? this.sel.data.buffer.slice(0) : null, filterId: def.id, isMask: !!t.isMask, lockAlpha: !!t.lockAlpha });
        this.worker.addEventListener('message', this.onMsg);
      }
    }
  }
  private onMsg = (e: MessageEvent) => {
    const m = e.data; if (m.session !== this.id) return;
    const done = this.waiting.get(m.job); this.waiting.delete(m.job);
    done?.(new ImageData(new Uint8ClampedArray(m.data), this.orig.width, this.orig.height));
  };
  static start(def: FilterDef, useWorker = true): FilterSession | null {
    const t = getPaintTarget(); if (!t) return null;
    return new FilterSession(t, def, useWorker);
  }
  /** Imagen original de la zona (para histogramas). */
  source() { return this.orig; }
  private compute(params: any): Promise<ImageData> | ImageData {
    const p = { ...params, seed: this.seed }, key = JSON.stringify(p);
    if (this.last?.key === key) return this.last.img;
    if (!this.worker) {
      const img = computeFilter(this.orig, this.sel?.data ?? null, this.def.apply, p, !!this.t.isMask, !!this.t.lockAlpha);
      this.last = { key, img }; return img;
    }
    const job = ++this.job;
    return new Promise(res => {
      this.waiting.set(job, img => { this.last = { key, img }; res(img); });
      this.worker!.postMessage({ type: 'run', session: this.id, job, params: p });
    });
  }
  render(params: any) {
    const show = (img: ImageData) => {
      putPixels(this.preview, img, this.region.x, this.region.y);
      setPreview(this.t, this.preview);
      doc()!.invalidate(this.region);
      app.viewport.requestRender();
    };
    const r = this.compute(params);
    if (r instanceof ImageData) show(r);
    else { const job = this.job; r.then(img => { if (job === this.job && !this.ended) show(img); }); }
  }
  private ended = false;
  private end() {
    this.ended = true;
    if (this.worker) { this.worker.removeEventListener('message', this.onMsg); this.worker.postMessage({ type: 'end', session: this.id }); }
  }
  clearPreview() {
    this.end();
    setPreview(this.t, null);
    doc()!.invalidate(this.region);
    app.viewport.requestRender();
  }
  async commit(params: any) {
    // Si la vista previa ya calculó estos valores se reutilizan; si no, se calcula aquí mismo
    const p = { ...params, seed: this.seed }, key = JSON.stringify(p);
    const r = this.last?.key === key ? this.last.img : computeFilter(this.orig, this.sel?.data ?? null, this.def.apply, p, !!this.t.isMask, !!this.t.lockAlpha);
    this.end();
    const out = cloneCanvas(this.t.canvas);
    putPixels(out, r, this.region.x, this.region.y);
    setPreview(this.t, null);
    setTargetCanvas(this.t, out);
    doc()!.commit(this.def.name.replace('…', ''));
  }
}

/** Sesión de filtro sobre un objeto inteligente: el filtro se añade como filtro inteligente editable. */
export class SmartFilterSession {
  private before: SmartFilter[];
  constructor(public layer: SmartLayer, public def: FilterDef, public index = -1) {
    this.before = JSON.parse(JSON.stringify(layer.filters));
  }
  source() { const d = doc()!; return getPixels(d.getComposite()); }
  private set(params: any) {
    const list: SmartFilter[] = JSON.parse(JSON.stringify(this.before));
    const f = { id: this.def.id, params: JSON.parse(JSON.stringify(params)), enabled: true };
    if (this.index >= 0) list[this.index] = { ...f, enabled: list[this.index].enabled }; else list.push(f);
    this.layer.props = { ...this.layer.props, filters: list };
    this.layer.render(); doc()!.invalidate(); app.viewport.requestRender();
  }
  render(params: any) { this.set(params); }
  clearPreview() { this.layer.props = { ...this.layer.props, filters: JSON.parse(JSON.stringify(this.before)) }; this.layer.render(); doc()!.invalidate(); app.viewport.requestRender(); }
  commit(params: any) { this.set(params); doc()!.commit((this.index >= 0 ? 'Editar filtro inteligente: ' : 'Filtro inteligente: ') + this.def.name.replace('…', '')); }
}
export function toggleSmartFilter(l: SmartLayer, i: number) {
  const list = JSON.parse(JSON.stringify(l.filters)); list[i].enabled = !list[i].enabled;
  l.props = { ...l.props, filters: list }; l.render(); doc()!.commit(list[i].enabled ? 'Mostrar filtro inteligente' : 'Ocultar filtro inteligente');
}
export function removeSmartFilter(l: SmartLayer, i: number) {
  const list = JSON.parse(JSON.stringify(l.filters)); list.splice(i, 1);
  l.props = { ...l.props, filters: list }; l.render(); doc()!.commit('Eliminar filtro inteligente');
}

export let lastFilter: { def: FilterDef; params: any } | null = null;
export function setLastFilter(def: FilterDef, params: any) { if (def.group === 'filtro') lastFilter = { def, params }; }

export async function applyFilterDirect(def: FilterDef, params: any = {}) {
  record({ kind: 'filter', id: def.id, params: JSON.parse(JSON.stringify(params)), label: def.name.replace('…', '') });
  const a = doc()?.active;
  if (a instanceof SmartLayer && !doc()!.editMask) { new SmartFilterSession(a, def).commit(params); setLastFilter(def, params); return; }
  // Sin ventana: se aplica al momento (así un Ctrl+Z inmediato deshace justo esto)
  const s = FilterSession.start(def, false); if (!s) return;
  await s.commit(params);
  setLastFilter(def, params);
}
export function repeatLastFilter() {
  if (!lastFilter) { app.toast('Aún no has aplicado ningún filtro', 'warn'); return; }
  applyFilterDirect(lastFilter.def, lastFilter.params);
}

void walkLayers;

/** Selección › Sujeto: selecciona automáticamente el objeto principal de la imagen. */
export async function selectSubjectOp() {
  const d = doc(); if (!d) return;
  app.toast('Buscando el sujeto…');
  await new Promise(r => setTimeout(r, 30));
  const { selectSubject } = await import('../filters/subject');
  const l = d.active;
  // una capa recortada (con transparencia) se usa tal cual; si no, la imagen combinada
  const src = l && isRaster(l) && !(l as any).full && hasTransparency(l.canvas) ? l.canvas : d.getComposite();
  const m = selectSubject(src);
  if (!m) { app.toast('No se ha encontrado un sujeto claro', 'warn'); return; }
  d.selection.setMask(m);
  d.commit('Seleccionar sujeto');
}
function hasTransparency(c: HTMLCanvasElement) {
  const k = Math.min(1, 200 / Math.max(c.width, c.height)), w = Math.max(1, Math.round(c.width * k)), h = Math.max(1, Math.round(c.height * k));
  const t = makeCanvas(w, h); ctx2d(t).drawImage(c, 0, 0, w, h);
  const a = ctx2d(t).getImageData(0, 0, w, h).data; let n = 0; for (let i = 3; i < a.length; i += 4) if (a[i] < 128) n++;
  return n > w * h * 0.05;
}

// ---- Mesas de trabajo ---------------------------------------------------------------

export const artboards = (d: EditorDocument) => d.root.children.filter((l): l is GroupLayer => l instanceof GroupLayer && !!l.artboard);

/** Capa › Nueva mesa de trabajo: se coloca a la derecha de las que haya (el lienzo crece si hace falta). */
export function newArtboard(w: number, h: number, bg: string | null, name?: string) {
  const d = doc(); if (!d) return;
  let boards = artboards(d);
  if (!boards.length && d.root.children.length) {
    // La primera vez, lo que ya hay pasa a ser la mesa de trabajo 1
    const g = new GroupLayer('Mesa de trabajo 1');
    g.artboard = { x: 0, y: 0, w: d.width, h: d.height, bg: null };
    for (const l of [...d.root.children]) g.add(l);
    d.root.add(g); boards = [g];
  }
  const gap = 100;
  const x = boards.length ? Math.max(...boards.map(b => b.artboard!.x + b.artboard!.w)) + gap : 0;
  const y = boards.length ? Math.min(...boards.map(b => b.artboard!.y)) : 0;
  const W = Math.max(d.width, x + w), H = Math.max(d.height, y + h);
  if (W !== d.width || H !== d.height) d.resizeCanvas(W, H, 0, 0);
  const g = new GroupLayer(name || `Mesa de trabajo ${boards.length + 1}`);
  g.artboard = { x, y, w, h, bg };
  const l = new RasterLayer(d.nextLayerName(), d.width, d.height);
  g.add(l);
  d.root.add(g);
  d.setActive(l, false);
  d.commit('Nueva mesa de trabajo');
  app.viewport.fit?.();
}

/** Exporta la imagen (o cada mesa de trabajo) en uno o varios tamaños; si salen varios archivos van en un ZIP. */
export async function exportSet(d: EditorDocument, type: io.ExportType, quality: number, scale: number, extra: number[], perBoard: boolean, base: string) {
  const ext = io.EXPORT_EXT[type];
  const flat = d.flatten();
  const regions: { name: string; c: HTMLCanvasElement }[] = [];
  const boards = artboards(d).filter(b => b.visible);
  if (perBoard && boards.length) for (const b of boards) {
    const a = b.artboard!, c = makeCanvas(a.w, a.h); ctx2d(c).drawImage(flat, -a.x, -a.y); regions.push({ name: b.name.replace(/[\\/:*?"<>|]/g, '_'), c });
  } else regions.push({ name: base, c: flat });
  const files: { name: string; data: Uint8Array }[] = [];
  for (const r of regions) for (const k of [scale, ...extra.map(e => e * scale)]) {
    const blob = await io.exportImage(d, type, quality, k, r.c);
    const suffix = k === scale ? '' : '@' + String(+(k / scale).toFixed(2)).replace('.', ',') + 'x';
    files.push({ name: r.name + suffix + (blob.type === type ? ext : '.png'), data: new Uint8Array(await blob.arrayBuffer()) });
  }
  if (files.length === 1) { await io.saveBlob(new Blob([files[0].data], { type }), files[0].name); return 1; }
  const { makeZip } = await import('../io/zip');
  await io.saveBlob(makeZip(files), base + '.zip');
  return files.length;
}

/** Imagen › Rotación del lienzo › Arbitrario: gira todo el documento; el lienzo crece para que no se corte nada. */
export function rotateImageArbitrary(deg: number, fillBottom: boolean) {
  const d = doc(); if (!d || !deg) return;
  const W = d.width, H = d.height, a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const nw = Math.max(1, Math.ceil(Math.abs(W * c) + Math.abs(H * s) - 1e-6)), nh = Math.max(1, Math.ceil(Math.abs(W * s) + Math.abs(H * c) - 1e-6));
  if (nw * nh > 268e6) { app.toast('El resultado sería demasiado grande', 'warn'); return; }
  const tf = (src: HTMLCanvasElement) => {
    const out = makeCanvas(nw, nh), x = ctx2d(out);
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.translate(nw / 2, nh / 2); x.rotate(a); x.drawImage(src, -W / 2, -H / 2);
    return out;
  };
  for (const l of d.allLayers()) if (isParametric(l) && !(l instanceof SmartLayer)) rasterizeLayer(l);
  const D: Matrix = [c, s, -s, c, nw / 2 - c * W / 2 + s * H / 2, nh / 2 - s * W / 2 - c * H / 2];
  const bottom = d.root.children[0];
  for (const l of d.allLayers()) {
    if (l instanceof SmartLayer) { l.canvas = makeCanvas(nw, nh); l.applyMatrix(D); }
    else if (isRaster(l)) {
      const r = tf(l.canvas);
      if (fillBottom && l === bottom) { const b = makeCanvas(nw, nh), bx = ctx2d(b); bx.fillStyle = app.bg; bx.fillRect(0, 0, nw, nh); bx.drawImage(r, 0, 0); l.canvas = b; } else l.canvas = r;
      l.touch();
    }
    if (l.mask) { l.mask.canvas = tf(l.mask.canvas); l.mask.touch(); }
  }
  d.channels = d.channels.map(ch => ({ ...ch, canvas: tf(ch.canvas) }));
  d.width = nw; d.height = nh;
  d.selection.width = nw; d.selection.height = nh;
  d.selection.setMask(null);
  d.guides = { h: [], v: [] };
  d.invalidate();
  d.commit(`Rotar lienzo ${+deg.toFixed(1)}°`);
  app.viewport.fit(true);
}

/** Selección › Extender (contiguous) o Similar: añade los píxeles de colores parecidos a los seleccionados. */
export function growSimilar(contiguous: boolean, tolerance = 32) {
  const d = doc(); if (!d) return;
  const m = d.selection.mask; if (!m) { app.toast('Haz primero una selección', 'warn'); return; }
  const W = d.width, H = d.height, px = ctx2d(d.getComposite()).getImageData(0, 0, W, H).data, sm = ctx2d(m).getImageData(0, 0, W, H).data;
  // colores presentes en la selección (cubos de 8 niveles por canal) ampliados con la tolerancia
  const Q = (v: number) => v >> 3, present = new Uint8Array(32768);
  for (let i = 0; i < W * H; i++) if (sm[i * 4 + 3] > 127) present[(Q(px[i * 4]) << 10) | (Q(px[i * 4 + 1]) << 5) | Q(px[i * 4 + 2])] = 1;
  const t = Math.max(0, Math.round(tolerance / 8)), ok = new Uint8Array(32768);
  for (let b = 0; b < 32768; b++) if (present[b]) {
    const r = b >> 10, g = (b >> 5) & 31, bl = b & 31;
    for (let dr = -t; dr <= t; dr++) for (let dg = -t; dg <= t; dg++) for (let db = -t; db <= t; db++) {
      const R = r + dr, G = g + dg, B = bl + db; if (R < 0 || G < 0 || B < 0 || R > 31 || G > 31 || B > 31) continue;
      ok[(R << 10) | (G << 5) | B] = 1;
    }
  }
  const match = (i: number) => ok[(Q(px[i * 4]) << 10) | (Q(px[i * 4 + 1]) << 5) | Q(px[i * 4 + 2])] === 1;
  const sel = new Uint8Array(W * H);
  if (!contiguous) for (let i = 0; i < W * H; i++) sel[i] = sm[i * 4 + 3] > 127 || match(i) ? 1 : 0;
  else {
    const st: number[] = [];
    for (let i = 0; i < W * H; i++) if (sm[i * 4 + 3] > 127) { sel[i] = 1; st.push(i); }
    while (st.length) {
      const i = st.pop()!, x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < W * H && !sel[j] && match(j)) { sel[j] = 1; st.push(j); }
    }
  }
  const out = makeCanvas(W, H), oc = ctx2d(out), img = oc.createImageData(W, H);
  for (let i = 0; i < W * H; i++) { const k = i * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = sel[i] ? 255 : sm[k + 3]; }
  oc.putImageData(img, 0, 0);
  d.selection.setMask(out);
  d.commit(contiguous ? 'Extender selección' : 'Seleccionar similar');
}

// ---- Trazados (panel Trazados) ---------------------------------------------------------

import type { DocPath } from '../core/document';
/** Dibuja todos los subtrazados de un trazado en un contexto (para rellenar, contornear o seleccionar). */
export function tracePathDoc(ctx: CanvasRenderingContext2D, p: DocPath) {
  ctx.beginPath();
  for (const sp of p.subpaths) tracePath(ctx, sp.pts, sp.closed);
}
export function newDocPath(subpaths: DocPath['subpaths'], name?: string) {
  const d = doc(); if (!d) return;
  let n = d.paths.length + 1; const names = new Set(d.paths.map(p => p.name)); while (names.has(`Trazado ${n}`)) n++;
  d.paths.push({ name: name ?? `Trazado ${n}`, subpaths });
  d.activePath = d.paths.length - 1;
  d.commit('Nuevo trazado');
}
export function fillDocPath(i: number) {
  const d = doc(); const p = d?.paths[i]; if (!d || !p) return;
  const t = getPaintTarget(); if (!t) { app.toast('Selecciona una capa de píxeles', 'warn'); return; }
  const out = cloneCanvas(t.canvas), c = ctx2d(out);
  if (t.lockAlpha) c.globalCompositeOperation = 'source-atop';
  c.fillStyle = t.isMask ? '#fff' : app.fg; tracePathDoc(c, p); c.fill('evenodd');
  setTargetCanvas(t, out); d.commit('Rellenar trazado');
}
export function strokeDocPath(i: number) {
  const d = doc(); const p = d?.paths[i]; if (!d || !p) return;
  const t = getPaintTarget(); if (!t) { app.toast('Selecciona una capa de píxeles', 'warn'); return; }
  const out = cloneCanvas(t.canvas), c = ctx2d(out);
  if (t.lockAlpha) c.globalCompositeOperation = 'source-atop';
  // contornea con el color frontal y el tamaño del pincel
  c.strokeStyle = t.isMask ? '#fff' : app.fg; c.lineWidth = Math.max(1, app.opt<number>('size', 'brush') ?? 3); c.lineCap = 'round'; c.lineJoin = 'round';
  tracePathDoc(c, p); c.stroke();
  setTargetCanvas(t, out); d.commit('Contornear trazado');
}
export function docPathToSelection(i: number) {
  const d = doc(); const p = d?.paths[i]; if (!d || !p) return;
  d.selection.combine('new', ctx => { tracePathDoc(ctx, { ...p, subpaths: p.subpaths.map(s => ({ ...s, closed: true })) }); ctx.fill('evenodd'); });
  d.commit('Trazado a selección');
}
export async function selectionToPath() {
  const d = doc(); if (!d) return;
  if (!d.selection.mask) { app.toast('Haz primero una selección', 'warn'); return; }
  const { maskContours } = await import('../core/contour');
  const loops = maskContours(d.selection.mask);
  if (!loops.length) { app.toast('La selección está vacía', 'warn'); return; }
  newDocPath(loops.map(l => ({ closed: true, pts: l.map(q => ({ x: q.x, y: q.y, ix: q.x, iy: q.y, ox: q.x, oy: q.y })) })));
}
export function deleteDocPath(i: number) {
  const d = doc(); if (!d || !d.paths[i]) return;
  d.paths.splice(i, 1); d.activePath = Math.min(d.activePath, d.paths.length - 1);
  d.commit('Eliminar trazado');
}

/** Exportar como PDF (JPEG dentro) o SVG (PNG dentro). */
export async function exportVector(kind: 'pdf' | 'svg', base: string, quality: number, scale: number) {
  const d = doc(); if (!d) return;
  const w = Math.max(1, Math.round(d.width * scale)), hh = Math.max(1, Math.round(d.height * scale));
  if (kind === 'pdf') {
    const jpg = await io.exportImage(d, 'image/jpeg', quality, scale);
    const { makePdf } = await import('../io/pdf');
    await io.saveBlob(await makePdf(new Uint8Array(await jpg.arrayBuffer()), w, hh, d.ppi * scale), base + '.pdf');
  } else {
    const png = await io.exportImage(d, 'image/png', 1, scale);
    const url = await new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(png); });
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${hh}" viewBox="0 0 ${w} ${hh}"><image width="${w}" height="${hh}" xlink:href="${url}" href="${url}"/></svg>`;
    await io.saveBlob(new Blob([svg], { type: 'image/svg+xml' }), base + '.svg');
  }
}

/** Archivo › Imprimir: abre el diálogo de impresión del navegador con la imagen ajustada a la página. */
export async function printImage() {
  const d = doc(); if (!d) return;
  const png = await io.exportImage(d, 'image/png', 1, 1);
  const url = URL.createObjectURL(png);
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.append(f);
  const fd = f.contentDocument!;
  fd.open(); fd.write(`<!doctype html><title>${d.name.replace(/[<&]/g, '')}</title><style>@page{margin:10mm}html,body{margin:0;height:100%}img{display:block;max-width:100%;max-height:100vh;margin:auto;object-fit:contain}</style><img src="${url}">`); fd.close();
  const img = fd.querySelector('img')!;
  await new Promise(r => { if (img.complete) r(null); else img.onload = () => r(null); });
  f.contentWindow!.focus(); f.contentWindow!.print();
  setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 60000);
}

/** Imagen › Modo › Escala de grises: convierte todas las capas (los textos y formas cambian su color a gris). */
export function setColorMode(mode: 'rgb' | 'gray') {
  const d = doc(); if (!d || d.mode === mode) return;
  if (mode === 'gray') {
    const g = (hex: string | null | undefined) => { if (!hex || hex[0] !== '#') return hex; const n = parseInt(hex.slice(1, 7), 16), v = Math.round((n >> 16 & 255) * 0.3 + (n >> 8 & 255) * 0.59 + (n & 255) * 0.11).toString(16).padStart(2, '0'); return '#' + v + v + v; };
    for (const l of d.allLayers()) {
      if (l instanceof TextLayer) { l.props.color = g(l.props.color)!; l.render(); }
      else if (l instanceof ShapeLayer) { l.props.fill = g(l.props.fill) ?? null; l.props.stroke = g(l.props.stroke) ?? null; l.render(); }
      else if (l instanceof SmartLayer) rasterizeLayer(l);
      if (isRaster(d.findLayer(l.id) ?? l) && !(l instanceof TextLayer) && !(l instanceof ShapeLayer)) {
        const r = (d.findLayer(l.id) ?? l) as RasterLayer, f = r.fullContent(), c = ctx2d(f.canvas), img = c.getImageData(0, 0, f.canvas.width, f.canvas.height), p = img.data;
        for (let i = 0; i < p.length; i += 4) { const v = p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11; p[i] = p[i + 1] = p[i + 2] = v; }
        c.putImageData(img, 0, 0); if (f.canvas !== r.canvas) r.placeFull(f.canvas, f.x, f.y); r.touch();
      }
    }
    app.setColors(g(app.fg)!, g(app.bg)!);
  }
  d.mode = mode; d.invalidate();
  d.commit(mode === 'gray' ? 'Escala de grises' : 'Color RGB');
}

/** Edición › Definir pincel: lo seleccionado (o la capa) se convierte en una punta de pincel. Lo oscuro pinta. */
export async function defineBrush() {
  const d = doc(); if (!d) return;
  const src = d.getComposite();
  let b = d.selection.bounds ?? (d.active && isRaster(d.active) ? contentBounds(d.active.canvas) : null) ?? { x: 0, y: 0, w: d.width, h: d.height };
  b = { x: Math.max(0, Math.floor(b.x)), y: Math.max(0, Math.floor(b.y)), w: Math.min(d.width, Math.ceil(b.w)), h: Math.min(d.height, Math.ceil(b.h)) };
  if (b.w < 2 || b.h < 2) { app.toast('La zona es demasiado pequeña', 'warn'); return; }
  const k = Math.min(1, 512 / Math.max(b.w, b.h)), w = Math.max(1, Math.round(b.w * k)), hh = Math.max(1, Math.round(b.h * k));
  const c = makeCanvas(w, hh), x = ctx2d(c); x.imageSmoothingQuality = 'high';
  // fondo blanco para que lo transparente cuente como «no pinta»
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, hh); x.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, w, hh);
  if (d.selection.mask) { const m = makeCanvas(w, hh), mx = ctx2d(m); mx.drawImage(d.selection.mask, b.x, b.y, b.w, b.h, 0, 0, w, hh); x.globalCompositeOperation = 'destination-in'; x.drawImage(m, 0, 0); }
  const img = x.getImageData(0, 0, w, hh), p = img.data;
  for (let i = 0; i < p.length; i += 4) { const lum = p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11; p[i + 3] = (255 - lum) * p[i + 3] / 255; p[i] = p[i + 1] = p[i + 2] = 255; }
  x.globalCompositeOperation = 'copy'; x.putImageData(img, 0, 0);
  const name = await promptDialog('Definir pincel', 'Nombre de la punta', `Punta ${new Date().toLocaleDateString()}`);
  if (name === null) return;
  const { addUserTip, loadUserTips } = await import('../core/brushtips');
  await loadUserTips();
  const t = addUserTip(name || 'Mi punta', c);
  app.setOpt('brush', 'tip', t.id); app.setOpt('brush', 'size', Math.min(300, Math.max(w, hh)));
  app.setTool('brush');
  app.toast('Punta de pincel creada: ya puedes pintar con ella');
}

/** Capa › Objeto inteligente › Exportar contenido: guarda lo que hay dentro (PSD si tiene capas, si no PNG). */
export async function exportSmartContents() {
  const d = doc(), l = d?.active;
  if (!(l instanceof SmartLayer)) { app.toast('Selecciona un objeto inteligente', 'warn'); return; }
  const inner = l.inner as EditorDocument;
  try {
    if (inner.allLayers().length > 1) { const { writePsd } = await import('../io/psd'); await io.saveBlob(writePsd(inner).blob, (inner.name || l.name) + '.psd'); }
    else await io.saveBlob(await io.exportImage(inner, 'image/png', 1, 1), (inner.name || l.name) + '.png');
    app.toast('Contenido exportado');
  } catch (e: any) { if (e?.name !== 'AbortError') app.toast('No se pudo exportar: ' + (e?.message ?? e), 'warn'); }
}

/** Capa › Objeto inteligente › Nuevo objeto inteligente mediante copia: una copia con contenido propio (no compartido). */
export async function smartCopyIndependent() {
  const d = doc(), l = d?.active;
  if (!d || !(l instanceof SmartLayer)) { app.toast('Selecciona un objeto inteligente', 'warn'); return; }
  const inner = await io.openProject(await io.serializeProject(l.inner as EditorDocument));
  inner.embedded = true; inner.name = (l.inner as EditorDocument).name;
  const c = new SmartLayer(l.name + ' copia', d.width, d.height, inner, l.props.m, l.filters);
  c.opacity = l.opacity; c.blendMode = l.blendMode; c.styles = l.styles ? JSON.parse(JSON.stringify(l.styles)) : null;
  const parent = l.parent!; parent.add(c, parent.children.indexOf(l) + 1);
  d.setActive(c, false);
  d.commit('Nuevo objeto inteligente mediante copia');
}

/** Edición › Escala según el contenido: cambia el tamaño del contenido de la capa sin deformar lo importante. */
export async function contentAwareScaleOp(wPct: number, hPct: number, protectSkin: boolean, protectSel: boolean) {
  const d = doc(); let l = d?.active;
  if (!d || !l || !isRaster(l) || l.isLocked()) { app.toast('Selecciona una capa de píxeles', 'warn'); return; }
  if (isParametric(l)) l = rasterizeLayer(l as RasterLayer);
  const layer = l as RasterLayer, b = contentBounds(layer.canvas);
  if (!b) { app.toast('La capa está vacía', 'warn'); return; }
  const tw = Math.max(2, Math.round(b.w * wPct / 100)), th = Math.max(2, Math.round(b.h * hPct / 100));
  if (tw === b.w && th === b.h) return;
  const src = ctx2d(layer.canvas).getImageData(b.x, b.y, b.w, b.h);
  let prot: Float32Array | null = null;
  if (protectSkin || (protectSel && d.selection.mask)) {
    prot = new Float32Array(b.w * b.h);
    const sm = protectSel && d.selection.mask ? ctx2d(d.selection.mask).getImageData(b.x, b.y, b.w, b.h).data : null, p = src.data;
    for (let i = 0; i < prot.length; i++) {
      const r = p[i * 4], g = p[i * 4 + 1], bl = p[i * 4 + 2];
      const skin = protectSkin && r > 95 && g > 40 && bl > 20 && r > g && r > bl && r - g > 15 && Math.max(r, g, bl) - Math.min(r, g, bl) > 15;
      prot[i] = (skin ? 1 : 0) + (sm && sm[i * 4 + 3] > 127 ? 1 : 0);
    }
  }
  app.toast('Escalando según el contenido…');
  const { contentAwareScale } = await import('../filters/seamcarve');
  const t0 = performance.now();
  const out = await contentAwareScale(src, tw, th, prot);
  const c = makeCanvas(layer.canvas.width, layer.canvas.height), oc = makeCanvas(out.width, out.height);
  ctx2d(oc).putImageData(out, 0, 0);
  // el resultado queda centrado donde estaba el contenido
  ctx2d(c).drawImage(layer.canvas, 0, 0); ctx2d(c).clearRect(b.x, b.y, b.w, b.h);
  ctx2d(c).drawImage(oc, Math.round(b.x + (b.w - tw) / 2), Math.round(b.y + (b.h - th) / 2));
  layer.canvas = c; layer.touch(); d.invalidate();
  d.commit('Escala según el contenido');
  app.toast(`Hecho en ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

/** Capa › Texto › Texto sobre trazado: el texto activo sigue el trazado activo del panel Trazados. */
export function textOnPath() {
  const d = doc(), l = d?.active;
  if (!d || !(l instanceof TextLayer)) { app.toast('Selecciona una capa de texto', 'warn'); return; }
  const path = d.paths[d.activePath];
  let sp = path?.subpaths[0];
  if (!sp) {
    // también vale una capa de trazado hecha con la pluma
    const shp = d.allLayers().find(x => x instanceof ShapeLayer && x.props.shape === 'path' && x.props.path) as ShapeLayer | undefined;
    if (shp) sp = shp.props.path!;
  }
  if (!sp || sp.pts.length < 2) { app.toast('Dibuja un trazado con la Pluma (modo «Trazado») y selecciónalo en el panel Trazados', 'warn'); return; }
  l.props.onPath = { pts: JSON.parse(JSON.stringify(sp.pts)), closed: sp.closed, offset: 0 };
  delete l.props.vertical; delete l.props.warp;
  l.render(); d.commit('Texto sobre trazado');
}
export function toggleVerticalText() {
  const d = doc(), l = d?.active;
  if (!d || !(l instanceof TextLayer)) { app.toast('Selecciona una capa de texto', 'warn'); return; }
  l.props.vertical = !l.props.vertical; if (l.props.vertical) delete l.props.onPath;
  l.render(); d.commit(l.props.vertical ? 'Texto vertical' : 'Texto horizontal');
}

// ---- Máscaras vectoriales ---------------------------------------------------------------

/** Capa › Máscara vectorial › Trazado actual: la capa solo se ve dentro del trazado activo. */
export function vectorMaskFromPath() {
  const d = doc(), l = d?.active;
  if (!d || !l || l === d.root) return;
  const path = d.paths[d.activePath];
  if (!path || !path.subpaths.some(s => s.pts.length >= 2)) { app.toast('Elige un trazado en el panel Trazados (dibújalo con la Pluma en modo «Trazado»)', 'warn'); return; }
  l.vmask = { subpaths: JSON.parse(JSON.stringify(path.subpaths.map(s => ({ closed: true, pts: s.pts })))), enabled: true };
  d.activePath = -1; d.invalidate(); d.commit('Máscara vectorial');
}
export function vectorMaskOp(kind: 'toggle' | 'invert' | 'delete' | 'rasterize') {
  const d = doc(), l = d?.active; if (!d || !l?.vmask) { app.toast('La capa no tiene máscara vectorial', 'warn'); return; }
  if (kind === 'toggle') l.vmask.enabled = !l.vmask.enabled;
  else if (kind === 'invert') l.vmask.invert = !l.vmask.invert;
  else if (kind === 'delete') l.vmask = undefined;
  else {
    // se convierte en máscara de píxeles (combinada con la que ya hubiera)
    const v = { ...l.vmask, enabled: true }; l.vmask = v;
    const m = effectiveMask(l, l.mask?.enabled ? l.mask.canvas : null, d.width, d.height)!;
    l.mask = new LayerMask(d.width, d.height, 'white'); l.mask.canvas = cloneCanvas(m); l.mask.touch();
    l.vmask = undefined;
  }
  d.invalidate();
  d.commit({ toggle: 'Activar/desactivar máscara vectorial', invert: 'Invertir máscara vectorial', delete: 'Eliminar máscara vectorial', rasterize: 'Rasterizar máscara vectorial' }[kind]);
}

// ---- Composiciones de capas ----------------------------------------------------------------

/** Guarda el estado actual como composición nueva (o actualiza una existente). */
export function captureLayerComp(name: string, opts: { visibility: boolean; position: boolean; appearance: boolean }, index = -1) {
  const d = doc(); if (!d) return;
  const states: LayerComp['states'] = {};
  for (const l of d.allLayers()) {
    const st: LayerComp['states'][number] = { visible: l.visible };
    if (opts.position) { const b = layerBox(l); if (b) { st.x = b.x; st.y = b.y; } }
    if (opts.appearance) { st.opacity = l.opacity; st.blendMode = l.blendMode; st.styles = l.styles ? JSON.stringify(l.styles) : null; }
    states[l.id] = st;
  }
  const comp: LayerComp = { name, ...opts, states };
  if (index >= 0 && d.layerComps[index]) d.layerComps[index] = { ...comp, name: d.layerComps[index].name };
  else d.layerComps.push(comp);
  d.changed(); app.emit('doc');
}
/** Aplica una composición: visibilidad, posición y aspecto de cada capa según lo guardado. */
export function applyLayerComp(i: number) {
  const d = doc(), c = d?.layerComps[i]; if (!d || !c) return;
  for (const l of d.allLayers()) {
    const st = c.states[l.id]; if (!st) continue;
    if (c.visibility) l.visible = st.visible;
    if (c.position && st.x !== undefined && st.y !== undefined) { const b = layerBox(l); if (b) shiftLayer(l, st.x - b.x, st.y! - b.y); }
    if (c.appearance) { if (st.opacity !== undefined) l.opacity = st.opacity; if (st.blendMode) l.blendMode = st.blendMode as any; if (st.styles !== undefined) l.styles = st.styles ? JSON.parse(st.styles) : null; }
  }
  d.invalidate(); d.commit(`Composición: ${c.name}`);
}
export function deleteLayerComp(i: number) { const d = doc(); if (!d) return; d.layerComps.splice(i, 1); d.changed(); app.emit('doc'); }
