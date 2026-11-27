// Barra de opciones de la herramienta activa (debajo de los menús).

import { app } from './app';
import { h, numberSlider } from './dom';
import { icon } from './icons';
import { fontPicker } from './fontpicker';

export function buildOptionsBar(parent: HTMLElement) {
  const bar = h('div', { class: 'optionsbar' });
  parent.append(bar);
  let setters: (() => void)[] = [];
  let ac = new AbortController();

  const render = () => {
    bar.innerHTML = '';
    setters = []; app.clearBar(); ac.abort(); ac = new AbortController();
    const t = app.tool;
    if (!t) return;
    const presetBtn = h('button', { class: 'opt-tool btn', type: 'button', title: 'Ajustes predefinidos de la herramienta', html: t.icon + '<span class="caret">▾</span>' });
    presetBtn.onclick = ev => { ev.stopPropagation(); presetMenu(presetBtn, t); };
    bar.append(presetBtn, h('span', { class: 'opt-name' }, t.name), h('span', { class: 'opt-sep' }));
    // opciones importantes como botones de icono, siempre a la vista (como en Photoshop): presión = tamaño,
    // presión = opacidad y simetría. No pasan nunca al desplegable «Más».
    const PIN_ORDER = ['pressure', 'pressureOpacity', 'symmetry'];
    const pinned = (t.options ?? []).filter((d: any) => d.pin).sort((x: any, y: any) => PIN_ORDER.indexOf(x.key) - PIN_ORDER.indexOf(y.key));
    if (pinned.length) {
      const pins = h('div', { class: 'opt-pins btn-group' });
      for (const d of pinned as any[]) {
        const get = () => app.opt(d.key, t.id);
        const tip = d.label + (d.title ? '\n' + d.title : '');
        const b = h('button', { class: 'btn icon-btn opt-pin', type: 'button', title: tip, 'aria-label': d.label, 'data-pin': d.key, html: icon(d.pin) });
        if (d.type === 'checkbox') {
          b.onclick = () => { app.setOpt(t.id, d.key, !get()); app.toast(`${d.label}: ${get() ? 'activado' : 'desactivado'}`); };
          const upd = () => { const on = !!get(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); };
          upd(); setters.push(upd);
        } else if (d.type === 'select') {
          b.setAttribute('aria-haspopup', 'menu');
          b.onclick = ev => { ev.stopPropagation(); pinMenu(b, d, t.id); };
          const upd = () => { const on = get() !== d.default; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); };
          upd(); setters.push(upd);
        }
        pins.append(b);
      }
      bar.append(pins);
    }
    if (t.extraFirst) t.extraOptions?.(bar);
    for (const d of t.options ?? []) {
      if ((d as any).pin) continue;
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
      } else if (d.type === 'number') {
        const n = h('input', { type: 'number', class: 'num', min: d.min, max: d.max, step: 1, value: get(), title: (d as any).title ?? '' }) as HTMLInputElement;
        n.style.width = '64px';
        n.addEventListener('change', () => set(Math.max(d.min ?? -1e9, Math.min(d.max ?? 1e9, +n.value || 0))));
        setters.push(() => { if (document.activeElement !== n) n.value = String(get()); });
        bar.append(h('label', { class: 'opt' }, h('span', { class: 'lbl' }, d.label), n, d.unit ? h('span', { class: 'hint' }, ' ' + d.unit) : null));
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
    if (!t.extraFirst) t.extraOptions?.(bar);
    requestAnimationFrame(fitOverflow);
  };
  /** Si las opciones no caben (pantallas pequeñas), las últimas pasan a un desplegable «Más». */
  const fitOverflow = () => {
    if (bar.scrollWidth <= bar.clientWidth + 1) return;
    const more = h('div', { class: 'opt-more' });
    const btn = h('button', { class: 'btn opt-more-btn', type: 'button', title: 'Más opciones' }, 'Más ▾');
    const pop = h('div', { class: 'opt-more-pop' });
    more.append(btn, pop); bar.append(more);
    // los botones de aplicar y cancelar (✓ ✕) se quedan siempre a la vista
    const items = [...bar.children].slice(3).filter(el => el !== more && !(el as HTMLElement).matches('.opt-pins') && !(el as HTMLElement).matches('.icon-btn.ok') && !((el as HTMLElement).matches('.icon-btn') && (el.previousElementSibling as HTMLElement | null)?.matches('.icon-btn.ok'))) as HTMLElement[];
    while (bar.scrollWidth > bar.clientWidth + 1 && items.length > 0) pop.prepend(items.pop()!);
    btn.onclick = e => {
      e.stopPropagation(); pop.classList.toggle('open');
      if (pop.classList.contains('open')) { const r = btn.getBoundingClientRect(); pop.style.top = r.bottom + 4 + 'px'; pop.style.right = Math.max(8, innerWidth - r.right) + 'px'; }
    };
    document.addEventListener('pointerdown', ev => { if (!more.contains(ev.target as Node) && !(ev.target as HTMLElement).closest?.('.flyout, .slider-pop')) pop.classList.remove('open'); }, { signal: ac.signal });
  };
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = window.setTimeout(render, 150); });
  app.on('tool', render);
  app.on('options', () => setters.forEach(s => s()));
  render();
}

