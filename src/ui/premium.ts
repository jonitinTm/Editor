// Funciones que otras apps de foto cobran y aquí son gratis: copiar y pegar los ajustes de una foto a otras (también a
// todas las abiertas a la vez) y doble exposición.
import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog } from './dialog';
import { AdjustmentLayer, RasterLayer } from '../core/layers';
import { ctx2d } from '../core/canvas';
import type { EditorDocument } from '../core/document';

type AdjCopy = { name: string; filterId: string; params: any; opacity: number; blendMode: any; visible: boolean };
let copied: AdjCopy[] | null = null;
export const hasCopiedAdjustments = () => !!copied?.length;
/** Copia las capas de ajuste del documento (curvas, niveles, looks…), de abajo arriba. */
export function copyAdjustments() {
  const d = app.doc; if (!d) return;
  const list = d.allLayers().filter(l => l instanceof AdjustmentLayer) as AdjustmentLayer[];
  if (!list.length) { app.toast('Esta foto no tiene capas de ajuste que copiar (aplica un look o un ajuste como capa de ajuste)', 'warn'); return; }
  copied = list.map(l => ({ name: l.name, filterId: l.filterId, params: JSON.parse(JSON.stringify(l.params)), opacity: l.opacity, blendMode: l.blendMode, visible: l.visible }));
  app.toast(`Copiados ${copied.length} ajustes: ábrelos en otra foto con Edición › Pegar ajustes`);
}
function pasteInto(d: EditorDocument) {
  for (const c of copied!) { const l = new AdjustmentLayer(c.name, c.filterId, JSON.parse(JSON.stringify(c.params))); l.opacity = c.opacity; l.blendMode = c.blendMode; l.visible = c.visible; d.root.add(l); }
  d.invalidate(); d.commit('Pegar ajustes');
}
export function pasteAdjustments(all = false) {
  if (!copied?.length) { app.toast('Primero copia los ajustes de una foto (Edición › Copiar ajustes)', 'warn'); return; }
  const docs = all ? [...app.docs] : app.doc ? [app.doc] : [];
  for (const d of docs) pasteInto(d);
  app.emit('docs'); app.viewport.requestRender();
  app.toast(all ? `Ajustes pegados en ${docs.length} fotos` : 'Ajustes pegados');
}

/** Doble exposición: otra foto encima con fusión «Trama», dentro de la selección si la hay (p. ej. la silueta). */
export async function doubleExposure() {
  const d = app.doc; if (!d) return;
  const io = await import('../io/files'); const [f] = await io.pickFiles('image/*'); if (!f) return;
  const img = await io.imageToCanvas(f), l = new RasterLayer('Doble exposición', d.width, d.height), x = ctx2d(l.canvas);
  // la segunda foto cubre todo el lienzo (como «rellenar», sin deformarla)
  const k = Math.max(d.width / img.width, d.height / img.height), w = img.width * k, hh = img.height * k;
  x.drawImage(img, (d.width - w) / 2, (d.height - hh) / 2, w, hh);
  if (d.selection.mask) { x.globalCompositeOperation = 'destination-in'; x.drawImage(d.selection.mask, 0, 0); }
  l.blendMode = 'screen' as any; l.opacity = 0.85;
  d.root.add(l); d.setActive(l, false); d.invalidate(); d.commit('Doble exposición'); app.emit('docs');
  let op = 85;
  const mode = h('select', {}, h('option', { value: 'screen' }, 'Trama (aclara, el clásico)'), h('option', { value: 'lighten' }, 'Aclarar'), h('option', { value: 'multiply' }, 'Multiplicar (oscurece)'), h('option', { value: 'overlay' }, 'Superponer (contraste)'));
  mode.onchange = () => { l.blendMode = mode.value as any; d.invalidate(); app.viewport.requestRender(); };
  showDialog({
    title: 'Doble exposición', okLabel: 'Aceptar', width: 400, side: true,
    body: [h('div', { class: 'form-row' }, h('label', {}, 'Mezcla'), mode),
      h('div', { class: 'form-row' }, h('label', {}, 'Opacidad'), numberSlider({ min: 5, max: 100, value: op, unit: '%', onInput: v => { op = v; l.opacity = v / 100; d.invalidate(); app.viewport.requestRender(); } }).el),
      h('div', { class: 'hint' }, 'Consejo: antes de empezar, selecciona a la persona (Selección › Sujeto) y la segunda foto quedará dentro de su silueta. Muévela con la herramienta Mover.')],
    onOk: () => { d.commit('Doble exposición'); },
  });
}
