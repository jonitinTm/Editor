// Photocap Creative Studio: «¿Qué quieres crear hoy?». Cinco espacios de trabajo (Fotografía, Ilustración, Animación 2D,
// Pixel art y Videojuegos). Cada uno enseña en la barra solo las herramientas que se usan en ese tipo de trabajo y tiene sus
// formas rápidas de empezar. Los menús siguen teniendo todo: ninguna función se esconde de verdad, y «Todas las
// herramientas» las vuelve a enseñar.
import { app } from './app';
import { h } from './dom';
import { icon } from './icons';
import { showDialog } from './dialog';
import { t } from '../i18n/i18n';

export type Start = { label: string; icon: string; run: () => void | Promise<void>; hint?: string };
export type Workspace = { id: string; name: string; desc: string; icon: string; tools: string[] | null; tip: string; starts: () => Start[] };

const act = (id: string) => import('./actions').then(m => { const a = m.actionById.get(id); if (a && (!a.enabled || a.enabled())) a.run(); });
const blank = async (name: string, w: number, h0: number, bg: string | null = '#ffffff') => { const ops = await import('./ops'); ops.newDocument(name, w, h0, bg); };
/** Abre archivos y, si se ha abierto alguno, hace algo con él. */
const openThen = async (accept: string, then?: () => void) => {
  const io = await import('../io/files'), ops = await import('./ops');
  const files = await io.pickFiles(accept); if (!files.length) return;
  const before = app.doc; await ops.openFiles(files);
  if (then && app.doc && app.doc !== before) then();
};
const animDoc = async (name: string, w: number, h0: number) => {
  await blank(name, w, h0);
  const m = await import('./anim'); m.startAnim(); if (!m.dockShown()) m.toggleAnimDock();
};
const ALL_ACCEPT = () => import('../io/files').then(m => m.OPEN_ACCEPT);

