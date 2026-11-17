// Editor de degradados: paradas de color con opacidad, arrastrables, y degradados predefinidos.

import { h, numberSlider } from './dom';
import { showDialog, row } from './dialog';
import { colorDialog } from './colorpicker';
import { hexToRgb } from '../core/canvas';
import { app } from './app';

export interface GradStop { t: number; color: string; a: number; }

const PRESETS: [string, () => GradStop[]][] = [
  ['Frontal → Fondo', () => [{ t: 0, color: app.fg, a: 1 }, { t: 1, color: app.bg, a: 1 }]],
  ['Frontal → Transparente', () => [{ t: 0, color: app.fg, a: 1 }, { t: 1, color: app.fg, a: 0 }]],
  ['Negro → Blanco', () => [{ t: 0, color: '#000000', a: 1 }, { t: 1, color: '#ffffff', a: 1 }]],
  ['Arcoíris', () => ['#ff0000', '#ffa500', '#ffff00', '#00c000', '#0080ff', '#4b00ff', '#a000c0'].map((c, i, l) => ({ t: i / (l.length - 1), color: c, a: 1 }))],
  ['Atardecer', () => [{ t: 0, color: '#1a0b3d', a: 1 }, { t: 0.45, color: '#c2306b', a: 1 }, { t: 0.75, color: '#f5813a', a: 1 }, { t: 1, color: '#ffd77a', a: 1 }]],
  ['Cobre', () => [{ t: 0, color: '#97462a', a: 1 }, { t: 0.35, color: '#f2b38a', a: 1 }, { t: 0.65, color: '#7a3417', a: 1 }, { t: 1, color: '#f6c8a3', a: 1 }]],
  ['Cromo', () => [{ t: 0, color: '#2b3a4a', a: 1 }, { t: 0.48, color: '#e8f0f7', a: 1 }, { t: 0.52, color: '#5c4a2e', a: 1 }, { t: 1, color: '#f4ead5', a: 1 }]],
  ['Viñeta', () => [{ t: 0, color: '#000000', a: 0 }, { t: 0.6, color: '#000000', a: 0 }, { t: 1, color: '#000000', a: 0.85 }]],
];

function paintBar(c: HTMLCanvasElement, stops: GradStop[]) {
  const x = c.getContext('2d')!; x.clearRect(0, 0, c.width, c.height);
  for (let i = 0; i < c.width; i += 8) for (let j = 0; j < c.height; j += 8) { x.fillStyle = ((i + j) / 8) % 2 ? '#cfcfcf' : '#fff'; x.fillRect(i, j, 8, 8); }
  const g = x.createLinearGradient(0, 0, c.width, 0);
  for (const s of [...stops].sort((a, b) => a.t - b.t)) g.addColorStop(Math.max(0, Math.min(1, s.t)), `rgba(${hexToRgb(s.color).join(',')},${s.a})`);
  x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
}

export function gradientEditor(initial: GradStop[], onOk: (s: GradStop[]) => void) {
  let stops = initial.map(s => ({ ...s })), sel = 0;
  const W = 340;
  const bar = h('canvas', { width: W, height: 30, class: 'ge-bar' });
  const track = h('div', { class: 'ge-track', style: { width: W + 'px' } });
  const colorBtn = h('button', { class: 'ge-color', type: 'button', title: 'Color de la parada' });
  const op = numberSlider({ min: 0, max: 100, value: 100, unit: '%', onInput: v => { stops[sel].a = v / 100; render(false); } });
  const pos = numberSlider({ min: 0, max: 100, value: 0, unit: '%', onInput: v => { stops[sel].t = v / 100; render(false); } });
  const del = h('button', { class: 'btn', type: 'button' }, 'Eliminar parada');
  const render = (syncFields = true) => {
    paintBar(bar, stops);
    track.innerHTML = '';
    stops.forEach((s, i) => {
      const m = h('div', { class: 'ge-stop' + (i === sel ? ' on' : ''), style: { left: s.t * W + 'px', background: s.color }, title: 'Arrastra para mover; hacia abajo para quitar; doble clic para el color' });
      m.addEventListener('pointerdown', e => {
        e.preventDefault(); sel = i; render();
        const r = track.getBoundingClientRect();
        const mv = (ev: PointerEvent) => {
          if (ev.clientY - r.bottom > 40 && stops.length > 2) { stops.splice(sel, 1); sel = 0; up(); render(); return; }
          stops[sel].t = Math.max(0, Math.min(1, (ev.clientX - r.left) / W)); render();
        };
        const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      });
      m.addEventListener('dblclick', async () => { const c = await colorDialog('Color de la parada', stops[i].color); if (c) { stops[i].color = c; render(); } });
      track.append(m);
    });
    const s = stops[sel];
    colorBtn.style.background = s.color;
    if (syncFields) { op.set(Math.round(s.a * 100)); pos.set(Math.round(s.t * 100)); }
  };
  // Clic en la barra: nueva parada con el color que hay en ese punto
  bar.addEventListener('click', e => {
    const t = e.offsetX / W, d = bar.getContext('2d')!.getImageData(Math.min(W - 1, e.offsetX), 15, 1, 1).data;
    const near = [...stops].sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
    stops.push({ t, color: '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''), a: near?.a ?? 1 });
    sel = stops.length - 1; render();
  });
  colorBtn.onclick = async () => { const c = await colorDialog('Color de la parada', stops[sel].color); if (c) { stops[sel].color = c; render(); } };
  del.onclick = () => { if (stops.length > 2) { stops.splice(sel, 1); sel = 0; render(); } };
  const presets = h('div', { class: 'ge-presets' }, ...PRESETS.map(([name, fn]) => {
    const c = h('canvas', { width: 56, height: 22, title: name, class: 'ge-preset' }); paintBar(c, fn());
    c.onclick = () => { stops = fn(); sel = 0; render(); };
    return c;
  }));
  render();
  showDialog({
    title: 'Editor de degradados', width: 400,
    body: [h('div', { class: 'hint' }, 'Predefinidos:'), presets, h('div', { class: 'ge-wrap' }, bar, track),
      h('div', { class: 'hint' }, 'Clic en la barra para añadir una parada.'),
      row('Color', colorBtn), row('Opacidad', op.el), row('Posición', pos.el), del],
    onOk: () => onOk(stops.map(s => ({ ...s })).sort((a, b) => a.t - b.t)),
  });
}
