// Catálogo de acciones: cada una tiene nombre, atajo y qué hace.
import '../filters/matchsrc';
// Menús y teclado se construyen a partir de esta lista.

import { app } from './app';
import * as ops from './ops';
import * as dlg from './dialogs';
import * as cmpv from './compare';
import * as uniq from './unique';

import { FILTERS } from '../filters/registry';
import { quickTransform, TransformTool } from '../tools/transform';
import * as io from '../io/files';
import { promptDialog } from './dialog';
import { liquifyDialog } from './liquify';
import { recordAction } from './macros';
import { refineDialog } from './refine';
import { isParametric, hasStyles } from '../core/layers';

export interface Action {
  id: string;
  label: string;
  /** Atajos en formato "Ctrl+Shift+Z". El primero es el que se muestra. */
  keys?: string[];
  run: () => void;
  enabled?: () => boolean;
  checked?: () => boolean;
}

const hasDoc = () => !!app.doc;
const hasLayer = () => !!app.doc?.active;
const hasSel = () => !!app.doc?.selection.active;
const hasMask = () => !!app.doc?.active?.mask;

let styleClipboard: string | null = null;
export const ACTIONS: Action[] = [
  // Archivo
  { id: 'new', label: 'Nuevo…', keys: ['Alt+Ctrl+N', 'Ctrl+N'], run: dlg.newDocumentDialog },
  { id: 'open', label: 'Abrir…', keys: ['Ctrl+O'], run: async () => ops.openFiles(await io.pickFiles(io.OPEN_ACCEPT)) },
  { id: 'openLayers', label: 'Abrir como capas…', run: async () => ops.openAsLayers(await io.pickFiles('image/*,.tif,.tiff,.tga')) },
  { id: 'recent', label: 'Abrir reciente…', run: () => dlg.recentDialog() },
  { id: 'place', label: 'Colocar imagen como objeto inteligente…', keys: ['Shift+Ctrl+P'], enabled: hasDoc, run: async () => ops.openFiles(await io.pickFiles('image/*,.psd,.psb,.tif,.tiff,.tga'), true) },
  { id: 'save', label: 'Guardar proyecto (.edp)', keys: ['Ctrl+S'], enabled: hasDoc, run: () => ops.saveProject(false) },
  { id: 'saveAs', label: 'Guardar proyecto como…', keys: ['Alt+Ctrl+S'], enabled: hasDoc, run: () => ops.saveProject(true) },
  { id: 'export', label: 'Exportar como (PNG, JPG, TIFF, PSD, PDF…)…', keys: ['Shift+Ctrl+S', 'Alt+Shift+Ctrl+W'], enabled: hasDoc, run: dlg.exportDialog },
  { id: 'exportSlices', label: 'Exportar sectores…', enabled: hasDoc, run: () => dlg.exportSlicesDialog() },
  { id: 'exportLayers', label: 'Exportar capas a archivos…', enabled: hasDoc, run: dlg.exportLayersDialog },
  { id: 'batch', label: 'Automatizar › Lote…', enabled: () => true, run: dlg.batchDialog },
  { id: 'print', label: 'Imprimir…', keys: ['Ctrl+P'], enabled: hasDoc, run: ops.printImage },
  { id: 'close', label: 'Cerrar', keys: ['Alt+Ctrl+W'], enabled: hasDoc, run: () => ops.closeDocument() },

  // Edición
  { id: 'undo', label: 'Deshacer', keys: ['Ctrl+Z', 'Alt+Ctrl+Z'], enabled: () => !!app.doc?.history.canUndo(), run: ops.undo },
  { id: 'redo', label: 'Rehacer', keys: ['Shift+Ctrl+Z', 'Ctrl+Y'], enabled: () => !!app.doc?.history.canRedo(), run: ops.redo },
  { id: 'cut', label: 'Cortar', keys: ['Ctrl+X'], enabled: hasSel, run: () => ops.cut() },
  { id: 'copy', label: 'Copiar', keys: ['Ctrl+C'], enabled: hasDoc, run: () => ops.copy(false) },
  { id: 'copyMerged', label: 'Copiar combinado', keys: ['Shift+Ctrl+C'], enabled: hasDoc, run: () => ops.copy(true) },
  { id: 'pasteInPlace', label: 'Pegar en el mismo sitio', keys: ['Shift+Ctrl+V'], run: async () => { if (!await ops.pasteInternal('inPlace')) app.toast('Copia algo primero, o pulsa Mayús+Ctrl+V') } },
  { id: 'pasteInto', label: 'Pegar dentro de la selección', keys: ['Alt+Shift+Ctrl+V'], enabled: () => !!app.doc?.selection.mask, run: async () => { if (!await ops.pasteInternal('into')) app.toast('Copia algo primero') } },
  { id: 'paste', label: 'Pegar', keys: ['Ctrl+V'], run: () => app.toast('Pulsa Ctrl+V para pegar (el navegador solo permite pegar con el teclado)') },
  { id: 'clear', label: 'Borrar', keys: ['Delete', 'Backspace'], enabled: hasSel, run: () => ops.clearSelection() },
  { id: 'fade', label: 'Transición…', keys: ['Shift+Ctrl+F'], enabled: () => !!app.doc?.history.canUndo(), run: dlg.fadeDialog },
  { id: 'findReplace', label: 'Buscar y reemplazar texto…', enabled: () => !!app.doc?.allLayers().some(l => l.kind === 'text'), run: () => dlg.findReplaceDialog() },
  { id: 'importPresets', label: 'Importar pinceles o motivos (.abr, .pat)…', run: async () => { for (const f of await io.pickFiles('.abr,.pat')) await ops.importPresets(f); } },
  { id: 'defineBrush', label: 'Definir pincel…', enabled: hasDoc, run: ops.defineBrush },
  { id: 'definePattern', label: 'Definir motivo…', enabled: hasDoc, run: async () => { const n = await promptDialog('Definir motivo', 'Nombre', 'Motivo ' + new Date().toLocaleTimeString('es')); if (n !== null) ops.definePattern(n || 'Motivo'); } },
  { id: 'stroke', label: 'Contornear…', enabled: hasSel, run: dlg.strokeDialog },
  { id: 'fill', label: 'Rellenar…', keys: ['Shift+F5'], enabled: hasLayer, run: dlg.fillDialog },
  { id: 'fillFg', label: 'Rellenar con color frontal', keys: ['Alt+Backspace', 'Alt+Delete'], enabled: hasLayer, run: () => ops.fill(app.fg) },
  { id: 'fillBg', label: 'Rellenar con color de fondo', keys: ['Ctrl+Backspace', 'Ctrl+Delete'], enabled: hasLayer, run: () => ops.fill(app.bg) },
  { id: 'freeTransform', label: 'Transformación libre', keys: ['Alt+Ctrl+T', 'Ctrl+T'], enabled: hasLayer, run: () => app.setTool('transform', true) },
  { id: 'distort', label: 'Distorsionar', enabled: hasLayer, run: () => { TransformTool.startMode = 'distort'; app.setTool('transform', true); } },
  { id: 'textOnPath', label: 'Texto sobre trazado', enabled: () => app.doc?.active?.kind === 'text', run: ops.textOnPath },
  { id: 'textToShape', label: 'Convertir en forma', enabled: () => app.doc?.active?.kind === 'text' || app.doc?.active?.kind === 'raster', run: () => ops.textToShape() },
  { id: 'textToPath', label: 'Crear trazado de trabajo', enabled: () => app.doc?.active?.kind === 'text' || app.doc?.active?.kind === 'raster', run: () => ops.layerToPath() },
  { id: 'textVertical', label: 'Texto vertical', enabled: () => app.doc?.active?.kind === 'text', checked: () => !!(app.doc?.active as any)?.props?.vertical, run: ops.toggleVerticalText },
  { id: 'warpText', label: 'Deformar texto…', enabled: () => app.doc?.active?.kind === 'text', run: () => dlg.warpTextDialog(app.doc!.active as any) },
  { id: 'skew', label: 'Sesgar', enabled: hasLayer, run: () => { TransformTool.startMode = 'skew'; app.setTool('transform', true); } },
  { id: 'caScale', label: 'Escala según el contenido…', enabled: hasLayer, run: dlg.contentAwareScaleDialog },
  { id: 'puppet', label: 'Deformación de posición libre', enabled: hasLayer, run: () => app.setTool('puppet', true) },
  { id: 'warp', label: 'Deformar', enabled: hasLayer, run: () => { TransformTool.startMode = 'warp'; app.setTool('transform', true); } },
  { id: 'perspective', label: 'Perspectiva', enabled: hasLayer, run: () => { TransformTool.startMode = 'perspective'; app.setTool('transform', true); } },
  { id: 'flipH', label: 'Voltear horizontal', enabled: hasLayer, run: () => quickTransform('flipH') },
  { id: 'flipV', label: 'Voltear vertical', enabled: hasLayer, run: () => quickTransform('flipV') },
  { id: 'rot90', label: 'Rotar 90° horario', enabled: hasLayer, run: () => quickTransform('rot90') },
  { id: 'rot-90', label: 'Rotar 90° antihorario', enabled: hasLayer, run: () => quickTransform('rot-90') },
  { id: 'rot180', label: 'Rotar 180°', enabled: hasLayer, run: () => quickTransform('rot180') },

  // Imagen
  { id: 'dupDoc', label: 'Duplicar…', enabled: hasDoc, run: () => ops.duplicateDocument() },
  { id: 'imageSize', label: 'Tamaño de imagen…', keys: ['Alt+Ctrl+I'], enabled: hasDoc, run: dlg.imageSizeDialog },
  { id: 'canvasSize', label: 'Tamaño de lienzo…', keys: ['Alt+Ctrl+C'], enabled: hasDoc, run: dlg.canvasSizeDialog },
  { id: 'modeRgb', label: 'Color RGB', enabled: hasDoc, checked: () => app.doc?.mode !== 'gray', run: () => ops.setColorMode('rgb') },
  { id: 'modeGray', label: 'Escala de grises', enabled: hasDoc, checked: () => app.doc?.mode === 'gray', run: () => ops.setColorMode('gray') },
  { id: 'applyImage', label: 'Aplicar imagen…', enabled: hasLayer, run: () => dlg.applyImageDialog() },
  { id: 'imgRotArb', label: 'Rotar lienzo un ángulo…', enabled: hasDoc, run: dlg.rotateArbitraryDialog },
  { id: 'imgRot90', label: 'Rotar lienzo 90° horario', enabled: hasDoc, run: () => ops.transformImage('rot90') },
  { id: 'imgRot-90', label: 'Rotar lienzo 90° antihorario', enabled: hasDoc, run: () => ops.transformImage('rot-90') },
  { id: 'imgRot180', label: 'Rotar lienzo 180°', enabled: hasDoc, run: () => ops.transformImage('rot180') },
  { id: 'imgFlipH', label: 'Voltear lienzo horizontal', enabled: hasDoc, run: () => ops.transformImage('flipH') },
  { id: 'imgFlipV', label: 'Voltear lienzo vertical', enabled: hasDoc, run: () => ops.transformImage('flipV') },
  { id: 'cropSel', label: 'Recortar a la selección', enabled: hasSel, run: ops.cropToSelection },
  { id: 'trim', label: 'Recortar bordes…', enabled: hasDoc, run: () => dlg.trimDialog() },
  { id: 'revealAll', label: 'Revelar todo', enabled: hasDoc, run: ops.revealAll },

  // Capa
  { id: 'newLayer', label: 'Nueva capa', keys: ['Shift+Ctrl+N'], enabled: hasDoc, run: ops.newLayer },
  { id: 'newGroup', label: 'Nuevo grupo', enabled: hasDoc, run: ops.newGroup },
  { id: 'dupLayer', label: 'Duplicar capa', enabled: hasLayer, run: ops.duplicateLayer },
  { id: 'dupLayerTo', label: 'Duplicar capa en…', enabled: hasLayer, run: () => dlg.duplicateToDialog() },
  { id: 'layerViaCopy', label: 'Capa vía copiar', keys: ['Ctrl+J'], enabled: hasLayer, run: () => ops.layerVia(false) },
  { id: 'layerViaCut', label: 'Capa vía cortar', keys: ['Shift+Ctrl+J'], enabled: hasSel, run: () => ops.layerVia(true) },
  { id: 'delLayer', label: 'Eliminar capa', enabled: hasLayer, run: ops.deleteLayers },
  { id: 'renameLayer', label: 'Cambiar nombre…', enabled: hasLayer, run: async () => { const l = app.doc!.active!; const n = await promptDialog('Cambiar nombre de capa', 'Nombre', l.name); if (n !== null) ops.renameLayer(l, n); } },
  { id: 'copyCSS', label: 'Copiar CSS', enabled: hasLayer, run: ops.copyLayerCSS },
  { id: 'copySVG', label: 'Copiar SVG', enabled: hasLayer, run: ops.copyLayerSVG },
  { id: 'linkLayers', label: 'Vincular / desvincular capas', enabled: hasLayer, checked: () => app.doc?.active?.link != null, run: ops.toggleLinkLayers },
  { id: 'selectLinked', label: 'Seleccionar capas vinculadas', enabled: () => app.doc?.active?.link != null, run: ops.selectLinkedLayers },
  { id: 'group', label: 'Agrupar capas', keys: ['Ctrl+G'], enabled: hasLayer, run: ops.groupLayers },
  { id: 'ungroup', label: 'Desagrupar capas', keys: ['Shift+Ctrl+G'], enabled: () => app.doc?.active?.kind === 'group', run: ops.ungroup },
  { id: 'maskReveal', label: 'Mostrar todo', enabled: () => hasLayer() && !hasMask(), run: () => ops.addMask('reveal') },
  { id: 'maskHide', label: 'Ocultar todo', enabled: () => hasLayer() && !hasMask(), run: () => ops.addMask('hide') },
  { id: 'maskSel', label: 'Desde la selección', enabled: () => hasLayer() && !hasMask() && hasSel(), run: () => ops.addMask('selection') },
  { id: 'maskToggle', label: 'Desactivar / activar máscara', enabled: hasMask, run: ops.toggleMask },
  { id: 'maskInvert', label: 'Invertir máscara', enabled: hasMask, run: () => ops.invertMask(app.doc!.active!) },
  { id: 'maskApply', label: 'Aplicar máscara', enabled: hasMask, run: () => ops.deleteMask(true) },
  { id: 'maskDelete', label: 'Eliminar máscara', enabled: hasMask, run: () => ops.deleteMask(false) },
  { id: 'vmPath', label: 'Trazado actual', enabled: () => (app.doc?.activePath ?? -1) >= 0, run: ops.vectorMaskFromPath },
  { id: 'vmToggle', label: 'Desactivar / activar', enabled: () => !!app.doc?.active?.vmask, run: () => ops.vectorMaskOp('toggle') },
  { id: 'vmInvert', label: 'Invertir', enabled: () => !!app.doc?.active?.vmask, run: () => ops.vectorMaskOp('invert') },
  { id: 'vmRaster', label: 'Rasterizar (pasar a máscara de píxeles)', enabled: () => !!app.doc?.active?.vmask, run: () => ops.vectorMaskOp('rasterize') },
  { id: 'vmDelete', label: 'Eliminar', enabled: () => !!app.doc?.active?.vmask, run: () => ops.vectorMaskOp('delete') },
  { id: 'clip', label: 'Crear / soltar máscara de recorte', keys: ['Alt+Ctrl+G'], enabled: hasLayer, checked: () => !!app.doc?.active?.clip, run: ops.toggleClip },
  { id: 'label:rojo', label: 'Etiqueta: rojo', enabled: hasLayer, run: () => ops.setLayerLabel('rojo') },
  { id: 'label:naranja', label: 'Etiqueta: naranja', enabled: hasLayer, run: () => ops.setLayerLabel('naranja') },
  { id: 'label:amarillo', label: 'Etiqueta: amarillo', enabled: hasLayer, run: () => ops.setLayerLabel('amarillo') },
  { id: 'label:verde', label: 'Etiqueta: verde', enabled: hasLayer, run: () => ops.setLayerLabel('verde') },
  { id: 'label:azul', label: 'Etiqueta: azul', enabled: hasLayer, run: () => ops.setLayerLabel('azul') },
  { id: 'label:violeta', label: 'Etiqueta: violeta', enabled: hasLayer, run: () => ops.setLayerLabel('violeta') },
  { id: 'label:gris', label: 'Etiqueta: gris', enabled: hasLayer, run: () => ops.setLayerLabel('gris') },
  { id: 'label:none', label: 'Sin etiqueta', enabled: hasLayer, run: () => ops.setLayerLabel(null) },
  { id: 'snapshot', label: 'Nueva instantánea', enabled: hasDoc, run: ops.newSnapshot },
  { id: 'layerStyle', label: 'Estilo de capa (sombra, trazo, resplandor)…', enabled: hasLayer, run: dlg.layerStyleDialog },
  { id: 'copyStyle', label: 'Copiar estilo de capa', enabled: () => hasStyles(app.doc?.active?.styles), run: () => { styleClipboard = JSON.stringify(app.doc!.active!.styles); app.toast('Estilo copiado'); } },
  { id: 'pasteStyle', label: 'Pegar estilo de capa', enabled: () => !!styleClipboard && !!app.doc?.active, run: () => { const d = app.doc!; const sel = d.allLayers().filter(l => d.selectedIds.has(l.id) || l === d.active); for (const l of sel) if (l.kind !== 'group' && l.kind !== 'adjust') l.styles = JSON.parse(styleClipboard!); d.invalidate(); d.commit('Pegar estilo de capa'); } },
  { id: 'rasterizeStyle', label: 'Rasterizar estilo de capa', enabled: () => hasStyles(app.doc?.active?.styles), run: () => ops.rasterizeStyle() },
  { id: 'clearStyle', label: 'Quitar estilo de capa', enabled: () => !!app.doc?.active?.styles, run: () => ops.setLayerStyles(app.doc!.active!, null, true) },
  { id: 'align:left', label: 'Bordes izquierdos', enabled: hasLayer, run: () => ops.alignLayer('left') },
  { id: 'align:hcenter', label: 'Centros horizontales', enabled: hasLayer, run: () => ops.alignLayer('hcenter') },
  { id: 'align:right', label: 'Bordes derechos', enabled: hasLayer, run: () => ops.alignLayer('right') },
  { id: 'align:top', label: 'Bordes superiores', enabled: hasLayer, run: () => ops.alignLayer('top') },
  { id: 'align:vcenter', label: 'Centros verticales', enabled: hasLayer, run: () => ops.alignLayer('vcenter') },
  { id: 'align:bottom', label: 'Bordes inferiores', enabled: hasLayer, run: () => ops.alignLayer('bottom') },
  { id: 'dist:left', label: 'Bordes izquierdos', enabled: hasLayer, run: () => ops.distributeLayers('left') },
  { id: 'dist:hcenter', label: 'Centros horizontales', enabled: hasLayer, run: () => ops.distributeLayers('hcenter') },
  { id: 'dist:right', label: 'Bordes derechos', enabled: hasLayer, run: () => ops.distributeLayers('right') },
  { id: 'dist:top', label: 'Bordes superiores', enabled: hasLayer, run: () => ops.distributeLayers('top') },
  { id: 'dist:vcenter', label: 'Centros verticales', enabled: hasLayer, run: () => ops.distributeLayers('vcenter') },
  { id: 'dist:bottom', label: 'Bordes inferiores', enabled: hasLayer, run: () => ops.distributeLayers('bottom') },
  { id: 'dist:hspace', label: 'Espacio horizontal', enabled: hasLayer, run: () => ops.distributeLayers('hspace') },
  { id: 'dist:vspace', label: 'Espacio vertical', enabled: hasLayer, run: () => ops.distributeLayers('vspace') },
  { id: 'bringFront', label: 'Traer al frente', keys: ['Shift+Ctrl+]'], enabled: hasLayer, run: () => ops.arrangeLayer('top') },
  { id: 'bringForward', label: 'Hacia delante', keys: ['Ctrl+]'], enabled: hasLayer, run: () => ops.arrangeLayer('up') },
  { id: 'sendBackward', label: 'Hacia atrás', keys: ['Ctrl+['], enabled: hasLayer, run: () => ops.arrangeLayer('down') },
  { id: 'sendBack', label: 'Enviar al fondo', keys: ['Shift+Ctrl+['], enabled: hasLayer, run: () => ops.arrangeLayer('bottom') },
  { id: 'artboard', label: 'Nueva mesa de trabajo…', enabled: hasDoc, run: dlg.artboardDialog },
  { id: 'fill:solid', label: 'Color sólido…', enabled: hasDoc, run: () => ops.newFillLayer('solidfill') },
  { id: 'fill:gradient', label: 'Degradado…', enabled: hasDoc, run: () => ops.newFillLayer('gradfill') },
  { id: 'fill:pattern', label: 'Motivo…', enabled: hasDoc, run: () => ops.newFillLayer('patternfill') },
  { id: 'smartCopy', label: 'Nuevo objeto inteligente mediante copia', enabled: () => app.doc?.active?.kind === 'smart', run: ops.smartCopyIndependent },
  { id: 'exportSmart', label: 'Exportar contenido…', enabled: () => app.doc?.active?.kind === 'smart', run: ops.exportSmartContents },
  { id: 'replaceSmart', label: 'Reemplazar contenido…', enabled: () => app.doc?.active?.kind === 'smart', run: async () => { const fs = await io.pickFiles('image/*,.psd', false); if (fs[0]) ops.replaceSmartContents(fs[0]); } },
  { id: 'prefs', label: 'Preferencias…', keys: ['Ctrl+K'], run: dlg.prefsDialog },
  { id: 'keysEdit', label: 'Atajos de teclado…', keys: ['Alt+Shift+Ctrl+K'], run: () => dlg.keysDialog() },
  { id: 'toSmart', label: 'Convertir en objeto inteligente', enabled: hasLayer, run: ops.convertToSmart },
  { id: 'editSmart', label: 'Editar contenido', enabled: () => app.doc?.active?.kind === 'smart', run: () => ops.editSmartContents() },
  { id: 'rasterize', label: 'Rasterizar capa (texto, forma u objeto inteligente)', enabled: () => isParametric(app.doc?.active), run: ops.rasterize },
  { id: 'panorama', label: 'Panorámica…', run: async () => { const fs = await io.pickFiles('image/*'); if (fs.length) ops.makePanorama(fs, false); } },
  { id: 'cropScans', label: 'Recortar y enderezar fotos escaneadas', enabled: hasDoc, run: () => ops.cropScannedPhotos() },
  { id: 'freqSep', label: 'Separación de frecuencias…', enabled: hasLayer, run: async () => { const v = await promptDialog('Separación de frecuencias', 'Radio del desenfoque (px): más grande = separa detalles más gruesos', '6'); const r = parseFloat(v ?? ''); if (r > 0) ops.frequencySeparation(Math.min(200, r)); } },
  { id: 'autoAlign', label: 'Alinear capas automáticamente', enabled: hasDoc, run: () => ops.autoAlignLayers() },
  { id: 'shape:unite', label: 'Unir', enabled: hasDoc, run: () => ops.combineShapes('unite') },
  { id: 'shape:subtract', label: 'Restar la de encima', enabled: hasDoc, run: () => ops.combineShapes('subtract') },
  { id: 'shape:intersect', label: 'Intersecar (lo común)', enabled: hasDoc, run: () => ops.combineShapes('intersect') },
  { id: 'shape:exclude', label: 'Excluir (lo que no se solapa)', enabled: hasDoc, run: () => ops.combineShapes('exclude') },
  { id: 'stack:median', label: 'Mediana (quita lo que se mueve)', enabled: hasDoc, run: () => ops.stackLayers('median') },
  { id: 'stack:mean', label: 'Media (reduce el ruido)', enabled: hasDoc, run: () => ops.stackLayers('mean') },
  { id: 'stack:max', label: 'Máximo (estelas de luz)', enabled: hasDoc, run: () => ops.stackLayers('max') },
  { id: 'stack:hdr', label: 'Fusión de exposiciones (HDR)', enabled: hasDoc, run: () => ops.fuseExposures() },
  { id: 'stack:min', label: 'Mínimo', enabled: hasDoc, run: () => ops.stackLayers('min') },
  { id: 'mergeDown', label: 'Combinar hacia abajo (o las seleccionadas)', keys: ['Ctrl+E'], enabled: hasLayer, run: ops.mergeDown },
  { id: 'mergeVisible', label: 'Combinar visibles', keys: ['Shift+Ctrl+E'], enabled: hasDoc, run: ops.mergeVisible },
  { id: 'stamp', label: 'Estampar visibles en una capa nueva', keys: ['Alt+Shift+Ctrl+E'], enabled: hasDoc, run: () => { const d = app.doc!; d.setActive(d.root.children[d.root.children.length - 1] ?? null, false); ops.placeImage(d.flatten(), 'Estampado', { x: 0, y: 0 }); } },
  { id: 'flatten', label: 'Acoplar imagen', enabled: hasDoc, run: ops.flattenImage },

  // Selección
  { id: 'selectAll', label: 'Todo', keys: ['Ctrl+A'], enabled: hasDoc, run: ops.selectAll },
  { id: 'deselect', label: 'Deseleccionar', keys: ['Ctrl+D'], enabled: hasSel, run: ops.deselect },
  { id: 'invertSel', label: 'Invertir', keys: ['Shift+Ctrl+I'], enabled: hasDoc, run: ops.invertSelection },
  { id: 'selFromLayer', label: 'Cargar selección desde la capa', enabled: hasLayer, run: () => ops.selectionFromLayer(app.doc!.active!) },
  { id: 'pathToSel', label: 'Trazado a selección', keys: ['Ctrl+Enter'], enabled: () => app.doc?.active?.kind === 'shape' || (app.doc?.activePath ?? -1) >= 0, run: ops.pathToSelection },
  { id: 'transformSel', label: 'Transformar selección', enabled: hasSel, run: () => { TransformTool.selectionOnly = true; app.setTool('transform', true); } },
  { id: 'selToPath', label: 'Selección a trazado', enabled: hasSel, run: ops.selectionToPath },
  { id: 'saveSel', label: 'Guardar selección…', enabled: hasSel, run: async () => { const n = await promptDialog('Guardar selección', 'Nombre del canal', `Alfa ${(app.doc!.channels.length + 1)}`); if (n !== null) ops.saveSelectionAsChannel(n); } },
  { id: 'loadSel', label: 'Cargar selección…', enabled: () => !!app.doc?.channels.length, run: dlg.loadSelectionDialog },
  { id: 'quickMask', label: 'Editar en modo máscara rápida', keys: ['Q'], enabled: hasDoc, checked: () => !!app.doc?.quickMask, run: ops.toggleQuickMask },
  { id: 'contentFill', label: 'Rellenar según contenido', keys: ['Shift+Backspace', 'Shift+Delete'], enabled: hasSel, run: () => ops.contentAwareFill() },
  { id: 'refine', label: 'Seleccionar y aplicar máscara…', keys: ['Alt+Ctrl+R'], enabled: hasSel, run: refineDialog },
  { id: 'removeBg', label: 'Quitar fondo', enabled: hasLayer, run: () => ops.removeBackground() },
  { id: 'lum:lights', label: 'Luces', keys: ['Alt+Ctrl+2'], enabled: hasDoc, run: () => ops.selectLuminosity('lights') },
  { id: 'lum:darks', label: 'Sombras', enabled: hasDoc, run: () => ops.selectLuminosity('darks') },
  { id: 'lum:mids', label: 'Medios tonos', enabled: hasDoc, run: () => ops.selectLuminosity('mids') },
  { id: 'selectSky', label: 'Cielo', enabled: hasDoc, run: ops.selectSkyOp },
  { id: 'skyReplace', label: 'Sustituir cielo…', enabled: hasDoc, run: () => dlg.skyReplaceDialog() },
  { id: 'focusArea', label: 'Área de enfoque…', enabled: hasDoc, run: () => dlg.focusAreaDialog() },
  { id: 'selectSubject', label: 'Sujeto', enabled: hasDoc, run: ops.selectSubjectOp },
  { id: 'colorRange', label: 'Gama de colores…', enabled: hasDoc, run: dlg.colorRangeDialog },
  { id: 'border', label: 'Borde…', enabled: () => !!app.doc?.selection.active, run: () => dlg.modifySelectionDialog('border') },
  { id: 'smoothSel', label: 'Suavizar…', enabled: () => !!app.doc?.selection.active, run: () => dlg.modifySelectionDialog('smooth') },
  { id: 'growSel', label: 'Extender', enabled: () => !!app.doc?.selection.active, run: () => ops.growSimilar(true) },
  { id: 'similarSel', label: 'Similar', enabled: () => !!app.doc?.selection.active, run: () => ops.growSimilar(false) },
  { id: 'feather', label: 'Calar…', keys: ['Shift+F6'], enabled: hasSel, run: () => dlg.modifySelectionDialog('feather') },
  { id: 'expand', label: 'Expandir…', enabled: hasSel, run: () => dlg.modifySelectionDialog('expand') },
  { id: 'contract', label: 'Contraer…', enabled: hasSel, run: () => dlg.modifySelectionDialog('contract') },

  // Filtro
  { id: 'liquify', label: 'Licuar…', keys: ['Shift+Ctrl+X'], enabled: hasLayer, run: liquifyDialog },
  { id: 'variations', label: 'Variaciones…', enabled: hasLayer, run: () => dlg.variationsDialog() },
  { id: 'compare', label: 'Comparar antes / después', keys: ['Shift+Ctrl+Y'], enabled: hasDoc, checked: () => cmpv.compareActive(), run: cmpv.toggleCompare },
  { id: 'comparePrev', label: 'Comparar con el paso anterior', enabled: hasDoc, run: () => cmpv.startCompare('prev') },
  ...cmpv.SIM_NAMES.map(([s, n]) => ({ id: 'sim:' + s, label: n, enabled: hasDoc, checked: () => cmpv.getSim() === s, run: () => cmpv.setSim(s) })),
  { id: 'contrast', label: 'Comprobar contraste de textos…', enabled: hasDoc, run: uniq.contrastDialog },
  { id: 'autoStraighten', label: 'Enderezar automáticamente', enabled: hasDoc, run: uniq.autoStraighten },
  { id: 'social', label: 'Exportar para redes sociales…', enabled: hasDoc, run: uniq.socialDialog },
  { id: 'timelapse', label: 'Timelapse de la edición…', enabled: () => (app.doc?.history.index ?? 0) > 0, run: uniq.timelapseDialog },
  { id: 'palette', label: 'Paleta de la imagen…', enabled: hasDoc, run: uniq.paletteDialog },
  { id: 'filterGallery', label: 'Galería de filtros…', enabled: hasLayer, run: () => dlg.filterGalleryDialog() },
  { id: 'lastFilter', label: 'Repetir último filtro', keys: ['Alt+Ctrl+F'], enabled: () => !!ops.lastFilter && hasLayer(), run: ops.repeatLastFilter },

  // Vista
  { id: 'zoomIn', label: 'Acercar', keys: ['Ctrl+=', 'Ctrl++', 'Ctrl+NumpadAdd'], enabled: hasDoc, run: () => app.viewport.zoomStep(1) },
  { id: 'zoomOut', label: 'Alejar', keys: ['Ctrl+-', 'Ctrl+NumpadSubtract'], enabled: hasDoc, run: () => app.viewport.zoomStep(-1) },
  { id: 'fit', label: 'Ajustar a la pantalla', keys: ['Ctrl+0'], enabled: hasDoc, run: () => app.viewport.fit() },
  { id: 'actual', label: 'Píxeles reales (100 %)', keys: ['Ctrl+1'], enabled: hasDoc, run: () => app.viewport.setZoom(1, null) },
  { id: 'resetRot', label: 'Restablecer giro de la vista', enabled: () => !!app.doc?.view.rot, run: () => app.viewport.setRotation(0) },
  { id: 'rulers', label: 'Reglas', keys: ['Ctrl+R'], checked: () => app.showRulers, run: () => app.viewport.setRulers(!app.showRulers) },
  { id: 'guides', label: 'Mostrar guías', keys: ['Ctrl+;'], checked: () => app.showGuides, run: () => { app.showGuides = !app.showGuides; app.viewport.requestRender(); } },
  { id: 'snap', label: 'Ajustar (magnético)', keys: ['Shift+Ctrl+;'], checked: () => app.snapOn, run: () => { app.snapOn = !app.snapOn; app.toast(app.snapOn ? 'Ajuste magnético activado' : 'Ajuste magnético desactivado'); } },
  { id: 'extras', label: 'Extras (selección, guías, cuadrícula)', keys: ['Ctrl+H'], checked: () => !app.hideExtras, run: () => { app.hideExtras = !app.hideExtras; app.viewport.requestRender(); if (app.hideExtras) app.toast('Extras ocultos (Ctrl+H para volver a verlos)'); } },
  { id: 'grid', label: 'Cuadrícula', keys: ["Ctrl+'"], checked: () => app.showGrid, run: () => { app.showGrid = !app.showGrid; app.viewport.requestRender(); } },
  { id: 'guideLayout', label: 'Nueva disposición de guías…', enabled: hasDoc, run: () => dlg.guideLayoutDialog() },
  { id: 'newGuide', label: 'Nueva guía…', enabled: hasDoc, run: newGuideDialog },
  { id: 'clearGuides', label: 'Borrar guías', enabled: () => !!app.doc && (app.doc.guides.h.length + app.doc.guides.v.length > 0), run: () => { app.doc!.guides = { h: [], v: [] }; app.viewport.requestRender(); } },

  // Ventana
  ...([['color', 'Color y Muestras'], ['props', 'Propiedades e Historial'], ['layers', 'Capas']] as const).map(([g, label]): Action => ({
    id: 'win:' + g, label, checked: () => !(document.querySelector(`[data-group=${g}]`) as HTMLElement)?.classList.contains('closed'),
    run: () => { document.querySelector(`[data-group=${g}]`)?.classList.toggle('closed'); },
  })),
  { id: 'panel:Capas', label: 'Capas', run: () => showPanel('Capas') },
  { id: 'panel:Canales', label: 'Canales', run: () => showPanel('Canales') },
  { id: 'panel:Carácter', label: 'Carácter', run: () => showPanel('Carácter') },
  { id: 'panel:Párrafo', label: 'Párrafo', run: () => showPanel('Párrafo') },
  { id: 'panel:Estilos', label: 'Estilos', run: () => showPanel('Estilos') },
  { id: 'panel:Composiciones', label: 'Composiciones de capas', run: () => showPanel('Composiciones') },
  { id: 'panel:Trazados', label: 'Trazados', run: () => showPanel('Trazados') },
  { id: 'panel:Acciones', label: 'Acciones', run: () => showPanel('Acciones') },
  { id: 'panel:Propiedades', label: 'Propiedades', run: () => showPanel('Propiedades') },
  { id: 'panel:Historial', label: 'Historial', run: () => showPanel('Historial') },
  { id: 'panel:Navegador', label: 'Navegador', run: () => showPanel('Navegador') },
  { id: 'panel:Histograma', label: 'Histograma', run: () => showPanel('Histograma') },
  { id: 'panel:Info', label: 'Info', run: () => showPanel('Info') },
  { id: 'panel:Color', label: 'Color', run: () => showPanel('Color') },
  { id: 'panel:Muestras', label: 'Muestras', run: () => showPanel('Muestras') },
  { id: 'panel:Pinceles', label: 'Pinceles', run: () => showPanel('Pinceles') },
  { id: 'win:timeline', label: 'Línea de tiempo (animación)', checked: () => !document.querySelector('.timeline')?.classList.contains('closed'), run: () => { document.querySelector('.timeline')?.classList.toggle('closed'); app.doc?.changed(); requestAnimationFrame(() => app.viewport.resize()); } },
  { id: 'win:tools', label: 'Herramientas', checked: () => !document.body.classList.contains('no-tools'), run: () => { document.body.classList.toggle('no-tools'); requestAnimationFrame(() => app.viewport.resize()); } },
  { id: 'win:options', label: 'Opciones', checked: () => !document.body.classList.contains('no-options'), run: () => { document.body.classList.toggle('no-options'); requestAnimationFrame(() => app.viewport.resize()); } },
  { id: 'win:all', label: 'Ocultar / mostrar todos los paneles', keys: ['Tab'], run: () => { document.body.classList.toggle('hide-panels'); requestAnimationFrame(() => app.viewport.resize()); } },

  // Ayuda
  { id: 'guide', label: 'Guía rápida', keys: ['F1'], run: dlg.quickGuideDialog },
  { id: 'shortcuts', label: 'Lista de atajos de teclado', run: () => dlg.shortcutsDialog(shortcutList()) },
  { id: 'about', label: 'Acerca de Editor', run: dlg.aboutDialog },
];

