// Ventanas modales sencillas y arrastrables.

import { h } from './dom';

export interface DialogOptions {
  title: string;
  body: HTMLElement | HTMLElement[];
  okLabel?: string;
  cancelLabel?: string | null;
  onOk?: () => boolean | void | Promise<boolean | void>;
  onCancel?: () => void;
  width?: number;
  extraButtons?: HTMLElement[];
}

let open = 0;
export function dialogOpen() { return open > 0; }

export function showDialog(o: DialogOptions) {
  const overlay = h('div', { class: 'modal-overlay' });
  const okBtn = h('button', { class: 'btn primary', type: 'submit' }, o.okLabel ?? 'Aceptar');
  const cancelBtn = o.cancelLabel === null ? null : h('button', { class: 'btn', type: 'button' }, o.cancelLabel ?? 'Cancelar');
  const header = h('div', { class: 'modal-title' }, o.title);
  const form = h('form', { class: 'modal', style: { width: (o.width ?? 380) + 'px' } },
    header,
    h('div', { class: 'modal-body' }, ...(Array.isArray(o.body) ? o.body : [o.body])),
    h('div', { class: 'modal-buttons' }, ...(o.extraButtons ?? []), h('span', { style: { flex: '1' } }), cancelBtn, okBtn));
  overlay.append(form);
  document.body.append(overlay);
  open++;
  const close = () => { overlay.remove(); open--; document.removeEventListener('keydown', onKey, true); };
  const cancel = () => { o.onCancel?.(); close(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } };
  document.addEventListener('keydown', onKey, true);
  cancelBtn?.addEventListener('click', cancel);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const r = await o.onOk?.();
    if (r !== false) close();
  });
  // Arrastrar por la barra de título
  header.addEventListener('pointerdown', e => {
    const r = form.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    form.style.position = 'fixed';
    const mv = (ev: PointerEvent) => { form.style.left = ev.clientX - ox + 'px'; form.style.top = ev.clientY - oy + 'px'; form.style.margin = '0'; };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
  setTimeout(() => (form.querySelector('input:not([type=range]):not([type=checkbox]), select') as HTMLElement | null)?.focus(), 0);
  return { close, form };
}

export function row(label: string, ...controls: (HTMLElement | string)[]) {
  return h('div', { class: 'form-row' }, h('span', { class: 'lbl' }, label), ...controls);
}

export function alertDialog(title: string, message: string) {
  showDialog({ title, body: h('p', {}, message), cancelLabel: null });
}

export function confirmDialog(title: string, message: string, okLabel = 'Aceptar'): Promise<boolean> {
  return new Promise(res => showDialog({ title, body: h('p', {}, message), okLabel, onOk: () => res(true), onCancel: () => res(false) }));
}

export function promptDialog(title: string, label: string, value: string): Promise<string | null> {
  return new Promise(res => {
    const inp = h('input', { type: 'text', value, class: 'wide' });
    showDialog({ title, body: row(label, inp), onOk: () => res(inp.value), onCancel: () => res(null) });
    setTimeout(() => inp.select(), 10);
  });
}
