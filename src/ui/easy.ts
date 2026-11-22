// Para que cualquiera pueda usar Editor sin saber de programas de imagen:
// · Buscador «¿Qué quieres hacer?» (Ctrl+K): encuentra cualquier función, herramienta o filtro con palabras normales.
// · Tareas rápidas: botones grandes para lo más habitual (mejorar foto, quitar fondo, recortar para redes…).
// · Descripción de cada herramienta en una frase.
// · Guía de primera visita.

import { app } from './app';
import { h } from './dom';
import { icon } from './icons';
import { ACTIONS, actionById } from './actions';
import { menuPaths } from './menus';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ');

import { TOOL_DESC } from './tooldesc';
export { TOOL_DESC };

// ---- Palabras con las que la gente busca las cosas -----------------------------------------------------
const SYN: Record<string, string> = {
  removeBg: 'quitar fondo borrar fondo eliminar fondo recortar persona sin fondo transparente png',
  selectSubject: 'seleccionar persona objeto sujeto principal', selectSky: 'cielo', skyReplace: 'cambiar cielo poner nubes atardecer',
  'filter:gblur': 'desenfocar difuminar borroso blur', 'filter:huesat': 'saturacion colores mas vivos tono', 'filter:bw': 'blanco y negro gris sin color monocromo',
  'filter:curves': 'brillo contraste luz', 'filter:brightness': 'brillo contraste mas claro mas oscuro iluminar', 'filter:levels': 'niveles luz contraste',
  'filter:develop': 'revelar camera raw exposicion temperatura nitidez mejorar foto', 'filter:unsharp': 'enfocar nitidez detalle', 'filter:denoise': 'quitar ruido grano',
  imageSize: 'cambiar tamaño redimensionar escalar resolucion pixeles reducir ampliar', canvasSize: 'lienzo agrandar margen borde',
  'rot90': 'girar rotar', imgRot90: 'girar rotar imagen 90', imgFlipH: 'voltear espejo reflejar', autoStraighten: 'enderezar torcida horizonte nivelar',
  export: 'guardar como jpg png webp pdf descargar exportar', save: 'guardar proyecto', social: 'instagram facebook youtube tiktok redes historia tamaño',
  contentFill: 'rellenar según contenido borrar objeto eliminar', castShadow: 'sombra proyectada suelo realista', extrude3d: '3d volumen relieve texto 3d',
  palette: 'colores paleta extraer', contrast: 'legible accesibilidad contraste texto', compare: 'antes despues comparar original',
  timelapse: 'video proceso historial gif', layerStyle: 'sombra borde trazo resplandor efecto estilo bisel', newLayer: 'capa nueva', undo: 'deshacer volver atras',
  liquify: 'licuar adelgazar deformar cara', variations: 'colores variaciones tono', focusStack: 'enfoque apilar macro',
  filterGallery: 'efectos artisticos acuarela dibujo lapiz', 'filter:pencilsketch': 'dibujo lapiz boceto', 'filter:watercolor': 'acuarela pintura',
  cropSel: 'recortar seleccion', trim: 'recortar bordes', 'filter:vignette': 'viñeta bordes oscuros',
};
type Entry = { id: string; label: string; path: string; kind: 'action' | 'tool'; hay: string; run: () => void; enabled: () => boolean; keys?: string };
function entries(): Entry[] {
  const paths = menuPaths(), out: Entry[] = [];
  for (const a of ACTIONS) {
    const path = paths.get(a.id) ?? '';
    if (!path && !SYN[a.id]) continue; // acciones internas sin sitio en los menús
    out.push({ id: a.id, label: a.label.replace(/…$/, ''), path, kind: 'action', hay: norm(`${a.label} ${path} ${SYN[a.id] ?? ''}`), run: a.run, enabled: () => (a.enabled ? a.enabled() : true), keys: a.keys?.[0] });
  }
  for (const t of app.tools.values()) {
    if (['transform', 'puppet', 'warp'].includes(t.id)) continue;
    out.push({ id: 'tool:' + t.id, label: t.name, path: 'Herramienta' + (TOOL_DESC[t.id] ? ' · ' + TOOL_DESC[t.id] : ''), kind: 'tool', hay: norm(`${t.name} herramienta ${TOOL_DESC[t.id] ?? ''}`), run: () => app.setTool(t.id), enabled: () => !!app.doc, keys: t.key });
  }
  return out;
}
export function searchEntries(q: string, list = entries()): Entry[] {
  const words = norm(q).split(' ').filter(Boolean); if (!words.length) return [];
  const scored: [number, Entry][] = [];
  for (const e of list) {
    const tokens = e.hay.split(' ');
    let s = 0, ok = true;
    for (const w of words) {
      const exact = tokens.some(t => t === w), pre = tokens.some(t => t.startsWith(w)), sub = e.hay.includes(w);
      if (!pre && !sub) { ok = false; break; }
      s += exact ? 3 : pre ? 2 : 1;
    }
    if (!ok) continue;
    const L = norm(e.label);
    const nq = norm(q).trim();
    if (L.trim() === nq) s += 8; else if (L.startsWith(nq)) s += 4; else if (L.includes(words[0])) s += 2;
    if (e.kind === 'action' && !e.path.startsWith('Filtro')) s += 0.5;
    scored.push([s, e]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map(x => x[1]).slice(0, 30);
}

// ---- Buscador --------------------------------------------------------------------------------------------
let openEl: HTMLElement | null = null;
export function openSearch() {
  if (openEl) { (openEl.querySelector('input') as HTMLInputElement)?.focus(); return; }
  const list = entries();
  const input = h('input', { type: 'search', class: 'cmd-input', placeholder: '¿Qué quieres hacer? (p. ej.: quitar fondo, girar, blanco y negro…)', autocomplete: 'off', enterkeyhint: 'go' }) as HTMLInputElement;
  const res = h('div', { class: 'cmd-results', role: 'listbox' });
  const tips = h('div', { class: 'cmd-tips' }, ...['quitar fondo', 'mejorar foto', 'recortar', 'texto', 'blanco y negro', 'desenfocar', 'tamaño', 'sombra'].map(t => { const b = h('button', { class: 'chip', type: 'button' }, t); b.onclick = () => { input.value = t; render(); input.focus(); }; return b; }));
  const box = h('div', { class: 'cmd-box' }, h('div', { class: 'cmd-top' }, h('span', { class: 'cmd-ico', html: icon('search') }), input, h('button', { class: 'btn icon-btn', type: 'button', title: 'Cerrar (Esc)', html: icon('close'), onclick: () => close() })), tips, res);
  const overlay = h('div', { class: 'cmd-overlay' }, box);
  overlay.addEventListener('pointerdown', e => { if (e.target === overlay) close(); });
  let items: Entry[] = [], sel = 0;
  const run = (e: Entry) => { if (!e.enabled()) { app.toast(app.doc ? 'Ahora no se puede: elige antes una capa o una selección adecuada' : 'Abre o crea antes una imagen', 'warn'); return; } close(); setTimeout(() => e.run(), 0); };
  const render = () => {
    items = input.value.trim() ? searchEntries(input.value, list) : QUICK.map(q => list.find(e => e.id === q)!).filter(Boolean);
    sel = 0; res.innerHTML = '';
    if (!items.length) res.append(h('div', { class: 'cmd-empty' }, 'No encuentro nada con esas palabras. Prueba con otras (por ejemplo «borrar» en vez de «eliminar»).'));
    items.forEach((e, i) => {
      const row = h('div', { class: 'cmd-item' + (i === sel ? ' on' : '') + (e.enabled() ? '' : ' off'), role: 'option' },
        h('span', { class: 'cmd-label' }, e.label), h('span', { class: 'cmd-path' }, e.path), e.keys ? h('kbd', {}, e.keys) : null);
      row.onclick = () => run(e); row.onpointerenter = () => { sel = i; mark(); };
      res.append(row);
    });
    tips.style.display = input.value.trim() ? 'none' : '';
  };
  const mark = () => [...res.children].forEach((c, i) => c.classList.toggle('on', i === sel));
  input.addEventListener('input', render);
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); mark(); res.children[sel]?.scrollIntoView({ block: 'nearest' }); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); mark(); res.children[sel]?.scrollIntoView({ block: 'nearest' }); e.preventDefault(); }
    else if (e.key === 'Enter') { if (items[sel]) run(items[sel]); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  const close = () => { overlay.remove(); openEl = null; };
  document.body.append(overlay); openEl = overlay;
  render(); setTimeout(() => input.focus(), 30);
}
/** Lo que se ofrece antes de escribir nada. */
const QUICK = ['open', 'new', 'removeBg', 'filter:develop', 'social', 'export', 'tool:text', 'tool:crop', 'tool:remove', 'imageSize'];

