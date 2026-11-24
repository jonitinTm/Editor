// Operaciones del editor (capas, edición, imagen, selección, archivos).
// Los menús y los atajos de teclado llaman a estas funciones.

import { app } from './app';
import { EditorDocument, type LayerComp } from '../core/document';
import { effectiveMask, dashPattern } from '../core/layers';
import { maxCanvasPixels } from '../core/polyfills';
import { isCustomBlend, drawCustomBlend } from '../core/blend';
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

export async function openFiles(files: File[], asLayers = false, remember = true) {
  for (const f of files) {
    const before = app.docs.length;
    try {
      if (io.isProjectFile(f)) { app.addDocument(await io.openProject(f)); continue; }
      // SVG: como capas vectoriales editables (si no tiene formas que convertir, se abre como imagen)
      if (!asLayers && (f.type === 'image/svg+xml' || /\.svg$/i.test(f.name))) {
        const { openSvgAsVectors } = await import('../io/svgimport');
        const r = await openSvgAsVectors(await f.text(), io.baseName(f.name)).catch(() => null);
        if (r) { app.addDocument(r.doc); app.toast(`SVG abierto como ${r.count} capa${r.count > 1 ? 's' : ''} vectorial${r.count > 1 ? 'es' : ''}` + (r.skipped ? ` (${r.skipped} elemento${r.skipped > 1 ? 's' : ''} sin convertir: textos o imágenes)` : '')); continue; }
      }
      if (io.isPsdFile(f)) {
        const { doc: pd, warnings } = await readPsd(await f.arrayBuffer(), io.baseName(f.name));
        const host = app.doc;
        if (asLayers && host) {
          // colocado en otro documento: como objeto inteligente que conserva sus capas (doble clic para editarlas)
          pd.embedded = true;
          const k = Math.min(1, host.width / pd.width, host.height / pd.height);
          const sl = new SmartLayer(pd.name, host.width, host.height, pd, [k, 0, 0, k, Math.round((host.width - pd.width * k) / 2), Math.round((host.height - pd.height * k) / 2)]);
          host.insertAboveActive(sl); host.setActive(sl, false); host.commit('Colocar PSD como objeto inteligente');
          if (warnings.length) app.toast('PSD colocado con avisos: ' + warnings[0], 'warn');
          continue;
        }
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
      if (/\.(abr|pat)$/i.test(f.name)) { await importPresets(f); continue; }
      if (/\.(aco|ase)$/i.test(f.name)) { const { importSwatches } = await import('./panels'); await importSwatches(f); continue; }
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
    } finally {
      // se recuerda en «Recientes» (solo archivos abiertos como documento nuevo)
      if (remember && app.docs.length > before && app.doc) {
        const d = app.doc!; import('../io/recent').then(r => r.addRecent(f, d.getComposite(), `${d.width} × ${d.height}`));
      }
    }
  }
}

/** Coloca una imagen como capa nueva, centrada (o en la posición indicada). */
export async function placeImage(src: Blob | HTMLCanvasElement, name: string, pos?: { x: number; y: number }, smart = false) {
  const d = doc(); if (!d) return;
  const c = src instanceof HTMLCanvasElement ? src : await io.imageToCanvas(src);
  // Con un marco seleccionado, la imagen va dentro y lo cubre entero
  const { activeFrame } = await import('../tools/shape');
  const fr = activeFrame();
  if (fr && fr.vmask) {
    const P = fr.vmask.subpaths.flatMap(s => s.pts), x0 = Math.min(...P.map(p => p.x)), y0 = Math.min(...P.map(p => p.y)), x1 = Math.max(...P.map(p => p.x)), y1 = Math.max(...P.map(p => p.y));
    const k = Math.max((x1 - x0) / c.width, (y1 - y0) / c.height), ox = (x0 + x1 - c.width * k) / 2, oy = (y0 + y1 - c.height * k) / 2;
    for (const ch of [...fr.children]) if (ch.name === 'Vacío') fr.remove(ch);
    const inner = new EditorDocument(name, c.width, c.height);
    const il = new RasterLayer('Fondo', c.width, c.height); il.canvas = c; inner.root.add(il); inner.setActive(il, false); inner.embedded = true;
    const sl = new SmartLayer(name, d.width, d.height, inner, [k, 0, 0, k, ox, oy]);
    fr.add(sl); d.setActive(sl, false);
    d.commit('Colocar en el marco');
    return;
  }
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
    d.modified = false; d.savedSnap = snapshot(d); app.emit('docs');
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

export function newLayer() {
  const d = doc(); if (!d) return;
  // capa vacía: la imagen no cambia, así que no se recompone nada ni se copia en el historial
  d.newRasterLayer().markBlank(); d.commit('Nueva capa', { x: 0, y: 0, w: 0, h: 0 });
}

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
  if (l instanceof GroupLayer) { const g = new GroupLayer(l.name); g.expanded = l.expanded; if (l.artboard) g.artboard = { ...l.artboard }; g.frame = l.frame; for (const ch of l.children) g.add(cloneLayer(ch, d)); c = g; }
  else if (l instanceof AdjustmentLayer) { c = new AdjustmentLayer(l.name, l.filterId, JSON.parse(JSON.stringify(l.params))); }
  else if (l instanceof SmartLayer) { c = new SmartLayer(l.name, d.width, d.height, l.inner, l.props.m, l.filters); }
  else if (l instanceof TextLayer) { const t = new TextLayer(l.name, d.width, d.height, JSON.parse(JSON.stringify(l.props))); if (l.props.keepPixels) t.canvas = cloneCanvas(l.canvas); c = t; }
  else if (l instanceof ShapeLayer) { c = new ShapeLayer(l.name, d.width, d.height, JSON.parse(JSON.stringify(l.props))); }
  else { const r = new RasterLayer(l.name, d.width, d.height); r.canvas = cloneCanvas((l as RasterLayer).canvas); c = r; }
  c.visible = l.visible; c.opacity = l.opacity; c.blendMode = l.blendMode;
  c.styles = l.styles ? JSON.parse(JSON.stringify(l.styles)) : null; c.clip = l.clip; c.lockAlpha = l.lockAlpha; c.lockPos = l.lockPos; c.lockPixels = l.lockPixels; c.fillOpacity = l.fillOpacity; c.label = l.label;
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

export function setLayerProp(l: Layer, prop: 'opacity' | 'fillOpacity' | 'blendMode' | 'visible' | 'locked' | 'lockAlpha' | 'lockPos' | 'lockPixels', value: any, record = true) {
  const d = doc(); if (!d) return;
  (l as any)[prop] = value;
  d.invalidate();
  if (record) d.commit({ fillOpacity: 'Relleno de capa', opacity: 'Opacidad de capa', blendMode: 'Modo de fusión', visible: value ? 'Mostrar capa' : 'Ocultar capa', locked: value ? 'Bloquear capa' : 'Desbloquear capa', lockAlpha: value ? 'Bloquear transparencia' : 'Desbloquear transparencia', lockPos: value ? 'Bloquear posición' : 'Desbloquear posición', lockPixels: value ? 'Bloquear píxeles' : 'Desbloquear píxeles' }[prop]);
  else d.changed();
}

/** Aplica la máscara de una capa a sus píxeles (para combinar). */
function bakeLayer(l: Layer, d: EditorDocument): HTMLCanvasElement {
  const c = makeCanvas(d.width, d.height);
  const ctx = ctx2d(c);
  if (l instanceof GroupLayer) compositeGroup(l, ctx, d.width, d.height, {});
  else ctx.drawImage((l as RasterLayer).canvas, 0, 0);
  // máscara de píxeles y vectorial
  const m = effectiveMask(l, l.mask?.enabled ? l.mask.canvas : null, d.width, d.height);
  if (m) { ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(m, 0, 0); ctx.globalCompositeOperation = 'source-over'; }
  return c;
}

/** Capa › Estilo de capa › Rasterizar estilo: los efectos (sombra, contorno…) pasan a ser píxeles de la capa. */
export function rasterizeStyle() {
  const d = doc(); let l = d?.active; if (!d || !l || !hasStyles(l.styles)) return;
  if (l instanceof GroupLayer || l instanceof AdjustmentLayer) { app.toast('Solo en capas de píxeles, texto o forma', 'warn'); return; }
  const base = bakeLayer(l, d), out = makeCanvas(d.width, d.height);
  composeStyled(ctx2d(out), base, l.styles!, 0, 0, d.width, d.height, undefined, l.fillOpacity);
  let r = l as RasterLayer; if (isParametric(r)) r = rasterizeLayer(r);
  r.canvas = out; r.mask = null; r.vmask = undefined; r.styles = null; r.fillOpacity = 1; r.touch();
  d.setActive(r, false); d.invalidate(); d.commit('Rasterizar estilo de capa');
}

/** Combina en una sola capa las capas seleccionadas (tal como se ven juntas). */
export function mergeSelected() {
  const d = doc(); if (!d) return;
  const sel = selectedLayers().filter(l => l.visible);
  if (sel.length < 2) return;
  // en el orden del documento (de abajo arriba)
  const order = d.allLayers(), list = sel.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const out = new RasterLayer(list[list.length - 1].name, d.width, d.height);
  compositeGroup({ children: list } as unknown as GroupLayer, ctx2d(out.canvas), d.width, d.height, {});
  out.touch();
  const top = list[list.length - 1], parent = top.parent!;
  parent.add(out, parent.children.indexOf(top) + 1);
  for (const l of list) l.parent?.remove(l);
  for (const l of selectedLayers()) if (!l.visible) l.parent?.remove(l);
  d.setActive(out, false); d.selectedIds = new Set([out.id]);
  d.invalidate(); d.commit('Combinar capas');
}

export function mergeDown() {
  const d = doc(); const l = d?.active; if (!d || !l || !l.parent) return;
  if (selectedLayers().length > 1) { mergeSelected(); return; }
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
    cc.clearRect(0, 0, d.width, d.height); composeStyled(cc, plain, layer.styles, 0, 0, d.width, d.height, undefined, layer.fillOpacity);
  }
  if (l.visible) { if (isCustomBlend(l.blendMode)) drawCustomBlend(ctx, top, 0, 0, l.blendMode, l.opacity); else { ctx.globalAlpha = l.opacity; ctx.globalCompositeOperation = canvasBlend(l.blendMode); ctx.drawImage(top, 0, 0); } }
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
  c.globalCompositeOperation = 'destination-out'; c.drawImage(l.mask.canvas, 0, 0); c.globalCompositeOperation = 'source-over';
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
  const z = setTargetCanvas(t, out, 'auto');
  d.commit('Contornear', z);
}

/** Selecciona los píxeles de la imagen parecidos al color frontal. */
export type RangeKind = 'sampled' | 'skin' | 'reds' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'magentas' | 'highlights' | 'midtones' | 'shadows';
export function colorRange(tolerance: number, record: boolean, kind: RangeKind = 'sampled', invert = false) {
  const d = doc(); if (!d) return;
  const src = getPixels(d.flatten()), s = src.data, n = parseInt(app.fg.slice(1), 16), r0 = n >> 16 & 255, g0 = n >> 8 & 255, b0 = n & 255;
  const m = makeCanvas(d.width, d.height), img = ctx2d(m).createImageData(d.width, d.height), o = img.data;
  const hueC: Record<string, number> = { reds: 0, yellows: 60, greens: 120, cyans: 180, blues: 240, magentas: 300 };
  const fuzz = Math.max(1, tolerance) / 200; // 0..1
  for (let i = 0; i < s.length; i += 4) {
    const r = s[i], g = s[i + 1], b = s[i + 2]; let a: number;
    if (kind === 'sampled') {
      const dist = Math.max(Math.abs(r - r0), Math.abs(g - g0), Math.abs(b - b0));
      // borde suave: del todo dentro hasta la tolerancia, y se desvanece un poco más allá
      a = dist <= tolerance ? 255 : Math.max(0, 255 - (dist - tolerance) * 12);
    } else if (kind === 'highlights' || kind === 'midtones' || kind === 'shadows') {
      const L = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
      const v = kind === 'highlights' ? (L - 0.55) / 0.25 : kind === 'shadows' ? (0.45 - L) / 0.25 : 1 - Math.abs(L - 0.5) / 0.25;
      a = Math.max(0, Math.min(1, v + (fuzz - 0.2))) * 255;
    } else {
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
      let h = 0; if (mx !== mn) h = mx === r ? ((g - b) / (mx - mn) + 6) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4; h *= 60;
      if (kind === 'skin') {
        // tonos de piel: tono anaranjado, saturación media y luz suficiente
        const dh = Math.min(Math.abs(h - 22), 360 - Math.abs(h - 22)), okS = sat > 0.12 && sat < 0.7, okV = mx > 60;
        a = okS && okV ? Math.max(0, Math.min(1, 1 - (dh - 10 - fuzz * 20) / 15)) * Math.min(1, (sat - 0.12) / 0.08) * 255 : 0;
      } else {
        const c = hueC[kind], dh = Math.min(Math.abs(h - c), 360 - Math.abs(h - c));
        a = Math.max(0, Math.min(1, 1 - (dh - 8 - fuzz * 25) / 15)) * Math.min(1, sat / 0.25) * 255;
      }
    }
    if (invert) a = 255 - a;
    o[i] = o[i + 1] = o[i + 2] = 255; o[i + 3] = s[i + 3] === 0 ? 0 : a;
  }
  ctx2d(m).putImageData(img, 0, 0);
  d.selection.setMask(m);
  if (record) d.commit('Gama de colores'); else d.changed();
}

type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
/** Caja del contenido de una capa (coordenadas del documento). */
export function layerBox(l: Layer): Rect | null {
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
  const layers = (selectedLayers().includes(d.active) ? selectedLayers() : [d.active]).filter(l => isRaster(l) && !l.posLocked());
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
  const items = selectedLayers().filter(l => isRaster(l) && !l.posLocked()).map(l => ({ l, b: layerBox(l)! })).filter(x => x.b);
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
  const out = healCanvas(t.canvas, holeCanvas, box); if (!out) return;
  const z = setTargetCanvas(t, out, 'auto');
  doc()!.commit(name, z);
}

/** Rellena el hueco (alfa de `holeCanvas`, dentro de `box`) con textura del entorno; devuelve el lienzo nuevo. */
export function healCanvas(src: HTMLCanvasElement, holeCanvas: HTMLCanvasElement, box: Rect): HTMLCanvasElement | null {
  const W = src.width, H = src.height;
  const m = Math.max(6, Math.round(Math.max(box.w, box.h) * 0.35));
  const reg = { x: Math.max(0, box.x - m), y: Math.max(0, box.y - m), w: 0, h: 0 };
  reg.w = Math.min(W, box.x + box.w + m) - reg.x; reg.h = Math.min(H, box.y + box.h + m) - reg.y;
  if (reg.w < 2 || reg.h < 2) return null;
  const ha = getPixels(holeCanvas, reg).data, hole = new Float32Array(reg.w * reg.h);
  for (let i = 0; i < hole.length; i++) hole[i] = ha[i * 4 + 3] / 255;
  const full = getPixels(src);
  const { dx, dy } = findSource(full, reg, hole, { x: box.x - reg.x, y: box.y - reg.y, w: box.w, h: box.h });
  const O = getPixels(src, reg);
  const sx = Math.max(0, Math.min(W - reg.w, reg.x + dx)), sy = Math.max(0, Math.min(H - reg.h, reg.y + dy));
  const C = getPixels(src, { x: sx, y: sy, w: reg.w, h: reg.h });
  const out = cloneCanvas(src);
  putPixels(out, heal(O, C, hole), reg.x, reg.y);
  return out;
}

/** Edición › Rellenar según contenido: rellena la selección con textura del entorno. */
/** Rellenar la selección con IA (y, si no se puede, con el método clásico). */
export async function aiContentFill() {
  const d = doc(); if (!d || !d.selection.mask || !d.selection.bounds) { app.toast('Haz primero una selección de lo que quieres borrar', 'warn'); return; }
  const t = getPaintTarget(); if (!t || t.isMask) { app.toast('Elige la capa con la foto', 'warn'); return; }
  const hole = cloneCanvas(d.selection.mask), b = d.selection.bounds;
  const g = ctx2d(hole); g.filter = 'blur(2px)'; g.drawImage(d.selection.mask, 0, 0); g.filter = 'none';
  const { aiInpaint } = await import('../ai/ai');
  const out = await aiInpaint(t.canvas, hole, { x: b.x - 3, y: b.y - 3, w: b.w + 6, h: b.h + 6 });
  if (!out) { contentAwareFill(); return; }
  const z = setTargetCanvas(t, out, 'auto'); d.commit('Borrar con IA', z);
}
export function contentAwareFill() {
  const d = doc(); if (!d || !d.selection.mask || !d.selection.bounds) { app.toast('Haz primero una selección', 'warn'); return; }
  const t = getPaintTarget(); if (!t) return;
  if (t.isMask) { app.toast('Rellenar según contenido trabaja sobre los píxeles de la capa', 'warn'); return; }
  // Se amplía un poco la selección para que el borde también se corrija
  const hole = cloneCanvas(d.selection.mask), b = d.selection.bounds;
  const g = ctx2d(hole); g.filter = 'blur(2px)'; g.drawImage(d.selection.mask, 0, 0); g.filter = 'none';
  // reconstrucción por parches (mejor con texturas y bordes); si la zona es enorme, se usa el corrector rápido
  const box = { x: Math.max(0, b.x - 3), y: Math.max(0, b.y - 3), w: b.w + 6, h: b.h + 6 };
  if (b.w * b.h > 2500 * 2500) { healHole(t, hole, box, 'Rellenar según contenido'); return; }
  app.toast('Rellenando…');
  inpaintCanvas(t.canvas, hole, box).then(out => { if (!out) return; const z = setTargetCanvas(t, out, 'auto'); d.commit('Rellenar según contenido', z); });
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
  const zone = d.selection.bounds ?? undefined;
  setTargetCanvas(t, out, zone);
  d.commit(name, zone);
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
  const zone = d.selection.active ? d.selection.bounds ?? undefined : undefined;
  setTargetCanvas(t, out, zone);
  d.commit('Rellenar con motivo', zone);
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
  const zone = sm && d.selection.active ? d.selection.bounds ?? undefined : undefined;
  setTargetCanvas(t, out, zone);
  d.commit(name, zone);
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
    setTargetCanvas(t, out, d.selection.bounds);
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
  private pending: { key: string; promise: Promise<ImageData> } | null = null;
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
    if (this.pending?.key === key) return this.pending.promise; // ya se está calculando esto mismo
    const job = ++this.job;
    const promise = new Promise<ImageData>(res => {
      this.waiting.set(job, img => { this.last = { key, img }; if (this.pending?.promise === promise) this.pending = null; res(img); });
      this.worker!.postMessage({ type: 'run', session: this.id, job, params: p });
    });
    this.pending = { key, promise };
    return promise;
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
    // en imágenes grandes se espera al hilo de fondo (la pantalla no se congela mientras tanto)
    if (this.last?.key !== key && this.worker && !this.ended) await this.compute(params);
    const r = this.last?.key === key ? this.last.img : computeFilter(this.orig, this.sel?.data ?? null, this.def.apply, p, !!this.t.isMask, !!this.t.lockAlpha);
    this.end();
    const out = cloneCanvas(this.t.canvas);
    putPixels(out, r, this.region.x, this.region.y);
    setPreview(this.t, null);
    // el filtro solo cambia su zona (la selección): el historial guarda solo esa zona
    setTargetCanvas(this.t, out, this.region);
    doc()!.commit(this.def.name.replace('…', ''), this.region);
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
/** Quitar fondo: detecta el sujeto de la capa activa y oculta el resto con una máscara (no destructivo). */
export async function removeBackground() {
  const d = doc(); const l = d?.active; if (!d || !l) return;
  if (l instanceof GroupLayer || l.kind === 'adjust') { app.toast('Elige una capa con la imagen', 'warn'); return; }
  app.toast('Quitando el fondo…');
  await new Promise(r => setTimeout(r, 30));
  const { selectSubject } = await import('../filters/subject');
  const src = isRaster(l) ? l.canvas : d.getComposite();
  const m = selectSubject(src);
  if (!m) { app.toast('No se ha encontrado un sujeto claro: prueba con Selección rápida', 'warn'); return; }
  // borde algo suavizado para que no quede dentado
  const soft = makeCanvas(m.width, m.height), sx = ctx2d(soft); sx.filter = 'blur(0.8px)'; sx.drawImage(m, 0, 0); sx.filter = 'none';
  if (l.mask) { const mc = ctx2d(l.mask.canvas); mc.globalCompositeOperation = 'destination-in'; mc.drawImage(soft, 0, 0); mc.globalCompositeOperation = 'source-over'; l.mask.enabled = true; l.mask.touch(); }
  else { const mk = new LayerMask(d.width, d.height, 'white'); mk.canvas = soft; mk.touch(); l.mask = mk; }
  d.editMask = false; d.invalidate();
  d.commit('Quitar fondo');
  app.toast('Fondo quitado con una máscara: pinta en ella en blanco o negro para retocar el borde');
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
/** Mesa de trabajo nueva en un sitio concreto (herramienta Mesa de trabajo). */
export function newArtboardAt(r: Rect, bg: string | null = '#ffffff') {
  const d = doc(); if (!d) return;
  let boards = artboards(d);
  if (!boards.length && d.root.children.length) {
    const g = new GroupLayer('Mesa de trabajo 1');
    g.artboard = { x: 0, y: 0, w: d.width, h: d.height, bg: null };
    for (const l of [...d.root.children]) g.add(l);
    d.root.add(g); boards = [g];
  }
  const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y)), w = Math.max(1, Math.round(r.w)), h = Math.max(1, Math.round(r.h));
  const W = Math.max(d.width, x + w), H = Math.max(d.height, y + h);
  if (W !== d.width || H !== d.height) d.resizeCanvas(W, H, 0, 0);
  const g = new GroupLayer(`Mesa de trabajo ${boards.length + 1}`);
  g.artboard = { x, y, w, h, bg };
  const l = new RasterLayer(d.nextLayerName(), d.width, d.height);
  g.add(l); d.root.add(g); d.setActive(l, false);
  d.commit('Nueva mesa de trabajo');
  return g;
}

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
export function rotateImageArbitrary(deg: number, fill: boolean | 'content') {
  const fillBottom = fill === true;
  const d = doc(); if (!d || !deg) return;
  const W = d.width, H = d.height, a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const nw = Math.max(1, Math.ceil(Math.abs(W * c) + Math.abs(H * s) - 1e-6)), nh = Math.max(1, Math.ceil(Math.abs(W * s) + Math.abs(H * c) - 1e-6));
  if (nw * nh > maxCanvasPixels()) { app.toast('El resultado sería demasiado grande', 'warn'); return; }
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
  app.viewport.fit(true);
  const name = `Rotar lienzo ${+deg.toFixed(1)}°`;
  if (fill === 'content' && isRaster(bottom) && !isParametric(bottom)) {
    // las esquinas vacías de la capa de abajo se inventan a partir de la foto
    const L = bottom as RasterLayer, hole = makeCanvas(nw, nh), hx = ctx2d(hole), id = ctx2d(L.canvas).getImageData(0, 0, nw, nh), hi = hx.createImageData(nw, nh);
    for (let i = 3; i < id.data.length; i += 4) if (id.data[i] < 250) hi.data[i] = 255;
    hx.putImageData(hi, 0, 0);
    app.toast('Rellenando las esquinas…');
    inpaintCanvas(L.canvas, hole, { x: 0, y: 0, w: nw, h: nh }).then(out => { if (out) { L.canvas = out; L.touch(); d.invalidate(); } d.commit(name); });
    return;
  }
  d.commit(name);
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
  const z = setTargetCanvas(t, out, 'auto'); d.commit('Rellenar trazado', z);
}
export function strokeDocPath(i: number) {
  const d = doc(); const p = d?.paths[i]; if (!d || !p) return;
  const t = getPaintTarget(); if (!t) { app.toast('Selecciona una capa de píxeles', 'warn'); return; }
  const out = cloneCanvas(t.canvas), c = ctx2d(out);
  if (t.lockAlpha) c.globalCompositeOperation = 'source-atop';
  // contornea con el color frontal y el tamaño del pincel
  c.strokeStyle = t.isMask ? '#fff' : app.fg; c.lineWidth = Math.max(1, app.opt<number>('size', 'brush') ?? 3); c.lineCap = 'round'; c.lineJoin = 'round';
  tracePathDoc(c, p); c.stroke();
  const z = setTargetCanvas(t, out, 'auto'); d.commit('Contornear trazado', z);
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

/** Recorte con perspectiva: el cuadrilátero elegido pasa a ser el documento entero, enderezado. */
export async function perspectiveCrop(quad: { x: number; y: number }[], ow: number, oh: number) {
  const d = doc(); if (!d || quad.length !== 4) return;
  ow = Math.max(1, Math.round(ow)); oh = Math.max(1, Math.round(oh));
  if (ow * oh > maxCanvasPixels()) { app.toast('El resultado sería demasiado grande', 'warn'); return; }
  const { warpQuadToRect } = await import('../tools/transform');
  for (const l of d.allLayers()) if (isParametric(l)) rasterizeLayer(l);
  const tf = (c: HTMLCanvasElement) => warpQuadToRect(c, quad, ow, oh);
  for (const l of d.allLayers()) {
    if (isRaster(l)) { (l as RasterLayer).canvas = tf(l.canvas); l.touch(); }
    if (l.mask) { l.mask.canvas = tf(l.mask.canvas); l.mask.touch(); }
  }
  d.channels = d.channels.map(ch => ({ ...ch, canvas: tf(ch.canvas) }));
  d.width = ow; d.height = oh; d.selection.width = ow; d.selection.height = oh; d.selection.setMask(null);
  d.guides = { h: [], v: [] };
  d.invalidate(); d.commit('Recorte con perspectiva'); app.viewport.fit(true);
}

// ---- Cielo -------------------------------------------------------------------------------------

/** Selección › Cielo. */
export async function selectSkyOp() {
  const d = doc(); if (!d) return;
  app.toast('Buscando el cielo…'); await new Promise(r => setTimeout(r, 30));
  const { selectSky } = await import('../filters/sky');
  const m = selectSky(d.getComposite());
  if (!m) { app.toast('No se ha encontrado un cielo claro en la parte de arriba', 'warn'); return; }
  d.selection.setMask(m); d.commit('Seleccionar cielo');
}

/**
 * Edición › Sustituir cielo: crea un grupo con el cielo nuevo (enmascarado) y un ajuste de color del
 * primer plano para que la luz encaje. Todo queda editable.
 */
export async function replaceSky(sky: HTMLCanvasElement, opt: { shift: number; fade: number; brightness: number; lighting: number; flip: boolean; mask?: HTMLCanvasElement | null }) {
  const d = doc(); if (!d) return;
  const { selectSky } = await import('../filters/sky');
  const m0 = opt.mask ?? selectSky(d.getComposite());
  if (!m0) { app.toast('No se ha encontrado un cielo claro en la parte de arriba', 'warn'); return; }
  const W = d.width, H = d.height;
  // máscara: desplazar borde (+ crece hacia abajo) y difuminar
  const m = makeCanvas(W, H), mx = ctx2d(m);
  const blur = Math.max(0, opt.fade);
  mx.filter = blur ? `blur(${blur}px)` : 'none'; mx.drawImage(m0, 0, opt.shift); if (opt.shift > 0) mx.drawImage(m0, 0, 0); mx.filter = 'none';
  // el cielo cubre la zona de cielo (de arriba hasta el horizonte más bajo)
  const b = contentBounds(m0) ?? { x: 0, y: 0, w: W, h: H };
  const skyH = Math.min(H, b.y + b.h + Math.max(20, opt.shift + 20));
  const k = Math.max(W / sky.width, skyH / sky.height);
  const sl = new RasterLayer('Cielo', W, H), sx = ctx2d(sl.canvas);
  sx.imageSmoothingQuality = 'high';
  if (opt.flip) { sx.translate(W, 0); sx.scale(-1, 1); }
  sx.drawImage(sky, (W - sky.width * k) / 2, 0, sky.width * k, sky.height * k);
  sx.setTransform(1, 0, 0, 1, 0, 0);
  if (opt.brightness) { const id = sx.getImageData(0, 0, W, H), a = id.data, f = 1 + opt.brightness / 100; for (let i = 0; i < a.length; i += 4) { a[i] = a[i] * f; a[i + 1] = a[i + 1] * f; a[i + 2] = a[i + 2] * f; } sx.putImageData(id, 0, 0); }
  const skyMask = new LayerMask(W, H, 'black'); skyMask.canvas = m; skyMask.touch(); sl.mask = skyMask;
  // color medio del cielo nuevo para teñir un poco el primer plano
  const t = makeCanvas(1, 1), tx = ctx2d(t); tx.drawImage(sky, 0, 0, 1, 1); const [r, g, bb] = tx.getImageData(0, 0, 1, 1).data;
  const fl = new RasterLayer('Iluminación del primer plano', W, H), fx = ctx2d(fl.canvas); fx.fillStyle = `rgb(${r},${g},${bb})`; fx.fillRect(0, 0, W, H);
  fl.blendMode = 'soft-light'; fl.opacity = Math.max(0, Math.min(1, opt.lighting / 100));
  const inv = makeCanvas(W, H), ix = ctx2d(inv); ix.fillStyle = '#fff'; ix.fillRect(0, 0, W, H); ix.globalCompositeOperation = 'destination-out'; ix.drawImage(m, 0, 0);
  const fm = new LayerMask(W, H, 'black'); fm.canvas = inv; fm.touch(); fl.mask = fm;
  const g2 = new GroupLayer('Sustitución de cielo'); g2.add(fl); g2.add(sl);
  // el grupo va encima de todo para que tape el cielo original
  d.root.add(g2); d.setActive(sl, false);
  d.selection.setMask(null);
  d.invalidate(); d.commit('Sustituir cielo');
}

/** Exporta cada sector en su archivo (ZIP), con una página HTML opcional que los coloca en su sitio. */
export async function exportSlices(type: 'image/png' | 'image/jpeg' | 'image/webp', quality: number, scale: number, withHtml: boolean) {
  const d = doc(); if (!d) return 0;
  const flat = d.flatten(), ext = io.EXPORT_EXT[type];
  const files: { name: string; data: Uint8Array }[] = [], used = new Set<string>();
  const parts: string[] = [];
  for (const s of d.slices) {
    const c = makeCanvas(s.w, s.h); ctx2d(c).drawImage(flat, -s.x, -s.y);
    const blob = await io.exportImage(d, type, quality, scale, c);
    let base = (s.name || 'sector').replace(/[\\/:*?"<>|]/g, '_'), n = base, k = 2; while (used.has(n)) n = `${base}_${k++}`; used.add(n);
    const fname = n + (blob.type === type ? ext : '.png');
    files.push({ name: 'images/' + fname, data: new Uint8Array(await blob.arrayBuffer()) });
    parts.push(`<img src="images/${fname}" alt="" style="position:absolute;left:${Math.round(s.x * scale)}px;top:${Math.round(s.y * scale)}px;width:${Math.round(s.w * scale)}px;height:${Math.round(s.h * scale)}px">`);
  }
  if (withHtml) files.push({ name: (d.name || 'pagina') + '.html', data: new TextEncoder().encode(`<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><title>${d.name}</title></head>\n<body style="margin:0"><div style="position:relative;width:${Math.round(d.width * scale)}px;height:${Math.round(d.height * scale)}px">\n${parts.join('\n')}\n</div></body></html>\n`) });
  const { makeZip } = await import('../io/zip');
  await io.saveBlob(makeZip(files), (d.name || 'sectores') + '-sectores.zip');
  return files.length;
}

/** Contornos (en coordenadas del documento) de lo opaco de una capa, calculados a 3× para más precisión. */
export async function layerOutlines(l: Layer): Promise<{ closed: boolean; pts: import('../core/layers').PathPoint[] }[]> {
  const d = doc()!, S = 3, src = (l as RasterLayer).canvas;
  const big = makeCanvas(d.width * S, d.height * S), bx = ctx2d(big);
  bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = 'high'; bx.drawImage(src, 0, 0, big.width, big.height);
  const { maskContours } = await import('../core/contour');
  const loops = maskContours(big, 1.2);
  return loops.filter(lp => lp.length >= 3).map(lp => ({ closed: true, pts: lp.map(q => { const x = q.x / S, y = q.y / S; return { x, y, ix: x, iy: y, ox: x, oy: y }; }) }));
}

/** Capa › Texto › Convertir en forma: una capa de relleno de color con una máscara vectorial con la forma de las letras. */
export async function textToShape() {
  const d = doc(); const l = d?.active; if (!d || !l || !isRaster(l)) return;
  const subpaths = await layerOutlines(l);
  if (!subpaths.length) { app.toast('La capa está vacía', 'warn'); return; }
  const color = l instanceof TextLayer ? l.props.color : app.fg;
  const def = FILTERS_BY_ID.get('solidfill')!, p = defaultParams(def); p.color = color;
  const f = new AdjustmentLayer(l.name, 'solidfill', p);
  f.vmask = { subpaths, enabled: true };
  f.opacity = l.opacity; f.blendMode = l.blendMode; f.styles = l.styles ? JSON.parse(JSON.stringify(l.styles)) : null; f.visible = l.visible;
  const parent = l.parent!; parent.add(f, parent.children.indexOf(l)); parent.remove(l);
  d.setActive(f, false); d.invalidate(); d.commit('Convertir en forma');
}
/** Capa › Texto › Crear trazado de trabajo: el contorno de la capa como trazado (panel Trazados). */
export async function layerToPath() {
  const d = doc(); const l = d?.active; if (!d || !l || !isRaster(l)) return;
  const subpaths = await layerOutlines(l);
  if (!subpaths.length) { app.toast('La capa está vacía', 'warn'); return; }
  newDocPath(subpaths);
}

/** Importa pinceles (.abr) o motivos (.pat) de Photoshop. */
export async function importPresets(f: File) {
  const buf = await f.arrayBuffer();
  if (/\.abr$/i.test(f.name)) {
    const { readAbr } = await import('../io/abr'); const { addUserTip } = await import('../core/brushtips');
    const list = readAbr(buf);
    if (!list.length) { app.toast('El archivo no tiene pinceles con imagen que se puedan usar', 'warn'); return; }
    for (const t of list.reverse()) {
      // se guardan como máximo a 512 px de lado (suficiente para pintar y para no llenar el almacenamiento)
      const k = Math.min(1, 512 / Math.max(t.canvas.width, t.canvas.height)), c = makeCanvas(Math.max(1, Math.round(t.canvas.width * k)), Math.max(1, Math.round(t.canvas.height * k)));
      const x = ctx2d(c); x.imageSmoothingQuality = 'high'; x.drawImage(t.canvas, 0, 0, c.width, c.height);
      addUserTip(t.name, c);
    }
    app.emit('options');
    app.toast(`${list.length} pincel${list.length === 1 ? '' : 'es'} importado${list.length === 1 ? '' : 's'}: elígelos en la punta del pincel`);
  } else {
    const { readPatFile } = await import('../io/psd');
    const list = readPatFile(buf);
    for (const p of list.reverse()) addPattern(p.name, p.canvas);
    app.toast(`${list.length} motivo${list.length === 1 ? '' : 's'} importado${list.length === 1 ? '' : 's'}`);
  }
}

/** Archivo › Abrir como capas: varias imágenes en un mismo documento, una capa por imagen (con su nombre). */
export async function openAsLayers(files: File[]) {
  const imgs = files.filter(f => io.isImageFile(f) || io.isTiffTga(f));
  if (!imgs.length) return;
  const canv: { name: string; c: HTMLCanvasElement }[] = [];
  for (const f of imgs) {
    try {
      if (io.isTiffTga(f)) { const r = await import('../io/raster'), b = new Uint8Array(await f.arrayBuffer()); const pg = /\.tiff?$/i.test(f.name) ? (await r.decodeTiff(b))[0].img : r.decodeTga(b); const c = makeCanvas(pg.width, pg.height); ctx2d(c).putImageData(pg, 0, 0); canv.push({ name: io.baseName(f.name), c }); }
      else canv.push({ name: io.baseName(f.name), c: await io.imageToCanvas(f) });
    } catch { app.toast(`No se pudo leer ${f.name}`, 'warn'); }
  }
  if (!canv.length) return;
  let d = doc();
  if (!d) {
    const W = Math.max(...canv.map(x => x.c.width)), H = Math.max(...canv.map(x => x.c.height));
    d = new EditorDocument(canv.length > 1 ? 'Capas' : canv[0].name, W, H);
    app.addDocument(d);
  }
  for (const { name, c } of canv) {
    const l = new RasterLayer(name, d.width, d.height);
    ctx2d(l.canvas).drawImage(c, Math.round((d.width - c.width) / 2), Math.round((d.height - c.height) / 2)); l.touch();
    d.insertAboveActive(l); d.setActive(l, false);
  }
  d.invalidate(); d.commit(canv.length > 1 ? `Abrir ${canv.length} imágenes como capas` : 'Abrir como capa');
  app.toast(`${canv.length} capa${canv.length === 1 ? '' : 's'} añadida${canv.length === 1 ? '' : 's'}`);
}

/** Capa › Combinar en pila: mezcla píxel a píxel las capas seleccionadas (mediana, media, máximo o mínimo). */
export function stackLayers(mode: 'median' | 'mean' | 'max' | 'min') {
  const d = doc(); if (!d) return;
  const order = d.allLayers();
  const list = selectedLayers().filter(l => isRaster(l) && l.visible).sort((a, b) => order.indexOf(a) - order.indexOf(b)) as RasterLayer[];
  if (list.length < 2) { app.toast('Selecciona al menos dos capas de imagen (Ctrl+clic en el panel Capas)', 'warn'); return; }
  const W = d.width, H = d.height, n = list.length;
  const data = list.map(l => ctx2d(l.canvas).getImageData(0, 0, W, H).data);
  const out = new ImageData(W, H), o = out.data, vals = new Float32Array(n);
  for (let i = 0; i < W * H * 4; i += 4) {
    // solo cuentan las capas que tienen algo en ese píxel
    let m = 0; for (let k = 0; k < n; k++) if (data[k][i + 3] > 0) m++;
    if (!m) continue;
    for (let c = 0; c < 4; c++) {
      let j = 0; for (let k = 0; k < n; k++) if (data[k][i + 3] > 0) vals[j++] = data[k][i + c];
      let v: number;
      if (mode === 'mean') { let s = 0; for (let k = 0; k < m; k++) s += vals[k]; v = s / m; }
      else if (mode === 'max') { v = 0; for (let k = 0; k < m; k++) if (vals[k] > v) v = vals[k]; }
      else if (mode === 'min') { v = 255; for (let k = 0; k < m; k++) if (vals[k] < v) v = vals[k]; }
      else { for (let x = 1; x < m; x++) { const t = vals[x]; let y = x - 1; while (y >= 0 && vals[y] > t) { vals[y + 1] = vals[y]; y--; } vals[y + 1] = t; } v = m % 2 ? vals[(m - 1) / 2] : (vals[m / 2 - 1] + vals[m / 2]) / 2; }
      o[i + c] = v;
    }
  }
  const names = { median: 'Mediana', mean: 'Media', max: 'Máximo', min: 'Mínimo' };
  const l = new RasterLayer(`Pila (${names[mode].toLowerCase()})`, W, H); ctx2d(l.canvas).putImageData(out, 0, 0); l.touch();
  const top = list[n - 1]; top.parent!.add(l, top.parent!.children.indexOf(top) + 1);
  d.setActive(l, false); d.selectedIds = new Set([l.id]); d.invalidate(); d.commit(`Combinar en pila: ${names[mode]}`);
}

/** Edición › Alinear capas automáticamente: desplaza cada capa seleccionada para que encaje con la de abajo del todo. */
export function autoAlignLayers() {
  const d = doc(); if (!d) return;
  const order = d.allLayers();
  const list = selectedLayers().filter(l => isRaster(l) && !l.posLocked()).sort((a, b) => order.indexOf(a) - order.indexOf(b)) as RasterLayer[];
  if (list.length < 2) { app.toast('Selecciona al menos dos capas de imagen', 'warn'); return; }
  // escala de grises reducida (pirámide) para buscar rápido y después afinar
  const gray = (c: HTMLCanvasElement, k: number) => { const w = Math.max(8, Math.round(c.width * k)), h = Math.max(8, Math.round(c.height * k)); const t = makeCanvas(w, h), x = ctx2d(t); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, w, h); const dd = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h), a = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) { g[i] = dd[i * 4] * 0.3 + dd[i * 4 + 1] * 0.59 + dd[i * 4 + 2] * 0.11; a[i] = dd[i * 4 + 3] > 128 ? 1 : 0; } return { g, a, w, h }; };
  // diferencia media en la zona común (con bordes: más fiable que el color)
  const edges = (G: { g: Float32Array; w: number; h: number }) => { const { g, w, h } = G, e = new Float32Array(w * h); for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; e[i] = Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w]); } return e; };
  const cost = (A: Float32Array, B: Float32Array, aa: Uint8Array, ba: Uint8Array, w: number, h: number, dx: number, dy: number) => {
    let s = 0, n = 0; const st = Math.max(1, Math.floor(Math.sqrt(w * h / 20000)));
    for (let y = Math.max(0, dy); y < Math.min(h, h + dy); y += st) for (let x = Math.max(0, dx); x < Math.min(w, w + dx); x += st) { const i = y * w + x, j = (y - dy) * w + (x - dx); if (!aa[i] || !ba[j]) continue; s += Math.abs(A[i] - B[j]); n++; }
    return n > w * h / (st * st) * 0.3 ? s / n : Infinity;
  };
  const base = list[0];
  const levels = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1].filter(k => k === 1 || Math.max(d.width, d.height) * k >= 48);
  let moved = 0;
  for (const l of list.slice(1)) {
    let dx = 0, dy = 0;
    for (let li = 0; li < levels.length; li++) {
      const k = levels[li], A = gray(base.canvas, k), B = gray(l.canvas, k), EA = edges(A), EB = edges(B);
      const R = li === 0 ? Math.ceil(Math.max(A.w, A.h) * 0.12) : 2;
      let best = Infinity, bx = Math.round(dx * k), by = Math.round(dy * k);
      const cx = bx, cy = by;
      for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) { const c = cost(EA, EB, A.a, B.a, A.w, A.h, x, y); if (c < best) { best = c; bx = x; by = y; } }
      dx = bx / k; dy = by / k;
    }
    dx = Math.round(dx); dy = Math.round(dy);
    if (dx || dy) { shiftLayer(l, dx, dy); moved++; }
  }
  d.invalidate(); d.commit('Alinear capas automáticamente');
  app.toast(moved ? `${moved} capa${moved === 1 ? '' : 's'} alineada${moved === 1 ? '' : 's'}` : 'Las capas ya estaban alineadas');
}

