// Menú del móvil: un botón «Menú» que abre una hoja desde abajo con las categorías en pestañas grandes,
// filas cómodas para el dedo, submenús que se despliegan en el sitio y un buscador para filtrar.
import { app } from './app';
import { h } from './dom';
import { icon } from './icons';
import { actionById } from './actions';
import { visibleMenus, refreshStates, type Item } from './menus';
import { t } from '../i18n/i18n';

const ICON: Record<string, string> = { Archivo: 'open', Edición: 'edit', Imagen: 'image', Capa: 'layers', Selección: 'marqueeRect', Filtro: 'fx', IA: 'magic', Juegos: 'pixel', Fotografía: 'image', Ilustración: 'palette', Animación: 'film', 'Pixel art': 'pixel', Videojuegos: 'gamepad', Audio: 'music', Vista: 'eye', Ventana: 'colorPanel', Ayuda: 'info' };
const KEY = 'editor.mmTab';
let sheet: HTMLElement | null = null;

export function closeMobileMenu() {
  if (!sheet) return;
  const s = sheet; sheet = null;
  s.classList.remove('in'); document.body.classList.remove('mm-open');
  setTimeout(() => s.remove(), 180);
}

function rows(items: Item[], close: () => void, depth = 0): HTMLElement {
  const box = h('div', { class: 'mm-list' + (depth ? ' mm-sub' : '') });
  let lastSep = true;
  for (const it of items) {
    if (it === '-') { if (!lastSep) box.append(h('div', { class: 'mm-sep' })); lastSep = true; continue; }
    if (typeof it === 'object') {
      const inner = rows(it.items, close, depth + 1);
      const head = h('button', { class: 'mm-item mm-group', type: 'button', 'aria-expanded': 'false' }, h('span', { class: 'mm-label' }, it.label), h('span', { class: 'mm-chev', html: icon('chevronDown') }));
      head.onclick = () => { const open = head.getAttribute('aria-expanded') !== 'true'; head.setAttribute('aria-expanded', String(open)); inner.classList.toggle('open', open); if (open) setTimeout(() => head.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30); };
      box.append(head, inner); lastSep = false; continue;
    }
    const a = actionById.get(it); if (!a) continue;
    const el = h('button', { class: 'menu-item mm-item', type: 'button', 'data-action': a.id }, h('span', { class: 'mi-check' }), h('span', { class: 'mm-label mi-label' }, a.label));
    el.onclick = () => {
      if (el.classList.contains('disabled') || (a.enabled && !a.enabled())) { app.toast('Ahora no se puede: elige antes una capa o una selección adecuada', 'warn'); return; }
      close(); a.run();
    };
    box.append(el); lastSep = false;
  }
  return box;
}

export function openMobileMenu() {
  if (sheet) { closeMobileMenu(); return; }
  const MENUS = visibleMenus();
  let tab = 0; try { tab = Math.max(0, Math.min(MENUS.length - 1, +(localStorage.getItem(KEY) ?? 0) || 0)); } catch { /* */ }
  const body = h('div', { class: 'mm-body' });
  const tabs = h('div', { class: 'mm-tabs', role: 'tablist' });
  const search = h('input', { class: 'mm-search', type: 'search', placeholder: 'Buscar en el menú…', 'aria-label': 'Buscar en el menú' }) as HTMLInputElement;
  const closeBtn = h('button', { class: 'mm-close', type: 'button', title: 'Cerrar', 'aria-label': 'Cerrar', html: icon('close') });
  const grip = h('div', { class: 'mm-grip', 'aria-hidden': 'true' });
  const panel = h('div', { class: 'mm-sheet', role: 'dialog', 'aria-label': 'Menú' }, grip, h('div', { class: 'mm-head' }, search, closeBtn), tabs, body);
  const ov = h('div', { class: 'mm-overlay' }, panel);
  const close = () => closeMobileMenu();
  const show = (i: number) => {
    tab = i; try { localStorage.setItem(KEY, String(i)); } catch { /* */ }
    tabs.querySelectorAll('.mm-tab').forEach((b, j) => { b.classList.toggle('on', j === i); b.setAttribute('aria-selected', String(j === i)); });
    body.replaceChildren(rows(MENUS[i].items, close)); refreshStates(body); body.scrollTop = 0;
    (tabs.children[i] as HTMLElement)?.scrollIntoView({ inline: 'center', block: 'nearest' });
  };
  MENUS.forEach((m, i) => { const b = h('button', { class: 'mm-tab', type: 'button', role: 'tab', html: icon(ICON[m.label] ?? 'chevronRight') }, h('span', {}, m.label)); b.onclick = () => { search.value = ''; show(i); }; tabs.append(b); });
  // buscar: todas las acciones de todos los menús cuyo nombre (en el idioma actual) contenga el texto
  search.oninput = () => {
    const q = search.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!q) { show(tab); return; }
    const found: string[] = [], seen = new Set<string>();
    const walk = (items: Item[]) => { for (const it of items) { if (it === '-') continue; if (typeof it === 'object') walk(it.items); else if (!seen.has(it)) { seen.add(it); const a = actionById.get(it); if (a && (t(a.label) + ' ' + a.label).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q)) found.push(it); } } };
    for (const m of MENUS) walk(m.items);
    tabs.querySelectorAll('.mm-tab').forEach(b => b.classList.remove('on'));
    body.replaceChildren(found.length ? rows(found, close) : h('div', { class: 'hint mm-empty' }, 'No hay nada con ese nombre'));
    refreshStates(body);
  };
  closeBtn.onclick = close;
  ov.addEventListener('pointerdown', e => { if (e.target === ov) close(); });
  // arrastrar la barrita hacia abajo cierra la hoja
  grip.addEventListener('pointerdown', e => {
    const y0 = e.clientY; grip.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => { panel.style.transform = `translateY(${Math.max(0, ev.clientY - y0)}px)`; };
    const up = (ev: PointerEvent) => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); panel.style.transform = ''; if (ev.clientY - y0 > 80) close(); };
    grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up);
  });
  document.body.append(ov); sheet = ov; document.body.classList.add('mm-open');
  show(tab);
  requestAnimationFrame(() => ov.classList.add('in'));
}

document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheet) closeMobileMenu(); });