// ---- Tareas rápidas ----------------------------------------------------------------------------------------
type Task = { label: string; ic: string; desc: string; run: () => void | Promise<void>; needDoc?: boolean };
const act = (id: string) => () => actionById.get(id)?.run();
const tool = (id: string, hint: string) => () => { app.setTool(id); app.toast(hint); };
export const TASKS: Task[] = [
  { label: 'Abrir una foto', ic: 'folder', desc: 'Desde tu equipo o el móvil', run: act('open') },
  { label: 'Mejorar la foto', ic: 'magic', desc: 'Luz y color automáticos', needDoc: true, run: () => autoEnhance() },
  { label: 'Quitar el fondo', ic: 'removeBg', desc: 'Deja solo a la persona u objeto', needDoc: true, run: act('removeBg') },
  { label: 'Borrar algo', ic: 'remove', desc: 'Pinta encima y desaparece', needDoc: true, run: tool('remove', 'Pinta sobre lo que quieras borrar y suelta') },
  { label: 'Recortar', ic: 'crop', desc: 'Encuadra o cambia la proporción', needDoc: true, run: tool('crop', 'Arrastra los bordes del marco y pulsa ✓ (o Intro)') },
  { label: 'Para redes', ic: 'share', desc: 'Instagram, historias, YouTube…', needDoc: true, run: act('social') },
  { label: 'Añadir texto', ic: 'text', desc: 'Toca donde quieras escribir', needDoc: true, run: tool('text', 'Toca o haz clic donde quieras escribir') },
  { label: 'Desenfocar el fondo', ic: 'drop', desc: 'Efecto retrato', needDoc: true, run: () => blurBackground() },
  { label: 'Blanco y negro', ic: 'contrast', desc: 'Con ajuste de cada color', needDoc: true, run: act('filter:bw') },
  { label: 'Enderezar', ic: 'ruler', desc: 'Si la foto salió torcida', needDoc: true, run: act('autoStraighten') },
  { label: 'Cambiar el cielo', ic: 'cloud', desc: 'Atardecer, nubes, noche…', needDoc: true, run: act('skyReplace') },
  { label: 'Efectos artísticos', ic: 'brush', desc: 'Acuarela, lápiz, óleo…', needDoc: true, run: act('filterGallery') },
  { label: 'Cambiar el tamaño', ic: 'resize', desc: 'Más pequeña o más grande', needDoc: true, run: act('imageSize') },
  { label: 'Guardar / descargar', ic: 'download', desc: 'JPG, PNG, PDF…', needDoc: true, run: act('export') },
];
export function quickTasks() {
  const grid = h('div', { class: 'qt-grid' });
  const overlay = h('div', { class: 'cmd-overlay' });
  const close = () => overlay.remove();
  for (const t of TASKS) {
    const b = h('button', { class: 'qt-item', type: 'button' }, h('span', { class: 'qt-ico', html: icon(t.ic) || icon('magic') }), h('b', {}, t.label), h('span', { class: 'qt-desc' }, t.desc));
    if (t.needDoc && !app.doc) b.classList.add('off');
    b.onclick = () => { if (t.needDoc && !app.doc) { app.toast('Abre antes una foto («Abrir una foto»)', 'warn'); return; } close(); setTimeout(() => t.run(), 0); };
    grid.append(b);
  }
  const box = h('div', { class: 'cmd-box qt-box' }, h('div', { class: 'cmd-top' }, h('b', { class: 'qt-title' }, '¿Qué quieres hacer?'), h('button', { class: 'btn', type: 'button', onclick: () => { close(); openSearch(); } }, 'Buscar otra cosa…'), h('button', { class: 'btn icon-btn', type: 'button', title: 'Cerrar', html: icon('close'), onclick: close })), grid);
  overlay.append(box); overlay.addEventListener('pointerdown', e => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.body.append(overlay);
}
/** Mejora automática: tono, color y un poco de intensidad, en un solo paso. */
export async function autoEnhance() {
  const d = app.doc; if (!d) return;
  const { FILTERS } = await import('../filters/registry'); const ops = await import('./ops');
  const l = d.activeRaster(); if (!l) { app.toast('Elige una capa de imagen', 'warn'); return; }
  const n0 = d.history.index;
  for (const id of ['autotone', 'autocolor']) await ops.applyFilterDirect(FILTERS.find(f => f.id === id)!);
  const vib = FILTERS.find(f => f.id === 'vibrance'); if (vib) await ops.applyFilterDirect(vib, { vibrance: 20, sat: 0 });
  // los pasos quedan como uno solo
  const hs = d.history; if (hs.index > n0 + 1) { const last = hs.steps[hs.index]; hs.steps.splice(n0 + 1, hs.index - n0); hs.steps.splice(n0 + 1, 0, { ...last, name: 'Mejorar la foto' }); hs.index = n0 + 1; app.emit('doc'); }
  app.toast('Foto mejorada. Usa Vista › Comparar antes/después para verlo (o Ctrl+Z para deshacer)');
}
/** Efecto retrato: el sujeto queda nítido y el fondo se desenfoca, en una capa aparte. */
export async function blurBackground() {
  const d = app.doc; if (!d) return;
  const ops = await import('./ops'), { FILTERS } = await import('../filters/registry');
  if (!d.activeRaster()) { app.toast('Elige una capa de imagen', 'warn'); return; }
  app.toast('Buscando a la persona u objeto…');
  await ops.selectSubjectOp();
  if (!d.selection.mask) { app.toast('No encuentro un sujeto claro', 'warn'); return; }
  d.selection.invert(); d.selection.feather(4);
  await ops.applyFilterDirect(FILTERS.find(f => f.id === 'gblur')!, { radius: Math.max(6, Math.round(Math.min(d.width, d.height) / 90)) });
  d.selection.clear(); d.invalidate(); d.commit('Desenfocar el fondo');
}

// ---- Guía de primera visita -----------------------------------------------------------------------------
const TOUR_KEY = 'editor.tourDone';
let tourShown = false;
export function maybeTour() { if (tourShown) return; try { if (localStorage.getItem(TOUR_KEY)) return; } catch { return; } tourShown = true; setTimeout(startTour, 600); }
export function startTour() {
  const narrow = window.innerWidth <= 700;
  const steps: [string, string, string][] = [
    ['.toolbar', 'Herramientas', 'Aquí están las herramientas: pincel, borrar, recortar, texto… Mantén pulsado (o clic derecho) un botón con triángulo para ver más.'],
    ['.top-quick', 'Tareas rápidas', 'Lo más habitual en un toque: mejorar la foto, quitar el fondo, recortar para redes, añadir texto…'],
    ['.top-search', 'Buscar', 'Si no sabes dónde está algo, búscalo con tus palabras: «quitar fondo», «girar», «más brillo»…'],
    [narrow ? '.side-toggle' : '.side', 'Paneles', narrow ? 'Capas, colores, historial… Toca aquí o desliza el dedo desde el borde derecho.' : 'Capas, colores, propiedades e historial. Cada pestaña es un panel.'],
  ];
  let i = 0;
  const bubble = h('div', { class: 'tour-bubble' }), ring = h('div', { class: 'tour-ring' }), shade = h('div', { class: 'tour-shade' });
  const end = () => { bubble.remove(); ring.remove(); shade.remove(); try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* */ } };
  const show = () => {
    const [sel, title, text] = steps[i], el = document.querySelector(sel) as HTMLElement | null;
    if (!el || el.getBoundingClientRect().width === 0) { if (++i < steps.length) show(); else end(); return; }
    const r = el.getBoundingClientRect();
    Object.assign(ring.style, { left: r.left - 4 + 'px', top: r.top - 4 + 'px', width: r.width + 8 + 'px', height: Math.min(r.height, window.innerHeight - r.top - 8) + 8 + 'px' });
    bubble.innerHTML = '';
    bubble.append(h('b', {}, `${title} (${i + 1}/${steps.length})`), h('p', {}, text),
      h('div', { class: 'tour-btns' }, h('button', { class: 'btn', type: 'button', onclick: end }, 'Saltar'), h('button', { class: 'btn primary', type: 'button', onclick: () => { if (++i < steps.length) show(); else end(); } }, i < steps.length - 1 ? 'Siguiente' : 'Entendido')));
    // la burbuja al lado del elemento, sin salirse de la pantalla
    const bw = Math.min(300, window.innerWidth - 24);
    let left = r.right + 12, top = r.top;
    if (left + bw > window.innerWidth - 8) left = Math.max(12, r.left - bw - 12);
    if (left < 12 || r.width > window.innerWidth * 0.6) { left = Math.max(12, Math.min(window.innerWidth - bw - 12, r.left + r.width / 2 - bw / 2)); top = r.bottom + 12; }
    if (top + 170 > window.innerHeight) top = Math.max(12, r.top - 180);
    Object.assign(bubble.style, { left: left + 'px', top: Math.max(12, Math.min(top, window.innerHeight - 190)) + 'px', width: bw + 'px' });
  };
  document.body.append(shade, ring, bubble); show();
  // tocar en cualquier otro sitio cierra la guía (no bloquea nada)
  setTimeout(() => document.addEventListener('pointerdown', function out(e) { if (!bubble.contains(e.target as Node)) { end(); document.removeEventListener('pointerdown', out, true); } }, true), 0);
}
