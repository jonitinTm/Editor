// Diálogos concretos: nuevo documento, exportar, tamaños, filtros, niveles, curvas…

import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog, row, promptDialog } from './dialog';
import * as ops from './ops';
import * as io from '../io/files';
import { FilterDef, defaultParams } from '../filters/registry';
import { histogram, curveLut, levelsLut, CurvePoint } from '../filters/adjustments';
import { SmartLayer, TextLayer, blendIfActive, type LayerStyles } from '../core/layers';
import { WARP_STYLES } from '../tools/warpmesh';
import { ACTIONS, setActionKey, resetKeys } from './actions';
import { keyString } from './keys';
import { gradientEditor, type GradStop } from './gradienteditor';
import { layerCanvasIn } from '../core/history';
import { cloneCanvas, ctx2d, makeCanvas } from '../core/canvas';
import { allPatterns } from '../core/patterns';
import { record, macros, play } from './macros';
import { colorDialog } from './colorpicker';
import { prefs, savePrefs } from './prefs';
import { BEVEL_DEFAULT } from '../core/bevel';
import { shiftRuns } from '../core/textruns';

const numInput = (value: number, min = 1, max = 30000) => h('input', { type: 'number', value: String(value), min: String(min), max: String(max), class: 'num' });

// ---- Nuevo documento -----------------------------------------------------------

const PRESET_GROUPS: [string, [string, number, number][]][] = [
  ['Redes sociales', [['Publicación cuadrada 1080 × 1080', 1080, 1080], ['Publicación vertical 1080 × 1350', 1080, 1350], ['Historia / vídeo vertical 1080 × 1920', 1080, 1920],
    ['Miniatura de vídeo 1280 × 720', 1280, 720], ['Portada de canal 2560 × 1440', 2560, 1440], ['Portada de perfil 1500 × 500', 1500, 500], ['Portada de página 1640 × 624', 1640, 624],
    ['Banner profesional 1584 × 396', 1584, 396], ['Pin vertical 1000 × 1500', 1000, 1500]]],
  ['Pantalla', [['HD 1280 × 720', 1280, 720], ['Full HD 1920 × 1080', 1920, 1080], ['2K 2560 × 1440', 2560, 1440], ['4K 3840 × 2160', 3840, 2160], ['Móvil 1170 × 2532', 1170, 2532], ['Tableta 2048 × 2732', 2048, 2732]]],
  ['Impresión (300 ppp)', [['A4 210 × 297 mm', 2480, 3508], ['A5 148 × 210 mm', 1748, 2480], ['A3 297 × 420 mm', 3508, 4961], ['Carta 8,5 × 11 in', 2550, 3300],
    ['Tarjeta de visita 85 × 55 mm', 1004, 650], ['Postal 10 × 15 cm', 1181, 1772], ['Foto 13 × 18 cm', 1535, 2126], ['Póster A2', 4961, 7016]]],
  ['Web', [['Web 800 × 600', 800, 600], ['Cabecera web 1920 × 600', 1920, 600], ['Anuncio horizontal 728 × 90', 728, 90], ['Anuncio rectángulo 300 × 250', 300, 250], ['Icono 512 × 512', 512, 512], ['Favicon 64 × 64', 64, 64]]],
];
const PRESETS: [string, number, number][] = [['Personalizado', 0, 0], ...PRESET_GROUPS.flatMap(([g, l]) => l.map(([n, w, h]) => [(g.startsWith('Impresión') ? n + ' · 300 ppp' : n), w, h] as [string, number, number]))];


export function newDocumentDialog() {
  const name = h('input', { type: 'text', value: 'Sin título', class: 'wide' });
  const w = numInput(1280), hh = numInput(720), res = numInput(72, 1, 10000);
  let k = 1;
  const preset = h('select', {}, h('option', { value: '0' }, 'Personalizado'), ...PRESET_GROUPS.map(([g, l]) => h('optgroup', { label: g }, ...l.map(([n]) => h('option', { value: String(k++) }, n)))));
  preset.value = String(PRESETS.findIndex(p => p[1] === 1280 && p[2] === 720 && /HD/.test(p[0])));
  const orient = h('button', { class: 'btn', type: 'button', title: 'Cambiar entre horizontal y vertical' }, '⇄ Girar');
  orient.onclick = () => { const a = w.value; w.value = hh.value; hh.value = a; };
  preset.addEventListener('change', () => { const p = PRESETS[+preset.value]; if (p[1]) { w.value = String(p[1]); hh.value = String(p[2]); res.value = /ppp/.test(p[0]) ? '300' : '72'; } });
  [w, hh].forEach(i => i.addEventListener('input', () => preset.value = '0'));
  const bg = h('select', {},
    h('option', { value: '#ffffff' }, 'Blanco'), h('option', { value: '#000000' }, 'Negro'),
    h('option', { value: 'fg' }, 'Color frontal'), h('option', { value: 'bgc' }, 'Color de fondo'),
    h('option', { value: '' }, 'Transparente'));
  showDialog({
    title: 'Nuevo documento', okLabel: 'Crear',
    body: [row('Nombre', name), row('Predefinido', preset), row('Anchura', w, 'px'), row('Altura', hh, 'px', orient), row('Resolución', res, 'ppp'), row('Fondo', bg)],
    onOk: () => {
      const W = Math.round(+w.value), H = Math.round(+hh.value);
      if (!(W >= 1 && H >= 1 && W <= 30000 && H <= 30000)) { app.toast('Tamaño no válido (1 – 30000 px)', 'warn'); return false; }
      if (W * H > 268e6) { app.toast('La imagen es demasiado grande para el navegador', 'warn'); return false; }
      const b = bg.value === 'fg' ? app.fg : bg.value === 'bgc' ? app.bg : bg.value || null;
      ops.newDocument(name.value.trim() || 'Sin título', W, H, b);
      if (app.doc && +res.value > 0) app.doc.ppi = +res.value;
    },
  });
}

// ---- Exportar ---------------------------------------------------------------------

export function exportDialog() {
  const d = app.doc; if (!d) return;
  const name = h('input', { type: 'text', value: d.name, class: 'wide' });
  const fmt = h('select', {},
    h('option', { value: 'image/png' }, 'PNG (sin pérdida, con transparencia)'),
    h('option', { value: 'image/jpeg' }, 'JPG (fotografías, sin transparencia)'),
    h('option', { value: 'image/webp' }, 'WebP (moderno, ligero)'),
    h('option', { value: 'image/tiff' }, 'TIFF (sin pérdida, para imprenta y fotografía)'),
    h('option', { value: 'image/bmp' }, 'BMP (mapa de bits de Windows)'),
    h('option', { value: 'image/x-tga' }, 'TGA (Targa, para juegos y vídeo)'),
    h('option', { value: 'image/x-icon' }, 'ICO (icono de Windows o favicon, varios tamaños)'),
    h('option', { value: 'gif' }, 'GIF (animado si hay cuadros en la línea de tiempo)'),
    h('option', { value: 'webm' }, 'Vídeo WebM (la animación de la línea de tiempo)'),
    h('option', { value: 'pdf' }, 'PDF (para imprimir o enviar)'),
    h('option', { value: 'svg' }, 'SVG (imagen incrustada, se puede ampliar en diseño web)'),
    h('option', { value: 'psd' }, 'PSD (Photoshop, conserva capas)'),
    h('option', { value: 'project' }, 'Proyecto de Editor (.edp, conserva todo)'));
  let quality = 90;
  const q = numberSlider({ label: '', min: 1, max: 100, value: quality, unit: '%', onInput: v => { quality = v; estimate(); } });
  const qRow = row('Calidad', q.el);
  let scale = 100;
  const sc = numberSlider({ min: 1, max: 400, value: 100, unit: '%', onInput: v => { scale = v; estimate(); } });
  const scRow = row('Tamaño', sc.el);
  // Tamaños adicionales (para pantallas de alta densidad, iconos…)
  const extraSizes: [number, string][] = [[0.5, '@0,5x'], [2, '@2x'], [3, '@3x']];
  const extraChecks = extraSizes.map(([k, n]) => { const c = h('input', { type: 'checkbox' }); return { k, el: h('label', { class: 'check' }, c, ' ' + n), c }; });
  const exRow = row('Además', h('div', { class: 'check-row' }, ...extraChecks.map(e => e.el)));
  const hasBoards = ops.artboards(d).length > 0;
  const perBoard = h('input', { type: 'checkbox', checked: hasBoards });
  const pbRow = row('', h('label', { class: 'check' }, perBoard, ' Cada mesa de trabajo en un archivo'));
  if (!hasBoards) pbRow.style.display = 'none';
  const info = h('div', { class: 'hint' }, '');
  let timer = 0;
  const estimate = () => {
    clearTimeout(timer);
    qRow.style.display = fmt.value === 'image/jpeg' || fmt.value === 'image/webp' ? '' : 'none';
    scRow.style.display = fmt.value.startsWith('image/') || fmt.value === 'pdf' || fmt.value === 'svg' ? '' : 'none';
    exRow.style.display = fmt.value.startsWith('image/') ? '' : 'none';
    qRow.style.display = fmt.value === 'image/jpeg' || fmt.value === 'image/webp' || fmt.value === 'pdf' ? '' : 'none';
    pbRow.style.display = hasBoards && fmt.value.startsWith('image/') ? '' : 'none';
    if (fmt.value === 'pdf') { info.textContent = 'Un PDF de una página con la imagen (fondo blanco). Ideal para imprimir.'; return; }
    if (fmt.value === 'svg') { info.textContent = 'Archivo SVG con la imagen incrustada (sin pérdida, con transparencia).'; return; }
    if (fmt.value === 'project') { info.textContent = 'Guarda todo (capas, texto, formas, ajustes, estilos) para seguir editando.'; return; }
    if (fmt.value === 'webm') { info.textContent = d.frames.length > 1 ? `Vídeo de ${d.frames.length} cuadros (se graba en tiempo real: tarda lo que dura la animación).` : 'Primero crea cuadros en Ventana › Línea de tiempo.'; return; }
    if (fmt.value === 'gif') { info.textContent = d.frames.length > 1 ? `Animación de ${d.frames.length} cuadros, 256 colores.` : 'Imagen de 256 colores. Para animar, crea cuadros en Ventana › Línea de tiempo.'; return; }
    if (fmt.value === 'psd') { info.textContent = 'Capas, grupos, máscaras, opacidad y modos de fusión. El texto y las formas van como píxeles.'; return; }
    info.textContent = 'Calculando tamaño…';
    timer = window.setTimeout(async () => {
      const b = await io.exportImage(d, fmt.value as any, quality / 100, scale / 100);
      info.textContent = `${Math.round(d.width * scale / 100)} × ${Math.round(d.height * scale / 100)} px · tamaño aproximado: ${(b.size / 1024).toFixed(b.size > 1e6 ? 0 : 1)} KB`;
    }, 200);
  };
  fmt.addEventListener('change', estimate);
  estimate();
  showDialog({
    title: 'Exportar como', okLabel: 'Guardar',
    body: [row('Nombre', name), row('Formato', fmt), qRow, scRow, exRow, pbRow, info],
    onOk: async () => {
      if (fmt.value === 'project') { d.name = name.value || d.name; await ops.saveProject(true); return; }
      if (fmt.value === 'psd') { await ops.savePsd(name.value || d.name); return; }
      if (fmt.value === 'gif') { await ops.saveGif(name.value || d.name); return; }
      if (fmt.value === 'webm') { await ops.saveVideo(name.value || d.name); return; }
      if (fmt.value === 'pdf' || fmt.value === 'svg') { try { await ops.exportVector(fmt.value, name.value || d.name, quality / 100, scale / 100); app.toast('Exportado'); } catch (e: any) { if (e?.name !== 'AbortError') app.toast('No se pudo exportar: ' + (e?.message ?? e), 'warn'); } return; }
      const ext = io.EXPORT_EXT[fmt.value as io.ExportType];
      const extra = extraChecks.filter(e => e.c.checked).map(e => e.k);
      if (extra.length || (hasBoards && perBoard.checked)) {
        try { const n = await ops.exportSet(d, fmt.value as any, quality / 100, scale / 100, extra, hasBoards && perBoard.checked, name.value || d.name); app.toast(n > 1 ? `${n} imágenes exportadas (ZIP)` : 'Imagen exportada'); }
        catch (e: any) { if (e?.name !== 'AbortError') app.toast('No se pudo exportar: ' + (e?.message ?? e), 'warn'); }
        return;
      }
      try {
        const b = await io.exportImage(d, fmt.value as any, quality / 100, scale / 100);
        if (fmt.value === 'image/webp' && b.type !== 'image/webp') app.toast('Este navegador no puede crear WebP; se guardó como PNG', 'warn');
        await io.saveBlob(b, (name.value || d.name) + (b.type === 'image/webp' || fmt.value !== 'image/webp' ? ext : '.png'));
        app.toast('Imagen exportada');
      } catch (e: any) { if (e?.name !== 'AbortError') app.toast('No se pudo exportar: ' + (e?.message ?? e), 'warn'); }
    },
  });
}