// Ajustes y filtros desde el registro
for (const f of FILTERS) {
  ACTIONS.push({ id: 'filter:' + f.id, label: f.name, keys: f.shortcut ? [f.shortcut] : undefined, enabled: hasLayer, run: () => { f.prepare?.(); dlg.filterDialog(f); } });
}

for (const f of FILTERS) if (f.group === 'ajuste' && !f.noLayer) {
  ACTIONS.push({ id: 'adjust:' + f.id, label: f.name.replace('…', ''), enabled: hasDoc, run: () => ops.newAdjustmentLayer(f) });
}

// Las acciones que se pueden repetir quedan grabadas si hay una grabación en curso
for (const a of ACTIONS) { const run = a.run; a.run = () => { recordAction(a.id, a.label.replace('…', '')); return run(); }; }

export const actionById = new Map(ACTIONS.map(a => [a.id, a]));

async function newGuideDialog() {
  const v = await promptDialog('Nueva guía', 'Posición (px). Usa «v 100» para vertical u «h 100» para horizontal', 'v 100');
  if (!v || !app.doc) return;
  const m = v.trim().match(/^([vh])\s*(-?\d+(?:\.\d+)?)$/i);
  if (!m) { app.toast('Formato no válido. Ejemplo: v 100', 'warn'); return; }
  (m[1].toLowerCase() === 'v' ? app.doc.guides.v : app.doc.guides.h).push(+m[2]);
  app.viewport.requestRender();
}

