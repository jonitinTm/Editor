// Paneles de la derecha: Capas, Historial y Propiedades.

import { app } from './app';
import { h, numberSlider } from './dom';
import { icon } from './icons';
import * as ops from './ops';
import { tracePath } from '../core/layers';
import { BLEND_MODES, GroupLayer, AdjustmentLayer, SmartLayer, hasStyles, Layer, TextLayer, ShapeLayer, isRaster, isParametric } from '../core/layers';
import { ctx2d } from '../core/canvas';
import { renderComposite } from '../core/compositor';
import { fontPicker } from './fontpicker';
import { WARP_STYLES } from '../tools/warpmesh';
import { actionById } from './actions';
import { promptDialog, row as formRow } from './dialog';
import { createPicker, SWATCHES } from './colorpicker';
import { levelsBody, curvesBody, patternSelect, lutPicker, gradientButton, BUILTIN_PRESETS, userPresets, saveUserPresets } from './widgets';
// las ventanas se cargan al abrirlas
const layerStyleDialog = () => { import('./dialogs').then(m => m.layerStyleDialog()); };
const filterDialog = (...a: Parameters<typeof import('./dialogs').filterDialog>) => { import('./dialogs').then(m => m.filterDialog(...a)); };
const warpTextDialog = (...a: Parameters<typeof import('./dialogs').warpTextDialog>) => { import('./dialogs').then(m => m.warpTextDialog(...a)); };
import { defaultParams } from '../filters/registry';
import { FILTERS } from '../filters/registry';
import { getPixels } from '../core/canvas';
import { gradeWheel } from './gradewheel';

function panel(title: string, body: HTMLElement, extraHeader?: HTMLElement, cls = '') {
  return h('section', { class: 'panel ' + cls },
    h('header', { class: 'panel-head' }, h('span', {}, title), extraHeader ?? null),
    body);
}

// ---- Miniaturas ------------------------------------------------------------------

const thumbCache = new WeakMap<object, { v: number; c: HTMLCanvasElement }>();
function thumb(owner: object, version: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, cls = 'thumb'): HTMLCanvasElement {
  const d = app.doc!;
  const cached = thumbCache.get(owner);
  if (cached && cached.v === version && cached.c.dataset.dw === `${d.width}x${d.height}`) return cached.c;
  const max = 36;
  const k = Math.min(max / d.width, max / d.height);
  const w = Math.max(1, Math.round(d.width * k)), hh = Math.max(1, Math.round(d.height * k));
  const c = cached?.c ?? h('canvas', { class: cls });
  c.width = w; c.height = hh; c.dataset.dw = `${d.width}x${d.height}`;
  const ctx = ctx2d(c);
  ctx.clearRect(0, 0, w, hh);
  ctx.imageSmoothingQuality = 'high';
  draw(ctx, w, hh);
  thumbCache.set(owner, { v: version, c });
  return c;
}
const FILTER_BY_ID = new Map(FILTERS.map(f => [f.id, f]));
const hashStr = (s: string) => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return x; };
function layerThumb(l: Layer) {
  if (l instanceof GroupLayer) return h('span', { class: 'thumb folder', html: icon('folder') });
  if (l instanceof AdjustmentLayer && FILTER_BY_ID.get(l.filterId)?.fill) {
    // Capa de relleno: miniatura con su color, degradado o motivo
    const def = FILTER_BY_ID.get(l.filterId)!, sig = JSON.stringify(l.params);
    return thumb(l, hashStr(sig), (ctx, w, hh) => { const img = ctx.createImageData(w, hh); const d = app.doc!; def.apply(img, { ...l.params, _x: 0, _y: 0, _W: w, _H: hh, scale: l.filterId === 'patternfill' ? (l.params.scale ?? 100) * w / d.width : l.params.scale }); ctx.putImageData(img, 0, 0); });
  }
  if (l instanceof AdjustmentLayer) return h('span', { class: 'thumb folder adj', html: icon('adjust') });
  const r = l as any;
  return thumb(l, l.version, (ctx, w, hh) => ctx.drawImage(r.canvas, 0, 0, w, hh));
}
function maskThumb(l: Layer) {
  const m = l.mask!;
  return thumb(m, m.version, (ctx, w, hh) => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hh); ctx.drawImage(m.canvas, 0, 0, w, hh); }, 'thumb mask');
}

// ---- Color y Muestras ---------------------------------------------------------------