// ---- Tamaño de imagen y de lienzo -----------------------------------------------

export function imageSizeDialog() {
  const d = app.doc; if (!d) return;
  // Estado en píxeles; anchura y altura se muestran en la unidad elegida
  let W = d.width, H = d.height, ppi = d.ppi;
  const ratio = d.width / d.height;
  const unit = h('select', {}, h('option', { value: 'px' }, 'Píxeles'), h('option', { value: 'cm' }, 'Centímetros'), h('option', { value: 'mm' }, 'Milímetros'), h('option', { value: 'in' }, 'Pulgadas'), h('option', { value: '%' }, 'Porcentaje'));
  const w = h('input', { type: 'number', class: 'num', step: 'any' }), hh = h('input', { type: 'number', class: 'num', step: 'any' });
  const res = h('input', { type: 'number', class: 'num', step: 'any', value: String(ppi) });
  const link = h('input', { type: 'checkbox', checked: true }), resample = h('input', { type: 'checkbox', checked: true });
  const info = h('div', { class: 'hint' });
  const toUnit = (px: number, base: number) => { const u = unit.value; return u === 'px' ? px : u === '%' ? px / base * 100 : u === 'in' ? px / ppi : u === 'cm' ? px / ppi * 2.54 : px / ppi * 25.4; };
  const fromUnit = (v: number, base: number) => { const u = unit.value; return u === 'px' ? v : u === '%' ? v / 100 * base : u === 'in' ? v * ppi : u === 'cm' ? v / 2.54 * ppi : v / 25.4 * ppi; };
  const fmt = (v: number) => String(unit.value === 'px' ? Math.round(v) : +v.toFixed(2));
  const show = () => {
    w.value = fmt(toUnit(W, d.width)); hh.value = fmt(toUnit(H, d.height));
    const mb = W * H * 4 / 1048576;
    info.textContent = `${Math.round(W)} × ${Math.round(H)} px · ${(W / ppi * 2.54).toFixed(1)} × ${(H / ppi * 2.54).toFixed(1)} cm a ${+ppi.toFixed(2)} ppp · ${mb.toFixed(1)} MB` + (resample.checked ? '' : ' · sin remuestrear (solo cambia el tamaño de impresión)');
  };
  unit.addEventListener('change', show);
  w.addEventListener('input', () => { const v = parseFloat(w.value); if (!(v > 0)) return; if (resample.checked) { W = fromUnit(v, d.width); if (link.checked) H = W / ratio; } else { /* sin remuestrear: cambia la resolución */ const inch = unit.value === 'in' ? v : unit.value === 'cm' ? v / 2.54 : unit.value === 'mm' ? v / 25.4 : 0; if (inch > 0) { ppi = W / inch; res.value = String(+ppi.toFixed(2)); } } hh.value = fmt(toUnit(H, d.height)); show2(); });
  hh.addEventListener('input', () => { const v = parseFloat(hh.value); if (!(v > 0)) return; if (resample.checked) { H = fromUnit(v, d.height); if (link.checked) W = H * ratio; } else { const inch = unit.value === 'in' ? v : unit.value === 'cm' ? v / 2.54 : unit.value === 'mm' ? v / 25.4 : 0; if (inch > 0) { ppi = H / inch; res.value = String(+ppi.toFixed(2)); } } w.value = fmt(toUnit(W, d.width)); show2(); });
  res.addEventListener('input', () => {
    const v = parseFloat(res.value); if (!(v > 0)) return;
    // con remuestreo, el tamaño de impresión se mantiene y cambian los píxeles
    if (resample.checked) { const k = v / ppi; W *= k; H *= k; }
    ppi = v; show();
  });
  resample.addEventListener('change', show);
  const show2 = () => { const mb = W * H * 4 / 1048576; info.textContent = `${Math.round(W)} × ${Math.round(H)} px · ${(W / ppi * 2.54).toFixed(1)} × ${(H / ppi * 2.54).toFixed(1)} cm a ${+ppi.toFixed(2)} ppp · ${mb.toFixed(1)} MB`; };
  show();
  showDialog({
    title: 'Tamaño de imagen',
    body: [row('Anchura', w), row('Altura', hh), row('Unidades', unit), row('Resolución', res, 'ppp'),
      row('', h('label', { class: 'check' }, link, ' Mantener proporciones')), row('', h('label', { class: 'check' }, resample, ' Remuestrear (cambiar el número de píxeles)')),
      info, h('div', { class: 'hint' }, `Tamaño actual: ${d.width} × ${d.height} px a ${d.ppi} ppp`)],
    onOk: () => {
      const Wn = Math.round(W), Hn = Math.round(H);
      if (!(Wn >= 1 && Hn >= 1 && Wn <= 30000 && Hn <= 30000)) { app.toast('Tamaño no válido', 'warn'); return false; }
      const ppiChanged = Math.abs(ppi - d.ppi) > 1e-6;
      if (!resample.checked || (Wn === d.width && Hn === d.height)) { if (ppiChanged) { d.ppi = +ppi.toFixed(3); d.commit('Resolución'); } return; }
      d.ppi = +ppi.toFixed(3);
      d.resample(Wn, Hn); d.commit('Tamaño de imagen'); record({ kind: 'imageSize', w: Wn, h: Hn, label: `Tamaño de imagen: ${Wn} × ${Hn}` }); app.viewport.fit(true);
    },
  });
}

export function canvasSizeDialog() {
  const d = app.doc; if (!d) return;
  const w = numInput(d.width), hh = numInput(d.height);
  let anchor = 4;
  const grid = h('div', { class: 'anchor-grid' });
  const cells: HTMLButtonElement[] = [];
  for (let i = 0; i < 9; i++) {
    const b = h('button', { type: 'button', class: 'anchor' + (i === anchor ? ' on' : '') });
    b.onclick = () => { anchor = i; cells.forEach((c, j) => c.classList.toggle('on', j === i)); };
    cells.push(b); grid.append(b);
  }
  showDialog({
    title: 'Tamaño de lienzo',
    body: [row('Anchura', w, 'px'), row('Altura', hh, 'px'), row('Ancla', grid), h('div', { class: 'hint' }, `Tamaño actual: ${d.width} × ${d.height} px`)],
    onOk: () => {
      const W = Math.round(+w.value), H = Math.round(+hh.value);
      if (!(W >= 1 && H >= 1 && W <= 30000 && H <= 30000)) return false;
      const ax = anchor % 3, ay = Math.floor(anchor / 3);
      const dx = Math.round((W - d.width) * ax / 2), dy = Math.round((H - d.height) * ay / 2);
      d.resizeCanvas(W, H, dx, dy); d.commit('Tamaño de lienzo'); record({ kind: 'canvasSize', w: W, h: H, anchor, label: `Tamaño de lienzo: ${W} × ${H}` }); app.viewport.fit(true);
    },
  });
}

// ---- Rellenar -----------------------------------------------------------------------

export function fillDialog() {
  if (!app.doc) return;
  const what = h('select', {},
    h('option', { value: 'fg' }, 'Color frontal'), h('option', { value: 'bg' }, 'Color de fondo'), h('option', { value: 'pick' }, 'Color…'),
    h('option', { value: '#000000' }, 'Negro'), h('option', { value: '#808080' }, 'Gris 50 %'), h('option', { value: '#ffffff' }, 'Blanco'),
    h('option', { value: 'pattern' }, 'Motivo'), h('option', { value: 'content' }, 'Según el contenido'));
  let op = 100, pat = allPatterns()[0]?.id ?? '', picked = app.fg, scale = 100;
  const s = numberSlider({ min: 1, max: 100, value: 100, unit: '%', onInput: v => op = v });
  const grid = h('div', { class: 'pat-grid' });
  const renderGrid = () => { grid.innerHTML = ''; for (const p of allPatterns()) { const c = h('canvas', { width: 36, height: 36, class: 'pat' + (p.id === pat ? ' on' : ''), title: p.name }); const x = c.getContext('2d')!; x.fillStyle = x.createPattern(p.canvas, 'repeat')!; x.fillRect(0, 0, 36, 36); c.onclick = () => { pat = p.id; renderGrid(); }; grid.append(c); } };
  renderGrid();
  const sc = numberSlider({ min: 10, max: 1000, value: 100, unit: '%', onInput: v => scale = v });
  const patRows = [row('Motivo', grid), row('Escala', sc.el)];
  const sync = () => patRows.forEach(r => r.style.display = what.value === 'pattern' ? '' : 'none');
  what.addEventListener('change', async () => { sync(); if (what.value === 'pick') { const c = await colorDialog('Color de relleno', picked); if (c) picked = c; } });
  sync();
  showDialog({
    title: 'Rellenar', body: [row('Contenido', what), ...patRows, row('Opacidad', s.el)],
    onOk: () => {
      if (what.value === 'pattern') { ops.fillPattern(pat, op / 100, scale / 100); return; }
      if (what.value === 'content') { ops.contentAwareFill(); return; }
      const c = what.value === 'fg' ? app.fg : what.value === 'bg' ? app.bg : what.value === 'pick' ? picked : what.value; ops.fill(c, op / 100);
    },
  });
}

/** Desplegable con miniatura de los motivos disponibles. */
export function patternSelect(value: string, onChange: (id: string) => void): HTMLElement {
  const sel = h('select', {}, ...allPatterns().map(p => h('option', { value: p.id, selected: p.id === value }, p.name)));
  const prev = h('canvas', { width: 24, height: 24, class: 'pat' });
  const draw = () => { const p = allPatterns().find(x => x.id === sel.value); const c = prev.getContext('2d')!; c.clearRect(0, 0, 24, 24); if (p) { c.fillStyle = c.createPattern(p.canvas, 'repeat')!; c.fillRect(0, 0, 24, 24); } };
  sel.addEventListener('change', () => { draw(); onChange(sel.value); }); draw();
  return h('div', { class: 'pat-select' }, prev, sel);
}

// ---- Preferencias ----------------------------------------------------------------

export function prefsDialog() {
  const theme = h('select', {}, ...([['dark', 'Oscuro'], ['medium', 'Gris medio'], ['light', 'Claro']] as const).map(([v, n]) => h('option', { value: v, selected: prefs.theme === v }, n)));
  const before = { ...prefs };
  theme.addEventListener('change', () => { document.body.dataset.theme = theme.value; app.viewport.requestRender(); });
  const scale = h('select', {}, ...[90, 100, 110, 125].map(v => h('option', { value: String(v), selected: prefs.uiScale === v }, v + ' %')));
  let histV = prefs.historySteps, snapV = prefs.snapTolerance;
  const hist = numberSlider({ min: 10, max: 300, value: prefs.historySteps, onInput: v => histV = v });
  const snapTol = numberSlider({ min: 1, max: 20, value: prefs.snapTolerance, unit: 'px', onInput: v => snapV = v });
  const auto = h('input', { type: 'checkbox', checked: prefs.autosave });
  const gsize = h('input', { type: 'number', class: 'num', min: 2, max: 2000, value: prefs.gridSize, style: 'width:80px' }) as HTMLInputElement;
  const gcol = h('input', { type: 'color', class: 'color-input', value: prefs.gridColor }) as HTMLInputElement, gdcol = h('input', { type: 'color', class: 'color-input', value: prefs.guideColor }) as HTMLInputElement;
  showDialog({
    title: 'Preferencias', width: 420,
    body: [h('div', { class: 'dlg-section' }, 'Interfaz'), row('Tema', theme), row('Tamaño de la interfaz', scale),
      h('div', { class: 'dlg-section' }, 'Rendimiento'), row('Pasos de historial', hist.el),
      h('div', { class: 'dlg-section' }, 'Guías, cuadrícula y ajuste'), row('Distancia de ajuste', snapTol.el), row('Cuadrícula cada', gsize, ' px'), row('Color de la cuadrícula', gcol), row('Color de las guías', gdcol),
      h('div', { class: 'dlg-section' }, 'Archivos'), row('', h('label', { class: 'check' }, auto, ' Guardar copia de recuperación cada 15 s'))],
    onOk: () => {
      Object.assign(prefs, { theme: theme.value, uiScale: +scale.value, historySteps: Math.round(histV), snapTolerance: Math.round(snapV), autosave: auto.checked, gridSize: Math.max(2, Math.round(+gsize.value) || 50), gridColor: gcol.value, guideColor: gdcol.value });
      savePrefs(); app.viewport.requestRender(); app.toast('Preferencias guardadas');
    },
    onCancel: () => { document.body.dataset.theme = before.theme; app.viewport.requestRender(); },
  });
}

