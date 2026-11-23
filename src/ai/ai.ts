// Herramientas de inteligencia artificial que funcionan en el propio dispositivo (la imagen no sale de él).
// Usan modelos abiertos (licencias Apache/MIT) con la biblioteca transformers.js. Cada modelo se descarga solo
// la primera vez que se usa y queda guardado en el navegador; la app en sí no pesa más.
//
// · Quitar fondo (ORMBG)               · Seleccionar objeto con un clic (SlimSAM)
// · Mapa de profundidad (Depth Anything v2): desenfoque por profundidad, foto 3D animada, capa de profundidad
// · Ampliar ×2 / ×4 sin perder nitidez (Swin2SR)

import { app } from '../ui/app';
import { h } from '../ui/dom';
import { showDialog } from '../ui/dialog';
import { ctx2d, makeCanvas } from '../core/canvas';

export type { ModelKey } from './aicore';
import type { ModelKey, Out } from './aicore';
import AIWorker from './aiworker?worker&inline';
export const MODELS: Record<ModelKey, { name: string; mb: number }> = {
  bg: { name: 'Quitar fondo', mb: 44 },
  sam: { name: 'Seleccionar objetos', mb: 14 },
  depth: { name: 'Profundidad', mb: 27 },
  up2: { name: 'Ampliar ×2', mb: 6 },
  up4: { name: 'Ampliar ×4 (fotos)', mb: 21 },
  erase: { name: 'Borrar con IA', mb: 28 },
};

// ---- Hilo de fondo (con la ventana como respaldo) --------------------------------------------------------
let W: Worker | null | undefined;
const pend = new Map<number, { res: (o: Out) => void; rej: (e: any) => void; prog: (p: any) => void }>();
let seq = 0;
class Fatal extends Error {}
function worker(): Worker | null {
  if (W !== undefined) return W;
  try {
    W = new AIWorker();
    W.onmessage = e => { const m = e.data, p = pend.get(m.id); if (!p) return; if (m.prog) { p.prog(m.prog); return; } pend.delete(m.id); if (m.out) p.res(m.out); else p.rej(m.fatal ? new Fatal(m.error) : new Error(m.error)); };
    W.onerror = e => { e.preventDefault?.(); for (const p of pend.values()) p.rej(new Fatal('worker')); pend.clear(); W?.terminate(); W = null; };
  } catch { W = null; }
  return W;
}
/** Ejecuta una operación de IA en el hilo de fondo; si el navegador no lo permite, en la propia ventana. */
async function call(op: string, a: any, prog: (p: any) => void): Promise<Out> {
  const w = worker();
  if (w) {
    try { return await new Promise<Out>((res, rej) => { const id = ++seq; pend.set(id, { res, rej, prog }); w.postMessage({ id, op, a }); }); }
    catch (e) { if (!(e instanceof Fatal)) throw e; W?.terminate(); W = null; }
  }
  const core = await import('./aicore'); return core.run(op, a, prog);
}
async function hasGPU() { try { const g = (navigator as any).gpu; return !!g && !!(await g.requestAdapter()); } catch { return false; } }
async function device() { return (await hasGPU()) ? 'webgpu' : 'wasm'; }
export async function aiSpeedHint() { return (await device()) === 'webgpu' ? 'con la tarjeta gráfica (rápido)' : 'con el procesador (puede tardar unos segundos)'; }

