// Barra de menús superior con submenús.

import { h } from './dom';
import { actionById } from './actions';
import { FILTERS } from '../filters/registry';

type Item = string | '-' | { label: string; items: Item[] };

const filterItems = (group: 'ajuste' | 'filtro'): Item[] => {
  const list = FILTERS.filter(f => f.group === group && f.inMenu !== false);
  if (group === 'ajuste') return list.map(f => 'filter:' + f.id);
  const subs = new Map<string, Item[]>();
  for (const f of list) { if (!f.submenu) continue; const k = f.submenu; if (!subs.has(k)) subs.set(k, []); subs.get(k)!.push('filter:' + f.id); }
  const order = ['Desenfocar', 'Distorsionar', 'Enfocar', 'Estilizar', 'Pixelizar', 'Ruido', 'Otro'];
  return [...subs].sort((x, y) => order.indexOf(x[0]) - order.indexOf(y[0])).map(([label, items]) => ({ label, items }));
};

const MENUS: { label: string; items: Item[] }[] = [
  { label: 'Archivo', items: ['new', 'open', 'place', '-', 'save', 'saveAs', 'export', 'exportLayers', '-', 'batch', '-', 'print', 'close'] },
  { label: 'Edición', items: ['undo', 'redo', '-', 'cut', 'copy', 'copyMerged', 'paste', 'pasteInPlace', 'pasteInto', 'clear', '-', 'fade', '-', 'fill', 'contentFill', '-', 'caScale', 'puppet', 'stroke', '-', 'findReplace', '-', 'defineBrush', 'definePattern', '-', 'freeTransform',
    { label: 'Transformar', items: ['skew', 'distort', 'perspective', 'warp', '-', 'flipH', 'flipV', '-', 'rot90', 'rot-90', 'rot180'] }, '-', 'keysEdit', 'prefs'] },
  { label: 'Imagen', items: [{ label: 'Ajustes', items: filterItems('ajuste') }, '-', 'dupDoc', '-', 'imageSize', 'canvasSize',
    { label: 'Modo', items: ['modeRgb', 'modeGray', '-', 'filter:indexed'] },
    { label: 'Rotación de imagen', items: ['imgRot90', 'imgRot-90', 'imgRot180', 'imgRotArb', '-', 'imgFlipH', 'imgFlipV'] }, '-', 'cropSel', 'trim', 'revealAll'] },
  { label: 'Capa', items: ['newLayer', 'newGroup', 'dupLayer', 'layerViaCopy', 'layerViaCut', 'delLayer', 'renameLayer', '-',
    'artboard',
    { label: 'Nueva capa de relleno', items: ['fill:solid', 'fill:gradient', 'fill:pattern'] },
    { label: 'Nueva capa de ajuste', items: FILTERS.filter(f => f.group === 'ajuste' && !f.noLayer).map(f => 'adjust:' + f.id) }, 'layerStyle', 'copyStyle', 'pasteStyle', 'clearStyle', 'clip',
    { label: 'Objeto inteligente', items: ['toSmart', 'smartCopy', 'editSmart', 'replaceSmart', 'exportSmart', 'rasterize'] }, { label: 'Texto', items: ['warpText', 'textOnPath', 'textVertical'] }, '-', 'group', 'ungroup', '-',
    'removeBg', { label: 'Máscara de capa', items: ['maskReveal', 'maskHide', 'maskSel', '-', 'maskToggle', 'maskInvert', 'maskApply', 'maskDelete'] }, { label: 'Máscara vectorial', items: ['vmPath', '-', 'vmToggle', 'vmInvert', 'vmRaster', 'vmDelete'] },
    { label: 'Organizar', items: ['bringFront', 'bringForward', 'sendBackward', 'sendBack'] }, { label: 'Alinear', items: ['align:left', 'align:hcenter', 'align:right', '-', 'align:top', 'align:vcenter', 'align:bottom'] }, { label: 'Distribuir', items: ['dist:left', 'dist:hcenter', 'dist:right', '-', 'dist:top', 'dist:vcenter', 'dist:bottom', '-', 'dist:hspace', 'dist:vspace'] }, '-', 'rasterize', '-', 'mergeDown', 'mergeVisible', 'stamp', 'flatten'] },
  { label: 'Selección', items: ['selectAll', 'deselect', 'invertSel', '-', 'selFromLayer', 'pathToSel', 'selToPath', 'selectSubject', 'colorRange', 'refine', '-', 'quickMask', '-', 'loadSel', 'saveSel', { label: 'Modificar', items: ['border', 'smoothSel', 'expand', 'contract', 'feather'] }, 'growSel', 'similarSel', 'transformSel'] },
  { label: 'Filtro', items: ['lastFilter', '-', 'filter:develop', 'liquify', '-', ...filterItems('filtro')] },
  { label: 'Vista', items: ['zoomIn', 'zoomOut', 'fit', 'actual', 'resetRot', '-', 'rulers', 'grid', 'guides', 'snap', 'newGuide', 'guideLayout', 'clearGuides'] },
  { label: 'Ventana', items: ['win:tools', 'win:options', '-', 'win:color', 'win:props', 'win:layers', 'win:timeline', '-', 'panel:Acciones', 'panel:Canales', 'panel:Capas', 'panel:Color', 'panel:Composiciones', 'panel:Estilos', 'panel:Historial', 'panel:Histograma', 'panel:Info', 'panel:Muestras', 'panel:Navegador', 'panel:Pinceles', 'panel:Propiedades', 'panel:Trazados', '-', 'win:all'] },
  { label: 'Ayuda', items: ['guide', 'shortcuts', '-', 'about'] },
];