export function buildColorPanel(parent: HTMLElement) {
  let target: 'fg' | 'bg' = 'fg';
  const picker = createPicker(app.fg, c => target === 'fg' ? app.setColors(c, app.bg) : app.setColors(app.fg, c));
  const fg = h('button', { class: 'cp-target on', title: 'Color frontal' }), bg = h('button', { class: 'cp-target', title: 'Color de fondo' });
  const choose = (t: 'fg' | 'bg') => { target = t; fg.classList.toggle('on', t === 'fg'); bg.classList.toggle('on', t === 'bg'); picker.set(t === 'fg' ? app.fg : app.bg); };
  fg.onclick = () => choose('fg'); bg.onclick = () => choose('bg');
  // cuadro clásico o rueda (como en las apps de dibujo); se recuerda la elección
  const VKEY = 'editor.colorView'; let view = 'square'; try { view = localStorage.getItem(VKEY) || 'square'; } catch { /* */ }
  const wheelBox = h('div', { class: 'cp-wheel-box' });
  const toggle = h('button', { class: 'btn cp-view', type: 'button', title: 'Cambiar entre cuadro y rueda de color' });
  const showView = () => {
    const wheel = view === 'wheel'; picker.el.style.display = wheel ? 'none' : ''; wheelBox.style.display = wheel ? '' : 'none';
    if (wheel && !wheelBox.firstChild) import('./artist').then(m => wheelBox.append(m.colorWheel(176)));
    toggle.textContent = wheel ? 'Cuadrado' : 'Rueda';
  };
  toggle.onclick = () => { view = view === 'wheel' ? 'square' : 'wheel'; try { localStorage.setItem(VKEY, view); } catch { /* */ } showView(); };
  const recentBox = h('div', { class: 'cp-recent' });
  import('./artist').then(m => recentBox.append(m.recentRow()));
  const body = h('div', { class: 'panel-body color-panel' }, h('div', { class: 'cp-side' }, h('div', { class: 'cp-targets' }, fg, bg), toggle), picker.el, wheelBox, recentBox);
  showView();
  parent.append(panel('Color', body));
  const upd = () => { fg.style.background = app.fg; bg.style.background = app.bg; if (!body.contains(document.activeElement) || document.activeElement === document.body) picker.set(target === 'fg' ? app.fg : app.bg); };
  app.on('colors', upd); upd();
}
const SW_KEY = 'editor.swatches';
export function userSwatches(): { name: string; color: string }[] { try { const v = JSON.parse(localStorage.getItem(SW_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
export function saveUserSwatches(l: { name: string; color: string }[]) { try { localStorage.setItem(SW_KEY, JSON.stringify(l.slice(0, 600))); } catch { /* sin almacenamiento */ } window.dispatchEvent(new Event('editor-swatches')); }

export function buildSwatchesPanel(parent: HTMLElement) {
  const grid = h('div', { class: 'swatch-grid' });
  const render = () => {
    grid.innerHTML = '';
    const mine = userSwatches();
    mine.forEach((s, i) => {
      const b = h('button', { class: 'sw', style: { background: s.color }, title: `${s.name ? s.name + ' · ' : ''}${s.color} (Alt+clic: color de fondo · clic derecho: quitar)` });
      b.onclick = e => e.altKey ? app.setColors(app.fg, s.color) : app.setColors(s.color, app.bg);
      b.oncontextmenu = e => { e.preventDefault(); const l = userSwatches(); l.splice(i, 1); saveUserSwatches(l); };
      grid.append(b);
    });
    if (mine.length) grid.append(h('div', { class: 'sw-sep' }));
    for (const c of SWATCHES) {
      const b = h('button', { class: 'sw', style: { background: c }, title: c + ' (Alt+clic: color de fondo)' });
      b.onclick = e => e.altKey ? app.setColors(app.fg, c) : app.setColors(c, app.bg);
      grid.append(b);
    }
  };
  const foot = h('div', { class: 'panel-foot' },
    h('button', { class: 'btn', title: 'Importar muestras de Adobe (.aco, .ase)', onclick: async () => { const io = await import('../io/files'); for (const f of await io.pickFiles('.aco,.ase')) await importSwatches(f); } }, 'Importar…'),
    h('button', { class: 'btn icon-btn', title: 'Vaciar mis muestras', onclick: () => { if (userSwatches().length) saveUserSwatches([]); }, html: icon('trash') }),
    h('button', { class: 'btn icon-btn', title: 'Añadir el color frontal a las muestras', onclick: () => saveUserSwatches([{ name: '', color: app.fg }, ...userSwatches()]) }, '＋'));
  render(); window.addEventListener('editor-swatches', render);
  parent.append(panel('Muestras', h('div', { class: 'brush-panel' }, h('div', { class: 'panel-body' }, grid), foot)));
}
export async function importSwatches(f: File) {
  const { readSwatches } = await import('../io/swatches');
  try {
    const list = readSwatches(await f.arrayBuffer());
    if (!list.length) { app.toast('El archivo no tiene colores', 'warn'); return; }
    saveUserSwatches([...list, ...userSwatches()]); app.toast(`${list.length} colores importados`);
  } catch (e: any) { app.toast('No se pudieron leer las muestras: ' + (e?.message ?? e), 'warn'); }
}

/** Menú contextual con acciones del catálogo. */
export function contextMenu(x: number, y: number, ids: string[], extra?: HTMLElement) {
  document.querySelector('.flyout.ctx')?.remove();
  const fly = h('div', { class: 'flyout ctx', style: { left: Math.min(x, window.innerWidth - 260) + 'px', top: Math.max(4, Math.min(y, window.innerHeight - ids.length * 24 - 20)) + 'px' } },
    ...ids.map(id => {
      if (id === '-') return h('div', { class: 'menu-sep' });
      const a = actionById.get(id)!; const off = a.enabled ? !a.enabled() : false;
      return h('div', { class: 'fly-item' + (off ? ' disabled' : ''), onclick: () => { fly.remove(); if (!off) a.run(); } }, a.label);
    }), extra ?? null);
  document.body.append(fly);
  setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!fly.contains(e.target as Node)) { fly.remove(); document.removeEventListener('pointerdown', off); } }), 0);
}

const LABEL_COLORS: Record<string, string> = { rojo: '#7a3434', naranja: '#7d5222', amarillo: '#776a26', verde: '#335f33', azul: '#30477a', violeta: '#55387a', gris: '#4d4d4d' };

// ---- Capas -------------------------------------------------------------------------

