// Animación 2D (para cualquier documento, también pixel art): cada fotograma es un dibujo en su propia capa
// («Fotograma 1», «Fotograma 2»…); las demás capas (un fondo, un decorado) se ven en todos. Papel cebolla
// configurable, duración de cada fotograma, interpolación de movimiento y exportación (GIF, vídeo, secuencia PNG y
// hoja de sprites con JSON para motores de juego). Usa los mismos cuadros que la línea de tiempo y el historial.
import { app } from './app';
import { h, numberSlider } from './dom';
import { icon } from './icons';
import { showDialog } from './dialog';
import { applyFrame, renderFrames, onion } from './timeline';
import { RasterLayer } from '../core/layers';
import { ctx2d, makeCanvas } from '../core/canvas';
import type { EditorDocument } from '../core/document';
import { t } from '../i18n/i18n';

export const isAnim = (d: EditorDocument | null | undefined) => !!d && d.frames.some(f => f.own != null);
const layerById = (d: EditorDocument, id?: number) => id == null ? undefined : d.allLayers().find(l => l.id === id);

// quién tiene que repintarse cuando cambia la animación (la barra del pixel art y la barra general)
const listeners = new Set<() => void>();
export function onAnimChange(fn: () => void) { listeners.add(fn); }
const refresh = () => listeners.forEach(f => f());

// ---- reproducción -----------------------------------------------------------------------------
let playTimer = 0;
export const isPlaying = () => !!playTimer;
export function stopAnim() { if (playTimer) { clearTimeout(playTimer); playTimer = 0; import('./animaudio').then(m => m.stopAudio()); refresh(); } }
export type PlayMode = 'loop' | 'pingpong' | 'reverse' | 'once' | 'tag';
const PLAY_KEY = 'editor.playMode';
export function playMode(): PlayMode { try { return (localStorage.getItem(PLAY_KEY) as PlayMode) || 'loop'; } catch { return 'loop'; } }
export function setPlayMode(m: PlayMode) { try { localStorage.setItem(PLAY_KEY, m); } catch { /* */ } refresh(); }
/** Fotogramas que se reproducen: todos o, con «solo esta animación», los que tienen el mismo nombre que el actual. */
export function playRange(d: EditorDocument, mode = playMode()): [number, number] {
  const n = d.frames.length, tag = (d.frames[d.frameIndex] as any)?.tag;
  if (mode !== 'tag' || !tag) return [0, n - 1];
  let a = d.frameIndex, b = d.frameIndex;
  while (a > 0 && (d.frames[a - 1] as any).tag === tag) a--;
  while (b < n - 1 && (d.frames[b + 1] as any).tag === tag) b++;
  return [a, b];
}
/** Siguiente fotograma según el modo (null = se acaba). `dir` es la dirección actual en ida y vuelta. */
export function nextFrame(i: number, a: number, b: number, mode: PlayMode, dir: number): [number, number] | null {
  if (b <= a) return [a, 1];
  if (mode === 'reverse') return [i - 1 < a ? b : i - 1, -1];
  if (mode === 'pingpong') { let j = i + dir; if (j > b) { dir = -1; j = b - 1; } else if (j < a) { dir = 1; j = a + 1; } return [j, dir]; }
  if (mode === 'once') return i + 1 > b ? null : [i + 1, 1];
  return [i + 1 > b ? a : i + 1, 1];
}
export function playAnim() {
  const d = app.doc; if (!d || d.frames.length < 2) return;
  if (playTimer) { stopAnim(); return; }
  let dir = 1;
  const mode = playMode();
  if (mode === 'once') { const [a, b] = playRange(d, mode); if (d.frameIndex >= b) applyFrame(d, a); }
  // el sonido acompaña cuando se reproduce hacia delante
  const withSound = mode === 'loop' || mode === 'once' || mode === 'tag', au = withSound && (d.meta as any).audio ? import('./animaudio') : null;
  au?.then(m => m.playAudioAt(d, d.frameIndex));
  const tick = () => {
    const dd = app.doc; if (!dd || dd !== d || dd.frames.length < 2 || (app.viewport as any).toolActive) { playTimer = 0; refresh(); return; }
    const [a, b] = playRange(dd, mode), i = Math.min(b, Math.max(a, dd.frameIndex)), nx = nextFrame(i, a, b, mode, dir);
    if (!nx) { playTimer = 0; au?.then(m => m.stopAudio()); refresh(); return; }
    const wrapped = nx[0] < i && mode !== 'reverse' && mode !== 'pingpong';
    dir = nx[1]; applyFrame(dd, nx[0]);
    if (wrapped) au?.then(m => m.playAudioAt(dd, nx[0]));
    playTimer = window.setTimeout(tick, dd.frames[dd.frameIndex]?.delay ?? 125);
  };
  playTimer = window.setTimeout(tick, d.frames[d.frameIndex]?.delay ?? 125);
  refresh();
}

