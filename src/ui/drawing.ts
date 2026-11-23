// Dibujo con lápiz: barras laterales de tamaño y opacidad (como en las apps de dibujo de tablet),
// modo dibujo a pantalla completa y ajustes del lápiz (curva de presión con zona de prueba).

import { app } from './app';
import { h } from './dom';
import { icon } from './icons';
import { prefs, savePrefs, penPressure } from './prefs';
import { showDialog, row } from './dialog';
import * as ops from './ops';

const PAINT = (id?: string) => !!id && typeof app.opt('size', id) === 'number';

/** Barra vertical que se arrastra con el dedo o el lápiz (valor de 0 a 1). */
function vslider(cls: string, title: string, get: () => number, set: (v: number) => void, label: () => string, onDrag?: (on: boolean) => void) {
  const fill = h('div', { class: 'ss-fill' }), knob = h('div', { class: 'ss-knob' }), tip = h('div', { class: 'ss-tip' });
  const el = h('div', { class: 'ss-bar ' + cls, title, role: 'slider', 'aria-label': title }, fill, knob, tip);
  const paint = () => { const v = Math.max(0, Math.min(1, get())); fill.style.height = v * 100 + '%'; knob.style.bottom = `calc(${v * 100}% - 9px)`; tip.textContent = label(); el.setAttribute('aria-valuenow', label()); };
  const at = (e: PointerEvent) => { const r = el.getBoundingClientRect(); set(Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))); paint(); };
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); el.classList.add('drag'); onDrag?.(true); at(e);
    const mv = (ev: PointerEvent) => at(ev), up = () => { el.classList.remove('drag'); onDrag?.(false); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); app.saveOpts(); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
  return { el, paint };
}

/** Tamaño (escala logarítmica, 1–500 px) y opacidad a un lado del lienzo. */
export function buildSideSliders(host: HTMLElement) {
  const preview = h('div', { class: 'size-preview' });
  const id = () => app.tool?.id;
  const size = vslider('ss-size', 'Tamaño del pincel', () => Math.log(Math.max(1, app.opt<number>('size', id()) ?? 1)) / Math.log(500),
    v => { app.setOpt(id()!, 'size', Math.max(1, Math.round(Math.exp(v * Math.log(500))))); showPreview(); }, () => (app.opt<number>('size', id()) ?? 0) + ' px',
    on => { preview.classList.toggle('on', on); if (on) showPreview(); });
  // al mover la barra de tamaño, un círculo en el centro enseña lo grande que pintará (con el zoom actual)
  function showPreview() {
    const d = Math.min(Math.max(host.clientWidth, host.clientHeight), (app.opt<number>('size', id()) ?? 1) * (app.viewport?.zoom ?? 1));
    preview.style.width = preview.style.height = Math.max(2, d) + 'px';
  }
  const op = vslider('ss-op', 'Opacidad', () => ((app.opt<number>('opacity', id()) ?? 100) - 1) / 99,
    v => app.setOpt(id()!, 'opacity', Math.round(1 + v * 99)), () => (app.opt<number>('opacity', id()) ?? 100) + ' %');
  const undo = h('button', { class: 'ss-btn', type: 'button', title: 'Deshacer', 'aria-label': 'Deshacer', html: icon('undo') });
  const redo = h('button', { class: 'ss-btn', type: 'button', title: 'Rehacer', 'aria-label': 'Rehacer', html: icon('redo') });
  undo.onclick = () => ops.undo(); redo.onclick = () => ops.redo();
  host.append(preview);
  const name = (t: string) => h('span', { class: 'ss-name' }, t);
  const wrap = h('div', { class: 'side-sliders' }, name('Tamaño'), size.el, h('div', { class: 'ss-gap' }), name('Opacidad'), op.el, undo, redo);
  host.append(wrap);
  const update = () => {
    const want = prefs.sideSliders === 'on' || (prefs.sideSliders === 'auto' && (app.viewport?.penSeen || document.body.classList.contains('draw-mode') || (matchMedia('(pointer: coarse)').matches && innerWidth >= 700)));
    const show = !!want && !!app.doc && PAINT(id());
    wrap.classList.toggle('on', show);
    if (show) { size.paint(); op.paint(); op.el.style.display = app.opt('opacity', id()) === undefined ? 'none' : ''; }
  };
  app.on('tool', update); app.on('options', update); app.on('docs', update); app.on('pen', update);
  addEventListener('resize', update); update();
  (window as any).__sideSliders = update;
}

