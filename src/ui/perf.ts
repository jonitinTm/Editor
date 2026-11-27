// Ayuda › Rendimiento y memoria: cuánto ocupa cada documento (capas e historial), qué aparato es, espacio de Mis
// proyectos, pasos de historial, calidad de la vista y «Liberar memoria».
// Ayuda › Comprobar la pantalla: carta para ver si la pantalla distingue los negros, los blancos y los degradados.
import { app } from './app';
import { h } from './dom';
import { showDialog, row, confirmDialog } from './dialog';
import { prefs, savePrefs, applyPrefs } from './prefs';
import { historyBudgetMB } from '../core/history';
import { walkLayers } from '../core/layers';
import type { EditorDocument } from '../core/document';

const MB = (b: number) => b / 1048576;
const fmt = (mb: number) => mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb >= 10 ? Math.round(mb) + ' MB' : mb.toFixed(1) + ' MB';

/** Memoria de las capas de un documento (píxeles de capas, máscaras y objetos inteligentes). */
function layersMB(d: EditorDocument): number {
  const seen = new Set<HTMLCanvasElement>();
  const add = (c?: HTMLCanvasElement | null) => { if (c) seen.add(c); };
  for (const l of walkLayers(d.root)) {
    add((l as any).canvas); add(l.mask?.canvas);
    const inner = (l as any).inner as EditorDocument | undefined; if (inner) for (const x of walkLayers(inner.root)) add((x as any).canvas);
  }
  let b = d.width * d.height * 4; // imagen combinada de la vista
  for (const c of seen) b += c.width * c.height * 4;
  return MB(b);
}

export async function perfDialog() {
  const nav = navigator as any, dm: number | undefined = nav.deviceMemory;
  const gl = (() => { try { const c = document.createElement('canvas'), g = c.getContext('webgl2') as WebGL2RenderingContext | null; if (!g) return 'sin aceleración'; const e = g.getExtension('WEBGL_debug_renderer_info'); const r = e ? String(g.getParameter(e.UNMASKED_RENDERER_WEBGL)) : 'sí'; return /swiftshader|llvmpipe|software/i.test(r) ? 'por software (lenta)' : 'sí'; } catch { return 'desconocida'; } })();
  const st = await (await import('../io/projects')).storageInfo();
  const docs = app.docs.map(d => ({ d, layers: layersMB(d), hist: d.history.memoryMB(), steps: d.history.steps.length }));
  const total = docs.reduce((s, x) => s + x.layers + x.hist, 0), budget = historyBudgetMB();
  const table = h('table', { class: 'perf-table' },
    h('tr', {}, h('th', {}, 'Documento'), h('th', {}, 'Tamaño'), h('th', {}, 'Capas'), h('th', {}, 'Historial')),
    ...docs.map(x => h('tr', {}, h('td', { class: 'no-i18n' }, x.d.name), h('td', {}, `${x.d.width} × ${x.d.height}`), h('td', {}, fmt(x.layers)), h('td', {}, `${fmt(x.hist)} · ${x.steps} pasos`))));
  const bar = (used: number, max: number) => { const pct = Math.max(1, Math.min(100, used / Math.max(1, max) * 100)); return h('div', { class: 'perf-bar' + (pct > 80 ? ' hot' : '') }, h('div', { style: { width: pct + '%' } })); };
  const approxMax = dm ? dm * 1024 * 0.5 : 2048; // lo que puede usar con holgura una pestaña del navegador
  const steps = h('input', { type: 'number', min: 10, max: 300, value: prefs.historySteps, style: { width: '80px' } }) as HTMLInputElement;
  const curCap = (() => { try { return localStorage.getItem('editor.dprCap') || ''; } catch { return ''; } })();
  const quality = h('select', {}, h('option', { value: '' }, 'Automática'), h('option', { value: '2' }, 'Alta (más nítida)'), h('option', { value: '1' }, 'Ahorro (más fluida, gasta menos)')) as HTMLSelectElement;
  quality.value = curCap;
  const free = h('button', { class: 'btn', type: 'button' }, 'Liberar memoria');
  free.onclick = async () => {
    if (!await confirmDialog('Liberar memoria', 'Se borra el historial de deshacer de todos los documentos abiertos (lo que ves no cambia). ¿Seguir?', 'Liberar')) return;
    for (const d of app.docs) { const h0 = d.history, cur = h0.steps[h0.index]; if (cur) { h0.steps = [cur]; h0.index = 0; } }
    app.emit('doc'); app.toast('Memoria liberada'); dlg.close(); perfDialog();
  };
  const dlg = showDialog({
    title: 'Rendimiento y memoria', width: 520,
    body: [
      h('div', { class: 'dlg-section' }, 'Este dispositivo'),
      h('div', { class: 'hint' }, `Memoria: ${dm ? '≈ ' + dm + ' GB' : 'desconocida'} · Núcleos: ${nav.hardwareConcurrency ?? '?'} · Aceleración gráfica: ${gl} · Pantalla: ${Math.round(innerWidth)} × ${Math.round(innerHeight)} (×${(devicePixelRatio || 1).toFixed(2)})`),
      h('div', { class: 'dlg-section' }, 'Uso de memoria'),
      docs.length ? table : h('div', { class: 'hint' }, 'No hay documentos abiertos.'),
      h('div', { class: 'hint' }, `Total aproximado: ${fmt(total)}`), bar(total, approxMax),
      h('div', { class: 'hint' }, `El historial de cada documento puede usar hasta ${fmt(budget)}; si se pasa, se olvidan los pasos más antiguos.`),
      st ? h('div', {}, h('div', { class: 'dlg-section' }, 'Espacio de Mis proyectos'), h('div', { class: 'hint' }, `${fmt(MB(st.used))} usados de ${fmt(MB(st.quota))}`), bar(st.used, st.quota)) : h('span', {}),
      h('div', { class: 'dlg-section' }, 'Ajustes'),
      row('Pasos de historial', steps),
      row('Calidad de la vista', quality), h('div', { class: 'hint' }, 'La calidad de la vista se aplica al volver a abrir el editor. No cambia la calidad de lo que guardas o exportas.'),
      h('div', { class: 'pj-row' }, free),
    ],
    okLabel: 'Aceptar',
    onOk: () => {
      prefs.historySteps = Math.max(10, Math.min(300, Math.round(+steps.value || prefs.historySteps))); savePrefs(); applyPrefs();
      try { if (quality.value) localStorage.setItem('editor.dprCap', quality.value); else localStorage.removeItem('editor.dprCap'); } catch { /* */ }
      if (quality.value !== curCap) app.toast('La calidad de la vista se aplicará al volver a abrir el editor');
    },
  });
}