/** Archivo › Automatizar › Recortar y enderezar fotos: cada foto del escaneo pasa a su propio documento. */
export async function cropScannedPhotos() {
  const d = doc(); if (!d) return;
  app.toast('Buscando las fotos…'); await new Promise(r => setTimeout(r, 30));
  const { findScannedPhotos } = await import('../filters/cropscan');
  const src = d.flatten(), list = findScannedPhotos(src);
  if (!list.length) { app.toast('No se han encontrado fotos separadas del fondo', 'warn'); return; }
  list.forEach((pc, i) => {
    // se recortan un poco hacia dentro para no arrastrar el borde del escáner
    const inset = Math.max(1, Math.round(Math.min(pc.w, pc.h) * 0.006)), w = Math.max(1, Math.round(pc.w - inset * 2)), hh = Math.max(1, Math.round(pc.h - inset * 2));
    const c = makeCanvas(w, hh), x = ctx2d(c); x.imageSmoothingQuality = 'high';
    x.translate(w / 2, hh / 2); x.rotate(-pc.angle); x.drawImage(src, -pc.cx, -pc.cy);
    const nd = new EditorDocument(`${d.name} ${i + 1}`, w, hh); nd.ppi = d.ppi;
    const l = new RasterLayer('Fondo', w, hh); l.canvas = c; l.touch(); nd.root.add(l); nd.setActive(l, false);
    app.addDocument(nd);
  });
  app.toast(`${list.length} foto${list.length === 1 ? '' : 's'} separada${list.length === 1 ? '' : 's'}, cada una en su pestaña`);
}