export const WORKSPACES: Workspace[] = [
  { id: 'photo', name: 'Fotografía', desc: 'Editar, retocar y componer imágenes.', icon: 'image', tools: null,
    tip: 'Todas las herramientas: ajustes, retoque, selecciones, capas, RAW e IA.',
    starts: () => [
      { label: 'Abrir una foto', icon: 'open', run: async () => openThen(await ALL_ACCEPT()) },
      { label: 'Galería de fotos', icon: 'image', run: () => openThen('image/*') },
      { label: 'Mejorar una foto en un toque', icon: 'magic', run: () => openThen('image/*', () => act('autoEnhance')) },
      { label: 'Quitar el fondo de una foto', icon: 'removeBg', run: () => openThen('image/*', () => act('removeBg')) },
      { label: 'Foto para todas las redes', icon: 'share', run: () => openThen('image/*', () => act('magicResize')) },
      { label: 'Collage', icon: 'layers', run: () => act('collage') },
    ] },
  { id: 'illustration', name: 'Ilustración', desc: 'Dibujar, pintar y diseñar.', icon: 'palette',
    tools: ['move', 'marqueeRect', 'marqueeEllipse', 'lasso', 'polyLasso', 'lassoFill', 'quickSel', 'wand', 'crop', 'eyedropper', 'brush', 'pencil', 'mixer', 'eraser', 'gradient', 'bucket', 'smudge', 'blurTool', 'dodge', 'burn', 'text', 'pen', 'freePen', 'curvPen', 'pathSelect', 'node', 'shape', 'hand', 'rotateView', 'zoom'],
    tip: 'Pinceles con presión, estabilizador, simetría, asistente de perspectiva, capas y formas vectoriales.',
    starts: () => [
      { label: 'Lienzo cuadrado 2048 × 2048', icon: 'plus', run: () => blank('Ilustración', 2048, 2048) },
      { label: 'Vertical A4 (2480 × 3508)', icon: 'plus', run: () => blank('Ilustración A4', 2480, 3508) },
      { label: 'Horizontal 1920 × 1080', icon: 'plus', run: () => blank('Ilustración', 1920, 1080) },
      { label: 'Calcar o colorear una foto', icon: 'brush', hint: 'La foto queda debajo, más clara, como referencia', run: () => openThen('image/*', () => traceSetup()) },
      { label: 'Otro tamaño…', icon: 'resize', run: () => act('new') },
    ] },
  { id: 'anim', name: 'Animación 2D', desc: 'Crear animaciones y personajes.', icon: 'film',
    tools: ['move', 'marqueeRect', 'marqueeEllipse', 'lasso', 'lassoFill', 'wand', 'eyedropper', 'brush', 'pencil', 'pixel', 'eraser', 'bucket', 'gradient', 'smudge', 'text', 'shape', 'hand', 'rotateView', 'zoom'],
    tip: 'Fotogramas, papel cebolla, interpolación, animaciones rápidas y exportación a GIF, vídeo u hoja de sprites.',
    starts: () => [
      { label: 'Animación 1920 × 1080', icon: 'film', run: () => animDoc('Animación', 1920, 1080) },
      { label: 'Animación cuadrada 1080 × 1080', icon: 'film', run: () => animDoc('Animación', 1080, 1080) },
      { label: 'Animación vertical 1080 × 1920', icon: 'film', run: () => animDoc('Animación', 1080, 1920) },
      { label: 'Abrir un GIF animado para editarlo', icon: 'open', run: () => openThen('image/gif,image/*', () => { import('./anim').then(m => { if (!m.dockShown()) m.toggleAnimDock(); }); }) },
      { label: 'Foto en movimiento (agua, nubes)', icon: 'image', run: () => openThen('image/*', () => act('cinemagraph')) },
    ] },
  { id: 'pixel', name: 'Pixel art', desc: 'Sprites, tilesets y animaciones.', icon: 'pixel',
    tools: ['move', 'marqueeRect', 'marqueeEllipse', 'lasso', 'wand', 'crop', 'eyedropper', 'pixel', 'pencil', 'eraser', 'bucket', 'shape', 'text', 'hand', 'zoom'],
    tip: 'Píxel perfecto, paletas, tramas, sombreado con la paleta, rotación sin píxeles sueltos y exportación nítida.',
    starts: () => [
      { label: 'Nuevo pixel art…', icon: 'pixel', run: () => act('newPixelArt') },
      { label: 'Personaje 32 × 32', icon: 'pixel', run: () => pixelDoc('Personaje', 32, 32) },
      { label: 'Sprite grande 64 × 64', icon: 'pixel', run: () => pixelDoc('Sprite', 64, 64) },
      { label: 'Tile 16 × 16 repetible', icon: 'pixel', run: () => pixelDoc('Tile', 16, 16, true) },
      { label: 'Convertir una foto en pixel art', icon: 'image', run: () => openThen('image/*', () => photoToPixel()) },
      { label: 'Abrir un sprite o GIF', icon: 'open', run: () => openThen('image/*') },
    ] },
  { id: 'game', name: 'Diseño de videojuegos', desc: 'Personajes, escenarios, interfaces, texturas y recursos para motores de juegos.', icon: 'gamepad',
    tools: ['move', 'artboardTool', 'marqueeRect', 'marqueeEllipse', 'lasso', 'wand', 'quickSel', 'crop', 'slice', 'eyedropper', 'brush', 'pencil', 'pixel', 'colorReplace', 'eraser', 'bgEraser', 'gradient', 'bucket', 'clone', 'text', 'shape', 'frame', 'hand', 'zoom'],
    tip: 'Texturas con detalles, mapas de tiles, hojas de sprites, atlas, pivote y colisiones, interfaz del juego e iconos.',
    starts: () => [
      { label: 'Nueva textura repetible', icon: 'pixel', run: () => act('newTexture') },
      { label: 'Generador de texturas', icon: 'magic', run: () => act('texGen') },
      { label: 'Mapa de tiles con mi tileset', icon: 'marqueeRow', run: () => openThen('image/*', () => act('tileMap')) },
      { label: 'Interfaz del juego (botones, barras de vida…)', icon: 'shape', run: () => act('gameUi') },
      { label: 'Partículas y efectos (explosión, fuego, magia…)', icon: 'magic', run: () => act('particles') },
      { label: 'Cortar una hoja de sprites', icon: 'slice', run: () => openThen('image/*', () => act('sliceSheet')) },
      { label: 'Iconos del juego en todos los tamaños', icon: 'image', run: () => openThen('image/*', () => act('iconSet')) },
    ] },
];

