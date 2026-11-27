// Extras de videojuegos: animaciones rápidas, etiquetas de animación, invertir orden, ajustar a la paleta (con tramado),
// rampas de color con cambio de tono, ampliar pixel art (vecino más próximo y Scale2x), degradado tramado e iconos.
import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog } from './dialog';
import { ctx2d, makeCanvas } from '../core/canvas';
import { RasterLayer } from '../core/layers';
import { EditorDocument } from '../core/document';
import { maxCanvasPixels } from '../core/polyfills';
import { buildFrames, isAnim, Pose } from './anim';
import { applyFrame } from './timeline';
import { currentPalette, setMyColors } from './pixelart';

const row = (label: string, ...els: (HTMLElement | string)[]) => h('div', { class: 'form-row' }, h('label', {}, label), ...els);
const sel = (opts: [string, string][], v?: string) => { const s = h('select', {}, ...opts.map(([a, b]) => h('option', { value: a }, b))) as HTMLSelectElement; if (v) s.value = v; return s; };

// ---- animaciones rápidas -------------------------------------------------------------------------
type Preset = { id: string; name: string; frames: number; pivot: string; loop: boolean; fn: (t: number, k: number, a: number, W: number, H: number) => Partial<Pose> };
export const PRESETS: Preset[] = [
  { id: 'bounce', name: 'Rebotar', frames: 10, pivot: 'bottom', loop: true, fn: (t, _k, a, _W, H) => { const up = Math.sin(Math.PI * t), land = Math.max(0, 1 - up * 4); return { dy: -H * 0.3 * a * up, sx: 1 + 0.18 * a * land, sy: 1 - 0.18 * a * land + 0.08 * a * up }; } },
  { id: 'float', name: 'Flotar', frames: 12, pivot: 'center', loop: true, fn: (t, _k, a, _W, H) => ({ dy: Math.sin(2 * Math.PI * t) * H * 0.06 * a }) },
  { id: 'pulse', name: 'Latido', frames: 8, pivot: 'center', loop: true, fn: (t, _k, a) => { const s = 1 + 0.14 * a * Math.pow(Math.sin(Math.PI * t), 2); return { sx: s, sy: s }; } },
  { id: 'breathe', name: 'Respirar (quieto)', frames: 10, pivot: 'bottom', loop: true, fn: (t, _k, a) => { const v = Math.sin(2 * Math.PI * t); return { sx: 1 - 0.03 * a * v, sy: 1 + 0.05 * a * v }; } },
  { id: 'shake', name: 'Temblor (golpe recibido)', frames: 8, pivot: 'center', loop: false, fn: (t, k, a, W) => ({ dx: (k % 2 ? 1 : -1) * W * 0.04 * a * (1 - t) }) },
  { id: 'spin', name: 'Girar', frames: 12, pivot: 'center', loop: true, fn: t => ({ rot: 360 * t }) },
  { id: 'coin', name: 'Moneda girando', frames: 10, pivot: 'center', loop: true, fn: t => ({ sx: Math.max(0.08, Math.abs(Math.cos(Math.PI * t))) }) },
  { id: 'swing', name: 'Balancearse', frames: 12, pivot: 'top', loop: true, fn: (t, _k, a) => ({ rot: Math.sin(2 * Math.PI * t) * 20 * a }) },
  { id: 'blink', name: 'Parpadear (invencible)', frames: 6, pivot: 'center', loop: true, fn: (_t, k) => ({ alpha: k % 2 ? 0.15 : 1 }) },
  { id: 'fadein', name: 'Aparecer', frames: 8, pivot: 'center', loop: false, fn: t => ({ alpha: t }) },
  { id: 'fadeout', name: 'Desaparecer', frames: 8, pivot: 'center', loop: false, fn: t => ({ alpha: 1 - t }) },
  { id: 'pop', name: 'Aparecer de golpe (con rebote)', frames: 8, pivot: 'center', loop: false, fn: t => { const c = 1.70158, s = 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); return { sx: Math.max(0.02, s), sy: Math.max(0.02, s) }; } },
];
export function presetPoses(id: string, frames: number, amount: number, W: number, H: number): Pose[] {
  const p = PRESETS.find(x => x.id === id) ?? PRESETS[0], out: Pose[] = [];
  for (let k = 0; k < frames; k++) {
    const t = p.loop ? k / frames : frames === 1 ? 1 : k / (frames - 1);
    out.push({ dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, alpha: 1, ...p.fn(t, k, amount, W, H) });
  }
  return out;
}
export function presetDialog() {
  const d = app.doc, src = d?.activeRaster(); if (!d || !src) { app.toast('Elige la capa con el personaje u objeto que quieres animar', 'warn'); return; }
  let cur = PRESETS[0], frames = cur.frames, amount = 100, fps = 12;
  const chips = h('div', { class: 'tex-chips' });
  const fr = numberSlider({ min: 2, max: 48, value: frames, onInput: v => { frames = v; } });
  for (const p of PRESETS) { const b = h('button', { type: 'button', class: 'btn tex-chip' + (p === cur ? ' on' : ''), 'data-p': p.id }, p.name); b.onclick = () => { cur = p; frames = p.frames; fr.set?.(frames); chips.querySelectorAll('.tex-chip').forEach(x => x.classList.toggle('on', x === b)); }; chips.append(b); }
  const tag = h('input', { type: 'text', placeholder: 'Por ejemplo: quieto, saltar', class: 'input' }) as HTMLInputElement;
  showDialog({
    title: 'Animaciones rápidas', okLabel: 'Crear fotogramas', width: 520,
    body: [h('div', { class: 'hint' }, `Anima la capa «${src.name}» con un movimiento típico de videojuego. Se crean los fotogramas a partir del actual; luego puedes retocar cada uno.`),
      chips, row('Fotogramas', fr.el), row('Intensidad', numberSlider({ min: 10, max: 200, value: amount, unit: '%', onInput: v => { amount = v; } }).el),
      row('Velocidad', numberSlider({ min: 2, max: 30, value: fps, unit: ' fps', onInput: v => { fps = v; } }).el), row('Nombre de la animación', tag)],
    onOk: () => {
      const start = isAnim(d) ? d.frameIndex + 1 : 0;
      if (!buildFrames(d, src, presetPoses(cur.id, frames, amount / 100, d.width, d.height), `Animación: ${cur.name}`, cur.pivot, Math.round(1000 / fps))) return;
      const name = tag.value.trim(); if (name) { for (let i = start; i < start + frames && i < d.frames.length; i++) (d.frames[i] as any).tag = name; d.commit('Etiquetar animación'); }
      app.toast(`${frames} fotogramas creados: pulsa reproducir para verlo`); app.emit('docs');
    },
  });
}

