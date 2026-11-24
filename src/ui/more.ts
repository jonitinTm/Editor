// Más funciones de los editores profesionales:
// volver a seleccionar, seleccionar todas las capas, halos (quitar halo / mate negro o blanco), cuadrícula de píxeles,
// prueba de impresión CMYK y aviso de gama, fotogramas de vídeo a capas, hoja de contactos, encajar imagen,
// desplazar con otra capa como mapa y fusión de enfoque (apilar fotos enfocadas en distintos puntos).

import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog, row } from './dialog';
import { EditorDocument } from '../core/document';
import { RasterLayer, TextLayer, isRaster } from '../core/layers';
import { ctx2d, makeCanvas, cloneCanvas } from '../core/canvas';
import type { Viewport } from './viewport';
import { maxCanvasPixels } from '../core/polyfills';

const doc = () => app.doc;

// ---- Selección ----------------------------------------------------------------------------------
export function reselect() {
  const d = doc(); if (!d) return;
  if (!d.selection.last) { app.toast('No hay una selección anterior', 'warn'); return; }
  d.selection.setMask(d.selection.last); d.commit('Volver a seleccionar');
}
export function selectAllLayers() {
  const d = doc(); if (!d) return;
  d.selectedIds = new Set(d.allLayers().filter(l => l.kind !== 'group').map(l => l.id)); d.changed();
  app.toast(`${d.selectedIds.size} capas seleccionadas`);
}

// ---- Halos ----------------------------------------------------------------------------------------
/** Píxeles del borde de un recorte: su color se sustituye por el de los píxeles de dentro (quita el halo del fondo viejo). */
export function defringe(width: number) {
  const d = doc(), l = d?.active; if (!d || !l || !isRaster(l)) return;
  const c = (l as RasterLayer).canvas, W = c.width, H = c.height, x = ctx2d(c), img = x.getImageData(0, 0, W, H), a = img.data;
  // distancia (en píxeles, aproximada) a la transparencia
  const dist = new Float32Array(W * H).fill(1e9);
  for (let i = 0; i < W * H; i++) if (a[i * 4 + 3] < 250) dist[i] = 0;
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) { const i = y * W + xx; if (xx > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1); if (y > 0) dist[i] = Math.min(dist[i], dist[i - W] + 1); }
  for (let y = H - 1; y >= 0; y--) for (let xx = W - 1; xx >= 0; xx--) { const i = y * W + xx; if (xx < W - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1); if (y < H - 1) dist[i] = Math.min(dist[i], dist[i + W] + 1); }
  // de dentro hacia fuera: cada píxel del borde toma el color medio de sus vecinos más interiores
  for (let k = width; k >= 0; k--) for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    const i = y * W + xx; if (dist[i] !== k || a[i * 4 + 3] === 0) continue;
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + dy, x2 = xx + dx; if (yy < 0 || x2 < 0 || yy >= H || x2 >= W) continue; const j = yy * W + x2; if (dist[j] > k) { r += a[j * 4]; g += a[j * 4 + 1]; b += a[j * 4 + 2]; n++; } }
    if (n) { a[i * 4] = r / n; a[i * 4 + 1] = g / n; a[i * 4 + 2] = b / n; }
  }
  x.putImageData(img, 0, 0); (l as RasterLayer).touch(); d.invalidate(); d.commit('Quitar halo');
}
/** Quita el mate negro o blanco: los bordes semitransparentes que se recortaron sobre fondo negro/blanco dejan de oscurecer o aclarar. */
export function removeMatte(white: boolean) {
  const d = doc(), l = d?.active; if (!d || !l || !isRaster(l)) return;
  const c = (l as RasterLayer).canvas, x = ctx2d(c), img = x.getImageData(0, 0, c.width, c.height), a = img.data, m = white ? 255 : 0;
  for (let i = 0; i < a.length; i += 4) { const al = a[i + 3] / 255; if (al <= 0 || al >= 1) continue; for (let k = 0; k < 3; k++) a[i + k] = (a[i + k] - m * (1 - al)) / al; }
  x.putImageData(img, 0, 0); (l as RasterLayer).touch(); d.invalidate(); d.commit(white ? 'Quitar mate blanco' : 'Quitar mate negro');
}
export function defringeDialog() {
  let w = 1;
  showDialog({ title: 'Quitar halo', width: 360, body: [row('Anchura', numberSlider({ min: 1, max: 20, value: w, unit: 'px', onInput: v => w = v }).el), h('div', { class: 'hint' }, 'Útil tras recortar un objeto: el borde deja de tener el color del fondo antiguo.')], onOk: () => defringe(Math.round(w)) });
}

