// Línea de tiempo: animación por cuadros. Cada cuadro recuerda qué capas se
// ven; al reproducir o exportar a GIF se muestran una tras otra.

import { app } from './app';
import { h } from './dom';
import { icon } from './icons';
import type { EditorDocument } from '../core/document';
import { ctx2d, makeCanvas } from '../core/canvas';

/** `own`: capa propia del cuadro (pixel art: cada fotograma es un dibujo en su capa). */
export interface Frame { delay: number; visible: number[]; own?: number; }

const visibleIds = (d: EditorDocument) => d.allLayers().filter(l => l.visible).map(l => l.id);
export function applyFrame(d: EditorDocument, i: number) {
  const f = d.frames[i]; if (!f) return;
  d.frameIndex = i;
  const set = new Set(f.visible);
  for (const l of d.allLayers()) l.visible = set.has(l.id);
  // el fotograma con capa propia la deja elegida: lo que se dibuja va a ese fotograma
  if (f.own != null) { const l = d.allLayers().find(x => x.id === f.own); if (l && d.active !== l) d.setActive(l, false); }
  d.invalidate(); d.changed();
}
/** Papel cebolla: imagen del cuadro anterior (se guarda mientras no cambie nada). */
let onionOn = false;
export const onion = { get on() { return onionOn; }, set on(v: boolean) { onionOn = v; onionCache = null; app.viewport?.requestRender(); } };
let onionCache: { key: string; c: HTMLCanvasElement } | null = null;
(app as any).onionCanvas = (d: EditorDocument) => {
  if (!onionOn || d.frames.length < 2) return null;
  const prev = (d.frameIndex - 1 + d.frames.length) % d.frames.length, key = `${d.name}|${prev}|${d.frameIndex}|${d.history.index}|${d.width}x${d.height}`;
  if (onionCache?.key === key) return onionCache.c;
  // solo lo que se ve en el cuadro anterior y no en el actual (el fondo común no tapa el dibujo)
  const vis = new Map(d.allLayers().map(l => [l, l.visible])), set = new Set(d.frames[prev].visible), now = new Set(d.frames[d.frameIndex]?.visible ?? []);
  for (const l of d.allLayers()) l.visible = l.kind === 'group' ? set.has(l.id) || now.has(l.id) : set.has(l.id) && !now.has(l.id);
  const c = d.flatten();
  for (const [l, v] of vis) l.visible = v;
  onionCache = { key, c }; return c;
};
/** Imagen de cada cuadro, para exportar. */
export function renderFrames(d: EditorDocument): { canvas: HTMLCanvasElement; delay: number }[] {
  const keep = d.frameIndex, out = [];
  for (let i = 0; i < d.frames.length; i++) { applyFrame(d, i); out.push({ canvas: d.flatten(), delay: d.frames[i].delay }); }
  applyFrame(d, keep);
  return out;
}
export function framesFromLayers(d: EditorDocument) {
  const tops = d.root.children;
  if (tops.length < 2) { app.toast('Hacen falta al menos dos capas', 'warn'); return; }
  d.frames = tops.map(l => ({ delay: 100, visible: d.allLayers().filter(x => { let p: any = x; while (p.parent && p.parent !== d.root) p = p.parent; return p === l; }).map(x => x.id) }));
  applyFrame(d, 0);
}

