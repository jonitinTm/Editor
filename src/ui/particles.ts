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

export type PShape = 'soft' | 'spark' | 'star' | 'square' | 'smoke' | 'drop' | 'leaf' | 'bubble' | 'confetti';
export type PFX = {
  id: string; name: string; loop: boolean; count: number; life: [number, number]; speed: [number, number]; angle: number; spread: number;
  gravity: number; drag: number; size: [number, number]; grow: number; shape: PShape; colors: string[]; glow: boolean;
  emitter: 'point' | 'line' | 'area' | 'top'; spin?: number; wobble?: number; burst?: boolean;
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
  const s: PSettings = { fx: FX.find(f => f.id === saved.id) ?? FX[0], W: saved.W ?? 128, H: saved.H ?? 128, frames: 16, fps: 15, seed: 1, amount: 1, scale: 1, pixel: !!saved.pixel };
  s.frames = s.fx.loop ? 24 : 16;
  let colors = [...s.fx.colors];
  const pv = h('canvas', { class: 'gd-pv pfx-pv' }) as HTMLCanvasElement;
  let f = 0, timer = 0;
  const cur = (): PSettings => ({ ...s, fx: { ...s.fx, colors } });
  const tick = () => { if (!pv.isConnected && f > 0) return; const k = Math.max(1, Math.floor(Math.min(256 / s.W, 256 / s.H))), c = particleFrame(cur(), f % s.frames); pv.width = s.W * k; pv.height = s.H * k; const x = ctx2d(pv); x.imageSmoothingEnabled = !s.pixel; x.fillStyle = '#16171a'; x.fillRect(0, 0, pv.width, pv.height); x.drawImage(c, 0, 0, pv.width, pv.height); f++; timer = window.setTimeout(tick, 1000 / s.fps); };
  const chips = h('div', { class: 'tex-chips' });
  const colorRow = h('div', { class: 'pfx-colors' });
  const renderColors = () => colorRow.replaceChildren(...colors.map((c, i) => { const inp = h('input', { type: 'color', value: c, class: 'color-input', 'aria-label': `${t('Color')} ${i + 1}` }) as HTMLInputElement; inp.oninput = () => { colors[i] = inp.value; }; return inp; }));
  const frSl = numberSlider({ min: 4, max: 64, value: s.frames, onInput: v => { s.frames = v; } });
  for (const fx of FX) { const b = h('button', { type: 'button', class: 'btn tex-chip' + (fx === s.fx ? ' on' : ''), 'data-fx': fx.id }, fx.name); b.onclick = () => { s.fx = fx; colors = [...fx.colors]; s.frames = fx.loop ? 24 : 16; frSl.set(s.frames); renderColors(); chips.querySelectorAll('.tex-chip').forEach(x => x.classList.toggle('on', x === b)); f = 0; }; chips.append(b); }
  renderColors();
  const size = h('select', {}, ...[[32, 32], [48, 48], [64, 64], [96, 96], [128, 128], [192, 192], [256, 256], [256, 128], [512, 512]].map(([w, hh]) => h('option', { value: `${w}x${hh}` }, `${w} × ${hh}`))) as HTMLSelectElement;
  size.value = `${s.W}x${s.H}`; if (!size.value) size.value = '128x128';
  size.onchange = () => { [s.W, s.H] = size.value.split('x').map(Number); };
  const pix = h('input', { type: 'checkbox', checked: s.pixel }) as HTMLInputElement; pix.onchange = () => { s.pixel = pix.checked; if (s.pixel && s.W > 128) { s.W = s.H = 64; size.value = '64x64'; } };
  const seed = h('button', { type: 'button', class: 'btn' }, 'Otra variante'); seed.onclick = () => { s.seed = 1 + Math.floor(Math.random() * 99999); f = 0; };
  const row = (l: string, ...e: HTMLElement[]) => h('div', { class: 'form-row' }, h('label', {}, l), ...e);
  tick();
  showDialog({
    title: 'Partículas y efectos', okLabel: 'Crear animación', width: 560,
    body: [h('div', { class: 'hint' }, 'Efectos para el juego. Los que no paran (fuego, humo, lluvia…) se repiten sin salto. Expórtalos como hoja de sprites con Juegos › Animación › Exportar animación.'),
      chips, h('div', { class: 'gd-pv-wrap' }, pv),
      row('Tamaño', size), row('Fotogramas', frSl.el),
      row('Velocidad', numberSlider({ min: 6, max: 30, value: s.fps, unit: ' fps', onInput: v => { s.fps = v; } }).el),
      row('Cantidad', numberSlider({ min: 20, max: 300, value: 100, unit: '%', onInput: v => { s.amount = v / 100; } }).el),
      row('Escala', numberSlider({ min: 30, max: 250, value: 100, unit: '%', onInput: v => { s.scale = v / 100; } }).el),
      row('Colores', colorRow), row('', seed), h('label', { class: 'check' }, pix, ' Pixel art (sin bordes suaves, solo estos colores)')],
    onCancel: () => clearTimeout(timer),
    onOk: () => {
      clearTimeout(timer);
      try { localStorage.setItem('editor.particles', JSON.stringify({ id: s.fx.id, W: s.W, H: s.H, pixel: s.pixel })); } catch { /* */ }
      const p = cur(), nd = new EditorDocument(t(s.fx.name), s.W, s.H);
      for (let i = 0; i < s.frames; i++) { const l = new RasterLayer(`Fotograma ${i + 1}`, s.W, s.H); ctx2d(l.canvas).drawImage(particleFrame(p, i), 0, 0); l.visible = i === 0; nd.root.add(l); nd.frames.push({ delay: Math.round(1000 / s.fps), visible: [l.id], own: l.id, tag: s.fx.id }); }
      nd.frameIndex = 0; if (s.pixel) nd.meta.pixelArt = true;
      app.addDocument(nd, 'Partículas'); requestAnimationFrame(() => app.viewport.fit());
      import('./anim').then(m => { if (!s.pixel && !m.dockShown()) m.toggleAnimDock(); });
      app.toast(`${s.frames} fotogramas creados: pulsa reproducir para verlo`);
    },
  });
}