// ---- Aviso de descarga y progreso -------------------------------------------------------------------------
const OK_KEY = 'editor.aiOk';
function accepted(k: ModelKey) { try { return (JSON.parse(localStorage.getItem(OK_KEY) || '[]') as string[]).includes(k); } catch { return false; } }
function accept(k: ModelKey) { try { const l = JSON.parse(localStorage.getItem(OK_KEY) || '[]'); if (!l.includes(k)) l.push(k); localStorage.setItem(OK_KEY, JSON.stringify(l)); } catch { /* */ } }
/** La primera vez, pide permiso para descargar el modelo (y explica que la imagen no sale del dispositivo). */
export function confirmModel(k: ModelKey): Promise<boolean> {
  if (accepted(k)) return Promise.resolve(true);
  const m = MODELS[k];
  return new Promise(res => showDialog({ title: 'Herramienta con IA', width: 420, okLabel: `Descargar (${m.mb} MB) y usar`,
    body: [h('p', {}, `«${m.name}» usa un modelo de inteligencia artificial que funciona en tu dispositivo: tu imagen no se envía a ningún sitio.`),
      h('p', {}, `La primera vez hay que descargar el modelo (${m.mb} MB). Luego queda guardado y funciona sin conexión.`),
      h('div', { class: 'hint' }, 'Consejo: en el móvil, mejor con wifi.')],
    onOk: () => { accept(k); res(true); }, onCancel: () => res(false) }));
}
let prog: { el: HTMLElement; bar: HTMLElement; txt: HTMLElement } | null = null;
function progress(msg: string, frac: number | null) {
  if (!prog) {
    const bar = h('div', { class: 'ai-bar-in' }), txt = h('div', { class: 'ai-txt' }), el = h('div', { class: 'ai-prog' }, h('div', { class: 'ai-spin' }), h('div', { class: 'ai-body' }, txt, h('div', { class: 'ai-bar' }, bar)));
    document.body.append(el); prog = { el, bar, txt };
  }
  prog.txt.textContent = msg; prog.bar.style.width = frac === null ? '100%' : Math.round(frac * 100) + '%'; prog.bar.classList.toggle('indet', frac === null);
}
function progressDone() { prog?.el.remove(); prog = null; }
/** Callback de descarga: suma lo descargado de todos los archivos del modelo. */
let ran = '';
function dl(k: ModelKey) {
  const files = new Map<string, [number, number]>();
  return (e: any) => {
    if (e.status === 'run') { if (ran) progress(ran, null); }
    else if (e.status === 'progress' && e.total) { files.set(e.file, [e.loaded, e.total]); let a = 0, t = 0; for (const [l, tt] of files.values()) { a += l; t += tt; } progress(`Descargando el modelo de IA «${MODELS[k].name}»… ${Math.round(a / 1e6)} de ${Math.round(Math.max(t, MODELS[k].mb * 1e6) / 1e6)} MB (solo la primera vez)`, a / Math.max(t, 1)); }
    else if (e.status === 'ready') progress('Preparando…', null);
  };
}
/** Ejecuta una tarea de IA con su aviso, su progreso y sus errores explicados. */
export async function runAI<R>(k: ModelKey, label: string, fn: () => Promise<R>): Promise<R | null> {
  if (!(await confirmModel(k))) return null;
  ran = label + '…'; progress(ran, null);
  try { return await fn(); }
  catch (e: any) { console.warn(e); app.toast('La IA no pudo terminar: ' + (e?.message ?? e), 'warn'); return null; }
  finally { progressDone(); }
}
const pixels = (c: HTMLCanvasElement) => { const d = ctx2d(c).getImageData(0, 0, c.width, c.height); return { data: d.data.buffer, w: c.width, h: c.height }; };
/** Lienzo reducido (los modelos trabajan a ~1024 px; así va más rápido y gasta menos memoria). */
function downscale(src: HTMLCanvasElement, max: number) { const k = Math.min(1, max / Math.max(src.width, src.height)); if (k === 1) return src; const c = makeCanvas(Math.round(src.width * k), Math.round(src.height * k)); const x = ctx2d(c); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height); return c; }
/** Un canal (0..255) de un resultado, como lienzo de transparencia del tamaño pedido. */
function channelToMask(o: Out, ch: number, W: number, H: number, blur = 0): HTMLCanvasElement {
  const src = new Uint8Array(o.data), n = o.channels, small = makeCanvas(o.w, o.h), sx = ctx2d(small), id = sx.createImageData(o.w, o.h);
  for (let i = 0; i < o.w * o.h; i++) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = src[i * n + ch]; }
  sx.putImageData(id, 0, 0);
  const out = makeCanvas(W, H), ox = ctx2d(out); ox.imageSmoothingQuality = 'high'; if (blur) ox.filter = `blur(${blur}px)`; ox.drawImage(small, 0, 0, W, H); ox.filter = 'none'; return out;
}

