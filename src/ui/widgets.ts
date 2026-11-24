// Piezas de interfaz que usan los paneles (Propiedades, inicio) y las ventanas: niveles, curvas, selector de
// motivo, de LUT y de degradado, ajustes predefinidos y cuadrícula de recientes. Van aparte de dialogs.ts para
// que la app no tenga que cargar todas las ventanas al arrancar.
import { app } from './app';
import { h } from './dom';
import { row } from './dialog';
import * as io from '../io/files';
import * as ops from './ops';
import { histogram, curveLut, levelsLut, CurvePoint } from '../filters/adjustments';
import { gradientEditor, type GradStop } from './gradienteditor';
import { cloneCanvas, ctx2d, makeCanvas } from '../core/canvas';
import { allPatterns } from '../core/patterns';

/** Desplegable con miniatura de los motivos disponibles. */
export function patternSelect(value: string, onChange: (id: string) => void): HTMLElement {
  const sel = h('select', {}, ...allPatterns().map(p => h('option', { value: p.id, selected: p.id === value }, p.name)));
  const prev = h('canvas', { width: 24, height: 24, class: 'pat' });
  const draw = () => { const p = allPatterns().find(x => x.id === sel.value); const c = prev.getContext('2d')!; c.clearRect(0, 0, 24, 24); if (p) { c.fillStyle = c.createPattern(p.canvas, 'repeat')!; c.fillRect(0, 0, 24, 24); } };
  sel.addEventListener('change', () => { draw(); onChange(sel.value); }); draw();
  return h('div', { class: 'pat-select' }, prev, sel);
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
  // Ajuste en la imagen: clic sobre un tono de la foto y arrastrar arriba/abajo para aclararlo u oscurecerlo
  const onImg = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const vc = app.viewport.canvas;
  let imgDrag: { y0: number; v0: number } | null = null;
  const onDown = (e: PointerEvent) => {
    if (!cv.isConnected) { vc.removeEventListener('pointerdown', onDown, true); return; }
    if (!onImg.checked || e.button !== 0) return;
    const d = app.doc; if (!d) return;
    const pt = app.viewport.toDoc(e.offsetX, e.offsetY), x = Math.floor(pt.x), y = Math.floor(pt.y);
    if (x < 0 || y < 0 || x >= d.width || y >= d.height) return;
    e.preventDefault(); e.stopPropagation();
    const px = d.getComposite().getContext('2d')!.getImageData(x, y, 1, 1).data;
    const v = Math.round(ch === 'rgb' ? px[0] * 0.299 + px[1] * 0.587 + px[2] * 0.114 : px[{ r: 0, g: 1, b: 2 }[ch]]);
    const list = pts(), lut = curveLut(list);
    let i = list.findIndex(q => Math.abs(q[0] - v) < 6);
    if (i < 0) { list.push([v, lut[v]]); list.sort((a, b) => a[0] - b[0]); i = list.findIndex(q => q[0] === v); }
    active = i; imgDrag = { y0: e.clientY, v0: list[i][1] }; draw(); update();
    const mv = (ev: PointerEvent) => { if (!imgDrag || active < 0) return; pts()[active][1] = Math.max(0, Math.min(255, Math.round(imgDrag.v0 + (imgDrag.y0 - ev.clientY) * 0.6))); draw(); update(); };
    const up = () => { imgDrag = null; window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  vc.addEventListener('pointerdown', onDown, true);
  draw();
  return [row('Canal', sel), cv, h('div', { class: 'hint' }, 'Clic para añadir un punto; arrástralo fuera o haz doble clic para quitarlo.'), readout,
    row('', h('label', { class: 'check', title: 'Haz clic en un tono de la foto y arrastra hacia arriba para aclararlo o hacia abajo para oscurecerlo' }, onImg, ' Ajustar haciendo clic en la imagen'))];
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

const PRESET_KEY = 'editor.filterPresets';
export type Preset = { name: string; params: any };
export function userPresets(id: string): Preset[] { try { const all = JSON.parse(localStorage.getItem(PRESET_KEY) || '{}'); return Array.isArray(all[id]) ? all[id] : []; } catch { return []; } }
export function saveUserPresets(id: string, list: Preset[]) { try { const all = JSON.parse(localStorage.getItem(PRESET_KEY) || '{}'); all[id] = list; localStorage.setItem(PRESET_KEY, JSON.stringify(all)); } catch { /* sin almacenamiento */ } }
const curve = (rgb: number[][], r?: number[][], g?: number[][], b?: number[][]) => ({ rgb, r: r ?? [[0, 0], [255, 255]], g: g ?? [[0, 0], [255, 255]], b: b ?? [[0, 0], [255, 255]] });
export const BUILTIN_PRESETS: Record<string, Preset[]> = {
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

