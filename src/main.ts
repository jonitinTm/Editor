import { contentBounds } from './core/canvas';
import './core/polyfills';
import { prefs, applyPrefs, fmtUnit } from './ui/prefs';
applyPrefs();
import { startI18n, LANGS, lang, langChosen, keepLang, browserLang, setLang } from './i18n/i18n';
startI18n();
// Punto de entrada: monta la interfaz y conecta teclado, arrastrar y pegar.

import './styles.css';
import { app } from './ui/app';
import { h } from './ui/dom';
import { icon } from './ui/icons';
import { Viewport, isTyping } from './ui/viewport';
import { buildSideSliders, buildPenChip } from './ui/drawing';
import { buildQuickButton } from './ui/quickbtn';
import { projectsStrip } from './ui/projects';
import { installTouchTips } from './ui/touchtips';
import { History } from './core/history';
import { buildMenuBar } from './ui/menus';
import { buildToolbar } from './ui/toolbar';
import { buildOptionsBar } from './ui/optionsbar';
import { buildLayersPanel, buildHistoryPanel, buildPropertiesPanel, buildColorPanel, buildSwatchesPanel } from './ui/panels';
import { ACTIONS, loadDialogs } from './ui/actions';
import { lazyModule } from './ui/lazy';
import { setSmartFilterRedraw } from './core/layers';
import * as ops from './ui/ops';
import { buildAdjustmentsPanel } from './ui/adjpanel';
import { dialogOpen } from './ui/dialog';
import { recentGrid } from './ui/widgets';
const newDocumentDialog = () => { import('./ui/dialogs').then(m => m.newDocumentDialog()); };
import { keyString } from './ui/keys';
import * as io from './io/files';
const uniq = lazyModule(() => import('./ui/unique'));
import * as more from './ui/more';
const cr = lazyModule(() => import('./ui/create'));
import * as easy from './ui/easy';
import { PerspectiveWarpTool } from './tools/perspwarp';
import { VanishingTool } from './ui/more3';
import { AISelectTool } from './ai/aitools';
import { buildTimeline } from './ui/timeline';
import { buildNavigatorPanel, buildHistogramPanel, buildInfoPanel, buildChannelsPanel, buildPathsPanel, buildCompsPanel, buildStylesPanel, buildActionsPanel } from './ui/panels2';
(app as any).debug = { filters: () => import('./filters/registry').then(async r => { await r.loadFilterImpls(); return r; }), lut: () => Promise.all([import('./core/adjlut'), import('./core/compositor')]), psd: () => import('./io/psd'), icc: () => import('./io/icc'), projects: () => import('./io/projects'), readPsd: async (...a: Parameters<typeof import('./io/psd').readPsd>) => (await import('./io/psd')).readPsd(...a), writePsd: async (...a: Parameters<typeof import('./io/psd').writePsd>) => (await import('./io/psd')).writePsd(...a), ops, io, uniq, more, cr, actions: ACTIONS, contentBounds };
(app as any).debug.rawdev = () => import('./ui/rawdev');
(app as any).debug.textures = () => import('./ui/textures');
(app as any).debug.gamedev = () => import('./ui/gamedev');
(app as any).debug.pixelart = () => import('./ui/pixelart');
(app as any).debug.gif = () => import('./io/gif');
(app as any).debug.layers = () => import('./core/layers');
io.setDeviceLimitNotice((ow, oh, w, h) => app.toast(`La imagen (${ow} × ${oh}) es más grande de lo que este dispositivo puede editar; se ha abierto a ${w} × ${h}`, 'warn')); // para pruebas automáticas

import { MoveTool } from './tools/move';
import { RectSelectTool, EllipseSelectTool, LassoTool, PolyLassoTool, WandTool, SingleRowSelectTool, SingleColSelectTool } from './tools/select';
import { retouchTools } from './tools/retouch';
import { QuickSelectTool, ObjectSelectTool } from './tools/quicksel';
import { CropTool, PerspectiveCropTool, SliceTool, ArtboardTool } from './tools/crop';
import { BrushTool, PencilTool, EraserTool, CloneTool, HealTool, SpotHealTool, PatternStampTool, MixerBrushTool, RemoveTool } from './tools/brush';
import { BucketTool, GradientTool, EyedropperTool, HandTool, ZoomTool, RotateViewTool, LassoFillTool } from './tools/misc';
import { TextTool, TypeMaskTool, VerticalTextTool, VerticalTypeMaskTool } from './tools/text';
import { ShapeTool, FrameTool } from './tools/shape';
import { TransformTool } from './tools/transform';
import { PenTool, NodeTool, FreeformPenTool } from './tools/pen';
import { AddAnchorTool, DeleteAnchorTool, ConvertPointTool, PathSelectTool, CurvaturePenTool } from './tools/pathtools';
import { MagneticLassoTool } from './tools/maglasso';
import { HistoryBrushTool, ArtHistoryBrushTool } from './tools/brush';
import { PuppetTool } from './tools/puppet';
import { PixelTool } from './tools/pixel';
import { PatchTool, ContentMoveTool } from './tools/patch';
import { buildCharacterPanel, buildParagraphPanel } from './ui/textpanels';
import { ColorSamplerTool, CountTool, NoteTool } from './tools/extra';
import { ColorReplaceTool, MagicEraserTool, BackgroundEraserTool, RedEyeTool, RulerTool } from './tools/extra';
import { buildBrushesPanel } from './ui/brushes';
import { TextLayer } from './core/layers';