/** Capa › Combinar en pila › Fusión de exposiciones: junta fotos con distinta exposición (horquillado) en una. */
export async function fuseExposures() {
  const d = doc(); if (!d) return;
  const order = d.allLayers();
  const list = selectedLayers().filter(l => isRaster(l) && l.visible).sort((a, b) => order.indexOf(a) - order.indexOf(b)) as RasterLayer[];
  if (list.length < 2) { app.toast('Selecciona las fotos (al menos dos capas) de distinta exposición', 'warn'); return; }
  app.toast('Fusionando exposiciones…'); await new Promise(r => setTimeout(r, 30));
  const { exposureFusion } = await import('../filters/expfusion');
  const res = exposureFusion(list.map(l => ctx2d(l.canvas).getImageData(0, 0, d.width, d.height)));
  const l = new RasterLayer('Fusión de exposiciones', d.width, d.height); ctx2d(l.canvas).putImageData(res, 0, 0); l.touch();
  const top = list[list.length - 1]; top.parent!.add(l, top.parent!.children.indexOf(top) + 1);
  d.setActive(l, false); d.selectedIds = new Set([l.id]); d.invalidate(); d.commit('Fusión de exposiciones');
}

/** Selección › Luminosidad: selección suave según lo claro de la imagen (o lo oscuro, invertida). */
export function selectLuminosity(kind: 'lights' | 'darks' | 'mids') {
  const d = doc(); if (!d) return;
  const src = ctx2d(d.getComposite()).getImageData(0, 0, d.width, d.height).data;
  const m = makeCanvas(d.width, d.height), x = ctx2d(m), img = x.createImageData(d.width, d.height), o = img.data;
  for (let i = 0; i < src.length; i += 4) {
    const L = (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
    const v = kind === 'lights' ? L : kind === 'darks' ? 1 - L : 1 - Math.abs(L - 0.5) * 2;
    o[i] = o[i + 1] = o[i + 2] = 255; o[i + 3] = Math.round(v * 255 * (src[i + 3] / 255));
  }
  x.putImageData(img, 0, 0);
  d.selection.setMask(m);
  d.commit(kind === 'lights' ? 'Seleccionar luces' : kind === 'darks' ? 'Seleccionar sombras' : 'Seleccionar medios tonos');
}

/** Rellena el hueco (alfa de `holeCanvas`) reconstruyéndolo con parches del entorno; devuelve el lienzo nuevo. */
export async function inpaintCanvas(src: HTMLCanvasElement, holeCanvas: HTMLCanvasElement, box: Rect): Promise<HTMLCanvasElement | null> {
  const { inpaint: inpaintFn } = await import('../filters/inpaint');
  const W = src.width, H = src.height, m = Math.max(24, Math.round(Math.max(box.w, box.h) * 0.9));
  const x0 = Math.max(0, box.x - m), y0 = Math.max(0, box.y - m), x1 = Math.min(W, box.x + box.w + m), y1 = Math.min(H, box.y + box.h + m);
  const reg = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; if (reg.w < 8 || reg.h < 8) return null;
  const O = getPixels(src, reg), ha = getPixels(holeCanvas, reg).data, hole = new Uint8Array(reg.w * reg.h);
  for (let i = 0; i < hole.length; i++) hole[i] = ha[i * 4 + 3] > 8 ? 1 : 0;
  const R = inpaintFn(O, hole, 960);
  // borde suave: donde el hueco es parcial se mezcla con el original
  for (let i = 0; i < hole.length; i++) { const a = ha[i * 4 + 3] / 255; if (a > 0 && a < 1) for (let c = 0; c < 4; c++) R.data[i * 4 + c] = O.data[i * 4 + c] * (1 - a) + R.data[i * 4 + c] * a; }
  const out = cloneCanvas(src); putPixels(out, R, reg.x, reg.y); return out;
}

/**
 * Separación de frecuencias (retoque de piel): la capa se divide en «baja frecuencia» (color y luz, desenfocada) y
 * «alta frecuencia» (textura, en Luz lineal). Juntas se ven igual que el original; se retoca cada una por separado.
 */
export async function frequencySeparation(radius: number) {
  const d = doc(); const l = d?.active; if (!d || !l || !isRaster(l)) { app.toast('Elige una capa de imagen', 'warn'); return; }
  const { gaussianBlur } = await import('../filters/blur');
  const W = d.width, H = d.height, src = ctx2d(bakeLayer(l, d)).getImageData(0, 0, W, H);
  const low = new ImageData(new Uint8ClampedArray(src.data), W, H); gaussianBlur(low, radius);
  const high = new ImageData(W, H);
  for (let i = 0; i < src.data.length; i += 4) {
    for (let c = 0; c < 3; c++) high.data[i + c] = (src.data[i + c] - low.data[i + c]) / 2 + 128;
    high.data[i + 3] = src.data[i + 3];
  }
  const g = new GroupLayer('Separación de frecuencias');
  const lo = new RasterLayer('Baja frecuencia (color y luz)', W, H); ctx2d(lo.canvas).putImageData(low, 0, 0); lo.touch();
  const hi = new RasterLayer('Alta frecuencia (textura)', W, H); ctx2d(hi.canvas).putImageData(high, 0, 0); hi.touch(); hi.blendMode = 'linear-light';
  g.add(lo); g.add(hi);
  l.parent!.add(g, l.parent!.children.indexOf(l) + 1); l.visible = false;
  d.setActive(lo, false); d.invalidate(); d.commit('Separación de frecuencias');
  app.toast('Suaviza manchas en «Baja frecuencia» (pincel corrector, desenfoque) y la textura en «Alta frecuencia» se conserva');
}

/** Archivo › Automatizar › Panorámica: une varias fotos (en el orden de sus nombres) en un documento nuevo. */
export async function makePanorama(files: File[], vertical: boolean) {
  const imgs = files.filter(f => io.isImageFile(f)).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  if (imgs.length < 2) { app.toast('Elige al menos dos fotos', 'warn'); return; }
  app.toast('Uniendo la panorámica…'); await new Promise(r => setTimeout(r, 30));
  const canv = await Promise.all(imgs.map(f => io.imageToCanvas(f)));
  // a lo sumo 2500 px de alto por foto para que sea rápido
  const k = Math.min(1, 2500 / Math.max(...canv.map(c => vertical ? c.width : c.height)));
  const scaled = k < 1 ? canv.map(c => { const t = makeCanvas(Math.round(c.width * k), Math.round(c.height * k)); const x = ctx2d(t); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, t.width, t.height); return t; }) : canv;
  const { stitch } = await import('../filters/panorama');
  const out = stitch(scaled, vertical);
  const d = new EditorDocument('Panorámica', out.width, out.height);
  const l = new RasterLayer('Panorámica', out.width, out.height); l.canvas = out; l.touch(); d.root.add(l); d.setActive(l, false);
  app.addDocument(d);
  app.toast('Panorámica lista: recorta los bordes irregulares con Recortar (C) y «Rellenar según contenido» si quieres');
}

