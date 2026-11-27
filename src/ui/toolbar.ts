// Barra de herramientas vertical (izquierda) y colores.

import { TOOL_DESC } from './tooldesc';
import { app } from './app';
import { h } from './dom';
import { icon } from './icons';
import { colorDialog } from './colorpicker';
import { actionById } from './actions';
import type { Tool } from '../tools/tool';
import { toolAllowed } from './studio';

/** Orden de los botones. Los grupos comparten botón (clic derecho para elegir). */
const LAYOUT: string[][] = [
  ['move', 'artboardTool'], ['marqueeRect', 'marqueeEllipse', 'marqueeRow', 'marqueeCol'], ['lasso', 'polyLasso', 'magLasso'], ['objectSel', 'aiSel', 'quickSel', 'wand'], ['crop', 'perspCrop', 'slice'], ['frame'], ['eyedropper', 'colorSampler', 'ruler', 'note', 'count'],
  ['spotHeal', 'remove', 'heal', 'patch', 'contentMove', 'redEye', 'teeth', 'eyes', 'circles'], ['clone', 'patternStamp'], ['historyBrush', 'artHistory'], ['brush', 'pencil', 'pixel', 'colorReplace', 'mixer'], ['eraser', 'bgEraser', 'magicEraser'], ['gradient', 'bucket'], ['blurTool', 'sharpenTool', 'smudge'], ['dodge', 'burn', 'sponge'], ['text', 'textV', 'typeMaskV', 'typeMask'], ['pen', 'freePen', 'curvPen', 'addAnchor', 'delAnchor', 'convertPoint'], ['pathSelect', 'node'], ['shape'], ['hand', 'rotateView'], ['zoom'],
];

export function buildToolbar(parent: HTMLElement) {
  const bar = h('aside', { class: 'toolbar' });
  const buttons: { el: HTMLButtonElement; ids: string[] }[] = [];
  let flyout: HTMLElement | null = null;
  const closeFly = () => { flyout?.remove(); flyout = null; };

  // en cada botón se ve la herramienta en uso, la última elegida de su grupo o la primera que tiene sentido en el espacio de trabajo
  const toolOf = (ids: string[]) => app.tools.get(ids.includes(app.tool?.id) ? app.tool.id : (ids.find(i => i === app.groupChoice[app.tools.get(ids[0])!.group ?? ''] && toolAllowed(i)) ?? ids.find(toolAllowed) ?? ids[0]))!;

  // Cualquier herramienta registrada que no esté en la lista va en su grupo o en un botón propio al final
  const layout = LAYOUT.map(ids => ids.filter(id => app.tools.has(id))).filter(ids => ids.length);
  const placed = new Set(layout.flat());
  // (transformar y posición libre son modos temporales que se abren desde el menú Edición)
  for (const t of app.tools.values()) if (!placed.has(t.id) && !['transform', 'puppet', 'warp', 'perspWarp', 'vanish'].includes(t.id)) { const g = layout.find(ids => app.tools.get(ids[0])!.group && app.tools.get(ids[0])!.group === t.group); if (g) g.push(t.id); else layout.push([t.id]); placed.add(t.id); }
  for (const ids of layout) {
    const el = h('button', { class: 'tool-btn' + (ids.length > 1 ? ' grouped' : '') });
    const showFly = () => {
      closeFly();
      const r = el.getBoundingClientRect();
      flyout = h('div', { class: 'flyout', style: { left: r.right + 4 + 'px', top: r.top + 'px' } },
        ...ids.map(id => { const t = app.tools.get(id)!; return h('div', { class: 'fly-item', title: TOOL_DESC[id] ?? '', onclick: () => { app.setTool(id); closeFly(); } }, h('span', { html: t.icon }), h('span', { class: 'fly-name' }, t.name, TOOL_DESC[id] ? h('small', { class: 'fly-desc' }, TOOL_DESC[id]) : null), h('kbd', {}, t.key ?? '')); }));
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
  import('./drawing').then(m => m.colorDraggable(fgSw)); fgSw.title = 'Color frontal (clic para cambiar; arrástralo a una zona de la imagen para rellenarla)';
  swap.onclick = () => app.setColors(app.bg, app.fg);
  reset.onclick = () => app.setColors('#000000', '#ffffff');
  bar.append(h('div', { class: 'colors' }, bgSw, fgSw, swap, reset));
  const qm = h('button', { class: 'tool-btn qm-btn', title: 'Editar en modo máscara rápida (Q)', html: icon('quickMask') });
  qm.onclick = () => actionById.get('quickMask')!.run();
  bar.append(qm);
  const upQ = () => qm.classList.toggle('active', !!app.doc?.quickMask);
  app.on('doc', upQ); app.on('docs', upQ);

  const update = () => {
    for (const b of buttons) {
      const t: Tool = toolOf(b.ids);
      b.el.innerHTML = t.icon;
      b.el.title = `${t.name}${t.key ? ` (${t.key})` : ''}${TOOL_DESC[t.id] ? '\n' + TOOL_DESC[t.id] : ''}${b.ids.length > 1 ? '\nMantén pulsado o clic derecho para ver más' : ''}`;
      b.el.setAttribute('aria-label', t.name);
      b.el.classList.toggle('active', b.ids.includes(app.tool?.id));
      b.el.style.display = b.ids.some(toolAllowed) ? '' : 'none';
    }
    fgSw.style.background = app.fg; bgSw.style.background = app.bg;
  };
  app.on('tool', update); app.on('colors', update); app.on('workspace', update);
  update();
  parent.append(bar);
}