// ---- Herramientas ----------------------------------------------------------------
for (const T of [MoveTool, RectSelectTool, EllipseSelectTool, LassoTool, QuickSelectTool, WandTool, CropTool, EyedropperTool, CloneTool,
  BrushTool, PencilTool, EraserTool, GradientTool, BucketTool, LassoFillTool, TextTool, PenTool, NodeTool, ShapeTool, HandTool, RotateViewTool, ZoomTool, TransformTool]) {
  app.registerTool(new T());
}
app.registerTool(new PixelTool());
// barra de paleta del pixel art (aparece con el pincel de píxeles o en un documento de pixel art)
setTimeout(() => import('./ui/anim').then(m => m.initAnim()).then(() => import('./ui/pixelart')).then(m => m.initPixelBar()), 0);
app.registerTool(new PolyLassoTool());
app.registerTool(new MagneticLassoTool());
app.registerTool(new SpotHealTool());
app.registerTool(new HealTool());
for (const t of retouchTools()) app.registerTool(t);
// Las herramientas añadidas después van al final: la tecla de cada grupo sigue eligiendo la de siempre
for (const T of [MagicEraserTool, BackgroundEraserTool, RedEyeTool, RulerTool, HistoryBrushTool, ColorReplaceTool, PuppetTool, PatchTool, ContentMoveTool, PerspectiveCropTool, PatternStampTool, ColorSamplerTool, SliceTool, FreeformPenTool, MixerBrushTool, FrameTool, RemoveTool, ObjectSelectTool, CurvaturePenTool, AddAnchorTool, DeleteAnchorTool, ConvertPointTool, PathSelectTool, SingleRowSelectTool, SingleColSelectTool, TypeMaskTool, CountTool, VerticalTextTool, VerticalTypeMaskTool, NoteTool, ArtHistoryBrushTool, ArtboardTool, PerspectiveWarpTool]) app.registerTool(new T());
app.registerTool(new VanishingTool() as any);
app.registerTool(new AISelectTool());