// ---- probador ----------------------------------------------------------------------------------
/** Ventana para ver la animación como en el juego: a tamaño real o ampliada, sobre distintos fondos y con cada modo de reproducción. */
export function previewDialog() {
  const d = app.doc; if (!d) return;
  stopAnim();
  const frames = renderFrames(d); if (!frames.length) frames.push({ canvas: d.flatten(), delay: 100 });
  const pix = !!d.meta.pixelArt, maxK = Math.max(1, Math.floor(420 / Math.max(d.width, d.height)));
  let k = pix ? Math.min(4, maxK) : Math.min(1, 420 / Math.max(d.width, d.height)), bg = 'checker', mode: PlayMode = playMode(), i = 0, dir = 1, timer = 0;
  const cv = h('canvas', { class: 'gd-pv anim-pv' }) as HTMLCanvasElement;
  const info = h('div', { class: 'hint' });
  const BGS: Record<string, string | null> = { checker: null, white: '#ffffff', black: '#000000', sky: '#7ec8f0', grass: '#5a9b3c', night: '#1a1f3a', dungeon: '#3a3330' };
  const draw = () => {
    const f = frames[i], W = Math.max(1, Math.round(d.width * k)), H = Math.max(1, Math.round(d.height * k));
    if (cv.width !== W + 32 || cv.height !== H + 32) { cv.width = W + 32; cv.height = H + 32; }
    const x = ctx2d(cv); x.imageSmoothingEnabled = !pix && k < 1;
    if (BGS[bg]) { x.fillStyle = BGS[bg]!; x.fillRect(0, 0, cv.width, cv.height); }
    else { const s = 8; for (let yy = 0; yy < cv.height; yy += s) for (let xx = 0; xx < cv.width; xx += s) { x.fillStyle = ((xx + yy) / s) % 2 ? '#3a3b40' : '#2c2d31'; x.fillRect(xx, yy, s, s); } }
    if (bg === 'grass') { x.fillStyle = '#7ec8f0'; x.fillRect(0, 0, cv.width, 16 + H * 0.85); }
    x.drawImage(f.canvas, 16, 16, W, H);
    info.textContent = `${t('Fotograma')} ${i + 1} / ${frames.length} · ${Math.round(W)} × ${Math.round(H)} px`;
  };
  const run = () => {
    clearTimeout(timer); draw();
    const nx = nextFrame(i, 0, frames.length - 1, mode === 'tag' ? 'loop' : mode, dir);
    if (!nx) { timer = window.setTimeout(() => { i = 0; dir = 1; run(); }, 700); return; }
    timer = window.setTimeout(() => { i = nx[0]; dir = nx[1]; run(); }, frames[i].delay);
  };
  const sel = (opts: [string, string][], v: string, on: (x: string) => void) => { const s = h('select', {}, ...opts.map(([a, b]) => h('option', { value: a }, b))) as HTMLSelectElement; s.value = v; s.onchange = () => on(s.value); return s; };
  const sizes: [string, string][] = pix ? [1, 2, 3, 4, 6, 8].filter(n => n <= Math.max(1, maxK)).map(n => [String(n), `×${n}`]) : [['0.25', '25 %'], ['0.5', '50 %'], ['1', '100 %']];
  if (!sizes.some(([v]) => +v === k)) sizes.push([String(k), pix ? `×${k}` : `${Math.round(k * 100)} %`]);
  run();
  showDialog({
    title: 'Probar animación', okLabel: 'Cerrar', cancelLabel: null, width: 520,
    body: [h('div', { class: 'gd-pv-wrap' }, cv), info,
      h('div', { class: 'form-row' }, h('label', {}, 'Tamaño'), sel(sizes, String(k), v => { k = +v; draw(); })),
      h('div', { class: 'form-row' }, h('label', {}, 'Fondo'), sel([['checker', 'Transparente (cuadros)'], ['white', 'Blanco'], ['black', 'Negro'], ['sky', 'Cielo'], ['grass', 'Cielo y suelo'], ['night', 'Noche'], ['dungeon', 'Mazmorra']], bg, v => { bg = v; draw(); })),
      h('div', { class: 'form-row' }, h('label', {}, 'Reproducción'), sel([['loop', 'En bucle'], ['pingpong', 'Ida y vuelta'], ['reverse', 'Al revés'], ['once', 'Una vez']], mode === 'tag' ? 'loop' : mode, v => { mode = v as PlayMode; i = 0; dir = 1; run(); }))],
    onOk: () => clearTimeout(timer), onCancel: () => clearTimeout(timer),
  });
}

// ---- fotogramas ---------------------------------------------------------------------------------
/** Si el dibujo está sobre un fondo liso opaco (las 4 esquinas del mismo color), el fondo pasa a una capa «Fondo»
 *  común a todos los fotogramas y el dibujo se queda solo en la suya. */
