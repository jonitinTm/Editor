// Operaciones del editor (capas, edición, imagen, selección, archivos).
// Los menús y los atajos de teclado llaman a estas funciones.

import { app } from './app';
import { EditorDocument } from '../core/document';
import { GroupLayer, Layer, LayerMask, LayerStyles, AdjustmentLayer, SmartLayer, Matrix, RasterLayer, TextLayer, ShapeLayer, isRaster, isParametric, walkLayers } from '../core/layers';
import { cloneCanvas, ctx2d, makeCanvas, contentBounds, getPixels, putPixels, canvasToBlob, Rect } from '../core/canvas';
import { compositeGroup, composeStyled } from '../core/compositor';
import { hasStyles, canvasBlend, tracePath } from '../core/layers';
import { getPaintTarget, setTargetCanvas, setPreview, PaintTarget, rasterizeLayer, clipMask } from '../tools/paint';
import { FilterDef, defaultParams } from '../filters/registry';
import * as io from '../io/files';
import { readPsd, writePsd } from '../io/psd';
import { heal, findSource } from '../filters/heal';
import { forget } from '../io/autosave';
import { encodeGif } from '../io/gif';
import { renderFrames } from './timeline';
import { alertDialog, confirmDialog } from './dialog';

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
        const c = await io.rawPreview(f);
        const rd = new EditorDocument(io.baseName(f.name), c.width, c.height);
        const rl = new RasterLayer('Fondo', c.width, c.height); rl.canvas = c; rd.root.add(rl); rd.setActive(rl, false);
        app.addDocument(rd);
        alertDialog('Archivo RAW', `Se ha abierto la vista previa JPEG que la cámara guardó dentro del RAW (${c.width} × ${c.height} px). Editor todavía no revela los datos en bruto del sensor, así que no hay margen extra de exposición ni de balance de blancos.`);
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
  if (l instanceof GroupLayer) { const g = new GroupLayer(l.name); g.expanded = l.expanded; for (const ch of l.children) g.add(cloneLayer(ch, d)); c = g; }
  else if (l instanceof AdjustmentLayer) { c = new AdjustmentLayer(l.name, l.filterId, JSON.parse(JSON.stringify(l.params))); }
  else if (l instanceof SmartLayer) { c = new SmartLayer(l.name, d.width, d.height, l.inner, l.props.m); }
  else if (l instanceof TextLayer) { const t = new TextLayer(l.name, d.width, d.height, { ...l.props }); if (l.props.keepPixels) t.canvas = cloneCanvas(l.canvas); c = t; }
  else if (l instanceof ShapeLayer) { c = new ShapeLayer(l.name, d.width, d.height, { ...l.props }); }
  else { const r = new RasterLayer(l.name, d.width, d.height); r.canvas = cloneCanvas((l as RasterLayer).canvas); c = r; }
  c.visible = l.visible; c.opacity = l.opacity; c.blendMode = l.blendMode;
  c.styles = l.styles ? JSON.parse(JSON.stringify(l.styles)) : null; c.clip = l.clip; c.lockAlpha = l.lockAlpha;
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