// ---- Estructura de la página ----------------------------------------------------------
const root = document.getElementById('app')!;
const header = h('header', { class: 'topbar' }, h('span', { class: 'logo', html: icon('logo') }, h('span', {}, 'Photocap')));
root.append(header);
// en el móvil, un solo botón «Menú» que abre la hoja con todas las categorías (la barra de menús no cabe)
const menuBtn = h('button', { class: 'top-btn top-menu', type: 'button', title: 'Menú: archivo, edición, imagen, capa, filtros…', 'aria-label': 'Menú', html: icon('menu') + '<span>Menú</span>' });
menuBtn.onclick = () => import('./ui/mobilemenu').then(m => m.openMobileMenu());
header.append(menuBtn);
buildMenuBar(header);
// En el móvil los paneles van en un cajón que se abre con este botón
const sideToggle = h('button', { class: 'side-toggle', title: 'Mostrar u ocultar los paneles (capas, color, propiedades…)', html: icon('newLayer') + '<span>Paneles</span>' });
sideToggle.onclick = () => { document.body.classList.toggle('show-side'); };
// botones fáciles: tareas rápidas y buscador (siempre a mano, también en el móvil)
const quickBtn = h('button', { class: 'top-btn top-quick', type: 'button', title: 'Tareas rápidas: mejorar foto, quitar fondo, recortar para redes…', html: icon('magic') + '<span>Tareas</span>' });
quickBtn.onclick = () => easy.quickTasks();
const searchBtn = h('button', { class: 'top-btn top-search', type: 'button', title: '¿Qué quieres hacer? Busca cualquier función (Ctrl+F)', html: icon('search') + '<span>Buscar</span>' });
searchBtn.onclick = () => easy.openSearch();
// deshacer y rehacer siempre a la vista (en el móvil no hay teclado para Ctrl+Z)
const undoBtn = h('button', { class: 'top-btn top-undo', type: 'button', title: 'Deshacer (Ctrl+Z)', 'aria-label': 'Deshacer', html: icon('undo') }) as HTMLButtonElement;
const redoBtn = h('button', { class: 'top-btn top-redo', type: 'button', title: 'Rehacer (Mayús+Ctrl+Z)', 'aria-label': 'Rehacer', html: icon('redo') }) as HTMLButtonElement;
undoBtn.onclick = () => ops.undo(); redoBtn.onclick = () => ops.redo();
const upUndo = () => { const hi = app.doc?.history; undoBtn.disabled = !hi?.canUndo(); redoBtn.disabled = !hi?.canRedo(); };
app.on('doc', upUndo); app.on('docs', upUndo); upUndo();
// idioma siempre a mano: un globo con el código del idioma; al tocarlo, la lista con cada idioma en su propio idioma
const langBtn = h('button', { class: 'top-btn top-lang no-i18n', type: 'button', title: 'Idioma / Language', 'aria-label': 'Idioma / Language', html: icon('globe') + `<span>${lang.toUpperCase()}</span>` });
langBtn.onclick = e => {
  e.stopPropagation();
  document.querySelector('.lang-fly')?.remove();
  const fly = h('div', { class: 'flyout lang-fly no-i18n' }, ...LANGS.map(([v, n]) => {
    const it = h('div', { class: 'fly-item' + (v === lang ? ' on' : '') }, (v === lang ? '✓ ' : '\u2003 ') + n);
    it.onclick = () => { fly.remove(); import('./ui/dialogs').then(m => m.changeLanguage(v)); };
    return it;
  }));
  const r = langBtn.getBoundingClientRect(); document.body.append(fly);
  fly.style.top = r.bottom + 4 + 'px'; fly.style.left = Math.max(8, Math.min(innerWidth - fly.offsetWidth - 8, r.right - fly.offsetWidth)) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', function close(ev) { if (!fly.contains(ev.target as Node)) { fly.remove(); document.removeEventListener('pointerdown', close); } }), 0);
};
header.append(h('div', { class: 'top-right' }, langBtn, undoBtn, redoBtn, quickBtn, searchBtn, sideToggle));
// fondo oscuro detrás del cajón: tocarlo lo cierra
const sideBackdrop = h('div', { class: 'side-backdrop' });
sideBackdrop.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); document.body.classList.remove('show-side'); });
document.body.append(sideBackdrop);
buildOptionsBar(root);
const main = h('div', { class: 'main' });
root.append(main);
buildToolbar(main);
const center = h('div', { class: 'center' });
const tabs = h('div', { class: 'tabs' });
center.append(tabs);
main.append(center);
const viewHost = h('div', { class: 'view-host' });
center.append(viewHost);
app.viewport = new Viewport(viewHost);
buildSideSliders(viewHost);
buildQuickButton(viewHost);
buildPenChip(viewHost);
installTouchTips();
History.onTrim = () => app.toast('Imagen grande: se guardan menos pasos de deshacer para que todo siga fluido');
const welcome = buildWelcome();
viewHost.append(welcome);
if (!langChosen()) askLanguage();
const timeline = buildTimeline(center);
const status = h('div', { class: 'statusbar' });
center.append(status);
const side = h('aside', { class: 'side' });
main.append(side);
// tocar el lienzo cierra el cajón de paneles en el móvil
viewHost.addEventListener('pointerdown', () => document.body.classList.remove('show-side'));
const sideTop = h('div', { class: 'side-top' });
const sideBottom = h('div', { class: 'side-bottom' });
side.append(sideTop, h('div', { class: 'splitter', title: 'Arrastra para cambiar el tamaño' }), sideBottom);
/** Grupo de paneles con pestañas, como en los editores profesionales. */
function tabGroup(parent: HTMLElement, id: string, tabs: [string, (el: HTMLElement) => void][]) {
  const head = h('div', { class: 'tg-tabs' }), group = h('div', { class: 'tab-group', 'data-group': id }, head);
  const pages: HTMLElement[] = [];
  tabs.forEach(([title, build], i) => {
    const page = h('div', { class: 'tg-page' + (i ? '' : ' on') }); build(page); pages.push(page); group.append(page);
    const b = h('button', { class: 'tg-tab' + (i ? '' : ' on') }, title);
    b.onclick = () => { pages.forEach((p, j) => p.classList.toggle('on', j === i)); [...head.children].forEach((c, j) => c.classList.toggle('on', j === i)); };
    head.append(b);
  });
  (group as any).select = (i: number) => (head.children[i] as HTMLElement)?.click();
  parent.append(group);
  return group;
}
tabGroup(sideTop, 'color', [['Color', buildColorPanel], ['Ajustes', buildAdjustmentsPanel], ['Muestras', buildSwatchesPanel], ['Pinceles', buildBrushesPanel], ['Estilos', buildStylesPanel]]);
tabGroup(sideTop, 'props', [['Propiedades', buildPropertiesPanel], ['Historial', buildHistoryPanel], ['Navegador', buildNavigatorPanel], ['Histograma', buildHistogramPanel], ['Info', buildInfoPanel], ['Carácter', buildCharacterPanel], ['Párrafo', buildParagraphPanel]]);
tabGroup(sideBottom, 'layers', [['Capas', buildLayersPanel], ['Canales', buildChannelsPanel], ['Trazados', buildPathsPanel], ['Composiciones', buildCompsPanel], ['Acciones', buildActionsPanel]]);