// ---- Contornear y gama de colores ---------------------------------------------------

export function strokeDialog() {
  const d = app.doc; if (!d) return;
  if (!d.selection.active) { app.toast('Haz primero una selección', 'warn'); return; }
  const w = numInput(3, 1, 500);
  const pos = h('select', {}, h('option', { value: 'center' }, 'Centro'), h('option', { value: 'inside' }, 'Interior'), h('option', { value: 'outside' }, 'Exterior'));
  showDialog({ title: 'Contornear', body: [row('Anchura', w, 'px'), row('Posición', pos), h('div', { class: 'hint' }, 'Se usa el color frontal.')], onOk: () => ops.strokeSelection(Math.max(1, +w.value), pos.value as any) });
}

export function colorRangeDialog() {
  const d = app.doc; if (!d) return;
  let tol = 40;
  const before = d.selection.mask;
  const kind = h('select', {}, ...([['sampled', 'Color frontal (muestreado)'], ['skin', 'Tonos de piel'], ['reds', 'Rojos'], ['yellows', 'Amarillos'], ['greens', 'Verdes'], ['cyans', 'Cianes'], ['blues', 'Azules'], ['magentas', 'Magentas'], ['highlights', 'Luces'], ['midtones', 'Medios tonos'], ['shadows', 'Sombras']] as const).map(([v, n]) => h('option', { value: v }, n))) as HTMLSelectElement;
  const inv = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const hint = h('div', { class: 'hint' }, '');
  const preview = () => { hint.textContent = kind.value === 'sampled' ? 'Selecciona lo que se parezca al color frontal (elígelo antes con el cuentagotas).' : 'La tolerancia amplía o estrecha la gama.'; ops.colorRange(tol, false, kind.value as ops.RangeKind, inv.checked); };
  const s = numberSlider({ min: 0, max: 200, value: tol, onInput: v => { tol = v; preview(); } });
  kind.addEventListener('change', preview); inv.addEventListener('change', preview);
  showDialog({
    title: 'Gama de colores', side: true, body: [row('Seleccionar', kind), hint, row('Tolerancia', s.el), row('', h('label', { class: 'check' }, inv, ' Invertir'))],
    onOk: () => ops.colorRange(tol, true, kind.value as ops.RangeKind, inv.checked), onCancel: () => { d.selection.setMask(before); d.changed(); },
  });
  preview();
}

// ---- Modificar selección ------------------------------------------------------------

export function modifySelectionDialog(kind: 'feather' | 'expand' | 'contract' | 'border' | 'smooth') {
  const d = app.doc; if (!d) return;
  if (!d.selection.active) { app.toast('Haz primero una selección', 'warn'); return; }
  const titles = { feather: 'Calar selección', expand: 'Expandir selección', contract: 'Contraer selección', border: 'Borde de la selección', smooth: 'Suavizar selección' };
  const inp = numInput(kind === 'feather' ? 5 : 2, 1, 500);
  showDialog({
    title: titles[kind], body: row(kind === 'feather' ? 'Radio de calado' : kind === 'border' ? 'Anchura' : kind === 'smooth' ? 'Radio de muestra' : 'Cantidad', inp, 'px'),
    onOk: () => {
      const v = +inp.value; if (!(v > 0)) return false;
      if (kind === 'feather') d.selection.feather(v / 2);
      else if (kind === 'border') d.selection.border(v);
      else if (kind === 'smooth') d.selection.smooth(v);
      else d.selection.grow(kind === 'expand' ? v : -v);
      d.commit(titles[kind]);
    },
  });
}

// ---- Filtros genéricos ----------------------------------------------------------------

export function filterDialog(def: FilterDef, edit?: { layer: SmartLayer; index: number }, initial?: any) {
  if (!def.params && !def.custom) { ops.applyFilterDirect(def); return; }
  const active = app.doc?.active;
  // En objetos inteligentes el filtro queda como filtro inteligente (editable)
  const session = edit ? new ops.SmartFilterSession(edit.layer, def, edit.index)
    : active instanceof SmartLayer && !app.doc!.editMask ? new ops.SmartFilterSession(active, def) : ops.FilterSession.start(def);
  if (!session) return;
  const params = initial ? { ...defaultParams(def), ...JSON.parse(JSON.stringify(initial)) } : edit ? JSON.parse(JSON.stringify(edit.layer.filters[edit.index].params)) : defaultParams(def);
  let previewOn = true;
  let timer = 0;
  const update = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => { if (previewOn) session.render(params); else session.clearPreview(); }, 30);
  };
  const conds: [HTMLElement, [string, string]][] = [];
  const syncShow = () => conds.forEach(([r, [k, v]]) => r.style.display = params[k] === v ? '' : 'none');
  let body: HTMLElement[];
  if (def.custom === 'levels') body = levelsBody(session.source(), params, update);
  else if (def.custom === 'curves') body = curvesBody(session.source(), params, update);
  else body = (def.params ?? []).flatMap(p => [...((p as any).section ? [h('div', { class: 'dlg-section' }, (p as any).section)] : []), paramRow(p)]);
  syncShow();
  function paramRow(p: any): HTMLElement {
    if (p.type === 'checkbox') {
      const c = h('input', { type: 'checkbox', checked: !!params[p.key] });
      c.addEventListener('change', () => { params[p.key] = c.checked; update(); });
      return row('', h('label', { class: 'check' }, c, ' ' + p.label));
    }
    if (p.type === 'color') {
      const c = h('input', { type: 'color', class: 'color-input', value: params[p.key] });
      c.addEventListener('input', () => { params[p.key] = c.value; update(); });
      return row(p.label, c);
    }
    if (p.type === 'matrix') {
      const vals: number[] = [...(params[p.key] ?? p.default)]; params[p.key] = vals;
      const grid = h('div', { class: 'matrix-grid' });
      const inputs = vals.map((v, i) => { const inp = h('input', { type: 'number', class: 'num', value: v, step: 1 }) as HTMLInputElement; inp.addEventListener('input', () => { vals[i] = +inp.value || 0; params[p.key] = [...vals]; update(); }); grid.append(inp); return inp; });
      const presets: [string, number[]][] = [['Enfocar', [0, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, -1, 5, -1, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0]], ['Desenfocar', [0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0]], ['Desenfoque amplio', [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]], ['Bordes', [0, 0, 0, 0, 0, 0, -1, -1, -1, 0, 0, -1, 8, -1, 0, 0, -1, -1, -1, 0, 0, 0, 0, 0, 0]], ['Relieve', [0, 0, 0, 0, 0, 0, -2, -1, 0, 0, 0, -1, 1, 1, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0]]];
      const pre = h('select', {}, h('option', { value: '' }, 'Ejemplos…'), ...presets.map(([n], i) => h('option', { value: String(i) }, n))) as HTMLSelectElement;
      pre.addEventListener('change', () => { const ps = presets[+pre.value]; if (!ps) return; ps[1].forEach((v, i) => { vals[i] = v; inputs[i].value = String(v); }); params[p.key] = [...vals]; update(); pre.value = ''; });
      return h('div', {}, row(p.label, pre), grid);
    }
    if (p.type === 'pattern') return row(p.label, patternSelect(params[p.key], v => { params[p.key] = v; update(); }));
    if (p.type === 'lut') return row(p.label, lutPicker(params, update));
    if (p.type === 'gradient') return row(p.label, gradientButton(params[p.key], s => { params[p.key] = s; update(); }));
    if (p.type === 'select') {
      const sel = h('select', {}, ...p.choices.map(([v, n]: [string, string]) => h('option', { value: v, selected: params[p.key] === v }, n)));
      sel.addEventListener('change', () => { params[p.key] = sel.value; syncShow(); update(); });
      return row(p.label, sel);
    }
    if (p.showIf) { const r = row(p.label, numberSlider({ min: p.min, max: p.max, step: p.step, value: params[p.key], unit: p.unit, onInput: v => { params[p.key] = v; update(); } }).el); conds.push([r, p.showIf]); return r; }
    return row(p.label, numberSlider({ min: p.min, max: p.max, step: p.step, value: params[p.key], unit: p.unit, onInput: v => { params[p.key] = v; update(); } }).el);
  }
  const prev = h('input', { type: 'checkbox', checked: true });
  prev.addEventListener('change', () => { previewOn = prev.checked; update(); });
  const reset = h('button', { class: 'btn', type: 'button' }, 'Restablecer');
  reset.onclick = () => { showDialogClose(); filterDialog(def, edit); };
  let showDialogClose = () => {};
  // Ajustes predefinidos: de serie (Curvas) y los que guarda el usuario
  const presetSel = h('select', { title: 'Ajustes predefinidos' }) as HTMLSelectElement;
  const fillPresets = () => {
    presetSel.innerHTML = '';
    presetSel.append(h('option', { value: '' }, 'Predefinido…'));
    const builtin = BUILTIN_PRESETS[def.id] ?? [], mine = userPresets(def.id);
    if (builtin.length) presetSel.append(h('optgroup', { label: 'De serie' }, ...builtin.map((p, i) => h('option', { value: 'b' + i }, p.name))));
    if (mine.length) presetSel.append(h('optgroup', { label: 'Míos' }, ...mine.map((p, i) => h('option', { value: 'u' + i }, p.name))));
    presetSel.append(h('option', { value: 'save' }, '＋ Guardar los valores actuales…'));
    if (mine.length) presetSel.append(h('option', { value: 'del' }, '🗑 Borrar uno de los míos…'));
  };
  fillPresets();
  presetSel.addEventListener('change', async () => {
    const v = presetSel.value; presetSel.value = '';
    if (v === 'save') { const n = await promptDialog('Guardar ajuste predefinido', 'Nombre', ''); if (n?.trim()) { saveUserPresets(def.id, [...userPresets(def.id), { name: n.trim(), params: JSON.parse(JSON.stringify(params)) }]); fillPresets(); app.toast('Guardado'); } return; }
    if (v === 'del') { const mine = userPresets(def.id); const n = await promptDialog('Borrar ajuste predefinido', 'Nombre exacto (' + mine.map(m => m.name).join(', ') + ')', ''); const i = mine.findIndex(m => m.name === n); if (i >= 0) { mine.splice(i, 1); saveUserPresets(def.id, mine); fillPresets(); } return; }
    const p = v[0] === 'b' ? (BUILTIN_PRESETS[def.id] ?? [])[+v.slice(1)] : userPresets(def.id)[+v.slice(1)];
    if (p) { showDialogClose(); filterDialog(def, edit, p.params); }
  });
  const dlg = showDialog({
    title: def.name.replace('…', '') + (session instanceof ops.SmartFilterSession ? ' (filtro inteligente)' : ''), width: def.custom ? 420 : 400, side: true,
    body: [...body, row('Predefinido', presetSel), h('label', { class: 'check preview-check' }, prev, ' Vista previa')],
    extraButtons: [reset],
    onOk: async () => { clearTimeout(timer); await session.commit(params); ops.setLastFilter(def, params); if (!edit) record({ kind: 'filter', id: def.id, params: JSON.parse(JSON.stringify(params)), label: def.name.replace('…', '') }); },
    onCancel: () => { clearTimeout(timer); session.clearPreview(); },
  });
  showDialogClose = () => { clearTimeout(timer); session.clearPreview(); dlg.close(); };
  update();
}

function drawHistogram(ctx: CanvasRenderingContext2D, hist: Uint32Array, w: number, hh: number, color = 'rgba(200,200,200,.55)') {
  let max = 0; for (let i = 0; i < 256; i++) max = Math.max(max, hist[i]);
  // Escala con raíz para que los picos no aplasten el resto
  ctx.fillStyle = color;
  for (let i = 0; i < 256; i++) {
    const v = max ? Math.sqrt(hist[i] / max) * hh : 0;
    ctx.fillRect(i * w / 256, hh - v, Math.ceil(w / 256), v);
  }
}

