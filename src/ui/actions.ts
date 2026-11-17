// Catálogo de acciones: cada una tiene nombre, atajo y qué hace.
// Menús y teclado se construyen a partir de esta lista.

import { app } from './app';
import * as ops from './ops';
import * as dlg from './dialogs';
import { FILTERS } from '../filters/registry';
import { quickTransform, TransformTool } from '../tools/transform';
import * as io from '../io/files';
import { promptDialog } from './dialog';
import { liquifyDialog } from './liquify';
import { isParametric } from '../core/layers';

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

export const ACTIONS: Action[] = [
  // Archivo
  { id: 'new', label: 'Nuevo…', keys: ['Alt+Ctrl+N', 'Ctrl+N'], run: dlg.newDocumentDialog },
  { id: 'open', label: 'Abrir…', keys: ['Ctrl+O'], run: async () => ops.openFiles(await io.pickFiles('image/*,.psd,.psb,.cr2,.cr3,.nef,.arw,.dng,.orf,.rw2,.raf,.pef,' + io.PROJECT_EXT)) },
  { id: 'place', label: 'Colocar imagen como objeto inteligente…', keys: ['Shift+Ctrl+P'], enabled: hasDoc, run: async () => ops.openFiles(await io.pickFiles('image/*'), true) },
  { id: 'save', label: 'Guardar proyecto (.edp)', keys: ['Ctrl+S'], enabled: hasDoc, run: () => ops.saveProject(false) },
  { id: 'saveAs', label: 'Guardar proyecto como…', keys: ['Alt+Ctrl+S'], enabled: hasDoc, run: () => ops.saveProject(true) },
  { id: 'export', label: 'Exportar como (PNG, JPG, WebP, PSD)…', keys: ['Shift+Ctrl+S', 'Alt+Shift+Ctrl+W'], enabled: hasDoc, run: dlg.exportDialog },
  { id: 'exportLayers', label: 'Exportar capas a archivos…', enabled: hasDoc, run: dlg.exportLayersDialog },
  { id: 'close', label: 'Cerrar', keys: ['Alt+Ctrl+W'], enabled: hasDoc, run: () => ops.closeDocument() },

  // Edición
  { id: 'undo', label: 'Deshacer', keys: ['Ctrl+Z', 'Alt+Ctrl+Z'], enabled: () => !!app.doc?.history.canUndo(), run: ops.undo },
  { id: 'redo', label: 'Rehacer', keys: ['Shift+Ctrl+Z', 'Ctrl+Y'], enabled: () => !!app.doc?.history.canRedo(), run: ops.redo },
  { id: 'cut', label: 'Cortar', keys: ['Ctrl+X'], enabled: hasSel, run: () => ops.cut() },
  { id: 'copy', label: 'Copiar', keys: ['Ctrl+C'], enabled: hasDoc, run: () => ops.copy(false) },
  { id: 'copyMerged', label: 'Copiar combinado', keys: ['Shift+Ctrl+C'], enabled: hasDoc, run: () => ops.copy(true) },
  { id: 'paste', label: 'Pegar', keys: ['Ctrl+V'], run: () => app.toast('Pulsa Ctrl+V para pegar (el navegador solo permite pegar con el teclado)') },
  { id: 'clear', label: 'Borrar', keys: ['Delete', 'Backspace'], enabled: hasSel, run: () => ops.clearSelection() },
  { id: 'stroke', label: 'Contornear…', enabled: hasSel, run: dlg.strokeDialog },
  { id: 'fill', label: 'Rellenar…', keys: ['Shift+F5'], enabled: hasLayer, run: dlg.fillDialog },
  { id: 'fillFg', label: 'Rellenar con color frontal', keys: ['Alt+Backspace', 'Alt+Delete'], enabled: hasLayer, run: () => ops.fill(app.fg) },
  { id: 'fillBg', label: 'Rellenar con color de fondo', keys: ['Ctrl+Backspace', 'Ctrl+Delete'], enabled: hasLayer, run: () => ops.fill(app.bg) },
  { id: 'freeTransform', label: 'Transformación libre', keys: ['Alt+Ctrl+T', 'Ctrl+T'], enabled: hasLayer, run: () => app.setTool('transform', true) },
  { id: 'distort', label: 'Distorsionar', enabled: hasLayer, run: () => { TransformTool.startMode = 'distort'; app.setTool('transform', true); } },
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
  { id: 'imgRot90', label: 'Rotar lienzo 90° horario', enabled: hasDoc, run: () => ops.transformImage('rot90') },
  { id: 'imgRot-90', label: 'Rotar lienzo 90° antihorario', enabled: hasDoc, run: () => ops.transformImage('rot-90') },
  { id: 'imgRot180', label: 'Rotar lienzo 180°', enabled: hasDoc, run: () => ops.transformImage('rot180') },
  { id: 'imgFlipH', label: 'Voltear lienzo horizontal', enabled: hasDoc, run: () => ops.transformImage('flipH') },
  { id: 'imgFlipV', label: 'Voltear lienzo vertical', enabled: hasDoc, run: () => ops.transformImage('flipV') },
  { id: 'cropSel', label: 'Recortar a la selección', enabled: hasSel, run: ops.cropToSelection },
  { id: 'trim', label: 'Cortar transparencia', enabled: hasDoc, run: ops.trimTransparent },
  { id: 'revealAll', label: 'Revelar todo', enabled: hasDoc, run: ops.revealAll },

  // Capa
  { id: 'newLayer', label: 'Nueva capa', keys: ['Shift+Ctrl+N'], enabled: hasDoc, run: ops.newLayer },
  { id: 'newGroup', label: 'Nuevo grupo', enabled: hasDoc, run: ops.newGroup },
  { id: 'dupLayer', label: 'Duplicar capa', enabled: hasLayer, run: ops.duplicateLayer },
  { id: 'layerViaCopy', label: 'Capa vía copiar', keys: ['Ctrl+J'], enabled: hasLayer, run: () => ops.layerVia(false) },
  { id: 'layerViaCut', label: 'Capa vía cortar', keys: ['Shift+Ctrl+J'], enabled: hasSel, run: () => ops.layerVia(true) },
  { id: 'delLayer', label: 'Eliminar capa', enabled: hasLayer, run: ops.deleteLayers },
  { id: 'renameLayer', label: 'Cambiar nombre…', enabled: hasLayer, run: async () => { const l = app.doc!.active!; const n = await promptDialog('Cambiar nombre de capa', 'Nombre', l.name); if (n !== null) ops.renameLayer(l, n); } },
  { id: 'group', label: 'Agrupar capas', keys: ['Ctrl+G'], enabled: hasLayer, run: ops.groupLayers },
  { id: 'ungroup', label: 'Desagrupar capas', keys: ['Shift+Ctrl+G'], enabled: () => app.doc?.active?.kind === 'group', run: ops.ungroup },
  { id: 'maskReveal', label: 'Mostrar todo', enabled: () => hasLayer() && !hasMask(), run: () => ops.addMask('reveal') },
  { id: 'maskHide', label: 'Ocultar todo', enabled: () => hasLayer() && !hasMask(), run: () => ops.addMask('hide') },
  { id: 'maskSel', label: 'Desde la selección', enabled: () => hasLayer() && !hasMask() && hasSel(), run: () => ops.addMask('selection') },
  { id: 'maskToggle', label: 'Desactivar / activar máscara', enabled: hasMask, run: ops.toggleMask },
  { id: 'maskInvert', label: 'Invertir máscara', enabled: hasMask, run: () => ops.invertMask(app.doc!.active!) },
  { id: 'maskApply', label: 'Aplicar máscara', enabled: hasMask, run: () => ops.deleteMask(true) },
  { id: 'maskDelete', label: 'Eliminar máscara', enabled: hasMask, run: () => ops.deleteMask(false) },
  { id: 'clip', label: 'Crear / soltar máscara de recorte', keys: ['Alt+Ctrl+G'], enabled: hasLayer, checked: () => !!app.doc?.active?.clip, run: ops.toggleClip },
  { id: 'layerStyle', label: 'Estilo de capa (sombra, trazo, resplandor)…', enabled: hasLayer, run: dlg.layerStyleDialog },
  { id: 'clearStyle', label: 'Quitar estilo de capa', enabled: () => !!app.doc?.active?.styles, run: () => ops.setLayerStyles(app.doc!.active!, null, true) },
  { id: 'bringFront', label: 'Traer al frente', keys: ['Shift+Ctrl+]'], enabled: hasLayer, run: () => ops.arrangeLayer('top') },
  { id: 'bringForward', label: 'Hacia delante', keys: ['Ctrl+]'], enabled: hasLayer, run: () => ops.arrangeLayer('up') },
  { id: 'sendBackward', label: 'Hacia atrás', keys: ['Ctrl+['], enabled: hasLayer, run: () => ops.arrangeLayer('down') },
  { id: 'sendBack', label: 'Enviar al fondo', keys: ['Shift+Ctrl+['], enabled: hasLayer, run: () => ops.arrangeLayer('bottom') },
  { id: 'toSmart', label: 'Convertir en objeto inteligente', enabled: hasLayer, run: ops.convertToSmart },
  { id: 'editSmart', label: 'Editar contenido', enabled: () => app.doc?.active?.kind === 'smart', run: () => ops.editSmartContents() },
  { id: 'rasterize', label: 'Rasterizar capa (texto, forma u objeto inteligente)', enabled: () => isParametric(app.doc?.active), run: ops.rasterize },
  { id: 'mergeDown', label: 'Combinar hacia abajo', keys: ['Ctrl+E'], enabled: hasLayer, run: ops.mergeDown },
  { id: 'mergeVisible', label: 'Combinar visibles', keys: ['Shift+Ctrl+E'], enabled: hasDoc, run: ops.mergeVisible },
  { id: 'stamp', label: 'Estampar visibles en una capa nueva', keys: ['Alt+Shift+Ctrl+E'], enabled: hasDoc, run: () => { const d = app.doc!; d.setActive(d.root.children[d.root.children.length - 1] ?? null, false); ops.placeImage(d.flatten(), 'Estampado', { x: 0, y: 0 }); } },
  { id: 'flatten', label: 'Acoplar imagen', enabled: hasDoc, run: ops.flattenImage },

  // Selección
  { id: 'selectAll', label: 'Todo', keys: ['Ctrl+A'], enabled: hasDoc, run: ops.selectAll },
  { id: 'deselect', label: 'Deseleccionar', keys: ['Ctrl+D'], enabled: hasSel, run: ops.deselect },
  { id: 'invertSel', label: 'Invertir', keys: ['Shift+Ctrl+I'], enabled: hasDoc, run: ops.invertSelection },
  { id: 'selFromLayer', label: 'Cargar selección desde la capa', enabled: hasLayer, run: () => ops.selectionFromLayer(app.doc!.active!) },
  { id: 'pathToSel', label: 'Trazado a selección', keys: ['Ctrl+Enter'], enabled: () => app.doc?.active?.kind === 'shape', run: ops.pathToSelection },
  { id: 'quickMask', label: 'Editar en modo máscara rápida', keys: ['Q'], enabled: hasDoc, checked: () => !!app.doc?.quickMask, run: ops.toggleQuickMask },
  { id: 'contentFill', label: 'Rellenar según contenido', keys: ['Shift+Backspace', 'Shift+Delete'], enabled: hasSel, run: () => ops.contentAwareFill() },
  { id: 'colorRange', label: 'Gama de colores…', enabled: hasDoc, run: dlg.colorRangeDialog },
  { id: 'feather', label: 'Calar…', keys: ['Shift+F6'], enabled: hasSel, run: () => dlg.modifySelectionDialog('feather') },
  { id: 'expand', label: 'Expandir…', enabled: hasSel, run: () => dlg.modifySelectionDialog('expand') },
  { id: 'contract', label: 'Contraer…', enabled: hasSel, run: () => dlg.modifySelectionDialog('contract') },

  // Filtro
  { id: 'liquify', label: 'Licuar…', keys: ['Shift+Ctrl+X'], enabled: hasLayer, run: liquifyDialog },
  { id: 'lastFilter', label: 'Repetir último filtro', keys: ['Alt+Ctrl+F'], enabled: () => !!ops.lastFilter && hasLayer(), run: ops.repeatLastFilter },

  // Vista
  { id: 'zoomIn', label: 'Acercar', keys: ['Ctrl+=', 'Ctrl++', 'Ctrl+NumpadAdd'], enabled: hasDoc, run: () => app.viewport.zoomStep(1) },
  { id: 'zoomOut', label: 'Alejar', keys: ['Ctrl+-', 'Ctrl+NumpadSubtract'], enabled: hasDoc, run: () => app.viewport.zoomStep(-1) },
  { id: 'fit', label: 'Ajustar a la pantalla', keys: ['Ctrl+0'], enabled: hasDoc, run: () => app.viewport.fit() },
  { id: 'actual', label: 'Píxeles reales (100 %)', keys: ['Ctrl+1'], enabled: hasDoc, run: () => app.viewport.setZoom(1, null) },
  { id: 'rulers', label: 'Reglas', keys: ['Ctrl+R'], checked: () => app.showRulers, run: () => app.viewport.setRulers(!app.showRulers) },
  { id: 'guides', label: 'Mostrar guías', keys: ['Ctrl+;'], checked: () => app.showGuides, run: () => { app.showGuides = !app.showGuides; app.viewport.requestRender(); } },
  { id: 'grid', label: 'Cuadrícula', keys: ["Ctrl+'"], checked: () => app.showGrid, run: () => { app.showGrid = !app.showGrid; app.viewport.requestRender(); } },
  { id: 'newGuide', label: 'Nueva guía…', enabled: hasDoc, run: newGuideDialog },
  { id: 'clearGuides', label: 'Borrar guías', enabled: () => !!app.doc && (app.doc.guides.h.length + app.doc.guides.v.length > 0), run: () => { app.doc!.guides = { h: [], v: [] }; app.viewport.requestRender(); } },

  // Ventana
  ...([['color', 'Color y Muestras'], ['props', 'Propiedades e Historial'], ['layers', 'Capas']] as const).map(([g, label]): Action => ({
    id: 'win:' + g, label, checked: () => !(document.querySelector(`[data-group=${g}]`) as HTMLElement)?.classList.contains('closed'),
    run: () => { document.querySelector(`[data-group=${g}]`)?.classList.toggle('closed'); },
  })),
  { id: 'win:timeline', label: 'Línea de tiempo (animación)', checked: () => !document.querySelector('.timeline')?.classList.contains('closed'), run: () => { document.querySelector('.timeline')?.classList.toggle('closed'); app.doc?.changed(); requestAnimationFrame(() => app.viewport.resize()); } },
  { id: 'win:tools', label: 'Herramientas', checked: () => !document.body.classList.contains('no-tools'), run: () => { document.body.classList.toggle('no-tools'); requestAnimationFrame(() => app.viewport.resize()); } },
  { id: 'win:options', label: 'Opciones', checked: () => !document.body.classList.contains('no-options'), run: () => { document.body.classList.toggle('no-options'); requestAnimationFrame(() => app.viewport.resize()); } },
  { id: 'win:all', label: 'Ocultar / mostrar todos los paneles', keys: ['Tab'], run: () => { document.body.classList.toggle('hide-panels'); requestAnimationFrame(() => app.viewport.resize()); } },

  // Ayuda
  { id: 'shortcuts', label: 'Atajos de teclado', keys: ['F1'], run: () => dlg.shortcutsDialog(shortcutList()) },
  { id: 'about', label: 'Acerca de Editor', run: dlg.aboutDialog },
];

// Ajustes y filtros desde el registro
for (const f of FILTERS) {
  ACTIONS.push({ id: 'filter:' + f.id, label: f.name, keys: f.shortcut ? [f.shortcut] : undefined, enabled: hasLayer, run: () => dlg.filterDialog(f) });
}

for (const f of FILTERS) if (f.group === 'ajuste' && !f.noLayer) {
  ACTIONS.push({ id: 'adjust:' + f.id, label: f.name.replace('…', ''), enabled: hasDoc, run: () => ops.newAdjustmentLayer(f) });
}

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
