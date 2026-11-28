// Editor de mapas de tiles: la imagen abierta es el tileset (se corta en cuadros), y con ellos se pinta un mapa por casillas,
// con varias capas (suelo, objetos…), pintar, borrar, rellenar, rectángulo, cuentagotas y bloques de varios tiles.
// Se exporta a Tiled (.tmj, que leen Godot, Phaser, Unity, Defold, GameMaker…), CSV y PNG, o se convierte en imagen.
import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog } from './dialog';
import { icon } from './icons';
import { ctx2d, makeCanvas } from '../core/canvas';
import { RasterLayer } from '../core/layers';
import { EditorDocument, TileMapData } from '../core/document';
import { t, tName } from '../i18n/i18n';

export type Stamp = { w: number; h: number; ids: number[] };
const EMPTY = -1;

export function newMap(tile: number, cols: number, rows: number): TileMapData {
  return { tile, cols, rows, layers: [{ name: t('Suelo'), data: new Array(cols * rows).fill(EMPTY) }, { name: t('Objetos'), data: new Array(cols * rows).fill(EMPTY) }] };
}
export function tilesetInfo(ts: HTMLCanvasElement, tile: number) { const cols = Math.max(1, Math.floor(ts.width / tile)), rows = Math.max(1, Math.floor(ts.height / tile)); return { cols, rows, count: cols * rows }; }
/** Pinta el mapa entero (todas las capas visibles) en un lienzo, a escala k. */
export function renderMap(m: TileMapData, ts: HTMLCanvasElement, k = 1, only?: number): HTMLCanvasElement {
  const t = m.tile, c = makeCanvas(m.cols * t * k, m.rows * t * k), x = ctx2d(c), info = tilesetInfo(ts, t);
  x.imageSmoothingEnabled = false;
  m.layers.forEach((l, li) => {
    if (only != null ? li !== only : l.visible === false) return;
    for (let i = 0; i < l.data.length; i++) { const id = l.data[i]; if (id < 0 || id >= info.count) continue; const sx = (id % info.cols) * t, sy = Math.floor(id / info.cols) * t; x.drawImage(ts, sx, sy, t, t, (i % m.cols) * t * k, Math.floor(i / m.cols) * t * k, t * k, t * k); }
  });
  return c;
}
/** Pone el bloque en (cx, cy) de la capa. */
export function stampAt(m: TileMapData, li: number, cx: number, cy: number, s: Stamp, erase = false) {
  const L = m.layers[li].data;
  for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) { const X = cx + i, Y = cy + j; if (X < 0 || Y < 0 || X >= m.cols || Y >= m.rows) continue; L[Y * m.cols + X] = erase ? EMPTY : s.ids[j * s.w + i]; }
}
/** Rellena las casillas conectadas que tienen el mismo tile (el bloque se repite en mosaico). */
export function floodFill(m: TileMapData, li: number, cx: number, cy: number, s: Stamp, erase = false) {
  const L = m.layers[li].data, from = L[cy * m.cols + cx], seen = new Uint8Array(L.length), st = [cy * m.cols + cx];
  const val = (i: number) => { if (erase) return EMPTY; const X = i % m.cols, Y = Math.floor(i / m.cols), a = ((X - cx) % s.w + s.w) % s.w, b = ((Y - cy) % s.h + s.h) % s.h; return s.ids[b * s.w + a]; };
  while (st.length) { const i = st.pop()!; if (seen[i] || L[i] !== from) continue; seen[i] = 1; L[i] = val(i); const X = i % m.cols; if (X > 0) st.push(i - 1); if (X < m.cols - 1) st.push(i + 1); if (i >= m.cols) st.push(i - m.cols); if (i < L.length - m.cols) st.push(i + m.cols); }
}
export function resizeMap(m: TileMapData, cols: number, rows: number) {
  const re = (a: number[]) => { const n = new Array(cols * rows).fill(EMPTY); for (let y = 0; y < Math.min(rows, m.rows); y++) for (let x = 0; x < Math.min(cols, m.cols); x++) n[y * cols + x] = a[y * m.cols + x]; return n; };
  for (const l of m.layers) { l.data = re(l.data); if (l.terr) l.terr = re(l.terr); }
  m.cols = cols; m.rows = rows;
}
/** Tile de terreno para la casilla (x, y): mira qué vecinos son del mismo terreno y elige esquina, borde, centro o
 *  rincón interior del bloque 3×3 (y 2×2 de rincones). */
