// Diálogos concretos: nuevo documento, exportar, tamaños, filtros, niveles, curvas…

import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog, row } from './dialog';
import * as ops from './ops';
import * as io from '../io/files';
import { FilterDef, defaultParams } from '../filters/registry';
import { histogram, curveLut, levelsLut, CurvePoint } from '../filters/adjustments';
import { SmartLayer, TextLayer, type LayerStyles } from '../core/layers';
import { WARP_STYLES } from '../tools/warpmesh';
import { allPatterns } from '../core/patterns';
import { record, macros, play } from './macros';
import { colorDialog } from './colorpicker';
import { prefs, savePrefs } from './prefs';

const numInput = (value: number, min = 1, max = 30000) => h('input', { type: 'number', value: String(value), min: String(min), max: String(max), class: 'num' });

// ---- Nuevo documento -----------------------------------------------------------

const PRESETS: [string, number, number][] = [
  ['Personalizado', 0, 0], ['HD 1280 × 720', 1280, 720], ['Full HD 1920 × 1080', 1920, 1080], ['4K 3840 × 2160', 3840, 2160],
  ['Cuadrado 1080 × 1080', 1080, 1080], ['Historia 1080 × 1920', 1080, 1920], ['A4 300 ppp 2480 × 3508', 2480, 3508],
  ['Carta 300 ppp 2550 × 3300', 2550, 3300], ['Web 800 × 600', 800, 600], ['Icono 512 × 512', 512, 512],
];

