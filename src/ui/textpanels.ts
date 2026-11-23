// Paneles Carácter y Párrafo: todas las opciones del texto de la capa seleccionada en un solo sitio.

import { app } from './app';
import { h } from './dom';
import { icon } from './icons';
import { TextLayer, type TextProps } from '../core/layers';
import { fontPicker } from './fontpicker';
import { colorDialog } from './colorpicker';

const visible = (el: HTMLElement) => el.offsetParent !== null;
const activeText = (): TextLayer | null => { const l = app.doc?.active; return l instanceof TextLayer ? l : null; };

/** Aplica un cambio a la capa de texto activa (se agrupa en un solo paso de historial si se cambia seguido). */
let commitTimer = 0;
function change(name: string, fn: (p: TextProps) => void) {
  const l = activeText(), d = app.doc; if (!l || !d) return;
  if (l.isLocked()) { app.toast('La capa está bloqueada', 'warn'); return; }
  fn(l.props); l.render(); d.invalidate();
  clearTimeout(commitTimer); commitTimer = window.setTimeout(() => d.commit(name), 350);
}

/** Campo numérico con unidad que se puede cambiar arrastrando el ratón sobre su etiqueta. */
function numField(icon: string, title: string, get: () => number, set: (v: number) => void, o: { min?: number; max?: number; step?: number; unit?: string } = {}) {
  const inp = h('input', { type: 'number', class: 'num', step: o.step ?? 1, min: o.min, max: o.max }) as HTMLInputElement;
  const clamp = (v: number) => Math.max(o.min ?? -1e9, Math.min(o.max ?? 1e9, v));
  inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (!isNaN(v)) set(clamp(v)); });
  const lab = h('span', { class: 'tp-ico', title: title + ' (arrastra para cambiar)' }, icon);
  lab.addEventListener('pointerdown', e => {
    const x0 = e.clientX, v0 = get(); lab.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => { const v = clamp(Math.round((v0 + (ev.clientX - x0) * (o.step ?? 1)) * 100) / 100); inp.value = String(v); set(v); };
    const up = () => { lab.removeEventListener('pointermove', mv); lab.removeEventListener('pointerup', up); };
    lab.addEventListener('pointermove', mv); lab.addEventListener('pointerup', up);
  });
  const el = h('label', { class: 'tp-field', title }, lab, inp, o.unit ? h('span', { class: 'tp-unit' }, o.unit) : null);
  return { el, sync: () => { if (document.activeElement !== inp) inp.value = String(Math.round(get() * 100) / 100); } };
}

function toggle(label: string, title: string, get: () => boolean, set: (v: boolean) => void, style = '') {
  const b = h('button', { class: 'btn icon-btn tp-tog', title, style, 'aria-label': title, html: label.startsWith('<svg') ? label : undefined }, label.startsWith('<svg') ? '' : label) as HTMLButtonElement;
  b.onclick = () => set(!get());
  return { el: b, sync: () => b.classList.toggle('on', get()) };
}

function shell(parent: HTMLElement, build: (body: HTMLElement) => (() => void)) {
  const body = h('div', { class: 'panel-body tp-body' });
  const empty = h('div', { class: 'hint tp-empty' }, 'Selecciona una capa de texto (o crea una con la herramienta Texto, T).');
  const content = h('div', { class: 'tp-content' });
  body.append(empty, content); parent.append(body);
  const sync = build(content);
  const render = () => { if (!visible(body)) return; const l = activeText(); empty.style.display = l ? 'none' : ''; content.style.display = l ? '' : 'none'; if (l) sync(); };
  app.on('doc', render); app.on('docs', render);
  new MutationObserver(render).observe(parent, { attributes: true, attributeFilter: ['class'] });
  render();
}