function splitBackground(d: EditorDocument, l: RasterLayer) {
  const W = l.canvas.width, H = l.canvas.height, x = ctx2d(l.canvas), img = x.getImageData(0, 0, W, H), D = img.data;
  for (let i = 3; i < D.length; i += 4) if (D[i] !== 255) return; // ya tiene transparencias: no hace falta
  const at = (px: number, py: number) => (py * W + px) * 4, c0 = at(0, 0);
  const same = (i: number) => D[i] === D[c0] && D[i + 1] === D[c0 + 1] && D[i + 2] === D[c0 + 2];
  if (![at(W - 1, 0), at(0, H - 1), at(W - 1, H - 1)].every(same)) return;
  const bgL = new RasterLayer('Fondo', W, H), bx = ctx2d(bgL.canvas);
  bx.fillStyle = `rgb(${D[c0]},${D[c0 + 1]},${D[c0 + 2]})`; bx.fillRect(0, 0, W, H);
  for (let i = 0; i < D.length; i += 4) if (same(i)) D[i + 3] = 0;
  x.putImageData(img, 0, 0); l.touch();
  const parent = (l.parent ?? d.root) as any; parent.add(bgL, parent.children.indexOf(l));
}
/** Convierte el dibujo en el primer fotograma de una animación. */
export function startAnim() {
  const d = app.doc; if (!d) return;
  if (isAnim(d)) return;
  let l = d.activeRaster();
  if (!l) { l = new RasterLayer('Fotograma 1', d.width, d.height); d.root.add(l); }
  splitBackground(d, l);
  l.name = 'Fotograma 1';
  const shared = d.allLayers().filter(x => x.visible && x !== l).map(x => x.id);
  d.frames = [{ delay: 125, visible: [...shared, l.id], own: l.id }];
  d.frameIndex = 0; d.setActive(l, false);
  d.commit('Empezar animación');
  app.toast('Animación: pulsa ＋ para añadir fotogramas. El papel cebolla muestra el anterior en transparencia');
  refresh();
}
/** Añade un fotograma después del actual: vacío o copia del actual. */
export function addFrame(copy: boolean) {
  const d = app.doc; if (!d) return;
  if (!isAnim(d)) startAnim();
  stopAnim();
  const cur = d.frames[d.frameIndex], curL = layerById(d, cur.own);
  const nl = new RasterLayer(`Fotograma ${d.frames.length + 1}`, d.width, d.height);
  if (copy && curL instanceof RasterLayer) ctx2d(nl.canvas).drawImage(curL.canvas, 0, 0);
  const parent = (curL?.parent ?? d.root) as any, idx = curL ? parent.children.indexOf(curL) + 1 : parent.children.length;
  parent.add(nl, idx);
  const shared = cur.visible.filter(id => id !== cur.own);
  d.frames.splice(d.frameIndex + 1, 0, { delay: baseDelay(d), visible: [...shared, nl.id], own: nl.id });
  applyFrame(d, d.frameIndex + 1);
  d.commit(copy ? 'Duplicar fotograma' : 'Nuevo fotograma');
}
export function deleteFrame() {
  const d = app.doc; if (!d || !isAnim(d)) return;
  if (d.frames.length < 2) { app.toast('La animación necesita al menos un fotograma', 'warn'); return; }
  stopAnim();
  const f = d.frames[d.frameIndex], l = layerById(d, f.own);
  d.frames.splice(d.frameIndex, 1);
  if (l && !d.frames.some(x => x.visible.includes(l.id))) (l.parent as any)?.remove(l);
  applyFrame(d, Math.min(d.frameIndex, d.frames.length - 1));
  d.commit('Eliminar fotograma');
}
export function moveFrame(dir: -1 | 1) {
  const d = app.doc; if (!d || !isAnim(d)) return;
  const i = d.frameIndex, j = i + dir; if (j < 0 || j >= d.frames.length) return;
  [d.frames[i], d.frames[j]] = [d.frames[j], d.frames[i]];
  applyFrame(d, j); d.commit('Mover fotograma');
}
// ---- velocidad y duración de cada fotograma (×1, ×2…: «mantener» un dibujo varios fotogramas) ---------------------
const hold = (f: { hold?: number }) => f.hold ?? 1;
/** Duración base (de un fotograma ×1). */
export function baseDelay(d: EditorDocument) { const f = d.frames[d.frameIndex] ?? d.frames[0]; return f ? Math.round(f.delay / hold(f)) : 125; }
export function setFps(fps: number) {
  const d = app.doc; if (!d) return;
  const ms = Math.round(1000 / fps); for (const f of d.frames) f.delay = ms * hold(f);
  d.commit('Velocidad de la animación'); refresh();
}
export function setHold(n: number) {
  const d = app.doc; if (!d) return; const f = d.frames[d.frameIndex]; if (!f) return;
  const base = baseDelay(d); f.hold = n; f.delay = base * n;
  d.commit('Duración del fotograma'); refresh();
}