/** Menú de un botón de opción con varias elecciones (p. ej. los modos de simetría). */
export function pinMenu(anchor: HTMLElement, d: any, toolId: string) {
  const old = document.querySelector('.pin-fly') as (HTMLElement & { _close?: () => void }) | null;
  if (old) { old._close ? old._close() : old.remove(); if (old.dataset.key === d.key) return; } // segundo toque: se cierra
  const fly = h('div', { class: 'flyout pin-fly', role: 'menu', 'data-key': d.key }) as HTMLElement & { _close?: () => void };
  const done = () => { fly.remove(); document.removeEventListener('pointerdown', close, true); };
  fly._close = done;
  fly.append(h('div', { class: 'pin-fly-head' }, d.label));
  for (const c of d.choices) {
    const it = h('button', { type: 'button', class: 'fly-item pin-item' + (app.opt(d.key, toolId) === c.value ? ' on' : ''), role: 'menuitemradio', 'aria-checked': String(app.opt(d.key, toolId) === c.value) }, c.label);
    it.onclick = () => { app.setOpt(toolId, d.key, c.value); done(); app.viewport?.requestRender(); };
    fly.append(it);
  }
  if (d.title) fly.append(h('div', { class: 'hint pin-fly-hint' }, d.title));
  document.body.append(fly);
  const r = anchor.getBoundingClientRect(), w = fly.offsetWidth;
  fly.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + 'px'; fly.style.top = r.bottom + 4 + 'px';
  // fuera del menú se cierra; el propio botón (o su dibujo) no cuenta como «fuera»: su toque lo cierra él mismo
  const close = (ev: Event) => { if (!fly.contains(ev.target as Node) && !anchor.contains(ev.target as Node)) done(); };
  setTimeout(() => document.addEventListener('pointerdown', close, true));
}

// ---- Ajustes predefinidos de herramienta --------------------------------------------------------
type Preset = { name: string; opts: Record<string, any> };
const KEY = 'editor.toolPresets';
/** Algunos ajustes de serie para empezar. */
const BUILTIN: Record<string, Preset[]> = {
  brush: [
    // pinceles de dibujo (pensados para lápiz: presión e inclinación)
    { name: 'Lápiz HB', opts: { size: 4, hardness: 50, opacity: 85, flow: 100, smoothing: 15, spacing: 10, pressure: true, pressureOpacity: true, tiltMode: 'shade', texture: 'base:Papel', texScale: 50, texDepth: 50 } },
    { name: 'Lápiz 2B (blando)', opts: { size: 7, hardness: 40, opacity: 95, flow: 100, smoothing: 10, spacing: 10, pressure: true, pressureOpacity: true, tiltMode: 'shade', texture: 'base:Papel', texScale: 70, texDepth: 60, blendMode: 'multiply' } },
    { name: 'Entintado', opts: { size: 8, hardness: 100, opacity: 100, flow: 100, smoothing: 45, spacing: 5, pressure: true, tiltMode: 'none', taper: 40 } },
    { name: 'Rotulador fino', opts: { size: 5, hardness: 95, opacity: 100, flow: 100, smoothing: 30, spacing: 5, pressure: false, tiltMode: 'none' } },
    { name: 'Caligrafía', opts: { taper: 25, size: 18, hardness: 100, opacity: 100, flow: 100, smoothing: 30, spacing: 4, pressure: true, tiltMode: 'angle', angle: 45, roundness: 22 } },
    { name: 'Carboncillo', opts: { size: 22, hardness: 40, opacity: 100, flow: 70, smoothing: 10, spacing: 12, pressure: true, pressureOpacity: true, tiltMode: 'shade', tip: 'base:Tiza', tipJitter: true, texture: 'base:Papel', texScale: 150, texDepth: 70, blendMode: 'multiply' } },
    { name: 'Pincel seco (óleo)', opts: { size: 40, hardness: 60, opacity: 100, flow: 80, smoothing: 20, spacing: 6, pressure: true, tiltMode: 'angle', tip: 'base:Pincel seco', texture: 'base:Lienzo', texScale: 100, texDepth: 25 } },
    { name: 'Pintura suave (gouache)', opts: { size: 40, hardness: 70, opacity: 100, flow: 60, smoothing: 15, spacing: 8, pressure: true, pressureOpacity: true, tiltMode: 'shade' } },
    { name: 'Línea estable (cuerda)', opts: { size: 6, hardness: 100, opacity: 100, flow: 100, smoothing: 0, rope: 40, spacing: 5, pressure: true, tiltMode: 'none' } },
    { name: 'Aerógrafo suave', opts: { size: 120, hardness: 0, opacity: 100, flow: 12, spacing: 8 } },
    { name: 'Tinta dura', opts: { size: 6, hardness: 100, opacity: 100, flow: 100, smoothing: 40, pressure: true } },
    { name: 'Rotulador', opts: { size: 24, hardness: 90, opacity: 70, flow: 100, blendMode: 'multiply' } },
    { name: 'Lápiz de boceto', opts: { size: 3, hardness: 80, opacity: 45, flow: 60, scatter: 4 } },
    { name: 'Acuarela', opts: { size: 80, hardness: 10, opacity: 35, flow: 30, scatter: 15, hueJitter: 6, briJitter: 10 } },
    { name: 'Mandala', opts: { size: 8, hardness: 100, opacity: 100, flow: 100, smoothing: 50, symmetry: 'm8' } },
  ],
  eraser: [{ name: 'Borrador suave', opts: { size: 100, hardness: 0, opacity: 60, flow: 50 } }, { name: 'Borrador duro', opts: { size: 20, hardness: 100, opacity: 100, flow: 100 } }],
  crop: [{ name: 'Cuadrado (redes)', opts: { ratio: '1:1' } }, { name: 'Vertical 4:5', opts: { ratio: '4:5' } }, { name: 'Panorámico 16:9', opts: { ratio: '16:9' } }],
  text: [{ name: 'Título grande', opts: { size: 96, bold: true, tracking: -20 } }, { name: 'Texto normal', opts: { size: 24, bold: false, italic: false, tracking: 0, leading: 130 } }],
};
function loadPresets(): Record<string, Preset[]> { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
function savePresets(p: Record<string, Preset[]>) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { app.toast('No se pudo guardar el ajuste', 'warn'); } }
function applyPreset(t: any, pr: Preset) {
  // los pinceles de serie parten de cero, así no se arrastra nada del anterior (punta, textura…)
  if (BUILTIN[t.id]?.includes(pr)) { for (const o of t.options ?? []) if ('default' in o && o.key !== 'size') app.setOpt(t.id, o.key, o.default); app.setOpt(t.id, 'tip', ''); app.setOpt(t.id, 'tipJitter', false); }
  for (const [k, v] of Object.entries(pr.opts)) app.setOpt(t.id, k, v); app.toast(`Ajuste «${pr.name}»`); }