// ---- Paneles en el móvil: una fila de botones grandes arriba del cajón y un solo panel a pantalla completa ----
{
  const ENTRIES: [string, string, number, string][] = [
    ['Capas', 'layers', 0, 'layers'], ['Color', 'color', 0, 'colorPanel'], ['Propiedades', 'props', 0, 'props'], ['Historial', 'props', 1, 'history'],
    ['Ajustes', 'color', 1, 'contrast'], ['Muestras', 'color', 2, 'swatches'], ['Pinceles', 'color', 3, 'brush'], ['Estilos', 'color', 4, 'fx'], ['Carácter', 'props', 5, 'text'], ['Párrafo', 'props', 6, 'text'],
    ['Canales', 'layers', 1, 'channels'], ['Trazados', 'layers', 2, 'pen'], ['Navegador', 'props', 2, 'zoom'], ['Histograma', 'props', 3, 'histogram'], ['Info', 'props', 4, 'info'],
    ['Composiciones', 'layers', 3, 'comps'], ['Acciones', 'layers', 4, 'actions'],
  ];
  const nav = h('div', { class: 'side-nav', role: 'tablist', 'aria-label': 'Paneles' });
  const show = (k: number) => {
    const [, g, i] = ENTRIES[k];
    side.querySelectorAll<HTMLElement>('.tab-group').forEach(el => el.classList.toggle('m-on', el.dataset.group === g));
    (side.querySelector(`.tab-group[data-group="${g}"]`) as any)?.select(i);
    nav.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', j === k));
    try { localStorage.setItem('editor.mobilePanel', String(k)); } catch { /* */ }
  };
  ENTRIES.forEach(([label, , , ic], k) => { const b = h('button', { class: 'side-nav-btn', type: 'button', role: 'tab', html: (icon(ic) || '') + `<span>${label}</span>` }); b.onclick = () => show(k); nav.append(b); });
  side.prepend(nav);
  let first = 0; try { first = Math.max(0, Math.min(ENTRIES.length - 1, +(localStorage.getItem('editor.mobilePanel') ?? 0))); } catch { /* */ }
  show(first);
  // en el ordenador, todos los grupos se ven a la vez (la selección del móvil no afecta)
  // deslizar el dedo desde el borde derecho abre el cajón; hacia la derecha lo cierra
  let sx = -1, sy = 0;
  document.addEventListener('touchstart', e => { const t = e.touches[0]; if (window.innerWidth > 700 || !t) return; const open = document.body.classList.contains('show-side'); sx = (!open && t.clientX > window.innerWidth - 24) || (open && side.contains(e.target as Node)) ? t.clientX : -1; sy = t.clientY; }, { passive: true });
  document.addEventListener('touchend', e => {
    const t = e.changedTouches[0]; if (sx < 0 || !t) return; const dx = t.clientX - sx, dy = Math.abs(t.clientY - sy); sx = -1;
    if (dy > 60) return;
    if (dx < -50) document.body.classList.add('show-side'); else if (dx > 70 && !(document.activeElement instanceof HTMLInputElement)) document.body.classList.remove('show-side');
  }, { passive: true });
  // asa en el borde derecho: recuerda que ahí están las capas (tocarla también abre el cajón)
  const handle = h('button', { class: 'side-handle', type: 'button', 'aria-label': 'Abrir capas y paneles', title: 'Capas y paneles' });
  handle.onclick = () => document.body.classList.add('show-side');
  document.body.append(handle);
  // la primera vez en el móvil se explica el gesto
  const HINT = 'editor.swipeHint';
  let hintTries = 0;
  const showHint = () => {
    // si la guía de bienvenida está abierta, se espera a que termine (ella misma lo explica en su último paso)
    // (la guía de gestos del móvil también lo explica; si aún va a salir, se espera a ella)
    let tourPending = false; try { tourPending = matchMedia('(pointer: coarse)').matches && !localStorage.getItem('editor.mobileTour'); } catch { /* */ }
    if (document.querySelector('.tour-bubble, .tt-overlay') || (tourPending && hintTries++ < 20)) { setTimeout(showHint, 1500); return; }
    try { if (localStorage.getItem(HINT) || window.innerWidth > 700 || navigator.webdriver) return; localStorage.setItem(HINT, '1'); } catch { return; }
    const bub = h('div', { class: 'swipe-hint', role: 'status' },
      h('div', { class: 'swipe-anim' }, h('span', { class: 'swipe-dot' }), h('span', { class: 'swipe-arrow' }, '←')),
      h('div', {}, h('b', {}, 'Capas y paneles'), h('div', {}, 'Desliza el dedo desde el borde derecho hacia la izquierda (o toca la pestaña del borde) para abrir las capas, el color y el resto de paneles. Desliza hacia la derecha para cerrarlos.')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => bub.remove() }, 'Entendido'));
    document.body.append(bub);
    const off = () => { if (document.body.classList.contains('show-side')) { bub.remove(); obs.disconnect(); } };
    const obs = new MutationObserver(off); obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  };
  (app as any).showSwipeHint = showHint;
  app.on('docs', () => { if (app.doc) setTimeout(showHint, 900); });
}
root.append(h('div', { id: 'toasts' }));
// app instalada: «Abrir con → Editor» desde el explorador de archivos del sistema
// archivos recibidos con «Compartir» de Android (los dejó el service worker): se abren al arrancar
if (new URLSearchParams(location.search).has('shared') && 'caches' in window) (async () => {
  try {
    const c = await caches.open('editor-shared'), files: File[] = [];
    for (const k of await c.keys()) { const r = await c.match(k); if (!r) continue; files.push(new File([await r.blob()], decodeURIComponent(r.headers.get('x-name') || 'archivo'), { type: r.headers.get('content-type') || '' })); await c.delete(k); }
    history.replaceState(null, '', location.pathname);
    if (files.length) ops.openFiles(files);
  } catch { /* sin caché */ }
})();
if ('launchQueue' in window) (window as any).launchQueue.setConsumer(async (p: any) => { if (p.files?.length) ops.openFiles(await Promise.all(p.files.map((f: any) => f.getFile()))); });

// Separador ajustable entre paneles
{
  const sp = side.querySelector('.splitter') as HTMLElement;
  sp.addEventListener('pointerdown', e => {
    sp.setPointerCapture(e.pointerId);
    const r = side.getBoundingClientRect();
    const mv = (ev: PointerEvent) => { const p = Math.min(80, Math.max(15, (ev.clientY - r.top) / r.height * 100)); sideTop.style.flexBasis = p + '%'; };
    const up = () => { sp.removeEventListener('pointermove', mv); sp.removeEventListener('pointerup', up); };
    sp.addEventListener('pointermove', mv); sp.addEventListener('pointerup', up);
  });
}

app.setTool('brush');
app.setTool('move');