/** Alinea la capa activa respecto a la selección (si hay) o al lienzo. */
export function alignLayer(mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') {
  const d = doc(); const l = d?.active; if (!d || !l) return;
  if (!isRaster(l)) { app.toast('Selecciona una capa (no un grupo ni un ajuste)', 'warn'); return; }
  if (l.isLocked()) { app.toast('La capa está bloqueada', 'warn'); return; }
  const f = l.fullContent(), cb = contentBounds(f.canvas); if (!cb) return;
  const b = { x: cb.x + f.x, y: cb.y + f.y, w: cb.w, h: cb.h }, box = d.selection.bounds ?? { x: 0, y: 0, w: d.width, h: d.height };
  let dx = 0, dy = 0;
  if (mode === 'left') dx = box.x - b.x; if (mode === 'right') dx = box.x + box.w - b.x - b.w; if (mode === 'hcenter') dx = box.x + (box.w - b.w) / 2 - b.x;
  if (mode === 'top') dy = box.y - b.y; if (mode === 'bottom') dy = box.y + box.h - b.y - b.h; if (mode === 'vcenter') dy = box.y + (box.h - b.h) / 2 - b.y;
  dx = Math.round(dx); dy = Math.round(dy);
  if (!dx && !dy) return;
  if (isParametric(l)) l.translate(dx, dy); else l.placeFull(f.canvas, f.x + dx, f.y + dy);
  if (l.mask) { const m = makeCanvas(d.width, d.height), mc = ctx2d(m); mc.fillStyle = '#fff'; mc.fillRect(0, 0, d.width, d.height); mc.clearRect(dx, dy, d.width, d.height); mc.drawImage(l.mask.canvas, dx, dy); l.mask.canvas = m; l.mask.touch(); }
  d.commit('Alinear capa');
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
  if (!d || !(l instanceof ShapeLayer) || l.props.shape !== 'path' || !l.props.path) { app.toast('Selecciona una capa de trazado (creada con la pluma)', 'warn'); return; }
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
export async function pasteFromEvent(e: ClipboardEvent) {
  const files = [...(e.clipboardData?.files ?? [])].filter(f => f.type.startsWith('image/'));
  if (clipboard && clipboardFresh && app.doc) {
    const c = clipboard;
    const d = app.doc;
    const fits = c.x + c.canvas.width <= d.width && c.y + c.canvas.height <= d.height;
    await placeImage(c.canvas, d.nextLayerName(), fits ? { x: c.x, y: c.y } : undefined);
    return;
  }
  if (files.length) {
    if (!app.doc) { app.addDocument(await io.documentFromImage(files[0], 'Pegado')); return; }
    await placeImage(files[0], app.doc.nextLayerName());
    return;
  }
  if (clipboard && app.doc) await placeImage(clipboard.canvas, app.doc.nextLayerName());
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
export class FilterSession {
  t: PaintTarget;
  region: Rect;
  private orig: ImageData;
  private sel: ImageData | null;
  private preview: HTMLCanvasElement;
  private seed = (Math.random() * 1e9) | 0;
  constructor(t: PaintTarget, public def: FilterDef) {
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
  }
  static start(def: FilterDef): FilterSession | null {
    const t = getPaintTarget(); if (!t) return null;
    return new FilterSession(t, def);
  }
  /** Imagen original de la zona (para histogramas). */
  source() { return this.orig; }
  private compute(params: any): ImageData {
    const img = new ImageData(new Uint8ClampedArray(this.orig.data), this.orig.width, this.orig.height);
    this.def.apply(img, { ...params, seed: this.seed });
    const o = this.orig.data, n = img.data;
    if (this.sel) {
      const s = this.sel.data;
      for (let i = 0; i < n.length; i += 4) {
        const k = s[i + 3] / 255;
        if (k >= 1) continue;
        for (let c = 0; c < 4; c++) n[i + c] = o[i + c] + (n[i + c] - o[i + c]) * k;
      }
    }
    if (this.t.isMask) for (let i = 0; i < n.length; i += 4) { n[i + 3] = n[i]; n[i] = n[i + 1] = n[i + 2] = 255; }
    else if (this.t.lockAlpha) for (let i = 3; i < n.length; i += 4) n[i] = o[i];
    return img;
  }
  render(params: any) {
    putPixels(this.preview, this.compute(params), this.region.x, this.region.y);
    setPreview(this.t, this.preview);
    doc()!.invalidate(this.region);
    app.viewport.requestRender();
  }
  clearPreview() {
    setPreview(this.t, null);
    doc()!.invalidate(this.region);
    app.viewport.requestRender();
  }
  commit(params: any) {
    const out = cloneCanvas(this.t.canvas);
    putPixels(out, this.compute(params), this.region.x, this.region.y);
    setPreview(this.t, null);
    setTargetCanvas(this.t, out);
    doc()!.commit(this.def.name.replace('…', ''));
  }
}

export let lastFilter: { def: FilterDef; params: any } | null = null;
export function setLastFilter(def: FilterDef, params: any) { if (def.group === 'filtro') lastFilter = { def, params }; }

export function applyFilterDirect(def: FilterDef, params: any = {}) {
  const s = FilterSession.start(def); if (!s) return;
  s.commit(params);
  setLastFilter(def, params);
}
export function repeatLastFilter() {
  if (!lastFilter) { app.toast('Aún no has aplicado ningún filtro', 'warn'); return; }
  applyFilterDirect(lastFilter.def, lastFilter.params);
}

void walkLayers;
