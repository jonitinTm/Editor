// Barra de herramientas vertical (izquierda) y colores.

import { app } from './app';
import { h } from './dom';
import { icon } from './icons';
import { colorDialog } from './colorpicker';
import type { Tool } from '../tools/tool';

/** Orden de los botones. Los grupos comparten botón (clic derecho para elegir). */
const LAYOUT: string[][] = [
  ['move'], ['marqueeRect', 'marqueeEllipse'], ['lasso', 'polyLasso'], ['wand'], ['crop'], ['eyedropper'],
  ['clone'], ['brush', 'pencil'], ['eraser'], ['gradient', 'bucket'], ['blurTool', 'sharpenTool', 'smudge'], ['dodge', 'burn'], ['text'], ['pen', 'node'], ['shape'], ['hand'], ['zoom'],
];

export function buildToolbar(parent: HTMLElement) {
  const bar = h('aside', { class: 'toolbar' });
  const buttons: { el: HTMLButtonElement; ids: string[] }[] = [];
  let flyout: HTMLElement | null = null;
  const closeFly = () => { flyout?.remove(); flyout = null; };

  const toolOf = (ids: string[]) => app.tools.get(ids.includes(app.tool?.id) ? app.tool.id : (ids.find(i => i === app.groupChoice[app.tools.get(ids[0])!.group ?? '']) ?? ids[0]))!;

  for (const ids of LAYOUT) {
    const el = h('button', { class: 'tool-btn' + (ids.length > 1 ? ' grouped' : '') });
    const showFly = () => {
      closeFly();
      const r = el.getBoundingClientRect();
      flyout = h('div', { class: 'flyout', style: { left: r.right + 4 + 'px', top: r.top + 'px' } },
        ...ids.map(id => { const t = app.tools.get(id)!; return h('div', { class: 'fly-item', onclick: () => { app.setTool(id); closeFly(); } }, h('span', { html: t.icon }), h('span', {}, t.name), h('kbd', {}, t.key ?? '')); }));
      document.body.append(flyout);
    };
    el.addEventListener('click', () => app.setTool(toolOf(ids).id));
    el.addEventListener('contextmenu', e => { e.preventDefault(); if (ids.length > 1) showFly(); });
    let timer = 0;
    el.addEventListener('pointerdown', () => { if (ids.length > 1) timer = window.setTimeout(showFly, 450); });
    el.addEventListener('pointerup', () => clearTimeout(timer));
    el.addEventListener('pointerleave', () => clearTimeout(timer));
    buttons.push({ el, ids });
    bar.append(el);
  }
  document.addEventListener('pointerdown', e => { if (flyout && !flyout.contains(e.target as Node)) closeFly(); });

  // Colores frontal / fondo
  const fgSw = h('button', { class: 'swatch fg', title: 'Color frontal (clic para cambiar)' });
  const bgSw = h('button', { class: 'swatch bg', title: 'Color de fondo (clic para cambiar)' });
  const swap = h('button', { class: 'mini-btn swap', title: 'Intercambiar colores (X)', html: icon('swap') });
  const reset = h('button', { class: 'mini-btn reset', title: 'Colores por defecto (D)' }, h('span', { class: 'mini-fg' }), h('span', { class: 'mini-bg' }));
  const pick = async (w: 'fg' | 'bg') => {
    const c = await colorDialog(w === 'fg' ? 'Selector de color (color frontal)' : 'Selector de color (color de fondo)', w === 'fg' ? app.fg : app.bg);
    if (c) w === 'fg' ? app.setColors(c, app.bg) : app.setColors(app.fg, c);
  };
  fgSw.onclick = () => pick('fg'); bgSw.onclick = () => pick('bg');
  swap.onclick = () => app.setColors(app.bg, app.fg);
  reset.onclick = () => app.setColors('#000000', '#ffffff');
  bar.append(h('div', { class: 'colors' }, bgSw, fgSw, swap, reset));

  const update = () => {
    for (const b of buttons) {
      const t: Tool = toolOf(b.ids);
      b.el.innerHTML = t.icon;
      b.el.title = `${t.name}${t.key ? ` (${t.key})` : ''}${b.ids.length > 1 ? ' — clic derecho para más' : ''}`;
      b.el.classList.toggle('active', b.ids.includes(app.tool?.id));
    }
    fgSw.style.background = app.fg; bgSw.style.background = app.bg;
  };
  app.on('tool', update); app.on('colors', update);
  update();
  parent.append(bar);
}