/** Título de pestaña: nombre @ zoom (capa activa, modo). */
function tabTitle(d: NonNullable<typeof app.doc>) {
  const z = Math.round(d.view.zoom * 1000) / 10;
  return `${d.name}${d.modified ? ' *' : ''} @ ${String(z).replace('.', ',')} % (${d.active ? d.active.name + ', ' : ''}RGB/8)`;
}
// ---- Pestañas de documentos ----------------------------------------------------------
function renderTabs() {
  tabs.innerHTML = '';
  for (const d of app.docs) {
    const close = h('button', { class: 'tab-close', title: 'Cerrar', html: icon('close') });
    close.onclick = e => { e.stopPropagation(); ops.closeDocument(d); };
    const t = h('div', { class: 'tab' + (d === app.doc ? ' active' : ''), title: `${d.name} (${d.width} × ${d.height})` },
      h('span', {}, tabTitle(d)), close);
    t.onclick = () => { app.setDocument(d); ops.notifyToolDocChanged(); };
    t.addEventListener('auxclick', e => { if (e.button === 1) ops.closeDocument(d); });
    tabs.append(t);
  }
  tabs.append(h('button', { class: 'tab-new', title: 'Nuevo documento', html: icon('plus'), onclick: newDocumentDialog }));
  welcome.style.display = app.doc ? 'none' : '';
  if (app.doc && !app.doc.viewInitialized) requestAnimationFrame(() => app.viewport.resize());
}
app.on('docs', renderTabs);
// guía de primera visita, al abrir la primera imagen (no en navegadores automatizados de pruebas)
app.on('docs', () => { if (app.doc && !(navigator as any).webdriver) import('./ui/touchtour').then(m => { if (!m.maybeTouchTour()) easy.maybeTour(); }); });
app.on('doc', () => {
  // El indicador de "sin guardar" de la pestaña
  const t = tabs.querySelector('.tab.active span');
  if (t && app.doc) t.textContent = tabTitle(app.doc);
});
app.on('view', () => { const t = tabs.querySelector('.tab.active span'); if (t && app.doc) { const v = tabTitle(app.doc); if (t.textContent !== v) t.textContent = v; } });
renderTabs();

// ---- Barra de estado ------------------------------------------------------------------
// la barra se construye una vez y luego solo se cambia el texto que cambia (rehacerla en cada movimiento del
// ratón o del lápiz obligaba al navegador a recalcular la página y al traductor a revisar cada elemento)
let stParts: { zoom: HTMLInputElement; size: HTMLElement; pos: HTMLElement; sel: HTMLElement } | null = null;
const setText = (el: HTMLElement, t: string) => { if (el.textContent !== t) el.textContent = t; };
function renderStatus() {
  const d = app.doc;
  if (!d) { stParts = null; status.textContent = 'Arrastra una imagen aquí o usa Archivo › Abrir'; return; }
  if (!stParts || !status.contains(stParts.zoom)) {
    const zoom = h('input', { class: 'zoom-input' }) as HTMLInputElement;
    zoom.addEventListener('change', () => { const z = parseFloat(zoom.value); if (z > 0) app.viewport.setZoom(z / 100, null); });
    stParts = { zoom, size: h('span', {}), pos: h('span', { class: 'no-i18n' }), sel: h('span', { class: 'hint' }) };
    status.innerHTML = '';
    status.append(zoom, stParts.size, stParts.pos, h('span', { class: 'grow' }), stParts.sel);
  }
  const m = app.viewport.mouse, P = stParts, u = (v: number, ref: number) => fmtUnit(v, d.ppi || 72, ref);
  const zv = Math.round(d.view.zoom * 1000) / 10 + ' %'; if (P.zoom.value !== zv && document.activeElement !== P.zoom) P.zoom.value = zv;
  setText(P.size, prefs.units === 'px' ? `${d.width} × ${d.height} px` : `${u(d.width, d.width)} × ${u(d.height, d.height)}`);
  setText(P.pos, m ? (prefs.units === 'px' ? `X: ${Math.floor(m.x)}  Y: ${Math.floor(m.y)}` : `X: ${u(m.x, d.width)}  Y: ${u(m.y, d.height)}`) : '');
  const sb = d.selection.bounds;
  setText(P.sel, sb ? `Selección: ${prefs.units === 'px' ? `${sb.w} × ${sb.h}` : `${u(sb.w, d.width)} × ${u(sb.h, d.height)}`}` : '');
}
app.on('view', () => { if (document.activeElement?.classList.contains('zoom-input')) return; renderStatus(); });
app.on('doc', renderStatus); app.on('docs', renderStatus);
renderStatus();