// ---- etiquetas e invertir --------------------------------------------------------------------------
export function tagDialog() {
  const d = app.doc; if (!d || !isAnim(d)) { app.toast('Primero crea una animación (Juegos › Barra de animación)', 'warn'); return; }
  const n = d.frames.length, cur = d.frameIndex + 1;
  let from = cur, to = cur;
  { const t = (d.frames[d.frameIndex] as any).tag; if (t) { from = d.frames.findIndex((f: any) => f.tag === t) + 1; to = n - [...d.frames].reverse().findIndex((f: any) => f.tag === t); } }
  const name = h('input', { type: 'text', class: 'input', value: (d.frames[d.frameIndex] as any).tag ?? '', list: 'pc-tags' }) as HTMLInputElement;
  const dl = h('datalist', { id: 'pc-tags' }, ...['quieto', 'andar', 'correr', 'saltar', 'caer', 'atacar', 'herido', 'morir'].map(v => h('option', { value: v })));
  const list = h('div', { class: 'hint' });
  const used = [...new Set(d.frames.map((f: any) => f.tag).filter(Boolean))];
  list.textContent = used.length ? 'Animaciones: ' + used.join(', ') : 'Aún no hay ninguna animación con nombre.';
  showDialog({
    title: 'Nombre de animación', okLabel: 'Guardar', width: 440,
    body: [h('div', { class: 'hint' }, 'Pon nombre a un grupo de fotogramas (andar, saltar…). En la hoja de sprites se guardan como etiquetas, igual que en Aseprite, y Godot, Phaser o Unity las leen como animaciones separadas. Deja el nombre vacío para quitarlo.'),
      row('Nombre', name, dl), row('Desde el fotograma', numberSlider({ min: 1, max: n, value: from, onInput: v => { from = v; } }).el), row('Hasta el fotograma', numberSlider({ min: 1, max: n, value: to, onInput: v => { to = v; } }).el), list],
    onOk: () => {
      const a = Math.min(from, to) - 1, b = Math.max(from, to) - 1, v = name.value.trim();
      for (let i = a; i <= b; i++) { if (v) (d.frames[i] as any).tag = v; else delete (d.frames[i] as any).tag; }
      d.commit(v ? `Animación «${v}»` : 'Quitar nombre de animación'); app.emit('docs');
    },
  });
}
export function reverseFrames() {
  const d = app.doc; if (!d || d.frames.length < 2) { app.toast('Hacen falta al menos dos fotogramas', 'warn'); return; }
  d.frames.reverse(); applyFrame(d, d.frames.length - 1 - d.frameIndex); d.commit('Invertir fotogramas'); app.emit('docs');
}

// ---- ajustar a la paleta -----------------------------------------------------------------------------
const BAYER8 = (() => { const m = [[0, 2], [3, 1]]; let b = m; for (let n = 2; n < 8; n *= 2) { const r: number[][] = []; for (let y = 0; y < n * 2; y++) { r.push([]); for (let x = 0; x < n * 2; x++) r[y].push(4 * b[y % n][x % n] + m[Math.floor(y / n)][Math.floor(x / n)]); } b = r; } return b.map(r => r.map(v => (v + 0.5) / 64)); })();
const hex2 = (c: string) => { const n = parseInt(c.slice(1, 7), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
/** Cambia cada píxel al color más parecido de la paleta: 'none' sin tramado, 'ordered' con trama regular, 'diffusion' con difusión de error. */
export function snapToPalette(c: HTMLCanvasElement, colors: string[], dither: string, strength = 1, alphaCut = true) {
  const pal = colors.map(hex2); if (!pal.length) return;
  const x = ctx2d(c), img = x.getImageData(0, 0, c.width, c.height), D = img.data, W = c.width, H = c.height;
  const err = dither === 'diffusion' ? new Float32Array(W * H * 3) : null;
  const near = (r: number, g: number, b: number) => { let bi = 0, bd = 1e12; for (let i = 0; i < pal.length; i++) { const p = pal[i], dr = p[0] - r, dg = p[1] - g, db = p[2] - b, dd = 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db; if (dd < bd) { bd = dd; bi = i; } } return pal[bi]; };
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    const k = y * W + xx, i = k * 4; if (!D[i + 3]) continue;
    if (alphaCut) D[i + 3] = D[i + 3] < 128 ? 0 : 255;
    if (!D[i + 3]) continue;
    let r = D[i], g = D[i + 1], b = D[i + 2];
    if (err) { r += err[k * 3]; g += err[k * 3 + 1]; b += err[k * 3 + 2]; }
    if (dither === 'ordered') { const o = (BAYER8[y % 8][xx % 8] - 0.5) * 64 * strength; r += o; g += o; b += o; }
    const p = near(r, g, b);
    if (err) {
      const er = (r - p[0]) * strength, eg = (g - p[1]) * strength, eb = (b - p[2]) * strength;
      const add = (dx: number, dy: number, w: number) => { const X = xx + dx, Y = y + dy; if (X < 0 || X >= W || Y >= H) return; const j = (Y * W + X) * 3; err[j] += er * w; err[j + 1] += eg * w; err[j + 2] += eb * w; };
      add(1, 0, 7 / 16); add(-1, 1, 3 / 16); add(0, 1, 5 / 16); add(1, 1, 1 / 16);
    }
    D[i] = p[0]; D[i + 1] = p[1]; D[i + 2] = p[2];
  }
  x.putImageData(img, 0, 0);
}
export function snapDialog() {
  const d = app.doc, l = d?.activeRaster(); if (!d || !l) { app.toast('Elige una capa de píxeles', 'warn'); return; }
  const pal = currentPalette(); if (!pal.colors.length) { app.toast('La paleta elegida está vacía', 'warn'); return; }
  const dith = sel([['none', 'Sin tramado (colores planos)'], ['ordered', 'Tramado regular (clásico de 8 y 16 bits)'], ['diffusion', 'Difusión (más suave, tipo foto)']], 'none');
  let strength = 100; const cut = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const sw = h('div', { class: 'gd-swatches' }, ...pal.colors.map(c => h('span', { class: 'gd-sw', style: `background:${c}`, title: c })));
  showDialog({
    title: 'Ajustar a la paleta', okLabel: 'Aplicar', width: 460,
    body: [h('div', { class: 'hint' }, `Cambia los colores de la capa «${l.name}» por los de la paleta «${pal.name}». Útil para convertir una foto o un dibujo en pixel art o para que todos los sprites usen los mismos colores.`), sw,
      row('Tramado', dith), row('Fuerza del tramado', numberSlider({ min: 0, max: 100, value: strength, unit: '%', onInput: v => { strength = v; } }).el),
      h('label', { class: 'check' }, cut, ' Sin semitransparencias (cada píxel, lleno o vacío)')],
    onOk: () => { snapToPalette(l.canvas, pal.colors, dith.value, strength / 100, cut.checked); l.touch(); d.invalidate(); d.commit('Ajustar a la paleta'); },
  });
}

// ---- rampas de color -----------------------------------------------------------------------------------
const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
function rgb2hsl(r: number, g: number, b: number) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let hh = 0, s = 0; if (mx !== mn) { const dd = mx - mn; s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn); hh = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4; hh *= 60; } return [hh, s, l]; }
function hsl2hex(hh: number, s: number, l: number) { hh = ((hh % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l)); const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((hh / 60) % 2 - 1)), m = l - c / 2; const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x]; return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255); }
/** Rampa de sombras a luces: las sombras giran hacia el azul o violeta y las luces hacia el amarillo, como en el pixel art profesional. */
export function colorRamp(base: string, steps: number, hueShift: number, satShift: number) {
  const [hh, s, l] = rgb2hsl(...(hex2(base) as [number, number, number])), out: string[] = [], mid = (steps - 1) / 2;
  // hacia las sombras: el tono se acerca al azul (240), hacia las luces al amarillo (60)
  const toward = (from: number, target: number, amt: number) => { let dd = ((target - from + 540) % 360) - 180; return from + Math.sign(dd) * Math.min(Math.abs(dd), amt); };
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : (i - mid) / Math.max(1, mid); // -1 sombra … 1 luz
    const hue = t < 0 ? toward(hh, 240, -t * hueShift) : toward(hh, 60, t * hueShift);
    const ll = t < 0 ? l + (l * 0.85) * t : l + ((1 - l) * 0.8) * t, ss = s * (1 - Math.abs(t) * 0.2) + satShift * (1 - Math.abs(t));
    out.push(hsl2hex(hue, ss, Math.max(0.03, Math.min(0.97, ll))));
  }
  return out;
}
export function rampDialog() {
  let steps = 5, shift = 25, sat = 10; const col = h('input', { type: 'color', value: app.fg.slice(0, 7), class: 'color-input' }) as HTMLInputElement;
  const pv = h('div', { class: 'gd-swatches ramp' });
  const upd = () => { pv.replaceChildren(...colorRamp(col.value, steps, shift, sat / 100).map(c => { const b = h('button', { type: 'button', class: 'gd-sw big', style: `background:${c}`, title: c, 'aria-label': c }); b.onclick = () => app.setColors(c, app.bg); return b; })); };
  col.oninput = upd; upd();
  const add = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  showDialog({
    title: 'Rampa de color', okLabel: 'Guardar en Mis colores', width: 460,
    body: [h('div', { class: 'hint' }, 'Crea los tonos de sombra a luz de un color. Las sombras giran un poco hacia el azul y las luces hacia el amarillo: así el pixel art se ve con más vida que oscureciendo con negro. Toca un tono para pintar con él.'),
      row('Color base', col), row('Tonos', numberSlider({ min: 3, max: 9, value: steps, onInput: v => { steps = v; upd(); } }).el),
      row('Giro de tono', numberSlider({ min: 0, max: 60, value: shift, unit: '°', onInput: v => { shift = v; upd(); } }).el),
      row('Saturación', numberSlider({ min: -30, max: 40, value: sat, unit: '%', onInput: v => { sat = v; upd(); } }).el), pv,
      h('label', { class: 'check' }, add, ' Añadir a los que ya tengo (si no, los sustituye)')],
    onOk: () => { setMyColors(colorRamp(col.value, steps, shift, sat / 100), add.checked); app.toast('Guardado en «Mis colores» (paleta del pixel art)'); },
  });
}

// ---- ampliar pixel art -------------------------------------------------------------------------------------
/** Scale2x (EPX): dobla el tamaño redondeando las diagonales en vez de hacer escalones gordos. */
export function scale2x(src: HTMLCanvasElement) {
  const W = src.width, H = src.height, s = ctx2d(src).getImageData(0, 0, W, H).data, out = makeCanvas(W * 2, H * 2), o = ctx2d(out), img = o.createImageData(W * 2, H * 2), D = new Uint32Array(img.data.buffer), S = new Uint32Array(s.buffer.slice(0));
  const at = (x: number, y: number) => S[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const P = at(x, y), A = at(x, y - 1), B = at(x + 1, y), C = at(x - 1, y), Dd = at(x, y + 1);
    let e0 = P, e1 = P, e2 = P, e3 = P;
    if (A !== Dd && C !== B) { if (C === A) e0 = C; if (A === B) e1 = B; if (C === Dd) e2 = C; if (Dd === B) e3 = B; }
    const i = y * 2 * W * 2 + x * 2; D[i] = e0; D[i + 1] = e1; D[i + W * 2] = e2; D[i + W * 2 + 1] = e3;
  }
  o.putImageData(img, 0, 0); return out;
}
function nearestScale(src: HTMLCanvasElement, w: number, h: number) { const c = makeCanvas(w, h), x = ctx2d(c); x.imageSmoothingEnabled = false; x.drawImage(src, 0, 0, w, h); return c; }
export function scalePixelDoc(d: EditorDocument, method: string, k: number) {
  const w = Math.max(1, Math.round(d.width * k)), hh = Math.max(1, Math.round(d.height * k));
  if (w * hh > Math.min(maxCanvasPixels(), 64e6)) { app.toast('El resultado sería demasiado grande', 'warn'); return; }
  const fn = method === 'scale2x' ? (c: HTMLCanvasElement) => { let r = c; for (let f = 1; f < k; f *= 2) r = scale2x(r); return r.width === w ? r : nearestScale(r, w, hh); } : (c: HTMLCanvasElement) => nearestScale(c, w, hh);
  d.resample(w, hh, fn); d.commit(method === 'scale2x' ? `Scale2x ×${k}` : `Ampliar píxeles ×${k}`);
}
export function scalePixelDialog() {
  const d = app.doc; if (!d) return;
  const m = sel([['nearest', 'Píxeles nítidos (cada píxel, un cuadrado)'], ['scale2x', 'Scale2x (suaviza las diagonales)']], 'nearest');
  const k = sel([['0.5', '× ½ (reducir)'], ['2', '× 2'], ['3', '× 3'], ['4', '× 4'], ['8', '× 8']], '2');
  const info = h('div', { class: 'hint' }); const upd = () => { info.textContent = `${d.width} × ${d.height} → ${Math.round(d.width * +k.value)} × ${Math.round(d.height * +k.value)} px`; if (m.value === 'scale2x' && (+k.value < 2 || +k.value === 3)) k.value = '2'; };
  m.onchange = upd; k.onchange = upd; upd();
  showDialog({ title: 'Ampliar pixel art', okLabel: 'Ampliar', width: 440, body: [h('div', { class: 'hint' }, 'Cambia el tamaño de la imagen sin que los píxeles se vean borrosos.'), row('Método', m), row('Tamaño', k), info], onOk: () => scalePixelDoc(d, m.value, +k.value) });
}

// ---- degradado tramado ---------------------------------------------------------------------------------------
export function ditherGradient(W: number, H: number, c1: string, c2: string, dir: string, levels: number, mask?: HTMLCanvasElement | null) {
  const out = makeCanvas(W, H), x = ctx2d(out), img = x.createImageData(W, H), D = img.data, A = hex2(c1), B = hex2(c2);
  const mk = mask ? ctx2d(mask).getImageData(0, 0, W, H).data : null;
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    const i = (y * W + xx) * 4; if (mk && mk[i + 3] < 128) continue;
    let t = dir === 'h' ? xx / Math.max(1, W - 1) : dir === 'v' ? y / Math.max(1, H - 1) : Math.min(1, Math.hypot(xx - W / 2, y - H / 2) / (Math.hypot(W, H) / 2));
    // cuantizado en «levels» escalones con trama entre escalón y escalón
    const f = t * (levels - 1), lo = Math.floor(f), q = (f - lo) > BAYER8[y % 8][xx % 8] ? lo + 1 : lo; t = Math.min(1, q / Math.max(1, levels - 1));
    D[i] = A[0] + (B[0] - A[0]) * t; D[i + 1] = A[1] + (B[1] - A[1]) * t; D[i + 2] = A[2] + (B[2] - A[2]) * t; D[i + 3] = 255;
  }
  x.putImageData(img, 0, 0); return out;
}
export function ditherGradientDialog() {
  const d = app.doc; if (!d) return;
  const c1 = h('input', { type: 'color', value: app.fg.slice(0, 7), class: 'color-input' }) as HTMLInputElement, c2 = h('input', { type: 'color', value: app.bg.slice(0, 7), class: 'color-input' }) as HTMLInputElement;
  const dir = sel([['v', 'De arriba abajo (cielos)'], ['h', 'De izquierda a derecha'], ['r', 'Desde el centro']], 'v');
  let levels = 4;
  showDialog({
    title: 'Degradado tramado', okLabel: 'Crear', width: 440,
    body: [h('div', { class: 'hint' }, 'Un degradado con pocos colores mezclados en trama, como en los juegos clásicos (cielos, atardeceres, luces). Va en una capa nueva; si hay selección, solo dentro de ella.'),
      row('Color 1', c1), row('Color 2', c2), row('Dirección', dir), row('Escalones', numberSlider({ min: 2, max: 16, value: levels, onInput: v => { levels = v; } }).el)],
    onOk: () => {
      const g = ditherGradient(d.width, d.height, c1.value, c2.value, dir.value, levels, d.selection.mask);
      const l = new RasterLayer('Degradado tramado', d.width, d.height); ctx2d(l.canvas).drawImage(g, 0, 0); d.insertAboveActive(l); d.setActive(l, false); d.invalidate(); d.commit('Degradado tramado'); app.emit('docs');
    },
  });
}

// ---- iconos en todos los tamaños -------------------------------------------------------------------------------
async function pngBytes(c: HTMLCanvasElement) { return new Uint8Array(await (await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/png'))).arrayBuffer()); }
export function icoFile(pngs: { size: number; data: Uint8Array }[]) {
  const head = 6 + 16 * pngs.length, total = head + pngs.reduce((a, p) => a + p.data.length, 0), b = new Uint8Array(total), v = new DataView(b.buffer);
  v.setUint16(2, 1, true); v.setUint16(4, pngs.length, true); let off = head;
  pngs.forEach((p, i) => { const e = 6 + i * 16; b[e] = p.size >= 256 ? 0 : p.size; b[e + 1] = p.size >= 256 ? 0 : p.size; v.setUint16(e + 4, 1, true); v.setUint16(e + 6, 32, true); v.setUint32(e + 8, p.data.length, true); v.setUint32(e + 12, off, true); b.set(p.data, off); off += p.data.length; });
  return b;
}
export async function buildIconSet(src: HTMLCanvasElement, opts: { pixel: boolean; bg: string | null; margin: number; round: number }) {
  const S = Math.max(src.width, src.height);
  const make = (n: number, safe = 1) => {
    const c = makeCanvas(n, n), x = ctx2d(c);
    if (opts.bg) { x.fillStyle = opts.bg; if (opts.round > 0) { x.beginPath(); (x as any).roundRect(0, 0, n, n, n * opts.round); x.fill(); } else x.fillRect(0, 0, n, n); }
    const inner = n * (1 - opts.margin) * safe, k = opts.pixel && inner >= S ? Math.floor(inner / S) : inner / S, w = src.width * k, hh = src.height * k;
    x.imageSmoothingEnabled = !opts.pixel || k < 1; x.imageSmoothingQuality = 'high';
    let dx = (n - w) / 2, dy = (n - hh) / 2; if (opts.pixel && k >= 1) { dx = Math.round(dx); dy = Math.round(dy); }
    x.drawImage(src, dx, dy, opts.pixel && k >= 1 ? Math.round(w) : w, opts.pixel && k >= 1 ? Math.round(hh) : hh); return c;
  };
  const files: { name: string; data: Uint8Array }[] = [];
  for (const [dir, n] of [['mipmap-mdpi', 48], ['mipmap-hdpi', 72], ['mipmap-xhdpi', 96], ['mipmap-xxhdpi', 144], ['mipmap-xxxhdpi', 192]] as [string, number][]) {
    files.push({ name: `android/${dir}/ic_launcher.png`, data: await pngBytes(make(n)) });
    files.push({ name: `android/${dir}/ic_launcher_foreground.png`, data: await pngBytes(make(Math.round(n * 108 / 48), 0.61)) });
  }
  files.push({ name: 'android/play-store-512.png', data: await pngBytes(make(512)) });
  for (const n of [180, 167, 152, 120, 1024]) files.push({ name: `ios/icon-${n}.png`, data: await pngBytes(make(n)) });
  for (const n of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) files.push({ name: `png/icon-${n}.png`, data: await pngBytes(make(n)) });
  for (const n of [192, 512]) files.push({ name: `web/icon-${n}.png`, data: await pngBytes(make(n)) });
  const ico = []; for (const n of [16, 32, 48, 256]) ico.push({ size: n, data: await pngBytes(make(n)) });
  files.push({ name: 'web/favicon.ico', data: icoFile(ico) }); files.push({ name: 'windows/icon.ico', data: icoFile(ico) });
  files.push({ name: 'steam/capsule-icon-184.png', data: await pngBytes(make(184)) }); files.push({ name: 'itch/cover-630x500.png', data: await pngBytes((() => { const c = makeCanvas(630, 500), x = ctx2d(c); if (opts.bg) { x.fillStyle = opts.bg; x.fillRect(0, 0, 630, 500); } const ic = make(440); x.drawImage(ic, 95, 30); return c; })()) });
  return files;
}
export function iconSetDialog() {
  const d = app.doc; if (!d) return;
  const pix = h('input', { type: 'checkbox', checked: !!d.meta.pixelArt }) as HTMLInputElement;
  const useBg = h('input', { type: 'checkbox' }) as HTMLInputElement, bg = h('input', { type: 'color', value: '#ffffff', class: 'color-input' }) as HTMLInputElement;
  let margin = 8, round = 0;
  showDialog({
    title: 'Iconos para el juego o la app', okLabel: 'Crear ZIP', width: 460,
    body: [h('div', { class: 'hint' }, 'Crea de una vez el icono en todos los tamaños: Android (todas las densidades y el de Google Play), iPhone, web (favicon), Windows (.ico), Steam e itch.io.'),
      h('label', { class: 'check' }, pix, ' Pixel art (ampliar sin suavizar)'), h('label', { class: 'check' }, useBg, ' Fondo de color '), row('Color de fondo', bg),
      row('Margen', numberSlider({ min: 0, max: 30, value: margin, unit: '%', onInput: v => { margin = v; } }).el), row('Esquinas redondeadas', numberSlider({ min: 0, max: 50, value: round, unit: '%', onInput: v => { round = v; } }).el)],
    onOk: async () => {
      const files = await buildIconSet(d.flatten(), { pixel: pix.checked, bg: useBg.checked ? bg.value : null, margin: margin / 100, round: round / 100 });
      const { makeZip } = await import('../io/zip'), io = await import('../io/files');
      try { await io.saveBlob(makeZip(files), `${d.name}-iconos.zip`); app.toast(`${files.length} iconos creados`); } catch (e: any) { if (e?.name !== 'AbortError') app.toast(String(e?.message ?? e), 'warn'); }
    },
  });
}
