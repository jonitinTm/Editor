// Barra de opciones de la herramienta activa (debajo de los menús).

import { app } from './app';
import { h, numberSlider } from './dom';
import { icon } from './icons';
import { fontPicker } from './fontpicker';

export function buildOptionsBar(parent: HTMLElement) {
  const bar = h('div', { class: 'optionsbar' });
  parent.append(bar);
  let setters: (() => void)[] = [];

  const render = () => {
    bar.innerHTML = '';
    setters = [];
    const t = app.tool;
    if (!t) return;
    bar.append(h('span', { class: 'opt-tool', html: t.icon }), h('span', { class: 'opt-name' }, t.name), h('span', { class: 'opt-sep' }));
    for (const d of t.options ?? []) {
      const get = () => app.opt(d.key, t.id);
      const set = (v: any) => app.setOpt(t.id, d.key, v);
      if (d.type === 'range') {
        const s = numberSlider({ label: d.label, min: d.min, max: d.max, step: d.step, value: get(), unit: d.unit, compact: true, onInput: set });
        s.el.classList.add('opt');
        setters.push(() => { const inp = s.el.querySelector('input.num') as HTMLInputElement; if (document.activeElement !== inp) inp.value = String(get()); (s.el.querySelector('input[type=range]') as HTMLInputElement).value = String(get()); });
        bar.append(s.el);
      } else if (d.type === 'font') {
        let fp = fontPicker(get(), v => set(v));
        const wrap = h('label', { class: 'opt' }, fp);
        // si cambia desde fuera (p. ej. al seleccionar otra capa de texto), se rehace el botón
        setters.push(() => { const nfp = fontPicker(get(), v => set(v)); wrap.replaceChild(nfp, fp); fp = nfp; });
        bar.append(wrap);
      } else if (d.type === 'select') {
        const choices = d.choices;
        const sel = h('select', {}, ...choices.map(c => h('option', { value: c.value }, c.label)));

        sel.value = get();
        sel.addEventListener('change', () => set(sel.value));
        setters.push(() => { sel.value = get(); });
        bar.append(h('label', { class: 'opt' }, d.label ? h('span', { class: 'lbl' }, d.label) : null, sel));
      } else if (d.type === 'checkbox') {
        const c = h('input', { type: 'checkbox', checked: !!get() });
        c.addEventListener('change', () => set(c.checked));
        setters.push(() => { c.checked = !!get(); });
        bar.append(h('label', { class: 'opt check' }, c, ' ' + d.label));
      } else if (d.type === 'color') {
        const c = h('input', { type: 'color', value: get(), class: 'color-input', title: 'Color del trazo' });
        c.addEventListener('input', () => set(c.value));
        setters.push(() => { c.value = get(); });
        bar.append(h('label', { class: 'opt' }, d.label ? h('span', { class: 'lbl' }, d.label) : null, c));
      } else if (d.type === 'selmode') {
        const modes: [string, string, string][] = [['new', 'selNew', 'Nueva selección'], ['add', 'selAdd', 'Añadir (Mayús)'], ['subtract', 'selSub', 'Restar (Alt)'], ['intersect', 'selInt', 'Intersecar (Mayús+Alt)']];
        const group = h('div', { class: 'btn-group' });
        const btns = modes.map(([v, ic, title]) => {
          const b = h('button', { class: 'btn icon-btn', title, html: icon(ic) });
          b.onclick = () => set(v);
          group.append(b);
          return [v, b] as const;
        });
        const upd = () => btns.forEach(([v, b]) => b.classList.toggle('on', get() === v));
        upd(); setters.push(upd);
        bar.append(group);
      }
    }
    t.extraOptions?.(bar);
  };
  app.on('tool', render);
  app.on('options', () => setters.forEach(s => s()));
  render();
}