window.addEventListener('editor-keys', () => {
  for (const el of document.querySelectorAll<HTMLElement>('.menu-item[data-action]')) { const a = actionById.get(el.dataset.action!); const k = el.querySelector('.mi-key'); if (a && k) k.textContent = a.keys ? prettyKey(a.keys[0]) : ''; }
});
export function prettyKey(k: string) { return k.replace('Delete', 'Supr').replace('Backspace', 'Retroceso').replace('Shift', 'Mayús'); }

function buildList(items: Item[], close: () => void): HTMLElement {
  const ul = h('div', { class: 'menu-list' });
  for (const it of items) {
    if (it === '-') { ul.append(h('div', { class: 'menu-sep' })); continue; }
    if (typeof it === 'object') {
      const sub = buildList(it.items, close);
      sub.classList.add('submenu');
      ul.append(h('div', { class: 'menu-item has-sub' }, h('span', { class: 'mi-check' }), h('span', { class: 'mi-label' }, it.label), h('span', { class: 'mi-key' }, '▸'), sub));
      continue;
    }
    const a = actionById.get(it);
    if (!a) continue;
    const el = h('div', { class: 'menu-item', 'data-action': a.id },
      h('span', { class: 'mi-check' }), h('span', { class: 'mi-label' }, a.label), h('span', { class: 'mi-key' }, a.keys ? prettyKey(a.keys[0]) : ''));
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (el.classList.contains('disabled')) return;
      close(); a.run();
    });
    ul.append(el);
  }
  return ul;
}

function refreshStates(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.menu-item[data-action]').forEach(el => {
    const a = actionById.get(el.dataset.action!)!;
    el.classList.toggle('disabled', a.enabled ? !a.enabled() : false);
    el.querySelector('.mi-check')!.textContent = a.checked?.() ? '✓' : '';
  });
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
    });
    top.addEventListener('pointerenter', () => {
      if (openMenu && openMenu !== top) { close(); refreshStates(top); top.classList.add('open'); openMenu = top; }
    });
    bar.append(top);
  }
  document.addEventListener('pointerdown', e => { if (openMenu && !bar.contains(e.target as Node)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && openMenu) close(); });
  parent.append(bar);
}