export function buildLayersPanel(parent: HTMLElement) {
  const blend = h('select', { class: 'blend', title: 'Modo de fusión' }, ...BLEND_MODES.map(m => h('option', { value: m.id }, m.label)));
  let opacityChanging = false;
  const opacity = numberSlider({
    label: 'Opacidad', min: 0, max: 100, value: 100, unit: '%', compact: true,
    onInput: v => {
      const l = app.doc?.active; if (!l) return;
      ops.setLayerProp(l, 'opacity', v / 100, false);
      opacityChanging = true;
    },
  });
  const commitOpacity = () => { if (opacityChanging && app.doc) { opacityChanging = false; app.doc.commit('Opacidad de capa'); } };
  let fillChanging = false;
  const fillSl = numberSlider({ label: 'Relleno', min: 0, max: 100, value: 100, unit: '%', compact: true,
    onInput: v => { const l = app.doc?.active; if (!l) return; ops.setLayerProp(l, 'fillOpacity', v / 100, false); fillChanging = true; } });
  fillSl.el.title = 'Relleno: opacidad del contenido sin afectar a la sombra, el contorno o el resplandor';
  const commitFill = () => { if (fillChanging && app.doc) { fillChanging = false; app.doc.commit('Relleno de capa'); } };
  for (const ev of ['change', 'pointerup', 'focusout']) fillSl.el.addEventListener(ev, commitFill);
  opacity.el.addEventListener('change', commitOpacity);
  opacity.el.addEventListener('pointerup', commitOpacity);
  opacity.el.addEventListener('focusout', commitOpacity);
  blend.addEventListener('change', () => { const l = app.doc?.active; if (l) ops.setLayerProp(l, 'blendMode', blend.value); });
  const lockBtn = h('button', { class: 'btn icon-btn', title: 'Bloquear / desbloquear capa', html: icon('lock') });
  lockBtn.onclick = () => { const l = app.doc?.active; if (l) ops.setLayerProp(l, 'locked', !l.locked); };

  const list = h('div', { class: 'layer-list' });
  const search = h('input', { type: 'search', class: 'layer-search', placeholder: 'Buscar capas…' });
  search.addEventListener('input', () => render());
  const footBtn = (ic: string, title: string, fn: () => void) => h('button', { class: 'btn icon-btn', title, html: icon(ic), onclick: fn });
  const adjBtn = footBtn('adjust', 'Nueva capa de ajuste', () => {
    const r = adjBtn.getBoundingClientRect();
    const fly = h('div', { class: 'flyout', style: { right: window.innerWidth - r.right + 'px', bottom: window.innerHeight - r.top + 4 + 'px' } },
      ...FILTERS.filter(f => f.group === 'ajuste' && !f.noLayer).map(f => h('div', { class: 'fly-item', onclick: () => { fly.remove(); ops.newAdjustmentLayer(f); } }, f.name.replace('…', ''))));
    document.body.append(fly);
    setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!fly.contains(e.target as Node)) { fly.remove(); document.removeEventListener('pointerdown', off); } }), 0);
  });
  const foot = h('div', { class: 'panel-foot' },
    footBtn('link', 'Vincular / desvincular las capas seleccionadas', ops.toggleLinkLayers),
    h('button', { class: 'btn icon-btn fx-btn', title: 'Estilo de capa (sombra, trazo, resplandor)', onclick: layerStyleDialog }, 'fx'),
    adjBtn,
    footBtn('mask', 'Añadir máscara de capa', () => ops.addMask('reveal')),
    footBtn('folder', 'Nuevo grupo', ops.newGroup),
    footBtn('newLayer', 'Nueva capa', ops.newLayer),
    footBtn('duplicate', 'Duplicar capa', ops.duplicateLayer),
    footBtn('trash', 'Eliminar capa', ops.deleteLayers));
  const lockA = h('button', { class: 'btn icon-btn', title: 'Bloquear transparencia (solo se pinta donde ya hay píxeles)', html: icon('lockAlpha') });
  lockA.onclick = () => { const l = app.doc?.active; if (l) ops.setLayerProp(l, 'lockAlpha', !l.lockAlpha); };
  const lockPx = h('button', { class: 'btn icon-btn', title: 'Bloquear píxeles (no se puede pintar en la capa)', html: icon('brush') });
  lockPx.onclick = () => { const l = app.doc?.active; if (l) ops.setLayerProp(l, 'lockPixels', !l.lockPixels); };
  const lockPs = h('button', { class: 'btn icon-btn', title: 'Bloquear posición (no se puede mover ni transformar)', html: icon('move') });
  lockPs.onclick = () => { const l = app.doc?.active; if (l) ops.setLayerProp(l, 'lockPos', !l.lockPos); };
  const top = h('div', { class: 'layer-controls' }, h('div', { class: 'lc-row' }, blend, opacity.el), h('div', { class: 'lc-row' }, h('span', { class: 'hint', title: 'Bloquear' }, 'Bloq.'), lockA, lockPx, lockPs, lockBtn, fillSl.el));
  const body = h('div', { class: 'panel-body layers' }, top, search, list, foot);
  parent.append(panel('Capas', body));

  let dragLayer: Layer | null = null;

  const row = (l: Layer, depth: number): HTMLElement[] => {
    const d = app.doc!;
    const isActive = d.active === l;
    const selected = d.selectedIds.has(l.id);
    const eye = h('button', { class: 'eye' + (l.visible ? '' : ' off'), title: l.visible ? 'Ocultar' : 'Mostrar', html: l.visible ? icon('eye') : '' });
    eye.onclick = e => {
      e.stopPropagation();
      if (e.altKey) { // Alt+clic: ver solo esta capa (o volver a mostrarlas todas)
        const sibs = l.parent!.children, solo = sibs.every(s => s === l ? s.visible : !s.visible);
        for (const s of sibs) s.visible = solo ? true : s === l;
        d.commit(solo ? 'Mostrar todas las capas' : 'Ver solo una capa'); return;
      }
      ops.setLayerProp(l, 'visible', !l.visible);
    };
    const arrow = l instanceof GroupLayer
      ? h('button', { class: 'arrow', html: icon(l.expanded ? 'chevronDown' : 'chevronRight'), onclick: (e: Event) => { e.stopPropagation(); l.expanded = !l.expanded; render(); } })
      : h('span', { class: 'arrow-space' });
    const clipMark = l.clip ? h('span', { class: 'clip-mark', title: 'Recortada por la capa de debajo' }, '↳') : null;
    const lt = layerThumb(l);
    const thumbWrap = h('span', { class: 'thumb-wrap' + (isActive && !d.editMask ? ' editing' : '') }, lt);
    if (l instanceof SmartLayer) thumbWrap.addEventListener('dblclick', e => { e.stopPropagation(); ops.editSmartContents(l); });
    thumbWrap.addEventListener('click', e => {
      if (e.ctrlKey || e.metaKey) { e.stopPropagation(); ops.selectionFromLayer(l); return; }
      if (isActive && d.editMask) { e.stopPropagation(); d.editMask = false; d.changed(); }
    });
    let maskEl: HTMLElement | null = null;
    if (l.mask) {
      maskEl = h('span', { class: 'thumb-wrap' + (isActive && d.editMask ? ' editing' : '') + (l.mask.enabled ? '' : ' disabled'), title: 'Máscara de capa (clic para editarla, Mayús+clic para desactivarla)' }, maskThumb(l));
      maskEl.addEventListener('click', e => {
        e.stopPropagation();
        if (e.shiftKey) { d.setActive(l, false); ops.toggleMask(); return; }
        d.setActive(l, false); d.editMask = true; d.changed();
      });
    }
    const name = h('span', { class: 'lname' }, l.name);
    name.addEventListener('dblclick', async e => {
      e.stopPropagation();
      const n = await promptDialog('Cambiar nombre de capa', 'Nombre', l.name);
      if (n !== null) ops.renameLayer(l, n);
    });
    const kindTag = l instanceof GroupLayer && l.artboard ? h('span', { class: 'ltag', title: 'Mesa de trabajo' }, '▭') : l instanceof TextLayer ? h('span', { class: 'ltag', title: 'Capa de texto' }, 'T') : l instanceof ShapeLayer ? h('span', { class: 'ltag', title: 'Forma vectorial' }, '◇') : l instanceof SmartLayer ? h('span', { class: 'ltag', title: 'Objeto inteligente (doble clic en la miniatura para editar su contenido)' }, '▣') : null;
    const fx = hasStyles(l.styles) ? h('span', { class: 'ltag fx', title: 'Tiene estilos de capa (doble clic para editarlos)' }, 'fx') : null;
    fx?.addEventListener('dblclick', e => { e.stopPropagation(); app.doc!.setActive(l); layerStyleDialog(); });
    const lock = l.locked ? h('span', { class: 'llock', html: icon('lock') }) : l.lockPos || l.lockPixels ? h('span', { class: 'llock', title: [l.lockPixels && 'Píxeles bloqueados', l.lockPos && 'Posición bloqueada'].filter(Boolean).join(' · '), html: icon('lock') }) : l.lockAlpha ? h('span', { class: 'llock', title: 'Transparencia bloqueada', html: icon('lockAlpha') }) : null;
    const linkEl = l.link != null ? h('span', { class: 'llock llink', title: 'Vinculada (se mueve con las otras capas vinculadas). Clic: seleccionarlas', html: icon('link') }) : null;
    linkEl?.addEventListener('click', e => { e.stopPropagation(); d.setActive(l); ops.selectLinkedLayers(); });
    if (l.label) eye.style.background = LABEL_COLORS[l.label] ?? '';
    // miniatura de la máscara vectorial
    let vmEl: HTMLElement | null = null;
    if (l.vmask) {
      const vm = l.vmask, sig = JSON.stringify(vm);
      const c = thumb(vm, hashStr(sig), (ctx, w, hh) => { ctx.fillStyle = vm.invert ? '#fff' : '#9a9a9a'; ctx.fillRect(0, 0, w, hh); ctx.scale(w / d.width, hh / d.height); ctx.fillStyle = vm.invert ? '#9a9a9a' : '#fff'; ctx.beginPath(); for (const sp of vm.subpaths) tracePath(ctx, sp.pts, true); ctx.fill('evenodd'); }, 'thumb mask');
      vmEl = h('span', { class: 'thumb-wrap' + (vm.enabled ? '' : ' disabled'), title: 'Máscara vectorial (edítala con la Selección directa, A; Mayús+clic para desactivarla)' }, c);
      vmEl.addEventListener('click', e => { e.stopPropagation(); d.setActive(l); if (e.shiftKey) ops.vectorMaskOp('toggle'); else { d.activePath = -1; app.setTool('node'); } });
    }
    const el = h('div', {
      class: 'layer-row' + (isActive ? ' active' : selected ? ' selected' : '') + (l.isVisibleInTree() ? '' : ' hidden-layer'),
      draggable: 'true', style: { paddingLeft: 4 + depth * 14 + 'px' },
    }, eye, arrow, clipMark, thumbWrap, maskEl, vmEl, name, kindTag, fx, linkEl, lock);
    el.addEventListener('click', e => {
      if (e.ctrlKey || e.metaKey) {
        if (d.selectedIds.has(l.id) && d.selectedIds.size > 1) d.selectedIds.delete(l.id); else d.selectedIds.add(l.id);
        d.active = l; d.changed(); return;
      }
      if (e.shiftKey && d.active) {
        const all = d.allLayers();
        const a = all.indexOf(d.active), b = all.indexOf(l);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const ids = new Set(all.slice(lo, hi + 1).filter(x => x.parent === l.parent).map(x => x.id));
        d.active = l; d.selectedIds = ids; d.changed(); return;
      }
      const wasMask = d.active === l && d.editMask;
      d.setActive(l, false);
      d.editMask = wasMask && !!l.mask;
      d.changed();
    });
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (!d.selectedIds.has(l.id)) d.setActive(l);
      contextMenu(e.clientX, e.clientY, ['dupLayer', 'delLayer', 'renameLayer', '-', 'label:rojo', 'label:naranja', 'label:amarillo', 'label:verde', 'label:azul', 'label:violeta', 'label:gris', 'label:none', '-', 'layerStyle', 'clearStyle', 'clip', '-', 'toSmart', 'editSmart', 'rasterize', '-', 'group', 'ungroup', '-', 'mergeDown', 'mergeVisible', 'flatten']);
    });
    el.addEventListener('dblclick', e => { if ((e.target as HTMLElement).closest('.lname, .thumb-wrap, .eye, .arrow')) return; d.setActive(l); layerStyleDialog(); });
    // Arrastrar para reordenar
    el.addEventListener('dragstart', e => { dragLayer = l; e.dataTransfer!.effectAllowed = 'move'; e.dataTransfer!.setData('text/plain', String(l.id)); });
    el.addEventListener('dragend', () => { dragLayer = null; list.querySelectorAll('.drop-above,.drop-below,.drop-into').forEach(x => x.classList.remove('drop-above', 'drop-below', 'drop-into')); });
    el.addEventListener('dragover', e => {
      if (!dragLayer || dragLayer === l) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      el.classList.remove('drop-above', 'drop-below', 'drop-into');
      el.classList.add(l instanceof GroupLayer && y > .3 && y < .7 ? 'drop-into' : y < .5 ? 'drop-above' : 'drop-below');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-above', 'drop-below', 'drop-into'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      const src = dragLayer; if (!src || src === l) return;
      const into = el.classList.contains('drop-into'), above = el.classList.contains('drop-above');
      el.classList.remove('drop-above', 'drop-below', 'drop-into');
      if (into && l instanceof GroupLayer) ops.moveLayerTo(src, l, l.children.length);
      else {
        const p = l.parent!; const i = p.children.indexOf(l);
        // La lista se muestra de arriba abajo; "encima" = índice mayor
        ops.moveLayerTo(src, p, above ? i + 1 : i);
      }
    });
    const rows: HTMLElement[] = [el];
    if (l instanceof GroupLayer && l.expanded) for (let i = l.children.length - 1; i >= 0; i--) rows.push(...row(l.children[i], depth + 1));
    return rows;
  };

  const render = () => {
    const d = app.doc;
    list.innerHTML = '';
    body.classList.toggle('disabled', !d);
    if (!d) return;
    const rows: HTMLElement[] = [];
    const q = search.value.trim().toLowerCase();
    if (q) { // búsqueda: lista plana de las capas que coinciden
      for (const l of [...d.allLayers()].reverse()) if (l.name.toLowerCase().includes(q)) rows.push(row(l, 0)[0]);
      if (!rows.length) rows.push(h('div', { class: 'hint ch-empty' }, 'Ninguna capa coincide'));
    } else for (let i = d.root.children.length - 1; i >= 0; i--) rows.push(...row(d.root.children[i], 0));
    list.append(...rows);
    const l = d.active;
    blend.value = l?.blendMode ?? 'source-over';
    if (!opacityChanging) opacity.set(Math.round((l?.opacity ?? 1) * 100));
    if (!fillChanging) fillSl.set(Math.round((l?.fillOpacity ?? 1) * 100));
    lockBtn.classList.toggle('on', !!l?.locked);
    lockA.classList.toggle('on', !!l?.lockAlpha);
    lockPx.classList.toggle('on', !!l?.lockPixels);
    lockPs.classList.toggle('on', !!l?.lockPos);
  };
  app.on('doc', render); app.on('docs', render);
  render();
}

