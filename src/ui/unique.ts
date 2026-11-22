// Funciones propias de Editor que no traen los editores habituales:
// · Comprobar el contraste de los textos (accesibilidad WCAG) y arreglarlo con un clic.
// · Sacar la paleta de colores de la imagen (a las muestras, como CSS o como capa).

import { app } from './app';
import { h } from './dom';
import { showDialog } from './dialog';
import { contrastRatio } from './compare';
import { TextLayer, RasterLayer, walkLayers } from '../core/layers';
import { ctx2d, makeCanvas } from '../core/canvas';
import { userSwatches, saveUserSwatches } from './panels';

const hexRgb = (s: string) => { const n = parseInt(s.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const rgbHex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

// ---- Contraste de los textos -----------------------------------------------------------------
type TextCheck = { layer: TextLayer; fg: number[]; bg: number[]; ratio: number; large: boolean };
/** Color de fondo bajo cada texto (lo que se ve sin ese texto) y su relación de contraste. */
function checkTexts(): TextCheck[] {
  const d = app.doc!; const out: TextCheck[] = [];
  for (const l of walkLayers(d.root)) {
    if (!(l instanceof TextLayer) || !l.isVisibleInTree() || !l.props.text.trim()) continue;
    const b = l.bounds(); const x = Math.max(0, Math.floor(b.x)), y = Math.max(0, Math.floor(b.y)), w = Math.min(d.width, Math.ceil(b.x + b.w)) - x, hh = Math.min(d.height, Math.ceil(b.y + b.h)) - y;
    if (w < 1 || hh < 1) continue;
    // se oculta el texto un momento para ver qué hay detrás
    l.visible = false; d.invalidate();
    const under = ctx2d(d.getComposite()).getImageData(x, y, w, hh).data;
    l.visible = true; d.invalidate();
    const mine = ctx2d(l.canvas).getImageData(x, y, w, hh).data;
    // media del fondo justo donde están las letras (y, si no hay letras, toda la caja)
    let r = 0, g = 0, bb = 0, n = 0;
    for (let i = 0; i < mine.length; i += 4) if (mine[i + 3] > 128) { r += under[i]; g += under[i + 1]; bb += under[i + 2]; n++; }
    if (!n) for (let i = 0; i < under.length; i += 4) { r += under[i]; g += under[i + 1]; bb += under[i + 2]; n++; }
    const bg = [r / n, g / n, bb / n].map(Math.round), fg = hexRgb(l.props.color);
    const large = l.props.size >= 24 || (l.props.bold && l.props.size >= 18.66);
    out.push({ layer: l, fg, bg, ratio: contrastRatio(fg, bg), large });
  }
  return out;
}
/** El color más parecido al original que cumple el contraste pedido (aclarando u oscureciendo). */
function fixColor(fg: number[], bg: number[], target: number): string {
  let best = fg, bestD = Infinity;
  for (const dir of [-1, 1]) for (let k = 0; k <= 1.0001; k += 0.02) {
    const c = fg.map(v => dir < 0 ? v * (1 - k) : v + (255 - v) * k);
    if (contrastRatio(c, bg) >= target) { if (k < bestD) { bestD = k; best = c; } break; }
  }
  return rgbHex(best[0], best[1], best[2]);
}
export function contrastDialog() {
  const d = app.doc; if (!d) return;
  const list = checkTexts();
  if (!list.length) { app.toast('No hay capas de texto visibles que comprobar', 'warn'); return; }
  const rows = list.map(c => {
    const need = c.large ? 3 : 4.5, needAAA = c.large ? 4.5 : 7;
    const ok = c.ratio >= need, okAAA = c.ratio >= needAAA;
    const sample = h('span', { class: 'ct-sample', style: { color: c.layer.props.color, background: rgbHex(c.bg[0], c.bg[1], c.bg[2]) } }, 'Aa');
    const verdict = h('span', { class: 'ct-verdict ' + (okAAA ? 'ok' : ok ? 'mid' : 'bad') }, okAAA ? 'Excelente (AAA)' : ok ? 'Correcto (AA)' : 'Poco legible');
    const fix = ok ? null : h('button', { class: 'btn', type: 'button', onclick: () => {
      c.layer.props.color = fixColor(c.fg, c.bg, need + 0.05); c.layer.props.runs?.forEach((r: any) => { if (r.color) r.color = c.layer.props.color; }); c.layer.render(); d.invalidate(); d.commit('Arreglar contraste');
      fix!.replaceWith(h('span', { class: 'ct-verdict ok' }, 'Arreglado')); sample.style.color = c.layer.props.color;
    } }, 'Arreglar');
    return h('div', { class: 'ct-row' }, sample, h('div', { class: 'ct-info' }, h('b', {}, c.layer.name), h('span', { class: 'hint' }, `Contraste ${c.ratio.toFixed(2)} : 1 · necesita ${need} : 1 (${c.large ? 'texto grande' : 'texto normal'})`)), verdict, fix);
  });
  showDialog({ title: 'Contraste de los textos', width: 560, okLabel: 'Cerrar', cancelLabel: null,
    body: [h('div', { class: 'hint' }, 'Comprueba si cada texto se lee bien sobre lo que tiene detrás, según las pautas de accesibilidad WCAG. «Arreglar» cambia lo mínimo el color del texto para que cumpla.'), h('div', { class: 'ct-list' }, ...rows)] });
}

// ---- Paleta de la imagen -------------------------------------------------------------------------
const avg = (b: number[][]) => { const s = [0, 0, 0]; for (const p of b) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return s.map(v => v / b.length); };
/** Colores principales de la imagen (corte por la mediana sobre una muestra reducida). */
export function extractPalette(src: HTMLCanvasElement, n: number): { color: string; share: number }[] {
  const k = Math.min(1, 200 / Math.max(src.width, src.height)), w = Math.max(1, Math.round(src.width * k)), hh = Math.max(1, Math.round(src.height * k));
  const c = makeCanvas(w, hh); const x = ctx2d(c); x.drawImage(src, 0, 0, w, hh);
  const d = x.getImageData(0, 0, w, hh).data, px: number[][] = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) px.push([d[i], d[i + 1], d[i + 2]]);
  if (!px.length) return [];
  let boxes = [px];
  const distinct = () => { const cs = boxes.map(avg); let k = 0; cs.forEach((c, i) => { if (!cs.slice(0, i).some(o => Math.hypot(o[0] - c[0], o[1] - c[1], o[2] - c[2]) < 24)) k++; }); return k; };
  let guard = 0;
  while (distinct() < n && guard++ < n * 6) {
    // se parte la caja con más variación por su canal más amplio
    let bi = -1, bestRange = -1, bestCh = 0;
    // la que más color «mezcla» (rango del canal por número de píxeles): así los colores distintos se separan
    boxes.forEach((b, i) => { if (b.length < 2) return; for (let ch = 0; ch < 3; ch++) { let lo = 255, hi = 0; for (const p of b) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; } if (hi - lo < 8) continue; const r = (hi - lo) * Math.sqrt(b.length); if (r > bestRange) { bestRange = r; bi = i; bestCh = ch; } } });
    if (bi < 0) break;
    const b = boxes[bi].sort((p, q) => p[bestCh] - q[bestCh]), mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  // refinado (k-medias): cada píxel va con el color más cercano y los centros se recalculan
  let centers = boxes.map(avg);
  for (let it = 0; it < 8; it++) {
    const groups: number[][][] = centers.map(() => []);
    for (const p of px) { let bi = 0, bd = Infinity; centers.forEach((c, i) => { const dd = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2; if (dd < bd) { bd = dd; bi = i; } }); groups[bi].push(p); }
    boxes = groups.filter(g => g.length); centers = boxes.map(avg);
  }
  // se juntan los colores casi iguales (sumando su presencia) y se queda con los n más presentes
  const res: { c: number[]; share: number }[] = [];
  for (const b of boxes) { const c = avg(b), sh = b.length / px.length, o = res.find(r => Math.hypot(r.c[0] - c[0], r.c[1] - c[1], r.c[2] - c[2]) < 24); if (o) { o.c = o.c.map((v, i) => (v * o.share + c[i] * sh) / (o.share + sh)); o.share += sh; } else res.push({ c, share: sh }); }
  return res.sort((a, b) => b.share - a.share).slice(0, n).map(r => ({ color: rgbHex(r.c[0], r.c[1], r.c[2]), share: r.share }));
}
export function paletteDialog() {
  const d = app.doc; if (!d) return;
  let n = 6, pal = extractPalette(d.getComposite(), n);
  const strip = h('div', { class: 'pal-strip' });
  const render = () => {
    strip.innerHTML = '';
    for (const p of pal) {
      const sw = h('button', { class: 'pal-sw', type: 'button', title: 'Clic: usar como color frontal', style: { background: p.color, flex: String(Math.max(0.6, p.share * n)) } }, h('span', {}, p.color.toUpperCase()));
      sw.onclick = () => { app.setColors(p.color, app.bg); app.toast('Color frontal: ' + p.color); };
      strip.append(sw);
    }
  };
  const count = h('select', {}, ...[3, 4, 5, 6, 8, 10, 12].map(v => h('option', { value: String(v), selected: v === n }, v + ' colores'))) as HTMLSelectElement;
  count.onchange = () => { n = +count.value; pal = extractPalette(d.getComposite(), n); render(); };
  const toSwatches = h('button', { class: 'btn', type: 'button', onclick: () => { saveUserSwatches([...pal.map((p, i) => ({ name: `Paleta ${i + 1}`, color: p.color })), ...userSwatches()]); app.toast('Añadidos a Muestras'); } }, 'Añadir a Muestras');
  const css = h('button', { class: 'btn', type: 'button', onclick: async () => {
    const text = ':root {\n' + pal.map((p, i) => `  --color-${i + 1}: ${p.color};`).join('\n') + '\n}';
    try { await navigator.clipboard.writeText(text); app.toast('CSS copiado'); } catch { app.toast(text, 'warn'); }
  } }, 'Copiar como CSS');
  const layer = h('button', { class: 'btn', type: 'button', onclick: () => {
    // capa con la paleta en franjas, abajo de la imagen
    const l = d.newRasterLayer('Paleta') as RasterLayer, x = ctx2d(l.canvas), H = Math.max(20, Math.round(d.height * 0.12)), W = d.width / pal.length;
    pal.forEach((p, i) => { x.fillStyle = p.color; x.fillRect(Math.round(i * W), d.height - H, Math.ceil(W), H); });
    l.touch(); d.invalidate(); d.commit('Paleta de colores'); app.toast('Capa «Paleta» creada');
  } }, 'Crear capa con la paleta');
  render();
  showDialog({ title: 'Paleta de la imagen', width: 560, okLabel: 'Cerrar', cancelLabel: null,
    body: [h('div', { class: 'form-row' }, h('span', { class: 'lbl' }, 'Cantidad'), count), strip, h('div', { class: 'hint' }, 'Los colores más presentes en la imagen, de más a menos. Clic en uno para pintar con él.'), h('div', { class: 'pal-actions' }, toSwatches, css, layer)] });
}