export function presetMenu(anchor: HTMLElement, t: any) {
  document.querySelector('.preset-fly')?.remove();
  const fly = h('div', { class: 'flyout preset-fly' });
  const r = anchor.getBoundingClientRect(); fly.style.left = r.left + 'px'; fly.style.top = r.bottom + 4 + 'px';
  const user = loadPresets()[t.id] ?? [], builtin = BUILTIN[t.id] ?? [];
  const item = (pr: Preset, del?: () => void) => {
    const el = h('div', { class: 'fly-item' }, h('span', {}, pr.name));
    el.onclick = () => { applyPreset(t, pr); fly.remove(); };
    if (del) { const b = h('button', { class: 'brush-del', title: 'Eliminar este ajuste' }, '×'); b.onclick = ev => { ev.stopPropagation(); del(); fly.remove(); }; el.append(b); }
    fly.append(el);
  };
  fly.append(h('div', { class: 'fly-head' }, 'Ajustes de «' + t.name + '»'));
  builtin.forEach(pr => item(pr));
  user.forEach((pr, i) => item(pr, () => { const all = loadPresets(); all[t.id]?.splice(i, 1); savePresets(all); }));
  if (!builtin.length && !user.length) fly.append(h('div', { class: 'hint', style: 'padding:6px 10px' }, 'Aún no hay ajustes guardados.'));
  const save = h('div', { class: 'fly-item fly-action' }, '＋ Guardar las opciones actuales…');
  save.onclick = async () => {
    fly.remove();
    const { promptDialog } = await import('./dialog');
    const name = (await promptDialog('Nuevo ajuste de herramienta', 'Nombre', t.name + ' ' + (user.length + 1)))?.trim(); if (!name) return;
    const opts: Record<string, any> = {}; for (const o of t.options ?? []) if (o.key !== 'mode') opts[o.key] = app.opt(o.key, t.id);
    for (const k of ['tip', 'tipJitter', 'stops']) { const v = app.opt(k, t.id); if (v !== undefined) opts[k] = v; }
    const all = loadPresets(); (all[t.id] ??= []).push({ name, opts }); savePresets(all); app.toast('Ajuste guardado');
  };
  const reset = h('div', { class: 'fly-item fly-action' }, '↺ Restaurar las opciones de serie');
  reset.onclick = () => { for (const o of t.options ?? []) if ('default' in o) app.setOpt(t.id, o.key, o.default); fly.remove(); };
  fly.append(save, reset); document.body.append(fly);
  setTimeout(() => document.addEventListener('pointerdown', function close(ev) { if (!fly.contains(ev.target as Node)) { fly.remove(); document.removeEventListener('pointerdown', close); } }), 0);
}