// ---- Historial ---------------------------------------------------------------------

export function buildHistoryPanel(parent: HTMLElement) {
  const list = h('div', { class: 'history-list' });
  const foot = h('div', { class: 'panel-foot' }, h('button', { class: 'btn', title: 'Guarda el estado actual para poder volver a él', onclick: () => ops.newSnapshot() }, 'Nueva instantánea'));
  const body = h('div', { class: 'panel-body history-body' }, list, foot);
  const sec = panel('Historial', body);
  parent.append(sec);
  let lastLen = -1;
  const render = () => {
    const d = app.doc;
    list.innerHTML = '';
    if (!d) return;
    const hst = d.history;
    d.snapshots.forEach((s, i) => {
      const el = h('div', { class: 'history-row snap' }, h('span', { class: 'snap-ico' }, '▣'), s.name);
      el.title = 'Clic para volver a este estado';
      el.onclick = () => ops.gotoSnapshot(i);
      list.append(el);
    });
    if (d.snapshots.length) list.append(h('div', { class: 'info-sep' }));
    hst.steps.forEach((s, i) => {
      const el = h('div', { class: 'history-row' + (i === hst.index ? ' active' : '') + (i > hst.index ? ' future' : '') }, s.name);
      el.onclick = () => ops.gotoHistory(i);
      list.append(el);
    });
    if (hst.steps.length !== lastLen) { list.scrollTop = list.scrollHeight; lastLen = hst.steps.length; }
  };
  app.on('doc', render); app.on('docs', render);
  render();
  return sec;
}