// ---- papel cebolla -------------------------------------------------------------------------------
export type OnionMode = 'prev' | 'prev2' | 'both' | 'color';
const ONION_KEY = 'editor.onionMode';
export function onionMode(): OnionMode { try { return (localStorage.getItem(ONION_KEY) as OnionMode) || 'prev'; } catch { return 'prev'; } }
export function setOnionMode(m: OnionMode) { try { localStorage.setItem(ONION_KEY, m); } catch { /* */ } onion.on = true; refresh(); }
/** Imagen del papel cebolla con la transparencia ya aplicada: fotogramas anteriores (y siguientes) solo donde el
 *  fotograma actual no tiene dibujo, para no aclarar lo que se está dibujando. */
export function onionImage(d: EditorDocument): HTMLCanvasElement | null {
  const n = d.frames.length, cf = d.frames[d.frameIndex]; if (n < 2 || cf?.own == null) return null;
  const mode = onionMode(), list: { i: number; a: number; tint?: string }[] = [];
  const at = (k: number) => (d.frameIndex + k + n) % n;
  if (mode === 'prev') list.push({ i: at(-1), a: 0.35 });
  else if (mode === 'prev2') list.push({ i: at(-2), a: 0.18 }, { i: at(-1), a: 0.35 });
  else if (mode === 'both') list.push({ i: at(-1), a: 0.35 }, { i: at(1), a: 0.25 });
  else list.push({ i: at(-1), a: 0.4, tint: '#ff3b3b' }, { i: at(1), a: 0.35, tint: '#25c25b' });
  const c = makeCanvas(d.width, d.height), x = ctx2d(c);
  for (const it of list) {
    if (it.i === d.frameIndex) continue;
    const l = layerById(d, d.frames[it.i]?.own) as any; if (!l?.canvas) continue;
    let src: HTMLCanvasElement = l.canvas;
    if (it.tint) { const t = makeCanvas(d.width, d.height), tx = ctx2d(t); tx.drawImage(l.canvas, 0, 0); tx.globalCompositeOperation = 'source-atop'; tx.globalAlpha = 0.65; tx.fillStyle = it.tint; tx.fillRect(0, 0, d.width, d.height); src = t; }
    x.globalAlpha = it.a; x.drawImage(src, 0, 0);
  }
  const cur = layerById(d, cf.own) as any;
  if (cur?.canvas) { x.globalAlpha = 1; x.globalCompositeOperation = 'destination-out'; x.drawImage(cur.canvas, 0, 0); }
  (c as any).alpha = 1; // la transparencia ya está puesta
  return c;
}

// ---- interpolar movimiento ----------------------------------------------------------------------
export const EASE: Record<string, (t: number) => number> = {
  linear: t => t, smooth: t => t * t * (3 - 2 * t), in: t => t * t, out: t => 1 - (1 - t) * (1 - t),
  bounce: t => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; },
  back: t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};
