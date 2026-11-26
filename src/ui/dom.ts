// Pequeño ayudante para crear elementos HTML desde código.

type Child = Node | string | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, any> = {}, ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** Campo numérico con deslizador, usado en diálogos y en la barra de opciones. */
// una sola escucha para cerrar las ventanitas de los deslizadores al tocar fuera (antes había una por deslizador
// y se iban acumulando cada vez que se redibujaba la barra de opciones)
const openPops = new Set<HTMLElement>();
document.addEventListener('pointerdown', e => {
  for (const el of openPops) if (!el.contains(e.target as Node)) { el.querySelector('.slider-pop')?.classList.remove('open'); openPops.delete(el); }
});
export function numberSlider(opts: {
  label?: string; min: number; max: number; step?: number; value: number; unit?: string;
  onInput: (v: number) => void; compact?: boolean;
  /** valor por defecto: si se indica, aparece «↺» para volver a él (también con doble toque en el deslizador) */
  def?: number;
}) {
  const step = opts.step ?? 1;
  const num = h('input', { type: 'number', min: opts.min, max: opts.max, step, value: String(opts.value), class: 'num' });
  const range = h('input', { type: 'range', min: opts.min, max: opts.max, step, value: String(opts.value) });
  const set = (v: number, from?: HTMLInputElement, silent = false) => {
    if (isNaN(v)) return;
    // se ajusta al paso del deslizador (si alguien escribe 70,5 donde solo valen enteros, queda 71)
    v = Math.min(opts.max, Math.max(opts.min, Math.round((v - opts.min) / step) * step + opts.min));
    v = +v.toFixed(6);
    if (from !== num) num.value = String(+v.toFixed(2));
    if (from !== range) range.value = String(v);
    if (!silent) opts.onInput(v);
    if (reset) reset.classList.toggle('on', opts.def !== undefined && Math.abs(v - opts.def) > 1e-9);
  };
  let reset: HTMLElement | null = null;
  num.addEventListener('input', () => set(parseFloat(num.value), num));
  num.addEventListener('change', () => set(parseFloat(num.value)));
  range.addEventListener('input', () => set(parseFloat(range.value), range));
  const el = h('label', { class: 'num-slider' + (opts.compact ? ' compact' : '') },
    opts.label ? h('span', { class: 'lbl' }, opts.label) : null,
    opts.compact ? null : range, num, opts.unit ? h('span', { class: 'unit' }, opts.unit) : null);
  if (opts.def !== undefined) {
    const d = opts.def;
    reset = h('button', { class: 'ns-reset', type: 'button', title: 'Restablecer', 'aria-label': 'Restablecer', html: '↺' });
    reset.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); set(d); });
    range.addEventListener('dblclick', () => set(d));
    el.append(reset);
    reset.classList.toggle('on', Math.abs(opts.value - d) > 1e-9);
  }
  if (opts.compact) {
    // En la barra de opciones el deslizador aparece en una ventanita al pulsar.
    const pop = h('div', { class: 'slider-pop' }, range);
    const btn = h('button', { class: 'pop-btn', type: 'button', html: '▾' });
    btn.addEventListener('click', e => { e.preventDefault(); pop.classList.toggle('open'); if (pop.classList.contains('open')) openPops.add(el); });
    el.append(btn, pop);
  }
  return { el, set: (v: number) => set(v, undefined, true) };
}