// ---- Cuadrícula de píxeles y prueba de impresión -------------------------------------------------------
export const viewOpts = { pixelGrid: true, proof: false, gamut: false };
export function togglePixelGrid() { viewOpts.pixelGrid = !viewOpts.pixelGrid; app.viewport.requestRender(); app.emit('view'); }
export function toggleProof() { viewOpts.proof = !viewOpts.proof; app.viewport.requestRender(); app.emit('view'); if (viewOpts.proof) app.toast('Prueba de impresión CMYK: así se verá aproximadamente en papel (la imagen no cambia)'); }
export function toggleGamut() { viewOpts.gamut = !viewOpts.gamut; app.viewport.requestRender(); app.emit('view'); if (viewOpts.gamut) app.toast('En gris: colores que una imprenta no puede reproducir'); }

// tintas de cuatricromía y papel (aproximación de un papel estucado)
const INK = { c: [0, 158, 224], m: [226, 0, 122], y: [255, 237, 0], k: [35, 31, 32] }, PAPER = [250, 250, 247];
/** Color tal como saldría impreso: separación CMYK sencilla y mezcla de tintas reales sobre el papel. */
function printSim(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255, K = 1 - Math.max(R, G, B);
  const C = K >= 1 ? 0 : (1 - R - K) / (1 - K), M = K >= 1 ? 0 : (1 - G - K) / (1 - K), Y = K >= 1 ? 0 : (1 - B - K) / (1 - K);
  const k = Math.min(1, K * 0.92); // límite de tinta total
  const out = PAPER.map(v => v / 255);
  const lay = (ink: number[], amt: number) => { for (let i = 0; i < 3; i++) out[i] *= 1 - amt + amt * ink[i] / 255; };
  lay(INK.c, C * 0.95); lay(INK.m, M * 0.95); lay(INK.y, Y); lay(INK.k, k);
  return [out[0] * 255, out[1] * 255, out[2] * 255];
}
// tablas de la prueba de impresión: se calculan la primera vez que se usan (antes, al arrancar la app)
let PROOF_LUT: Uint8Array, GAMUT_LUT: Uint8Array, lutsReady = false;
function buildProofLuts() {
  if (lutsReady) return; lutsReady = true;
  PROOF_LUT = new Uint8Array(32 * 32 * 32 * 3); GAMUT_LUT = new Uint8Array(32 * 32 * 32);
  for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
    const i = (r * 32 + g) * 32 + b, [pr, pg, pb] = printSim(r * 8.23, g * 8.23, b * 8.23);
    PROOF_LUT[i * 3] = pr; PROOF_LUT[i * 3 + 1] = pg; PROOF_LUT[i * 3 + 2] = pb;
    // fuera de gama: lo impreso se aleja mucho del original (en color, no en luz)
    const dr = pr - r * 8.23, dg = pg - g * 8.23, db = pb - b * 8.23, mean = (dr + dg + db) / 3;
    GAMUT_LUT[i] = Math.hypot(dr - mean, dg - mean, db - mean) > 28 ? 1 : 0;
  }
}
function drawViewExtras(ctx: CanvasRenderingContext2D, vp: Viewport) {
  const d = app.doc; if (!d) return;
  const dpr = (vp as any).dpr ?? 1;
  if (viewOpts.proof || viewOpts.gamut) {
    buildProofLuts();
    const pts = [vp.toScreen(0, 0), vp.toScreen(d.width, 0), vp.toScreen(0, d.height), vp.toScreen(d.width, d.height)];
    const x0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p.x)) * dpr)), y0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p.y)) * dpr));
    const x1 = Math.min(ctx.canvas.width, Math.ceil(Math.max(...pts.map(p => p.x)) * dpr)), y1 = Math.min(ctx.canvas.height, Math.ceil(Math.max(...pts.map(p => p.y)) * dpr));
    if (x1 > x0 && y1 > y0) {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0), a = img.data;
      for (let i = 0; i < a.length; i += 4) {
        const q = ((a[i] >> 3) * 32 + (a[i + 1] >> 3)) * 32 + (a[i + 2] >> 3);
        if (viewOpts.gamut && GAMUT_LUT[q]) { a[i] = a[i + 1] = a[i + 2] = 128; continue; }
        if (viewOpts.proof) { a[i] = PROOF_LUT[q * 3]; a[i + 1] = PROOF_LUT[q * 3 + 1]; a[i + 2] = PROOF_LUT[q * 3 + 2]; }
      }
      ctx.putImageData(img, x0, y0); ctx.restore();
    }
  }
  // cuadrícula de píxeles al acercar mucho
  const z = d.view.zoom;
  if (viewOpts.pixelGrid && z >= 8 && !(vp as any).rot) {
    const a = vp.toScreen(0, 0), W = vp.width, H = vp.height;
    const xs = Math.max(0, Math.floor(-a.x / z)), xe = Math.min(d.width, Math.ceil((W - a.x) / z)), ys = Math.max(0, Math.floor(-a.y / z)), ye = Math.min(d.height, Math.ceil((H - a.y) / z));
    ctx.save(); ctx.strokeStyle = 'rgba(128,128,128,.45)'; ctx.lineWidth = 1 / dpr; ctx.beginPath();
    for (let x = xs; x <= xe; x++) { const sx = Math.round((a.x + x * z) * dpr) / dpr + 0.5 / dpr; ctx.moveTo(sx, a.y + ys * z); ctx.lineTo(sx, a.y + ye * z); }
    for (let y = ys; y <= ye; y++) { const sy = Math.round((a.y + y * z) * dpr) / dpr + 0.5 / dpr; ctx.moveTo(a.x + xs * z, sy); ctx.lineTo(a.x + xe * z, sy); }
    ctx.stroke(); ctx.restore();
  }
}
(app as any).drawViewExtras = drawViewExtras;