export function levelsBody(src: ImageData, p: any, update: () => void): HTMLElement[] {
  const W = 360, H = 120;
  const cv = h('canvas', { width: W, height: H + 18, class: 'hist' });
  const ctx = cv.getContext('2d')!;
  const hist = histogram(src);
  const fields: Record<string, HTMLInputElement> = {};
  const draw = () => {
    ctx.clearRect(0, 0, W, H + 18);
    ctx.fillStyle = '#1b1c1f'; ctx.fillRect(0, 0, W, H);
    drawHistogram(ctx, hist, W, H);
    const gx = p.inBlack + (p.inWhite - p.inBlack) * Math.pow(0.5, p.gamma);
    const tri = (x: number, fill: string) => {
      const px = x / 255 * W;
      ctx.fillStyle = fill; ctx.strokeStyle = '#888'; ctx.beginPath();
      ctx.moveTo(px, H + 2); ctx.lineTo(px - 6, H + 14); ctx.lineTo(px + 6, H + 14); ctx.closePath(); ctx.fill(); ctx.stroke();
    };
    tri(p.inBlack, '#000'); tri(gx, '#888'); tri(p.inWhite, '#fff');
  };
  const sync = () => { for (const k of Object.keys(fields)) fields[k].value = String(k === 'gamma' ? (+p[k]).toFixed(2) : Math.round(p[k])); draw(); };
  let dragging: 'inBlack' | 'inWhite' | 'gamma' | null = null;
  cv.addEventListener('pointerdown', e => {
    const x = e.offsetX * (W / (cv.clientWidth || W)) / W * 255;
    const gx = p.inBlack + (p.inWhite - p.inBlack) * Math.pow(0.5, p.gamma);
    const d = [['inBlack', p.inBlack], ['gamma', gx], ['inWhite', p.inWhite]].map(([k, v]) => [k, Math.abs((v as number) - x)] as const).sort((a, b) => a[1] - b[1]);
    dragging = d[0][0] as any; cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', e => {
    if (!dragging) return;
    const x = Math.max(0, Math.min(255, e.offsetX * (W / (cv.clientWidth || W)) / W * 255));
    if (dragging === 'inBlack') p.inBlack = Math.min(x, p.inWhite - 2);
    else if (dragging === 'inWhite') p.inWhite = Math.max(x, p.inBlack + 2);
    else { const t = Math.min(0.99, Math.max(0.01, (x - p.inBlack) / (p.inWhite - p.inBlack))); p.gamma = Math.min(9.99, Math.max(0.1, Math.log(t) / Math.log(0.5))); }
    sync(); update();
  });
  cv.addEventListener('pointerup', () => dragging = null);
  const f = (key: string, min: number, max: number, step = 1) => {
    const i = h('input', { type: 'number', min: String(min), max: String(max), step: String(step), class: 'num' });
    i.addEventListener('change', () => { p[key] = Math.min(max, Math.max(min, +i.value)); sync(); update(); });
    fields[key] = i; return i;
  };
  const els = [
    h('div', { class: 'hint' }, 'Entrada (arrastra los triángulos):'), cv,
    h('div', { class: 'levels-row' }, f('inBlack', 0, 253), f('gamma', 0.1, 9.99, 0.01), f('inWhite', 2, 255)),
    h('div', { class: 'hint' }, 'Salida:'),
    h('div', { class: 'levels-row' }, f('outBlack', 0, 255), f('outWhite', 0, 255)),
  ];
  sync();
  void levelsLut;
  return els;
}

export function curvesBody(src: ImageData, p: any, update: () => void): HTMLElement[] {
  const S = 300;
  const cv = h('canvas', { width: S, height: S, class: 'curves' });
  const ctx = cv.getContext('2d')!;
  let ch: 'rgb' | 'r' | 'g' | 'b' = 'rgb';
  const hists: Record<string, Uint32Array> = {};
  const sel = h('select', {}, h('option', { value: 'rgb' }, 'RGB'), h('option', { value: 'r' }, 'Rojo'), h('option', { value: 'g' }, 'Verde'), h('option', { value: 'b' }, 'Azul'));
  const readout = h('span', { class: 'hint' }, '');
  sel.addEventListener('change', () => { ch = sel.value as any; active = -1; draw(); });
  let active = -1;
  const pts = () => p[ch] as CurvePoint[];
  const toPx = (v: number) => v / 255 * S;
  const draw = () => {
    ctx.fillStyle = '#1b1c1f'; ctx.fillRect(0, 0, S, S);
    hists[ch] ??= histogram(src, ch);
    drawHistogram(ctx, hists[ch], S, S, 'rgba(160,160,160,.3)');
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 1; i < 4; i++) { ctx.moveTo(i * S / 4 + .5, 0); ctx.lineTo(i * S / 4 + .5, S); ctx.moveTo(0, i * S / 4 + .5); ctx.lineTo(S, i * S / 4 + .5); }
    ctx.moveTo(0, S); ctx.lineTo(S, 0); ctx.stroke();
    const lut = curveLut(pts());
    ctx.strokeStyle = { rgb: '#e8e8e8', r: '#ff5a5a', g: '#4cd964', b: '#4ea1ff' }[ch]; ctx.lineWidth = 2; ctx.beginPath();
    for (let x = 0; x < 256; x++) { const px = toPx(x), py = S - toPx(lut[x]); x ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke();
    pts().forEach((q, i) => {
      ctx.fillStyle = i === active ? '#fff' : '#1b1c1f'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(toPx(q[0]) - 4, S - toPx(q[1]) - 4, 8, 8); ctx.fill(); ctx.stroke();
    });
    if (active >= 0) readout.textContent = `Entrada: ${Math.round(pts()[active][0])}  ·  Salida: ${Math.round(pts()[active][1])}`;
  };
  let dragging = false;
  const kk = () => S / (cv.clientWidth || S);
  const pos = (e: PointerEvent) => ({ x: Math.max(0, Math.min(255, e.offsetX * kk() / S * 255)), y: Math.max(0, Math.min(255, (S - e.offsetY * kk()) / S * 255)) });
  cv.addEventListener('pointerdown', e => {
    const q = pos(e);
    const list = pts();
    active = list.findIndex(pt => Math.abs(pt[0] - q.x) < 8 && Math.abs(pt[1] - q.y) < 8);
    if (active < 0) {
      list.push([Math.round(q.x), Math.round(q.y)]);
      list.sort((a, b) => a[0] - b[0]);
      active = list.findIndex(pt => pt[0] === Math.round(q.x));
    }
    dragging = true; cv.setPointerCapture(e.pointerId); draw(); update();
  });
  cv.addEventListener('pointermove', e => {
    if (!dragging || active < 0) return;
    const q = pos(e), list = pts();
    const out = (e.offsetY * kk() < -20 || e.offsetY * kk() > S + 20) && list.length > 2 && active > 0 && active < list.length - 1;
    if (out) { list.splice(active, 1); active = -1; dragging = false; draw(); update(); return; }
    const lo = active > 0 ? list[active - 1][0] + 1 : 0, hi = active < list.length - 1 ? list[active + 1][0] - 1 : 255;
    list[active] = [Math.round(Math.min(hi, Math.max(lo, q.x))), Math.round(q.y)];
    draw(); update();
  });
  cv.addEventListener('pointerup', () => dragging = false);
  cv.addEventListener('dblclick', () => {
    const list = pts();
    if (active > 0 && active < list.length - 1) { list.splice(active, 1); active = -1; draw(); update(); }
  });
  draw();
  return [row('Canal', sel), cv, h('div', { class: 'hint' }, 'Clic para añadir un punto; arrástralo fuera o haz doble clic para quitarlo.'), readout];
}

// ---- Estilo de capa -------------------------------------------------------------------

