// Diálogos concretos: nuevo documento, exportar, tamaños, filtros, niveles, curvas…

import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog, row } from './dialog';
import * as ops from './ops';
import * as io from '../io/files';
import { FilterDef, defaultParams } from '../filters/registry';
import { histogram, curveLut, levelsLut, CurvePoint } from '../filters/adjustments';
import type { LayerStyles } from '../core/layers';

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
    h('option', { value: 'project' }, 'Proyecto de Editor (.edp, conserva capas)'));
  let quality = 90;
  const q = numberSlider({ label: '', min: 1, max: 100, value: quality, unit: '%', onInput: v => { quality = v; estimate(); } });
  const qRow = row('Calidad', q.el);
  const info = h('div', { class: 'hint' }, '');
  let timer = 0;
  const estimate = () => {
    clearTimeout(timer);
    qRow.style.display = fmt.value === 'image/jpeg' || fmt.value === 'image/webp' ? '' : 'none';
    if (fmt.value === 'project') { info.textContent = 'Guarda todas las capas para seguir editando más tarde.'; return; }
    info.textContent = 'Calculando tamaño…';
    timer = window.setTimeout(async () => {
      const b = await io.exportImage(d, fmt.value as any, quality / 100);
      info.textContent = `${d.width} × ${d.height} px · tamaño aproximado: ${(b.size / 1024).toFixed(b.size > 1e6 ? 0 : 1)} KB`;
    }, 200);
  };
  fmt.addEventListener('change', estimate);
  estimate();
  showDialog({
    title: 'Exportar como', okLabel: 'Guardar',
    body: [row('Nombre', name), row('Formato', fmt), qRow, info],
    onOk: async () => {
      if (fmt.value === 'project') { d.name = name.value || d.name; await ops.saveProject(true); return; }
      const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[fmt.value]!;
      try {
        const b = await io.exportImage(d, fmt.value as any, quality / 100);
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
      d.resample(W, H); d.commit('Tamaño de imagen'); app.viewport.fit(true);
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
      d.resizeCanvas(W, H, dx, dy); d.commit('Tamaño de lienzo'); app.viewport.fit(true);
    },
  });
}

// ---- Rellenar -----------------------------------------------------------------------

export function fillDialog() {
  if (!app.doc) return;
  const what = h('select', {},
    h('option', { value: 'fg' }, 'Color frontal'), h('option', { value: 'bg' }, 'Color de fondo'),
    h('option', { value: '#000000' }, 'Negro'), h('option', { value: '#808080' }, 'Gris 50 %'), h('option', { value: '#ffffff' }, 'Blanco'));
  let op = 100;
  const s = numberSlider({ min: 1, max: 100, value: 100, unit: '%', onInput: v => op = v });
  showDialog({
    title: 'Rellenar', body: [row('Contenido', what), row('Opacidad', s.el)],
    onOk: () => { const c = what.value === 'fg' ? app.fg : what.value === 'bg' ? app.bg : what.value; ops.fill(c, op / 100); },
  });
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

export function filterDialog(def: FilterDef) {
  if (!def.params && !def.custom) { ops.applyFilterDirect(def); return; }
  const session = ops.FilterSession.start(def);
  if (!session) return;
  const params = defaultParams(def);
  let previewOn = true;
  let timer = 0;
  const update = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => { if (previewOn) session.render(params); else session.clearPreview(); }, 30);
  };
  let body: HTMLElement[];
  if (def.custom === 'levels') body = levelsBody(session.source(), params, update);
  else if (def.custom === 'curves') body = curvesBody(session.source(), params, update);
  else body = (def.params ?? []).map(p => {
    if (p.type === 'checkbox') {
      const c = h('input', { type: 'checkbox', checked: p.default });
      c.addEventListener('change', () => { params[p.key] = c.checked; update(); });
      return row('', h('label', { class: 'check' }, c, ' ' + p.label));
    }
    return row(p.label, numberSlider({ min: p.min, max: p.max, step: p.step, value: p.default, unit: p.unit, onInput: v => { params[p.key] = v; update(); } }).el);
  });
  const prev = h('input', { type: 'checkbox', checked: true });
  prev.addEventListener('change', () => { previewOn = prev.checked; update(); });
  const reset = h('button', { class: 'btn', type: 'button' }, 'Restablecer');
  reset.onclick = () => { showDialogClose(); filterDialog(def); };
  let showDialogClose = () => {};
  const dlg = showDialog({
    title: def.name.replace('…', ''), width: def.custom ? 420 : 400,
    body: [...body, h('label', { class: 'check preview-check' }, prev, ' Vista previa')],
    extraButtons: [reset],
    onOk: () => { clearTimeout(timer); session.commit(params); ops.setLastFilter(def, params); },
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
    ...(before ? JSON.parse(JSON.stringify(before)) : {}),
  };
  const update = () => ops.setLayerStyles(l, JSON.parse(JSON.stringify(st)), false);
  const section = (title: string, obj: any, fields: [string, string, number, number, string?][]) => {
    const on = h('input', { type: 'checkbox', checked: obj.enabled });
    const color = h('input', { type: 'color', class: 'color-input', value: obj.color });
    const enable = () => { if (!obj.enabled) { obj.enabled = true; on.checked = true; } };
    on.onchange = () => { obj.enabled = on.checked; update(); };
    color.oninput = () => { obj.color = color.value; enable(); update(); };
    return [h('div', { class: 'style-head' }, h('label', { class: 'check' }, on, h('b', {}, ' ' + title)), color),
      ...fields.map(([key, label, min, max, unit]) => row(label, numberSlider({ min, max, value: obj[key], unit, onInput: v => { obj[key] = v; enable(); update(); } }).el))];
  };
  showDialog({
    title: `Estilo de capa: ${l.name}`, width: 400,
    body: [
      ...section('Sombra paralela', st.shadow, [['opacity', 'Opacidad', 0, 100, '%'], ['angle', 'Ángulo', -180, 180, '°'], ['distance', 'Distancia', 0, 200, 'px'], ['blur', 'Tamaño', 0, 200, 'px']]),
      ...section('Trazo (exterior)', st.stroke, [['size', 'Grosor', 1, 60, 'px']]),
      ...section('Resplandor exterior', st.glow, [['opacity', 'Opacidad', 0, 100, '%'], ['size', 'Tamaño', 1, 200, 'px']]),
    ],
    onOk: () => { const any = st.shadow.enabled || st.stroke.enabled || st.glow.enabled; l.styles = before; ops.setLayerStyles(l, any || before ? JSON.parse(JSON.stringify(st)) : null, true); },
    onCancel: () => ops.setLayerStyles(l, before, false),
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