// ---- Modo dibujo ------------------------------------------------------------------------------
let miniBar: HTMLElement | null = null;
let byUs = false;
// salir de la pantalla completa (Esc o el gesto del sistema) también sale del modo dibujo
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && byUs) { byUs = false; if (document.body.classList.contains('draw-mode')) toggleDrawMode(false); } });
/** Pantalla completa con solo el lienzo y una barrita: pincel, goma, cuentagotas, color, deshacer y salir. */
export function toggleDrawMode(force?: boolean) {
  const on = force ?? !document.body.classList.contains('draw-mode');
  document.body.classList.toggle('draw-mode', on);
  if (on) {
    if (!miniBar) {
      const tool = (tid: string, ic: string, title: string) => { const b = h('button', { class: 'dm-btn', type: 'button', title, 'aria-label': title, 'data-tool': tid, html: icon(ic) }, h('span', { class: 'dm-lbl' }, title)); b.onclick = () => app.setTool(tid); return b; };
      const sw = h('button', { class: 'dm-btn dm-color', type: 'button', title: 'Color', 'aria-label': 'Color' }, h('span', { class: 'dm-lbl' }, 'Color'));
      sw.onclick = () => import('./artist').then(m => m.colorPopover(sw));
      const ref = h('button', { class: 'dm-btn', type: 'button', title: 'Imagen de referencia', 'aria-label': 'Imagen de referencia', html: icon('image') }, h('span', { class: 'dm-lbl' }, 'Referencia'));
      ref.onclick = () => import('./artist').then(m => m.toggleReference());
      const gal = h('button', { class: 'dm-btn', type: 'button', title: 'Añadir foto de la galería como capa', 'aria-label': 'Añadir foto de la galería como capa', html: icon('plus') }, h('span', { class: 'dm-lbl' }, 'Galería'));
      gal.onclick = async () => { const io = await import('../io/files'); ops.openAsLayers(await io.pickFiles('image/*')); };
      const u = h('button', { class: 'dm-btn', type: 'button', title: 'Deshacer', 'aria-label': 'Deshacer', html: icon('undo') }, h('span', { class: 'dm-lbl' }, 'Deshacer')), r = h('button', { class: 'dm-btn', type: 'button', title: 'Rehacer', 'aria-label': 'Rehacer', html: icon('redo') }, h('span', { class: 'dm-lbl' }, 'Rehacer'));
      u.onclick = () => ops.undo(); r.onclick = () => ops.redo();
      const br = h('button', { class: 'dm-btn dm-presets', type: 'button', title: 'Pinceles' }, 'Pinceles');
      br.onclick = ev => { ev.stopPropagation(); if (app.tool?.id !== 'brush') app.setTool('brush'); import('./optionsbar').then(m => m.presetMenu(br, app.tool)); };
      const x = h('button', { class: 'dm-btn dm-exit', type: 'button', title: 'Salir del modo dibujo', 'aria-label': 'Salir del modo dibujo', html: icon('close') }, h('span', { class: 'dm-lbl' }, 'Salir'));
      x.onclick = () => toggleDrawMode(false);
      miniBar = h('div', { class: 'draw-bar' }, tool('brush', 'brush', 'Pincel'), tool('eraser', 'eraser', 'Borrador'), tool('smudge', 'finger', 'Dedo'), tool('eyedropper', 'eyedropper', 'Cuentagotas'), br, sw, ref, gal, u, r, x);
      document.body.append(miniBar);
      const sync = () => {
        miniBar!.querySelectorAll<HTMLElement>('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === app.tool?.id));
        sw.style.background = app.fg;
      };
      app.on('tool', sync); app.on('colors', sync); sync();
    }
    if (!PAINT(app.tool?.id)) app.setTool('brush');
    try { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().then(() => { byUs = true; }).catch(() => { /* no permitido */ }); } catch { /* */ }
    app.toast('Modo dibujo: 2 dedos = deshacer · 3 dedos = rehacer · pellizca para ampliar y girar');
  } else {
    try { if (document.fullscreenElement && byUs) { byUs = false; document.exitFullscreen?.(); } } catch { /* */ }
  }
  (window as any).__sideSliders?.();
  // más (o menos) sitio para la imagen: se vuelve a encajar
  requestAnimationFrame(() => { app.viewport.resize(); if (app.doc) app.viewport.fit(); });
}

// ---- Ajustes del lápiz ------------------------------------------------------------------------
export function penSettingsDialog() {
  const before = { ...prefs };
  const graph = h('canvas', { class: 'pen-graph', width: 120, height: 120 }) as HTMLCanvasElement;
  const pad = h('canvas', { class: 'pen-pad', width: 360, height: 150 }) as HTMLCanvasElement;
  const curve = h('input', { type: 'range', min: -100, max: 100, value: prefs.penCurve }) as HTMLInputElement;
  const min = h('input', { type: 'range', min: 0, max: 50, value: prefs.penMin }) as HTMLInputElement;
  const live = h('div', { class: 'hint pen-live' }, 'Prueba aquí con tu lápiz.');
  const drawGraph = () => {
    const x = graph.getContext('2d')!, W = graph.width;
    x.clearRect(0, 0, W, W); x.fillStyle = 'rgba(127,127,127,.15)'; x.fillRect(0, 0, W, W);
    x.strokeStyle = 'rgba(127,127,127,.5)'; x.setLineDash([3, 3]); x.beginPath(); x.moveTo(0, W); x.lineTo(W, 0); x.stroke(); x.setLineDash([]);
    x.strokeStyle = '#3d8bfd'; x.lineWidth = 2.5; x.beginPath();
    for (let i = 0; i <= 40; i++) { const p = i / 40, y = penPressure(p); i ? x.lineTo(p * W, W - y * W) : x.moveTo(0, W - y * W); }
    x.stroke();
  };
  const apply = () => { prefs.penCurve = +curve.value; prefs.penMin = +min.value; drawGraph(); };
  curve.oninput = apply; min.oninput = apply;
  // zona de prueba: el grosor sigue a la presión con la curva actual
  let last: { x: number; y: number; w: number } | null = null;
  const pctx = pad.getContext('2d')!;
  const clearPad = () => { pctx.fillStyle = '#fff'; pctx.fillRect(0, 0, pad.width, pad.height); };
  clearPad();
  const pt = (e: PointerEvent) => { const r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) * pad.width / r.width, y: (e.clientY - r.top) * pad.height / r.height }; };
  pad.addEventListener('pointerdown', e => { e.preventDefault(); pad.setPointerCapture(e.pointerId); const p = pt(e); last = { ...p, w: 0 }; });
  pad.addEventListener('pointermove', e => {
    if (!last) return;
    for (const ev of ((e as any).getCoalescedEvents?.() as PointerEvent[] | undefined) ?? [e]) {
      const p = pt(ev), raw = ev.pointerType === 'pen' ? ev.pressure || 0.5 : 0.5, w = 1 + 13 * penPressure(raw);
      pctx.strokeStyle = '#111'; pctx.lineCap = 'round'; pctx.lineWidth = (w + last.w || w) / 2;
      pctx.beginPath(); pctx.moveTo(last.x, last.y); pctx.lineTo(p.x, p.y); pctx.stroke(); last = { ...p, w };
      live.textContent = ev.pointerType === 'pen' ? `Presión del lápiz: ${Math.round(raw * 100)} % → ${Math.round(penPressure(raw) * 100)} %` : 'Esto es un ratón o un dedo: la presión solo funciona con un lápiz.';
    }
  });
  const stop = () => { last = null; };
  pad.addEventListener('pointerup', stop); pad.addEventListener('pointercancel', stop);
  const clr = h('button', { class: 'btn', type: 'button' }, 'Borrar prueba'); clr.onclick = clearPad;
  const sel = <T extends string>(v: T, opts: [T, string][]) => h('select', {}, ...opts.map(([k, n]) => h('option', { value: k, selected: v === k }, n))) as HTMLSelectElement;
  const penOnly = sel(prefs.penOnly, [['auto', 'Automático (al usar un lápiz)'], ['on', 'Siempre'], ['off', 'Nunca (el dedo también dibuja)']]);
  const side = sel(prefs.sideSliders, [['auto', 'Automático (tablet o lápiz)'], ['on', 'Siempre'], ['off', 'Nunca']]);
  const rot = h('input', { type: 'checkbox', checked: prefs.pinchRotate }) as HTMLInputElement;
  const gest = h('input', { type: 'checkbox', checked: prefs.touchGestures }) as HTMLInputElement;
  const presets = h('div', { class: 'pen-presets' }, ...([['Suave', 60, 0], ['Normal', 0, 0], ['Firme', -55, 0], ['Siempre se ve', 20, 15]] as [string, number, number][]).map(([n, c, m]) => {
    const b = h('button', { class: 'btn', type: 'button' }, n); b.onclick = () => { curve.value = String(c); min.value = String(m); apply(); }; return b;
  }));
  showDialog({
    title: 'Ajustes del lápiz', width: 420,
    body: [
      h('div', { class: 'dlg-section' }, 'Presión'),
      h('div', { class: 'pen-curve' }, graph, h('div', { class: 'pen-curve-ctl' },
        row('Curva', curve), h('div', { class: 'hint' }, 'A la derecha: con poca fuerza ya sale grueso. A la izquierda: hay que apretar más.'),
        row('Presión mínima', min), presets)),
      pad, h('div', { class: 'pen-pad-row' }, live, clr),
      h('div', { class: 'dlg-section' }, 'Dedos y lápiz'),
      row('El dedo solo mueve la vista', penOnly),
      row('', h('label', { class: 'check' }, rot, ' Girar la vista con dos dedos')),
      row('', h('label', { class: 'check' }, gest, ' Tocar con 2 dedos = deshacer, con 3 = rehacer')),
      row('Barras de tamaño y opacidad', side),
      h('div', { class: 'hint' }, 'Botón lateral del lápiz: coge un color. Goma del lápiz (si la tiene): borra. Mantén el dedo quieto sobre la imagen para coger un color.'),
    ],
    onOk: () => { Object.assign(prefs, { penCurve: +curve.value, penMin: +min.value, penOnly: penOnly.value, sideSliders: side.value, pinchRotate: rot.checked, touchGestures: gest.checked }); savePrefs(); (window as any).__sideSliders?.(); app.toast('Ajustes del lápiz guardados'); },
    onCancel: () => { Object.assign(prefs, before); },
  });
  drawGraph();
}