// ---- Primera vez: la app sale en inglés y pregunta si se quiere otro idioma ----------------
function askLanguage() {
  const sug = browserLang();
  const close = () => { keepLang(); ov.remove(); };
  const choose = (l: string) => { if (l === lang) { close(); return; } ov.querySelectorAll('button').forEach(b => (b as HTMLButtonElement).disabled = true); setLang(l); };
  const btn = (l: string, n: string, cls = '') => h('button', { class: 'btn ' + cls, type: 'button', lang: l, onclick: () => choose(l) }, n);
  const others = LANGS.filter(([l]) => l !== 'en' && l !== sug);
  const box = h('div', { class: 'first-lang', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Language' },
    h('div', { class: 'fl-ico', html: icon('globe') }),
    h('h2', {}, 'Language'),
    h('p', {}, 'The app is in English. Do you want to use another language? You can change it at any time with the globe button at the top.'),
    h('div', { class: 'fl-main' }, btn('en', 'Keep English', 'primary'), sug && sug !== 'en' ? btn(sug, LANGS.find(x => x[0] === sug)![1], 'primary') : null),
    h('div', { class: 'fl-list' }, ...others.map(([l, n]) => btn(l, n))));
  const ov = h('div', { class: 'first-lang-ov no-i18n' }, box);
  ov.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.body.append(ov);
  (box.querySelector('.btn.primary') as HTMLElement)?.focus();
}

// ---- Pantalla de bienvenida ------------------------------------------------------------
/** Selector de idioma de la pantalla de inicio (con el nombre de cada idioma en su propio idioma). */
function langPicker() {
  const sel = h('select', { class: 'no-i18n', 'aria-label': 'Idioma / Language' }, ...LANGS.map(([v, n]) => h('option', { value: v, selected: lang === v }, n))) as HTMLSelectElement;
  sel.onchange = () => import('./ui/dialogs').then(m => m.changeLanguage(sel.value)).then(() => { sel.value = lang; });
  return h('label', { class: 'welcome-lang no-i18n' }, h('span', { html: icon('globe') }), sel);
}
function buildWelcome() {
  const openBtn = h('button', { class: 'btn primary big', html: icon('open') + '<span>Abrir desde el equipo</span>' });
  openBtn.onclick = async () => ops.openFiles(await io.pickFiles(io.OPEN_ACCEPT));
  const galBtn = h('button', { class: 'btn big welcome-gallery', html: icon('image') + '<span>Galería de fotos</span>' });
  galBtn.onclick = async () => ops.openFiles(await io.pickFiles('image/*'));
  const newBtn = h('button', { class: 'btn big', html: icon('plus') + '<span>Nuevo documento</span>' });
  newBtn.onclick = newDocumentDialog;
  const presets = h('div', { class: 'welcome-presets' }, ...[[1920, 1080], [1080, 1080], [1280, 720], [800, 600]].map(([w, hh]) =>
    h('button', { class: 'preset', onclick: () => ops.newDocument('Sin título', w, hh, '#ffffff') },
      h('span', { class: 'preset-shape', style: { aspectRatio: `${w}/${hh}` } }), `${w} × ${hh}`)));
  const recentBox = h('div', { class: 'recent-box' });
  const fillRecent = async () => {
    const { listRecent } = await import('./io/recent');
    const list = (await listRecent()).slice(0, 8);
    recentBox.innerHTML = '';
    if (!list.length) return;
    recentBox.append(h('div', { class: 'hint' }, 'Recientes:'), recentGrid(list));
  };
  fillRecent(); window.addEventListener('editor-recent', fillRecent);
  return h('div', { class: 'welcome' },
    h('div', { class: 'welcome-card' },
      h('div', { class: 'welcome-logo', html: icon('logo') }),
      h('h1', {}, 'Photocap'),
      h('p', {}, 'Editor de imágenes por capas. Todo se procesa en tu equipo: tus imágenes no salen de él.'),
      h('div', { class: 'welcome-actions' }, openBtn, galBtn, newBtn, h('button', { class: 'btn big', type: 'button', onclick: () => easy.quickTasks(), html: icon('magic') + ' ¿Qué quieres hacer?' })),
      h('div', { class: 'hint' }, 'Tamaños rápidos:'), presets,
      projectsStrip(),
      recentBox,
      langPicker(),
      h('div', { class: 'drop-hint' }, 'También puedes arrastrar aquí imágenes (PNG, JPG, WebP, GIF, TIFF…), PSD, RAW o proyectos .edp, o pegar con Ctrl+V.'),
      h('button', { class: 'link-btn', onclick: () => { import('./ui/tutorial').then(m => m.tutorialDialog()); } }, '¿Primera vez aquí? Mira el tutorial: cómo se hace cada cosa (F1)')));
}

// ---- Teclado -----------------------------------------------------------------------------

const keymap = new Map<string, (typeof ACTIONS)[number]>();
const buildKeymap = () => { keymap.clear(); for (const a of ACTIONS) for (const k of a.keys ?? []) keymap.set(k, a); };
buildKeymap();
window.addEventListener('editor-keys', buildKeymap);

/** Tecla de herramienta mantenida: al soltarla se vuelve a la herramienta anterior. */
let held: { key: string; prev: string; t: number } | null = null;
window.addEventListener('keyup', e => {
  if (!held || e.key.toUpperCase() !== held.key) return;
  const h0 = held; held = null;
  if (performance.now() - h0.t > 400 && app.tool.id !== h0.prev && !app.viewport.isSpaceDown() && !app.viewport.isBusy()) app.setTool(h0.prev);
});

let numBuf: { d: string; t: number; shift: boolean } | null = null;
window.addEventListener('keydown', e => {
  if (dialogOpen()) return;
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && !isTyping()) { e.preventDefault(); easy.openSearch(); return; }
  if (e.key === 'Alt') e.preventDefault(); // evita que el navegador active su menú
  const typing = isTyping();
  const ks = keyString(e);
  if (typing) {
    if (e.key === 'Escape') (document.activeElement as HTMLElement).blur();
    return;
  }
  // La herramienta activa tiene prioridad (Intro, Esc, flechas…)
  if (app.doc && app.tool?.key_?.(e)) { e.preventDefault(); return; }
  if (ks === 'Ctrl+V') return; // lo gestiona el evento "paste"
  if (ks === 'Shift+Ctrl+V' || ks === 'Alt+Shift+Ctrl+V') {
    // con algo copiado en el editor se pega ya; si no, se espera al evento "paste" del sistema
    const mode = ks === 'Shift+Ctrl+V' ? 'inPlace' : 'into';
    if (ops.hasFreshClipboard()) { e.preventDefault(); ops.pasteInternal(mode); } else ops.setPasteMode(mode);
    return;
  }
  const a = keymap.get(ks);
  if (a) {
    e.preventDefault();
    if (!a.enabled || a.enabled()) a.run();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.toUpperCase();
  if (e.key === 'Tab') { e.preventDefault(); document.body.classList.toggle('hide-panels'); requestAnimationFrame(() => app.viewport.resize()); return; }
  if (key === 'F' && !e.shiftKey) { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}); return; }
  if (/^Digit[0-9]$/.test(e.code) && app.doc) {
    // Teclas numéricas (como en Photoshop): opacidad de la herramienta de pintura o, si no la tiene, de la capa.
    // Dos cifras seguidas y rápidas = ese valor exacto («4» «5» = 45 %); «0» = 100 %, «0» «0» = 0 %.
    // Con Mayús, el flujo del pincel.
    const dgt = e.code.slice(5), now = performance.now();
    const two = numBuf && now - numBuf.t < 450 && numBuf.shift === e.shiftKey;
    let v = two ? +(numBuf!.d + dgt) : (dgt === '0' ? 100 : +dgt * 10);
    if (two && numBuf!.d === '0' && dgt === '0') v = 0;
    numBuf = two ? null : { d: dgt, t: now, shift: e.shiftKey };
    const key = e.shiftKey ? 'flow' : 'opacity';
    v = Math.max(key === 'flow' ? 1 : 0, Math.min(100, v));
    if (typeof app.opt(key, app.tool.id) === 'number') { app.setOpt(app.tool.id, key, Math.max(1, v)); app.toast((key === 'flow' ? 'Flujo' : 'Opacidad') + ': ' + Math.max(1, v) + ' %'); }
    else if (!e.shiftKey && app.doc.active) ops.setLayerProp(app.doc.active, 'opacity', v / 100);
    return;
  }
  if (key === 'D' && !e.shiftKey) { app.setColors('#000000', '#ffffff'); return; }
  if (key === 'X' && !e.shiftKey) { app.setColors(app.bg, app.fg); return; }
  // Mayús + [ / ]: dureza del pincel en pasos del 25 % (como en Photoshop)
  if (e.shiftKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
    const t = app.tool, hd = app.opt<number>('hardness', t.id);
    if (typeof hd === 'number') { const n = Math.max(0, Math.min(100, Math.round(hd / 25) * 25 + (e.code === 'BracketRight' ? 25 : -25))); app.setOpt(t.id, 'hardness', n); app.toast('Dureza: ' + n + ' %'); app.viewport.requestRender(); }
    return;
  }
  if (e.key === '[' || e.key === ']') {
    const t = app.tool; const s = app.opt<number>('size', t.id);
    if (typeof s === 'number') {
      const step = s < 10 ? 1 : s < 50 ? 5 : s < 200 ? 10 : 50;
      app.setOpt(t.id, 'size', Math.max(1, Math.min(1000, s + (e.key === ']' ? step : -step))));
      app.viewport.requestRender();
    }
    return;
  }
  if (e.key === 'Escape') { app.tool?.cancel?.(); return; }
  if (e.key === 'Enter' && app.tool?.id === 'text') return;
  // Letras de herramientas
  const tools = [...app.tools.values()].filter(t => t.key === key);
  if (tools.length) {
    e.preventDefault();
    if (e.repeat) return;
    held = { key, prev: app.tool.id, t: performance.now() };
    if (e.shiftKey && tools.length > 1) {
      let i = tools.findIndex(t => t.id === app.tool.id);
      if (i < 0) i = Math.max(0, tools.findIndex(t => t.id === app.groupChoice[t.group ?? '']));
      app.setTool(tools[(i + 1) % tools.length].id);
    } else {
      const g = tools[0].group;
      const pref = g ? app.groupChoice[g] : undefined;
      app.setTool(tools.some(t => t.id === app.tool.id) ? app.tool.id : (pref && tools.find(t => t.id === pref)?.id) || tools[0].id);
    }
  }
});

