// Estudio de sonido: abrir, grabar con el micrófono o generar efectos de juego; ver la onda, elegir un trozo arrastrando y
// editarlo (cortar, recortar, silencio, fundidos, volumen, normalizar, invertir, velocidad, eco, quitar ruido) con deshacer.
// Se exporta en WAV o se usa directamente como sonido de la animación. Todo se procesa en el dispositivo.
import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog } from './dialog';
import { icon } from './icons';
import { ctx2d } from '../core/canvas';
import { t } from '../i18n/i18n';

export type Snd = { sr: number; ch: Float32Array[] };
const len = (s: Snd) => s.ch[0]?.length ?? 0;
const copy = (s: Snd): Snd => ({ sr: s.sr, ch: s.ch.map(c => c.slice()) });
const clampI = (s: Snd, a: number, b: number): [number, number] => { const n = len(s); a = Math.max(0, Math.min(n, Math.round(a))); b = Math.max(0, Math.min(n, Math.round(b))); return a <= b ? [a, b] : [b, a]; };

// ---- operaciones (sobre el trozo [a, b) en muestras) -------------------------------------------------------
export const ops = {
  /** Quita el trozo. */
  cut(s: Snd, a: number, b: number): Snd { [a, b] = clampI(s, a, b); return { sr: s.sr, ch: s.ch.map(c => { const o = new Float32Array(c.length - (b - a)); o.set(c.subarray(0, a)); o.set(c.subarray(b), a); return o; }) }; },
  /** Se queda solo con el trozo. */
  keep(s: Snd, a: number, b: number): Snd { [a, b] = clampI(s, a, b); return { sr: s.sr, ch: s.ch.map(c => c.slice(a, b)) }; },
  silence(s: Snd, a: number, b: number): Snd { [a, b] = clampI(s, a, b); const o = copy(s); for (const c of o.ch) c.fill(0, a, b); return o; },
  fadeIn(s: Snd, a: number, b: number): Snd { [a, b] = clampI(s, a, b); const o = copy(s), n = Math.max(1, b - a); for (const c of o.ch) for (let i = a; i < b; i++) c[i] *= (i - a) / n; return o; },
  fadeOut(s: Snd, a: number, b: number): Snd { [a, b] = clampI(s, a, b); const o = copy(s), n = Math.max(1, b - a); for (const c of o.ch) for (let i = a; i < b; i++) c[i] *= 1 - (i - a) / n; return o; },
  gain(s: Snd, a: number, b: number, g: number): Snd { [a, b] = clampI(s, a, b); const o = copy(s); for (const c of o.ch) for (let i = a; i < b; i++) c[i] = Math.max(-1, Math.min(1, c[i] * g)); return o; },
  /** Sube (o baja) el volumen hasta que el pico llegue a `peak`. */
  normalize(s: Snd, a: number, b: number, peak = 0.95): Snd { [a, b] = clampI(s, a, b); let m = 0; for (const c of s.ch) for (let i = a; i < b; i++) m = Math.max(m, Math.abs(c[i])); return m < 1e-6 ? copy(s) : ops.gain(s, a, b, peak / m); },
  reverse(s: Snd, a: number, b: number): Snd { [a, b] = clampI(s, a, b); const o = copy(s); for (const c of o.ch) c.subarray(a, b).reverse(); return o; },
  /** Más rápido (y agudo) con factor > 1, más lento (y grave) con factor < 1. */
  speed(s: Snd, a: number, b: number, f: number): Snd {
    [a, b] = clampI(s, a, b); f = Math.max(0.25, Math.min(4, f));
    return { sr: s.sr, ch: s.ch.map(c => { const part = c.subarray(a, b), n = Math.max(1, Math.round(part.length / f)), r = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i * f, i0 = Math.floor(x), fr = x - i0; r[i] = (part[i0] ?? 0) * (1 - fr) + (part[i0 + 1] ?? part[i0] ?? 0) * fr; } const o = new Float32Array(c.length - (b - a) + n); o.set(c.subarray(0, a)); o.set(r, a); o.set(c.subarray(b), a + n); return o; }) };
  },
  /** Eco: repeticiones cada `ms`, cada una `fb` veces más flojas; deja sonar la cola al final. */
  echo(s: Snd, a: number, b: number, ms: number, fb: number, mix = 0.5): Snd {
    [a, b] = clampI(s, a, b); const dl = Math.max(1, Math.round(ms / 1000 * s.sr)), tail = Math.min(s.sr * 4, Math.round(dl * Math.log(0.01) / Math.log(Math.max(0.05, Math.min(0.95, fb)))));
    return { sr: s.sr, ch: s.ch.map(c => {
      const extra = b === c.length ? tail : 0, o = new Float32Array(c.length + extra); o.set(c);
      const wet = new Float32Array(b - a + extra);
      for (let i = 0; i < wet.length; i++) { const dry = i < b - a ? c[a + i] : 0, prev = i >= dl ? wet[i - dl] : 0; wet[i] = dry + prev * fb; }
      for (let i = 0; i < wet.length; i++) { const dry = i < b - a ? c[a + i] : 0; o[a + i] = Math.max(-1, Math.min(1, dry + (wet[i] - dry) * mix)); }
      return o; }) };
  },
  /** Quita el ruido de fondo flojo (puerta de ruido suave). */
  denoise(s: Snd, a: number, b: number, thr = 0.03): Snd {
    [a, b] = clampI(s, a, b); const o = copy(s), win = Math.max(16, Math.round(s.sr * 0.01));
    for (const c of o.ch) { let env = 0, g = 1; for (let i = a; i < b; i++) { env = Math.max(Math.abs(c[i]), env * Math.exp(-1 / win)); const target = env < thr ? 0 : 1; g += (target - g) * (target > g ? 0.2 : 0.002); c[i] *= g; } }
    return o;
  },
};