/** Exporta la animación de la línea de tiempo como vídeo WebM (lo admiten las redes y los navegadores). */
export async function saveVideo(name: string, loops = 1) {
  const d = doc(); if (!d) return;
  if (d.frames.length < 2) { app.toast('Crea primero los cuadros en Ventana › Línea de tiempo', 'warn'); return; }
  if (typeof MediaRecorder === 'undefined') { app.toast('Este navegador no puede grabar vídeo; usa GIF', 'warn'); return; }
  const frames = renderFrames(d);
  // tamaño par (lo piden los códecs) y como mucho 1920 px
  const k = Math.min(1, 1920 / Math.max(d.width, d.height)), W = Math.max(2, Math.round(d.width * k / 2) * 2), H = Math.max(2, Math.round(d.height * k / 2) * 2);
  const c = makeCanvas(W, H), x = ctx2d(c);
  // Safari solo graba MP4; el resto, WebM
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'].find(m => MediaRecorder.isTypeSupported(m));
  if (!mime) { app.toast('Este navegador no puede grabar vídeo; usa GIF', 'warn'); return; }
  const isMp4 = mime.startsWith('video/mp4');
  if (typeof (c as any).captureStream !== 'function') { app.toast('Este navegador no puede grabar vídeo; usa GIF', 'warn'); return; }
  const stream = (c as any).captureStream(0) as MediaStream, track = stream.getVideoTracks()[0] as any;
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = []; rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>(r => { rec.onstop = () => r(); });
  app.toast('Grabando el vídeo…');
  rec.start();
  const draw = (f: HTMLCanvasElement) => { x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(f, 0, 0, W, H); track.requestFrame?.(); };
  for (let l = 0; l < Math.max(1, loops); l++) for (const f of frames) { draw(f.canvas); await new Promise(r => setTimeout(r, Math.max(20, f.delay))); }
  draw(frames[frames.length - 1].canvas); await new Promise(r => setTimeout(r, 60));
  rec.stop(); await done;
  const blob = new Blob(chunks, { type: isMp4 ? 'video/mp4' : 'video/webm' });
  try { await io.saveBlob(blob, name + (isMp4 ? '.mp4' : '.webm')); app.toast(`Vídeo guardado (${frames.length} cuadros, ${(blob.size / 1024).toFixed(0)} KB)`); }
  catch (e: any) { if (e?.name !== 'AbortError') alertDialog('Error al guardar', String(e?.message ?? e)); }
}