export function shortcutList(): [string, string][] {
  const out: [string, string][] = [];
  for (const t of app.tools.values()) if (t.key) out.push([t.key, 'Herramienta: ' + t.name]);
  out.push(['Mayús + letra', 'Alternar herramientas del mismo grupo'], ['Espacio (mantener)', 'Desplazar con la mano'],
    ['[ y ]', 'Reducir / aumentar tamaño del pincel'], ['D', 'Colores por defecto'], ['X', 'Intercambiar colores'], ['1 … 9, 0', 'Opacidad 10 % … 90 %, 100 % (herramienta o capa)'], ['F', 'Pantalla completa'],
    ['Alt + rueda', 'Zoom'], ['Flechas', 'Mover la capa 1 px (Mayús: 10 px)'], ['Intro / Esc', 'Aplicar / cancelar (recorte, transformación, texto)']);
  for (const a of ACTIONS) if (a.keys) out.push([a.keys[0], a.label.replace('…', '')]);
  return out;
}

/** Muestra un panel: abre su grupo si estaba cerrado y activa su pestaña. */
function showPanel(name: string) {
  document.body.classList.remove('hide-panels');
  const tab = [...document.querySelectorAll('.tg-tab')].find(t => t.textContent === name) as HTMLElement | undefined;
  if (!tab) return;
  tab.closest('.tab-group')?.classList.remove('closed');
  tab.click();
  requestAnimationFrame(() => app.viewport.resize());
}

