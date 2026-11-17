// Ventana de Licuar: vista previa propia, herramientas a la izquierda y opciones.

import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog, row } from './dialog';
import { getPaintTarget, setTargetCanvas } from '../tools/paint';
import { cloneCanvas, ctx2d, getPixels, makeCanvas, putPixels } from '../core/canvas';
import { LiquifyField, LiquifyMode, renderLiquify, applyLiquifyFull } from '../filters/liquify';

const MODES: [LiquifyMode, string, string][] = [
  ['push', 'Deformar hacia delante', '➜'], ['reconstruct', 'Reconstruir', '↺'], ['smooth', 'Suavizar', '≈'],
  ['twirlCW', 'Molinete (horario)', '↻'], ['twirlCCW', 'Molinete (antihorario)', '↺'], ['pucker', 'Desinflar', '⇲'], ['bloat', 'Inflar', '⇱'],
];

export function liquifyDialog() {
  const d = app.doc; if (!d) return;
  const t = getPaintTarget(); if (!t) return;
  if (t.isMask) { app.toast('Licuar trabaja sobre los píxeles de la capa', 'warn'); return; }
  const maxW = Math.min(820, window.innerWidth - 260), maxH = Math.min(560, window.innerHeight - 220);
  const k = Math.min(1, maxW / d.width, maxH / d.height);
  const pw = Math.max(1, Math.round(d.width * k)), ph = Math.max(1, Math.round(d.height * k));
  // Vista previa: el resto de la imagen atenuado detrás de la capa
  const back = makeCanvas(pw, ph), bc = ctx2d(back); bc.drawImage(d.flatten(), 0, 0, pw, ph);
  const small = makeCanvas(pw, ph); ctx2d(small).drawImage(t.canvas, 0, 0, pw, ph);
  const src = ctx2d(small).getImageData(0, 0, pw, ph), out = new ImageData(new Uint8ClampedArray(src.data), pw, ph);
  const field = new LiquifyField(pw, ph);
  const view = h('canvas', { width: pw, height: ph, class: 'lq-view' }), vc = view.getContext('2d')!;
  const layerCanvas = makeCanvas(pw, ph);
  let mode: LiquifyMode = 'push', size = 100, pressure = 50, showBack = true;
  const draw = (rect?: { x: number; y: number; w: number; h: number }) => {
    renderLiquify(src, field, out, rect);
    ctx2d(layerCanvas).putImageData(out, 0, 0);
    vc.clearRect(0, 0, pw, ph);
    if (showBack) { vc.globalAlpha = 0.5; vc.drawImage(back, 0, 0); vc.globalAlpha = 1; }
    vc.drawImage(layerCanvas, 0, 0);
    if (mouse) { vc.strokeStyle = '#fff'; vc.lineWidth = 1; vc.beginPath(); vc.arc(mouse.x, mouse.y, size * k / 2, 0, 7); vc.stroke(); vc.strokeStyle = 'rgba(0,0,0,.6)'; vc.beginPath(); vc.arc(mouse.x, mouse.y, size * k / 2 + 1, 0, 7); vc.stroke(); }
  };
  let mouse: { x: number; y: number } | null = null, down = false, last: { x: number; y: number } | null = null, timer = 0;
  const pos = (e: PointerEvent) => ({ x: e.offsetX * pw / view.clientWidth, y: e.offsetY * ph / view.clientHeight });
  const dab = (p: { x: number; y: number }, delta = { x: 0, y: 0 }) => {
    const r = field.dab(mode, p.x, p.y, size * k / 2, pressure / 100, delta);
    if (r) draw(r);
  };
  view.addEventListener('pointerdown', e => {
    view.setPointerCapture(e.pointerId); down = true; last = pos(e); mouse = last;
    if (mode !== 'push') { dab(last); clearInterval(timer); timer = window.setInterval(() => { if (down && mouse) dab(mouse); }, 40); }
  });
  view.addEventListener('pointermove', e => {
    const p = pos(e); mouse = p;
    if (down && last && mode === 'push') {
      const dist = Math.hypot(p.x - last.x, p.y - last.y), step = Math.max(1, size * k * 0.1), n = Math.max(1, Math.ceil(dist / step));
      for (let i = 1; i <= n; i++) { const q = { x: last.x + (p.x - last.x) * i / n, y: last.y + (p.y - last.y) * i / n }; dab(q, { x: (p.x - last.x) / n, y: (p.y - last.y) / n }); }
      last = p;
    } else draw({ x: 0, y: 0, w: 0, h: 0 });
  });
  const stop = () => { down = false; clearInterval(timer); };
  view.addEventListener('pointerup', stop); view.addEventListener('pointercancel', stop);
  view.addEventListener('pointerleave', () => { mouse = null; draw({ x: 0, y: 0, w: 0, h: 0 }); });

  const toolBtns = MODES.map(([m, label, glyph]) => {
    const b = h('button', { class: 'btn lq-tool' + (m === mode ? ' on' : ''), type: 'button', title: label }, h('span', { class: 'lq-glyph' }, glyph), label);
    b.onclick = () => { mode = m; toolBtns.forEach(x => x.classList.toggle('on', x === b)); };
    return b;
  });
  const sz = numberSlider({ min: 2, max: 1500, value: size, unit: 'px', onInput: v => size = v });
  const pr = numberSlider({ min: 1, max: 100, value: pressure, unit: '%', onInput: v => pressure = v });
  const bg = h('input', { type: 'checkbox', checked: true }); bg.onchange = () => { showBack = bg.checked; draw({ x: 0, y: 0, w: 0, h: 0 }); };
  const reset = h('button', { class: 'btn', type: 'button' }, 'Restablecer todo'); reset.onclick = () => { field.reset(); draw(); };
  const side = h('div', { class: 'lq-side' }, ...toolBtns, h('div', { class: 'lq-opts' }, row('Tamaño', sz.el), row('Presión', pr.el), h('label', { class: 'check' }, bg, ' Ver el resto de la imagen')),
    h('div', { class: 'hint' }, 'Arrastra sobre la imagen. Con Inflar, Desinflar y Molinete mantén pulsado.'));
  draw();
  const onKey = (e: KeyboardEvent) => { if (e.key === '[' || e.key === ']') { size = Math.max(2, size + (e.key === ']' ? 10 : -10)); sz.set(size); draw({ x: 0, y: 0, w: 0, h: 0 }); } };
  document.addEventListener('keydown', onKey);
  showDialog({
    title: 'Licuar', width: pw + 260,
    body: h('div', { class: 'lq' }, side, h('div', { class: 'lq-stage' }, view)),
    extraButtons: [reset],
    onOk: () => {
      document.removeEventListener('keydown', onKey); stop();
      if (field.isEmpty()) return;
      const full = getPixels(t.canvas), res = applyLiquifyFull(full, field, k);
      const outC = cloneCanvas(t.canvas); putPixels(outC, res);
      const sel = d.selection.mask;
      if (sel) { // solo dentro de la selección
        const m = cloneCanvas(outC), mc = ctx2d(m); mc.globalCompositeOperation = 'destination-in'; mc.drawImage(sel, 0, 0);
        const base = cloneCanvas(t.canvas), bc2 = ctx2d(base); bc2.globalCompositeOperation = 'destination-out'; bc2.drawImage(sel, 0, 0); bc2.globalCompositeOperation = 'source-over'; bc2.drawImage(m, 0, 0);
        setTargetCanvas(t, base);
      } else setTargetCanvas(t, outC);
      d.commit('Licuar');
    },
    onCancel: () => { document.removeEventListener('keydown', onKey); stop(); },
  });
}