/** Imagen › Recortar…: quita los bordes transparentes o del color de una esquina (por los lados elegidos). */
export function trimImage(by: 'transparent' | 'topleft' | 'bottomright', sides: { top: boolean; bottom: boolean; left: boolean; right: boolean }, tolerance = 8) {
  const d = doc(); if (!d) return;
  const W = d.width, H = d.height, px = ctx2d(d.flatten()).getImageData(0, 0, W, H).data;
  const ref = by === 'topleft' ? 0 : (W * H - 1) * 4;
  const empty = (i: number) => by === 'transparent' ? px[i + 3] <= tolerance : Math.abs(px[i] - px[ref]) <= tolerance && Math.abs(px[i + 1] - px[ref + 1]) <= tolerance && Math.abs(px[i + 2] - px[ref + 2]) <= tolerance && Math.abs(px[i + 3] - px[ref + 3]) <= tolerance;
  const rowEmpty = (y: number) => { for (let x = 0; x < W; x++) if (!empty((y * W + x) * 4)) return false; return true; };
  let top = 0, bottom = H - 1; if (sides.top) while (top < H - 1 && rowEmpty(top)) top++; if (sides.bottom) while (bottom > top && rowEmpty(bottom)) bottom--;
  const colEmpty = (x: number) => { for (let y = top; y <= bottom; y++) if (!empty((y * W + x) * 4)) return false; return true; };
  let left = 0, right = W - 1; if (sides.left) while (left < W - 1 && colEmpty(left)) left++; if (sides.right) while (right > left && colEmpty(right)) right--;
  const nw = right - left + 1, nh = bottom - top + 1;
  if (nw === W && nh === H) { app.toast('No hay bordes que recortar'); return; }
  d.resizeCanvas(nw, nh, -left, -top); d.commit('Recortar bordes'); app.viewport.fit(true);
}