export function buildTimeline(parent: HTMLElement) {
  const strip = h('div', { class: 'tl-frames' });
  let timer = 0;
  const stop = () => { clearTimeout(timer); timer = 0; playBtn.innerHTML = icon('play'); };
  const play = () => {
    const d = app.doc; if (!d || d.frames.length < 2) return;
    if (timer) { stop(); return; }
    playBtn.innerHTML = icon('stop');
    const tick = () => { const dd = app.doc; if (!dd || dd.frames.length < 2) { stop(); return; } applyFrame(dd, (dd.frameIndex + 1) % dd.frames.length); timer = window.setTimeout(tick, dd.frames[dd.frameIndex].delay); };
    timer = window.setTimeout(tick, d.frames[d.frameIndex]?.delay ?? 100);
  };
  const btn = (label: string, title: string, fn: () => void) => { const b = h('button', { class: 'btn', title }, label); b.onclick = fn; return b; };
  const playBtn = btn('', 'Reproducir / detener', play); playBtn.innerHTML = icon('play'); playBtn.classList.add('icon-btn');
  const bar = h('div', { class: 'tl-bar' }, h('b', {}, 'Línea de tiempo'), playBtn,
    btn('+ Cuadro', 'Duplicar el cuadro actual', () => { const d = app.doc; if (!d) return; if (!d.frames.length) d.frames.push({ delay: 100, visible: visibleIds(d) }); d.frames.splice(d.frameIndex + 1, 0, { delay: d.frames[d.frameIndex].delay, visible: visibleIds(d) }); applyFrame(d, d.frameIndex + 1); d.commit('Añadir cuadro'); }),
    btn('Eliminar', 'Eliminar el cuadro actual', () => { const d = app.doc; if (!d || !d.frames.length) return; d.frames.splice(d.frameIndex, 1); if (d.frames.length) applyFrame(d, Math.min(d.frameIndex, d.frames.length - 1)); else d.changed(); d.commit('Eliminar cuadro'); }),
    btn('Cuadros desde capas', 'Crea un cuadro por cada capa', () => { if (app.doc) { framesFromLayers(app.doc); if (app.doc.frames.length) app.doc.commit('Cuadros desde capas'); } }),
    (() => { const b = btn('Papel cebolla', 'Ver el cuadro anterior en transparencia mientras dibujas', () => { onion.on = !onionOn; b.classList.toggle('on', onionOn); }); return b; })(),
    h('span', { class: 'hint' }, 'Cada cuadro recuerda qué capas se ven. Exporta con Archivo › Exportar como (GIF animado o vídeo WebM).'));
  const el = h('div', { class: 'timeline closed', 'data-group': 'timeline' }, bar, strip);
  parent.append(el);

  const thumbs = new Map<string, HTMLCanvasElement>();
  const render = () => {
    const d = app.doc;
    if (el.classList.contains('closed')) return;
    strip.innerHTML = '';
    if (!d) return;
    // El cuadro actual sigue los cambios de visibilidad que haga el usuario
    if (d.frames[d.frameIndex] && !timer) d.frames[d.frameIndex].visible = visibleIds(d);
    if (!d.frames.length) { strip.append(h('div', { class: 'hint tl-empty' }, 'Sin animación. Pulsa «+ Cuadro» o «Cuadros desde capas».')); return; }
    d.frames.forEach((f, i) => {
      const k = Math.min(64 / d.width, 48 / d.height), c = makeCanvas(Math.max(1, d.width * k), Math.max(1, d.height * k));
      if (i === d.frameIndex) { ctx2d(c).drawImage(d.getComposite(), 0, 0, c.width, c.height); thumbs.set(d.name + i, c); }
      const shown = i === d.frameIndex ? c : thumbs.get(d.name + i) ?? c;
      const delay = h('select', { class: 'tl-delay', title: 'Duración del cuadro' }, ...[20, 50, 100, 200, 500, 1000, 2000].map(ms => h('option', { value: String(ms) }, ms / 1000 + ' s')));
      if (![...delay.options].some(o => +o.value === f.delay)) delay.append(h('option', { value: String(f.delay) }, f.delay / 1000 + ' s'));
      delay.value = String(f.delay);
      delay.onchange = () => { f.delay = +delay.value; d.commit('Duración del cuadro'); };
      delay.onclick = e => e.stopPropagation();
      const cell = h('div', { class: 'tl-frame' + (i === d.frameIndex ? ' on' : '') }, h('span', { class: 'tl-n' }, String(i + 1)), shown, delay);
      cell.onclick = () => { stop(); applyFrame(d, i); };
      strip.append(cell);
    });
  };
  app.on('doc', render); app.on('docs', render);
  return { el, render, html: icon };
}