// ---- Fotogramas de vídeo a capas ------------------------------------------------------------------
export function videoFramesDialog() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'video/*';
  inp.onchange = () => { const f = inp.files?.[0]; if (f) videoFramesOptions(f); };
  inp.click();
}
function videoFramesOptions(file: File) {
  let every = 0.5, max = 30;
  showDialog({ title: 'Fotogramas de vídeo a capas', width: 380,
    body: [row('Un fotograma cada', numberSlider({ min: 0.1, max: 10, step: 0.1, value: every, unit: 's', onInput: v => every = v }).el), row('Como mucho', numberSlider({ min: 2, max: 200, value: max, unit: 'capas', onInput: v => max = v }).el),
      h('div', { class: 'hint' }, 'Cada fotograma va en una capa y en un cuadro de la Línea de tiempo (para hacer un GIF o retocar).')],
    onOk: () => { importVideoFrames(file, every, Math.round(max)); } });
}
export async function importVideoFrames(file: Blob, every: number, max: number, name = 'Vídeo') {
  const url = URL.createObjectURL(file), v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  try {
    await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('El navegador no puede abrir este vídeo')); });
    let W = v.videoWidth, H = v.videoHeight; const lim = maxCanvasPixels() / Math.max(4, Math.min(max, 40));
    if (W * H > lim) { const k = Math.sqrt(lim / (W * H)); W = Math.round(W * k); H = Math.round(H * k); }
    const d = new EditorDocument(name, W, H), times: number[] = [];
    for (let t = 0; t < v.duration && times.length < max; t += every) times.push(t);
    app.toast(`Leyendo ${times.length} fotogramas…`);
    for (const [i, t] of times.entries()) {
      await new Promise<void>(res => { v.onseeked = () => res(); v.currentTime = Math.min(t, Math.max(0, v.duration - 0.05)); });
      const l = new RasterLayer(`Fotograma ${i + 1} (${t.toFixed(1)} s)`, W, H); ctx2d(l.canvas).drawImage(v, 0, 0, W, H); l.visible = i === 0;
      d.root.add(l); d.frames.push({ delay: Math.round(every * 1000), visible: [l.id] });
    }
    d.setActive(d.root.children[0], false);
    app.addDocument(d, 'Fotogramas de vídeo');
  } catch (e: any) { app.toast(String(e?.message ?? e), 'warn'); }
  finally { URL.revokeObjectURL(url); }
}