export function layerStyleDialog() {
  const d = app.doc, l = d?.active; if (!d || !l) return;
  if (l.kind === 'adjust') { app.toast('Las capas de ajuste no admiten estilos', 'warn'); return; }
  const before = l.styles ? JSON.parse(JSON.stringify(l.styles)) : null;
  const st: Required<LayerStyles> = {
    shadow: { enabled: false, color: '#000000', opacity: 60, angle: 120, distance: 8, blur: 10, spread: 0 },
    stroke: { enabled: false, color: '#000000', size: 3, position: 'outside', opacity: 100 },
    glow: { enabled: false, color: '#ffffaa', opacity: 75, size: 12, spread: 0 },
    satin: { enabled: false, color: '#000000', opacity: 50, angle: 19, distance: 11, size: 14, invert: true },
    innerShadow: { enabled: false, color: '#000000', opacity: 60, angle: 120, distance: 6, blur: 8 },
    innerGlow: { enabled: false, color: '#ffffaa', opacity: 75, size: 10 },
    colorOverlay: { enabled: false, color: '#ff0000', opacity: 100 },
    gradientOverlay: { enabled: false, opacity: 100, angle: 90, stops: [[0, '#000000'], [1, '#ffffff']] },
    bevel: { ...BEVEL_DEFAULT },
    patternOverlay: { enabled: false, pattern: allPatterns()[0]?.id ?? '', scale: 100, opacity: 100 },
    ...(before ? JSON.parse(JSON.stringify(before)) : {}),
  };
  const update = () => ops.setLayerStyles(l, JSON.parse(JSON.stringify(st)), false);
  const section = (title: string, obj: any, fields: [string, string, number, number, string?][]) => {
    const on = h('input', { type: 'checkbox', checked: obj.enabled });
    const color = h('input', { type: 'color', class: 'color-input', value: obj.color ?? '#000000', style: { display: obj.color === undefined ? 'none' : '' } });
    const enable = () => { if (!obj.enabled) { obj.enabled = true; on.checked = true; } };
    on.onchange = () => { obj.enabled = on.checked; update(); };
    color.oninput = () => { obj.color = color.value; enable(); update(); };
    return [h('div', { class: 'style-head' }, h('label', { class: 'check' }, on, h('b', {}, ' ' + title)), color),
      ...fields.map(([key, label, min, max, unit]) => row(label, numberSlider({ min, max, value: obj[key], unit, onInput: v => { obj[key] = v; enable(); update(); } }).el))];
  };
  const gradSection = () => {
    const g = st.gradientOverlay, els = section('Superposición de degradado', g, [['opacity', 'Opacidad', 0, 100, '%'], ['angle', 'Ángulo', -180, 180, '°']]);
    const pick = (i: number) => { const c = h('input', { type: 'color', class: 'color-input', value: g.stops[i][1] }); c.oninput = () => { g.stops[i][1] = c.value; g.enabled = true; (els[0].querySelector('input') as HTMLInputElement).checked = true; update(); }; return c; };
    void pick;
    els.push(row('Degradado', gradientButton(g.stops.map(([t, c]) => ({ t, color: c, a: 1 })), st2 => { g.stops = st2.map(x => [x.t, x.color] as [number, string]); if (!g.enabled) { g.enabled = true; (els[0].querySelector('input') as HTMLInputElement).checked = true; } update(); })));
    return els;
  };
  const bevelSection = () => {
    const b = st.bevel, els = section('Bisel y relieve', b, [['depth', 'Profundidad', 1, 1000, '%'], ['size', 'Tamaño', 0, 250, 'px'], ['soften', 'Suavizar', 0, 16, 'px'], ['angle', 'Ángulo', -180, 180, '°'], ['altitude', 'Altitud', 0, 90, '°'], ['highlightOpacity', 'Opacidad luces', 0, 100, '%'], ['shadowOpacity', 'Opacidad sombras', 0, 100, '%']]);
    const enable = () => { if (!b.enabled) { b.enabled = true; (els[0].querySelector('input') as HTMLInputElement).checked = true; } };
    const style = h('select', {}, ...([['inner', 'Bisel interior'], ['outer', 'Bisel exterior'], ['emboss', 'Relieve'], ['pillow', 'Relieve acolchado']] as const).map(([v, n]) => h('option', { value: v, selected: b.style === v }, n)));
    style.onchange = () => { b.style = style.value as any; enable(); update(); };
    const dir = h('select', {}, h('option', { value: 'up', selected: b.up }, 'Arriba'), h('option', { value: 'down', selected: !b.up }, 'Abajo'));
    dir.onchange = () => { b.up = dir.value === 'up'; enable(); update(); };
    const col = (key: 'highlight' | 'shadowColor') => { const c = h('input', { type: 'color', class: 'color-input', value: b[key] }); c.oninput = () => { b[key] = c.value; enable(); update(); }; return c; };
    els.splice(1, 0, row('Estilo', style), row('Dirección', dir));
    els.push(row('Colores', h('span', {}, 'Luces '), col('highlight'), h('span', {}, ' Sombras '), col('shadowColor')));
    return els;
  };
  const strokeSection = () => {
    const sk = st.stroke as any, els = section('Trazo', sk, [['size', 'Grosor', 1, 250, 'px'], ['opacity', 'Opacidad', 0, 100, '%']]);
    const pos = h('select', {}, ...([['outside', 'Exterior'], ['inside', 'Interior'], ['center', 'Centro']] as const).map(([v, n]) => h('option', { value: v, selected: (sk.position ?? 'outside') === v }, n)));
    pos.onchange = () => { sk.position = pos.value; if (!sk.enabled) { sk.enabled = true; (els[0].querySelector('input') as HTMLInputElement).checked = true; } update(); };
    els.splice(1, 0, row('Posición', pos));
    return els;
  };
  const satinSection = () => {
    const sa = st.satin as any, els = section('Satinado', sa, [['opacity', 'Opacidad', 0, 100, '%'], ['angle', 'Ángulo', -180, 180, '°'], ['distance', 'Distancia', 1, 250, 'px'], ['size', 'Tamaño', 0, 250, 'px']]);
    const inv = h('input', { type: 'checkbox', checked: !!sa.invert }); inv.onchange = () => { sa.invert = inv.checked; update(); };
    els.push(row('', h('label', { class: 'check' }, inv, ' Invertir')));
    return els;
  };
  const patSection = () => {
    const po = st.patternOverlay, els = section('Superposición de motivo', po, [['opacity', 'Opacidad', 0, 100, '%'], ['scale', 'Escala', 1, 1000, '%']]);
    els.splice(1, 0, row('Motivo', patternSelect(po.pattern, v => { po.pattern = v; if (!po.enabled) { po.enabled = true; (els[0].querySelector('input') as HTMLInputElement).checked = true; } update(); })));
    return els;
  };
  // Fusionar si: como en las opciones de fusión de Photoshop (con transición suave)
  const bi = l.styles?.blendIf ?? { this: [0, 0, 255, 255] as [number, number, number, number], under: [0, 0, 255, 255] as [number, number, number, number] };
  const biState = { tb: bi.this[1], tw: bi.this[2], tsoft: bi.this[1] - bi.this[0], ub: bi.under[1], uw: bi.under[2], usoft: bi.under[1] - bi.under[0] };
  const syncBI = () => {
    const r = (b: number, w: number, s: number): [number, number, number, number] => [Math.max(0, b - s), b, w, Math.min(255, w + s)];
    (st as any).blendIf = { this: r(biState.tb, biState.tw, biState.tsoft), under: r(biState.ub, biState.uw, biState.usoft) };
    update();
  };
  const biSlider = (label: string, key: keyof typeof biState, max = 255) => row(label, numberSlider({ min: 0, max, value: biState[key], onInput: v => { biState[key] = Math.round(v); syncBI(); } }).el);
  const blendIfEls = [h('div', { class: 'style-head' }, h('b', {}, 'Fusionar si (luminosidad)')),
    h('div', { class: 'hint' }, 'Oculta las zonas de esta capa más oscuras o más claras que los límites, o deja ver la de debajo donde sea muy oscura o muy clara.'),
    biSlider('Esta capa: negros', 'tb'), biSlider('Esta capa: blancos', 'tw'), biSlider('Transición', 'tsoft', 128),
    biSlider('Debajo: negros', 'ub'), biSlider('Debajo: blancos', 'uw'), biSlider('Transición', 'usoft', 128)];
  showDialog({
    title: `Estilo de capa: ${l.name}`, width: 400, side: true,
    body: [
      ...section('Sombra paralela', st.shadow, [['opacity', 'Opacidad', 0, 100, '%'], ['angle', 'Ángulo', -180, 180, '°'], ['distance', 'Distancia', 0, 200, 'px'], ['spread', 'Extensión', 0, 100, '%'], ['blur', 'Tamaño', 0, 200, 'px']]),
      ...strokeSection(),
      ...section('Resplandor exterior', st.glow, [['opacity', 'Opacidad', 0, 100, '%'], ['spread', 'Extensión', 0, 100, '%'], ['size', 'Tamaño', 1, 200, 'px']]),
      ...satinSection(),
      ...section('Sombra interior', st.innerShadow, [['opacity', 'Opacidad', 0, 100, '%'], ['angle', 'Ángulo', -180, 180, '°'], ['distance', 'Distancia', 0, 200, 'px'], ['blur', 'Tamaño', 0, 200, 'px']]),
      ...section('Resplandor interior', st.innerGlow, [['opacity', 'Opacidad', 0, 100, '%'], ['size', 'Tamaño', 1, 200, 'px']]),
      ...section('Superposición de color', st.colorOverlay, [['opacity', 'Opacidad', 0, 100, '%']]),
      ...gradSection(),
      ...patSection(),
      ...bevelSection(),
      ...blendIfEls,
    ],
    onOk: () => { const any = Object.values(st).some((x: any) => x.enabled) || blendIfActive(st as any); l.styles = before; ops.setLayerStyles(l, any || before ? JSON.parse(JSON.stringify(st)) : null, true); },
    onCancel: () => ops.setLayerStyles(l, before, false),
  });
}

export function loadSelectionDialog() {
  const d = app.doc; if (!d) return;
  if (!d.channels.length) { app.toast('No hay selecciones guardadas', 'warn'); return; }
  const ch = h('select', {}, ...d.channels.map(c => h('option', { value: String(c.id) }, c.name)));
  const mode = h('select', {}, h('option', { value: 'new' }, 'Nueva selección'), h('option', { value: 'add' }, 'Añadir a la selección'), h('option', { value: 'subtract' }, 'Restar de la selección'), h('option', { value: 'intersect' }, 'Intersecar con la selección'));
  const inv = h('input', { type: 'checkbox' });
  showDialog({ title: 'Cargar selección', body: [row('Canal', ch), row('Operación', mode), h('label', { class: 'check' }, inv, ' Invertir')], onOk: () => ops.loadChannel(+ch.value, mode.value as any, inv.checked) });
}

export function exportLayersDialog() {
  if (!app.doc) return;
  const trim = h('input', { type: 'checkbox', checked: true }), vis = h('input', { type: 'checkbox', checked: false });
  showDialog({ title: 'Exportar capas a archivos', okLabel: 'Exportar', body: [h('p', {}, 'Cada capa se guarda como un PNG independiente, todas juntas en un archivo ZIP.'), h('label', { class: 'check' }, trim, ' Recortar cada capa a su contenido'), h('label', { class: 'check' }, vis, ' Solo capas visibles')], onOk: () => { ops.exportLayers(trim.checked, vis.checked); } });
}

// ---- Lote -------------------------------------------------------------------------------

/** Archivo › Automatizar › Lote: aplica una acción a muchas imágenes y las descarga en un ZIP. */
export function batchDialog() {
  const list = macros();
  const act = h('select', {}, ...list.map((m, i) => h('option', { value: String(i) }, m.name)));
  const fmt = h('select', {}, h('option', { value: 'image/jpeg' }, 'JPG'), h('option', { value: 'image/png' }, 'PNG'), h('option', { value: 'image/webp' }, 'WebP'));
  let q = 90; const qs = numberSlider({ min: 1, max: 100, value: 90, unit: '%', onInput: v => q = v });
  const info = h('div', { class: 'hint' }, 'Elige las imágenes al pulsar «Elegir imágenes y procesar». Todo ocurre en tu equipo.');
  showDialog({
    title: 'Procesar por lotes', okLabel: 'Elegir imágenes y procesar',
    body: [row('Acción', act), row('Guardar como', fmt), row('Calidad', qs.el), info],
    onOk: async () => {
      const files = (await io.pickFiles('image/*,.psd')).filter(f => !io.isProjectFile(f));
      if (!files.length) return;
      const m = list[+act.value], out: { name: string; data: Uint8Array }[] = [], ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[fmt.value]!;
      const prev = app.doc;
      for (const [i, f] of files.entries()) {
        app.toast(`Procesando ${i + 1} de ${files.length}: ${f.name}`);
        try {
          const doc = io.isPsdFile(f) ? (await (await import('../io/psd')).readPsd(await f.arrayBuffer(), io.baseName(f.name))).doc : await io.documentFromImage(f, f.name);
          app.addDocument(doc);
          await play(m);
          const b = await io.exportImage(doc, fmt.value as any, q / 100);
          out.push({ name: io.baseName(f.name) + ext, data: new Uint8Array(await b.arrayBuffer()) });
          app.closeDocument(doc);
        } catch (e: any) { app.toast(`No se pudo procesar ${f.name}: ${e?.message ?? e}`, 'warn'); }
      }
      if (prev && app.docs.includes(prev)) app.setDocument(prev);
      if (!out.length) return;
      const { makeZip } = await import('../io/zip');
      await io.saveBlob(makeZip(out), `${m.name} - lote.zip`);
      app.toast(`${out.length} imágenes procesadas`);
    },
  });
}

// ---- Ayuda ----------------------------------------------------------------------------

export function shortcutsDialog(list: [string, string][]) {
  const table = h('table', { class: 'shortcuts' }, ...list.map(([k, v]) => h('tr', {}, h('td', {}, v), h('td', {}, h('kbd', {}, k)))));
  showDialog({ title: 'Atajos de teclado', width: 520, body: h('div', { class: 'scroll' }, table), cancelLabel: null, okLabel: 'Cerrar' });
}

export function aboutDialog() {
  showDialog({
    title: 'Acerca de Editor', cancelLabel: null, okLabel: 'Cerrar',
    body: [
      h('p', {}, h('b', {}, 'Editor'), ' — editor de imágenes por capas que funciona en tu navegador.'),
      h('p', {}, 'Todo se procesa en tu equipo: tus imágenes no se envían a ningún servidor.'),
      h('p', {}, 'Funciona sin conexión una vez abierto y se puede instalar como aplicación desde el navegador.'),
      h('p', { class: 'hint' }, `Versión 1.0 · ${typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : ''}`),
    ],
  });
}

// ---- Guía rápida ---------------------------------------------------------------------------

export function quickGuideDialog() {
  const sec = (t: string, ...items: (string | HTMLElement)[]) => h('div', { class: 'guide-sec' }, h('h3', {}, t), h('ul', {}, ...items.map(x => h('li', {}, x))));
  const k = (s: string) => h('kbd', {}, s);
  showDialog({
    title: 'Guía rápida', cancelLabel: null, okLabel: 'Entendido', width: 620,
    body: [h('div', { class: 'guide' },
      sec('Empezar',
        'Abre una imagen (Archivo › Abrir, o arrástrala a la ventana), crea un documento nuevo o pega una imagen con Ctrl+V.',
        'Guarda tu trabajo como proyecto (.edp) para seguir editando más tarde, o expórtalo como PNG, JPG, WebP, TIFF, PSD, PDF, SVG o ICO.',
        'Abre y guarda archivos de Photoshop (.psd y .psb) con sus capas, máscaras, textos, estilos y ajustes. También abre TIFF, TGA y RAW de cámara.',
        'Archivo › Abrir reciente (y la pantalla de inicio) muestra los últimos archivos que abriste.'),
      sec('Atajos para fotos',
        'Capa › Quitar fondo deja solo el sujeto; Edición › Sustituir cielo cambia el cielo de una foto.',
        'El Parche y el Pincel corrector puntual (J) borran manchas y objetos; Movimiento con detección de contenido los cambia de sitio.',
        'El panel Estilos (junto a Color) aplica efectos listos a textos y formas con un clic: neón, oro, pegatina, sombra…'),
      sec('Herramientas',
        'La barra de la izquierda tiene las herramientas; las que tienen un triángulo esconden más: mantén pulsado o haz clic derecho.',
        'Cada herramienta tiene su letra (pasa el ratón por encima para verla). Si mantienes la letra pulsada, la herramienta solo se activa mientras la sueltas.',
        'La barra de arriba muestra las opciones de la herramienta activa. En pantallas pequeñas, las que no caben están en «Más».'),
      sec('Capas',
        'Todo se hace sobre la capa seleccionada en el panel Capas. Las capas de ajuste y de relleno no estropean la imagen: se pueden cambiar o quitar cuando quieras.',
        'Con una selección activa (marco, lazo, varita, Seleccionar sujeto…) los cambios solo afectan a esa zona.',
        'Los objetos inteligentes se escalan y giran sin perder calidad; doble clic en su miniatura para editar su contenido.'),
      sec('Atajos más útiles',
        h('span', {}, k('Ctrl+Z'), ' deshacer · ', k('Ctrl+T'), ' transformar · ', k('Ctrl+J'), ' duplicar capa · ', k('Ctrl+D'), ' deseleccionar'),
        h('span', {}, k('Espacio'), ' + arrastrar: moverse · ', k('Alt'), ' + rueda: zoom · ', k('Ctrl+0'), ' ajustar a la pantalla'),
        h('span', {}, k('[ ]'), ' tamaño del pincel · ', k('X'), ' intercambiar colores · ', k('Alt'), ' + clic con el pincel: tomar color'),
        h('span', {}, 'Ayuda › Atajos de teclado muestra la lista completa.')),
      sec('Privacidad',
        'Todo se procesa en tu navegador: tus imágenes nunca se envían a ningún servidor.',
        'Solo se descargan de internet las fuentes de la biblioteca que elijas usar (de Google Fonts).',
        'Se guarda automáticamente una copia de recuperación en este navegador por si se cierra la pestaña.'),
    )],
  });
}