// ---- Propiedades ---------------------------------------------------------------------

let lastAdjId = -1;
export function buildPropertiesPanel(parent: HTMLElement) {
  const body = h('div', { class: 'panel-body props' });
  parent.append(panel('Propiedades', body, undefined, 'panel-props'));
  let lastKey = '';
  let skipRender = false;
  const render = () => {
    const d = app.doc;
    const l = d?.active;
    const key = d ? `${d.width}x${d.height}|${d.ppi}|${d.mode}|${app.showRulers}${app.showGrid}${app.showGuides}|${l?.id}|${l?.kind}|${!!l?.mask}|${d.editMask}|${isParametric(l) ? JSON.stringify(l.props) : ''}${l instanceof SmartLayer ? l.inner.width + 'x' + l.inner.height + JSON.stringify(l.filters) : ''}${l instanceof AdjustmentLayer ? l.filterId + JSON.stringify(l.params) : ''}` : '';
    if (skipRender) { skipRender = false; lastKey = key; return; }
    if (key === lastKey && body.contains(document.activeElement)) return;
    lastKey = key;
    body.innerHTML = '';
    if (!d) { body.append(h('div', { class: 'hint' }, 'Abre o crea un documento.')); return; }
    // Lienzo: ancho y alto editables (crece o se recorta desde el centro), resolución, modo y vista
    const dim = (v: number, set: (n: number) => void, title: string) => { const i = h('input', { type: 'number', class: 'num', value: v, min: 1, max: 30000, title, style: 'width:72px' }) as HTMLInputElement; i.addEventListener('change', () => { const n = Math.round(+i.value); if (n >= 1 && n <= 30000) set(n); else i.value = String(v); }); return i; };
    const setSize = (w: number, hh: number) => { if (w === d.width && hh === d.height) return; d.resizeCanvas(w, hh, Math.round((w - d.width) / 2), Math.round((hh - d.height) / 2)); d.commit('Tamaño de lienzo'); app.viewport.fit(true); };
    const ppi = h('input', { type: 'number', class: 'num', value: d.ppi || 72, min: 1, max: 10000, style: 'width:72px', title: 'Resolución (píxeles por pulgada); no cambia los píxeles' }) as HTMLInputElement;
    ppi.addEventListener('change', () => { const n = +ppi.value; if (n >= 1) { d.ppi = n; d.commit('Resolución'); } });
    const mode = h('select', {}, h('option', { value: 'rgb', selected: d.mode !== 'gray' }, 'Color RGB'), h('option', { value: 'gray', selected: d.mode === 'gray' }, 'Escala de grises')) as HTMLSelectElement;
    mode.addEventListener('change', () => ops.setColorMode(mode.value as any));
    const viewCheck = (label: string, id: string, on: boolean) => { const c = h('input', { type: 'checkbox', checked: on }) as HTMLInputElement; c.addEventListener('change', () => actionById.get(id)!.run()); return h('label', { class: 'check' }, c, ' ' + label); };
    body.append(h('div', { class: 'prop-title' }, 'Documento'),
      h('div', { class: 'prop-row' }, h('span', {}, 'Lienzo'), h('span', { class: 'prop-dims' }, 'An ', dim(d.width, w => setSize(w, d.height), 'Ancho del lienzo (px)'), ' Al ', dim(d.height, hh => setSize(d.width, hh), 'Alto del lienzo (px)'), ' px')),
      h('div', { class: 'prop-row' }, h('span', {}, 'Resolución'), h('span', {}, ppi, ' ppp')),
      h('div', { class: 'prop-row' }, h('span', {}, 'Modo'), mode),
      h('div', { class: 'prop-row prop-checks' }, viewCheck('Reglas', 'rulers', app.showRulers), viewCheck('Cuadrícula', 'grid', app.showGrid), viewCheck('Guías', 'guides', app.showGuides)),
      h('div', { class: 'prop-btns' },
        h('button', { class: 'btn', onclick: () => actionById.get('imageSize')!.run() }, 'Tamaño de imagen'),
        h('button', { class: 'btn', onclick: () => actionById.get('canvasSize')!.run() }, 'Tamaño de lienzo')));
    if (!l) return;
    const kind = l instanceof GroupLayer && l.artboard ? 'Mesa de trabajo' : l instanceof AdjustmentLayer ? (FILTER_BY_ID.get(l.filterId)?.fill ? 'Capa de relleno' : 'Capa de ajuste') : l instanceof GroupLayer ? 'Grupo' : l instanceof TextLayer ? 'Capa de texto' : l instanceof ShapeLayer ? 'Forma vectorial' : l instanceof SmartLayer ? 'Objeto inteligente' : 'Capa de píxeles';
    body.append(h('div', { class: 'prop-title' }, kind + (d.editMask ? ' · editando máscara' : '')));
    if (l instanceof GroupLayer && l.artboard) {
      const a = l.artboard;
      const num = (v: number, set: (v: number) => void) => { const i = h('input', { type: 'number', class: 'num', value: String(Math.round(v)) }); i.onchange = () => { set(Math.round(+i.value || 0)); fitBoards(); d.commit('Mesa de trabajo'); }; return i; };
      // si la mesa se sale del lienzo, el lienzo crece (sin mover nada)
      const fitBoards = () => { a.w = Math.max(1, a.w); a.h = Math.max(1, a.h); const dx = Math.max(0, -a.x), dy = Math.max(0, -a.y); const W = Math.max(d.width + dx, a.x + dx + a.w), H = Math.max(d.height + dy, a.y + dy + a.h); if (W !== d.width || H !== d.height || dx || dy) d.resizeCanvas(W, H, dx, dy); d.invalidate(); };
      const bg = h('select', {}, h('option', { value: '#ffffff' }, 'Blanco'), h('option', { value: '#000000' }, 'Negro'), h('option', { value: '' }, 'Transparente'), h('option', { value: 'custom' }, 'Otro…'));
      bg.value = a.bg === '#ffffff' || a.bg === '#000000' ? a.bg : a.bg ? 'custom' : '';
      const col = h('input', { type: 'color', class: 'color-input', value: a.bg ?? '#ffffff' });
      col.style.display = bg.value === 'custom' ? '' : 'none';
      bg.onchange = () => { col.style.display = bg.value === 'custom' ? '' : 'none'; a.bg = bg.value === 'custom' ? col.value : bg.value || null; d.invalidate(); d.commit('Fondo de la mesa de trabajo'); };
      col.onchange = () => { a.bg = col.value; d.invalidate(); d.commit('Fondo de la mesa de trabajo'); };
      body.append(
        h('div', { class: 'prop-row' }, h('span', {}, 'X'), num(a.x, v => a.x = v), h('span', {}, 'Y'), num(a.y, v => a.y = v)),
        h('div', { class: 'prop-row' }, h('span', {}, 'An'), num(a.w, v => a.w = v), h('span', {}, 'Al'), num(a.h, v => a.h = v)),
        h('div', { class: 'prop-row' }, h('span', {}, 'Fondo'), bg, col));
    }
    if (l instanceof TextLayer) {
      const p = l.props;
      const upd = (fn: () => void) => { fn(); l.render(); d.commit('Editar texto'); };
      const num = (v: number, set: (v: number) => void) => { const i = h('input', { type: 'number', class: 'num', value: String(v) }); i.onchange = () => upd(() => set(+i.value || 0)); return i; };
      const chk = (label: string, v: boolean, set: (v: boolean) => void) => { const c = h('input', { type: 'checkbox', checked: v }); c.onchange = () => upd(() => set(c.checked)); return h('label', { class: 'check' }, c, ' ' + label); };
      const ta = h('textarea', { class: 'prop-text', rows: 3 }, p.text);
      ta.addEventListener('change', () => upd(() => { p.text = ta.value; l.name = ta.value.split('\n')[0].slice(0, 30) || l.name; }));
      const font = fontPicker(p.font, f => upd(() => p.font = f));
      const size = h('input', { type: 'number', class: 'num', value: String(Math.round(p.size)), min: '1', max: '2000' });
      size.onchange = () => upd(() => p.size = Math.max(1, +size.value));
      const color = h('input', { type: 'color', value: p.color, class: 'color-input' });
      color.onchange = () => upd(() => p.color = color.value);
      const bold = h('input', { type: 'checkbox', checked: p.bold }); bold.onchange = () => upd(() => p.bold = bold.checked);
      const italic = h('input', { type: 'checkbox', checked: p.italic }); italic.onchange = () => upd(() => p.italic = italic.checked);
      const align = h('select', {}, h('option', { value: 'left' }, 'Izquierda'), h('option', { value: 'center' }, 'Centro'), h('option', { value: 'right' }, 'Derecha'));
      align.value = p.align; align.onchange = () => upd(() => p.align = align.value as any);
      const warpBtn = h('button', { class: 'btn', onclick: () => warpTextDialog(l) }, p.warp ? `Deformar texto (${WARP_STYLES[p.warp.style] ?? ''})…` : 'Deformar texto…');
      body.append(ta,
        h('div', { class: 'prop-row' }, h('span', {}, 'Fuente'), font),
        h('div', { class: 'prop-row' }, h('span', {}, 'Tamaño'), size, h('span', {}, 'Color'), color),
        h('div', { class: 'prop-row' }, h('label', { class: 'check' }, bold, ' Negrita'), h('label', { class: 'check' }, italic, ' Cursiva'), align),
        h('div', { class: 'prop-row' }, h('span', {}, 'Interletraje'), num(p.tracking ?? 0, v => p.tracking = v), h('span', {}, 'Interl.'), num(Math.round(p.lineHeight * 100), v => p.lineHeight = Math.max(0.3, v / 100)), h('span', { class: 'hint' }, '%')),
        h('div', { class: 'prop-row' }, chk('Subrayado', !!p.underline, v => p.underline = v), chk('Tachado', !!p.strike, v => p.strike = v), chk('MAYÚS', !!p.caps, v => p.caps = v)),
        h('div', { class: 'prop-row' }, h('span', {}, 'Caja'), num(Math.round(p.boxWidth ?? 0), v => p.boxWidth = v > 0 ? v : undefined), h('span', { class: 'hint' }, 'px de ancho (0 = texto de punto)')));
      body.append(h('div', { class: 'prop-btns' }, warpBtn));
      const vert = h('input', { type: 'checkbox', checked: !!p.vertical }); vert.onchange = () => upd(() => { p.vertical = vert.checked; if (vert.checked) delete p.onPath; });
      body.append(h('label', { class: 'check' }, vert, ' Texto vertical'));
      if (p.onPath) {
        const op = p.onPath;
        body.append(formRow('Inicio en el trazado', numberSlider({ min: 0, max: 100, value: op.offset ?? 0, unit: '%', onInput: v => { op.offset = v; l.render(); d.invalidate(); app.viewport.requestRender(); clearTimeout((op as any)._t); (op as any)._t = window.setTimeout(() => { delete (op as any)._t; d.commit('Texto sobre trazado'); }, 400); } }).el));
        const flip = h('input', { type: 'checkbox', checked: !!op.flip }); flip.onchange = () => upd(() => { op.flip = flip.checked; });
        body.append(h('label', { class: 'check' }, flip, ' Al otro lado del trazado'), h('div', { class: 'prop-btns' }, h('button', { class: 'btn', onclick: () => upd(() => { delete p.onPath; }) }, 'Quitar del trazado')));
      }
      if (p.runs?.length) body.append(h('div', { class: 'hint' }, 'Este texto tiene partes con otro estilo. Para cambiar solo una parte, edítalo y selecciónala antes de cambiar el color, la fuente o el tamaño.'), h('div', { class: 'prop-btns' }, h('button', { class: 'btn', onclick: () => upd(() => { delete p.runs; }) }, 'Quitar estilos parciales')));
    }
    if (l instanceof AdjustmentLayer) {
      const def = FILTERS.find(f => f.id === l.filterId);
      let timer = 0;
      // Cambios en vivo; se anota un solo paso de historial al terminar de ajustar
      const changed = () => { d.invalidate(); app.viewport.requestRender(); clearTimeout(timer); timer = window.setTimeout(() => { skipRender = true; d.commit('Editar ajuste'); }, 500); };
      // barra como la de Photoshop: predefinidos, recortar a la capa de debajo, ver sin el ajuste, restablecer, ocultar y eliminar
      if (def) {
        const apply = (params: any, name: string) => { l.params = JSON.parse(JSON.stringify({ ...defaultParams(def), ...params })); d.invalidate(); d.commit(name); };
        const pre = h('select', { class: 'adj-preset', title: 'Ajustes predefinidos' }) as HTMLSelectElement;
        const builtin = BUILTIN_PRESETS[def.id] ?? [], mine = userPresets(def.id);
        pre.append(h('option', { value: '' }, 'Predefinido…'));
        if (builtin.length) pre.append(h('optgroup', { label: 'De serie' }, ...builtin.map((p, i) => h('option', { value: 'b' + i }, p.name))));
        if (mine.length) pre.append(h('optgroup', { label: 'Míos' }, ...mine.map((p, i) => h('option', { value: 'u' + i }, p.name))));
        pre.append(h('option', { value: 'save' }, '＋ Guardar los valores actuales…'));
        if (mine.length) pre.append(h('option', { value: 'del' }, 'Borrar uno de los míos…'));
        pre.onchange = async () => {
          const v = pre.value; pre.value = '';
          if (v === 'save') { const n = (await promptDialog('Guardar ajuste predefinido', 'Nombre', ''))?.trim(); if (n) { saveUserPresets(def.id, [...userPresets(def.id), { name: n, params: JSON.parse(JSON.stringify(l.params)) }]); app.toast('Guardado: también aparece al usar este ajuste desde el menú'); skipRender = false; app.emit('doc'); } return; }
          if (v === 'del') { const m = userPresets(def.id), n = await promptDialog('Borrar ajuste predefinido', 'Nombre exacto (' + m.map(x => x.name).join(', ') + ')', ''); const i = m.findIndex(x => x.name === n); if (i >= 0) { m.splice(i, 1); saveUserPresets(def.id, m); app.emit('doc'); } return; }
          const p = v[0] === 'b' ? builtin[+v.slice(1)] : mine[+v.slice(1)]; if (p) apply(p.params, 'Ajuste: ' + p.name);
        };
        const ib = (ic: string, title: string, on: boolean | null, fn: () => void) => { const b = h('button', { class: 'btn icon-btn adj-tb' + (on ? ' on' : ''), type: 'button', title, html: icon(ic) || '' }); b.onclick = fn; return b; };
        const peek = ib('eye', 'Ver sin el ajuste (mantén pulsado)', null, () => {});
        const hide = () => { l.visible = false; d.invalidate(); app.viewport.requestRender(); }, show = () => { if (!l.visible) { l.visible = true; d.invalidate(); app.viewport.requestRender(); } };
        peek.dataset.hold = '1'; peek.addEventListener('pointerdown', e => { e.preventDefault(); hide(); }); for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) peek.addEventListener(ev, show);
        body.append(h('div', { class: 'adj-bar' }, pre,
          ib('clip', 'Recortar a la capa de debajo (solo la afecta a ella)', !!l.clip, () => ops.toggleClip()),
          peek,
          ib('reset', 'Restablecer los valores por defecto', null, () => apply({}, 'Restablecer ajuste')),
          ib('trash', 'Eliminar esta capa de ajuste', null, () => actionById.get('delLayer')?.run())));
        if (l.clip) body.append(h('div', { class: 'hint' }, 'Solo afecta a la capa de debajo.'));
        // al elegir otra capa de ajuste, el panel baja hasta sus controles (lo de arriba es el documento)
        const bar = body.querySelector('.adj-bar') as HTMLElement | null;
        if (bar && lastAdjId !== l.id) {
          lastAdjId = l.id;
          // solo se desplaza el propio panel (scrollIntoView movería también los contenedores de la barra lateral)
          requestAnimationFrame(() => {
            let sc = bar.parentElement; while (sc && !(/(auto|scroll)/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight)) sc = sc.parentElement;
            if (sc && !sc.classList.contains('side')) sc.scrollTop += bar.getBoundingClientRect().top - sc.getBoundingClientRect().top - 6;
          });
        }
      }
      if (def?.custom) {
        const below = getPixels(d.getComposite());
        body.append(...(def.custom === 'levels' ? levelsBody : curvesBody)(below, l.params, changed));
      }
      const conds: [HTMLElement, [string, string]][] = [];
      const syncShow = () => conds.forEach(([r, [k, v]]) => r.style.display = l.params[k] === v ? '' : 'none');
      if (!def?.custom) for (const pd of def?.params ?? []) {
        if (pd.type === 'checkbox') {
          const c = h('input', { type: 'checkbox', checked: !!l.params[pd.key] });
          c.onchange = () => { l.params[pd.key] = c.checked; changed(); };
          body.append(h('label', { class: 'check' }, c, ' ' + pd.label));
        } else if (pd.type === 'color') {
          const c = h('input', { type: 'color', class: 'color-input', value: l.params[pd.key] });
          c.oninput = () => { l.params[pd.key] = c.value; changed(); };
          body.append(formRow(pd.label, c));
        } else if (pd.type === 'pattern') {
          body.append(formRow(pd.label, patternSelect(l.params[pd.key], v => { l.params[pd.key] = v; changed(); })));
        } else if (pd.type === 'gradient') {
          body.append(formRow(pd.label, gradientButton(l.params[pd.key] ?? [{ t: 0, color: l.params.c1 ?? '#000000', a: 1 }, { t: 1, color: l.params.c2 ?? '#ffffff', a: 1 }], s => { l.params[pd.key] = s; changed(); })));
        } else if (pd.type === 'wheel') {
          const w = gradeWheel(pd.label, l.params[pd.key] ?? pd.default, v => { l.params[pd.key] = [...v]; changed(); }, 76);
          const last = body.lastElementChild; if (last?.classList.contains('gw-row')) last.append(w); else body.append(h('div', { class: 'gw-row' }, w));
        } else if (pd.type === 'lut') {
          body.append(formRow(pd.label, lutPicker(l.params, changed)));
        } else if (pd.type === 'select') {
          const sel = h('select', {}, ...pd.choices.map(([v, n]) => h('option', { value: v, selected: l.params[pd.key] === v }, n)));
          sel.onchange = () => { l.params[pd.key] = sel.value; syncShow(); changed(); };
          body.append(formRow(pd.label, sel));
        } else if (pd.type === 'range') {
          const r = formRow(pd.label, numberSlider({ min: pd.min, max: pd.max, step: pd.step, value: l.params[pd.key], unit: pd.unit, onInput: v => { l.params[pd.key] = v; changed(); } }).el);
          if (pd.showIf) conds.push([r, pd.showIf]);
          body.append(r);
        }
      }
      syncShow();
      if (def && !def.custom && !def.params) body.append(h('div', { class: 'hint' }, 'Este ajuste no tiene opciones.'));
    }
    if (l instanceof SmartLayer) {
      const m = l.props.m, sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
      body.append(
        h('div', { class: 'prop-row' }, h('span', {}, 'Original'), h('b', {}, `${l.inner.width} × ${l.inner.height} px`)),
        h('div', { class: 'prop-row' }, h('span', {}, 'Escala'), h('b', {}, `${Math.round(sx * 100)} % × ${Math.round(sy * 100)} %`), h('span', {}, 'Giro'), h('b', {}, `${Math.round(Math.atan2(m[1], m[0]) * 180 / Math.PI)}°`)),
        h('div', { class: 'prop-btns' },
          h('button', { class: 'btn primary', onclick: () => ops.editSmartContents(l) }, 'Editar contenido'),
          h('button', { class: 'btn', onclick: () => ops.rasterize() }, 'Rasterizar')),
        h('div', { class: 'hint' }, 'Se puede escalar y girar las veces que quieras sin perder calidad. Los filtros que le apliques quedan como filtros inteligentes.'));
      if (l.filters.length) {
        body.append(h('div', { class: 'prop-title' }, 'Filtros inteligentes'));
        l.filters.forEach((f, i) => {
          const def = FILTERS.find(x => x.id === f.id);
          const on = h('input', { type: 'checkbox', checked: f.enabled, title: 'Mostrar u ocultar' }); on.onchange = () => ops.toggleSmartFilter(l, i);
          const name = h('span', { class: 'sf-name', title: def?.params || def?.custom ? 'Doble clic para editar' : '' }, (def?.name ?? f.id).replace('…', ''));
          if (def && (def.params || def.custom)) name.ondblclick = () => filterDialog(def, { layer: l, index: i });
          const edit = h('button', { class: 'btn icon-btn', title: 'Editar', disabled: !(def?.params || def?.custom), html: icon('edit') }); edit.onclick = () => def && filterDialog(def, { layer: l, index: i });
          const del = h('button', { class: 'btn icon-btn', title: 'Eliminar', html: icon('trash') }); del.onclick = () => ops.removeSmartFilter(l, i);
          body.append(h('div', { class: 'prop-row sf-row' }, on, name, edit, del));
        });
      }
    }
    if (l instanceof ShapeLayer) {
      const p = l.props;
      const upd = (fn: () => void) => { fn(); l.render(); d.commit('Editar forma'); };
      const colorRow = (label: string, key: 'fill' | 'stroke') => {
        const on = h('input', { type: 'checkbox', checked: !!p[key] });
        const col = h('input', { type: 'color', class: 'color-input', value: p[key] ?? '#000000' });
        on.onchange = () => upd(() => p[key] = on.checked ? col.value : null);
        col.onchange = () => upd(() => p[key] = col.value);
        return h('div', { class: 'prop-row' }, h('label', { class: 'check' }, on, ' ' + label), col);
      };
      const numF = (label: string, get: () => number, set: (v: number) => void) => {
        const i = h('input', { type: 'number', class: 'num', value: String(Math.round(get())) });
        i.onchange = () => upd(() => set(+i.value || 0));
        return [h('span', {}, label), i];
      };
      const x = () => Math.min(p.x0, p.x1), y = () => Math.min(p.y0, p.y1), w = () => Math.abs(p.x1 - p.x0), hh = () => Math.abs(p.y1 - p.y0);
      const setBox = (nx: number, ny: number, nw: number, nh: number) => { p.x0 = nx; p.y0 = ny; p.x1 = nx + Math.max(1, nw); p.y1 = ny + Math.max(1, nh); };
      if (p.shape !== 'line') body.append(colorRow('Relleno', 'fill'));
      body.append(colorRow('Trazo', 'stroke'),
        h('div', { class: 'prop-row' }, ...numF('Grosor', () => p.strokeWidth, v => p.strokeWidth = Math.max(1, v)), ...(p.shape === 'round' ? numF('Radio', () => p.radius, v => p.radius = Math.max(0, v)) : ['polygon', 'star', 'arrow'].includes(p.shape) ? numF('Redondear', () => p.corner ?? 0, v => p.corner = Math.max(0, v)) : [])));
      { const ds = h('select', {}, ...[['solid', 'Continua'], ['dash', 'Discontinua'], ['dot', 'Punteada'], ['dashdot', 'Raya y punto']].map(([v, t]) => h('option', { value: v }, t))) as HTMLSelectElement;
        ds.value = p.dash ?? 'solid'; ds.onchange = () => upd(() => p.dash = ds.value as any);
        body.append(h('div', { class: 'prop-row' }, h('span', {}, 'Línea'), ds)); }
      if (p.shape === 'path') body.append(h('div', { class: 'hint' }, 'Trazado de pluma: usa la herramienta Selección directa (A) para mover sus puntos.'));
      if (p.shape !== 'line' && p.shape !== 'path') body.append(
        h('div', { class: 'prop-row' }, ...numF('X', x, v => setBox(v, y(), w(), hh())), ...numF('Y', y, v => setBox(x(), v, w(), hh()))),
        h('div', { class: 'prop-row' }, ...numF('Ancho', w, v => setBox(x(), y(), v, hh())), ...numF('Alto', hh, v => setBox(x(), y(), w(), v))));
    }
    if (l.mask) {
      body.append(h('div', { class: 'prop-title' }, 'Máscara de capa'),
        h('div', { class: 'prop-btns' },
          h('button', { class: 'btn' + (d.editMask ? ' on' : ''), onclick: () => { d.editMask = !d.editMask; d.changed(); } }, d.editMask ? 'Editando máscara' : 'Editar máscara'),
          h('button', { class: 'btn', onclick: () => ops.toggleMask() }, l.mask.enabled ? 'Desactivar' : 'Activar'),
          h('button', { class: 'btn', onclick: () => ops.invertMask(l) }, 'Invertir'),
          h('button', { class: 'btn', onclick: () => ops.deleteMask(true) }, 'Aplicar'),
          h('button', { class: 'btn', onclick: () => ops.deleteMask(false) }, 'Eliminar')),
        h('div', { class: 'hint' }, 'Pinta en negro para ocultar y en blanco para mostrar.'));
    } else {
      body.append(h('div', { class: 'prop-btns' }, h('button', { class: 'btn', onclick: () => ops.addMask('reveal') }, 'Añadir máscara'), h('button', { class: 'btn', title: 'Detecta el sujeto y oculta el fondo con una máscara', onclick: () => ops.removeBackground() }, 'Quitar fondo')));
    }
  };
  app.on('doc', render); app.on('docs', render);
  render();
}

void renderComposite;