/** Capa › Duplicar en…: copia la capa activa (con todo: máscara, estilos…) a otro documento abierto o a uno nuevo. */
export async function duplicateLayerTo(target: EditorDocument | 'new') {
  const d = doc(); const l = d?.active; if (!d || !l) return;
  let dst: EditorDocument;
  if (target === 'new') { dst = new EditorDocument(l.name, d.width, d.height); dst.ppi = d.ppi; app.addDocument(dst); }
  else dst = target;
  const copy: Layer = cloneLayer(l, d);
  // centrada si el otro documento tiene otro tamaño
  if (dst.width !== d.width || dst.height !== d.height) {
    const dx = Math.round((dst.width - d.width) / 2), dy = Math.round((dst.height - d.height) / 2);
    const fit = (x: Layer) => { if (x instanceof GroupLayer) { x.children.forEach(fit); return; } if (isRaster(x) && !isParametric(x)) { const c = makeCanvas(dst.width, dst.height); ctx2d(c).drawImage((x as RasterLayer).canvas, dx, dy); (x as RasterLayer).canvas = c; x.touch(); } else if (isParametric(x)) (x as any).translate?.(dx, dy); if (x.mask) { const m = makeCanvas(dst.width, dst.height), mx = ctx2d(m); mx.fillStyle = '#fff'; mx.fillRect(0, 0, dst.width, dst.height); mx.clearRect(dx, dy, d.width, d.height); mx.drawImage(x.mask.canvas, dx, dy); x.mask.canvas = m; x.mask.touch(); } };
    fit(copy);
  }
  dst.insertAboveActive(copy); dst.setActive(copy, false); dst.invalidate(); dst.commit('Duplicar capa');
  if (target !== 'new') { app.setDocument(dst); app.toast(`Capa copiada a «${dst.name}»`); }
}