// ---- Pegar y arrastrar archivos ------------------------------------------------------------
document.addEventListener('paste', e => {
  if (isTyping() || dialogOpen()) return;
  e.preventDefault();
  ops.pasteFromEvent(e);
});

let dragDepth = 0;
const dropHint = h('div', { class: 'drop-overlay' }, h('div', {}, 'Suelta para abrir'));
document.body.append(dropHint);
window.addEventListener('dragenter', e => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; dropHint.classList.add('show'); dropHint.firstElementChild!.textContent = app.doc ? 'Suelta para añadir como capa (o sobre las pestañas para abrir aparte)' : 'Suelta para abrir'; } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropHint.classList.remove('show'); });
window.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault(); dragDepth = 0; dropHint.classList.remove('show');
  const onTabs = (e.target as HTMLElement).closest?.('.tabs');
  const files = [...e.dataTransfer.files];
  // los PSD soltados sobre un documento se colocan como objeto inteligente (sobre las pestañas: se abren aparte)
  const isDoc = (f: File) => io.isProjectFile(f) || io.isRawFile(f) || (io.isPsdFile(f) && (!app.doc || !!onTabs));
  const projects = files.filter(isDoc), images = files.filter(f => !isDoc(f));
  if (projects.length) ops.openFiles(projects);
  if (images.length) ops.openFiles(images, !!app.doc && !onTabs);
});

window.addEventListener('beforeunload', e => {
  if (app.docs.some(d => d.modified)) { e.preventDefault(); e.returnValue = ''; }
});