/** Carta para comprobar la pantalla (negros, blancos, gris medio y degradados). */
export function screenCheckDialog() {
  const W = 480, Hh = 330, c = h('canvas', { width: W * 2, height: Hh * 2, style: { width: '100%', maxWidth: W + 'px', display: 'block', borderRadius: '6px' } }) as HTMLCanvasElement;
  const x = c.getContext('2d')!; x.scale(2, 2);
  // negros: cuadros casi negros sobre negro
  x.fillStyle = '#000'; x.fillRect(0, 0, W, 70);
  [2, 4, 6, 8, 10, 14, 18, 24].forEach((v, i) => { x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(12 + i * 58, 12, 46, 46); });
  // blancos: casi blancos sobre blanco
  x.fillStyle = '#fff'; x.fillRect(0, 70, W, 70);
  [253, 251, 249, 247, 245, 241, 237, 231].forEach((v, i) => { x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(12 + i * 58, 82, 46, 46); });
  // degradados (deben verse suaves, sin escalones ni tintes)
  const grad = (y: number, a: string, b: string) => { const g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, a); g.addColorStop(1, b); x.fillStyle = g; x.fillRect(0, y, W, 28); };
  grad(146, '#000', '#fff'); grad(176, '#000', '#f00'); grad(206, '#000', '#0f0'); grad(236, '#000', '#00f');
  // gamma: rayas blancas y negras frente a gris 186 (≈ 50 % de luz con gamma 2,2): de lejos deben parecer iguales
  for (let i = 0; i < 70; i += 2) { x.fillStyle = '#000'; x.fillRect(0, 266 + i * 0.9, W / 2, 0.9); x.fillStyle = '#fff'; x.fillRect(0, 266 + (i + 1) * 0.9, W / 2, 0.9); }
  x.fillStyle = 'rgb(186,186,186)'; x.fillRect(W / 2, 266, W / 2, 63);
  showDialog({
    title: 'Comprobar la pantalla', width: 540, cancelLabel: null, okLabel: 'Cerrar',
    body: [c, h('ul', { class: 'hint perf-list' },
      h('li', {}, 'Arriba (negros): deberías distinguir al menos 6 de los 8 cuadros. Si no ves los primeros, sube el brillo o desactiva el modo «visión nocturna» o de ahorro.'),
      h('li', {}, 'Blancos: deberías distinguir al menos 6 de los 8 cuadros. Si no, baja el brillo o el contraste.'),
      h('li', {}, 'Degradados: deben verse suaves, sin escalones ni tintes de color.'),
      h('li', {}, 'Abajo, de lejos o entornando los ojos, las rayas y el gris deben parecer del mismo tono (gamma correcta).'),
      h('li', {}, 'Para trabajos de impresión, lo ideal es calibrar la pantalla con un colorímetro: esta carta solo sirve para comprobar.'))],
  });
}

/** Ayuda › Informe de errores: los últimos fallos con su detalle técnico, para copiarlos y enviarlos. */
export function errorLogDialog() {
  let list: { t: number; m: string }[] = [];
  try { list = JSON.parse(localStorage.getItem('editor.errors') || '[]'); localStorage.setItem('editor.errorsSeen', String(Date.now())); } catch { /* */ }
  const nav = navigator as any;
  const head = `Photocap ${typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : ''} · ${nav.userAgent} · pantalla ${innerWidth}×${innerHeight} ×${devicePixelRatio} · memoria ${nav.deviceMemory ?? '?'} GB · táctil ${nav.maxTouchPoints ?? 0}`;
  const text = head + '\n\n' + (list.length ? list.slice().reverse().map(e => `[${new Date(e.t).toLocaleString()}] ${e.m}`).join('\n\n') : '(sin errores)');
  const pre = h('pre', { class: 'err-log no-i18n' }, text);
  const copy = h('button', { class: 'btn', type: 'button' }, 'Copiar');
  copy.onclick = async () => { try { await navigator.clipboard.writeText(text); app.toast('Copiado: pégalo en un mensaje para contarnos el fallo'); } catch { const r = document.createRange(); r.selectNodeContents(pre); getSelection()?.removeAllRanges(); getSelection()?.addRange(r); } };
  const clear = h('button', { class: 'btn', type: 'button' }, 'Borrar');
  clear.onclick = () => { try { localStorage.removeItem('editor.errors'); } catch { /* */ } pre.textContent = head + '\n\n(sin errores)'; };
  showDialog({
    title: 'Informe de errores', width: 560, cancelLabel: null, okLabel: 'Cerrar',
    body: [h('div', { class: 'hint' }, list.length ? 'Si algo ha fallado, copia esto y envíanoslo: así podemos encontrar el problema. No incluye tus imágenes.' : 'No se ha registrado ningún fallo.'), pre],
    extraButtons: [copy, clear],
  });
}