// ---- Deformar texto ------------------------------------------------------------------

export function warpTextDialog(l: TextLayer) {
  const d = app.doc; if (!d) return;
  const before = l.props.warp ? { ...l.props.warp } : undefined;
  const w = { style: before?.style ?? 'arc', bend: before?.bend ?? 50 };
  const apply = () => { l.props.warp = { ...w }; l.render(); d.invalidate(); app.viewport.requestRender(); };
  const style = h('select', {}, ...Object.entries(WARP_STYLES).map(([k, n]) => h('option', { value: k, selected: k === w.style }, k === 'none' ? 'Ninguno' : n)));
  style.addEventListener('change', () => { w.style = style.value; apply(); });
  const bend = numberSlider({ min: -100, max: 100, value: w.bend, unit: '%', onInput: v => { w.bend = v; apply(); } });
  apply();
  showDialog({
    title: 'Deformar texto', width: 380, side: true,
    body: [row('Estilo', style), row('Curvatura', bend.el), h('div', { class: 'hint' }, 'El texto sigue siendo editable: puedes cambiarlo o quitar la deformación cuando quieras.')],
    onOk: () => { if (w.style === 'none') delete l.props.warp; l.render(); d.commit('Deformar texto'); },
    onCancel: () => { if (before) l.props.warp = before; else delete l.props.warp; l.render(); d.invalidate(); app.viewport.requestRender(); },
  });
}

// ---- Nueva mesa de trabajo --------------------------------------------------------------

export function artboardDialog() {
  const d = app.doc; if (!d) return;
  const n = ops.artboards(d).length;
  const name = h('input', { type: 'text', value: `Mesa de trabajo ${n ? n + 1 : 2}`, class: 'wide' });
  const w = numInput(1080), hh = numInput(1080);
  const preset = h('select', {}, ...PRESETS.map(([pn], i) => h('option', { value: String(i) }, pn)));
  preset.value = '4';
  preset.addEventListener('change', () => { const p = PRESETS[+preset.value]; if (p[1]) { w.value = String(p[1]); hh.value = String(p[2]); } });
  [w, hh].forEach(i => i.addEventListener('input', () => preset.value = '0'));
  const bg = h('select', {}, h('option', { value: '#ffffff' }, 'Blanco'), h('option', { value: '#000000' }, 'Negro'), h('option', { value: 'bgc' }, 'Color de fondo'), h('option', { value: '' }, 'Transparente'));
  showDialog({
    title: 'Nueva mesa de trabajo', okLabel: 'Crear',
    body: [row('Nombre', name), row('Predefinido', preset), row('Anchura', w, 'px'), row('Altura', hh, 'px'), row('Fondo', bg),
      h('div', { class: 'hint' }, n ? 'Se coloca a la derecha de las demás.' : 'Lo que ya hay en el documento pasará a ser la primera mesa de trabajo.')],
    onOk: () => {
      const W = Math.round(+w.value), H = Math.round(+hh.value);
      if (!(W >= 1 && H >= 1 && W <= 20000 && H <= 20000)) { app.toast('Tamaño no válido', 'warn'); return false; }
      ops.newArtboard(W, H, bg.value === 'bgc' ? app.bg : bg.value || null, name.value.trim() || undefined);
    },
  });
}

// ---- Rotación arbitraria del lienzo ---------------------------------------------------------

export function rotateArbitraryDialog() {
  if (!app.doc) return;
  const ang = h('input', { type: 'number', class: 'num', value: '15', step: '0.1', min: '-359.9', max: '359.9' });
  const dir = h('select', {}, h('option', { value: '1' }, 'Horario'), h('option', { value: '-1' }, 'Antihorario'));
  const fill = h('select', {}, h('option', { value: 'bg' }, 'Con el color de fondo'), h('option', { value: 'content' }, 'Según el contenido (se inventan)'), h('option', { value: 'none' }, 'Transparentes')) as HTMLSelectElement;
  showDialog({
    title: 'Rotar lienzo', okLabel: 'Rotar',
    body: [row('Ángulo', ang, '°'), row('Sentido', dir), row('Esquinas', fill)],
    onOk: () => { const v = parseFloat(ang.value); if (!isFinite(v) || !v) return; ops.rotateImageArbitrary(v * +dir.value, fill.value === 'content' ? 'content' : fill.value === 'bg'); },
  });
}

// ---- Edición › Transición (atenuar el último filtro o trazo) ------------------------------

export function fadeDialog() {
  const d = app.doc, l = d?.active; if (!d || !l) return;
  const H = d.history, prev = H.steps[H.index - 1], last = H.steps[H.index];
  const before = prev ? layerCanvasIn(prev.snap, l.id) : null;
  if (!before || !(l as any).canvas || before === (l as any).canvas || l.kind !== 'raster') { app.toast('No hay nada que atenuar en esta capa', 'warn'); return; }
  const after = cloneCanvas((l as any).canvas);
  let op = 100, mode = 'source-over';
  const bd = ctx2d(before).getImageData(0, 0, before.width, before.height).data, ad = ctx2d(after).getImageData(0, 0, after.width, after.height).data;
  const apply = () => {
    const c = cloneCanvas(before), x = ctx2d(c), k = op / 100;
    if (mode === 'source-over' && before.width === after.width && before.height === after.height) {
      // Normal: mezcla directa entre el antes y el después (también la transparencia)
      const img = x.createImageData(c.width, c.height), o = img.data;
      for (let i = 0; i < o.length; i += 4) {
        const a0 = bd[i + 3], a1 = ad[i + 3], a = a0 + (a1 - a0) * k;
        if (a <= 0) continue;
        for (let ch = 0; ch < 3; ch++) o[i + ch] = (bd[i + ch] * a0 * (1 - k) + ad[i + ch] * a1 * k) / a;
        o[i + 3] = a;
      }
      x.putImageData(img, 0, 0);
    } else { x.globalAlpha = k; x.globalCompositeOperation = mode as GlobalCompositeOperation; x.drawImage(after, 0, 0); }
    (l as any).canvas = c; (l as any).touch(); d.invalidate(); app.viewport.requestRender();
  };
  const modes: [string, string][] = [['source-over', 'Normal'], ['multiply', 'Multiplicar'], ['screen', 'Trama'], ['overlay', 'Superponer'], ['soft-light', 'Luz suave'], ['hard-light', 'Luz fuerte'], ['darken', 'Oscurecer'], ['lighten', 'Aclarar'], ['difference', 'Diferencia'], ['color', 'Color'], ['luminosity', 'Luminosidad'], ['hue', 'Tono'], ['saturation', 'Saturación']];
  const sel = h('select', {}, ...modes.map(([v, n]) => h('option', { value: v }, n)));
  sel.addEventListener('change', () => { mode = sel.value; apply(); });
  showDialog({
    title: `Transición: ${last.name}`, side: true,
    body: [row('Opacidad', numberSlider({ min: 0, max: 100, value: 100, unit: '%', onInput: v => { op = v; apply(); } }).el), row('Modo', sel)],
    onOk: () => { apply(); d.commit(`Transición: ${last.name}`); },
    onCancel: () => { (l as any).canvas = after; (l as any).touch(); d.invalidate(); app.viewport.requestRender(); },
  });
}

/** Botón para cargar un LUT .cube en los parámetros de «Consulta de colores». */
export function lutPicker(params: any, onChange: () => void): HTMLElement {
  const name = h('span', { class: 'hint' }, params.lutName ?? 'Ningún archivo');
  const b = h('button', { class: 'btn', type: 'button' }, 'Cargar .cube…');
  b.onclick = async () => {
    const [f] = await io.pickFiles('.cube', false); if (!f) return;
    try {
      const { parseCube, lutToB64 } = await import('../filters/lut');
      const l = parseCube(await f.text());
      params.lutData = lutToB64(l.data); params.lutSize = l.size; params.lutName = f.name; params.preset = 'file';
      name.textContent = f.name;
      // el desplegable de looks pasa a «Archivo .cube cargado»
      const sel = b.closest('.modal, .panel-body, .props')?.querySelector('select') as HTMLSelectElement | null; if (sel) sel.value = 'file';
      onChange();
    } catch (e: any) { app.toast(e?.message ?? 'No se pudo leer el archivo', 'warn'); }
  };
  return h('div', { class: 'pat-select' }, b, name);
}

/** Barra con un degradado; al pulsarla se abre el editor de degradados. */
export function gradientButton(stops: GradStop[], onChange: (s: GradStop[]) => void): HTMLElement {
  const c = h('canvas', { width: 200, height: 18, class: 'grad-btn', title: 'Pulsa para editar el degradado' });
  const paint = (s: GradStop[]) => {
    const x = c.getContext('2d')!; x.clearRect(0, 0, 200, 18);
    for (let i = 0; i < 200; i += 6) for (let j = 0; j < 18; j += 6) { x.fillStyle = ((i + j) / 6) % 2 ? '#cfcfcf' : '#fff'; x.fillRect(i, j, 6, 6); }
    const g = x.createLinearGradient(0, 0, 200, 0);
    for (const st of [...s].sort((a, b) => a.t - b.t)) { const n = parseInt(st.color.slice(1, 7), 16); g.addColorStop(Math.max(0, Math.min(1, st.t)), `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${st.a ?? 1})`); }
    x.fillStyle = g; x.fillRect(0, 0, 200, 18);
  };
  paint(stops);
  c.addEventListener('click', () => gradientEditor(stops, s => { stops = s; paint(s); onChange(s); }));
  return c;
}

// ---- Escala según el contenido -------------------------------------------------------------

export function contentAwareScaleDialog() {
  if (!app.doc) return;
  let wp = 70, hp = 100;
  const skin = h('input', { type: 'checkbox', checked: true }), sel = h('input', { type: 'checkbox', checked: !!app.doc.selection.mask });
  showDialog({
    title: 'Escala según el contenido', okLabel: 'Aplicar',
    body: [row('Anchura', numberSlider({ min: 20, max: 200, value: wp, unit: '%', onInput: v => wp = v }).el), row('Altura', numberSlider({ min: 20, max: 200, value: hp, unit: '%', onInput: v => hp = v }).el),
      row('', h('label', { class: 'check' }, skin, ' Proteger tonos de piel')), row('', h('label', { class: 'check' }, sel, ' Proteger lo seleccionado')),
      h('div', { class: 'hint' }, 'Se quitan o se repiten las franjas con menos detalle: el fondo se estira o encoge y las personas y objetos importantes no se deforman.')],
    onOk: () => { ops.contentAwareScaleOp(wp, hp, skin.checked, sel.checked); },
  });
}

// ---- Atajos de teclado personalizables ---------------------------------------------------