/** Para calcar: la foto se aclara y se bloquea, y encima queda una capa vacía para dibujar. */
async function traceSetup() {
  const d = app.doc, base = d?.activeRaster(); if (!d || !base) return;
  const { RasterLayer } = await import('../core/layers');
  base.opacity = 0.35; base.locked = true;
  const l = new RasterLayer(t('Dibujo'), d.width, d.height); d.insertAboveActive(l); d.setActive(l, false);
  d.invalidate(); d.commit('Preparar para calcar'); app.emit('docs'); app.setTool('brush');
}
/** Nombre corto del espacio (para su menú de arriba). */
export const WS_SHORT: Record<string, string> = { photo: 'Fotografía', illustration: 'Ilustración', anim: 'Animación', pixel: 'Pixel art', game: 'Videojuegos' };
/** Menú propio de cada espacio: sus funciones a un toque (todo lo demás sigue en los otros menús). */
export const WS_MENU: Record<string, string[]> = {
  photo: ['wsNew', 'wsMore', '-', 'autoEnhance', 'removeBg', 'blurBg', 'aiSky', 'aiErase', 'aiUpscale', '-', 'rawDevelop', 'freqSep', 'copyAdj', 'pasteAdj', 'pasteAdjAll', '-', 'magicResize', 'carousel', 'beforeAfter', 'sticker', 'cinemagraph', 'doubleExposure', 'collage'],
  illustration: ['wsNew', 'wsMore', '-', 'panel:Pinceles', 'reference', 'refLayer', '-', 'assist:off', 'assist:p1', 'assist:p2', '-', 'traceImage', 'colorRamp', 'perspWarp', '-', 'animDock', 'rig'],
  anim: ['wsNew', 'wsMore', '-', 'animDock', 'animPresets', 'animTween', 'rig', 'camera2d', 'particles', 'cinemagraph', '-', 'animSound', 'lipSync', '-', 'animTag', 'animReverse', 'animPreview', '-', 'animExport', 'sliceSheet'],
  pixel: ['wsNew', 'wsMore', '-', 'pixelMode', 'pixelExport', 'pixelScale', 'rotSprite', '-', 'paletteSnap', 'colorRamp', 'ditherGradient', 'outline1px', 'recolor', '-', 'paletteImport', 'paletteExport', '-', 'animDock', 'animPresets', 'particles', 'animExport', '-', 'newTexture', 'tileMap'],
  game: ['wsNew', 'wsMore', '-', 'newTexture', 'texGen', 'texDetails', 'seamless', 'tilePreview', 'texMaps', '-', 'tileMap', 'tileGrid', '-', 'particles', 'gameUi', 'pivotBoxes', 'animPresets', 'animExport', 'sliceSheet', '-', 'atlas', 'pot', 'iconSet'],
};
/** Lo que se crea al entrar en cada espacio desde su tarjeta. */
const ENTER: Record<string, () => void | Promise<void>> = {
  photo: () => openThen('image/*'),
  illustration: async () => { await blank('Ilustración', 2048, 2048); app.setTool('brush'); },
  anim: () => animDoc('Animación', 1920, 1080),
  pixel: () => pixelDoc('Personaje', 32, 32),
  game: async () => { await blank('Sprite', 256, 256, null); app.setTool('brush'); },
};
/** Entra en el espacio: lo elige y crea su proyecto (en fotografía, abre la galería). */
export async function enterWorkspace(id: string) {
  setWorkspace(id);
  try { await ENTER[id]?.(); } catch (e: any) { if (e?.name !== 'AbortError') app.toast(String(e?.message ?? e), 'warn'); }
  requestAnimationFrame(() => app.viewport.fit());
}
export const newInWorkspace = () => enterWorkspace(currentWorkspace().id);
async function pixelDoc(name: string, w: number, h0: number, tile = false) {
  const ops = await import('./ops'); ops.newDocument(name, w, h0, null);
  const d = app.doc; if (!d) return;
  d.meta.pixelArt = true; if (tile) d.meta.tileable = true;
  app.setTool('pixel'); app.emit('docs');
  if (tile) import('./textures').then(m => m.setTilePreview(true));
  requestAnimationFrame(() => app.viewport.fit());
}
/** Foto → pixel art: se reduce a 64 px de lado (sin suavizar el resultado) y se ajusta a la paleta. */
async function photoToPixel() {
  const d = app.doc; if (!d) return;
  const k = 64 / Math.max(d.width, d.height); if (k < 1) d.resample(Math.max(1, Math.round(d.width * k)), Math.max(1, Math.round(d.height * k)));
  d.meta.pixelArt = true; d.commit('Convertir en pixel art'); app.emit('docs');
  requestAnimationFrame(() => app.viewport.fit());
  act('paletteSnap');
}

// ---- estado ----------------------------------------------------------------------------------------
const KEY = 'editor.workspace', ALLKEY = 'editor.allTools';
export function currentWorkspace(): Workspace { let id = 'photo'; try { id = localStorage.getItem(KEY) || id; } catch { /* */ } return WORKSPACES.find(w => w.id === id) ?? WORKSPACES[0]; }
export function showAllTools(): boolean { try { return localStorage.getItem(ALLKEY) === '1'; } catch { return false; } }
export function setShowAllTools(on: boolean) { try { localStorage.setItem(ALLKEY, on ? '1' : '0'); } catch { /* */ } app.emit('workspace'); }
/** ¿Se enseña esta herramienta en la barra con el espacio de trabajo actual? */
export function toolAllowed(id: string) { const w = currentWorkspace(); return !w.tools || showAllTools() || w.tools.includes(id); }
export function setWorkspace(id: string) {
  const w = WORKSPACES.find(x => x.id === id) ?? WORKSPACES[0];
  try { localStorage.setItem(KEY, w.id); localStorage.setItem(ALLKEY, '0'); } catch { /* */ }
  document.body.dataset.ws = w.id;
  if (app.tool && !toolAllowed(app.tool.id)) app.setTool(w.tools![0] === 'move' ? (w.tools!.includes('brush') ? 'brush' : 'pixel') : w.tools![0]);
  app.emit('workspace');
}

