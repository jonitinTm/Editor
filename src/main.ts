// Punto de entrada: monta la interfaz y conecta teclado, arrastrar y pegar.

import './styles.css';
import { app } from './ui/app';
import { h } from './ui/dom';
import { icon } from './ui/icons';
import { Viewport, isTyping } from './ui/viewport';
import { buildMenuBar } from './ui/menus';
import { buildToolbar } from './ui/toolbar';
import { buildOptionsBar } from './ui/optionsbar';
import { buildLayersPanel, buildHistoryPanel, buildPropertiesPanel } from './ui/panels';
import { ACTIONS } from './ui/actions';
import * as ops from './ui/ops';
import { dialogOpen } from './ui/dialog';
import { newDocumentDialog } from './ui/dialogs';
import * as io from './io/files';

import { MoveTool } from './tools/move';
import { RectSelectTool, EllipseSelectTool, LassoTool, WandTool } from './tools/select';
import { CropTool } from './tools/crop';
import { BrushTool, PencilTool, EraserTool, CloneTool } from './tools/brush';
import { BucketTool, GradientTool, EyedropperTool, HandTool, ZoomTool } from './tools/misc';
import { TextTool } from './tools/text';
import { ShapeTool } from './tools/shape';
import { TransformTool } from './tools/transform';

// ---- Herramientas ----------------------------------------------------------------
for (const T of [MoveTool, RectSelectTool, EllipseSelectTool, LassoTool, WandTool, CropTool, EyedropperTool, CloneTool,
  BrushTool, PencilTool, EraserTool, GradientTool, BucketTool, TextTool, ShapeTool, HandTool, ZoomTool, TransformTool]) {
  app.registerTool(new T());
}

// ---- Estructura de la página ----------------------------------------------------------
const root = document.getElementById('app')!;
const header = h('header', { class: 'topbar' }, h('span', { class: 'logo', html: icon('logo') }, h('span', {}, 'Editor')));
root.append(header);
buildMenuBar(header);
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
const welcome = buildWelcome();
viewHost.append(welcome);
const status = h('div', { class: 'statusbar' });
center.append(status);
const side = h('aside', { class: 'side' });
main.append(side);
const sideTop = h('div', { class: 'side-top' });
const sideBottom = h('div', { class: 'side-bottom' });
side.append(sideTop, h('div', { class: 'splitter', title: 'Arrastra para cambiar el tamaño' }), sideBottom);
buildPropertiesPanel(sideTop);
buildHistoryPanel(sideTop);
buildLayersPanel(sideBottom);
root.append(h('div', { id: 'toasts' }));

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

// ---- Pestañas de documentos ----------------------------------------------------------
function renderTabs() {
  tabs.innerHTML = '';
  for (const d of app.docs) {
    const close = h('button', { class: 'tab-close', title: 'Cerrar', html: icon('close') });
    close.onclick = e => { e.stopPropagation(); ops.closeDocument(d); };
    const t = h('div', { class: 'tab' + (d === app.doc ? ' active' : ''), title: `${d.name} (${d.width} × ${d.height})` },
      h('span', {}, d.name + (d.modified ? ' •' : '')), close);
    t.onclick = () => { app.setDocument(d); ops.notifyToolDocChanged(); };
    t.addEventListener('auxclick', e => { if (e.button === 1) ops.closeDocument(d); });
    tabs.append(t);
  }
  tabs.append(h('button', { class: 'tab-new', title: 'Nuevo documento', html: icon('plus'), onclick: newDocumentDialog }));
  welcome.style.display = app.doc ? 'none' : '';
  if (app.doc && !app.doc.viewInitialized) requestAnimationFrame(() => app.viewport.resize());
}
app.on('docs', renderTabs);
app.on('doc', () => {
  // El indicador de "sin guardar" de la pestaña
  const t = tabs.querySelector('.tab.active span');
  if (t && app.doc) t.textContent = app.doc.name + (app.doc.modified ? ' •' : '');
});
renderTabs();

