// Vistas especiales del lienzo (no cambian la imagen, solo cómo se ve):
// · Comparar antes/después: una línea que se arrastra separa el estado inicial (o el paso anterior) del actual.
// · Simulación de daltonismo: muestra la imagen como la ve una persona con protanopía, deuteranopía,
//   tritanopía o sin color, para comprobar que un diseño se entiende para todos.

import { app } from './app';
import { EditorDocument } from '../core/document';
import { restore } from '../core/history';
import { cloneCanvas } from '../core/canvas';
import type { Viewport } from './viewport';

/** Imagen combinada de un paso del historial (sin tocar el documento). */
export function stateComposite(d: EditorDocument, i: number): HTMLCanvasElement | null {
  const st = d.history.steps[i]; if (!st) return null;
  const t = new EditorDocument('tmp', st.snap.width, st.snap.height);
  restore(t, st.snap);
  return cloneCanvas(t.getComposite());
}

// ---- Antes / después ------------------------------------------------------------------------
type Compare = { doc: EditorDocument; before: HTMLCanvasElement; split: number; label: string };
let cmp: Compare | null = null;
let handle: HTMLElement | null = null;

export function compareActive() { return !!cmp && cmp.doc === app.doc; }

/** Activa la comparación con el estado inicial ('first') o con el paso anterior ('prev'). */
export function startCompare(what: 'first' | 'prev' = 'first') {
  const d = app.doc; if (!d) return;
  const i = what === 'first' ? 0 : Math.max(0, d.history.index - 1);
  const before = stateComposite(d, i);
  if (!before) { app.toast('No hay un estado anterior con el que comparar', 'warn'); return; }
  cmp = { doc: d, before, split: cmp?.doc === d ? cmp.split : 0.5, label: what === 'first' ? 'Original' : 'Paso anterior' };
  ensureHandle(); app.viewport.requestRender(); app.emit('view');
}
export function stopCompare() { cmp = null; handle?.remove(); handle = null; app.viewport?.requestRender(); app.emit('view'); }
export function toggleCompare() { compareActive() ? stopCompare() : startCompare('first'); }

function ensureHandle() {
  if (handle) return;
  const host = app.viewport.canvas.parentElement!;
  handle = document.createElement('div'); handle.className = 'cmp-handle'; handle.title = 'Arrastra para comparar · Doble clic para salir';
  handle.innerHTML = '<span class="cmp-knob">◀▶</span>';
  host.append(handle);
  handle.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation(); handle!.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => {
      if (!cmp) return; const r = app.viewport.canvas.getBoundingClientRect(), p = app.viewport.toDoc(ev.clientX - r.left, ev.clientY - r.top);
      cmp.split = Math.max(0, Math.min(1, p.x / cmp.doc.width)); app.viewport.requestRender();
    };
    const up = () => { handle?.removeEventListener('pointermove', mv); handle?.removeEventListener('pointerup', up); };
    handle!.addEventListener('pointermove', mv); handle!.addEventListener('pointerup', up);
  });
  handle.addEventListener('dblclick', stopCompare);
}

/** Lo llama el visor después de dibujar la imagen. */
function drawCompare(ctx: CanvasRenderingContext2D, vp: Viewport) {
  if (!cmp) return;
  if (cmp.doc !== app.doc) { handle && (handle.style.display = 'none'); return; }
  const d = cmp.doc, x = cmp.split * d.width;
  ctx.save(); vp.docTransform(ctx);
  ctx.beginPath(); ctx.rect(0, 0, x, d.height); ctx.clip();
  // debajo, el fondo de cuadros (por si el «antes» tiene transparencias); encima, el estado de referencia
  const bg = (vp as any).bgCache?.canvas as HTMLCanvasElement | undefined;
  if (bg) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(bg, 0, 0); ctx.restore(); }
  ctx.drawImage(cmp.before, 0, 0, d.width, d.height);
  ctx.restore();
  // línea divisoria y etiquetas (en coordenadas de pantalla)
  const a = vp.toScreen(x, 0), b = vp.toScreen(x, d.height), m = vp.toScreen(x, d.height / 2);
  ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textBaseline = 'top';
  const tag = (t: string, tx: number, right: boolean) => { const w = ctx.measureText(t).width + 12; const lx = right ? tx + 8 : tx - 8 - w; ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(lx, a.y + 8, w, 20); ctx.fillStyle = '#fff'; ctx.fillText(t, lx + 6, a.y + 12); };
  tag(cmp.label, a.x, false); tag('Ahora', a.x, true);
  ctx.restore();
  if (handle) { handle.style.display = ''; handle.style.left = m.x + 'px'; handle.style.top = m.y + 'px'; }
}
(app as any).drawCompare = drawCompare;

