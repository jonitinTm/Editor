// Acciones: grabar una serie de pasos (filtros, ajustes, tamaño, giros, capas…)
// y reproducirla en cualquier documento, o en lote sobre muchas imágenes.

import { app } from './app';
import { FILTERS } from '../filters/registry';

export type Step =
  | { kind: 'action'; id: string; label: string }
  | { kind: 'filter'; id: string; params: any; label: string }
  | { kind: 'imageSize'; w?: number; h?: number; fit?: number; label: string }
  | { kind: 'canvasSize'; w: number; h: number; anchor: number; label: string };
export interface Macro { name: string; steps: Step[]; builtin?: boolean; }

const KEY = 'editor.actions';
const BUILTIN: Macro[] = [
  { name: 'Mejora automática', builtin: true, steps: [
    { kind: 'filter', id: 'autotone', params: {}, label: 'Tono automático' },
    { kind: 'filter', id: 'autocolor', params: {}, label: 'Color automático' },
    { kind: 'filter', id: 'unsharp', params: { amount: 60, radius: 1, threshold: 2 }, label: 'Máscara de enfoque' }] },
  { name: 'Blanco y negro con contraste', builtin: true, steps: [
    { kind: 'filter', id: 'bw', params: { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 }, label: 'Blanco y negro' },
    { kind: 'filter', id: 'autocontrast', params: {}, label: 'Contraste automático' }] },
  { name: 'Reducir para web (1920 px)', builtin: true, steps: [
    { kind: 'imageSize', fit: 1920, label: 'Tamaño de imagen: lado mayor 1920 px' },
    { kind: 'filter', id: 'unsharp', params: { amount: 40, radius: 0.6, threshold: 0 }, label: 'Máscara de enfoque' }] },
];

let user: Macro[] = [];
try { user = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { /* */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(user)); } catch { /* */ } };

export const macros = () => [...user, ...BUILTIN];
export let recording: Macro | null = null;
export let playing = false;

/** Pasos que no se graban (abrir, guardar, deshacer, ver, ventanas…). */
const NOT_RECORDED = /^(batch|new|open|place|save|saveAs|export|exportLayers|close|undo|redo|copy|copyMerged|cut|paste|zoom|fit|actual|rulers|grid|guides|snap|newGuide|clearGuides|shortcuts|about|win:|resetRot|quickMask|lastFilter|freeTransform|distort|perspective|layerStyle|renameLayer|saveSel|loadSel|definePattern|refine|liquify|fill$|stroke$|contentFill|imageSize|canvasSize|dupDoc|snapshot|label:|editSmart|colorRange|feather|expand|contract)/;

export function record(step: Step) {
  if (!recording || playing) return;
  recording.steps.push(step); save(); app.emit('doc');
}
export function recordAction(id: string, label: string) {
  if (id.startsWith('filter:') || NOT_RECORDED.test(id)) return;
  record({ kind: 'action', id, label });
}
export function startRecording(name: string) {
  const m: Macro = { name, steps: [] };
  user.unshift(m); recording = m; save(); app.emit('doc');
}
export function stopRecording() { recording = null; save(); app.emit('doc'); }
export function deleteMacro(m: Macro) { if (m.builtin) return; user = user.filter(x => x !== m); if (recording === m) recording = null; save(); app.emit('doc'); }

/** Reproduce una acción sobre el documento activo. */
export async function play(m: Macro) {
  const d = app.doc; if (!d) { app.toast('Abre una imagen primero', 'warn'); return; }
  const { actionById } = await import('./actions');
  const ops = await import('./ops');
  playing = true;
  try {
    for (const s of m.steps) {
      const doc = app.doc!;
      if (s.kind === 'action') { const a = actionById.get(s.id); if (a && (!a.enabled || a.enabled())) await a.run(); }
      else if (s.kind === 'filter') { const def = FILTERS.find(f => f.id === s.id); if (def) await ops.applyFilterDirect(def, s.params); }
      else if (s.kind === 'imageSize') {
        let w = s.w ?? doc.width, h = s.h ?? doc.height;
        if (s.fit) { const k = Math.min(1, s.fit / Math.max(doc.width, doc.height)); w = Math.round(doc.width * k); h = Math.round(doc.height * k); }
        if (w !== doc.width || h !== doc.height) { doc.resample(w, h); doc.commit('Tamaño de imagen'); }
      } else if (s.kind === 'canvasSize') {
        const ax = s.anchor % 3, ay = Math.floor(s.anchor / 3);
        doc.resizeCanvas(s.w, s.h, Math.round((s.w - doc.width) * ax / 2), Math.round((s.h - doc.height) * ay / 2)); doc.commit('Tamaño de lienzo');
      }
    }
  } finally { playing = false; }
  app.viewport.fit(true);
}