// ---- pantalla de inicio -------------------------------------------------------------------------
/** Las cinco tarjetas de «¿Qué quieres crear hoy?». */
export function studioCards(onPick?: () => void): HTMLElement {
  const grid = h('div', { class: 'studio-grid' });
  for (const w of WORKSPACES) {
    const card = h('button', { type: 'button', class: `studio-card ws-${w.id}`, 'data-ws': w.id }, h('span', { class: 'studio-ic', html: icon(w.icon) }), h('span', { class: 'studio-name' }, w.name), h('span', { class: 'studio-desc' }, w.desc));
    card.onclick = () => { onPick?.(); enterWorkspace(w.id); };
    grid.append(card);
  }
  return grid;
}
/** Formas de empezar en un espacio de trabajo (y lo deja elegido). */
export function startDialog(id: string) {
  setWorkspace(id); const w = currentWorkspace();
  let close: () => void = () => {};
  const list = h('div', { class: 'studio-starts' }, ...w.starts().map(s => {
    const b = h('button', { type: 'button', class: 'btn studio-start', title: s.hint ?? s.label }, h('span', { html: icon(s.icon) }), h('span', {}, s.label));
    b.onclick = () => { close(); Promise.resolve(s.run()).catch(e => { if (e?.name !== 'AbortError') app.toast(String(e?.message ?? e), 'warn'); }); };
    return b;
  }));
  const dlg = showDialog({
    title: w.name, okLabel: 'Seguir con lo que tengo abierto', cancelLabel: null, width: 520,
    body: [h('div', { class: `studio-head ws-${w.id}` }, h('span', { class: 'studio-ic', html: icon(w.icon) }), h('div', {}, h('div', { class: 'studio-desc' }, w.desc), h('div', { class: 'hint' }, w.tip))), h('div', { class: 'hint' }, '¿Cómo quieres empezar?'), list],
  });
  close = dlg.close;
}
/** La pantalla «¿Qué quieres crear hoy?» en una ventana (cuando ya hay algo abierto). */
export function studioDialog() {
  let pick: () => void = () => {};
  const dlg = showDialog({ title: '¿Qué quieres crear hoy?', okLabel: 'Cerrar', cancelLabel: null, width: 620, body: [studioCards(() => pick())] });
  pick = dlg.close;
}

// ---- botón de la barra superior ----------------------------------------------------------------------
export function workspaceButton(): HTMLElement {
  const b = h('button', { type: 'button', class: 'top-btn top-ws', title: 'Espacio de trabajo: cambia las herramientas que se ven (fotografía, ilustración, animación, pixel art, videojuegos)' });
  const upd = () => { const w = currentWorkspace(); b.innerHTML = icon(w.icon) + '<span></span>'; b.querySelector('span')!.textContent = w.name; b.setAttribute('aria-label', w.name); };
  upd(); app.on('workspace', upd);
  b.onclick = e => {
    e.stopPropagation(); document.querySelector('.ws-fly')?.remove();
    const cur = currentWorkspace().id;
    const fly = h('div', { class: 'flyout ws-fly' },
      ...WORKSPACES.map(w => { const it = h('div', { class: 'fly-item' + (w.id === cur ? ' on' : ''), 'data-ws': w.id }, h('span', { html: icon(w.icon) }), h('span', { class: 'fly-name' }, w.name, h('small', { class: 'fly-desc' }, w.desc))); it.onclick = () => { fly.remove(); setWorkspace(w.id); }; return it; }),
      h('div', { class: 'menu-sep' }),
      (() => { const it = h('div', { class: 'fly-item' + (showAllTools() ? ' on' : '') }, h('span', { html: icon('check') }), h('span', { class: 'fly-name' }, 'Todas las herramientas en la barra')); it.onclick = () => { fly.remove(); setShowAllTools(!showAllTools()); }; return it; })(),
      (() => { const it = h('div', { class: 'fly-item' }, h('span', { html: icon('plus') }), h('span', { class: 'fly-name' }, '¿Qué quieres crear hoy?…')); it.onclick = () => { fly.remove(); studioDialog(); }; return it; })());
    document.body.append(fly);
    const r = b.getBoundingClientRect(); fly.style.top = r.bottom + 4 + 'px'; fly.style.left = Math.max(8, Math.min(innerWidth - fly.offsetWidth - 8, r.left)) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', function cl(ev) { if (!fly.contains(ev.target as Node)) { fly.remove(); document.removeEventListener('pointerdown', cl); } }), 0);
  };
  return b;
}
export function initStudio() { document.body.dataset.ws = currentWorkspace().id; }