export function terrainTile(m: TileMapData, li: number, x: number, y: number): number {
  const L = m.layers[li], T = L.terr!, me = T[y * m.cols + x], def = m.terrains?.[me]; if (me < 0 || !def) return L.data[y * m.cols + x];
  const tc = Math.max(1, m.tsCols ?? 1), at = (c: number, r: number) => def.base + r * tc + c;
  const same = (dx: number, dy: number) => { const X = x + dx, Y = y + dy; return X < 0 || Y < 0 || X >= m.cols || Y >= m.rows ? true : T[Y * m.cols + X] === me; };
  const n = same(0, -1), s = same(0, 1), w = same(-1, 0), e = same(1, 0);
  if (!n && !w) return at(0, 0); if (!n && !e) return at(2, 0); if (!s && !w) return at(0, 2); if (!s && !e) return at(2, 2);
  if (!n) return at(1, 0); if (!s) return at(1, 2); if (!w) return at(0, 1); if (!e) return at(2, 1);
  // todos los lados son del terreno: si falta una diagonal, rincón interior
  if (def.inner != null) {
    const ia = (c: number, r: number) => def.inner! + r * tc + c;
    if (!same(-1, -1)) return ia(0, 0); if (!same(1, -1)) return ia(1, 0); if (!same(-1, 1)) return ia(0, 1); if (!same(1, 1)) return ia(1, 1);
  }
  return at(1, 1);
}
/** Pinta (o borra, con ti = -1) terreno en una casilla y recoloca las casillas de alrededor. */
export function paintTerrain(m: TileMapData, li: number, x: number, y: number, ti: number) {
  const L = m.layers[li]; L.terr ??= new Array(m.cols * m.rows).fill(-1);
  if (x < 0 || y < 0 || x >= m.cols || y >= m.rows) return;
  L.terr[y * m.cols + x] = ti; if (ti < 0) L.data[y * m.cols + x] = EMPTY;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= m.cols || Y >= m.rows) continue; if (L.terr[Y * m.cols + X] >= 0) L.data[Y * m.cols + X] = terrainTile(m, li, X, Y); }
}
/** Mapa en formato Tiled JSON (.tmj). */
export function toTiled(m: TileMapData, ts: HTMLCanvasElement, image = 'tileset.png') {
  const info = tilesetInfo(ts, m.tile);
  return {
    compressionlevel: -1, type: 'map', version: '1.10', tiledversion: '1.10.2', orientation: 'orthogonal', renderorder: 'right-down', infinite: false,
    width: m.cols, height: m.rows, tilewidth: m.tile, tileheight: m.tile, nextlayerid: m.layers.length + 1, nextobjectid: 1,
    layers: m.layers.map((l, i) => ({ id: i + 1, name: l.name, type: 'tilelayer', x: 0, y: 0, width: m.cols, height: m.rows, opacity: 1, visible: l.visible !== false, data: l.data.map(v => v < 0 ? 0 : v + 1) })),
    tilesets: [{ firstgid: 1, name: 'tileset', image, imagewidth: ts.width, imageheight: ts.height, tilewidth: m.tile, tileheight: m.tile, columns: info.cols, tilecount: info.count, margin: 0, spacing: 0 }],
  };
}
export const toCSV = (m: TileMapData, li: number) => { const L = m.layers[li].data, out: string[] = []; for (let y = 0; y < m.rows; y++) out.push(L.slice(y * m.cols, (y + 1) * m.cols).join(',')); return out.join('\n') + '\n'; };