export function buildCharacterPanel(parent: HTMLElement) {
  shell(parent, body => {
    const P = () => activeText()!.props;
    const syncs: (() => void)[] = [];
    const fontBox = h('div', { class: 'tp-font' });
    let fontVal = '';
    const style = h('select', { title: 'Estilo de la fuente' }, ...[['n', 'Normal'], ['b', 'Negrita'], ['i', 'Cursiva'], ['bi', 'Negrita cursiva']].map(([v, n]) => h('option', { value: v }, n))) as HTMLSelectElement;
    style.onchange = () => change('Carácter', p => { p.bold = style.value.includes('b'); p.italic = style.value.includes('i'); });
    const size = numField('T', 'Tamaño de la fuente', () => P().size, v => change('Carácter', p => { p.size = Math.max(1, v); }), { min: 1, max: 2000, unit: 'px' });
    const lead = numField('↕', 'Interlineado', () => P().size * P().lineHeight, v => change('Carácter', p => { p.lineHeight = Math.max(0.1, v / p.size); }), { min: 1, max: 4000, unit: 'px' });
    const track = numField('VA', 'Interletraje (milésimas de em)', () => P().tracking ?? 0, v => change('Carácter', p => { p.tracking = v; }), { min: -500, max: 2000, step: 5 });
    const vsc = numField('↥T', 'Escala vertical', () => (P().vScale ?? 1) * 100, v => change('Carácter', p => { p.vScale = Math.max(0.01, v / 100); }), { min: 1, max: 1000, unit: '%' });
    const hsc = numField('↦T', 'Escala horizontal', () => (P().hScale ?? 1) * 100, v => change('Carácter', p => { p.hScale = Math.max(0.01, v / 100); }), { min: 1, max: 1000, unit: '%' });
    const base = numField('A⁺', 'Desplazamiento de la línea base', () => P().baseline ?? 0, v => change('Carácter', p => { p.baseline = v; }), { min: -1000, max: 1000, unit: 'px' });
    const color = h('button', { class: 'tp-color', title: 'Color del texto' }) as HTMLButtonElement;
    color.onclick = async () => { const l = activeText(); if (!l) return; const c = await colorDialog('Color del texto', l.props.color); if (c) change('Color de texto', p => { p.color = c; }); };
    const tg = [
      toggle('B', 'Negrita', () => !!P().bold, v => change('Carácter', p => { p.bold = v; }), 'font-weight:700'),
      toggle('I', 'Cursiva', () => !!P().italic, v => change('Carácter', p => { p.italic = v; }), 'font-style:italic'),
      toggle('TT', 'Todo mayúsculas', () => !!P().caps, v => change('Carácter', p => { p.caps = v; if (v) p.smallCaps = false; })),
      toggle('Tᴛ', 'Versalitas', () => !!P().smallCaps, v => change('Carácter', p => { p.smallCaps = v; if (v) p.caps = false; })),
      toggle('U', 'Subrayado', () => !!P().underline, v => change('Carácter', p => { p.underline = v; }), 'text-decoration:underline'),
      toggle('S', 'Tachado', () => !!P().strike, v => change('Carácter', p => { p.strike = v; }), 'text-decoration:line-through'),
    ];
    const aa = h('select', { title: 'Suavizado de los bordes' }, h('option', { value: 'smooth' }, 'Suavizado: suave'), h('option', { value: 'none' }, 'Suavizado: ninguno')) as HTMLSelectElement;
    aa.onchange = () => change('Carácter', p => { p.antialias = aa.value as any; });
    syncs.push(size.sync, lead.sync, track.sync, vsc.sync, hsc.sync, base.sync, ...tg.map(t => t.sync), () => {
      const p = P();
      if (fontVal !== p.font) { fontVal = p.font; fontBox.innerHTML = ''; fontBox.append(fontPicker(p.font, f => { fontVal = f; change('Fuente', q => { q.font = f; }); })); }
      style.value = (p.bold ? 'b' : '') + (p.italic ? 'i' : '') || 'n';
      color.style.background = p.color; aa.value = p.antialias ?? 'smooth';
    });
    body.append(
      h('div', { class: 'tp-row' }, fontBox), h('div', { class: 'tp-row' }, style),
      h('div', { class: 'tp-grid' }, size.el, lead.el, track.el, base.el, vsc.el, hsc.el),
      h('div', { class: 'tp-row tp-row-c' }, h('span', { class: 'hint' }, 'Color'), color),
      h('div', { class: 'tp-row tp-toggles' }, ...tg.map(t => t.el)),
      h('div', { class: 'tp-row' }, aa));
    return () => syncs.forEach(f => f());
  });
}

export function buildParagraphPanel(parent: HTMLElement) {
  shell(parent, body => {
    const P = () => activeText()!.props;
    const al = ([['left', icon('txtL'), 'Alinear a la izquierda'], ['center', icon('txtC'), 'Centrar'], ['right', icon('txtR'), 'Alinear a la derecha'], ['justify', icon('txtJ'), 'Justificar (texto de párrafo; la última línea a la izquierda)']] as const)
      .map(([v, ic, t]) => toggle(ic, t, () => P().align === v, () => change('Párrafo', p => { p.align = v; })));
    const f = (ic: string, t: string, k: 'indentLeft' | 'indentRight' | 'indentFirst' | 'spaceBefore' | 'spaceAfter') => numField(ic, t, () => P()[k] ?? 0, v => change('Párrafo', p => { p[k] = v; }), { min: -2000, max: 2000, unit: 'px' });
    const fields = [f('⇥', 'Sangría izquierda', 'indentLeft'), f('⇤', 'Sangría derecha', 'indentRight'), f('↳', 'Sangría de primera línea', 'indentFirst'), f('⤒', 'Espacio antes del párrafo', 'spaceBefore'), f('⤓', 'Espacio después del párrafo', 'spaceAfter')];
    const note = h('div', { class: 'hint' }, '');
    body.append(h('div', { class: 'tp-row tp-toggles' }, ...al.map(a => a.el)), h('div', { class: 'tp-grid' }, ...fields.map(x => x.el)), note);
    return () => {
      al.forEach(a => a.sync()); fields.forEach(x => x.sync());
      note.textContent = P().boxWidth ? '' : 'Las sangrías y el justificado se notan en el texto de párrafo (arrastra una caja con la herramienta Texto).';
    };
  });
}