/** Capa › Combinar formas: une, resta, interseca o excluye las formas seleccionadas en una sola forma vectorial. */
export async function combineShapes(mode: 'unite' | 'subtract' | 'intersect' | 'exclude') {
  const d = doc(); if (!d) return;
  const order = d.allLayers();
  const list = selectedLayers().filter(l => l instanceof ShapeLayer || l instanceof TextLayer || (l instanceof AdjustmentLayer && l.vmask) || isRaster(l)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (list.length < 2) { app.toast('Selecciona al menos dos formas o textos (Ctrl+clic en el panel Capas)', 'warn'); return; }
  const op = { unite: 1, subtract: 2, intersect: 3, exclude: 0 }[mode];
  const subpaths: { closed: boolean; pts: import('../core/layers').PathPoint[]; op?: number }[] = [];
  for (let k = 0; k < list.length; k++) {
    const l = list[k];
    let subs: { closed: boolean; pts: import('../core/layers').PathPoint[] }[];
    if (l instanceof ShapeLayer && l.props.shape === 'path' && l.props.path?.closed) subs = [JSON.parse(JSON.stringify(l.props.path))];
    else if (l instanceof AdjustmentLayer && l.vmask) subs = JSON.parse(JSON.stringify(l.vmask.subpaths));
    else subs = await layerOutlines(l);
    // dentro de una misma forma, los contornos interiores son huecos (como la «o»)
    subs.forEach((sp, i) => subpaths.push({ ...sp, closed: true, op: i === 0 ? (k === 0 ? 1 : op) : (k === 0 || op === 1 ? 0 : op) }));
  }
  if (!subpaths.length) return;
  const base = list[0];
  const color = base instanceof ShapeLayer ? (base.props.fill ?? base.props.stroke ?? app.fg) : base instanceof TextLayer ? base.props.color : base instanceof AdjustmentLayer ? (base.params.color ?? app.fg) : app.fg;
  const def = FILTERS_BY_ID.get('solidfill')!, pr = defaultParams(def); pr.color = color;
  const f = new AdjustmentLayer('Forma combinada', 'solidfill', pr);
  f.vmask = { subpaths, enabled: true };
  const top = list[list.length - 1]; top.parent!.add(f, top.parent!.children.indexOf(top) + 1);
  for (const l of list) l.parent?.remove(l);
  d.setActive(f, false); d.selectedIds = new Set([f.id]); d.invalidate();
  d.commit({ unite: 'Unir formas', subtract: 'Restar formas', intersect: 'Intersecar formas', exclude: 'Excluir formas' }[mode]);
}

// ---- Vincular capas -----------------------------------------------------------------------------
/** Vincula las capas seleccionadas (se moverán juntas) o, si ya lo están todas, las desvincula. */
export function toggleLinkLayers() {
  const d = doc(); if (!d) return;
  const sel = selectedLayers();
  const linked = sel.length > 0 && sel.every(l => l.link != null && l.link === sel[0].link);
  if (linked) { for (const l of sel) l.link = null; d.commit('Desvincular capas'); app.toast('Capas desvinculadas'); return; }
  if (sel.length < 2) { app.toast('Selecciona dos o más capas (Ctrl+clic en el panel Capas)', 'warn'); return; }
  const id = Math.max(0, ...d.allLayers().map(l => l.link ?? 0)) + 1;
  for (const l of sel) l.link = id;
  d.commit('Vincular capas'); app.toast(`${sel.length} capas vinculadas`);
}
/** Selecciona todas las capas vinculadas con la activa. */
export function selectLinkedLayers() {
  const d = doc(); const a = d?.active; if (!d || !a || a.link == null) { app.toast('La capa no está vinculada', 'warn'); return; }
  d.selectedIds = new Set(d.allLayers().filter(l => l.link === a.link).map(l => l.id)); d.changed();
}

// ---- Copiar CSS / SVG de las capas --------------------------------------------------------------
const cssName = (s: string, i: number) => (s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'capa') + (i ? '-' + i : '');
const rgba = (hex: string, a = 1) => { const n = parseInt(hex.slice(1), 16); return a >= 1 ? hex : `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${+a.toFixed(3)})`; };
/** Texto al portapapeles; si el navegador no deja, se muestra para copiarlo a mano. */
async function toClipboard(text: string, what: string) {
  try { await navigator.clipboard.writeText(text); app.toast(`${what} copiado al portapapeles`); }
  catch { const { showDialog } = await import('./dialog'); const { h } = await import('./dom'); const ta = h('textarea', { class: 'code-box', readonly: true }, text) as HTMLTextAreaElement; showDialog({ title: what, width: 560, body: [ta], okLabel: 'Cerrar', cancelLabel: null }); setTimeout(() => ta.select(), 50); }
}
/** CSS de las capas seleccionadas (formas y textos con su posición, color, borde, sombra…). */
export function layerCSS(list: Layer[]): string {
  const out: string[] = [];
  list.forEach((l, i) => {
    const r: string[] = [], b = layerBox(l);
    if (b) r.push('position: absolute;', `left: ${b.x}px;`, `top: ${b.y}px;`, `width: ${b.w}px;`, `height: ${b.h}px;`);
    if (l.opacity < 1) r.push(`opacity: ${+l.opacity.toFixed(2)};`);
    if (l.blendMode !== 'source-over' && !String(l.blendMode).includes('-light') && !String(l.blendMode).includes('linear')) r.push(`mix-blend-mode: ${l.blendMode};`);
    if (l instanceof ShapeLayer) {
      const p = l.props;
      if (p.fill) r.push(`background: ${p.fill};`);
      if (p.shape === 'ellipse') r.push('border-radius: 50%;'); else if (p.shape === 'round') r.push(`border-radius: ${Math.round(p.radius)}px;`);
      if (p.stroke) r.push(`border: ${Math.round(p.strokeWidth)}px ${p.dash === 'dash' ? 'dashed' : p.dash === 'dot' ? 'dotted' : 'solid'} ${p.stroke};`);
      if (!['rect', 'round', 'ellipse'].includes(p.shape)) r.push('/* forma compleja: mejor como SVG (Copiar SVG) */');
    } else if (l instanceof TextLayer) {
      const p = l.props;
      r.push(`font-family: ${JSON.stringify(p.font)}, sans-serif;`, `font-size: ${Math.round(p.size)}px;`, `color: ${p.color};`);
      if (p.bold) r.push('font-weight: bold;'); if (p.italic) r.push('font-style: italic;');
      if (p.tracking) r.push(`letter-spacing: ${+(p.tracking / 1000).toFixed(3)}em;`);
      r.push(`line-height: ${+p.lineHeight.toFixed(2)};`);
      if (p.align && p.align !== 'left') r.push(`text-align: ${p.align};`);
      if (p.underline) r.push('text-decoration: underline;'); if (p.caps) r.push('text-transform: uppercase;');
      if (p.vertical) r.push('writing-mode: vertical-rl;');
    }
    const st = l.styles;
    const shadows: string[] = [];
    if (st?.shadow?.enabled) { const s = st.shadow, a = (180 - s.angle) * Math.PI / 180; shadows.push(`${Math.round(Math.cos(a) * s.distance)}px ${Math.round(-Math.sin(a) * s.distance)}px ${Math.round(s.blur)}px ${rgba(s.color, s.opacity)}`); }
    if (st?.glow?.enabled) shadows.push(`0 0 ${Math.round(st.glow.size)}px ${rgba(st.glow.color, st.glow.opacity)}`);
    if (shadows.length) r.push(`${l instanceof TextLayer ? 'text-shadow' : 'box-shadow'}: ${shadows.join(', ')};`);
    if (st?.stroke?.enabled && !(l instanceof TextLayer)) r.push(`outline: ${Math.round(st.stroke.size)}px solid ${st.stroke.color};`);
    out.push(`/* ${l.name} */\n.${cssName(l.name, list.filter(x => x.name === l.name).indexOf(l))} {\n  ${r.join('\n  ')}\n}`);
  });
  return out.join('\n\n');
}
export async function copyLayerCSS() {
  const sel = selectedLayers(); if (!sel.length) { app.toast('Selecciona una o varias capas', 'warn'); return; }
  await toClipboard(layerCSS(sel), 'CSS');
}
const svgEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function svgPath(subs: { closed: boolean; pts: import('../core/layers').PathPoint[] }[]) {
  return subs.map(sp => { const P = sp.pts; if (!P.length) return ''; let d = `M${+P[0].x.toFixed(2)} ${+P[0].y.toFixed(2)}`; const n = P.length, seg = sp.closed ? n : n - 1; for (let i = 0; i < seg; i++) { const a = P[i], b = P[(i + 1) % n]; d += ` C${+a.ox.toFixed(2)} ${+a.oy.toFixed(2)} ${+b.ix.toFixed(2)} ${+b.iy.toFixed(2)} ${+b.x.toFixed(2)} ${+b.y.toFixed(2)}`; } return d + (sp.closed ? 'Z' : ''); }).join(' ');
}
/** SVG con las capas seleccionadas: formas y textos como vectores; el resto, como imagen. */
export async function layerSVG(list: Layer[]): Promise<string> {
  const d = doc()!, parts: string[] = [];
  for (const l of list) {
    if (!l.visible) continue;
    const op = l.opacity < 1 ? ` opacity="${+l.opacity.toFixed(2)}"` : '';
    if (l instanceof ShapeLayer) {
      const p = l.props, fill = p.fill ?? 'none', stroke = p.stroke ? ` stroke="${p.stroke}" stroke-width="${+p.strokeWidth.toFixed(2)}"${p.dash && p.dash !== 'solid' ? ` stroke-dasharray="${dashPattern(p.dash, p.strokeWidth).map(v => +v.toFixed(2)).join(' ')}" stroke-linecap="round"` : ''}` : '';
      const x = Math.min(p.x0, p.x1), y = Math.min(p.y0, p.y1), w = Math.abs(p.x1 - p.x0), hh = Math.abs(p.y1 - p.y0);
      if (p.shape === 'rect' || p.shape === 'round') parts.push(`<rect x="${+x.toFixed(2)}" y="${+y.toFixed(2)}" width="${+w.toFixed(2)}" height="${+hh.toFixed(2)}"${p.shape === 'round' ? ` rx="${p.radius}"` : ''} fill="${fill}"${stroke}${op}/>`);
      else if (p.shape === 'ellipse') parts.push(`<ellipse cx="${+(x + w / 2).toFixed(2)}" cy="${+(y + hh / 2).toFixed(2)}" rx="${+(w / 2).toFixed(2)}" ry="${+(hh / 2).toFixed(2)}" fill="${fill}"${stroke}${op}/>`);
      else if (p.shape === 'line') parts.push(`<line x1="${p.x0}" y1="${p.y0}" x2="${p.x1}" y2="${p.y1}" stroke="${p.stroke ?? p.fill ?? '#000'}" stroke-width="${p.strokeWidth}" stroke-linecap="round"${op}/>`);
      else if (p.shape === 'path' && p.path) parts.push(`<path d="${svgPath([p.path])}" fill="${p.path.closed ? fill : 'none'}"${stroke}${op}/>`);
      else parts.push(`<path d="${svgPath(await layerOutlines(l))}" fill="${fill}" fill-rule="evenodd"${op}/>`);
    } else if (l instanceof TextLayer && !l.props.onPath && !l.props.warp) {
      const p = l.props, lines = (p.caps ? p.text.toUpperCase() : p.text).split('\n');
      const anchor = p.align === 'center' ? 'middle' : p.align === 'right' ? 'end' : 'start';
      const tx = p.boxWidth && p.align === 'center' ? p.x + p.boxWidth / 2 : p.boxWidth && p.align === 'right' ? p.x + p.boxWidth : p.x;
      parts.push(`<text x="${+tx.toFixed(2)}" y="${+(p.y + p.size).toFixed(2)}" font-family="${svgEsc(p.font)}" font-size="${+p.size.toFixed(2)}"${p.bold ? ' font-weight="bold"' : ''}${p.italic ? ' font-style="italic"' : ''} fill="${p.color}" text-anchor="${anchor}"${p.tracking ? ` letter-spacing="${+(p.tracking / 1000 * p.size).toFixed(2)}"` : ''}${op}>${lines.map((t, i) => `<tspan x="${+tx.toFixed(2)}"${i ? ` dy="${+(p.size * p.lineHeight).toFixed(2)}"` : ''}>${svgEsc(t) || ' '}</tspan>`).join('')}</text>`);
    } else if (isRaster(l)) {
      const b = layerBox(l); if (!b) continue;
      const c = makeCanvas(b.w, b.h); ctx2d(c).drawImage((l as RasterLayer).canvas, -b.x, -b.y);
      parts.push(`<image x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" href="${c.toDataURL('image/png')}"${op}/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d.width}" height="${d.height}" viewBox="0 0 ${d.width} ${d.height}">\n  ${parts.join('\n  ')}\n</svg>`;
}
export async function copyLayerSVG() {
  const sel = selectedLayers(); if (!sel.length) { app.toast('Selecciona una o varias capas', 'warn'); return; }
  const order = doc()!.allLayers();
  await toClipboard(await layerSVG([...sel].sort((a, b) => order.indexOf(a) - order.indexOf(b))), 'SVG');
}

// ---- Selección › Foco -------------------------------------------------------------------------
/** Mapa de nitidez (0..1) de la imagen: alto donde hay detalle enfocado. */
export function focusMap(src: ImageData, smooth: number): Float32Array {
  const { width: w, height: h, data: d } = src, L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  // energía del laplaciano: lo enfocado tiene cambios bruscos entre píxeles vecinos
  const E = new ImageData(w, h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, lap = Math.abs(4 * L[i] - L[i - 1] - L[i + 1] - L[i - w] - L[i + w]);
    const v = Math.min(255, lap * 3); E.data[i * 4] = E.data[i * 4 + 1] = E.data[i * 4 + 2] = v; E.data[i * 4 + 3] = 255;
  }
  const c = makeCanvas(w, h), x = ctx2d(c); x.putImageData(E, 0, 0);
  const b = makeCanvas(w, h), bx = ctx2d(b); bx.filter = `blur(${Math.max(1, smooth)}px)`; bx.drawImage(c, 0, 0); bx.filter = 'none';
  const B = bx.getImageData(0, 0, w, h).data, out = new Float32Array(w * h);
  let mx = 1e-6; for (let i = 0; i < w * h; i++) mx = Math.max(mx, B[i * 4]);
  for (let i = 0; i < w * h; i++) out[i] = B[i * 4] / mx;
  return out;
}
/** Selecciona las zonas enfocadas. `level` 0..100: cuanto más alto, más zonas cuentan como enfocadas. */
export function selectFocusArea(level: number, softness: number, map?: Float32Array, commit = true) {
  const d = doc(); if (!d) return null;
  const smooth = Math.max(4, Math.round(Math.min(d.width, d.height) / 40));
  const M = map ?? focusMap(ctx2d(d.getComposite()).getImageData(0, 0, d.width, d.height), smooth);
  const thr = 0.6 * Math.pow(1 - level / 100, 1.6) + 0.01, soft = 0.02 + softness / 100 * 0.25;
  const m = makeCanvas(d.width, d.height), x = ctx2d(m), img = x.createImageData(d.width, d.height), o = img.data;
  for (let i = 0; i < M.length; i++) { const t = Math.max(0, Math.min(1, (M[i] - thr) / soft + 0.5)); o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = 255; o[i * 4 + 3] = t * 255; }
  x.putImageData(img, 0, 0);
  // se cierran los huecos pequeños dentro del objeto enfocado
  const c2 = makeCanvas(d.width, d.height), x2 = ctx2d(c2); x2.filter = `blur(${smooth}px)`; x2.drawImage(m, 0, 0); x2.filter = 'none';
  const q = x2.getImageData(0, 0, d.width, d.height); for (let i = 3; i < q.data.length; i += 4) q.data[i] = Math.max(0, Math.min(255, (q.data[i] - 110) * 2.2)); x2.putImageData(q, 0, 0);
  d.selection.setMask(c2);
  if (commit) d.commit('Foco');
  return M;
}

/** Archivo › Revertir: vuelve al estado del último guardado (o al de cuando se abrió). Se puede deshacer. */
export async function revertDocument() {
  const d = doc(); if (!d) return;
  const snap = d.savedSnap ?? d.history.steps[0]?.snap;
  if (!snap) return;
  if (d.history.index === 0 && !d.savedSnap) { app.toast('No hay cambios que revertir'); return; }
  if (!(await confirmDialog('Revertir', `¿Volver al estado ${d.savedSnap ? 'del último guardado' : 'en que se abrió'} «${d.name}»? Podrás deshacerlo con Ctrl+Z.`, 'Revertir'))) return;
  restore(d, snap); d.commit('Revertir'); d.modified = !d.savedSnap; app.viewport.fit(true); app.emit('docs');
}
