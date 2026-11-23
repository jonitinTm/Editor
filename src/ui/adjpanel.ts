// Panel «Ajustes»: un toque crea una capa de ajuste (no estropea la foto y se puede cambiar o borrar después).
// Cada botón muestra una miniatura de tu propia imagen con ese ajuste. Debajo, «looks» de un toque que se
// crean como un grupo de capas de ajuste editables.

import { app } from './app';
import { h } from './dom';
import { FILTERS, FilterDef, defaultParams } from '../filters/registry';
import { AdjustmentLayer, GroupLayer, LayerMask } from '../core/layers';
import { cloneCanvas, ctx2d, makeCanvas } from '../core/canvas';
import * as ops from './ops';

/** Valores para la miniatura: los de por defecto suelen no cambiar nada, así que se exagera el primer control. */
function demoParams(f: FilterDef) {
  const p = defaultParams(f), first = (f.params ?? []).find((q: any) => q.type === 'range') as any;
  if (first && Math.abs(p[first.key] - (first.min + first.max) / 2) < (first.max - first.min) * 0.2) p[first.key] = p[first.key] + (first.max - p[first.key]) * 0.55;
  return p;
}

type Look = { name: string; desc: string; layers: [string, any][] };
const LOOKS: Look[] = [
  { name: 'Cálido', desc: 'Tonos de atardecer', layers: [['photofilter', { color: '#ec8a00', density: 30, preserve: true }], ['vibrance', { vibrance: 15, sat: 0 }]] },
  { name: 'Frío', desc: 'Azulado y limpio', layers: [['photofilter', { color: '#1f6bd6', density: 25, preserve: true }]] },
  { name: 'Más contraste', desc: 'Más fuerza', layers: [['brightness', { brightness: 0, contrast: 30 }], ['vibrance', { vibrance: 20, sat: 0 }]] },
  { name: 'Viveza', desc: 'Colores más vivos', layers: [['vibrance', { vibrance: 55, sat: 8 }]] },
  { name: 'Blanco y negro', desc: 'Con contraste', layers: [['bw', null], ['brightness', { brightness: 0, contrast: 20 }]] },
  { name: 'Vintage', desc: 'Foto antigua', layers: [['vibrance', { vibrance: -35, sat: -10 }], ['photofilter', { color: '#c08a3e', density: 35, preserve: true }], ['brightness', { brightness: 8, contrast: -12 }]] },
  { name: 'Cine', desc: 'Sombras verdosas, luces cálidas', layers: [['colorbalance', { s0: -18, s1: 2, s2: 14, h0: 14, h1: 0, h2: -14 }], ['brightness', { brightness: -4, contrast: 18 }], ['vibrance', { vibrance: -10, sat: 0 }]] },
  { name: 'Luminoso', desc: 'Más luz y suavidad', layers: [['brightness', { brightness: 22, contrast: -8 }], ['vibrance', { vibrance: 12, sat: 0 }]] },
];

/** Crea un look: un grupo con sus capas de ajuste (se puede ocultar, bajar de opacidad o editar cada una). */
function applyLook(look: Look) {
  const d = app.doc; if (!d) return;
  const g = new GroupLayer('Look: ' + look.name);
  for (const [id, params] of look.layers) {
    const f = FILTERS.find(x => x.id === id); if (!f) continue;
    const l = new AdjustmentLayer(f.name.replace('…', ''), id, { ...defaultParams(f), ...(params ?? {}) });
    g.add(l);
  }
  if (d.selection.mask) { g.mask = new LayerMask(d.width, d.height, 'white'); g.mask.canvas = cloneCanvas(d.selection.mask); g.mask.touch(); }
  d.insertAboveActive(g); d.setActive(g); d.invalidate(); d.commit('Look: ' + look.name);
  app.toast(`Look «${look.name}» añadido como grupo de ajustes: baja su opacidad para suavizarlo`);
}

export function buildAdjustmentsPanel(parent: HTMLElement) {
  const list = FILTERS.filter(f => f.group === 'ajuste' && !f.noLayer);
  const grid = h('div', { class: 'adj-grid' }), looks = h('div', { class: 'adj-grid adj-looks' });
  const thumbs: { c: HTMLCanvasElement; run: (src: ImageData) => void }[] = [];
  for (const f of list) {
    const c = h('canvas', { width: 72, height: 48, class: 'adj-thumb' }) as HTMLCanvasElement;
    const b = h('button', { class: 'adj-item', type: 'button', title: f.name.replace('…', '') + ': se añade como capa de ajuste' }, c, h('span', {}, f.name.replace('…', '')));
    b.onclick = () => { if (!app.doc) { app.toast('Abre primero una imagen', 'warn'); return; } ops.newAdjustmentLayer(f); app.toast('Capa de ajuste añadida: cámbiala en Propiedades'); };
    grid.append(b);
    thumbs.push({ c, run: src => { const im = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height); try { f.apply(im, demoParams(f)); } catch { /* algún ajuste necesita más datos */ } ctx2d(c).putImageData(im, 0, 0); } });
  }
  for (const L of LOOKS) {
    const c = h('canvas', { width: 72, height: 48, class: 'adj-thumb' }) as HTMLCanvasElement;
    const b = h('button', { class: 'adj-item', type: 'button', title: L.desc }, c, h('span', {}, L.name));
    b.onclick = () => applyLook(L); looks.append(b);
    thumbs.push({ c, run: src => {
      const im = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
      for (const [id, params] of L.layers) { const f = FILTERS.find(x => x.id === id); if (f) try { f.apply(im, { ...defaultParams(f), ...(params ?? {}) }); } catch { /* */ } }
      ctx2d(c).putImageData(im, 0, 0);
    } });
  }
  parent.append(h('div', { class: 'panel-body adj-panel' },
    h('div', { class: 'hint' }, 'Toca un ajuste: se añade como capa encima (la foto no se estropea) y lo cambias en Propiedades.'),
    grid, h('div', { class: 'adj-head' }, 'Looks de un toque'), looks));
  // miniaturas con la imagen actual (solo cuando el panel se ve, y sin prisa)
  let t = 0, last = '';
  const refresh = () => {
    clearTimeout(t);
    t = window.setTimeout(() => {
      const d = app.doc; if (!d || !parent.offsetParent) return;
      const key = `${(d as any).__adjId ??= Math.random()}:${d.history.index}`; if (key === last) return; last = key;
      const comp = d.getComposite(), k = Math.max(72 / comp.width, 48 / comp.height), s = makeCanvas(72, 48), x = ctx2d(s);
      x.fillStyle = '#fff'; x.fillRect(0, 0, 72, 48); x.drawImage(comp, (72 - comp.width * k) / 2, (48 - comp.height * k) / 2, comp.width * k, comp.height * k);
      const src = x.getImageData(0, 0, 72, 48); let i = 0;
      // de pocas en pocas para no bloquear la ventana
      const step = () => { const end = Math.min(thumbs.length, i + 6); for (; i < end; i++) thumbs[i].run(src); if (i < thumbs.length) requestAnimationFrame(step); };
      step();
    }, 700);
  };
  app.on('doc', refresh); app.on('docs', refresh);
  new IntersectionObserver(e => { if (e.some(x => x.isIntersecting)) refresh(); }).observe(parent);
}