/** Caja de lo que hay pintado en un lienzo (o null si está vacío). */
function contentBox(c: HTMLCanvasElement) {
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
export type TweenParams = { frames: number; dx: number; dy: number; rot: number; scale: number; opacity: number; ease: string; pingpong: boolean; sx?: number; sy?: number; pivot?: string };
export type Pose = { dx: number; dy: number; rot: number; sx: number; sy: number; alpha: number };
/** Crea un fotograma por cada postura (mover, girar, estirar y aplastar, transparencia) de la capa elegida. */
export function buildFrames(d: EditorDocument, src: RasterLayer, poses: Pose[], label: string, pivot = 'center', delayMs?: number) {
  const box = contentBox(src.canvas); if (!box) { app.toast('La capa está vacía', 'warn'); return false; }
  const pix = !!d.meta.pixelArt;
  // punto de giro: centro, abajo (los pies: para saltos y aplastar contra el suelo) o arriba (algo colgado)
  const cx = box.x + box.w / 2, cy = pivot === 'bottom' ? box.y + box.h : pivot === 'top' ? box.y : box.y + box.h / 2;
  const anim = isAnim(d), cur = anim ? d.frames[d.frameIndex] : null;
  // lo que se ve en todos: lo visible ahora, menos la capa que se anima y menos los dibujos de otros fotogramas
  const owned = new Set(d.frames.map(f => f.own).filter(x => x != null));
  const shared = (cur ? cur.visible.filter(id => id !== cur.own) : d.allLayers().filter(l => l.visible).map(l => l.id)).filter(id => id !== src.id && !owned.has(id));
  const parent = (src.parent ?? d.root) as any; let idx = parent.children.indexOf(src) + 1; const at = anim ? d.frameIndex + 1 : 0;
  const delay = delayMs ?? (anim ? baseDelay(d) : 83);
  if (!anim) d.frames = [];
  poses.forEach((q, k) => {
    const l = new RasterLayer(`Fotograma ${d.frames.length + 1}`, d.width, d.height), x = ctx2d(l.canvas);
    x.imageSmoothingEnabled = !pix;
    x.globalAlpha = Math.max(0, Math.min(1, q.alpha));
    const tx = cx + q.dx, ty = cy + q.dy;
    x.translate(pix ? Math.round(tx) : tx, pix ? Math.round(ty) : ty); x.rotate(q.rot * Math.PI / 180); x.scale(q.sx, q.sy);
    if (pix) x.translate(-Math.round(cx), -Math.round(cy)); else x.translate(-cx, -cy);
    x.drawImage(src.canvas, 0, 0);
    parent.add(l, idx++);
    d.frames.splice(at + k, 0, { delay, visible: [...shared, l.id], own: l.id });
  });
  src.visible = false;
  applyFrame(d, at);
  d.commit(label);
  return true;
}
/** Crea los fotogramas intermedios moviendo, girando, escalando o desvaneciendo la capa elegida. */
export function tween(d: EditorDocument, src: RasterLayer, p: TweenParams) {
  const ease = EASE[p.ease] ?? EASE.smooth;
  const steps: number[] = []; for (let i = 0; i < p.frames; i++) steps.push(p.frames === 1 ? 1 : i / (p.frames - 1));
  if (p.pingpong) for (let i = p.frames - 2; i > 0; i--) steps.push(steps[i]);
  const sx = (p.sx ?? 100) / 100, sy = (p.sy ?? 100) / 100, s = p.scale / 100;
  return buildFrames(d, src, steps.map(t => { const e = ease(t); return { dx: p.dx * e, dy: p.dy * e, rot: p.rot * e, sx: 1 + (s * sx - 1) * e, sy: 1 + (s * sy - 1) * e, alpha: 1 + (p.opacity / 100 - 1) * e }; }), 'Interpolar movimiento', p.pivot);
}
export function tweenDialog() {
  const d = app.doc, src = d?.activeRaster(); if (!d || !src) { app.toast('Elige la capa con el objeto que quieres animar', 'warn'); return; }
  const p: TweenParams = { frames: 12, dx: Math.round(d.width / 3), dy: 0, rot: 0, scale: 100, opacity: 100, ease: 'smooth', pingpong: false, sx: 100, sy: 100, pivot: 'center' };
  const num = (k: 'frames' | 'dx' | 'dy' | 'rot' | 'scale' | 'opacity' | 'sx' | 'sy', label: string, min: number, max: number, unit = '') =>
    h('div', { class: 'form-row' }, h('label', {}, label), numberSlider({ min, max, value: p[k] ?? 100, unit, onInput: v => { p[k] = v; } }).el);
  const piv = h('select', {}, h('option', { value: 'center' }, 'Centro'), h('option', { value: 'bottom' }, 'Abajo (los pies)'), h('option', { value: 'top' }, 'Arriba')); piv.onchange = () => { p.pivot = piv.value; };
  const ease = h('select', {}, ...[['smooth', 'Suave (acelera y frena)'], ['linear', 'Constante'], ['in', 'Acelerando'], ['out', 'Frenando'], ['bounce', 'Rebote'], ['back', 'Con impulso (se pasa y vuelve)']].map(([v, n]) => h('option', { value: v }, n)));
  ease.onchange = () => { p.ease = ease.value; };
  const pp = h('input', { type: 'checkbox' }) as HTMLInputElement; pp.onchange = () => { p.pingpong = pp.checked; };
  showDialog({
    title: 'Interpolar movimiento', okLabel: 'Crear fotogramas', width: 460,
    body: [
      h('div', { class: 'hint' }, `Anima la capa «${src.name}»: se crean los fotogramas intermedios desde donde está ahora hasta el final que indiques.`),
      num('frames', 'Fotogramas', 2, 60), num('dx', 'Mover en horizontal', -d.width, d.width, ' px'), num('dy', 'Mover en vertical', -d.height, d.height, ' px'),
      num('rot', 'Girar', -720, 720, '°'), num('scale', 'Tamaño final', 5, 500, '%'), num('opacity', 'Opacidad final', 0, 100, '%'),
      num('sx', 'Ancho final (estirar)', 10, 300, '%'), num('sy', 'Alto final (aplastar)', 10, 300, '%'),
      h('div', { class: 'form-row' }, h('label', {}, 'Punto de giro'), piv),
      h('div', { class: 'form-row' }, h('label', {}, 'Movimiento'), ease),
      h('label', { class: 'check' }, pp, ' Ida y vuelta (vuelve al principio)'),
    ],
    onOk: () => { if (tween(d, src, p)) app.toast(`${p.frames} fotogramas creados: pulsa reproducir para verlo`); refresh(); },
  });
}

// ---- exportar -------------------------------------------------------------------------------------
function scaled(c: HTMLCanvasElement, k: number, nearest: boolean) {
  if (k === 1) return c; const n = makeCanvas(Math.max(1, Math.round(c.width * k)), Math.max(1, Math.round(c.height * k))), x = ctx2d(n);
  x.imageSmoothingEnabled = !nearest; x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, n.width, n.height); return n;
}
/** Exporta la animación: 'gif' | 'video' | 'png' (secuencia en ZIP) | 'sheet' (hoja de sprites PNG + JSON en ZIP). */
export async function exportAnimation(d: EditorDocument, fmt: string, k: number, nearest: boolean, pingpong: boolean) {
  stopAnim();
  let fr = renderFrames(d).map(f => ({ canvas: scaled(f.canvas, k, nearest), delay: f.delay }));
  if (!fr.length) fr = [{ canvas: scaled(d.flatten(), k, nearest), delay: 100 }];
  if (pingpong && fr.length > 2) fr = [...fr, ...fr.slice(1, -1).reverse()];
  const io = await import('../io/files'), base = d.name + (k !== 1 ? `-x${+k.toFixed(2)}` : '');
  const png = async (c: HTMLCanvasElement) => new Uint8Array(await (await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/png'))).arrayBuffer());
  const save = async (b: Blob, name: string) => { try { await io.saveBlob(b, name); app.toast('Exportado'); } catch (e: any) { if (e?.name !== 'AbortError') app.toast('No se pudo exportar: ' + (e?.message ?? e), 'warn'); } };
  if (fmt === 'gif') { const { encodeGif } = await import('../io/gif'); await save(encodeGif(fr), base + '.gif'); return; }
  if (fmt === 'video') { const { recordFrames } = await import('./unique'), au = pingpong ? null : await (await import('./animaudio')).audioForExport(d); await recordFrames(fr, base, au, au ? 'Vídeo con sonido guardado' : 'Vídeo guardado'); return; }
  const { makeZip } = await import('../io/zip');
  if (fmt === 'png') { const files = []; for (let i = 0; i < fr.length; i++) files.push({ name: `${d.name}_${String(i + 1).padStart(3, '0')}.png`, data: await png(fr[i].canvas) }); await save(makeZip(files), base + '_fotogramas.zip'); return; }
  // hoja de sprites: rejilla casi cuadrada + JSON con el formato de Aseprite (lo leen Godot, Phaser, Unity con plugins, Defold…)
  const W = fr[0].canvas.width, H = fr[0].canvas.height, cols = Math.ceil(Math.sqrt(fr.length)), rows = Math.ceil(fr.length / cols);
  const sheet = makeCanvas(W * cols, H * rows), sx = ctx2d(sheet), frames: Record<string, unknown>[] = [];
  // pivote y cajas de colisión de cada fotograma (Juegos › Pivote y colisiones)
  const { spriteJson } = await import('./gameui'), n = Math.max(1, d.frames.length), sj = (j: number) => spriteJson(d, Math.max(0, Math.min(n - 1, j)));
  fr.forEach((f, i) => { const x = (i % cols) * W, y = Math.floor(i / cols) * H; sx.drawImage(f.canvas, x, y); frames.push({ filename: `${d.name} ${i}.png`, frame: { x, y, w: W, h: H }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: W, h: H }, sourceSize: { w: W, h: H }, duration: f.delay, ...scaleInfo(sj(i < n ? i : 2 * n - 2 - i), k) }); });
  const json = JSON.stringify({ frames, meta: { app: 'Photocap', version: '1.0', image: base + '.png', format: 'RGBA8888', size: { w: sheet.width, h: sheet.height }, scale: '1', frameTags: frameTags(d, pingpong ? fr.length : 0), frameSize: { w: W, h: H }, columns: cols, rows, frameCount: fr.length } }, null, 2);
  await save(makeZip([{ name: base + '.png', data: await png(sheet) }, { name: base + '.json', data: new TextEncoder().encode(json) }]), base + '_hoja.zip');
}
/** Las cajas y el pivote en píxeles se escalan con el tamaño de exportación. */
function scaleInfo(o: Record<string, any>, k: number) {
  if (k === 1) return o;
  if (o.pivotPx) o.pivotPx = { x: Math.round(o.pivotPx.x * k), y: Math.round(o.pivotPx.y * k) };
  if (o.boxes) o.boxes = o.boxes.map((b: any) => ({ ...b, x: Math.round(b.x * k), y: Math.round(b.y * k), w: Math.round(b.w * k), h: Math.round(b.h * k) }));
  return o;
}
/** Etiquetas de animación en el formato de Aseprite: fotogramas seguidos con el mismo nombre. */
export function frameTags(d: EditorDocument, pingTotal = 0) {
  const tags: { name: string; from: number; to: number; direction: string }[] = [];
  d.frames.forEach((f, i) => { const t = (f as any).tag as string | undefined; if (!t) return; const last = tags[tags.length - 1]; if (last && last.name === t && last.to === i - 1) last.to = i; else tags.push({ name: t, from: i, to: i, direction: 'forward' }); });
  if (!tags.length && pingTotal) tags.push({ name: d.name, from: 0, to: pingTotal - 1, direction: 'forward' });
  return tags;
}
export function exportAnimDialog() {
  const d = app.doc; if (!d) return;
  const pix = !!d.meta.pixelArt;
  const fmt = h('select', {}, h('option', { value: 'gif' }, 'GIF animado'), h('option', { value: 'video' }, 'Vídeo (WebM o MP4)'), h('option', { value: 'png' }, 'Secuencia de imágenes PNG (ZIP)'), h('option', { value: 'sheet' }, 'Hoja de sprites + JSON para motores de juego (ZIP)'));
  const sizes = pix ? [1, 2, 4, 8, 16] : [0.25, 0.5, 1, 2];
  let k = pix ? 4 : 1;
  const sz = h('select', {}, ...sizes.map(n => h('option', { value: String(n) }, pix ? `×${n}` : `${n * 100} %`))); sz.value = String(k); sz.onchange = () => { k = +sz.value; upd(); };
  const info = h('div', { class: 'hint' }); const upd = () => { info.textContent = `${Math.round(d.width * k)} × ${Math.round(d.height * k)} px · ${Math.max(1, d.frames.length)} fotogramas`; }; upd();
  const pp = h('input', { type: 'checkbox' }) as HTMLInputElement;
  showDialog({
    title: 'Exportar animación', okLabel: 'Exportar', width: 460,
    body: [h('div', { class: 'form-row' }, h('label', {}, 'Formato'), fmt), h('div', { class: 'form-row' }, h('label', {}, 'Tamaño'), sz), h('label', { class: 'check' }, pp, ' Ida y vuelta (al terminar vuelve hacia atrás)'), info],
    onOk: () => exportAnimation(d, fmt.value, k, pix, pp.checked),
  });
}

// ---- barra de animación ------------------------------------------------------------------------
const FPS = [2, 4, 6, 8, 10, 12, 15, 24, 30];
/** Fila de controles de la animación (la usan la barra del pixel art y la barra general). */
export function animRow(d: EditorDocument): HTMLElement {
  const row = animRowInner(d);
  if (!(d.meta as any).audio) return row;
  const wrap = h('div', { class: 'px-anim-wrap' }, row);
  import('./animaudio').then(m => { const st = m.audioStrip(d, i => { stopAnim(); applyFrame(d, i); }); if (st) wrap.append(st); });
  return wrap;
}
function animRowInner(d: EditorDocument): HTMLElement {
  const b = (cls: string, title: string, ic: string, fn: () => void, on = false) => { const x = h('button', { type: 'button', class: 'btn icon-btn ' + cls + (on ? ' on' : ''), title, 'aria-label': title, html: icon(ic) }); x.onclick = fn; return x; };
  const play = b('px-play', playTimer ? 'Detener' : 'Reproducir', playTimer ? 'stop' : 'play', () => playAnim(), !!playTimer);
  const strip = h('div', { class: 'px-frames' });
  const small = d.width * d.height <= 1024 * 1024, pix = !!d.meta.pixelArt;
  d.frames.forEach((f, i) => {
    const cell = h('button', { type: 'button', class: 'px-frame' + (i === d.frameIndex ? ' on' : ''), title: `Fotograma ${i + 1}`, 'aria-label': `Fotograma ${i + 1}` });
    const l = layerById(d, f.own);
    if (small && l instanceof RasterLayer) { const k = Math.min(36 / d.width, 36 / d.height), c = makeCanvas(Math.max(1, Math.round(d.width * k)), Math.max(1, Math.round(d.height * k))), x = ctx2d(c); x.imageSmoothingEnabled = !pix; x.drawImage(l.canvas, 0, 0, c.width, c.height); cell.append(c); }
    cell.append(h('span', { class: 'px-fn' }, String(i + 1) + (hold(f) > 1 ? ` ×${hold(f)}` : '')));
    cell.onclick = () => { stopAnim(); applyFrame(d, i); };
    strip.append(cell);
  });
  const fps = h('select', { class: 'px-fps', title: 'Velocidad (fotogramas por segundo)', 'aria-label': 'Velocidad (fotogramas por segundo)' }, ...FPS.map(n => h('option', { value: String(n) }, `${n} fps`)));
  const cur = Math.round(1000 / (baseDelay(d) || 125)); fps.value = String(FPS.reduce((a, x) => Math.abs(x - cur) < Math.abs(a - cur) ? x : a, FPS[0]));
  fps.onchange = () => setFps(+fps.value);
  const hl = h('select', { class: 'px-hold', title: 'Duración de este fotograma', 'aria-label': 'Duración de este fotograma' }, ...[1, 2, 3, 4, 6, 8].map(n => h('option', { value: String(n) }, `×${n}`)));
  hl.value = String(hold(d.frames[d.frameIndex] ?? {})); hl.onchange = () => setHold(+hl.value);
  const om = h('select', { class: 'px-onion-mode', title: 'Qué enseña el papel cebolla', 'aria-label': 'Qué enseña el papel cebolla' },
    h('option', { value: 'prev' }, 'Anterior'), h('option', { value: 'prev2' }, '2 anteriores'), h('option', { value: 'both' }, 'Anterior y siguiente'), h('option', { value: 'color' }, 'Anterior y siguiente (en color)'));
  om.value = onionMode(); om.onchange = () => setOnionMode(om.value as OnionMode);
  const pm = h('select', { class: 'px-play-mode', title: 'Cómo se reproduce', 'aria-label': 'Cómo se reproduce' },
    h('option', { value: 'loop' }, 'En bucle'), h('option', { value: 'pingpong' }, 'Ida y vuelta'), h('option', { value: 'reverse' }, 'Al revés'), h('option', { value: 'once' }, 'Una vez'), h('option', { value: 'tag' }, 'Solo esta animación (su nombre)'));
  pm.value = playMode(); pm.onchange = () => { stopAnim(); setPlayMode(pm.value as PlayMode); };
  return h('div', { class: 'px-row px-anim' }, play, strip,
    b('px-addf', 'Nuevo fotograma vacío', 'plus', () => addFrame(false)),
    b('px-dupf', 'Duplicar fotograma (copia del actual para cambiar un poco)', 'duplicate', () => addFrame(true)),
    b('px-left', 'Mover el fotograma antes', 'chevronLeft', () => moveFrame(-1)),
    b('px-right', 'Mover el fotograma después', 'chevronRight', () => moveFrame(1)),
    b('px-delf', 'Eliminar fotograma', 'trash', () => deleteFrame()),
    b('px-onion', 'Papel cebolla: ver el fotograma anterior en transparencia', 'onion', () => { onion.on = !onion.on; refresh(); }, onion.on),
    om, hl, fps, pm,
    b('px-tween', 'Interpolar movimiento (crea los fotogramas intermedios)', 'move', () => tweenDialog()),
    b('px-sound' + ((d.meta as any).audio ? ' on' : ''), (d.meta as any).audio ? 'Sonido de la animación (desfase, volumen, quitar)' : 'Añadir sonido (voz, música, efectos) para sincronizar', 'music', () => { import('./animaudio').then(m => m.audioDialog()); }),
    b('px-test', 'Probar animación (a tamaño real, sobre distintos fondos)', 'eye', () => previewDialog()),
    b('px-animexp', 'Exportar animación (GIF, vídeo, PNG, hoja de sprites)', 'download', () => exportAnimDialog()));
}

// ---- barra general (documentos que no son pixel art) ---------------------------------------------
let dock: HTMLElement | null = null, dockWanted = false;
export function toggleAnimDock() { dockWanted = !dockWanted || !dock; if (dockWanted && app.doc && !isAnim(app.doc)) startAnim(); renderDock(); requestAnimationFrame(() => app.viewport.fit()); }
export const dockShown = () => !!dock;
function renderDock() {
  const d = app.doc;
  const show = !!d && !d.meta.pixelArt && (isAnim(d) || dockWanted);
  if (!show) { dock?.remove(); dock = null; return; }
  const host = app.viewport.canvas.parentElement; if (!host) return;
  if (!dock || dock.parentElement !== host) { dock?.remove(); dock = h('div', { class: 'px-bar anim-dock', role: 'toolbar', 'aria-label': 'Animación' }); host.append(dock); }
  if (playTimer && dock.querySelectorAll('.px-frame').length === d!.frames.length) { const i = d!.frameIndex; dock.querySelectorAll('.px-frame').forEach((c, j) => c.classList.toggle('on', j === i)); return; }
  if (!isAnim(d)) { const st = h('button', { type: 'button', class: 'btn primary' }, 'Empezar animación'); st.onclick = () => startAnim(); dock.replaceChildren(h('div', { class: 'px-row' }, h('span', { class: 'hint' }, 'Cada fotograma es un dibujo en su capa; el fondo se ve en todos.'), st)); return; }
  dock.replaceChildren(animRow(d!));
  // el botón rápido flotante no debe tapar la barra
  requestAnimationFrame(() => { const qb = document.querySelector<HTMLElement>('.quick-btn.show'); if (!qb || !dock) return; const q = qb.getBoundingClientRect(), r = dock.getBoundingClientRect(); if (q.right > r.left && q.left < r.right && q.bottom > r.top && q.top < r.bottom) qb.style.top = Math.max(4, qb.offsetTop - (q.bottom - r.top) - 8) + 'px'; });
}
export function initAnim() {
  onAnimChange(renderDock);
  for (const ev of ['docs', 'doc', 'tool'] as const) app.on(ev, () => refresh());
  app.on('docs', () => { if (playTimer && !isAnim(app.doc)) stopAnim(); });
  (app as any).onionImage = onionImage;
}
