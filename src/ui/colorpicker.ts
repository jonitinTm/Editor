// Selector de color propio: cuadro de saturación/brillo, tira de tono y campos numéricos.

import { h } from './dom';
import { showDialog } from './dialog';
import { hexToRgb, rgbToHex } from '../core/canvas';

export function rgb2hsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d) hh = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh * 60, mx ? d / mx : 0, mx];
}
export function hsv2rgb(hh: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => { const k = (n + hh / 60) % 6; return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255; };
  return [f(5), f(3), f(1)];
}

export function createPicker(initial: string, onChange: (hex: string) => void, size = { w: 170, h: 130 }) {
  let [hue, sat, val] = rgb2hsv(...hexToRgb(initial));
  const sv = h('canvas', { width: size.w, height: size.h, class: 'cp-sv' });
  const strip = h('canvas', { width: 16, height: size.h, class: 'cp-hue' });
  const hex = h('input', { type: 'text', class: 'cp-hex', maxLength: 7 });
  const nums = ['R', 'G', 'B'].map(() => h('input', { type: 'number', min: '0', max: '255', class: 'num cp-num' }));
  const draw = () => {
    const c = sv.getContext('2d')!;
    c.fillStyle = `hsl(${hue},100%,50%)`; c.fillRect(0, 0, size.w, size.h);
    let g = c.createLinearGradient(0, 0, size.w, 0); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, size.w, size.h);
    g = c.createLinearGradient(0, 0, 0, size.h); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000'); c.fillStyle = g; c.fillRect(0, 0, size.w, size.h);
    const x = sat * size.w, y = (1 - val) * size.h;
    c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.arc(x, y, 5.5, 0, 7); c.stroke(); c.strokeStyle = '#fff'; c.beginPath(); c.arc(x, y, 4.5, 0, 7); c.stroke();
    const s = strip.getContext('2d')!;
    const hg = s.createLinearGradient(0, 0, 0, size.h); for (let i = 0; i <= 6; i++) hg.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
    s.fillStyle = hg; s.fillRect(0, 0, 16, size.h);
    const hy = hue / 360 * size.h; s.fillStyle = '#fff'; s.fillRect(0, hy - 1.5, 16, 3); s.strokeStyle = '#000'; s.strokeRect(0.5, hy - 2, 15, 4);
  };
  const current = () => rgbToHex(...hsv2rgb(hue, sat, val));
  const sync = (emit: boolean, from?: HTMLElement) => {
    draw();
    const col = current(), rgb = hexToRgb(col);
    if (from !== hex) hex.value = col;
    nums.forEach((n, i) => { if (from !== n) n.value = String(rgb[i]); });
    if (emit) onChange(col);
  };
  const dragOn = (el: HTMLCanvasElement, fn: (x: number, y: number) => void) => {
    el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); fn(e.offsetX, e.offsetY); sync(true); });
    el.addEventListener('pointermove', e => { if (e.buttons) { fn(e.offsetX, e.offsetY); sync(true); } });
  };
  dragOn(sv, (x, y) => { sat = Math.max(0, Math.min(1, x / size.w)); val = 1 - Math.max(0, Math.min(1, y / size.h)); });
  dragOn(strip, (_x, y) => { hue = Math.max(0, Math.min(359.9, y / size.h * 360)); });
  hex.addEventListener('change', () => { if (/^#?[0-9a-f]{6}$/i.test(hex.value)) { [hue, sat, val] = rgb2hsv(...hexToRgb(hex.value)); sync(true); } else sync(false); });
  nums.forEach(n => n.addEventListener('input', () => { const v = nums.map(x => Math.max(0, Math.min(255, +x.value || 0))) as [number, number, number]; const hsv = rgb2hsv(...v); if (hsv[1] > 0) hue = hsv[0]; sat = hsv[1]; val = hsv[2]; sync(true, n); }));
  const el = h('div', { class: 'cp' }, h('div', { class: 'cp-top' }, sv, strip),
    h('div', { class: 'cp-fields' }, h('span', {}, '#'), hex, ...['R', 'G', 'B'].flatMap((l, i) => [h('span', {}, l), nums[i]])));
  sync(false);
  return { el, set(col: string) { const hsv = rgb2hsv(...hexToRgb(col)); if (hsv[1] > 0 && hsv[2] > 0) hue = hsv[0]; sat = hsv[1]; val = hsv[2]; sync(false); } };
}

/** Diálogo "Selector de color". Devuelve null si se cancela. */
export function colorDialog(title: string, initial: string): Promise<string | null> {
  return new Promise(res => {
    let col = initial;
    const now = h('div', { class: 'cp-new', style: { background: initial } }), old = h('div', { class: 'cp-old', style: { background: initial }, title: 'Color actual' });
    const picker = createPicker(initial, c => { col = c; now.style.background = c; }, { w: 240, h: 200 });
    showDialog({ title, width: 330, body: h('div', { class: 'cp-dialog' }, picker.el, h('div', { class: 'cp-compare' }, h('span', { class: 'hint' }, 'nuevo'), now, old, h('span', { class: 'hint' }, 'actual'))), onOk: () => res(col), onCancel: () => res(null) });
  });
}

export const SWATCHES = ['#000000', '#404040', '#808080', '#c0c0c0', '#ffffff', '#ff0000', '#ff8000', '#ffff00', '#80ff00', '#00ff00', '#00ff80', '#00ffff', '#0080ff', '#0000ff', '#8000ff', '#ff00ff', '#ff0080',
  '#7f0000', '#7f4000', '#7f7f00', '#007f00', '#007f7f', '#00007f', '#7f007f', '#ffb3b3', '#ffd9b3', '#ffffb3', '#b3ffb3', '#b3ffff', '#b3b3ff', '#ffb3ff', '#8b5a2b', '#d2b48c', '#f5deb3'];