// ---- editor ----------------------------------------------------------------------------------------------
export function tileMapDialog() {
  const d = app.doc; if (!d) { app.toast('Abre primero la imagen con los tiles (el tileset)', 'warn'); return; }
  const ts = d.flatten();
  let m: TileMapData = d.meta.tilemap ? JSON.parse(JSON.stringify(d.meta.tilemap)) : newMap(guessTile(d), 20, 15);
  let info = tilesetInfo(ts, m.tile); m.tsCols = info.cols; let layer = Math.min(1, m.layers.length - 1), tool = 'paint', grid = true, zoom = Math.max(1, Math.min(4, Math.floor(480 / (m.cols * m.tile)) || 1));
  let stamp: Stamp = { w: 1, h: 1, ids: [0] }, terr = 0;
  const undo: string[] = [], redo: string[] = [];
  const snap = () => { undo.push(JSON.stringify(m)); if (undo.length > 80) undo.shift(); redo.length = 0; };

  // tileset (a la izquierda): toca un tile o arrastra para coger un bloque
  const tz = Math.max(1, Math.min(4, Math.floor(232 / ts.width) || 1));
  const tsc = h('canvas', { class: 'tm-ts', width: ts.width * tz, height: ts.height * tz, title: 'Toca un tile, o arrastra para coger varios a la vez' }) as HTMLCanvasElement;
  const drawTs = () => {
    const x = ctx2d(tsc); x.imageSmoothingEnabled = false; x.clearRect(0, 0, tsc.width, tsc.height); x.drawImage(ts, 0, 0, tsc.width, tsc.height);
    const t = m.tile * tz; x.strokeStyle = 'rgba(255,255,255,.25)'; x.lineWidth = 1;
    for (let i = 0; i <= info.cols; i++) { x.beginPath(); x.moveTo(i * t + 0.5, 0); x.lineTo(i * t + 0.5, info.rows * t); x.stroke(); }
    for (let j = 0; j <= info.rows; j++) { x.beginPath(); x.moveTo(0, j * t + 0.5); x.lineTo(info.cols * t, j * t + 0.5); x.stroke(); }
    const s0 = stamp.ids[0]; x.strokeStyle = '#ffcc00'; x.lineWidth = 2; x.strokeRect((s0 % info.cols) * t + 1, Math.floor(s0 / info.cols) * t + 1, stamp.w * t - 2, stamp.h * t - 2);
  };
  let tsDown: { x: number; y: number } | null = null;
  const tsCell = (e: PointerEvent) => { const r = tsc.getBoundingClientRect(), t = m.tile * tz * (r.width / tsc.width); return { x: Math.max(0, Math.min(info.cols - 1, Math.floor((e.clientX - r.left) / t))), y: Math.max(0, Math.min(info.rows - 1, Math.floor((e.clientY - r.top) / t))) }; };
  const pickRect = (a: { x: number; y: number }, b: { x: number; y: number }) => { const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), w = Math.abs(a.x - b.x) + 1, hh = Math.abs(a.y - b.y) + 1, ids: number[] = []; for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) ids.push((y0 + j) * info.cols + x0 + i); stamp = { w, h: hh, ids }; if (tool === 'erase' || tool === 'pick') setTool('paint'); drawTs(); };
  tsc.onpointerdown = e => { tsc.setPointerCapture(e.pointerId); tsDown = tsCell(e); pickRect(tsDown, tsDown); };
  tsc.onpointermove = e => { if (tsDown) pickRect(tsDown, tsCell(e)); };
  tsc.onpointerup = () => { tsDown = null; };

  // mapa
  const mc = h('canvas', { class: 'tm-map' }) as HTMLCanvasElement;
  let hover: { x: number; y: number } | null = null, rectFrom: { x: number; y: number } | null = null;
  const draw = () => {
    const t = m.tile * zoom; mc.width = m.cols * t; mc.height = m.rows * t;
    const x = ctx2d(mc); x.imageSmoothingEnabled = false;
    // cuadros de transparencia
    x.fillStyle = '#2a2a2e'; x.fillRect(0, 0, mc.width, mc.height); x.fillStyle = '#323238';
    for (let j = 0; j < m.rows; j++) for (let i = 0; i < m.cols; i++) if ((i + j) % 2) x.fillRect(i * t, j * t, t, t);
    m.layers.forEach((l, li) => { if (l.visible === false) return; x.globalAlpha = li === layer || tool === 'pick' ? 1 : 0.85; x.drawImage(renderMap(m, ts, zoom, li), 0, 0); });
    x.globalAlpha = 1;
    if (grid) { x.strokeStyle = 'rgba(255,255,255,.12)'; x.lineWidth = 1; for (let i = 0; i <= m.cols; i++) { x.beginPath(); x.moveTo(i * t + 0.5, 0); x.lineTo(i * t + 0.5, mc.height); x.stroke(); } for (let j = 0; j <= m.rows; j++) { x.beginPath(); x.moveTo(0, j * t + 0.5); x.lineTo(mc.width, j * t + 0.5); x.stroke(); } }
    if (hover) {
      const a = rectFrom ?? hover, x0 = Math.min(a.x, hover.x), y0 = Math.min(a.y, hover.y), w = rectFrom ? Math.abs(a.x - hover.x) + 1 : tool === 'paint' ? stamp.w : 1, hh = rectFrom ? Math.abs(a.y - hover.y) + 1 : tool === 'paint' ? stamp.h : 1;
      if (tool === 'paint' && !rectFrom) { x.globalAlpha = 0.6; for (let j = 0; j < stamp.h; j++) for (let i = 0; i < stamp.w; i++) { const id = stamp.ids[j * stamp.w + i]; x.drawImage(ts, (id % info.cols) * m.tile, Math.floor(id / info.cols) * m.tile, m.tile, m.tile, (hover.x + i) * t, (hover.y + j) * t, t, t); } x.globalAlpha = 1; }
      x.strokeStyle = tool === 'erase' ? '#ff5050' : '#ffcc00'; x.lineWidth = 2; x.strokeRect(x0 * t + 1, y0 * t + 1, w * t - 2, hh * t - 2);
    }
    status.textContent = `${m.cols} × ${m.rows} casillas de ${m.tile} px · ${info.count} tiles` + (hover ? ` · casilla ${hover.x}, ${hover.y}` : '');
  };
  const cell = (e: PointerEvent) => { const r = mc.getBoundingClientRect(), t = (m.tile * zoom) * (r.width / mc.width); return { x: Math.floor((e.clientX - r.left) / t), y: Math.floor((e.clientY - r.top) / t) }; };
  const inside = (c: { x: number; y: number }) => c.x >= 0 && c.y >= 0 && c.x < m.cols && c.y < m.rows;
  let painting = false;
  const apply = (c: { x: number; y: number }) => {
    if (!inside(c)) return;
    if (tool === 'paint') stampAt(m, layer, c.x, c.y, stamp);
    else if (tool === 'erase') stampAt(m, layer, c.x, c.y, { w: 1, h: 1, ids: [EMPTY] }, true);
    else if (tool === 'terrain' && m.terrains?.[terr]) paintTerrain(m, layer, c.x, c.y, terr);
  };
  const eraseAt = (c: { x: number; y: number }) => { if (tool === 'terrain') paintTerrain(m, layer, c.x, c.y, -1); else stampAt(m, layer, c.x, c.y, { w: 1, h: 1, ids: [EMPTY] }, true); };
  mc.onpointerdown = e => {
    const c = cell(e); if (!inside(c)) return; mc.setPointerCapture(e.pointerId);
    const erase = tool === 'erase' || e.button === 2;
    if (tool === 'pick' || e.altKey) { for (let li = m.layers.length - 1; li >= 0; li--) { const id = m.layers[li].data[c.y * m.cols + c.x]; if (id >= 0 && m.layers[li].visible !== false) { stamp = { w: 1, h: 1, ids: [id] }; layer = li; renderLayers(); setTool('paint'); drawTs(); break; } } draw(); return; }
    snap();
    if (tool === 'fill') { floodFill(m, layer, c.x, c.y, stamp, erase); draw(); return; }
    if (tool === 'rect') { rectFrom = c; draw(); return; }
    if (tool === 'terrain' && !m.terrains?.length) { app.toast('Primero crea un terreno: arrastra en el tileset sobre su bloque de 3 × 3 tiles y pulsa «Crear terreno»', 'warn'); return; }
    painting = true; last = c; if (erase) eraseAt(c); else apply(c); draw();
  };
  // un trazo rápido (sobre todo con el dedo) salta casillas entre dos eventos: se rellenan las de en medio
  let last: { x: number; y: number } | null = null;
  const along = (a: { x: number; y: number }, b: { x: number; y: number }, f: (c: { x: number; y: number }) => void) => {
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    for (let i = 1; i <= n; i++) f({ x: Math.round(a.x + (b.x - a.x) * i / n), y: Math.round(a.y + (b.y - a.y) * i / n) });
  };
  mc.onpointermove = e => {
    const c = cell(e); hover = inside(c) ? c : null;
    if (painting && hover) {
      const f = (q: { x: number; y: number }) => { if (!inside(q)) return; if (e.buttons === 2) eraseAt(q); else apply(q); };
      // con un sello de varios tiles se pinta solo donde está el dedo (si no, los sellos se pisarían)
      if (last && (last.x !== c.x || last.y !== c.y) && (e.buttons === 2 || tool !== 'paint' || stamp.w * stamp.h === 1)) along(last, c, f); else f(c);
      last = c;
    }
    draw();
  };
  mc.onpointerup = e => {
    if (rectFrom) { const c = cell(e), a = rectFrom, x0 = Math.max(0, Math.min(a.x, c.x)), y0 = Math.max(0, Math.min(a.y, c.y)), x1 = Math.min(m.cols - 1, Math.max(a.x, c.x)), y1 = Math.min(m.rows - 1, Math.max(a.y, c.y)); for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m.layers[layer].data[y * m.cols + x] = stamp.ids[((y - y0) % stamp.h) * stamp.w + (x - x0) % stamp.w]; rectFrom = null; }
    painting = false; draw();
  };
  mc.onpointerleave = () => { if (!painting) { hover = null; draw(); } };
  mc.oncontextmenu = e => e.preventDefault();

  // barra de herramientas
  const toolBtns: Record<string, HTMLElement> = {};
  const setTool = (tl: string) => { tool = tl; for (const k in toolBtns) toolBtns[k].classList.toggle('on', k === tl); terrEl?.querySelectorAll('.tm-layer').forEach((x, i) => x.classList.toggle('on', tl === 'terrain' && i === terr)); draw(); };
  const tb = (id: string, ic: string, title: string) => { const b = h('button', { type: 'button', class: 'btn icon-btn', title, 'aria-label': title, html: icon(ic) }); b.onclick = () => setTool(id); toolBtns[id] = b; return b; };
  const act = (ic: string, title: string, fn: () => void) => { const b = h('button', { type: 'button', class: 'btn icon-btn', title, 'aria-label': title, html: icon(ic) }); b.onclick = fn; return b; };
  const doUndo = () => { const s = undo.pop(); if (!s) return; redo.push(JSON.stringify(m)); m = JSON.parse(s); renderLayers(); renderTerr(); draw(); };
  const doRedo = () => { const s = redo.pop(); if (!s) return; undo.push(JSON.stringify(m)); m = JSON.parse(s); renderLayers(); renderTerr(); draw(); };
  const gridBtn = act('marqueeRow', 'Mostrar u ocultar la cuadrícula', () => { grid = !grid; gridBtn.classList.toggle('on', grid); draw(); }); gridBtn.classList.add('on');
  const zoomLbl = h('span', { class: 'tm-zlbl no-i18n' }, `×${zoom}`);
  const setZoom = (z: number) => { zoom = Math.max(1, Math.min(8, z)); zoomLbl.textContent = `×${zoom}`; draw(); };
  const zb = (txt: string, title: string, dz: number) => { const b = h('button', { type: 'button', class: 'btn icon-btn tm-zbtn', title, 'aria-label': title }, txt); b.onclick = () => setZoom(zoom + dz); return b; };
  const zoomBox = h('span', { class: 'tm-zoom' }, zb('−', 'Alejar', -1), zoomLbl, zb('+', 'Acercar', 1));
  const bar = h('div', { class: 'tm-bar' },
    tb('paint', 'brush', 'Pintar tiles'), tb('erase', 'eraser', 'Borrar tiles (también con el botón derecho)'), tb('fill', 'bucket', 'Rellenar zona'), tb('rect', 'marqueeRect', 'Rectángulo de tiles'), tb('terrain', 'terrain', 'Pintar terreno (los bordes y esquinas se ponen solos)'), tb('pick', 'eyedropper', 'Coger un tile del mapa (también con Alt)'),
    h('span', { class: 'tm-sep' }), act('undo', 'Deshacer', doUndo), act('redo', 'Rehacer', doRedo), gridBtn,
    zoomBox);
  toolBtns.paint.classList.add('on');

  // capas del mapa
  const layersEl = h('div', { class: 'tm-layers' });
  const renderLayers = () => {
    layersEl.replaceChildren(...m.layers.map((l, li) => {
      const eye = h('button', { type: 'button', class: 'btn icon-btn' + (l.visible === false ? '' : ' on'), title: 'Mostrar u ocultar la capa', 'aria-label': 'Mostrar u ocultar la capa', html: icon('eye') }); eye.onclick = e => { e.stopPropagation(); l.visible = l.visible === false; renderLayers(); draw(); };
      const name = h('span', { class: 'tm-lname no-i18n' }, l.name); name.ondblclick = () => { const v = prompt('Nombre de la capa', l.name); if (v) { l.name = v; renderLayers(); } };
      const r = h('div', { class: 'tm-layer' + (li === layer ? ' on' : ''), title: 'Doble toque en el nombre para cambiarlo' }, eye, name); r.onclick = () => { layer = li; renderLayers(); draw(); }; return r;
    }), h('div', { class: 'tm-lbtns' }, act('plus', 'Nueva capa del mapa', () => { snap(); m.layers.push({ name: tName(`Capa ${m.layers.length + 1}`), data: new Array(m.cols * m.rows).fill(EMPTY) }); layer = m.layers.length - 1; renderLayers(); draw(); }),
      act('trash', 'Borrar la capa del mapa', () => { if (m.layers.length < 2) return; snap(); m.layers.splice(layer, 1); layer = Math.max(0, layer - 1); renderLayers(); draw(); })));
  };
  renderLayers();

  // terrenos automáticos
  const terrEl = h('div', { class: 'tm-terrains' });
  const renderTerr = () => {
    const list = (m.terrains ?? []).map((tr, ti) => {
      const th = h('canvas', { class: 'tm-tthumb', width: 3 * m.tile, height: 3 * m.tile }) as HTMLCanvasElement, tx = ctx2d(th); tx.imageSmoothingEnabled = false;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { const id = tr.base + r * info.cols + c; tx.drawImage(ts, (id % info.cols) * m.tile, Math.floor(id / info.cols) * m.tile, m.tile, m.tile, c * m.tile, r * m.tile, m.tile, m.tile); }
      const del = act('trash', 'Borrar el terreno', () => { snap(); m.terrains!.splice(ti, 1); for (const l of m.layers) if (l.terr) l.terr = l.terr.map(v => v === ti ? -1 : v > ti ? v - 1 : v); terr = 0; renderTerr(); draw(); });
      const it = h('div', { class: 'tm-layer' + (ti === terr && tool === 'terrain' ? ' on' : '') }, th, h('span', { class: 'tm-lname no-i18n' }, tr.name + (tr.inner != null ? ' +' : '')), del);
      it.onclick = e => { if ((e.target as HTMLElement).closest('button')) return; terr = ti; setTool('terrain'); renderTerr(); };
      return it;
    });
    const mk = h('button', { type: 'button', class: 'btn' }, 'Crear terreno'); mk.title = 'Arrastra antes en el tileset sobre el bloque de 3 × 3 tiles: esquinas, bordes y centro';
    mk.onclick = () => { if (stamp.w !== 3 || stamp.h !== 3) { app.toast('Arrastra en el tileset sobre un bloque de 3 × 3 tiles (esquinas, bordes y centro)', 'warn'); return; } snap(); (m.terrains ??= []).push({ name: `${t('Terreno')} ${m.terrains.length + 1}`, base: stamp.ids[0] }); terr = m.terrains.length - 1; setTool('terrain'); renderTerr(); };
    const inn = h('button', { type: 'button', class: 'btn' }, 'Rincones interiores'); inn.title = 'Opcional: arrastra en el tileset sobre el bloque de 2 × 2 de rincones interiores (arriba-izquierda, arriba-derecha, abajo-izquierda, abajo-derecha)';
    inn.onclick = () => { const tr = m.terrains?.[terr]; if (!tr) { app.toast('Crea antes el terreno', 'warn'); return; } if (stamp.w !== 2 || stamp.h !== 2) { app.toast('Arrastra en el tileset sobre un bloque de 2 × 2 tiles', 'warn'); return; } snap(); tr.inner = stamp.ids[0]; relayTerrain(); renderTerr(); draw(); };
    terrEl.replaceChildren(h('div', { class: 'tm-sub' }, t('Terrenos automáticos')), ...list, h('div', { class: 'tm-lbtns' }, mk, inn));
  };
  const relayTerrain = () => { for (let li = 0; li < m.layers.length; li++) { const L = m.layers[li]; if (!L.terr) continue; for (let y = 0; y < m.rows; y++) for (let x = 0; x < m.cols; x++) if (L.terr[y * m.cols + x] >= 0) L.data[y * m.cols + x] = terrainTile(m, li, x, y); } };
  renderTerr();

  // tamaño del mapa y de los tiles
  const tileSel = h('select', { title: 'Tamaño de cada tile del tileset' }, ...[8, 12, 16, 24, 32, 48, 64, 128].map(n => h('option', { value: String(n) }, `${n} px`))) as HTMLSelectElement; tileSel.value = String(m.tile);
  if (!tileSel.value) { tileSel.append(h('option', { value: String(m.tile) }, `${m.tile} px`)); tileSel.value = String(m.tile); }
  tileSel.onchange = () => { m.tile = +tileSel.value; info = tilesetInfo(ts, m.tile); m.tsCols = info.cols; stamp = { w: 1, h: 1, ids: [0] }; drawTs(); draw(); };
  const colsIn = h('input', { type: 'number', min: '1', max: '512', value: String(m.cols), class: 'input tm-num', 'aria-label': 'Columnas' }) as HTMLInputElement;
  const rowsIn = h('input', { type: 'number', min: '1', max: '512', value: String(m.rows), class: 'input tm-num', 'aria-label': 'Filas' }) as HTMLInputElement;
  const resize = () => { const c = Math.max(1, Math.min(512, Math.round(+colsIn.value || 1))), r = Math.max(1, Math.min(512, Math.round(+rowsIn.value || 1))); if (c === m.cols && r === m.rows) return; snap(); resizeMap(m, c, r); draw(); };
  colsIn.onchange = resize; rowsIn.onchange = resize;
  const status = h('div', { class: 'hint tm-status' });

  const save = () => { d.meta.tilemap = JSON.parse(JSON.stringify(m)); d.modified = true; };
  const exportZip = async () => {
    const png = async (c: HTMLCanvasElement) => new Uint8Array(await (await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/png'))).arrayBuffer());
    const enc = new TextEncoder(), files = [
      { name: 'mapa.png', data: await png(renderMap(m, ts)) }, { name: 'tileset.png', data: await png(ts) },
      { name: 'mapa.tmj', data: enc.encode(JSON.stringify(toTiled(m, ts), null, 1)) },
      ...m.layers.map((l, i) => ({ name: `mapa_${i + 1}_${l.name.replace(/[^\w-]+/g, '_')}.csv`, data: enc.encode(toCSV(m, i)) })),
    ];
    const { makeZip } = await import('../io/zip'), io = await import('../io/files');
    try { await io.saveBlob(makeZip(files), `${d.name}-mapa.zip`); app.toast('Mapa exportado: .tmj para Tiled, Godot, Phaser…, CSV y PNG'); } catch (e: any) { if (e?.name !== 'AbortError') app.toast(String(e?.message ?? e), 'warn'); }
  };
  const toImage = () => {
    save();
    const nd = new EditorDocument(`${d.name} mapa`, m.cols * m.tile, m.rows * m.tile);
    m.layers.forEach((l, li) => { const r = new RasterLayer(l.name, nd.width, nd.height); ctx2d(r.canvas).drawImage(renderMap(m, ts, 1, li), 0, 0); r.visible = l.visible !== false; nd.root.add(r); });
    if (d.meta.pixelArt) nd.meta.pixelArt = true;
    app.addDocument(nd, 'Mapa de tiles'); requestAnimationFrame(() => app.viewport.fit());
  };
  const wrap = h('div', { class: 'tm-wrap', tabindex: '0' },
    h('div', { class: 'tm-left' }, h('div', { class: 'form-row' }, h('label', {}, 'Tamaño del tile'), tileSel), h('div', { class: 'tm-ts-wrap' }, tsc), h('div', { class: 'hint' }, 'Toca un tile o arrastra para coger un bloque (un árbol, una casa…).'), layersEl, terrEl),
    h('div', { class: 'tm-right' }, bar, h('div', { class: 'tm-map-wrap' }, mc), h('div', { class: 'tm-size' }, h('label', {}, 'Columnas'), colsIn, h('label', {}, 'Filas'), rowsIn), status));
  wrap.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.stopPropagation(); e.shiftKey ? doRedo() : doUndo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); e.stopPropagation(); doRedo(); }
    else if (!e.ctrlKey && !e.metaKey && !e.altKey) { const map: Record<string, string> = { b: 'paint', e: 'erase', g: 'fill', u: 'rect', i: 'pick', t: 'terrain' }; if (map[k]) { e.preventDefault(); e.stopPropagation(); setTool(map[k]); } }
  });
  const exp = h('button', { type: 'button', class: 'btn' }, 'Exportar mapa…'); exp.onclick = () => { save(); exportZip(); };
  const img = h('button', { type: 'button', class: 'btn' }, 'Crear imagen del mapa'); img.onclick = toImage;
  drawTs(); draw();
  showDialog({ title: 'Editor de mapas de tiles', okLabel: 'Guardar mapa', width: 980, body: wrap, extraButtons: [exp, img], onOk: () => { save(); app.toast('Mapa guardado con el documento (se guarda en el proyecto)'); } });
  requestAnimationFrame(() => {
    wrap.focus();
    // el mapa entra entero con el zoom más grande que quepa (en píxeles enteros, nítido)
    const mw = mc.parentElement as HTMLElement, W = mw.clientWidth - 4, Hh = parseFloat(getComputedStyle(mw).maxHeight) || 400;
    const z = Math.floor(Math.min(W / (m.cols * m.tile), Hh / (m.rows * m.tile)));
    if (z > zoom) setZoom(z);
  });
}
/** Intenta adivinar el tamaño de los tiles (16 px si encaja; si no, el mayor divisor común razonable). */
function guessTile(d: EditorDocument) {
  for (const t of [16, 32, 8, 24, 48, 64]) if (d.width % t === 0 && d.height % t === 0 && d.width / t >= 2) return t;
  return 16;
}
