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
export function numberSlider(opts: {
  label?: string; min: number; max: number; step?: number; value: number; unit?: string;
  onInput: (v: number) => void; compact?: boolean;
}) {
  const step = opts.step ?? 1;
  const num = h('input', { type: 'number', min: opts.min, max: opts.max, step, value: String(opts.value), class: 'num' });
  const range = h('input', { type: 'range', min: opts.min, max: opts.max, step, value: String(opts.value) });
  const set = (v: number, from?: HTMLInputElement, silent = false) => {
    if (isNaN(v)) return;
    v = Math.min(opts.max, Math.max(opts.min, v));
    if (from !== num) num.value = String(+v.toFixed(2));
    if (from !== range) range.value = String(v);
    if (!silent) opts.onInput(v);
  };
  num.addEventListener('input', () => set(parseFloat(num.value), num));
  num.addEventListener('change', () => set(parseFloat(num.value)));
  range.addEventListener('input', () => set(parseFloat(range.value), range));
  const el = h('label', { class: 'num-slider' + (opts.compact ? ' compact' : '') },
    opts.label ? h('span', { class: 'lbl' }, opts.label) : null,
    opts.compact ? null : range, num, opts.unit ? h('span', { class: 'unit' }, opts.unit) : null);
  if (opts.compact) {
    // En la barra de opciones el deslizador aparece en una ventanita al pulsar.
    const pop = h('div', { class: 'slider-pop' }, range);
    const btn = h('button', { class: 'pop-btn', type: 'button', html: '▾' });
    btn.addEventListener('click', e => { e.preventDefault(); pop.classList.toggle('open'); });
    document.addEventListener('pointerdown', e => { if (!el.contains(e.target as Node)) pop.classList.remove('open'); });
    el.append(btn, pop);
  }
  return { el, set: (v: number) => set(v, undefined, true) };
}