export function keysDialog() {
  const search = h('input', { type: 'search', class: 'wide', placeholder: 'Buscar orden…' });
  const list = h('div', { class: 'keys-list' });
  const pretty = (k: string) => k.replace('Shift', 'Mayús').replace('Delete', 'Supr').replace('Backspace', 'Retroceso');
  const render = () => {
    list.innerHTML = '';
    const q = search.value.trim().toLowerCase();
    for (const a of ACTIONS) {
      if (q && !a.label.toLowerCase().includes(q) && !(a.keys ?? []).some(k => k.toLowerCase().includes(q))) continue;
      const btn = h('button', { class: 'btn key-btn', type: 'button', title: 'Pulsa para cambiar (Retroceso: quitar)' }, a.keys?.length ? pretty(a.keys[0]) : '—');
      btn.onclick = () => {
        btn.textContent = 'Pulsa la combinación…'; btn.classList.add('wait');
        const onKey = (e: KeyboardEvent) => {
          e.preventDefault(); e.stopPropagation();
          if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
          window.removeEventListener('keydown', onKey, true);
          if (e.key === 'Escape') { render(); return; }
          const combo = e.key === 'Backspace' || e.key === 'Delete' ? null : keyString(e);
          const taken = setActionKey(a.id, combo);
          if (taken) app.toast(`«${combo}» se ha quitado de «${taken}»`);
          render();
        };
        window.addEventListener('keydown', onKey, true);
      };
      list.append(h('div', { class: 'key-row' }, h('span', {}, a.label.replace('…', '')), btn));
    }
  };
  search.addEventListener('input', render);
  render();
  const reset = h('button', { class: 'btn', type: 'button', onclick: () => { resetKeys(); render(); app.toast('Atajos restablecidos'); } }, 'Restablecer los de fábrica');
  showDialog({ title: 'Atajos de teclado', cancelLabel: null, okLabel: 'Cerrar', width: 520, body: [search, list, reset] });
  setTimeout(() => search.focus(), 0);
}

// ---- Vista › Nueva disposición de guías ---------------------------------------------------------

export function guideLayoutDialog() {
  const d = app.doc; if (!d) return;
  const num = (v: number) => h('input', { type: 'number', class: 'num', value: v, min: 0, step: 1, style: 'width:70px' }) as HTMLInputElement;
  const colOn = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement, rowOn = h('input', { type: 'checkbox', checked: false }) as HTMLInputElement, marOn = h('input', { type: 'checkbox', checked: false }) as HTMLInputElement;
  const cols = num(4), colGut = num(20), rows = num(3), rowGut = num(20);
  const mt = num(40), ml = num(40), mb = num(40), mr = num(40);
  const clear = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const compute = () => {
    const g = { v: [] as number[], h: [] as number[] };
    const L = marOn.checked ? +ml.value : 0, R = d.width - (marOn.checked ? +mr.value : 0), T = marOn.checked ? +mt.value : 0, B = d.height - (marOn.checked ? +mb.value : 0);
    if (marOn.checked) { g.v.push(L, R); g.h.push(T, B); }
    const split = (a: number, b: number, n: number, gut: number, out: number[]) => {
      if (n < 1) return; const w = (b - a - gut * (n - 1)) / n; if (w <= 0) return;
      for (let i = 0; i < n; i++) { const x0 = a + i * (w + gut); out.push(x0, x0 + w); }
    };
    if (colOn.checked) split(L, R, +cols.value, +colGut.value, g.v);
    if (rowOn.checked) split(T, B, +rows.value, +rowGut.value, g.h);
    const uniq = (a: number[]) => [...new Set(a.map(v => Math.round(v * 10) / 10))].filter(v => v >= 0);
    return { v: uniq(g.v), h: uniq(g.h) };
  };
  const old = { v: [...d.guides.v], h: [...d.guides.h] };
  const preview = () => { const g = compute(); d.guides = clear.checked ? g : { v: [...old.v, ...g.v], h: [...old.h, ...g.h] }; app.viewport.requestRender(); };
  for (const el of [colOn, rowOn, marOn, cols, colGut, rows, rowGut, mt, ml, mb, mr, clear]) el.addEventListener('input', preview);
  preview();
  showDialog({
    title: 'Nueva disposición de guías', side: true,
    body: [
      row('', h('label', { class: 'check' }, colOn, ' Columnas')), row('Número', cols), row('Medianil', colGut, ' px'),
      row('', h('label', { class: 'check' }, rowOn, ' Filas')), row('Número', rows), row('Medianil', rowGut, ' px'),
      row('', h('label', { class: 'check' }, marOn, ' Márgenes')), row('Superior', mt, ' px'), row('Izquierdo', ml, ' px'), row('Inferior', mb, ' px'), row('Derecho', mr, ' px'),
      row('', h('label', { class: 'check' }, clear, ' Quitar las guías que ya hay')),
    ],
    onOk: () => { preview(); app.toast(`${d.guides.v.length + d.guides.h.length} guías`); },
    onCancel: () => { d.guides = old; app.viewport.requestRender(); },
  });
}

// ---- Edición › Buscar y reemplazar texto -----------------------------------------------------------

export function findReplaceDialog() {
  const d = app.doc; if (!d) return;
  const find = h('input', { type: 'text', class: 'wide', placeholder: 'Texto a buscar' }) as HTMLInputElement;
  const repl = h('input', { type: 'text', class: 'wide', placeholder: 'Reemplazar por' }) as HTMLInputElement;
  const cs = h('input', { type: 'checkbox' }) as HTMLInputElement, whole = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const info = h('div', { class: 'hint' }, '');
  const rx = () => { const f = find.value; if (!f) return null; const e = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return new RegExp(whole.checked ? `(?<![\\p{L}\\p{N}])${e}(?![\\p{L}\\p{N}])` : e, 'gu' + (cs.checked ? '' : 'i')); };
  const texts = () => d.allLayers().filter((l): l is TextLayer => l instanceof TextLayer);
  const count = () => { const r = rx(); if (!r) { info.textContent = `${texts().length} capas de texto`; return; } let n = 0, ls = 0; for (const l of texts()) { const m = l.props.text.match(r); if (m) { n += m.length; ls++; } } info.textContent = n ? `${n} coincidencias en ${ls} capa${ls === 1 ? '' : 's'}` : 'Sin coincidencias'; };
  for (const el of [find, cs, whole]) el.addEventListener('input', count);
  count();
  showDialog({
    title: 'Buscar y reemplazar texto', okLabel: 'Reemplazar todo',
    body: [row('Buscar', find), row('Cambiar por', repl), row('', h('label', { class: 'check' }, cs, ' Distinguir mayúsculas'), h('label', { class: 'check' }, whole, ' Palabra completa')), info],
    onOk: () => {
      const r = rx(); if (!r) return;
      let n = 0;
      for (const l of texts()) {
        const old = l.props.text; let cur = old, runs = l.props.runs;
        // se reemplaza de una en una para conservar los estilos de cada trozo
        const ms = [...old.matchAll(r)]; if (!ms.length) continue;
        for (const m of ms.reverse()) {
          const next = cur.slice(0, m.index!) + repl.value + cur.slice(m.index! + m[0].length);
          if (runs) runs = shiftRuns(runs, cur, next);
          cur = next; n++;
        }
        l.props.text = cur; if (runs) l.props.runs = runs;
        l.props.keepPixels = false; l.props.psdTySh = undefined;
        l.render(); l.touch();
      }
      if (n) { d.invalidate(); d.commit('Reemplazar texto'); app.toast(`${n} reemplazo${n === 1 ? '' : 's'}`); }
      else app.toast('No se ha encontrado el texto', 'warn');
    },
  });
  setTimeout(() => find.focus(), 50);
}

// ---- Edición › Sustituir cielo ----------------------------------------------------------------

export async function skyReplaceDialog() {
  const d = app.doc; if (!d) return;
  app.toast('Buscando el cielo…'); await new Promise(r => setTimeout(r, 30));
  const { selectSky, SKY_PRESETS, renderSky } = await import('../filters/sky');
  const base = d.getComposite();
  const mask = d.selection.mask ?? selectSky(base);
  if (!mask) { app.toast('No se ha encontrado un cielo claro en la parte de arriba (puedes seleccionarlo tú y volver a probar)', 'warn'); return; }
  const o = { shift: 3, fade: 2, brightness: 0, lighting: 30, flip: false };
  let custom: HTMLCanvasElement | null = null;
  const sel = h('select', {}, ...SKY_PRESETS.map(s => h('option', { value: s.id }, s.name)), h('option', { value: 'custom' }, 'Imagen propia…')) as HTMLSelectElement;
  sel.value = 'clouds';
  const skyCanvas = () => sel.value === 'custom' && custom ? custom : renderSky(sel.value === 'custom' ? 'clouds' : sel.value, 1200, 800);
  let sky = skyCanvas();
  const pw = 360, ph = Math.max(1, Math.round(pw * d.height / d.width));
  const pv = h('canvas', { width: pw, height: ph, style: 'width:100%;border-radius:4px;background:#000' }) as HTMLCanvasElement;
  const draw = () => {
    const x = ctx2d(pv); x.clearRect(0, 0, pw, ph); x.drawImage(base, 0, 0, pw, ph);
    const k = pw / d.width, s = makeCanvas(pw, ph), sx = ctx2d(s);
    const sc = Math.max(pw / sky.width, ph / sky.height);
    if (o.flip) { sx.translate(pw, 0); sx.scale(-1, 1); }
    sx.drawImage(sky, (pw - sky.width * sc) / 2, 0, sky.width * sc, sky.height * sc); sx.setTransform(1, 0, 0, 1, 0, 0);
    if (o.brightness) sx.filter = `brightness(${1 + o.brightness / 100})`;
    const m = makeCanvas(pw, ph), mx = ctx2d(m); mx.filter = o.fade ? `blur(${o.fade * k}px)` : 'none'; mx.drawImage(mask, 0, o.shift * k, pw, ph); if (o.shift > 0) mx.drawImage(mask, 0, 0, pw, ph);
    sx.filter = 'none'; sx.globalCompositeOperation = 'destination-in'; sx.drawImage(m, 0, 0);
    x.drawImage(s, 0, 0);
  };
  const slider = (label: string, key: keyof typeof o, min: number, max: number, unit = '') => row(label, numberSlider({ min, max, value: o[key] as number, unit, onInput: v => { (o as any)[key] = v; draw(); } }).el);
  const flip = h('input', { type: 'checkbox' }) as HTMLInputElement; flip.addEventListener('change', () => { o.flip = flip.checked; draw(); });
  sel.addEventListener('change', async () => {
    if (sel.value === 'custom') { const [f] = await io.pickFiles('image/*', false); if (f) { custom = await io.imageToCanvas(f); } else sel.value = 'clouds'; }
    sky = skyCanvas(); draw();
  });
  draw();
  showDialog({
    title: 'Sustituir cielo', okLabel: 'Aplicar', side: true,
    body: [pv, row('Cielo', sel), slider('Desplazar borde', 'shift', -30, 80, ' px'), slider('Difuminar borde', 'fade', 0, 40, ' px'), slider('Brillo del cielo', 'brightness', -60, 60, ' %'), slider('Luz en el primer plano', 'lighting', 0, 100, ' %'), row('', h('label', { class: 'check' }, flip, ' Voltear el cielo')),
      h('div', { class: 'hint' }, 'Se crea un grupo con el cielo y la luz del primer plano; sus máscaras se pueden retocar después.')],
    onOk: () => ops.replaceSky(sky, { ...o, mask }),
  });
}

// ---- Archivo › Abrir reciente --------------------------------------------------------------

/** Cuadrícula de archivos recientes (miniatura, nombre y tamaño); clic para abrir, × para quitar. */
export function recentGrid(list: import('../io/recent').Recent[], after?: () => void): HTMLElement {
  const grid = h('div', { class: 'recent-grid' });
  for (const r of list) {
    const del = h('button', { class: 'recent-del', type: 'button', title: 'Quitar de la lista' }, '×');
    const it = h('button', { class: 'recent-item', type: 'button', title: `${r.name}\n${r.dims} px · ${(r.bytes / 1024 / 1024).toFixed(1)} MB · ${new Date(r.date).toLocaleString('es')}` },
      r.thumb ? h('img', { src: r.thumb, alt: '' }) : h('div', { class: 'recent-noimg' }, r.name.split('.').pop()!.toUpperCase()),
      h('span', {}, r.name), del);
    it.onclick = async () => { const { recentFile } = await import('../io/recent'); after?.(); await ops.openFiles([recentFile(r)]); };
    del.onclick = async ev => { ev.stopPropagation(); const { removeRecent } = await import('../io/recent'); await removeRecent(r.key); it.remove(); };
    grid.append(it);
  }
  return grid;
}

export async function recentDialog() {
  const { listRecent, clearRecent } = await import('../io/recent');
  const list = await listRecent();
  let close = () => {};
  const body = list.length ? recentGrid(list, () => close()) : h('div', { class: 'hint' }, 'Todavía no has abierto ningún archivo. Los últimos que abras aparecerán aquí (se guardan solo en este navegador).');
  const clear = h('button', { class: 'btn', type: 'button', onclick: async () => { await clearRecent(); body.replaceWith(h('div', { class: 'hint' }, 'Lista vaciada.')); } }, 'Vaciar la lista');
  const dlg = showDialog({ title: 'Abrir reciente', okLabel: 'Cerrar', cancelLabel: null, width: 520, body: list.length ? [body, clear] : [body] });
  close = dlg.close;
}