// ---- Atajos personalizados ----------------------------------------------------------------
const KEYS_STORE = 'editor.keys';
const factoryKeys = new Map(ACTIONS.map(a => [a.id, a.keys ? [...a.keys] : undefined]));
/** Atajos cambiados por el usuario (id de la acción → combinaciones). */
export function customKeys(): Record<string, string[]> { try { return JSON.parse(localStorage.getItem(KEYS_STORE) || '{}'); } catch { return {}; } }
export function applyCustomKeys() {
  const c = customKeys();
  for (const a of ACTIONS) { const k = c[a.id] ?? factoryKeys.get(a.id); a.keys = k && k.length ? [...k] : undefined; }
  window.dispatchEvent(new Event('editor-keys'));
}
/** Asigna una combinación a una acción (se la quita a la que la tuviera). Devuelve el nombre de esa otra acción. */
export function setActionKey(id: string, combo: string | null): string | null {
  const c = customKeys(); let taken: string | null = null;
  if (combo) for (const a of ACTIONS) if (a.id !== id && (a.keys ?? []).includes(combo)) { c[a.id] = (a.keys ?? []).filter(k => k !== combo); taken = a.label.replace('…', ''); }
  c[id] = combo ? [combo] : [];
  try { localStorage.setItem(KEYS_STORE, JSON.stringify(c)); } catch { /* */ }
  applyCustomKeys(); return taken;
}
export function resetKeys() { try { localStorage.removeItem(KEYS_STORE); } catch { /* */ } applyCustomKeys(); }
applyCustomKeys();
