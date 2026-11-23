// Panel «Ajustes»: un toque crea una capa de ajuste (no estropea la foto y se puede cambiar o borrar después).
// Cada botón muestra una miniatura de tu propia imagen con ese ajuste. Debajo, «looks» de un toque que se
// crean como un grupo de capas de ajuste editables.

import { app } from './app';
import { h } from './dom';
import { FILTERS, FilterDef, defaultParams } from '../filters/registry';
import { AdjustmentLayer, GroupLayer, LayerMask } from '../core/layers';
import { cloneCanvas, ctx2d, makeCanvas } from '../core/canvas';
import * as ops from './ops';
import { prefs, savePrefs } from './prefs';

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

// looks propios (se guardan en este navegador)
const LOOK_KEY = 'editor.looks';
function myLooks(): Look[] { try { const v = JSON.parse(localStorage.getItem(LOOK_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
function saveMyLooks(v: Look[]) { try { localStorage.setItem(LOOK_KEY, JSON.stringify(v)); } catch { app.toast('No se pudo guardar el look', 'warn'); } }
/** Las capas de ajuste del grupo activo (o las seleccionadas), de abajo arriba. */
function adjustmentsForLook(): [string, any][] {
  const d = app.doc; if (!d) return [];
  const a = d.active, sel = d.allLayers().filter(l => d.selectedIds?.has(l.id));
  const src = a instanceof GroupLayer ? a.children : sel.length ? sel : a ? [a] : [];
  return src.filter((l): l is AdjustmentLayer => l instanceof AdjustmentLayer).map(l => [l.filterId, JSON.parse(JSON.stringify(l.params))]);
}
async function saveLook(after: () => void) {
  const layers = adjustmentsForLook();
  if (!layers.length) { app.toast('Selecciona un grupo con capas de ajuste (o varias capas de ajuste) para guardarlas como look', 'warn'); return; }
  const { promptDialog } = await import('./dialog');
  const d = app.doc!, base = d.active instanceof GroupLayer ? d.active.name.replace(/^Look: /, '') : 'Mi look';
  const name = (await promptDialog('Guardar como look', `Nombre (${layers.length} ajuste${layers.length > 1 ? 's' : ''})`, base))?.trim(); if (!name) return;
  saveMyLooks([...myLooks().filter(l => l.name !== name), { name, desc: 'Mío', layers }]); after(); app.toast(`Look «${name}» guardado: aparece en «Mis looks»`);
}

/** Crea un look: un grupo con sus capas de ajuste (se puede ocultar, bajar de opacidad o editar cada una). */
async function applyLook(look: Look) {
  const d = app.doc; if (!d) return;
  if (!prefs.autoLayers) {
    // directamente sobre la capa elegida, en un solo paso del historial
    if (!d.activeRaster()) { app.toast('Elige una capa de imagen', 'warn'); return; }
    const n0 = d.history.index;
    for (const [id, params] of look.layers) { const f = FILTERS.find(x => x.id === id); if (f) await ops.applyFilterDirect(f, { ...defaultParams(f), ...(params ?? {}) }); }
    const hs = d.history; if (hs.index > n0 + 1) { const last = hs.steps[hs.index]; hs.steps.splice(n0 + 1, hs.index - n0); hs.steps.splice(n0 + 1, 0, { ...last, name: 'Look: ' + look.name }); hs.index = n0 + 1; } else if (hs.index === n0 + 1) hs.steps[hs.index].name = 'Look: ' + look.name;
    app.emit('doc'); app.toast(`Look «${look.name}» aplicado`); return;
  }
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
  const grid = h('div', { class: 'adj-grid' }), looks = h('div', { class: 'adj-grid adj-looks' }), mine = h('div', { class: 'adj-grid adj-looks adj-mine' });
  const thumbs: { c: HTMLCanvasElement; run: (src: ImageData) => void }[] = [];
  for (const f of list) {
    const c = h('canvas', { width: 72, height: 48, class: 'adj-thumb' }) as HTMLCanvasElement;
    const b = h('button', { class: 'adj-item', type: 'button', title: f.name.replace('…', '') + ': se añade como capa de ajuste' }, c, h('span', {}, f.name.replace('…', '')));
    b.onclick = async () => {
      if (!app.doc) { app.toast('Abre primero una imagen', 'warn'); return; }
      if (prefs.autoLayers) { ops.newAdjustmentLayer(f); app.toast('Capa de ajuste añadida: cámbiala en Propiedades'); return; }
      if (!app.doc.activeRaster()) { app.toast('Elige una capa de imagen', 'warn'); return; }
      const { filterDialog } = await import('./dialogs'); f.prepare?.(); filterDialog(f);
    };
    grid.append(b);
    thumbs.push({ c, run: src => { const im = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height); try { f.apply(im, demoParams(f)); } catch { /* algún ajuste necesita más datos */ } ctx2d(c).putImageData(im, 0, 0); } });
  }
  const lookThumbs: typeof thumbs = [];
  const addLook = (L: Look, into: HTMLElement, del?: () => void) => {
    const c = h('canvas', { width: 72, height: 48, class: 'adj-thumb' }) as HTMLCanvasElement;
    const b = h('button', { class: 'adj-item', type: 'button', title: L.desc }, c, h('span', {}, L.name));
    b.onclick = () => applyLook(L); into.append(b);
    if (del) { const x = h('span', { class: 'adj-del', title: 'Borrar este look', role: 'button' }, '✕'); x.onclick = e => { e.stopPropagation(); del(); }; b.append(x); }
    lookThumbs.push({ c, run: src => {
      const im = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
      for (const [id, params] of L.layers) { const f = FILTERS.find(x => x.id === id); if (f) try { f.apply(im, { ...defaultParams(f), ...(params ?? {}) }); } catch { /* */ } }
      ctx2d(c).putImageData(im, 0, 0);
    } });
  };
  for (const L of LOOKS) addLook(L, looks);
  const builtinThumbs = lookThumbs.length;
  const fillMine = () => {
    mine.innerHTML = ''; lookThumbs.length = builtinThumbs;
    const list = myLooks(); mineHead.style.display = list.length ? '' : 'none';
    list.forEach(L => addLook(L, mine, () => { saveMyLooks(myLooks().filter(x => x.name !== L.name)); fillMine(); }));
    last = ''; refresh();
  };
  const mineHead = h('div', { class: 'adj-head' }, 'Mis looks');
  const hint = h('div', { class: 'hint' });
  const modeCb = h('input', { type: 'checkbox', checked: prefs.autoLayers }) as HTMLInputElement;
  const setHint = () => { hint.textContent = prefs.autoLayers ? 'Toca un ajuste: se añade como capa encima (la foto no se estropea) y lo cambias en Propiedades.' : 'Toca un ajuste para aplicarlo a la capa elegida (Ctrl+Z lo deshace).'; };
  modeCb.onchange = () => { prefs.autoLayers = modeCb.checked; savePrefs(); setHint(); };
  setHint();
  const saveBtn = h('button', { class: 'btn adj-save', type: 'button', title: 'Guarda las capas de ajuste del grupo seleccionado para usarlas en otras fotos' }, '＋ Guardar como look');
  saveBtn.onclick = () => saveLook(fillMine);
  parent.append(h('div', { class: 'panel-body adj-panel' },
    hint, h('label', { class: 'check adj-mode' }, modeCb, ' Como capa de ajuste (se puede cambiar después)'),
    grid, h('div', { class: 'adj-head' }, 'Looks de un toque'), looks, mineHead, mine, saveBtn));
  // miniaturas con la imagen actual (solo cuando el panel se ve, y sin prisa)
  let t = 0, last = '';
  const refresh = () => {
    clearTimeout(t);
    t = window.setTimeout(() => {
      const d = app.doc; if (!d || !parent.offsetParent) return;
      const key = `${(d as any).__adjId ??= Math.random()}:${d.history.index}`; if (key === last) return; last = key;
      const comp = d.getComposite(), k = Math.max(72 / comp.width, 48 / comp.height), s = makeCanvas(72, 48), x = ctx2d(s);
      x.fillStyle = '#fff'; x.fillRect(0, 0, 72, 48); x.drawImage(comp, (72 - comp.width * k) / 2, (48 - comp.height * k) / 2, comp.width * k, comp.height * k);
      const src = x.getImageData(0, 0, 72, 48), all = [...thumbs, ...lookThumbs]; let i = 0;
      // de pocas en pocas para no bloquear la ventana
      const step = () => { const end = Math.min(all.length, i + 6); for (; i < end; i++) all[i].run(src); if (i < all.length) requestAnimationFrame(step); };
      step();
    }, 700);
  };
  app.on('doc', refresh); app.on('docs', refresh);
  fillMine();
  new IntersectionObserver(e => { if (e.some(x => x.isIntersecting)) refresh(); }).observe(parent);
}
