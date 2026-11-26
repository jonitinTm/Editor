// Barra de menús superior con submenús.
import { lang } from '../i18n/i18n';

import { app } from './app';
import { h } from './dom';
import { actionById } from './actions';
import { FILTERS } from '../filters/registry';

export type Item = string | '-' | { label: string; items: Item[] };

const filterItems = (group: 'ajuste' | 'filtro'): Item[] => {
  const list = FILTERS.filter(f => f.group === group && f.inMenu !== false);
  if (group === 'ajuste') return list.map(f => 'filter:' + f.id);
  const subs = new Map<string, Item[]>();
  for (const f of list) { if (!f.submenu) continue; const k = f.submenu; if (!subs.has(k)) subs.set(k, []); subs.get(k)!.push('filter:' + f.id); }
  const order = ['Artístico', 'Trazos de pincel', 'Bosquejar', 'Desenfocar', 'Galería de desenfoque', 'Distorsionar', 'Enfocar', 'Estilizar', 'Interpretar', 'Pixelizar', 'Retrato', 'Ruido', 'Textura', '3D', 'Vídeo', 'Otro'];
  return [...subs].sort((x, y) => order.indexOf(x[0]) - order.indexOf(y[0])).map(([label, items]) => ({ label, items }));
};

export const MENUS: { label: string; items: Item[] }[] = [
  { label: 'Archivo', items: ['new', 'templates', 'collage', 'open', 'openGallery', 'galleryLayer', 'openLayers', 'projects', 'recent', 'place', '-', 'save', 'saveAs', 'sendProject', 'quickPng', 'export', 'exportLayers', 'exportSlices', 'social', 'watermark', 'timelapse', '-', 'videoFrames', 'contactSheet', '-', 'batch', 'cropScans', 'panorama', '-', 'fileInfo', 'print', 'revert', 'close'] },
  { label: 'Edición', items: ['undo', 'redo', '-', 'cut', 'copy', 'copyMerged', 'paste', 'pasteInPlace', 'pasteInto', 'clear', '-', 'fade', '-', 'fill', 'contentFill', '-', 'caScale', 'puppet', 'perspWarp', 'autoAlign', 'stroke', '-', 'findReplace', 'skyReplace', '-', 'defineBrush', 'definePattern', 'defineShape', 'importPresets', '-', 'freeTransform',
    { label: 'Transformar', items: ['skew', 'distort', 'perspective', 'warp', '-', 'flipH', 'flipV', '-', 'rot90', 'rot-90', 'rot180'] }, '-', 'keysEdit', 'penSettings', 'quickBtnSettings', 'perf', 'screenCheck', 'prefs'] },
  { label: 'Imagen', items: ['autoEnhance', 'blurBg', '-', { label: 'Ajustes', items: [...filterItems('ajuste'), '-', 'variations'] }, '-', 'dupDoc', '-', 'palette', 'applyImage', 'calculations', 'freqSep', '-', 'imageSize', 'canvasSize', 'expandImage',
    { label: 'Modo', items: ['modeRgb', 'modeGray', '-', 'filter:indexed'] },
    { label: 'Rotación de imagen', items: ['imgRot90', 'imgRot-90', 'imgRot180', 'imgRotArb', '-', 'imgFlipH', 'imgFlipV'] }, '-', 'cropSel', 'circleCrop', 'trim', 'revealAll', 'autoStraighten', 'fitImage', '-', 'traceImage'] },
  { label: 'Capa', items: ['newLayer', 'newGroup', 'dupLayer', 'dupLayerTo', 'layerViaCopy', 'layerViaCut', 'delLayer', 'renameLayer', '-',
    'artboard',
    { label: 'Nueva capa de relleno', items: ['fill:solid', 'fill:gradient', 'fill:pattern'] },
    { label: 'Nueva capa de ajuste', items: FILTERS.filter(f => f.group === 'ajuste' && !f.noLayer).map(f => 'adjust:' + f.id) }, { label: 'Crear', items: ['genBg', 'qr', 'framePhoto', 'harmony'] }, { label: '3D y sombras', items: ['castShadow', 'extrude3d'] }, { label: 'Halos', items: ['defringe', 'matteBlack', 'matteWhite'] }, { label: 'Estilo de capa', items: ['layerStyle', '-', 'copyStyle', 'pasteStyle', 'rasterizeStyle', 'clearStyle'] }, 'clip',
    { label: 'Objeto inteligente', items: ['toSmart', 'smartCopy', 'editSmart', 'replaceSmart', 'exportSmart', 'rasterize'] }, { label: 'Texto', items: ['textFx', 'warpText', 'textOnPath', 'textInShape', 'textVertical', 'glyphs', 'textStyles', '-', 'textToShape', 'textToPath'] }, '-', 'group', 'ungroup', 'linkLayers', 'selectLinked', { label: 'Copiar como código', items: ['copyCSS', 'copySVG'] }, '-',
    'removeBg', { label: 'Máscara de capa', items: ['maskReveal', 'maskHide', 'maskSel', '-', 'maskToggle', 'maskInvert', 'maskApply', 'maskDelete'] }, { label: 'Máscara vectorial', items: ['vmPath', '-', 'vmToggle', 'vmInvert', 'vmRaster', 'vmDelete'] },
    { label: 'Seleccionar capa', items: ['layerAbove', 'layerBelow', '-', 'layerTop', 'layerBottom'] }, { label: 'Modo de fusión', items: ['blendNext', 'blendPrev', '-', ...['source-over', 'dissolve', 'darken', 'multiply', 'color-burn', 'linear-burn', 'lighten', 'screen', 'color-dodge', 'lighter', 'overlay', 'soft-light', 'hard-light', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'].map(b => 'blend:' + b)] }, 'lockAlphaToggle', 'refLayer', { label: 'Organizar', items: ['bringFront', 'bringForward', 'sendBackward', 'sendBack'] }, { label: 'Alinear', items: ['align:left', 'align:hcenter', 'align:right', '-', 'align:top', 'align:vcenter', 'align:bottom'] }, { label: 'Distribuir', items: ['dist:left', 'dist:hcenter', 'dist:right', '-', 'dist:top', 'dist:vcenter', 'dist:bottom', '-', 'dist:hspace', 'dist:vspace'] }, '-', 'mergeDown', 'mergeVisible', 'stamp', 'flatten', { label: 'Combinar formas', items: ['shape:unite', 'shape:subtract', 'shape:intersect', 'shape:exclude', '-', 'pathEffects'] }, { label: 'Combinar en pila', items: ['stack:median', 'stack:mean', 'stack:max', 'stack:min', '-', 'stack:hdr', 'focusStack'] }] },
  { label: 'Selección', items: ['selectAll', 'deselect', 'reselect', 'invertSel', 'selAllLayers', '-', 'selFromLayer', 'pathToSel', 'selToPath', 'selectSubject', 'selectSky', 'focusArea', 'colorRange', { label: 'Luminosidad', items: ['lum:lights', 'lum:darks', 'lum:mids'] }, 'refine', '-', 'quickMask', '-', 'loadSel', 'saveSel', { label: 'Modificar', items: ['border', 'smoothSel', 'expand', 'contract', 'feather'] }, 'growSel', 'similarSel', 'transformSel'] },
  { label: 'Filtro', items: ['lastFilter', '-', 'filterGallery', 'wideAngle', 'filter:develop', 'liquify', 'vanishing', 'pathBlur', 'displace', '-', ...filterItems('filtro')] },
  { label: 'IA', items: ['aiRemoveBg', 'aiSubject', 'aiSky', 'aiSelTool', '-', 'aiErase', 'aiFill', '-', 'aiDepthBlur', 'aiRelight', 'aiFog', 'aiPhoto3d', 'aiDepthLayer', '-', 'aiUpscale'] },
  { label: 'Vista', items: ['zoomIn', 'zoomOut', 'fit', 'actual', 'resetRot', 'flipView', '-', 'proof', 'gamut', 'clipWarn', 'pixelGrid', '-', 'compare', 'comparePrev', 'compareDoc', { label: 'Simular visión', items: ['sim:none', '-', 'sim:protan', 'sim:deutan', 'sim:tritan', 'sim:achroma'] }, 'contrast', '-', 'drawMode', { label: 'Asistente de perspectiva', items: ['assist:off', 'assist:p1', 'assist:p2'] }, '-', 'extras', 'rulers', 'grid', 'guides', 'snap', 'newGuide', 'guideLayout', 'clearGuides'] },
  { label: 'Ventana', items: ['win:tools', 'win:options', '-', 'win:color', 'win:props', 'win:layers', 'win:timeline', 'reference', '-', 'panel:Acciones', 'panel:Canales', 'panel:Capas', 'panel:Carácter', 'panel:Color', 'panel:Composiciones', 'panel:Estilos', 'panel:Historial', 'panel:Histograma', 'panel:Info', 'panel:Muestras', 'panel:Navegador', 'panel:Párrafo', 'panel:Pinceles', 'panel:Propiedades', 'panel:Trazados', '-', 'panelsOnlyTools', 'win:all'] },
  { label: 'Ayuda', items: ['cmdSearch', 'quickTasks', 'tour', 'touchTour', 'guide', 'shortcuts', '-', 'privacy', 'about'] },
];

window.addEventListener('editor-keys', () => {
  for (const el of document.querySelectorAll<HTMLElement>('.menu-item[data-action]')) { const a = actionById.get(el.dataset.action!); const k = el.querySelector('.mi-key'); if (a && k) k.textContent = a.keys ? prettyKey(a.keys[0]) : ''; }
});
export function prettyKey(k: string) { return lang !== 'es' ? k.replace('Delete', 'Del') : k.replace('Delete', 'Supr').replace('Backspace', 'Retroceso').replace('Shift', 'Mayús'); }

const isNarrow = () => window.innerWidth <= 700;
function buildList(items: Item[], close: () => void): HTMLElement {
  const ul = h('div', { class: 'menu-list' });
  for (const it of items) {
    if (it === '-') { ul.append(h('div', { class: 'menu-sep' })); continue; }
    if (typeof it === 'object') {
      const sub = buildList(it.items, close);
      sub.classList.add('submenu');
      const row = h('div', { class: 'menu-item has-sub' }, h('span', { class: 'mi-check' }), h('span', { class: 'mi-label' }, it.label), h('span', { class: 'mi-key' }, '▸'), sub);
      // en pantallas táctiles los submenús se abren tocándolos (dentro del mismo menú)
      row.addEventListener('click', e => { if (!isNarrow() || sub.contains(e.target as Node)) return; e.stopPropagation(); row.classList.toggle('sub-open'); });
      row.addEventListener('pointerenter', () => {
        if (isNarrow()) { sub.style.position = ''; return; }
        // al lado de su fila, sin salirse de la pantalla (y con desplazamiento si es muy largo)
        const r = row.getBoundingClientRect();
        sub.style.position = 'fixed'; sub.style.maxHeight = (window.innerHeight - 8) + 'px'; sub.style.overflowY = 'auto';
        requestAnimationFrame(() => {
          const w = sub.offsetWidth, hh = sub.offsetHeight;
          sub.style.left = (r.right + w > window.innerWidth - 4 ? Math.max(4, r.left - w) : r.right) + 'px';
          sub.style.top = Math.max(4, Math.min(r.top - 5, window.innerHeight - hh - 4)) + 'px';
        });
      });
      ul.append(row);
      continue;
    }
    const a = actionById.get(it);
    if (!a) continue;
    const el = h('div', { class: 'menu-item', 'data-action': a.id },
      h('span', { class: 'mi-check' }), h('span', { class: 'mi-label' }, a.label), h('span', { class: 'mi-key' }, a.keys ? prettyKey(a.keys[0]) : ''));
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (el.classList.contains('disabled')) return;
      close();
      // se comprueba también aquí: el estado puede haber cambiado desde que se abrió el menú
      if (a.enabled && !a.enabled()) { app.toast('Ahora no se puede: elige antes una capa o una selección adecuada', 'warn'); return; }
      a.run();
    });
    ul.append(el);
  }
  return ul;
}

export function refreshStates(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.menu-item[data-action]').forEach(el => {
    const a = actionById.get(el.dataset.action!)!;
    el.classList.toggle('disabled', a.enabled ? !a.enabled() : false);
    el.querySelector('.mi-check')!.textContent = a.checked?.() ? '✓' : '';
  });
}

/** Si la lista no cabe en la pantalla, se limita su altura y se puede desplazar. */
function fitList(top: HTMLElement) {
  const list = top.querySelector(':scope > .menu-list') as HTMLElement | null; if (!list) return;
  list.style.maxHeight = ''; list.style.overflowY = ''; list.style.left = '';
  let r = list.getBoundingClientRect();
  // si se sale por la derecha, se desplaza hacia la izquierda
  if (r.right > window.innerWidth - 4 && !isNarrow()) { list.style.left = (window.innerWidth - 4 - r.right) + 'px'; r = list.getBoundingClientRect(); }
  if (r.bottom > window.innerHeight - 4) { list.style.maxHeight = Math.max(160, window.innerHeight - r.top - 8) + 'px'; list.style.overflowY = 'auto'; }
}

export function buildMenuBar(parent: HTMLElement) {
  const bar = h('nav', { class: 'menubar' });
  let openMenu: HTMLElement | null = null;
  const close = () => { openMenu?.classList.remove('open'); openMenu = null; };
  for (const m of MENUS) {
    const top = h('div', { class: 'menu' }, h('span', { class: 'menu-title' }, m.label), buildList(m.items, close));
    top.addEventListener('click', e => {
      if ((e.target as HTMLElement).closest('.menu-list')) return;
      if (openMenu === top) { close(); return; }
      close(); refreshStates(top); top.classList.add('open'); openMenu = top;
      fitList(top);
      if (isNarrow()) {
        // en el móvil la lista se coloca sobre la pantalla para que no la corte la barra que se desplaza
        const list = top.querySelector(':scope > .menu-list') as HTMLElement, r = top.getBoundingClientRect();
        list.style.position = 'fixed'; list.style.top = r.bottom + 'px'; list.style.left = Math.max(4, Math.min(r.left, window.innerWidth - list.offsetWidth - 4)) + 'px';
        list.style.maxHeight = (window.innerHeight - r.bottom - 8) + 'px'; list.style.overflowY = 'auto';
      }
    });
    top.addEventListener('pointerenter', () => {
      if (isNarrow()) return;
      if (openMenu && openMenu !== top) { close(); refreshStates(top); top.classList.add('open'); openMenu = top; fitList(top); }
    });
    bar.append(top);
  }
  document.addEventListener('pointerdown', e => { if (openMenu && !bar.contains(e.target as Node)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && openMenu) close(); });
  parent.append(bar);
}

/** Ruta de menú de cada acción («Imagen › Ajustes › Curvas»), para el buscador. */
export function menuPaths(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (items: Item[], path: string) => { for (const it of items) { if (it === '-') continue; if (typeof it === 'object') walk(it.items, path + ' › ' + it.label); else if (!out.has(it)) out.set(it, path); } };
  for (const m of MENUS) walk(m.items, m.label);
  return out;
}
