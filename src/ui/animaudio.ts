// Sonido en la animación: una pista de audio (voz, música, efectos) que suena al reproducir, se ve como onda debajo de los
// fotogramas (para sincronizar bocas, pasos o golpes con el sonido) y se mezcla en el vídeo al exportar. Se guarda dentro
// del proyecto.
import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog } from './dialog';
import { icon } from './icons';
import { ctx2d } from '../core/canvas';
import type { EditorDocument } from '../core/document';

export type AnimAudio = { name: string; data: string; offset: number; volume: number };
const buffers = new WeakMap<object, { key: string; buf: AudioBuffer; peaks: Float32Array }>();
let actx: AudioContext | null = null;
const ctx = () => (actx ??= new AudioContext());

const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
export const audioOf = (d: EditorDocument | null | undefined) => (d?.meta as any)?.audio as AnimAudio | undefined;

/** Sonido decodificado (y su onda resumida), con caché por documento. */
export async function decoded(d: EditorDocument) {
  const a = audioOf(d); if (!a) return null;
  const key = a.data.length + ':' + a.data.slice(0, 64), c = buffers.get(d);
  if (c && c.key === key) return c;
  const buf = await ctx().decodeAudioData(unb64(a.data).buffer.slice(0) as ArrayBuffer);
  const N = 2000, ch = buf.getChannelData(0), peaks = new Float32Array(N), step = Math.max(1, Math.floor(ch.length / N));
  for (let i = 0; i < N; i++) { let m = 0; const o = i * step; for (let j = 0; j < step && o + j < ch.length; j++) m = Math.max(m, Math.abs(ch[o + j])); peaks[i] = m; }
  const r = { key, buf, peaks }; buffers.set(d, r); return r;
}
/** Momento (ms) en que empieza el fotograma i. */
export function frameTime(d: EditorDocument, i: number) { let t = 0; for (let k = 0; k < i && k < d.frames.length; k++) t += d.frames[k].delay; return t; }
export const totalTime = (d: EditorDocument) => frameTime(d, d.frames.length);

export async function importAudio(file?: File) {
  const d = app.doc; if (!d) return;
  if (!file) { const io = await import('../io/files'); const fs = await io.pickFiles('audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac'); file = fs[0]; if (!file) return; }
  if (file.size > 25 * 1024 * 1024) { app.toast('El sonido es demasiado largo (máximo 25 MB)', 'warn'); return; }
  const data = b64(new Uint8Array(await file.arrayBuffer()));
  const prev = audioOf(d); (d.meta as any).audio = { name: file.name, data, offset: 0, volume: 1 } as AnimAudio;
  try { await decoded(d); }
  catch { (d.meta as any).audio = prev; app.toast('No se puede leer este sonido (prueba con MP3, WAV u OGG)', 'warn'); return; }
  d.modified = true; app.toast('Sonido añadido: suena al reproducir y sale en el vídeo'); app.emit('docs');
}
export function removeAudio() { const d = app.doc; if (!d || !audioOf(d)) return; stopAudio(); delete (d.meta as any).audio; d.modified = true; app.emit('docs'); }

// ---- reproducción ------------------------------------------------------------------------------------
let playing: { src: AudioBufferSourceNode; startCtx: number; startMs: number } | null = null;
export function stopAudio() { if (playing) { try { playing.src.stop(); } catch { /* */ } playing = null; } }
/** Empieza a sonar desde el momento del fotograma i (teniendo en cuenta el desfase de la pista). */
export async function playAudioAt(d: EditorDocument, i: number) {
  stopAudio();
  const a = audioOf(d); if (!a) return;
  const dec = await decoded(d).catch(() => null); if (!dec) return;
  const c = ctx(); await c.resume().catch(() => {});
  const t = (frameTime(d, i) - a.offset) / 1000;
  const src = c.createBufferSource(), g = c.createGain(); g.gain.value = a.volume; src.buffer = dec.buf; src.connect(g); g.connect(c.destination);
  if (t >= 0) { if (t >= dec.buf.duration) return; src.start(0, t); } else src.start(c.currentTime - t);
  playing = { src, startCtx: c.currentTime, startMs: frameTime(d, i) };
}
/** Para el vídeo: la pista decodificada con su desfase y volumen. */
export async function audioForExport(d: EditorDocument) { const a = audioOf(d); if (!a) return null; const dec = await decoded(d).catch(() => null); return dec ? { buffer: dec.buf, offset: a.offset, volume: a.volume } : null; }