// ---- WAV ---------------------------------------------------------------------------------------------
export function encodeWav(s: Snd): Uint8Array {
  const n = len(s), nc = s.ch.length, bytes = 44 + n * nc * 2, b = new Uint8Array(bytes), v = new DataView(b.buffer);
  const str = (o: number, x: string) => { for (let i = 0; i < x.length; i++) b[o + i] = x.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true);
  v.setUint32(24, s.sr, true); v.setUint32(28, s.sr * nc * 2, true); v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * nc * 2, true);
  let o = 44; for (let i = 0; i < n; i++) for (let k = 0; k < nc; k++) { const x = Math.max(-1, Math.min(1, s.ch[k][i])); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2; }
  return b;
}
let actx: AudioContext | null = null;
const ac = () => (actx ??= new AudioContext());
export async function decodeFile(data: ArrayBuffer): Promise<Snd> {
  const buf = await ac().decodeAudioData(data.slice(0));
  return { sr: buf.sampleRate, ch: Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i).slice()) };
}

// ---- generador de efectos de juego (estilo retro) -------------------------------------------------------
export type Sfx = { wave: 'square' | 'saw' | 'sine' | 'triangle' | 'noise'; f0: number; f1: number; dur: number; attack: number; decay: number; vib: number; vibHz: number; jump: number; jumpAt: number; duty: number; lowpass: number; crush: number; vol: number };
export const SFX_PRESETS: { id: string; name: string; p: Sfx }[] = [
  { id: 'coin', name: 'Moneda', p: { wave: 'square', f0: 990, f1: 990, dur: 0.28, attack: 0.002, decay: 0.24, vib: 0, vibHz: 0, jump: 1.5, jumpAt: 0.07, duty: 0.5, lowpass: 1, crush: 0, vol: 0.5 } },
  { id: 'jump', name: 'Salto', p: { wave: 'square', f0: 300, f1: 760, dur: 0.25, attack: 0.005, decay: 0.2, vib: 0, vibHz: 0, jump: 1, jumpAt: 1, duty: 0.35, lowpass: 1, crush: 0, vol: 0.5 } },
  { id: 'laser', name: 'Láser', p: { wave: 'saw', f0: 1500, f1: 180, dur: 0.22, attack: 0.001, decay: 0.2, vib: 0, vibHz: 0, jump: 1, jumpAt: 1, duty: 0.5, lowpass: 1, crush: 0, vol: 0.45 } },
  { id: 'explosion', name: 'Explosión', p: { wave: 'noise', f0: 900, f1: 60, dur: 0.9, attack: 0.002, decay: 0.85, vib: 0, vibHz: 0, jump: 1, jumpAt: 1, duty: 0.5, lowpass: 0.35, crush: 0, vol: 0.7 } },
  { id: 'powerup', name: 'Mejora (power-up)', p: { wave: 'square', f0: 300, f1: 1200, dur: 0.6, attack: 0.01, decay: 0.3, vib: 0.08, vibHz: 14, jump: 1, jumpAt: 1, duty: 0.5, lowpass: 1, crush: 0, vol: 0.45 } },
  { id: 'hit', name: 'Golpe', p: { wave: 'noise', f0: 1800, f1: 400, dur: 0.16, attack: 0.001, decay: 0.14, vib: 0, vibHz: 0, jump: 1, jumpAt: 1, duty: 0.5, lowpass: 0.6, crush: 0, vol: 0.6 } },
  { id: 'blip', name: 'Clic (menú)', p: { wave: 'square', f0: 1300, f1: 1300, dur: 0.06, attack: 0.001, decay: 0.05, vib: 0, vibHz: 0, jump: 1, jumpAt: 1, duty: 0.5, lowpass: 1, crush: 0, vol: 0.4 } },
  { id: 'error', name: 'Error', p: { wave: 'saw', f0: 220, f1: 150, dur: 0.35, attack: 0.005, decay: 0.3, vib: 0.05, vibHz: 30, jump: 1, jumpAt: 1, duty: 0.5, lowpass: 0.7, crush: 0, vol: 0.45 } },
  { id: 'step', name: 'Paso', p: { wave: 'noise', f0: 500, f1: 200, dur: 0.07, attack: 0.001, decay: 0.06, vib: 0, vibHz: 0, jump: 1, jumpAt: 1, duty: 0.5, lowpass: 0.3, crush: 0, vol: 0.5 } },
];
/** Genera el efecto (44,1 kHz, una pista). Determinista: el ruido sale de una semilla. */
export function synth(p: Sfx, seed = 1, sr = 44100): Snd {
  const n = Math.max(1, Math.round(p.dur * sr)), out = new Float32Array(n);
  let ph = 0, lp = 0, s = seed * 9301 + 49297, noise = 0, nPh = 0;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647 * 2 - 1;
  for (let i = 0; i < n; i++) {
    const tt = i / sr, k = tt / p.dur;
    let f = p.f0 * Math.pow(Math.max(1, p.f1) / Math.max(1, p.f0), k);
    if (tt >= p.jumpAt) f *= p.jump;
    if (p.vib) f *= 1 + p.vib * Math.sin(2 * Math.PI * p.vibHz * tt);
    ph = (ph + f / sr) % 1;
    let v: number;
    switch (p.wave) {
      case 'square': v = ph < p.duty ? 1 : -1; break;
      case 'saw': v = ph * 2 - 1; break;
      case 'triangle': v = 1 - 4 * Math.abs(ph - 0.5); break;
      case 'sine': v = Math.sin(2 * Math.PI * ph); break;
      default: { nPh += f / sr; if (nPh >= 1) { nPh %= 1; noise = rnd(); } v = noise; }
    }
    // filtro paso bajo de un polo (lowpass = 1 no filtra)
    const a = Math.min(1, Math.max(0.01, p.lowpass)); lp += (v - lp) * a; v = lp;
    if (p.crush > 0) { const q = Math.pow(2, Math.max(1, 8 - p.crush * 6)); v = Math.round(v * q) / q; }
    const env = tt < p.attack ? tt / Math.max(1e-4, p.attack) : Math.max(0, 1 - (tt - p.attack) / Math.max(1e-4, p.decay));
    out[i] = v * env * p.vol;
  }
  return { sr, ch: [out] };
}
/** Variante: cambia un poco las frecuencias, la duración y el vibrato (sin dejar de parecerse). */
export function mutate(p: Sfx, seed: number): Sfx {
  let s = seed * 7919 + 17; const r = () => (s = (s * 16807) % 2147483647) / 2147483647 * 2 - 1;
  return { ...p, f0: Math.max(30, p.f0 * (1 + r() * 0.25)), f1: Math.max(30, p.f1 * (1 + r() * 0.25)), dur: Math.max(0.03, p.dur * (1 + r() * 0.2)), vib: Math.max(0, p.vib + r() * 0.03), duty: Math.max(0.1, Math.min(0.9, p.duty + r() * 0.15)) };
}