// ---- Hoja de contactos y encajar imagen ------------------------------------------------------------
export function contactSheetDialog() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
  inp.onchange = () => { const fs = [...(inp.files ?? [])]; if (fs.length) contactSheetOptions(fs); };
  inp.click();
}
function contactSheetOptions(files: File[]) {
  let cols = Math.min(4, Math.ceil(Math.sqrt(files.length))), page = 'a4';
  const ps = h('select', {}, h('option', { value: 'a4' }, 'A4 vertical (2480 × 3508)'), h('option', { value: 'a4l' }, 'A4 horizontal (3508 × 2480)'), h('option', { value: 'sq' }, 'Cuadrado (3000 × 3000)'), h('option', { value: 'web' }, 'Pantalla (1920 × 1080)')) as HTMLSelectElement;
  ps.onchange = () => page = ps.value;
  const names = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  showDialog({ title: `Hoja de contactos (${files.length} imágenes)`, width: 400,
    body: [row('Columnas', numberSlider({ min: 1, max: 12, value: cols, onInput: v => cols = v }).el), row('Página', ps), h('label', { class: 'check' }, names, ' Poner el nombre de cada archivo')],
    onOk: () => { makeContactSheet(files, Math.round(cols), page, names.checked); } });
}
export async function makeContactSheet(files: File[], cols: number, page: string, labels: boolean) {
  const [W, H] = page === 'a4l' ? [3508, 2480] : page === 'sq' ? [3000, 3000] : page === 'web' ? [1920, 1080] : [2480, 3508];
  const rows = Math.ceil(files.length / cols), m = Math.round(W * 0.03), gap = Math.round(W * 0.015), labelH = labels ? Math.round(W * 0.018) : 0;
  const cw = (W - 2 * m - gap * (cols - 1)) / cols, chh = (H - 2 * m - gap * (rows - 1)) / rows - labelH;
  const d = new EditorDocument('Hoja de contactos', W, H);
  const bg = new RasterLayer('Fondo', W, H); const bx = ctx2d(bg.canvas); bx.fillStyle = '#ffffff'; bx.fillRect(0, 0, W, H); d.root.add(bg);
  const io = await import('../io/files');
  for (const [i, f] of files.entries()) {
    try {
      const img = await io.imageToCanvas(f), c = i % cols, r = Math.floor(i / cols);
      const s = Math.min(cw / img.width, chh / img.height), w = img.width * s, hh = img.height * s;
      const x = m + c * (cw + gap) + (cw - w) / 2, y = m + r * (chh + labelH + gap) + (chh - hh) / 2;
      const l = new RasterLayer(f.name, W, H), lx = ctx2d(l.canvas); lx.imageSmoothingQuality = 'high'; lx.drawImage(img, x, y, w, hh); d.root.add(l);
      if (labels) {
        const t = new TextLayer(f.name, W, H, { text: f.name.replace(/\.[^.]+$/, ''), font: 'Arial', size: Math.round(labelH * 0.7), color: '#333333', bold: false, italic: false, align: 'center', lineHeight: 1.2, tracking: 0, x: Math.round(m + c * (cw + gap)), y: Math.round(m + r * (chh + labelH + gap) + chh + labelH * 0.1), boxWidth: Math.round(cw) } as any);
        d.root.add(t);
      }
    } catch { /* imagen que no se puede abrir */ }
  }
  d.setActive(d.root.children[d.root.children.length - 1], false);
  app.addDocument(d, 'Hoja de contactos');
}
export function fitImageDialog() {
  const d = doc(); if (!d) return;
  let w = Math.min(d.width, 1920), hh = Math.min(d.height, 1920);
  const up = h('input', { type: 'checkbox' }) as HTMLInputElement;
  showDialog({ title: 'Encajar imagen', width: 360, body: [row('Anchura máxima', numberSlider({ min: 16, max: 20000, value: w, unit: 'px', onInput: v => w = v }).el), row('Altura máxima', numberSlider({ min: 16, max: 20000, value: hh, unit: 'px', onInput: v => hh = v }).el), h('label', { class: 'check' }, up, ' Permitir ampliar'), h('div', { class: 'hint' }, 'Cambia el tamaño sin deformar para que quepa en esa caja.')],
    onOk: () => {
      let k = Math.min(w / d.width, hh / d.height); if (!up.checked) k = Math.min(1, k);
      const nw = Math.max(1, Math.round(d.width * k)), nh = Math.max(1, Math.round(d.height * k));
      if (nw === d.width && nh === d.height) { app.toast('La imagen ya cabe'); return; }
      d.resample(nw, nh); d.commit('Encajar imagen'); app.viewport.fit(true); app.toast(`Ahora mide ${nw} × ${nh}`);
    } });
}

