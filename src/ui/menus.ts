// Barra de menús superior con submenús.

import { h } from './dom';
import { actionById } from './actions';
import { FILTERS } from '../filters/registry';

type Item = string | '-' | { label: string; items: Item[] };

const filterItems = (group: 'ajuste' | 'filtro'): Item[] => {
  const list = FILTERS.filter(f => f.group === group);
  if (group === 'ajuste') return list.map(f => 'filter:' + f.id);
  const subs = new Map<string, Item[]>();
  for (const f of list) { const k = f.submenu ?? 'Otros'; if (!subs.has(k)) subs.set(k, []); subs.get(k)!.push('filter:' + f.id); }
  return [...subs].map(([label, items]) => ({ label, items }));
};

const MENUS: { label: string; items: Item[] }[] = [
  { label: 'Archivo', items: ['new', 'open', 'place', '-', 'save', 'saveAs', 'export', '-', 'close'] },
  { label: 'Edición', items: ['undo', 'redo', '-', 'cut', 'copy', 'copyMerged', 'paste', 'clear', '-', 'fill', '-', 'freeTransform',
    { label: 'Transformar', items: ['flipH', 'flipV', '-', 'rot90', 'rot-90', 'rot180'] }] },
  { label: 'Imagen', items: [{ label: 'Ajustes', items: filterItems('ajuste') }, '-', 'imageSize', 'canvasSize',
    { label: 'Rotación de imagen', items: ['imgRot90', 'imgRot-90', 'imgRot180', '-', 'imgFlipH', 'imgFlipV'] }, '-', 'cropSel', 'trim', 'revealAll'] },
  { label: 'Capa', items: ['newLayer', 'newGroup', 'dupLayer', 'layerViaCopy', 'layerViaCut', 'delLayer', 'renameLayer', '-', 'group', 'ungroup', '-',
    { label: 'Máscara de capa', items: ['maskReveal', 'maskHide', 'maskSel', '-', 'maskToggle', 'maskInvert', 'maskApply', 'maskDelete'] },
    { label: 'Organizar', items: ['bringFront', 'bringForward', 'sendBackward', 'sendBack'] }, '-', 'rasterize', '-', 'mergeDown', 'mergeVisible', 'flatten'] },
  { label: 'Seleccionar', items: ['selectAll', 'deselect', 'invertSel', '-', 'selFromLayer', { label: 'Modificar', items: ['feather', 'expand', 'contract'] }] },
  { label: 'Filtro', items: ['lastFilter', '-', ...filterItems('filtro')] },
  { label: 'Vista', items: ['zoomIn', 'zoomOut', 'fit', 'actual', '-', 'rulers', 'guides', 'newGuide', 'clearGuides'] },
  { label: 'Ayuda', items: ['shortcuts', 'about'] },
];

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
