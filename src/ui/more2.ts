// Más funciones de los editores profesionales: información de archivo (EXIF y datos de autor), exportación rápida
// como PNG, definir forma personalizada y glifos (símbolos y caracteres especiales para el texto).

import { app } from './app';
import { h } from './dom';
import { showDialog, row, promptDialog } from './dialog';
import { ShapeLayer, TextLayer, type PathPoint } from '../core/layers';
import { addUserShape } from '../core/customshapes';

// ---- Información de archivo -----------------------------------------------------------------------
export function fileInfoDialog() {
  const d = app.doc; if (!d) return;
  const m = d.meta;
  const f = (v?: string) => h('input', { type: 'text', class: 'wide', value: v ?? '' }) as HTMLInputElement;
  const title = f(m.title), author = f(m.author), copy = f(m.copyright), keys = f(m.keywords);
  const desc = h('textarea', { rows: 3, class: 'wide' }, m.description ?? '') as HTMLTextAreaElement;
  const ex = m.exif ? Object.entries(m.exif) : [];
  const exBox = ex.length ? h('div', { class: 'exif-grid' }, ...ex.flatMap(([k, v]) => [h('span', { class: 'hint' }, k), k === 'GPS' ? h('a', { href: `https://www.openstreetmap.org/?mlat=${v.split(',')[0]}&mlon=${v.split(',')[1].trim()}#map=15/${v.split(',')[0]}/${v.split(',')[1].trim()}`, target: '_blank', rel: 'noopener' }, v + ' (ver mapa)') : h('span', {}, v)]))
    : h('div', { class: 'hint' }, 'Esta imagen no trae datos de cámara (EXIF).');
  showDialog({ title: 'Información de archivo', width: 520,
    body: [h('div', { class: 'dlg-section' }, 'Descripción'), row('Título', title), row('Autor', author), row('Copyright', copy), row('Palabras clave', keys), row('Descripción', desc),
      h('div', { class: 'dlg-section' }, 'Imagen'), h('div', { class: 'exif-grid' }, h('span', { class: 'hint' }, 'Tamaño'), h('span', {}, `${d.width} × ${d.height} px (${(d.width * d.height / 1e6).toFixed(1)} megapíxeles)`), h('span', { class: 'hint' }, 'Resolución'), h('span', {}, `${d.ppi} ppp · ${(d.width / d.ppi * 2.54).toFixed(1)} × ${(d.height / d.ppi * 2.54).toFixed(1)} cm al imprimir`), h('span', { class: 'hint' }, 'Capas'), h('span', {}, String(d.allLayers().length))),
      h('div', { class: 'dlg-section' }, 'Datos de la cámara'), exBox,
      h('div', { class: 'hint' }, 'Los datos de autor se guardan en el proyecto (.edp). Al exportar a JPG/PNG no se añade ningún dato de cámara ni de ubicación, para proteger tu privacidad.')],
    onOk: () => { Object.assign(m, { title: title.value.trim(), author: author.value.trim(), copyright: copy.value.trim(), keywords: keys.value.trim(), description: desc.value.trim() }); d.modified = true; app.emit('docs'); app.toast('Información guardada'); } });
}

// ---- Exportación rápida ------------------------------------------------------------------------------
export async function quickExportPng() {
  const d = app.doc; if (!d) return;
  const io = await import('../io/files');
  try { const blob = await io.exportImage(d, 'image/png', 1, 1); await io.saveBlob(blob, d.name.replace(/\.[^.]+$/, '') + '.png'); app.toast('PNG exportado'); }
  catch (e: any) { if (e?.name !== 'AbortError') app.toast('No se pudo exportar: ' + (e?.message ?? e), 'warn'); }
}