// ---- Simulación de daltonismo ---------------------------------------------------------------
export type Sim = 'none' | 'protan' | 'deutan' | 'tritan' | 'achroma';
export const SIM_NAMES: [Sim, string][] = [['none', 'Normal'], ['protan', 'Protanopía (sin rojo)'], ['deutan', 'Deuteranopía (sin verde)'], ['tritan', 'Tritanopía (sin azul)'], ['achroma', 'Acromatopsia (sin color)']];
// matrices de Machado y otros (2009), gravedad completa, en RGB lineal aproximado
const MATS: Record<Exclude<Sim, 'none'>, number[]> = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900],
  achroma: [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722],
};
let sim: Sim = 'none';
export function getSim() { return sim; }
export function setSim(s: Sim) { sim = s; app.viewport?.requestRender(); app.emit('view'); if (s !== 'none') app.toast('Vista: ' + SIM_NAMES.find(x => x[0] === s)![1] + ' (solo cambia cómo se ve, no la imagen)'); }

const toLin = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
const toSrgb = (v: number) => { v = v <= 0 ? 0 : v >= 1 ? 1 : v; return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); };
const LUT = new Uint8ClampedArray(4097); for (let i = 0; i <= 4096; i++) LUT[i] = toSrgb(i / 4096);

/** Lo llama el visor: transforma los píxeles de pantalla que ocupa la imagen. */
function applySim(ctx: CanvasRenderingContext2D, vp: Viewport) {
  if (sim === 'none' || !app.doc) return;
  const d = app.doc, dpr = (vp as any).dpr ?? 1;
  const pts = [vp.toScreen(0, 0), vp.toScreen(d.width, 0), vp.toScreen(0, d.height), vp.toScreen(d.width, d.height)];
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p.x)) * dpr)), y0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p.y)) * dpr));
  const x1 = Math.min(ctx.canvas.width, Math.ceil(Math.max(...pts.map(p => p.x)) * dpr)), y1 = Math.min(ctx.canvas.height, Math.ceil(Math.max(...pts.map(p => p.y)) * dpr));
  if (x1 <= x0 || y1 <= y0) return;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0), a = img.data, M = MATS[sim];
  for (let i = 0; i < a.length; i += 4) {
    const r = toLin[a[i]], g = toLin[a[i + 1]], b = toLin[a[i + 2]];
    a[i] = LUT[Math.max(0, Math.min(4096, (M[0] * r + M[1] * g + M[2] * b) * 4096 | 0))];
    a[i + 1] = LUT[Math.max(0, Math.min(4096, (M[3] * r + M[4] * g + M[5] * b) * 4096 | 0))];
    a[i + 2] = LUT[Math.max(0, Math.min(4096, (M[6] * r + M[7] * g + M[8] * b) * 4096 | 0))];
  }
  ctx.putImageData(img, x0, y0); ctx.restore();
}
(app as any).applyViewSim = applySim;

// ---- Contraste de textos (WCAG) ------------------------------------------------------------
const L8 = (v: number) => toLin[Math.max(0, Math.min(255, Math.round(v)))];
const relLum = (r: number, g: number, b: number) => 0.2126 * L8(r) + 0.7152 * L8(g) + 0.0722 * L8(b);
/** Relación de contraste entre dos colores (1 a 21). */
export function contrastRatio(c1: number[], c2: number[]) { const a = relLum(c1[0], c1[1], c1[2]), b = relLum(c2[0], c2[1], c2[2]); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }
