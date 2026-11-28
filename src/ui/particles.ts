// Generador de partículas para juegos: explosión, fuego, humo, chispas, magia, lluvia, nieve, impacto, burbujas, hojas y
// confeti. La simulación es determinista (misma semilla, mismo resultado) y los efectos continuos se repiten sin salto:
// cada partícula nace en un momento del ciclo y se dibuja también en las vueltas anteriores, así el último fotograma
// enlaza con el primero. Sale como animación (y de ahí a GIF, vídeo u hoja de sprites), también en pixel art.
import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog } from './dialog';
import { ctx2d, makeCanvas } from '../core/canvas';
import { RasterLayer } from '../core/layers';
import { EditorDocument } from '../core/document';
import { t } from '../i18n/i18n';

export type PShape = 'soft' | 'spark' | 'star' | 'square' | 'smoke' | 'drop' | 'leaf' | 'bubble' | 'confetti' | 'image';
export type PFX = {
  id: string; name: string; loop: boolean; count: number; life: [number, number]; speed: [number, number]; angle: number; spread: number;
  gravity: number; drag: number; size: [number, number]; grow: number; shape: PShape; colors: string[]; glow: boolean;
  emitter: 'point' | 'line' | 'area' | 'top'; spin?: number; wobble?: number; burst?: boolean;
  /** dibujo propio como partícula (PNG en data URL) y si se tiñe con los colores del efecto */ sprite?: string; tint?: boolean; mine?: boolean;
};
export const FX: PFX[] = [
  { id: 'explosion', name: 'Explosión', loop: false, burst: true, count: 70, life: [0.35, 0.9], speed: [0.35, 1.1], angle: -90, spread: 360, gravity: 0.25, drag: 2.2, size: [0.05, 0.11], grow: 0.6, shape: 'soft', colors: ['#fff6c8', '#ffb43a', '#e84a1a', '#4a3a36'], glow: true, emitter: 'point' },
  { id: 'fire', name: 'Fuego', loop: true, count: 60, life: [0.5, 1], speed: [0.25, 0.5], angle: -90, spread: 28, gravity: -0.15, drag: 0.6, size: [0.07, 0.13], grow: -0.7, shape: 'soft', colors: ['#fff3b0', '#ffb03a', '#f0501e', '#7a1a10'], glow: true, emitter: 'line', wobble: 0.05 },
  { id: 'smoke', name: 'Humo', loop: true, count: 26, life: [1.2, 2], speed: [0.12, 0.25], angle: -90, spread: 30, gravity: -0.05, drag: 0.4, size: [0.08, 0.13], grow: 1.6, shape: 'smoke', colors: ['#8a8a90', '#5a5a60', '#3a3a40'], glow: false, emitter: 'line', wobble: 0.06 },
  { id: 'sparks', name: 'Chispas', loop: true, count: 45, life: [0.3, 0.7], speed: [0.5, 1.1], angle: -90, spread: 120, gravity: 1.4, drag: 0.5, size: [0.012, 0.022], grow: -0.5, shape: 'spark', colors: ['#ffffff', '#ffe27a', '#ff9a2a'], glow: true, emitter: 'point' },
  { id: 'magic', name: 'Magia', loop: true, count: 40, life: [0.6, 1.2], speed: [0.05, 0.25], angle: -90, spread: 360, gravity: -0.1, drag: 1, size: [0.03, 0.06], grow: -0.6, shape: 'star', colors: ['#ffffff', '#c6a8ff', '#6fd7ff', '#7a4dff'], glow: true, emitter: 'area', spin: 2 },
  { id: 'rain', name: 'Lluvia', loop: true, count: 70, life: [0.45, 0.6], speed: [1.6, 2], angle: 100, spread: 2, gravity: 0, drag: 0, size: [0.035, 0.05], grow: 0, shape: 'drop', colors: ['#bcd8ff', '#8fb6e8'], glow: false, emitter: 'top' },
  { id: 'snow', name: 'Nieve', loop: true, count: 70, life: [3, 3.8], speed: [0.3, 0.45], angle: 95, spread: 15, gravity: 0, drag: 0, size: [0.012, 0.028], grow: 0, shape: 'soft', colors: ['#ffffff', '#e8f2ff'], glow: false, emitter: 'top', wobble: 0.08 },
  { id: 'hit', name: 'Impacto', loop: false, burst: true, count: 22, life: [0.15, 0.4], speed: [0.7, 1.4], angle: -90, spread: 360, gravity: 0, drag: 3, size: [0.015, 0.03], grow: -0.4, shape: 'spark', colors: ['#ffffff', '#fff3a0', '#ffd23a'], glow: true, emitter: 'point' },
  { id: 'bubbles', name: 'Burbujas', loop: true, count: 18, life: [1.2, 2], speed: [0.15, 0.3], angle: -90, spread: 10, gravity: -0.05, drag: 0.2, size: [0.03, 0.07], grow: 0.2, shape: 'bubble', colors: ['#d8f4ff', '#8fd8ff'], glow: false, emitter: 'line', wobble: 0.05 },
  { id: 'leaves', name: 'Hojas', loop: true, count: 14, life: [2.2, 3], speed: [0.25, 0.35], angle: 80, spread: 25, gravity: 0, drag: 0, size: [0.04, 0.06], grow: 0, shape: 'leaf', colors: ['#d8902a', '#b85a1a', '#e0b030', '#7a9a2a'], glow: false, emitter: 'top', spin: 3, wobble: 0.12 },
  { id: 'confetti', name: 'Confeti', loop: false, burst: true, count: 80, life: [1.2, 2], speed: [0.5, 1.1], angle: -90, spread: 70, gravity: 0.7, drag: 1.4, size: [0.02, 0.035], grow: 0, shape: 'confetti', colors: ['#ff4d6d', '#ffd23a', '#3ddc84', '#3d8bfd', '#c56bff'], glow: false, emitter: 'point', spin: 6, wobble: 0.04 },
];

const hash = (i: number, k: number, seed: number) => { let x = Math.imul(i * 374761393 + k * 668265263 + seed * 2147483647, 1274126177); x ^= x >>> 13; x = Math.imul(x, 1103515245); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const hex = (c: string) => { const n = parseInt(c.slice(1, 7), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
function colorAt(cols: string[], t: number) { const k = Math.max(0, Math.min(0.9999, t)) * (cols.length - 1), i = Math.floor(k), f = k - i, a = hex(cols[i]), b = hex(cols[Math.min(cols.length - 1, i + 1)]); return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)]; }

/** Dibujos propios ya cargados (por su data URL), para poder pintarlos sin esperar. */
export const spriteCache = new Map<string, HTMLCanvasElement>();
export function loadSprite(url: string): Promise<HTMLCanvasElement> {
  const c = spriteCache.get(url); if (c) return Promise.resolve(c);
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => { const cv = makeCanvas(im.naturalWidth, im.naturalHeight); ctx2d(cv).drawImage(im, 0, 0); spriteKey.set(cv, ++spriteN); spriteCache.set(url, cv); res(cv); }; im.onerror = () => rej(new Error('No se puede leer el dibujo')); im.src = url; });
}
const tintCache = new Map<string, HTMLCanvasElement>();
/** El dibujo teñido de un color, conservando sus luces y sombras. */
function tinted(src: HTMLCanvasElement, col: string) {
  const key = src.width + 'x' + src.height + ':' + col + ':' + (spriteKey.get(src) ?? ''); let c = tintCache.get(key); if (c) return c;
  c = makeCanvas(src.width, src.height); const x = ctx2d(c); x.drawImage(src, 0, 0); x.globalCompositeOperation = 'multiply'; x.fillStyle = col; x.fillRect(0, 0, c.width, c.height); x.globalCompositeOperation = 'destination-in'; x.drawImage(src, 0, 0);
  if (tintCache.size > 400) tintCache.clear(); tintCache.set(key, c); return c;
}
const spriteKey = new WeakMap<HTMLCanvasElement, number>(); let spriteN = 0;
/** Recorta lo dibujado de una capa y lo reduce (máx. 128 px) para usarlo como partícula. */
export function spriteFromCanvas(c: HTMLCanvasElement): string | null {
  const x = ctx2d(c), D = x.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) if (D[(y * c.width + xx) * 4 + 3] > 8) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, hh = y1 - y0 + 1, k = Math.min(1, 128 / Math.max(w, hh)), out = makeCanvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(hh * k))), o = ctx2d(out);
  o.imageSmoothingQuality = 'high'; o.drawImage(c, x0, y0, w, hh, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}
// ---- mis efectos ---------------------------------------------------------------------------------------
const MY = 'editor.myFx';
export function myEffects(): PFX[] { try { const v = JSON.parse(localStorage.getItem(MY) || '[]'); return Array.isArray(v) ? v.filter(e => e && typeof e.id === 'string' && Array.isArray(e.colors)) : []; } catch { return []; } }
export function saveMyEffects(list: PFX[]) { try { localStorage.setItem(MY, JSON.stringify(list)); return true; } catch { app.toast('No hay sitio para guardar más efectos (quita alguno o usa dibujos más pequeños)', 'warn'); return false; } }
/** Comprueba y completa un efecto que viene de un archivo (por si le faltan datos o vienen valores raros). */
export function sanitizeFx(e: any): PFX | null {
  if (!e || typeof e !== 'object') return null;
  const num = (v: any, d: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  const pair = (v: any, d: [number, number], lo: number, hi: number): [number, number] => Array.isArray(v) ? [num(v[0], d[0], lo, hi), num(v[1], d[1], lo, hi)] : d;
  const shapes = ['soft', 'spark', 'star', 'square', 'smoke', 'drop', 'leaf', 'bubble', 'confetti', 'image'], ems = ['point', 'line', 'area', 'top'];
  const colors = Array.isArray(e.colors) ? e.colors.filter((c: any) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).slice(0, 8) : [];
  const sprite = typeof e.sprite === 'string' && e.sprite.startsWith('data:image/') && e.sprite.length < 400000 ? e.sprite : undefined;
  return {
    id: typeof e.id === 'string' ? e.id.slice(0, 40) : 'mio-' + Date.now(), name: String(e.name ?? 'Mi efecto').slice(0, 40), loop: !!e.loop, burst: !!e.burst, mine: true,
    count: num(e.count, 40, 1, 400), life: pair(e.life, [0.5, 1], 0.05, 10), speed: pair(e.speed, [0.2, 0.5], 0, 5), angle: num(e.angle, -90, -360, 360), spread: num(e.spread, 60, 0, 360),
    gravity: num(e.gravity, 0, -5, 5), drag: num(e.drag, 0, 0, 10), size: pair(e.size, [0.03, 0.06], 0.002, 1), grow: num(e.grow, 0, -1, 5),
    shape: (shapes.includes(e.shape) ? e.shape : 'soft') as PShape, colors: colors.length ? colors : ['#ffffff'], glow: !!e.glow,
    emitter: (ems.includes(e.emitter) ? e.emitter : 'point') as PFX['emitter'], spin: num(e.spin, 0, -20, 20), wobble: num(e.wobble, 0, 0, 1), sprite: sprite, tint: !!e.tint,
  };
}

export type PSettings = { fx: PFX; W: number; H: number; frames: number; fps: number; seed: number; amount: number; scale: number; pixel: boolean };
/** Dibuja el fotograma f (de 0 a frames-1). */
export function particleFrame(s: PSettings, f: number): HTMLCanvasElement {
  const { fx, W, H } = s, c = makeCanvas(W, H), x = ctx2d(c), S = Math.min(W, H), dur = s.frames / s.fps, tNow = f / s.fps;
  const n = Math.max(1, Math.round(fx.count * s.amount));
  if (fx.glow && !s.pixel) x.globalCompositeOperation = 'lighter';
  x.imageSmoothingEnabled = !s.pixel;
  for (let i = 0; i < n; i++) {
    const r = (k: number) => hash(i, k, s.seed);
    const life = lerp(fx.life[0], fx.life[1], r(1));
    // ráfaga: todas nacen casi a la vez; continuo: repartidas por el ciclo (y se miran las vueltas anteriores)
    const born = fx.burst ? r(2) * 0.06 : r(2) * dur;
    for (let lap = 0; lap <= (fx.loop ? Math.ceil(life / dur) : 0); lap++) {
      const age = tNow - (born - lap * dur); if (age < 0 || age >= life) continue;
      const tt = age / life, ang = (fx.angle + (r(3) - 0.5) * fx.spread) * Math.PI / 180, sp = lerp(fx.speed[0], fx.speed[1], r(4)) * S * s.scale;
      // posición con rozamiento (velocidad que decae) y gravedad
      const dk = fx.drag ? (1 - Math.exp(-fx.drag * age)) / fx.drag : age;
      let ex = W / 2, ey = fx.burst ? H * 0.5 : H * 0.62;
      if (fx.emitter === 'line') { ex = W / 2 + (r(5) - 0.5) * S * 0.3; ey = H * 0.85; }
      else if (fx.emitter === 'area') { ex = W / 2 + (r(5) - 0.5) * S * 0.55; ey = H / 2 + (r(6) - 0.5) * S * 0.55; }
      else if (fx.emitter === 'top') { ex = r(5) * W * 1.3 - W * 0.15; ey = -S * 0.08; }
      let px = ex + Math.cos(ang) * sp * dk, py = ey + Math.sin(ang) * sp * dk + 0.5 * fx.gravity * S * s.scale * age * age;
      if (fx.wobble) px += Math.sin(age * 5 + r(7) * 6.28) * fx.wobble * S;
      const size = Math.max(0.5, lerp(fx.size[0], fx.size[1], r(8)) * S * s.scale * (1 + fx.grow * tt));
      const fade = fx.shape === 'smoke' ? Math.sin(Math.PI * Math.min(1, tt * 1.2)) * 0.55 : tt < 0.08 ? tt / 0.08 : 1 - Math.pow(tt, 2.2);
      const [cr, cg, cb] = colorAt(fx.colors, fx.colors.length > 2 ? tt : r(9)), col = (a: number) => `rgba(${cr | 0},${cg | 0},${cb | 0},${Math.max(0, Math.min(1, a))})`;
      const rot = (fx.spin ?? 0) * age * (r(10) - 0.5) * 2 + r(11) * 6.28;
      x.save(); x.translate(px, py);
      switch (fx.shape) {
        case 'soft': case 'smoke': {
          if (s.pixel) { x.fillStyle = col(fade); x.beginPath(); x.arc(0, 0, size * 0.6, 0, 7); x.fill(); break; }
          const g = x.createRadialGradient(0, 0, 0, 0, 0, size); g.addColorStop(0, col(fade)); g.addColorStop(fx.shape === 'smoke' ? 0.55 : 0.4, col(fade * 0.55)); g.addColorStop(1, col(0)); x.fillStyle = g; x.fillRect(-size, -size, size * 2, size * 2); break;
        }
        case 'spark': { const vx = Math.cos(ang), vy = Math.sin(ang) + fx.gravity * age * 0.8, L = Math.hypot(vx, vy) || 1, len = size * 5 * (1 - tt * 0.5); x.strokeStyle = col(fade); x.lineWidth = Math.max(1, size * 0.8); x.lineCap = s.pixel ? 'butt' : 'round'; x.beginPath(); x.moveTo(0, 0); x.lineTo(-vx / L * len, -vy / L * len); x.stroke(); break; }
        case 'star': { x.rotate(rot); x.fillStyle = col(fade); x.beginPath(); for (let k = 0; k < 8; k++) { const rr = k % 2 ? size * 0.35 : size; x.lineTo(Math.cos(k * Math.PI / 4) * rr, Math.sin(k * Math.PI / 4) * rr); } x.closePath(); x.fill(); break; }
        case 'square': x.fillStyle = col(fade); x.fillRect(-size / 2, -size / 2, size, size); break;
        case 'drop': { const a2 = ang; x.rotate(a2); x.strokeStyle = col(0.75); x.lineWidth = Math.max(1, size * 0.12); x.beginPath(); x.moveTo(-size, 0); x.lineTo(size, 0); x.stroke(); break; }
        case 'leaf': { x.rotate(rot); x.scale(1, Math.abs(Math.cos(age * 3 + r(12) * 6))); x.fillStyle = col(fade); x.beginPath(); x.ellipse(0, 0, size, size * 0.45, 0, 0, 7); x.fill(); break; }
        case 'bubble': { x.strokeStyle = col(fade * 0.9); x.lineWidth = Math.max(1, size * 0.12); x.beginPath(); x.arc(0, 0, size * 0.5, 0, 7); x.stroke(); if (!s.pixel) { x.fillStyle = col(fade * 0.5); x.beginPath(); x.arc(-size * 0.18, -size * 0.18, size * 0.1, 0, 7); x.fill(); } break; }
        case 'image': {
          const sp = fx.sprite ? spriteCache.get(fx.sprite) : null; if (!sp) break;
          x.rotate(rot); const k2 = size * 2 / Math.max(sp.width, sp.height); x.globalAlpha = Math.max(0, Math.min(1, fade));
          const img = fx.tint ? tinted(sp, `rgb(${cr | 0},${cg | 0},${cb | 0})`) : sp;
          x.drawImage(img, -sp.width * k2 / 2, -sp.height * k2 / 2, sp.width * k2, sp.height * k2); x.globalAlpha = 1; break;
        }
        case 'confetti': { x.rotate(rot); x.scale(1, Math.abs(Math.cos(age * 6 + r(12) * 6))); x.fillStyle = col(Math.min(1, fade * 1.3)); x.fillRect(-size / 2, -size / 4, size, size / 2); break; }
      }
      x.restore();
    }
  }
  if (s.pixel) {
    // pixel art: sin semitransparencias y solo con los colores del efecto
    const pal = fx.colors.map(hex), im = x.getImageData(0, 0, W, H), D = im.data;
    for (let i = 0; i < D.length; i += 4) {
      if (D[i + 3] < 90) { D[i + 3] = 0; continue; }
      let bi = 0, bd = 1e9; for (let k = 0; k < pal.length; k++) { const p = pal[k], dd = (p[0] - D[i]) ** 2 + (p[1] - D[i + 1]) ** 2 + (p[2] - D[i + 2]) ** 2; if (dd < bd) { bd = dd; bi = k; } }
      D[i] = pal[bi][0]; D[i + 1] = pal[bi][1]; D[i + 2] = pal[bi][2]; D[i + 3] = 255;
    }
    x.putImageData(im, 0, 0);
  }
  return c;
}

export function particlesDialog() {
  let saved: any = {}; try { saved = JSON.parse(localStorage.getItem('editor.particles') || '{}'); } catch { /* */ }
  const all = () => [...FX, ...myEffects()];
  const start = all().find(f => f.id === saved.id) ?? FX[0];
  // se trabaja sobre una copia: los efectos de serie no se tocan; los propios se guardan al pulsar «Guardar»
  let fx: PFX = JSON.parse(JSON.stringify(start));
  const s: PSettings = { fx, W: saved.W ?? 128, H: saved.H ?? 128, frames: fx.loop ? 24 : 16, fps: 15, seed: 1, amount: 1, scale: 1, pixel: !!saved.pixel };
  const d = app.doc;
  const pv = h('canvas', { class: 'gd-pv pfx-pv' }) as HTMLCanvasElement;
  let f = 0, timer = 0;
  const tick = () => { if (!pv.isConnected && f > 0) return; const k = Math.max(1, Math.floor(Math.min(256 / s.W, 256 / s.H))), c = particleFrame({ ...s, fx }, f % s.frames); if (pv.width !== s.W * k || pv.height !== s.H * k) { pv.width = s.W * k; pv.height = s.H * k; } const x = ctx2d(pv); x.imageSmoothingEnabled = !s.pixel; x.fillStyle = '#16171a'; x.fillRect(0, 0, pv.width, pv.height); x.drawImage(c, 0, 0, pv.width, pv.height); f++; timer = window.setTimeout(tick, 1000 / s.fps); };
  const row = (l: string, ...e: (HTMLElement | null)[]) => h('div', { class: 'form-row' }, h('label', {}, l), ...e.filter(Boolean) as HTMLElement[]);
  const sel = (opts: [string, string][], v: string, on: (x: string) => void) => { const q = h('select', {}, ...opts.map(([a, b]) => h('option', { value: a }, b))) as HTMLSelectElement; q.value = v; q.onchange = () => on(q.value); return q; };
  const chk = (label: string, v: boolean, on: (x: boolean) => void) => { const i = h('input', { type: 'checkbox', checked: v }) as HTMLInputElement; i.onchange = () => on(i.checked); return h('label', { class: 'check' }, i, ' ' + label); };
  const sl = (min: number, max: number, v: number, unit: string, on: (x: number) => void, step = 1) => numberSlider({ min, max, step, value: v, unit, onInput: on }).el;
  // ---- lista de efectos (de serie y míos)
  const chips = h('div', { class: 'tex-chips' });
  const renderChips = () => chips.replaceChildren(...all().map(e => { const b = h('button', { type: 'button', class: 'btn tex-chip' + (e.id === fx.id ? ' on' : '') + (e.mine ? ' mine' : ''), 'data-fx': e.id, title: e.mine ? t('Mi efecto') : '' }, e.mine ? h('span', { class: 'no-i18n' }, e.name) : e.name); b.onclick = () => pick(e); return b; }));
  const pick = async (e: PFX) => { fx = JSON.parse(JSON.stringify(e)); s.fx = fx; s.frames = fx.loop ? 24 : 16; f = 0; if (fx.sprite) await loadSprite(fx.sprite).catch(() => {}); renderChips(); renderEdit(); };
  // ---- ajustes del efecto
  const edit = h('div', { class: 'pfx-edit' });
  const colorsRow = () => { const box = h('div', { class: 'pfx-colors' }); const draw = () => box.replaceChildren(...fx.colors.map((c, i) => { const inp = h('input', { type: 'color', value: c, class: 'color-input', 'aria-label': `${t('Color')} ${i + 1}` }) as HTMLInputElement; inp.oninput = () => { fx.colors[i] = inp.value; }; return inp; }),
    (() => { const b = h('button', { type: 'button', class: 'btn icon-btn', title: 'Añadir un color', 'aria-label': 'Añadir un color' }, '+'); b.onclick = () => { if (fx.colors.length < 8) { fx.colors.push(fx.colors[fx.colors.length - 1] ?? '#ffffff'); draw(); } }; return b; })(),
    (() => { const b = h('button', { type: 'button', class: 'btn icon-btn', title: 'Quitar el último color', 'aria-label': 'Quitar el último color' }, '−'); b.onclick = () => { if (fx.colors.length > 1) { fx.colors.pop(); draw(); } }; return b; })()); draw(); return box; };
  const spriteBox = h('div', { class: 'pfx-sprite' });
  const renderSprite = () => {
    const prev = fx.sprite ? h('img', { src: fx.sprite, class: 'pfx-sprite-img', alt: '' }) : h('span', { class: 'hint' }, t('Ninguno'));
    const fromLayer = h('button', { type: 'button', class: 'btn' }, 'Usar la capa actual'); fromLayer.disabled = !d?.activeRaster();
    fromLayer.onclick = async () => { const l = d?.activeRaster(); if (!l) return; const u = spriteFromCanvas(l.canvas); if (!u) { app.toast('La capa está vacía', 'warn'); return; } fx.sprite = u; fx.shape = 'image'; await loadSprite(u); renderEdit(); };
    const fromFile = h('button', { type: 'button', class: 'btn' }, 'Elegir imagen…');
    fromFile.onclick = async () => { const io = await import('../io/files'); const [file] = await io.pickFiles('image/*'); if (!file) return; const url = URL.createObjectURL(file); try { const c = await loadSprite(url); const u = spriteFromCanvas(c); spriteCache.delete(url); if (!u) { app.toast('La imagen está vacía', 'warn'); return; } fx.sprite = u; fx.shape = 'image'; await loadSprite(u); renderEdit(); } catch { app.toast('No se puede leer esta imagen', 'warn'); } finally { URL.revokeObjectURL(url); } };
    const del = h('button', { type: 'button', class: 'btn' }, 'Quitar'); del.disabled = !fx.sprite; del.onclick = () => { fx.sprite = undefined; if (fx.shape === 'image') fx.shape = 'soft'; renderEdit(); };
    spriteBox.replaceChildren(h('div', { class: 'pfx-sprite-row' }, prev, fromLayer, fromFile, del), fx.sprite ? chk('Teñir con los colores del efecto', !!fx.tint, v => { fx.tint = v; }) : null as any);
  };
  const SHAPES: [string, string][] = [['soft', 'Bola suave'], ['smoke', 'Nube de humo'], ['spark', 'Chispa (estela)'], ['star', 'Estrella'], ['square', 'Cuadrado'], ['drop', 'Gota (raya)'], ['leaf', 'Hoja'], ['bubble', 'Burbuja'], ['confetti', 'Confeti'], ['image', 'Mi dibujo']];
  const renderEdit = () => {
    renderSprite();
    edit.replaceChildren(
      row('Forma', sel(SHAPES, fx.shape, v => { if (v === 'image' && !fx.sprite) { app.toast('Elige antes tu dibujo (abajo)', 'warn'); renderEdit(); return; } fx.shape = v as PShape; })),
      row('Sale de', sel([['point', 'Un punto'], ['line', 'Una línea (suelo)'], ['area', 'Una zona'], ['top', 'Arriba (cae)']], fx.emitter, v => { fx.emitter = v as PFX['emitter']; })),
      chk('No para (se repite sin salto)', fx.loop, v => { fx.loop = v; if (v) fx.burst = false; renderEdit(); }),
      chk('De golpe (todas a la vez)', !!fx.burst, v => { fx.burst = v; if (v) fx.loop = false; renderEdit(); }),
      chk('Brillo (los colores se suman)', fx.glow, v => { fx.glow = v; }),
      row('Partículas', sl(1, 400, fx.count, '', v => { fx.count = v; })),
      row('Vida', sl(5, 800, Math.round(fx.life[0] * 100), ' cs', v => { fx.life[0] = v / 100; if (fx.life[1] < fx.life[0]) fx.life[1] = fx.life[0]; }), sl(5, 800, Math.round(fx.life[1] * 100), ' cs', v => { fx.life[1] = Math.max(fx.life[0], v / 100); })),
      row('Velocidad', sl(0, 300, Math.round(fx.speed[0] * 100), '%', v => { fx.speed[0] = v / 100; }), sl(0, 300, Math.round(fx.speed[1] * 100), '%', v => { fx.speed[1] = v / 100; })),
      row('Dirección', sl(-180, 180, Math.round(fx.angle), '°', v => { fx.angle = v; })),
      row('Abertura', sl(0, 360, Math.round(fx.spread), '°', v => { fx.spread = v; })),
      row('Gravedad', sl(-300, 300, Math.round(fx.gravity * 100), '%', v => { fx.gravity = v / 100; })),
      row('Frenado', sl(0, 600, Math.round(fx.drag * 100), '%', v => { fx.drag = v / 100; })),
      row('Tamaño', sl(1, 300, Math.round(fx.size[0] * 1000), '‰', v => { fx.size[0] = v / 1000; }), sl(1, 300, Math.round(fx.size[1] * 1000), '‰', v => { fx.size[1] = v / 1000; })),
      row('Crece', sl(-100, 300, Math.round(fx.grow * 100), '%', v => { fx.grow = v / 100; })),
      row('Vaivén', sl(0, 50, Math.round((fx.wobble ?? 0) * 100), '%', v => { fx.wobble = v / 100; })),
      row('Giro', sl(-20, 20, Math.round(fx.spin ?? 0), '', v => { fx.spin = v; })),
      row('Colores', colorsRow()),
      h('div', { class: 'tm-sub' }, t('Tu dibujo como partícula')), spriteBox);
  };
  // ---- mis efectos: guardar, borrar, compartir
  const name = h('input', { type: 'text', class: 'input', placeholder: t('Nombre de tu efecto'), value: fx.mine ? fx.name : '' }) as HTMLInputElement;
  const saveBtn = h('button', { type: 'button', class: 'btn' }, 'Guardar en Mis efectos');
  saveBtn.onclick = () => {
    const nm = name.value.trim() || `${t('Mi efecto')} ${myEffects().length + 1}`, list = myEffects(), same = list.findIndex(e => e.name === nm);
    const e: PFX = { ...JSON.parse(JSON.stringify(fx)), name: nm, mine: true, id: same >= 0 ? list[same].id : 'mio-' + Date.now().toString(36) };
    if (same >= 0) list[same] = e; else list.push(e);
    if (saveMyEffects(list)) { fx = JSON.parse(JSON.stringify(e)); s.fx = fx; renderChips(); app.toast(same >= 0 ? 'Efecto actualizado' : 'Guardado en Mis efectos'); }
  };
  const delBtn = h('button', { type: 'button', class: 'btn' }, 'Borrar de Mis efectos');
  delBtn.onclick = () => { if (!fx.mine) { app.toast('Solo se pueden borrar los efectos propios', 'warn'); return; } saveMyEffects(myEffects().filter(e => e.id !== fx.id)); pick(FX[0]); app.toast('Efecto borrado'); };
  const expBtn = h('button', { type: 'button', class: 'btn' }, 'Exportar mis efectos');
  expBtn.onclick = async () => { const list = myEffects(); if (!list.length) { app.toast('Aún no tienes efectos guardados', 'warn'); return; } const io = await import('../io/files'); try { await io.saveBlob(new Blob([JSON.stringify({ photocapEffects: 1, effects: list }, null, 1)], { type: 'application/json' }), 'mis-efectos.json'); app.toast(`${list.length} efectos exportados`); } catch (e: any) { if (e?.name !== 'AbortError') app.toast(String(e?.message ?? e), 'warn'); } };
  const impBtn = h('button', { type: 'button', class: 'btn' }, 'Importar efectos…');
  impBtn.onclick = async () => {
    const io = await import('../io/files'); const [file] = await io.pickFiles('.json,application/json'); if (!file) return;
    try {
      const j = JSON.parse(await file.text()), arr = Array.isArray(j) ? j : Array.isArray(j?.effects) ? j.effects : [j];
      const ok = arr.map(sanitizeFx).filter((e: PFX | null): e is PFX => !!e); if (!ok.length) throw new Error('');
      const list = myEffects(); for (const e of ok) { e.id = 'mio-' + Math.random().toString(36).slice(2, 9); const same = list.findIndex(x => x.name === e.name); if (same >= 0) list[same] = e; else list.push(e); }
      if (saveMyEffects(list)) { renderChips(); app.toast(`${ok.length} efectos importados`); }
    } catch { app.toast('Este archivo no tiene efectos de Photocap', 'warn'); }
  };
  // ---- resultado
  const size = sel([[32, 32], [48, 48], [64, 64], [96, 96], [128, 128], [192, 192], [256, 256], [256, 128], [512, 512]].map(([w, hh]) => [`${w}x${hh}`, `${w} × ${hh}`] as [string, string]), `${s.W}x${s.H}`, v => { [s.W, s.H] = v.split('x').map(Number); });
  const frSl = numberSlider({ min: 4, max: 64, value: s.frames, onInput: v => { s.frames = v; } });
  const canOnTop = !!d;
  let dest = 'new';
  const destSel = sel([['new', 'Animación nueva'], ...(canOnTop ? [['onto', 'Sobre lo que tengo abierto (en la selección o en el centro)'] as [string, string]] : [])], dest, v => { dest = v; });
  const seed = h('button', { type: 'button', class: 'btn' }, 'Otra variante'); seed.onclick = () => { s.seed = 1 + Math.floor(Math.random() * 99999); f = 0; };
  renderChips(); renderEdit();
  if (fx.sprite) loadSprite(fx.sprite).catch(() => {});
  tick();
  const det = (title: string, open: boolean, ...kids: HTMLElement[]) => { const e = h('details', { class: 'pfx-sec' }, h('summary', {}, title), ...kids) as HTMLDetailsElement; e.open = open; return e; };
  showDialog({
    title: 'Partículas y efectos', okLabel: 'Crear', width: 600,
    body: [h('div', { class: 'hint' }, 'Elige un efecto, cámbialo a tu gusto (o usa tu propio dibujo como partícula) y guárdalo en Mis efectos para usarlo cuando quieras.'),
      chips, h('div', { class: 'gd-pv-wrap' }, pv), h('div', { class: 'pv-nav' }, seed),
      det(t('Ajustes del efecto'), innerWidth > 700, edit),
      det(t('Mis efectos'), false, row('Nombre', name), h('div', { class: 'pv-nav' }, saveBtn, delBtn), h('div', { class: 'pv-nav' }, expBtn, impBtn)),
      det(t('Resultado'), true, row('Dónde', destSel), row('Tamaño', size), row('Fotogramas', frSl.el),
        row('Velocidad', sl(6, 30, s.fps, ' fps', v => { s.fps = v; })), row('Cantidad', sl(20, 300, 100, '%', v => { s.amount = v / 100; })), row('Escala', sl(30, 250, 100, '%', v => { s.scale = v / 100; })),
        chk('Pixel art (sin bordes suaves, solo estos colores)', s.pixel, v => { s.pixel = v; }))],
    onCancel: () => clearTimeout(timer),
    onOk: () => {
      clearTimeout(timer);
      try { localStorage.setItem('editor.particles', JSON.stringify({ id: fx.id, W: s.W, H: s.H, pixel: s.pixel })); } catch { /* */ }
      if (dest === 'onto' && app.doc) { applyOnto(app.doc, { ...s, fx }); return; }
      const nd = new EditorDocument(fx.mine ? fx.name : t(fx.name), s.W, s.H);
      for (let i = 0; i < s.frames; i++) { const l = new RasterLayer(`Fotograma ${i + 1}`, s.W, s.H); ctx2d(l.canvas).drawImage(particleFrame({ ...s, fx }, i), 0, 0); l.visible = i === 0; nd.root.add(l); nd.frames.push({ delay: Math.round(1000 / s.fps), visible: [l.id], own: l.id, tag: fx.id }); }
      nd.frameIndex = 0; if (s.pixel) nd.meta.pixelArt = true;
      app.addDocument(nd, 'Partículas'); requestAnimationFrame(() => app.viewport.fit());
      import('./anim').then(m => { if (!s.pixel && !m.dockShown()) m.toggleAnimDock(); });
      app.toast(`${s.frames} fotogramas creados: pulsa reproducir para verlo`);
    },
  });
}
/** Pone el efecto encima del dibujo o la animación abierta: una capa de efecto por fotograma, centrada en la selección
 *  (o en el centro). Si no era una animación, pasa a serlo: el dibujo se ve en todos los fotogramas. */
export async function applyOnto(d: EditorDocument, s: PSettings) {
  const b = d.selection.active && d.selection.bounds ? d.selection.bounds : null;
  // el efecto ocupa la selección o, sin ella, toda la imagen; se calcula a ese tamaño (nítido, sin estirar)
  const bx = b ? Math.round(b.x) : 0, by = b ? Math.round(b.y) : 0, W = Math.max(8, Math.round(b ? b.w : d.width)), H = Math.max(8, Math.round(b ? b.h : d.height));
  const fs: PSettings = { ...s, W, H };
  const anim = d.frames.length > 1 && d.frames.some(f => f.own != null), n = anim ? d.frames.length : s.frames;
  const { framesFit } = await import('./anim'); if (!framesFit(d, n)) return;
  if (!anim) { const vis = d.allLayers().filter(l => l.visible).map(l => l.id); d.frames = Array.from({ length: n }, () => ({ delay: Math.round(1000 / s.fps), visible: [...vis] })); }
  const parent = d.root;
  for (let i = 0; i < n; i++) {
    const l = new RasterLayer(`${t('Efecto')} ${i + 1}`, d.width, d.height), x = ctx2d(l.canvas); x.imageSmoothingEnabled = !s.pixel;
    x.drawImage(particleFrame(fs, i % s.frames), bx, by);
    l.visible = i === d.frameIndex; parent.add(l);
    const fr = d.frames[i]; fr.visible.push(l.id); if (!anim) fr.own = l.id;
  }
  import('./timeline').then(m => { m.applyFrame(d, Math.min(d.frameIndex, n - 1)); d.commit('Añadir efecto'); app.emit('docs'); });
  import('./anim').then(m => { if (!d.meta.pixelArt && !m.dockShown()) m.toggleAnimDock(); });
  app.toast(`${t('Efecto añadido')}: ${n} ${t('fotogramas')}`);
}