// ---- Definir forma personalizada -------------------------------------------------------------------------
export async function defineCustomShape() {
  const d = app.doc, l = d?.active; if (!d || !l) return;
  let subs: { closed: boolean; pts: PathPoint[] }[];
  if (l instanceof ShapeLayer && l.props.shape === 'path' && l.props.path) subs = [l.props.path];
  else if (l.vmask) subs = l.vmask.subpaths;
  else if (d.activePath >= 0 && d.paths[d.activePath]) subs = d.paths[d.activePath].subpaths;
  else { const ops = await import('./ops'); subs = await ops.layerOutlines(l); }
  const all = subs.flatMap(s => s.pts); if (all.length < 3) { app.toast('Elige una forma, un texto, un trazado o una capa con un dibujo', 'warn'); return; }
  const xs = all.flatMap(p => [p.x, p.ix, p.ox]), ys = all.flatMap(p => [p.y, p.iy, p.oy]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 || 1, hh = Math.max(...ys) - y0 || 1, k = 100 / Math.max(w, hh), ox = (100 - w * k) / 2, oy = (100 - hh * k) / 2;
  const X = (v: number) => +((v - x0) * k + ox).toFixed(2), Y = (v: number) => +((v - y0) * k + oy).toFixed(2);
  const dStr = subs.map(s => { const P = s.pts; if (P.length < 2) return ''; let r = `M${X(P[0].x)} ${Y(P[0].y)}`; const n = P.length, seg = s.closed ? n : n - 1; for (let i = 0; i < seg; i++) { const a = P[i], b = P[(i + 1) % n]; r += `C${X(a.ox)} ${Y(a.oy)} ${X(b.ix)} ${Y(b.iy)} ${X(b.x)} ${Y(b.y)}`; } return r + 'Z'; }).join('');
  const name = (await promptDialog('Definir forma personalizada', 'Nombre de la forma', l.name))?.trim(); if (!name) return;
  const id = addUserShape(name, dStr);
  // aparece en la lista de la herramienta Forma
  const st = app.tools.get('shape') as any, opt = st?.options?.find((o: any) => o.key === 'shape');
  if (opt) opt.choices.push({ value: 'custom:' + id, label: name });
  app.emit('tool'); app.toast(`Forma «${name}» añadida a la herramienta Forma (U)`);
}

// ---- Glifos ------------------------------------------------------------------------------------------------
const GLYPHS: [string, string][] = [
  ['Letras', 'ñÑáéíóúÁÉÍÓÚüÜçÇàèìòùâêîôûäëïöÿßæœøåÆŒØÅ¿¡ªº'],
  ['Puntuación', '«»‹›“”‘’„‚…–—•·§¶†‡※‰‱′″'],
  ['Monedas', '€$£¥¢₩₹₽₺₿¤'],
  ['Matemáticas', '±×÷≈≠≤≥∞√∑∏∫∂∆πΩµ°¹²³¼½¾‰∈∉∩∪∧∨¬'],
  ['Flechas', '←→↑↓↔↕↖↗↘↙⇐⇒⇑⇓⇔➔➜➤➡⬅⬆⬇↩↪⟲⟳'],
  ['Símbolos', '©®™℗℠✓✔✗✘★☆✦✧♥♡♦♣♠●○◆◇■□▲△▼▽◀▶☀☁☂☃☎✉✂✏✒⚑⚐⚠⚡♪♫☯☮✝☪✡'],
  ['Emojis', '😀😂😍🥰😎🤔😢😡👍👏🙏💪🎉🎂🎁❤️🔥⭐✨🌈☀️🌙🌸🌹🍀🍕☕🎵📷📌✅❌⚽🏆🚀✈️🏠💡💬'],
];
/** Caracteres «visibles» (un emoji con modificadores cuenta como uno); sin Intl.Segmenter, uno por punto de código. */
function graphemes(s: string): string[] { const S = (Intl as any).Segmenter; if (S) return [...new S('es', { granularity: 'grapheme' }).segment(s)].map((x: any) => x.segment); return [...s].filter(c => c !== '\uFE0F'); }
export function glyphsDialog() {
  const area = document.querySelector('textarea.text-editor') as HTMLTextAreaElement | null;
  const insert = async (g: string) => {
    const ta = document.querySelector('textarea.text-editor') as HTMLTextAreaElement | null;
    if (ta) { const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a; ta.value = ta.value.slice(0, a) + g + ta.value.slice(b); ta.selectionStart = ta.selectionEnd = a + g.length; ta.dispatchEvent(new Event('input')); ta.focus(); return; }
    const l = app.doc?.active;
    if (l instanceof TextLayer && !l.isLocked()) { l.props.text += g; l.render(); app.doc!.invalidate(); app.doc!.commit('Insertar glifo'); app.toast(`«${g}» añadido al final del texto`); return; }
    try { await navigator.clipboard.writeText(g); app.toast(`«${g}» copiado: pégalo en un texto con Ctrl+V`); } catch { app.toast('Selecciona una capa de texto para insertarlo', 'warn'); }
  };
  const body = GLYPHS.map(([cat, chars]) => h('div', {}, h('div', { class: 'dlg-section' }, cat), h('div', { class: 'glyph-grid' }, ...graphemes(chars).map(g => { const b = h('button', { class: 'glyph', type: 'button', title: 'Insertar ' + g }, g); b.onmousedown = e => e.preventDefault(); b.onclick = () => insert(g); return b; }))));
  showDialog({ title: 'Glifos', width: 460, side: true, okLabel: 'Cerrar', cancelLabel: null, body: [h('div', { class: 'hint' }, area ? 'Toca un símbolo para escribirlo donde está el cursor.' : 'Toca un símbolo para añadirlo al texto seleccionado (o copiarlo).'), ...body] });
}