// En la web (https) se registra un service worker para poder usar Editor sin conexión
if ((location.protocol === 'https:' || location.hostname === 'localhost') && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

// ---- Guardado automático y recuperación ---------------------------------------------------
import('./io/autosave').then(async ({ autosave, listSaved, restoreSaved, removeSaved }) => {
  setInterval(() => { if (prefs.autosave) autosave(app.docs); }, 15000);
  document.addEventListener('visibilitychange', () => { if (document.hidden && prefs.autosave) autosave(app.docs); });
  (app as any).debug.autosave = () => autosave(app.docs);
  const saved = await listSaved();
  if (!saved.length) return;
  const box = h('div', { class: 'recover' }, h('b', {}, 'Trabajo sin guardar de una sesión anterior'));
  for (const s of saved) {
    const row = h('div', { class: 'recover-row' }, h('span', {}, `${s.name} · ${s.size} px · ${new Date(s.date).toLocaleString('es')}`));
    const open = h('button', { class: 'btn primary' }, 'Recuperar'), del = h('button', { class: 'btn' }, 'Descartar');
    open.onclick = async () => { try { const d = await restoreSaved(s); app.addDocument(d, 'Recuperado'); d.modified = true; app.emit('docs'); row.remove(); } catch { app.toast('No se pudo recuperar', 'warn'); } };
    del.onclick = async () => { await removeSaved(s.key); row.remove(); if (!box.querySelector('.recover-row')) box.remove(); };
    row.append(open, del); box.append(row);
  }
  welcome.querySelector('.welcome-card')!.append(box);
});

// Al llegar una fuente descargada, se redibujan los textos que la usan
window.addEventListener('editor-font', (e: Event) => {
  const fam = (e as CustomEvent).detail;
  for (const d of app.docs) {
    let any = false;
    for (const l of d.allLayers()) if (l instanceof TextLayer && l.props.font === fam && !l.props.keepPixels) { l.render(); any = true; }
    if (any) d.invalidate();
  }
  app.viewport.requestRender();
});

// Errores inesperados: se avisa con un mensaje en vez de fallar en silencio (el trabajo sigue a salvo:
// hay copia de recuperación y se puede deshacer)
let lastErr = 0;
const reportError = (msg: string) => {
  console.error(msg);
  if (!(window as any).__editorLogError) { try { const l = JSON.parse(localStorage.getItem('editor.errors') || '[]'); l.push({ t: Date.now(), m: msg.slice(0, 1500) }); localStorage.setItem('editor.errors', JSON.stringify(l.slice(-25))); } catch { /* */ } }
  if (Date.now() - lastErr < 4000) return; lastErr = Date.now();
  app.toast('Algo ha fallado en esta operación. Puedes deshacer (Ctrl+Z) y seguir trabajando.', 'warn');
};
window.addEventListener('error', e => { if (e.error) reportError(String(e.error?.stack ?? e.message)); });
window.addEventListener('unhandledrejection', e => {
  const r = e.reason; if (r?.name === 'AbortError') return;
  // tras publicar una versión nueva con el editor abierto, las piezas antiguas ya no existen: se recarga una vez
  if (/dynamically imported module|Importing a module script failed|error loading dynamically/i.test(String(r?.message ?? r))) {
    // sin cambios sin guardar, se recarga solo (una vez); si hay trabajo sin guardar, se avisa para no perderlo
    if (!app.docs.some(d => d.modified)) {
      try { const k = 'editor.chunkReload', last = +(sessionStorage.getItem(k) || 0); if (Date.now() - last > 60000) { sessionStorage.setItem(k, String(Date.now())); location.reload(); return; } } catch { /* */ }
    } else { app.toast('Hay una versión nueva del editor: guarda tu trabajo (Ctrl+S) y recarga la página', 'warn'); (window as any).__editorLogError?.(String(r?.message ?? r)); return; }
  }
  reportError(String(r?.stack ?? r));
});
// «se cerró de golpe»: mientras el editor está a la vista se anota la hora; al ocultarlo o cerrarlo, se borra
{
  const beat = () => { try { if (document.visibilityState === 'visible') localStorage.setItem('editor.running', String(Date.now())); else localStorage.removeItem('editor.running'); } catch { /* */ } };
  beat(); setInterval(beat, 30000); document.addEventListener('visibilitychange', beat);
  addEventListener('pagehide', () => { try { localStorage.removeItem('editor.running'); } catch { /* */ } });
  // si hubo fallos desde la última vez que se miró el informe, se dice dónde verlos
  try {
    const l = JSON.parse(localStorage.getItem('editor.errors') || '[]'), seen = +(localStorage.getItem('editor.errorsSeen') || 0);
    if (l.some((x: any) => x.t > seen && /cerró de golpe|no ha arrancado|No se ha podido cargar/.test(x.m))) setTimeout(() => app.toast('La última vez hubo un fallo. Si quieres contárnoslo: Ayuda › Informe de errores', 'warn'), 2500);
  } catch { /* */ }
}

// Con la app ya abierta y libre, se cargan en segundo plano las ventanas: así abrir la primera es inmediato
// sin retrasar el arranque.
{ const idle = (window as any).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1500)); setTimeout(() => idle(() => { loadDialogs(); }, { timeout: 4000 }), 1200); }
// los filtros inteligentes que se dibujaron antes de cargar los filtros de efectos se vuelven a dibujar
setSmartFilterRedraw(() => { app.doc?.invalidate(); app.viewport?.requestRender(); });