// ---- estudio ------------------------------------------------------------------------------------------
let snd: Snd | null = null;           // lo que hay en el estudio (se mantiene al cerrar la ventana)
const undoS: Snd[] = [], redoS: Snd[] = [];
export const studioSound = () => snd;
export function setStudioSound(s: Snd | null, keepHistory = false) { if (!keepHistory) { undoS.length = 0; redoS.length = 0; } snd = s; }

export function audioStudio() {
  let selA = 0, selB = 0, zoom = 1, scroll = 0, playing: AudioBufferSourceNode | null = null, playT0 = 0, playFrom = 0, raf = 0, rec: MediaRecorder | null = null;
  const wave = h('canvas', { class: 'snd-wave', height: 150, title: 'Arrastra para elegir un trozo; sin elegir nada, se edita todo el sonido' }) as HTMLCanvasElement;
  const info = h('div', { class: 'hint snd-info' });
  const fmt = (smp: number) => snd ? (smp / snd.sr).toFixed(2) + ' s' : '0 s';
  const sel = (): [number, number] => snd ? (selB > selA ? [selA, selB] : [0, len(snd)]) : [0, 0];
  const draw = () => {
    const W = Math.max(200, Math.round(wave.clientWidth || 600)); if (wave.width !== W) wave.width = W;
    const x = ctx2d(wave), H = wave.height, st = getComputedStyle(document.body), acc = st.getPropertyValue('--accent').trim() || '#3d8bfd', mut = st.getPropertyValue('--muted').trim() || '#888';
    x.clearRect(0, 0, W, H);
    if (!snd || !len(snd)) { x.fillStyle = mut; x.font = '13px system-ui, sans-serif'; x.textAlign = 'center'; x.fillText(t('Abre, graba o genera un sonido'), W / 2, H / 2); info.textContent = ''; return; }
    const n = len(snd), vis = n / zoom, s0 = Math.max(0, Math.min(n - vis, scroll)), per = vis / W, c = snd.ch[0];
    // selección
    if (selB > selA) { const xa = (selA - s0) / per, xb = (selB - s0) / per; x.fillStyle = acc; x.globalAlpha = 0.18; x.fillRect(xa, 0, xb - xa, H); x.globalAlpha = 1; }
    x.fillStyle = acc;
    for (let px = 0; px < W; px++) { const i0 = Math.floor(s0 + px * per), i1 = Math.min(n, Math.floor(s0 + (px + 1) * per) + 1); let mn = 0, mx = 0; for (let i = i0; i < i1; i++) { const v = c[i]; if (v < mn) mn = v; if (v > mx) mx = v; } x.fillRect(px, H / 2 - mx * H / 2, 1, Math.max(1, (mx - mn) * H / 2)); }
    x.fillStyle = mut; x.globalAlpha = 0.5; x.fillRect(0, H / 2, W, 1); x.globalAlpha = 1;
    if (playing) { const pos = playFrom + (ac().currentTime - playT0) * snd.sr; x.fillStyle = '#ff4d6d'; x.fillRect((pos - s0) / per, 0, 2, H); }
    const [a, b] = sel(); info.textContent = `${fmt(n)} · ${snd.sr} Hz · ${snd.ch.length === 2 ? t('estéreo') : t('mono')}` + (selB > selA ? ` · ${t('elegido')} ${fmt(a)} – ${fmt(b)} (${fmt(b - a)})` : '');
  };
  const sm = (e: PointerEvent) => { if (!snd) return 0; const r = wave.getBoundingClientRect(), n = len(snd), vis = n / zoom, s0 = Math.max(0, Math.min(n - vis, scroll)); return Math.max(0, Math.min(n, Math.round(s0 + (e.clientX - r.left) / r.width * vis))); };
  let dragA = -1;
  wave.onpointerdown = e => { if (!snd) return; wave.setPointerCapture(e.pointerId); dragA = sm(e); selA = selB = dragA; draw(); };
  wave.onpointermove = e => { if (dragA < 0) return; const v = sm(e); selA = Math.min(dragA, v); selB = Math.max(dragA, v); draw(); };
  wave.onpointerup = () => { dragA = -1; if (selB - selA < (snd?.sr ?? 44100) * 0.005) { selA = selB = 0; } draw(); };
  // reproducir
  const stop = () => { try { playing?.stop(); } catch { /* */ } playing = null; cancelAnimationFrame(raf); playBtn.innerHTML = icon('play'); draw(); };
  const play = async () => {
    if (playing) { stop(); return; } if (!snd) return;
    const c = ac(); await c.resume().catch(() => {});
    const [a, b] = sel(), buf = c.createBuffer(snd.ch.length, Math.max(1, b - a), snd.sr); snd.ch.forEach((ch, i) => buf.copyToChannel(ch.slice(a, b), i));
    const src = c.createBufferSource(); src.buffer = buf; src.loop = loopChk.checked; src.connect(c.destination); src.start(); playing = src; playT0 = c.currentTime; playFrom = a; playBtn.innerHTML = icon('stop');
    src.onended = () => { if (playing === src) stop(); };
    const loop = () => { if (!playing) return; if (loopChk.checked && snd) { const d = (ac().currentTime - playT0) * snd.sr; if (d > b - a) { playT0 += (b - a) / snd.sr; } } draw(); raf = requestAnimationFrame(loop); }; loop();
  };
  // edición con deshacer
  const apply = (f: (s: Snd, a: number, b: number) => Snd, label: string) => {
    if (!snd) { app.toast('Abre, graba o genera antes un sonido', 'warn'); return; }
    stop(); const [a, b] = sel(); undoS.push(snd); if (undoS.length > 40) undoS.shift(); redoS.length = 0;
    snd = f(snd, a, b); if (!len(snd)) { snd = undoS.pop()!; app.toast('El sonido no puede quedarse vacío', 'warn'); return; }
    if (label === 'cut' || label === 'keep' || label === 'speed') { selA = selB = 0; } else if (selB > len(snd)) { selB = len(snd); }
    draw();
  };
  const undo = () => { const p = undoS.pop(); if (!p || !snd) return; redoS.push(snd); snd = p; selA = selB = 0; draw(); };
  const redo = () => { const p = redoS.pop(); if (!p || !snd) return; undoS.push(snd); snd = p; selA = selB = 0; draw(); };
  const btn = (label: string, title: string, fn: () => void) => { const b = h('button', { type: 'button', class: 'btn', title }, label); b.onclick = fn; return b; };
  const ib = (ic: string, title: string, fn: () => void) => { const b = h('button', { type: 'button', class: 'btn icon-btn', title, 'aria-label': title, html: icon(ic) }); b.onclick = fn; return b; };
  let gainV = 150, speedV = 100, echoMs = 250, echoFb = 40;
  const playBtn = ib('play', 'Reproducir (lo elegido o todo)', play);
  const loopChk = h('input', { type: 'checkbox' }) as HTMLInputElement;
  // abrir, grabar, generar
  const load = async (file: File) => { try { stop(); const s = await decodeFile(await file.arrayBuffer()); undoS.push(...(snd ? [snd] : [])); snd = s; selA = selB = 0; zoom = 1; scroll = 0; draw(); app.toast(t('Sonido abierto')); } catch { app.toast('No se puede leer este sonido (prueba con MP3, WAV u OGG)', 'warn'); } };
  const openBtn = btn(t('Abrir sonido…'), 'MP3, WAV, OGG, M4A…', async () => { const io = await import('../io/files'); const [f] = await io.pickFiles('audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac'); if (f) load(f); });
  const recBtn = btn(t('Grabar'), 'Graba con el micrófono (pide permiso)', async () => {
    if (rec) { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }), chunks: Blob[] = [];
      rec = new MediaRecorder(stream); rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => { stream.getTracks().forEach(tr => tr.stop()); rec = null; recBtn.textContent = t('Grabar'); recBtn.classList.remove('rec-on'); const b = new Blob(chunks); if (b.size) await load(new File([b], 'grabacion.webm')); };
      rec.start(); recBtn.textContent = t('Parar la grabación'); recBtn.classList.add('rec-on'); app.toast(t('Grabando… toca otra vez para parar'));
    } catch { rec = null; app.toast('No se puede usar el micrófono (no hay o no se ha dado permiso)', 'warn'); }
  });
  // efectos de juego
  let sp: Sfx = { ...SFX_PRESETS[0].p }, seed = 1;
  const sfxChips = h('div', { class: 'tex-chips' }, ...SFX_PRESETS.map(pr => { const b = h('button', { type: 'button', class: 'btn tex-chip', 'data-sfx': pr.id }, pr.name); b.onclick = () => { sp = { ...pr.p }; seed = 1; gen(); sfxChips.querySelectorAll('.tex-chip').forEach(x => x.classList.toggle('on', x === b)); renderSfx(); }; return b; }));
  const sfxBox = h('div', { class: 'snd-sfx' });
  const gen = () => { stop(); if (snd) undoS.push(snd); redoS.length = 0; snd = synth(seed > 1 ? mutate(sp, seed) : sp, seed); selA = selB = 0; zoom = 1; scroll = 0; draw(); play(); };
  const renderSfx = () => {
    const row = (l: string, ...e: HTMLElement[]) => h('div', { class: 'form-row' }, h('label', {}, l), ...e);
    const waveSel = h('select', {}, ...[['square', 'Cuadrada (8 bits)'], ['saw', 'Sierra'], ['triangle', 'Triangular'], ['sine', 'Suave (seno)'], ['noise', 'Ruido']].map(([v, n]) => h('option', { value: v }, n))) as HTMLSelectElement;
    waveSel.value = sp.wave; waveSel.onchange = () => { sp.wave = waveSel.value as Sfx['wave']; };
    const s = (min: number, max: number, v: number, unit: string, on: (x: number) => void) => numberSlider({ min, max, value: v, unit, onInput: on }).el;
    sfxBox.replaceChildren(row('Onda', waveSel), row('Tono inicial', s(30, 4000, Math.round(sp.f0), ' Hz', v => { sp.f0 = v; })), row('Tono final', s(30, 4000, Math.round(sp.f1), ' Hz', v => { sp.f1 = v; })),
      row('Duración', s(20, 2000, Math.round(sp.dur * 1000), ' ms', v => { sp.dur = v / 1000; sp.decay = Math.max(0.01, sp.dur - sp.attack); })), row('Vibrato', s(0, 50, Math.round(sp.vib * 100), '%', v => { sp.vib = v / 100; if (!sp.vibHz) sp.vibHz = 12; })),
      row('Apagado (filtro)', s(0, 99, Math.round((1 - sp.lowpass) * 100), '%', v => { sp.lowpass = 1 - v / 100; })), row('Más retro', s(0, 100, Math.round(sp.crush * 100), '%', v => { sp.crush = v / 100; })),
      h('div', { class: 'pv-nav' }, btn(t('Generar'), 'Crea el sonido con estos ajustes', () => { seed = 1; gen(); }), btn(t('Otra variante'), 'Cambia un poco el sonido', () => { seed = 2 + Math.floor(Math.random() * 99999); gen(); })));
  };
  renderSfx();
  // guardar y usar
  const exportWav = async () => { if (!snd) return; const io = await import('../io/files'); try { await io.saveBlob(new Blob([encodeWav(snd) as BlobPart], { type: 'audio/wav' }), 'sonido.wav'); app.toast(t('Sonido guardado (WAV)')); } catch (e: any) { if (e?.name !== 'AbortError') app.toast(String(e?.message ?? e), 'warn'); } };
  const toAnim = async () => {
    if (!snd) return; const d = app.doc; if (!d) { app.toast('Abre o crea antes la animación', 'warn'); return; }
    const m = await import('./animaudio'); await m.importAudio(new File([encodeWav(snd) as BlobPart], 'sonido.wav', { type: 'audio/wav' })); dlg.close();
  };
  const sec = (title: string, open: boolean, ...kids: HTMLElement[]) => { const e = h('details', { class: 'pfx-sec' }, h('summary', {}, title), ...kids) as HTMLDetailsElement; e.open = open; return e; };
  const zoomBtns = h('span', { class: 'tm-zoom' }, ib('zoom', 'Acercar la onda', () => { if (!snd) return; zoom = Math.min(64, zoom * 2); const n = len(snd); scroll = selB > selA ? selA : Math.max(0, n / 2 - n / zoom / 2); draw(); }), (() => { const b = h('button', { type: 'button', class: 'btn icon-btn', title: 'Ver todo', 'aria-label': 'Ver todo' }, '1:1'); b.onclick = () => { zoom = 1; scroll = 0; draw(); }; return b; })());
  const dlg = showDialog({
    title: 'Estudio de sonido', okLabel: 'Cerrar', cancelLabel: null, width: 860,
    body: [h('div', { class: 'snd-top' }, openBtn, recBtn, h('span', { class: 'tm-sep' }), playBtn, h('label', { class: 'check' }, loopChk, ' ' + t('En bucle')), ib('undo', 'Deshacer', undo), ib('redo', 'Rehacer', redo), zoomBtns),
      h('div', { class: 'snd-wave-wrap' }, wave), info,
      h('div', { class: 'snd-edit' },
        btn(t('Cortar'), 'Quita lo elegido', () => apply(ops.cut, 'cut')), btn(t('Recortar'), 'Se queda solo con lo elegido', () => apply(ops.keep, 'keep')), btn(t('Silencio'), 'Deja en silencio lo elegido', () => apply(ops.silence, 'sil')),
        btn(t('Aparecer'), 'Fundido de entrada', () => apply(ops.fadeIn, 'fi')), btn(t('Desvanecer'), 'Fundido de salida', () => apply(ops.fadeOut, 'fo')),
        btn(t('Normalizar'), 'Sube el volumen al máximo sin distorsionar', () => apply((s, a, b) => ops.normalize(s, a, b), 'norm')), btn(t('Al revés'), 'Invierte lo elegido', () => apply(ops.reverse, 'rev')),
        btn(t('Quitar ruido'), 'Quita el ruido de fondo flojo', () => apply((s, a, b) => ops.denoise(s, a, b), 'den'))),
      h('div', { class: 'snd-params' },
        h('div', { class: 'form-row' }, h('label', {}, t('Volumen')), numberSlider({ min: 10, max: 400, value: gainV, unit: '%', onInput: v => { gainV = v; } }).el, btn(t('Aplicar'), '', () => apply((s, a, b) => ops.gain(s, a, b, gainV / 100), 'gain'))),
        h('div', { class: 'form-row' }, h('label', {}, t('Velocidad')), numberSlider({ min: 25, max: 400, value: speedV, unit: '%', onInput: v => { speedV = v; } }).el, btn(t('Aplicar'), '', () => apply((s, a, b) => ops.speed(s, a, b, speedV / 100), 'speed'))),
        h('div', { class: 'form-row' }, h('label', {}, t('Eco')), numberSlider({ min: 30, max: 1000, value: echoMs, unit: ' ms', onInput: v => { echoMs = v; } }).el, numberSlider({ min: 5, max: 90, value: echoFb, unit: '%', onInput: v => { echoFb = v; } }).el, btn(t('Aplicar'), '', () => apply((s, a, b) => ops.echo(s, a, b, echoMs, echoFb / 100), 'echo')))),
      sec(t('Efectos de sonido para juegos'), !snd, sfxChips, sfxBox),
      h('div', { class: 'pv-nav snd-out' }, btn(t('Guardar WAV'), 'Descarga el sonido en WAV', exportWav), btn(t('Usar en la animación'), 'Lo pone como sonido de la animación abierta', toAnim))],
    onOk: () => { stop(); if (rec) rec.stop(); },
    onCancel: () => { stop(); if (rec) rec.stop(); },
  });
  requestAnimationFrame(draw);
}