// ---- Desplazar con otra capa como mapa ------------------------------------------------------------------
export function displaceDialog() {
  const d = doc(), l = d?.active; if (!d || !l || !isRaster(l)) { app.toast('Elige la capa que quieres deformar', 'warn'); return; }
  const maps = d.allLayers().filter(m => m !== l && isRaster(m));
  if (!maps.length) { app.toast('Necesitas otra capa que haga de mapa (por ejemplo, una foto de tela o de agua)', 'warn'); return; }
  const sel = h('select', {}, ...maps.map(m => h('option', { value: String(m.id) }, m.name))) as HTMLSelectElement;
  let sx = 20, sy = 20;
  const before = cloneCanvas((l as RasterLayer).canvas);
  const run = () => { const m = maps.find(x => String(x.id) === sel.value) as RasterLayer; if (!m) return; (l as RasterLayer).canvas = displaceBy(before, m.canvas, sx, sy); (l as RasterLayer).touch(); d.invalidate(); };
  let t = 0; const later = () => { clearTimeout(t); t = window.setTimeout(run, 60); };
  sel.onchange = later;
  showDialog({ title: 'Desplazar', width: 400, side: true, okLabel: 'Aplicar',
    body: [row('Mapa', sel), row('Escala horizontal', numberSlider({ min: -200, max: 200, value: sx, unit: 'px', onInput: v => { sx = v; later(); } }).el), row('Escala vertical', numberSlider({ min: -200, max: 200, value: sy, unit: 'px', onInput: v => { sy = v; later(); } }).el),
      h('div', { class: 'hint' }, 'Las zonas claras del mapa empujan en un sentido y las oscuras en el otro: sirve para que un dibujo o un texto siga las arrugas de una tela, el agua, una pared…')],
    onOk: () => { clearTimeout(t); run(); d.commit('Desplazar'); },
    onCancel: () => { clearTimeout(t); (l as RasterLayer).canvas = before; (l as RasterLayer).touch(); d.invalidate(); } });
  run();
}
export function displaceBy(src: HTMLCanvasElement, map: HTMLCanvasElement, sx: number, sy: number): HTMLCanvasElement {
  const W = src.width, H = src.height, out = makeCanvas(W, H), S = ctx2d(src).getImageData(0, 0, W, H).data;
  const mc = makeCanvas(W, H); ctx2d(mc).drawImage(map, 0, 0, W, H); const M = ctx2d(mc).getImageData(0, 0, W, H).data;
  const o = ctx2d(out).createImageData(W, H), D = o.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, lum = (M[i] * 0.299 + M[i + 1] * 0.587 + M[i + 2] * 0.114) / 255 - 0.5;
    const fx = x + lum * sx * 2, fy = y + lum * sy * 2;
    const x0 = Math.max(0, Math.min(W - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(H - 1, Math.floor(fy))), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), ax = Math.max(0, Math.min(1, fx - x0)), ay = Math.max(0, Math.min(1, fy - y0));
    for (let c = 0; c < 4; c++) {
      const a = S[(y0 * W + x0) * 4 + c], b = S[(y0 * W + x1) * 4 + c], cc = S[(y1 * W + x0) * 4 + c], dd = S[(y1 * W + x1) * 4 + c];
      D[i + c] = (a * (1 - ax) + b * ax) * (1 - ay) + (cc * (1 - ax) + dd * ax) * ay;
    }
  }
  ctx2d(out).putImageData(o, 0, 0); return out;
}