// ---- Quitar fondo ------------------------------------------------------------------------------------------
/** Máscara (transparencia) del objeto principal de `src`, del mismo tamaño. */
export async function aiSubjectMask(src: HTMLCanvasElement): Promise<HTMLCanvasElement | null> {
  return runAI('bg', 'Separando el objeto del fondo con IA', async () => {
    const o = await call('bg', pixels(downscale(src, 1024)), dl('bg'));
    return channelToMask(o, o.channels - 1, src.width, src.height);
  });
}

// ---- Seleccionar objeto con un clic (SAM) -------------------------------------------------------------------
let samKey = '';
/** Máscara del objeto señalado con puntos (1 = sí es el objeto, 0 = no). La imagen se analiza una sola vez. */
export async function aiSegmentAt(src: HTMLCanvasElement, key: string, points: { x: number; y: number; label: 0 | 1 }[]): Promise<HTMLCanvasElement | null> {
  return runAI('sam', samKey === key ? 'Seleccionando' : 'Analizando la imagen con IA', async () => {
    const small = downscale(src, 1024), k = small.width / src.width;
    const o = await call('sam', { key, ...pixels(small), points: points.map(p => [p.x * k, p.y * k]), labels: points.map(p => p.label) }, dl('sam'));
    samKey = key;
    return channelToMask(o, 0, src.width, src.height, 0.6);
  });
}

// ---- Profundidad --------------------------------------------------------------------------------------------
let depthCache: { key: string; d: Float32Array; w: number; h: number } | null = null;
/** Profundidad de cada píxel (0 = lejos, 1 = cerca), del tamaño de `src`. */
export async function aiDepth(src: HTMLCanvasElement, key: string): Promise<{ d: Float32Array; w: number; h: number } | null> {
  if (depthCache?.key === key && depthCache.w === src.width) return depthCache;
  const r = await runAI('depth', 'Calculando la profundidad con IA', async () => {
    const o = await call('depth', pixels(downscale(src, 768)), dl('depth'));
    const dm = channelToMask(o, 0, src.width, src.height), a = ctx2d(dm).getImageData(0, 0, src.width, src.height).data;
    const d = new Float32Array(src.width * src.height); for (let i = 0; i < d.length; i++) d[i] = a[i * 4 + 3] / 255;
    return { key, d, w: src.width, h: src.height };
  });
  if (r) depthCache = r; return r;
}

// ---- Ampliar --------------------------------------------------------------------------------------------------
/** Amplía la imagen ×2 o ×4 por trozos (para no agotar la memoria), con un poco de solape entre ellos. */
export async function aiUpscale(src: HTMLCanvasElement, k: 'up2' | 'up4'): Promise<HTMLCanvasElement | null> {
  return runAI(k, 'Ampliando con IA', async () => {
    const S = k === 'up4' ? 4 : 2, TILE = 192, OV = 12, cb = dl(k);
    const W = src.width, H = src.height, out = makeCanvas(W * S, H * S), ox = ctx2d(out);
    const tiles: [number, number][] = []; for (let y = 0; y < H; y += TILE) for (let x = 0; x < W; x += TILE) tiles.push([x, y]);
    let done = 0;
    for (const [x, y] of tiles) {
      const x0 = Math.max(0, x - OV), y0 = Math.max(0, y - OV), x1 = Math.min(W, x + TILE + OV), y1 = Math.min(H, y + TILE + OV);
      const t = makeCanvas(x1 - x0, y1 - y0), tx = ctx2d(t); tx.fillStyle = '#fff'; tx.fillRect(0, 0, t.width, t.height); tx.drawImage(src, -x0, -y0);
      const r = await call(k, pixels(t), cb), rd = new Uint8Array(r.data), rc = r.channels, c = makeCanvas(r.w, r.h), cx = ctx2d(c), id = cx.createImageData(r.w, r.h);
      for (let i = 0; i < r.w * r.h; i++) { id.data[i * 4] = rd[i * rc]; id.data[i * 4 + 1] = rd[i * rc + 1]; id.data[i * 4 + 2] = rd[i * rc + 2]; id.data[i * 4 + 3] = 255; }
      cx.putImageData(id, 0, 0);
      // se pega solo la parte central del trozo (sin el solape)
      const sx = (x - x0) * S, sy = (y - y0) * S, sw = Math.min(TILE, W - x) * S, sh = Math.min(TILE, H - y) * S;
      ox.drawImage(c, sx, sy, sw, sh, x * S, y * S, sw, sh);
      done++; ran = `Ampliando con IA… trozo ${done} de ${tiles.length}`; progress(ran, done / tiles.length);
    }
    // se conserva la transparencia original (ampliada de forma normal)
    const al = makeCanvas(W * S, H * S), ax = ctx2d(al); ax.imageSmoothingQuality = 'high'; ax.drawImage(src, 0, 0, W * S, H * S);
    ox.globalCompositeOperation = 'destination-in'; ox.drawImage(al, 0, 0); ox.globalCompositeOperation = 'source-over';
    return out;
  });
}