export function newDocumentDialog() {
  const name = h('input', { type: 'text', value: 'Sin título', class: 'wide' });
  const w = numInput(1280), hh = numInput(720);
  const preset = h('select', {}, ...PRESETS.map(([n], i) => h('option', { value: String(i) }, n)));
  preset.value = '1';
  preset.addEventListener('change', () => { const p = PRESETS[+preset.value]; if (p[1]) { w.value = String(p[1]); hh.value = String(p[2]); } });
  [w, hh].forEach(i => i.addEventListener('input', () => preset.value = '0'));
  const bg = h('select', {},
    h('option', { value: '#ffffff' }, 'Blanco'), h('option', { value: '#000000' }, 'Negro'),
    h('option', { value: 'fg' }, 'Color frontal'), h('option', { value: 'bgc' }, 'Color de fondo'),
    h('option', { value: '' }, 'Transparente'));
  showDialog({
    title: 'Nuevo documento', okLabel: 'Crear',
    body: [row('Nombre', name), row('Predefinido', preset), row('Anchura', w, 'px'), row('Altura', hh, 'px'), row('Fondo', bg)],
    onOk: () => {
      const W = Math.round(+w.value), H = Math.round(+hh.value);
      if (!(W >= 1 && H >= 1 && W <= 30000 && H <= 30000)) { app.toast('Tamaño no válido (1 – 30000 px)', 'warn'); return false; }
      if (W * H > 268e6) { app.toast('La imagen es demasiado grande para el navegador', 'warn'); return false; }
      const b = bg.value === 'fg' ? app.fg : bg.value === 'bgc' ? app.bg : bg.value || null;
      ops.newDocument(name.value.trim() || 'Sin título', W, H, b);
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
    h('option', { value: 'gif' }, 'GIF (animado si hay cuadros en la línea de tiempo)'),
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
    scRow.style.display = exRow.style.display = fmt.value.startsWith('image/') ? '' : 'none';
    pbRow.style.display = hasBoards && fmt.value.startsWith('image/') ? '' : 'none';
    if (fmt.value === 'project') { info.textContent = 'Guarda todo (capas, texto, formas, ajustes, estilos) para seguir editando.'; return; }
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
      const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[fmt.value]!;
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
  const w = numInput(d.width), hh = numInput(d.height);
  const link = h('input', { type: 'checkbox', checked: true });
  const ratio = d.width / d.height;
  w.addEventListener('input', () => { if (link.checked) hh.value = String(Math.max(1, Math.round(+w.value / ratio))); });
  hh.addEventListener('input', () => { if (link.checked) w.value = String(Math.max(1, Math.round(+hh.value * ratio))); });
  showDialog({
    title: 'Tamaño de imagen',
    body: [row('Anchura', w, 'px'), row('Altura', hh, 'px'), row('', h('label', { class: 'check' }, link, ' Mantener proporciones')),
      h('div', { class: 'hint' }, `Tamaño actual: ${d.width} × ${d.height} px`)],
    onOk: () => {
      const W = Math.round(+w.value), H = Math.round(+hh.value);
      if (!(W >= 1 && H >= 1 && W <= 30000 && H <= 30000)) return false;
      if (W === d.width && H === d.height) return;
      d.resample(W, H); d.commit('Tamaño de imagen'); record({ kind: 'imageSize', w: W, h: H, label: `Tamaño de imagen: ${W} × ${H}` }); app.viewport.fit(true);
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
  showDialog({
    title: 'Preferencias', width: 420,
    body: [h('div', { class: 'dlg-section' }, 'Interfaz'), row('Tema', theme), row('Tamaño de la interfaz', scale),
      h('div', { class: 'dlg-section' }, 'Rendimiento'), row('Pasos de historial', hist.el),
      h('div', { class: 'dlg-section' }, 'Guías y ajuste'), row('Distancia de ajuste', snapTol.el),
      h('div', { class: 'dlg-section' }, 'Archivos'), row('', h('label', { class: 'check' }, auto, ' Guardar copia de recuperación cada 15 s'))],
    onOk: () => {
      Object.assign(prefs, { theme: theme.value, uiScale: +scale.value, historySteps: Math.round(histV), snapTolerance: Math.round(snapV), autosave: auto.checked });
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
  const preview = () => ops.colorRange(tol, false);
  const s = numberSlider({ min: 0, max: 200, value: tol, onInput: v => { tol = v; preview(); } });
  showDialog({
    title: 'Gama de colores', body: [h('div', { class: 'hint' }, 'Selecciona todo lo que se parezca al color frontal (elígelo antes con el cuentagotas).'), row('Tolerancia', s.el)],
    onOk: () => ops.colorRange(tol, true), onCancel: () => { d.selection.setMask(before); d.changed(); },
  });
  preview();
}

// ---- Modificar selección ------------------------------------------------------------

export function modifySelectionDialog(kind: 'feather' | 'expand' | 'contract') {
  const d = app.doc; if (!d) return;
  if (!d.selection.active) { app.toast('Haz primero una selección', 'warn'); return; }
  const titles = { feather: 'Calar selección', expand: 'Expandir selección', contract: 'Contraer selección' };
  const inp = numInput(kind === 'feather' ? 5 : 2, 1, 500);
  showDialog({
    title: titles[kind], body: row(kind === 'feather' ? 'Radio de calado' : 'Cantidad', inp, 'px'),
    onOk: () => {
      const v = +inp.value; if (!(v > 0)) return false;
      if (kind === 'feather') d.selection.feather(v / 2);
      else d.selection.grow(kind === 'expand' ? v : -v);
      d.commit(titles[kind]);
    },
  });
}

// ---- Filtros genéricos ----------------------------------------------------------------

export function filterDialog(def: FilterDef, edit?: { layer: SmartLayer; index: number }) {
  if (!def.params && !def.custom) { ops.applyFilterDirect(def); return; }
  const active = app.doc?.active;
  // En objetos inteligentes el filtro queda como filtro inteligente (editable)
  const session = edit ? new ops.SmartFilterSession(edit.layer, def, edit.index)
    : active instanceof SmartLayer && !app.doc!.editMask ? new ops.SmartFilterSession(active, def) : ops.FilterSession.start(def);
  if (!session) return;
  const params = edit ? JSON.parse(JSON.stringify(edit.layer.filters[edit.index].params)) : defaultParams(def);
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
    if (p.type === 'pattern') return row(p.label, patternSelect(params[p.key], v => { params[p.key] = v; update(); }));
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
  const dlg = showDialog({
    title: def.name.replace('…', '') + (session instanceof ops.SmartFilterSession ? ' (filtro inteligente)' : ''), width: def.custom ? 420 : 400, side: true,
    body: [...body, h('label', { class: 'check preview-check' }, prev, ' Vista previa')],
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
    shadow: { enabled: false, color: '#000000', opacity: 60, angle: 120, distance: 8, blur: 10 },
    stroke: { enabled: false, color: '#000000', size: 3 },
    glow: { enabled: false, color: '#ffffaa', opacity: 75, size: 12 },
    innerShadow: { enabled: false, color: '#000000', opacity: 60, angle: 120, distance: 6, blur: 8 },
    innerGlow: { enabled: false, color: '#ffffaa', opacity: 75, size: 10 },
    colorOverlay: { enabled: false, color: '#ff0000', opacity: 100 },
    gradientOverlay: { enabled: false, opacity: 100, angle: 90, stops: [[0, '#000000'], [1, '#ffffff']] },
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
    els.push(row('Colores', pick(0), '→', pick(g.stops.length - 1)));
    return els;
  };
  showDialog({
    title: `Estilo de capa: ${l.name}`, width: 400, side: true,
    body: [
      ...section('Sombra paralela', st.shadow, [['opacity', 'Opacidad', 0, 100, '%'], ['angle', 'Ángulo', -180, 180, '°'], ['distance', 'Distancia', 0, 200, 'px'], ['blur', 'Tamaño', 0, 200, 'px']]),
      ...section('Trazo (exterior)', st.stroke, [['size', 'Grosor', 1, 60, 'px']]),
      ...section('Resplandor exterior', st.glow, [['opacity', 'Opacidad', 0, 100, '%'], ['size', 'Tamaño', 1, 200, 'px']]),
      ...section('Sombra interior', st.innerShadow, [['opacity', 'Opacidad', 0, 100, '%'], ['angle', 'Ángulo', -180, 180, '°'], ['distance', 'Distancia', 0, 200, 'px'], ['blur', 'Tamaño', 0, 200, 'px']]),
      ...section('Resplandor interior', st.innerGlow, [['opacity', 'Opacidad', 0, 100, '%'], ['size', 'Tamaño', 1, 200, 'px']]),
      ...section('Superposición de color', st.colorOverlay, [['opacity', 'Opacidad', 0, 100, '%']]),
      ...gradSection(),
    ],
    onOk: () => { const any = Object.values(st).some((x: any) => x.enabled); l.styles = before; ops.setLayerStyles(l, any || before ? JSON.parse(JSON.stringify(st)) : null, true); },
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
      h('p', { class: 'hint' }, 'Versión 0.1 (primera fase)'),
    ],
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