// ---- Fusión de enfoque (apilar fotos) ------------------------------------------------------------------
/** De varias fotos iguales enfocadas en distintos puntos, una sola nítida en todas partes. */
export function focusStack() {
  const d = doc(); if (!d) return;
  const order = d.allLayers();
  const list = (d.selectedIds.size > 1 ? order.filter(l => d.selectedIds.has(l.id)) : order).filter(l => isRaster(l) && l.visible) as RasterLayer[];
  if (list.length < 2) { app.toast('Selecciona dos o más capas con la misma foto enfocada en distintos puntos (Ctrl+clic en Capas); si no están alineadas, usa antes Alinear capas automáticamente', 'warn'); return; }
  const W = d.width, H = d.height, n = list.length;
  const px = list.map(l => ctx2d(l.canvas).getImageData(0, 0, W, H).data);
  // nitidez local de cada foto: energía del laplaciano, suavizada
  const sharp = px.map(a => {
    const e = makeCanvas(W, H), ex = ctx2d(e), img = ex.createImageData(W, H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = (y * W + x) * 4, L = (k: number) => a[k] * 0.299 + a[k + 1] * 0.587 + a[k + 2] * 0.114;
      const v = Math.min(255, Math.abs(4 * L(i) - L(i - 4) - L(i + 4) - L(i - W * 4) - L(i + W * 4)) * 2);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    ex.putImageData(img, 0, 0);
    const b = makeCanvas(W, H), bx = ctx2d(b); bx.filter = `blur(${Math.max(2, Math.round(Math.min(W, H) / 150))}px)`; bx.drawImage(e, 0, 0); bx.filter = 'none';
    return bx.getImageData(0, 0, W, H).data;
  });
  const out = new RasterLayer('Fusión de enfoque', W, H), ox = ctx2d(out.canvas), o = ox.createImageData(W, H), D = o.data;
  for (let i = 0; i < W * H * 4; i += 4) {
    // mezcla suave: cada foto pesa según lo nítida que está ahí (elevado a una potencia para que mande la más nítida)
    let ws = 0, r = 0, g = 0, b = 0, a = 0;
    for (let k = 0; k < n; k++) { const w = Math.pow(sharp[k][i] + 1, 4); ws += w; r += px[k][i] * w; g += px[k][i + 1] * w; b += px[k][i + 2] * w; a += px[k][i + 3] * w; }
    D[i] = r / ws; D[i + 1] = g / ws; D[i + 2] = b / ws; D[i + 3] = a / ws;
  }
  ox.putImageData(o, 0, 0);
  const top = list[list.length - 1]; top.parent!.add(out, top.parent!.children.indexOf(top) + 1);
  d.setActive(out); d.invalidate(); d.commit('Fusión de enfoque');
  app.toast('Hecho: la capa «Fusión de enfoque» combina lo más nítido de cada foto');
}