// ---- Borrar objetos / rellenar huecos (MI-GAN) ----------------------------------------------------------------
/** Rellena la zona `hole` (transparencia > 0 = borrar) de `src` inventando lo que habría detrás.
 *  Trabaja sobre un recorte alrededor del hueco (con contexto) y solo cambia los píxeles del hueco. */
export async function aiInpaint(src: HTMLCanvasElement, hole: HTMLCanvasElement, box: { x: number; y: number; w: number; h: number }): Promise<HTMLCanvasElement | null> {
  return runAI('erase', 'Borrando con IA', async () => {
    const W = src.width, H = src.height, m = Math.max(48, Math.round(Math.max(box.w, box.h) * 0.75));
    const x0 = Math.max(0, Math.floor(box.x - m)), y0 = Math.max(0, Math.floor(box.y - m)), x1 = Math.min(W, Math.ceil(box.x + box.w + m)), y1 = Math.min(H, Math.ceil(box.y + box.h + m));
    const cw = x1 - x0, ch = y1 - y0; if (cw < 2 || ch < 2) return null;
    // el modelo va mejor y más rápido con recortes de hasta ~1024 px
    const k = Math.min(1, 1024 / Math.max(cw, ch)), sw = Math.max(8, Math.round(cw * k)), sh = Math.max(8, Math.round(ch * k));
    const img = makeCanvas(sw, sh), ix = ctx2d(img); ix.imageSmoothingQuality = 'high'; ix.fillStyle = '#808080'; ix.fillRect(0, 0, sw, sh); ix.drawImage(src, x0, y0, cw, ch, 0, 0, sw, sh);
    const hm = makeCanvas(sw, sh), hx = ctx2d(hm); hx.drawImage(hole, x0, y0, cw, ch, 0, 0, sw, sh);
    const ha = hx.getImageData(0, 0, sw, sh).data, mask = new Uint8Array(sw * sh);
    let any = false; for (let i = 0; i < sw * sh; i++) { const isHole = ha[i * 4 + 3] > 20; mask[i] = isHole ? 0 : 255; if (isHole) any = true; }
    if (!any) return null;
    const o = await call('erase', { ...pixels(img), mask: mask.buffer }, dl('erase'));
    const od = new Uint8Array(o.data), rc = makeCanvas(o.w, o.h), rx = ctx2d(rc), id = rx.createImageData(o.w, o.h);
    for (let i = 0; i < o.w * o.h; i++) { id.data[i * 4] = od[i * 3]; id.data[i * 4 + 1] = od[i * 3 + 1]; id.data[i * 4 + 2] = od[i * 3 + 2]; id.data[i * 4 + 3] = 255; }
    rx.putImageData(id, 0, 0);
    // el resultado solo dentro del hueco (con el borde suavizado para que no se note la costura)
    const patch = makeCanvas(cw, ch), px = ctx2d(patch); px.imageSmoothingQuality = 'high'; px.drawImage(rc, 0, 0, cw, ch);
    const fm = makeCanvas(cw, ch), fx = ctx2d(fm); fx.filter = `blur(${Math.max(1, 1.5 / k)}px)`; fx.drawImage(hole, x0, y0, cw, ch, 0, 0, cw, ch); fx.drawImage(hole, x0, y0, cw, ch, 0, 0, cw, ch); fx.filter = 'none';
    px.globalCompositeOperation = 'destination-in'; px.drawImage(fm, 0, 0);
    const out = makeCanvas(W, H), ox = ctx2d(out); ox.drawImage(src, 0, 0); ox.drawImage(patch, x0, y0);
    return out;
  });
}