// ---- Barra de estado ------------------------------------------------------------------
function renderStatus() {
  const d = app.doc;
  if (!d) { status.textContent = 'Arrastra una imagen aquí o usa Archivo › Abrir'; return; }
  const m = app.viewport.mouse;
  const zoomInput = h('input', { class: 'zoom-input', value: Math.round(d.view.zoom * 1000) / 10 + ' %' });
  zoomInput.addEventListener('change', () => { const z = parseFloat(zoomInput.value); if (z > 0) app.viewport.setZoom(z / 100, null); });
  status.innerHTML = '';
  status.append(zoomInput,
    h('span', {}, `${d.width} × ${d.height} px`),
    h('span', {}, m ? `X: ${Math.floor(m.x)}  Y: ${Math.floor(m.y)}` : ''),
    h('span', { class: 'grow' }),
    h('span', { class: 'hint' }, d.selection.bounds ? `Selección: ${d.selection.bounds.w} × ${d.selection.bounds.h}` : ''));
}
app.on('view', () => { if (document.activeElement?.classList.contains('zoom-input')) return; renderStatus(); });
app.on('doc', renderStatus); app.on('docs', renderStatus);
renderStatus();

// ---- Pantalla de bienvenida ------------------------------------------------------------
function buildWelcome() {
  const openBtn = h('button', { class: 'btn primary big', html: icon('open') + '<span>Abrir desde el equipo</span>' });
  openBtn.onclick = async () => ops.openFiles(await io.pickFiles('image/*,' + io.PROJECT_EXT));
  const newBtn = h('button', { class: 'btn big', html: icon('plus') + '<span>Nuevo documento</span>' });
  newBtn.onclick = newDocumentDialog;
  const presets = h('div', { class: 'welcome-presets' }, ...[[1920, 1080], [1080, 1080], [1280, 720], [800, 600]].map(([w, hh]) =>
    h('button', { class: 'preset', onclick: () => ops.newDocument('Sin título', w, hh, '#ffffff') },
      h('span', { class: 'preset-shape', style: { aspectRatio: `${w}/${hh}` } }), `${w} × ${hh}`)));
  return h('div', { class: 'welcome' },
    h('div', { class: 'welcome-card' },
      h('div', { class: 'welcome-logo', html: icon('logo') }),
      h('h1', {}, 'Editor'),
      h('p', {}, 'Editor de imágenes por capas. Todo se procesa en tu equipo: tus imágenes no salen de él.'),
      h('div', { class: 'welcome-actions' }, openBtn, newBtn),
      h('div', { class: 'hint' }, 'Tamaños rápidos:'), presets,
      h('div', { class: 'drop-hint' }, 'También puedes arrastrar imágenes (PNG, JPG, WebP, GIF) o proyectos .edp aquí, o pegar con Ctrl+V.')));
}

// ---- Teclado -----------------------------------------------------------------------------
function keyString(e: KeyboardEvent) {
  const parts: string[] = [];
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  let k = e.key;
  if (e.code.startsWith('Numpad') && (e.code === 'NumpadAdd' || e.code === 'NumpadSubtract')) k = e.code;
  else if (k.length === 1) k = k.toUpperCase();
  // Con Mayús, algunas teclas cambian de símbolo; usamos el código físico
  if (e.code === 'BracketRight') k = ']'; if (e.code === 'BracketLeft') k = '[';
  if (e.code === 'Equal' && (e.ctrlKey || e.metaKey)) k = '=';
  if (e.code === 'Minus') k = '-';
  if (e.code.startsWith('Digit')) k = e.code.slice(5);
  if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  parts.push(k);
  return parts.join('+');
}

const keymap = new Map<string, (typeof ACTIONS)[number]>();
for (const a of ACTIONS) for (const k of a.keys ?? []) keymap.set(k, a);

window.addEventListener('keydown', e => {
  if (dialogOpen()) return;
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
  const a = keymap.get(ks);
  if (a) {
    e.preventDefault();
    if (!a.enabled || a.enabled()) a.run();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.toUpperCase();
  if (key === 'D' && !e.shiftKey) { app.setColors('#000000', '#ffffff'); return; }
  if (key === 'X' && !e.shiftKey) { app.setColors(app.bg, app.fg); return; }
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
  const projects = files.filter(io.isProjectFile), images = files.filter(f => !io.isProjectFile(f));
  if (projects.length) ops.openFiles(projects);
  if (images.length) ops.openFiles(images, !!app.doc && !onTabs);
});

window.addEventListener('beforeunload', e => {
  if (app.docs.some(d => d.modified)) { e.preventDefault(); e.returnValue = ''; }
});