// ---- Archivo › Exportar sectores -------------------------------------------------------------

export function exportSlicesDialog() {
  const d = app.doc; if (!d) return;
  if (!d.slices.length) { app.toast('No hay sectores: créalos con la herramienta Sector (en el grupo de Recortar, C)', 'warn'); return; }
  const fmt = h('select', {}, h('option', { value: 'image/png' }, 'PNG'), h('option', { value: 'image/jpeg' }, 'JPG'), h('option', { value: 'image/webp' }, 'WebP')) as HTMLSelectElement;
  let quality = 85, scale = 100;
  const q = numberSlider({ min: 1, max: 100, value: quality, unit: '%', onInput: v => { quality = v; } });
  const sc = numberSlider({ min: 10, max: 400, value: scale, unit: '%', onInput: v => { scale = v; } });
  const html = h('input', { type: 'checkbox' }) as HTMLInputElement;
  showDialog({
    title: 'Exportar sectores', okLabel: 'Exportar',
    body: [h('div', { class: 'hint' }, `${d.slices.length} sector${d.slices.length === 1 ? '' : 'es'}; cada uno sale en su archivo dentro de un ZIP.`), row('Formato', fmt), row('Calidad', q.el), row('Tamaño', sc.el), row('', h('label', { class: 'check' }, html, ' Incluir una página HTML que los recompone'))],
    onOk: async () => {
      try { const n = await ops.exportSlices(fmt.value as any, quality / 100, scale / 100, html.checked); app.toast(`${n} archivos exportados (ZIP)`); }
      catch (e: any) { if (e?.name !== 'AbortError') app.toast('No se pudo exportar: ' + (e?.message ?? e), 'warn'); }
    },
  });
}

// ---- Imagen › Aplicar imagen -----------------------------------------------------------------

export async function applyImageDialog() {
  const d = app.doc; if (!d) return;
  const { getPaintTarget, setPreview, setTargetCanvas } = await import('../tools/paint');
  const t = getPaintTarget(); if (!t) return;
  const sources: [string, string, () => HTMLCanvasElement][] = [['merged', 'Combinado (todo el documento)', () => d.getComposite()]];
  for (const l of [...d.allLayers()].reverse()) if ((l as any).canvas && l !== t.layer) sources.push(['l' + l.id, `Capa: ${l.name}`, () => (l as any).canvas]);
  for (const o of app.docs) if (o !== d && o.width === d.width && o.height === d.height) sources.push(['d' + o.name, `Documento: ${o.name}`, () => o.getComposite()]);
  const src = h('select', {}, ...sources.map(([v, n]) => h('option', { value: v }, n))) as HTMLSelectElement;
  const chan = h('select', {}, ...[['rgb', 'RGB'], ['r', 'Rojo'], ['g', 'Verde'], ['b', 'Azul'], ['gray', 'Gris (luminosidad)'], ['a', 'Transparencia']].map(([v, n]) => h('option', { value: v }, n))) as HTMLSelectElement;
  const modes: [string, string][] = [['source-over', 'Normal'], ['multiply', 'Multiplicar'], ['screen', 'Trama'], ['overlay', 'Superponer'], ['soft-light', 'Luz suave'], ['hard-light', 'Luz fuerte'], ['color-dodge', 'Sobreexponer color'], ['color-burn', 'Subexponer color'], ['darken', 'Oscurecer'], ['lighten', 'Aclarar'], ['difference', 'Diferencia'], ['lighter', 'Añadir'], ['subtract', 'Restar']];
  const mode = h('select', {}, ...modes.map(([v, n]) => h('option', { value: v }, n))) as HTMLSelectElement; mode.value = 'multiply';
  const inv = h('input', { type: 'checkbox' }) as HTMLInputElement, keepA = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  let opacity = 100;
  const op = numberSlider({ min: 0, max: 100, value: 100, unit: '%', onInput: v => { opacity = v; preview(); } });
  const W = t.canvas.width, H = t.canvas.height;
  const build = () => {
    const s0 = sources.find(s => s[0] === src.value)![2](), c = makeCanvas(W, H), x = ctx2d(c); x.drawImage(s0, 0, 0);
    if (chan.value !== 'rgb' || inv.checked) {
      const id = x.getImageData(0, 0, W, H), a = id.data, ch = chan.value;
      for (let i = 0; i < a.length; i += 4) {
        let v = -1;
        if (ch === 'r') v = a[i]; else if (ch === 'g') v = a[i + 1]; else if (ch === 'b') v = a[i + 2]; else if (ch === 'gray') v = a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11; else if (ch === 'a') { v = a[i + 3]; a[i + 3] = 255; }
        if (v >= 0) { a[i] = a[i + 1] = a[i + 2] = v; }
        if (inv.checked) { a[i] = 255 - a[i]; a[i + 1] = 255 - a[i + 1]; a[i + 2] = 255 - a[i + 2]; }
      }
      x.putImageData(id, 0, 0);
    }
    const out = cloneCanvas(t.canvas), ox = ctx2d(out);
    if (mode.value === 'subtract') {
      const A = ox.getImageData(0, 0, W, H), B = x.getImageData(0, 0, W, H), k = opacity / 100;
      for (let i = 0; i < A.data.length; i += 4) for (let c2 = 0; c2 < 3; c2++) A.data[i + c2] = A.data[i + c2] * (1 - k) + Math.max(0, A.data[i + c2] - B.data[i + c2]) * k;
      ox.putImageData(A, 0, 0);
    } else {
      ox.globalAlpha = opacity / 100; ox.globalCompositeOperation = mode.value as GlobalCompositeOperation;
      if (keepA.checked) {
        // solo donde la capa ya tiene píxeles
        const tmp = cloneCanvas(t.canvas), tx = ctx2d(tmp); tx.globalAlpha = opacity / 100; tx.globalCompositeOperation = mode.value as GlobalCompositeOperation; tx.drawImage(c, 0, 0);
        tx.globalAlpha = 1; tx.globalCompositeOperation = 'destination-in'; tx.drawImage(t.canvas, 0, 0);
        return tmp;
      }
      ox.drawImage(c, 0, 0);
    }
    if (keepA.checked) { ox.globalAlpha = 1; ox.globalCompositeOperation = 'destination-in'; ox.drawImage(t.canvas, 0, 0); }
    return out;
  };
  // con selección, solo se aplica dentro
  const withSel = (c: HTMLCanvasElement) => {
    const m = d.selection.mask; if (!m) return c;
    const r = cloneCanvas(t.canvas), rx = ctx2d(r), sel = cloneCanvas(c), sx = ctx2d(sel); sx.globalCompositeOperation = 'destination-in'; sx.drawImage(m, 0, 0);
    rx.globalCompositeOperation = 'destination-out'; rx.drawImage(m, 0, 0); rx.globalCompositeOperation = 'source-over'; rx.drawImage(sel, 0, 0); return r;
  };
  const preview = () => { setPreview(t, withSel(build())); d.invalidate(); };
  for (const el of [src, chan, mode, inv, keepA]) el.addEventListener('change', preview);
  preview();
  showDialog({
    title: 'Aplicar imagen', side: true,
    body: [row('Origen', src), row('Canal', chan), row('', h('label', { class: 'check' }, inv, ' Invertir')), row('Fusión', mode), row('Opacidad', op.el), row('', h('label', { class: 'check' }, keepA, ' Conservar transparencia'))],
    onOk: () => { const r = withSel(build()); setPreview(t, null); setTargetCanvas(t, r); d.commit('Aplicar imagen'); },
    onCancel: () => { setPreview(t, null); d.invalidate(); },
  });
}

// ---- Ajustes predefinidos de los filtros ------------------------------------------------------

const PRESET_KEY = 'editor.filterPresets';
type Preset = { name: string; params: any };
function userPresets(id: string): Preset[] { try { const all = JSON.parse(localStorage.getItem(PRESET_KEY) || '{}'); return Array.isArray(all[id]) ? all[id] : []; } catch { return []; } }
function saveUserPresets(id: string, list: Preset[]) { try { const all = JSON.parse(localStorage.getItem(PRESET_KEY) || '{}'); all[id] = list; localStorage.setItem(PRESET_KEY, JSON.stringify(all)); } catch { /* sin almacenamiento */ } }
const curve = (rgb: number[][], r?: number[][], g?: number[][], b?: number[][]) => ({ rgb, r: r ?? [[0, 0], [255, 255]], g: g ?? [[0, 0], [255, 255]], b: b ?? [[0, 0], [255, 255]] });
const BUILTIN_PRESETS: Record<string, Preset[]> = {
  curves: [
    { name: 'Más contraste', params: curve([[0, 0], [64, 48], [192, 208], [255, 255]]) },
    { name: 'Contraste suave', params: curve([[0, 0], [64, 58], [192, 198], [255, 255]]) },
    { name: 'Aclarar', params: curve([[0, 0], [128, 160], [255, 255]]) },
    { name: 'Oscurecer', params: curve([[0, 0], [128, 96], [255, 255]]) },
    { name: 'Negros lavados (película)', params: curve([[0, 28], [64, 70], [192, 200], [255, 245]]) },
    { name: 'Negativo', params: curve([[0, 255], [255, 0]]) },
    { name: 'Tono cálido', params: curve([[0, 0], [255, 255]], [[0, 0], [128, 140], [255, 255]], undefined, [[0, 0], [128, 116], [255, 255]]) },
    { name: 'Tono frío', params: curve([[0, 0], [255, 255]], [[0, 0], [128, 116], [255, 255]], undefined, [[0, 0], [128, 142], [255, 255]]) },
    { name: 'Proceso cruzado', params: curve([[0, 0], [255, 255]], [[0, 0], [64, 40], [192, 220], [255, 255]], [[0, 0], [64, 50], [192, 210], [255, 255]], [[0, 40], [255, 215]]) },
  ],
  levels: [
    { name: 'Más contraste', params: { inBlack: 20, inWhite: 235, gamma: 1, outBlack: 0, outWhite: 255 } },
    { name: 'Aclarar sombras', params: { inBlack: 0, inWhite: 255, gamma: 1.4, outBlack: 0, outWhite: 255 } },
    { name: 'Oscurecer medios tonos', params: { inBlack: 0, inWhite: 255, gamma: 0.75, outBlack: 0, outWhite: 255 } },
  ],
  huesat: [
    { name: 'Más saturación', params: { hue: 0, sat: 30, light: 0 } },
    { name: 'Sepia', params: { hue: 35, sat: 25, light: 0, colorize: true } },
    { name: 'Desaturar a medias', params: { hue: 0, sat: -50, light: 0 } },
  ],
};

// ---- Imagen › Recortar… y Capa › Duplicar en… ---------------------------------------------------

export function trimDialog() {
  if (!app.doc) return;
  const by = h('select', {}, h('option', { value: 'transparent' }, 'Píxeles transparentes'), h('option', { value: 'topleft' }, 'Color del píxel superior izquierdo'), h('option', { value: 'bottomright' }, 'Color del píxel inferior derecho')) as HTMLSelectElement;
  const cb = (l: string) => { const c = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement; return [c, h('label', { class: 'check' }, c, ' ' + l)] as const; };
  const [t, tl] = cb('Arriba'), [b, bl] = cb('Abajo'), [l, ll] = cb('Izquierda'), [r, rl] = cb('Derecha');
  showDialog({ title: 'Recortar bordes', okLabel: 'Recortar', body: [row('Según', by), row('Quitar', h('div', { class: 'check-row' }, tl, bl, ll, rl))],
    onOk: () => ops.trimImage(by.value as any, { top: t.checked, bottom: b.checked, left: l.checked, right: r.checked }) });
}

export function duplicateToDialog() {
  const d = app.doc; if (!d?.active) return;
  const sel = h('select', {}, ...app.docs.map((x, i) => h('option', { value: String(i), selected: x === d }, x === d ? `${x.name} (este)` : x.name)), h('option', { value: 'new' }, 'Documento nuevo')) as HTMLSelectElement;
  showDialog({ title: 'Duplicar capa en…', okLabel: 'Duplicar', body: [row('Capa', h('b', {}, d.active.name)), row('Destino', sel)],
    onOk: () => ops.duplicateLayerTo(sel.value === 'new' ? 'new' : app.docs[+sel.value]) });
}