// ---- onda debajo de los fotogramas ---------------------------------------------------------------------
/** Tira con la onda del sonido; las rayas marcan cada fotograma. Tocarla lleva al fotograma de ese momento. */
export function audioStrip(d: EditorDocument, goto: (i: number) => void): HTMLElement | null {
  const a = audioOf(d); if (!a) return null;
  const cv = h('canvas', { class: 'anim-wave', height: 34, title: 'Toca la onda para ir al fotograma de ese momento' }) as HTMLCanvasElement;
  let peaks: Float32Array | null = null, dur = 0;
  const draw = () => {
    const W = Math.max(100, Math.round(cv.clientWidth || 300)); if (cv.width !== W) cv.width = W;
    const x = ctx2d(cv), H = cv.height, total = Math.max(totalTime(d), 1); x.clearRect(0, 0, W, H);
    const st = getComputedStyle(document.body), acc = st.getPropertyValue('--accent').trim() || '#3d8bfd', mut = st.getPropertyValue('--muted').trim() || '#888';
    // onda (el tiempo de la animación ocupa todo el ancho)
    if (peaks && dur) { x.fillStyle = acc; for (let px = 0; px < W; px++) { const ms = px / W * total - a.offset; if (ms < 0 || ms > dur * 1000) continue; const p = peaks[Math.min(peaks.length - 1, Math.floor(ms / 1000 / dur * peaks.length))], hh = Math.max(1, p * (H - 4)); x.fillRect(px, (H - hh) / 2, 1, hh); } }
    // fotogramas
    x.fillStyle = mut; x.globalAlpha = 0.5; for (let i = 1; i < d.frames.length; i++) x.fillRect(Math.round(frameTime(d, i) / total * W), 0, 1, H); x.globalAlpha = 1;
    const i = d.frameIndex, x0 = frameTime(d, i) / total * W, x1 = frameTime(d, i + 1) / total * W;
    x.fillStyle = acc; x.globalAlpha = 0.25; x.fillRect(x0, 0, Math.max(2, x1 - x0), H); x.globalAlpha = 1;
  };
  decoded(d).then(r => { if (r) { peaks = r.peaks; dur = r.buf.duration; draw(); } }).catch(() => {});
  cv.onclick = e => { const r = cv.getBoundingClientRect(), ms = (e.clientX - r.left) / r.width * totalTime(d); let i = 0; while (i < d.frames.length - 1 && frameTime(d, i + 1) <= ms) i++; goto(i); };
  // se redibuja mientras se reproduce (la barra no se rehace en cada fotograma)
  let last = -1; const loop = () => { if (!cv.isConnected) return; if (d.frameIndex !== last) { last = d.frameIndex; draw(); } requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  const name = h('span', { class: 'anim-wave-name no-i18n' }, a.name);
  const set = h('button', { type: 'button', class: 'btn icon-btn', title: 'Ajustar el sonido (desfase, volumen, quitar)', 'aria-label': 'Ajustar el sonido', html: icon('music') }); set.onclick = () => audioDialog();
  return h('div', { class: 'anim-audio' }, set, h('div', { class: 'anim-wave-box' }, cv, name));
}
export function audioDialog() {
  const d = app.doc; if (!d) return;
  const a = audioOf(d);
  if (!a) { importAudio(); return; }
  const prev = { ...a };
  const total = Math.max(1000, totalTime(d));
  const rep = h('button', { type: 'button', class: 'btn' }, 'Cambiar el sonido…'); rep.onclick = () => { dlg.close(); importAudio(); };
  const del = h('button', { type: 'button', class: 'btn' }, 'Quitar el sonido'); del.onclick = () => { dlg.close(); removeAudio(); };
  const test = h('button', { type: 'button', class: 'btn' }, 'Escuchar desde el fotograma actual'); test.onclick = () => playAudioAt(d, d.frameIndex);
  const dlg = showDialog({
    title: 'Sonido de la animación', okLabel: 'Guardar', width: 460,
    body: [h('div', { class: 'hint no-i18n' }, a.name),
      h('div', { class: 'form-row' }, h('label', {}, 'Empieza en'), numberSlider({ min: -total, max: total, value: a.offset, unit: ' ms', onInput: v => { a.offset = v; } }).el),
      h('div', { class: 'hint' }, 'Mueve el sonido para que encaje: con un número positivo empieza más tarde, y con uno negativo se salta el principio.'),
      h('div', { class: 'form-row' }, h('label', {}, 'Volumen'), numberSlider({ min: 0, max: 150, value: Math.round(a.volume * 100), unit: '%', onInput: v => { a.volume = v / 100; } }).el),
      h('div', { class: 'pv-nav' }, test, rep, del)],
    onOk: () => { stopAudio(); d.modified = true; app.emit('docs'); },
    onCancel: () => { stopAudio(); Object.assign(a, prev); },
  });
}
