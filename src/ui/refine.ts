// Selección › Seleccionar y aplicar máscara: refinar el borde de la selección
// (suavizar, calar, contraste, desplazar borde) con vista previa.

import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog, row } from './dialog';
import { cloneCanvas, ctx2d, getPixels, makeCanvas, putPixels } from '../core/canvas';
import { gaussianBlur } from '../filters/blur';
import { LayerMask, RasterLayer } from '../core/layers';
import * as ops from './ops';

export interface RefineParams { smooth: number; feather: number; contrast: number; shift: number; }

/** Aplica el refinado a una máscara (alfa) y devuelve un lienzo nuevo. */
export function refineMask(src: HTMLCanvasElement, p: RefineParams): HTMLCanvasElement {
  const img = getPixels(src), d = img.data;
  const curve = (k: number, mid = 0.5) => { for (let i = 3; i < d.length; i += 4) d[i] = Math.max(0, Math.min(255, ((d[i] / 255 - mid) * k + 0.5) * 255)); };
  if (p.smooth > 0) { gaussianBlur(img, p.smooth / 100 * 8 + 0.5, true); curve(3); }
  if (p.shift !== 0) { // desplazar el borde: desenfoque y umbral desplazado
    const r = Math.abs(p.shift) / 100 * 20 + 0.5;
    gaussianBlur(img, r, true); curve(6, p.shift > 0 ? 0.25 : 0.75);
  }
  if (p.feather > 0) gaussianBlur(img, p.feather / 2, true);
  if (p.contrast > 0) curve(1 + p.contrast / 100 * 12);
  const out = makeCanvas(src.width, src.height); putPixels(out, img); return out;
}

export function refineDialog() {
  const d = app.doc; if (!d) return;
  if (!d.selection.mask) { app.toast('Haz primero una selección', 'warn'); return; }
  const original = cloneCanvas(d.selection.mask);
  const p: RefineParams = { smooth: 0, feather: 0, contrast: 0, shift: 0 };
  let view: 'overlay' | 'black' | 'white' | 'transparent' = 'overlay', timer = 0;
  const update = () => { clearTimeout(timer); timer = window.setTimeout(() => { d.refinePreview = { mask: refineMask(original, p), mode: view }; app.viewport.requestRender(); }, 80); };
  const slider = (label: string, key: keyof RefineParams, min: number, max: number, unit: string) => row(label, numberSlider({ min, max, value: p[key], unit, onInput: v => { p[key] = v; update(); } }).el);
  const viewSel = h('select', {}, h('option', { value: 'overlay' }, 'Superposición roja'), h('option', { value: 'black' }, 'Sobre negro'), h('option', { value: 'white' }, 'Sobre blanco'), h('option', { value: 'transparent' }, 'Sobre transparente'));
  viewSel.onchange = () => { view = viewSel.value as any; update(); };
  const out = h('select', {}, h('option', { value: 'selection' }, 'Selección'), h('option', { value: 'mask' }, 'Máscara de capa'), h('option', { value: 'newLayer' }, 'Capa nueva con máscara'));
  const close = () => { clearTimeout(timer); d.refinePreview = null; app.viewport.requestRender(); };
  showDialog({
    title: 'Seleccionar y aplicar máscara', width: 400, side: true,
    body: [row('Ver', viewSel), slider('Suavizar', 'smooth', 0, 100, ''), slider('Calar', 'feather', 0, 250, 'px'), slider('Contraste', 'contrast', 0, 100, '%'), slider('Desplazar borde', 'shift', -100, 100, '%'), row('Salida a', out)],
    onOk: () => {
      close();
      const m = refineMask(original, p);
      if (out.value === 'selection') { d.selection.setMask(m); d.commit('Seleccionar y aplicar máscara'); return; }
      let l = d.active;
      if (!l) return;
      if (out.value === 'newLayer') { ops.duplicateLayer(); l = d.active!; }
      const lm = new LayerMask(d.width, d.height, 'black'); lm.canvas = m; lm.touch(); l.mask = lm;
      d.selection.clear(); d.editMask = false;
      d.commit('Seleccionar y aplicar máscara');
      void RasterLayer; void ctx2d;
    },
    onCancel: close,
  });
  update();
}
