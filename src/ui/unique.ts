// Funciones propias de Editor que no traen los editores habituales:
// · Comprobar el contraste de los textos (accesibilidad WCAG) y arreglarlo con un clic.
// · Sacar la paleta de colores de la imagen (a las muestras, como CSS o como capa).

import { app } from './app';
import { h } from './dom';
import { showDialog } from './dialog';
import { contrastRatio, stateComposite } from './compare';
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

// ---- Timelapse de la edición -----------------------------------------------------------------------
/** Cuadros del timelapse: cada paso del historial, reducido y centrado en un tamaño fijo. */
export function timelapseFrames(maxSide: number, labels: boolean, delay: number): { canvas: HTMLCanvasElement; delay: number }[] {
  const d = app.doc!; const steps = d.history.steps.slice(0, d.history.index + 1);
  const W0 = Math.max(...steps.map(s => s.snap.width)), H0 = Math.max(...steps.map(s => s.snap.height));
  const k = Math.min(1, maxSide / Math.max(W0, H0)), W = Math.max(2, Math.round(W0 * k / 2) * 2), H = Math.max(2, Math.round(H0 * k / 2) * 2);
  const out: { canvas: HTMLCanvasElement; delay: number }[] = [];
  steps.forEach((s, i) => {
    const img = stateComposite(d, i); if (!img) return;
    const c = makeCanvas(W, H), x = ctx2d(c); x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
    // cada estado, encajado y centrado (por si el lienzo cambió de tamaño al recortar)
    const s2 = Math.min(W / img.width, H / img.height), w = img.width * s2, hh = img.height * s2;
    x.imageSmoothingQuality = 'high'; x.drawImage(img, (W - w) / 2, (H - hh) / 2, w, hh);
    if (labels) {
      const t = `${i + 1}/${steps.length} · ${s.name}`; const fs = Math.max(11, Math.round(H / 28));
      x.font = `600 ${fs}px system-ui, sans-serif`; const tw = x.measureText(t).width;
      x.fillStyle = 'rgba(0,0,0,.6)'; x.fillRect(8, H - fs - 16, tw + 16, fs + 10); x.fillStyle = '#fff'; x.fillText(t, 16, H - 13);
    }
    out.push({ canvas: c, delay: i === steps.length - 1 ? Math.max(1500, delay * 4) : delay });
  });
  return out;
}
export function timelapseDialog() {
  const d = app.doc; if (!d) return;
  const n = d.history.index + 1;
  if (n < 2) { app.toast('Aún no hay pasos en el historial: edita algo primero', 'warn'); return; }
  const fmt = h('select', {}, h('option', { value: 'gif' }, 'GIF animado'), h('option', { value: 'video' }, 'Vídeo (WebM o MP4)')) as HTMLSelectElement;
  const speed = h('select', {}, ...[[150, 'Rápido'], [400, 'Normal'], [800, 'Lento']].map(([v, t]) => h('option', { value: String(v), selected: v === 400 }, t as string))) as HTMLSelectElement;
  const size = h('select', {}, ...[480, 720, 1080].map(v => h('option', { value: String(v), selected: v === 720 }, v + ' px'))) as HTMLSelectElement;
  const lab = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const row2 = (t: string, el: HTMLElement) => h('div', { class: 'form-row' }, h('span', { class: 'lbl' }, t), el);
  showDialog({ title: 'Timelapse de la edición', width: 420, okLabel: 'Crear',
    body: [h('div', { class: 'hint' }, `Un vídeo o GIF con los ${n} pasos del historial, uno detrás de otro: ideal para enseñar cómo has hecho la imagen.`), row2('Formato', fmt), row2('Velocidad', speed), row2('Tamaño', size), h('label', { class: 'check' }, lab, ' Mostrar el nombre de cada paso')],
    onOk: async () => {
      app.toast('Preparando el timelapse…');
      const frames = timelapseFrames(+size.value, lab.checked, +speed.value), base = d.name.replace(/\.[^.]+$/, '') + ' - timelapse';
      const io = await import('../io/files');
      if (fmt.value === 'gif') { const { encodeGif } = await import('../io/gif'); await io.saveBlob(encodeGif(frames), base + '.gif'); app.toast(`Timelapse guardado (${frames.length} pasos)`); return; }
      await recordFrames(frames, base);
    } });
}
/** Graba unos cuadros como vídeo con el grabador del navegador (WebM; MP4 en Safari). */
export async function recordFrames(frames: { canvas: HTMLCanvasElement; delay: number }[], base: string, audio?: { buffer: AudioBuffer; offset: number; volume: number } | null, doneMsg?: string) {
  const mime = typeof MediaRecorder === 'undefined' ? null : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'].find(m => MediaRecorder.isTypeSupported(m));
  const c = makeCanvas(frames[0].canvas.width, frames[0].canvas.height), x = ctx2d(c);
  if (!mime || typeof (c as any).captureStream !== 'function') { app.toast('Este navegador no graba vídeo: usa GIF', 'warn'); return; }
  const stream = (c as any).captureStream(0) as MediaStream, track = stream.getVideoTracks()[0] as any;
  // sonido: se reproduce en una salida que se mezcla en la grabación
  let actx: AudioContext | null = null, src: AudioBufferSourceNode | null = null;
  if (audio) {
    try {
      actx = new AudioContext(); const dest = actx.createMediaStreamDestination(), g = actx.createGain(); g.gain.value = audio.volume;
      src = actx.createBufferSource(); src.buffer = audio.buffer; src.connect(g); g.connect(dest);
      for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
    } catch { actx = null; src = null; }
  }
  // con sonido hace falta un formato que admita audio (vp9/vp8 con opus, o mp4 con aac)
  const amime = actx ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'].find(m => MediaRecorder.isTypeSupported(m)) ?? mime : mime;
  const rec = new MediaRecorder(stream, { mimeType: amime, videoBitsPerSecond: 6_000_000 }), chunks: Blob[] = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>(r => { rec.onstop = () => r(); });
  app.toast('Grabando el vídeo…'); rec.start();
  if (src && actx) { await actx.resume().catch(() => {}); const off = audio!.offset / 1000; if (off >= 0) src.start(actx.currentTime + off); else src.start(0, -off); }
  for (const f of frames) { x.drawImage(f.canvas, 0, 0); track.requestFrame?.(); await new Promise(r => setTimeout(r, f.delay)); }
  rec.stop(); await done;
  try { src?.stop(); } catch { /* ya había terminado */ } actx?.close().catch(() => {});
  const mp4 = amime.startsWith('video/mp4'), io = await import('../io/files');
  await io.saveBlob(new Blob(chunks, { type: mp4 ? 'video/mp4' : 'video/webm' }), base + (mp4 ? '.mp4' : '.webm'));
  app.toast(doneMsg ?? `Timelapse guardado (${frames.length} pasos)`);
}

// ---- Exportar para redes sociales -------------------------------------------------------------------
export const SOCIAL: [string, string, number, number][] = [
  ['ig', 'Instagram cuadrado', 1080, 1080], ['ig45', 'Instagram vertical 4:5', 1080, 1350], ['story', 'Historias / Reels / TikTok', 1080, 1920],
  ['fbpost', 'Facebook publicación', 1200, 630], ['fbcover', 'Facebook portada', 1640, 624], ['ytthumb', 'YouTube miniatura', 1280, 720],
  ['ytbanner', 'YouTube banner', 2560, 1440], ['xpost', 'X (Twitter) publicación', 1600, 900], ['xheader', 'X (Twitter) cabecera', 1500, 500],
  ['li', 'LinkedIn publicación', 1200, 627], ['pin', 'Pinterest', 1000, 1500], ['wa', 'WhatsApp foto de perfil', 640, 640],
];
/** Mapa de «interés» reducido (detalle y contraste local) para decidir dónde recortar. */
function interestMap(src: HTMLCanvasElement, side: number) {
  const k = Math.min(1, side / Math.max(src.width, src.height)), w = Math.max(1, Math.round(src.width * k)), hh = Math.max(1, Math.round(src.height * k));
  const c = makeCanvas(w, hh), x = ctx2d(c); x.drawImage(src, 0, 0, w, hh);
  const d = x.getImageData(0, 0, w, hh).data, L = new Float32Array(w * hh), E = new Float32Array(w * hh);
  for (let i = 0; i < w * hh; i++) L[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  // bordes + algo de saturación (los colores vivos suelen ser lo importante) + un poco de preferencia por el centro
  for (let y = 1; y < hh - 1; y++) for (let xx = 1; xx < w - 1; xx++) {
    const i = y * w + xx, gx = L[i + 1] - L[i - 1], gy = L[i + w] - L[i - w];
    const mx = Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]), mn = Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    const cx = xx / w - 0.5, cy = y / hh - 0.5;
    E[i] = Math.hypot(gx, gy) + (mx - mn) * 0.6 + 4 * (1 - Math.hypot(cx, cy));
  }
  return { E, w, h: hh, k };
}
/** Mejor recorte de proporción `ar` (ancho/alto): contiene entero el sujeto principal y corta lo menos posible. */
export function smartCrop(src: HTMLCanvasElement, ar: number): { x: number; y: number; w: number; h: number } {
  const W = src.width, H = src.height;
  let cw = W, ch = Math.round(W / ar); if (ch > H) { ch = H; cw = Math.round(H * ar); }
  const m = interestMap(src, 160), I = new Float64Array((m.w + 1) * (m.h + 1));
  for (let y = 0; y < m.h; y++) { let row = 0; for (let x = 0; x < m.w; x++) { row += m.E[y * m.w + x]; I[(y + 1) * (m.w + 1) + x + 1] = I[y * (m.w + 1) + x + 1] + row; } }
  const S = (x0: number, y0: number, x1: number, y1: number) => { x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(m.w, x1); y1 = Math.min(m.h, y1); if (x1 <= x0 || y1 <= y0) return 0; return I[y1 * (m.w + 1) + x1] - I[y0 * (m.w + 1) + x1] - I[y1 * (m.w + 1) + x0] + I[y0 * (m.w + 1) + x0]; };
  const sw = Math.max(1, Math.round(cw * m.k)), sh = Math.max(1, Math.round(ch * m.k));
  // 1) sujeto principal: la zona con más interés concentrado (interés medio en una ventana) y su extensión
  const r = Math.max(2, Math.round(Math.max(m.w, m.h) / 14)), dens = new Float32Array(m.w * m.h);
  let hx = 0, hy = 0, hv = -1;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) { const v = S(x - r, y - r, x + r + 1, y + r + 1); dens[y * m.w + x] = v; if (v > hv) { hv = v; hx = x; hy = y; } }
  let bx0 = hx, by0 = hy, bx1 = hx, by1 = hy;
  { const seen = new Uint8Array(m.w * m.h), st = [hy * m.w + hx], T = hv * 0.55; seen[st[0]] = 1;
    while (st.length) { const q = st.pop()!, x = q % m.w, y = (q / m.w) | 0; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      for (const n of [q - 1, q + 1, q - m.w, q + m.w]) { if (n < 0 || n >= dens.length || seen[n] || (Math.abs((n % m.w) - x) > 1)) continue; seen[n] = 1; if (dens[n] >= T) st.push(n); } } }
  // la ventana de densidad ensancha la caja: se ajusta un poco hacia dentro
  bx0 = Math.max(0, bx0 - Math.round(r * 0.3)); by0 = Math.max(0, by0 - Math.round(r * 0.3)); bx1 = Math.min(m.w - 1, bx1 + Math.round(r * 0.3)); by1 = Math.min(m.h - 1, by1 + Math.round(r * 0.3));
  // 2) posiciones válidas: las que contienen el sujeto (si cabe); si no cabe, centradas en él
  const fitsX = bx1 - bx0 + 1 <= sw, fitsY = by1 - by0 + 1 <= sh;
  const xr: [number, number] = fitsX ? [Math.max(0, bx1 + 1 - sw), Math.min(m.w - sw, bx0)] : [Math.max(0, Math.min(m.w - sw, hx - (sw >> 1))), Math.max(0, Math.min(m.w - sw, hx - (sw >> 1)))];
  const yr: [number, number] = fitsY ? [Math.max(0, by1 + 1 - sh), Math.min(m.h - sh, by0)] : [Math.max(0, Math.min(m.h - sh, hy - (sh >> 1))), Math.max(0, Math.min(m.h - sh, hy - (sh >> 1)))];
  // 3) entre ellas, la que más interés reúne y menos cosas corta en sus bordes
  const B = 2, kv = 0.12 * sw / (2 * B), kh = 0.12 * sh / (2 * B);
  let best = -Infinity, bx = xr[0], by = yr[0];
  for (let y = yr[0]; y <= Math.max(yr[0], yr[1]); y++) for (let x = xr[0]; x <= Math.max(xr[0], xr[1]); x++) {
    let s = S(x, y, x + sw, y + sh);
    if (x > 0) s -= kv * S(x - B, y, x + B, y + sh);
    if (x + sw < m.w) s -= kv * S(x + sw - B, y, x + sw + B, y + sh);
    if (y > 0) s -= kh * S(x, y - B, x + sw, y + B);
    if (y + sh < m.h) s -= kh * S(x, y + sh - B, x + sw, y + sh + B);
    if (s > best) { best = s; bx = x; by = y; }
  }
  return { x: Math.max(0, Math.min(W - cw, Math.round(bx / m.k))), y: Math.max(0, Math.min(H - ch, Math.round(by / m.k))), w: cw, h: ch };
}
/** La imagen adaptada a un tamaño: recorte inteligente o ampliada con el fondo desenfocado. */
export function fitTo(src: HTMLCanvasElement, W: number, H: number, mode: 'crop' | 'blur' | 'color', color = '#ffffff'): HTMLCanvasElement {
  const out = makeCanvas(W, H), x = ctx2d(out); x.imageSmoothingQuality = 'high';
  if (mode === 'crop') { const r = smartCrop(src, W / H); x.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, W, H); return out; }
  if (mode === 'blur') {
    // fondo: la misma imagen ampliada para cubrir todo, muy desenfocada y algo oscurecida
    const s = Math.max(W / src.width, H / src.height), small = makeCanvas(Math.max(1, Math.round(W / 8)), Math.max(1, Math.round(H / 8))), sx = ctx2d(small);
    sx.filter = 'blur(3px)'; sx.drawImage(src, (small.width - src.width * s / 8) / 2, (small.height - src.height * s / 8) / 2, src.width * s / 8, src.height * s / 8); sx.filter = 'none';
    x.drawImage(small, 0, 0, W, H); x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(0, 0, W, H);
  } else { x.fillStyle = color; x.fillRect(0, 0, W, H); }
  const s = Math.min(W / src.width, H / src.height), w = src.width * s, hh = src.height * s;
  x.drawImage(src, (W - w) / 2, (H - hh) / 2, w, hh);
  return out;
}
export function socialDialog() {
  const d = app.doc; if (!d) return;
  const checks = SOCIAL.map(([id, name, w, hh]) => { const c = h('input', { type: 'checkbox', checked: ['ig', 'ig45', 'story', 'ytthumb'].includes(id) }) as HTMLInputElement; return { id, name, w, hh, c, el: h('label', { class: 'check soc-item' }, c, ` ${name} `, h('span', { class: 'hint' }, `${w}×${hh}`)) }; });
  const mode = h('select', {}, h('option', { value: 'crop' }, 'Recorte inteligente (busca lo importante)'), h('option', { value: 'blur' }, 'Imagen entera con fondo desenfocado'), h('option', { value: 'color' }, 'Imagen entera con fondo de color')) as HTMLSelectElement;
  const col = h('input', { type: 'color', class: 'color-input', value: '#ffffff' }) as HTMLInputElement;
  const fmt = h('select', {}, h('option', { value: 'image/jpeg' }, 'JPG'), h('option', { value: 'image/png' }, 'PNG'), h('option', { value: 'image/webp' }, 'WebP')) as HTMLSelectElement;
  const prev = h('div', { class: 'soc-prev' });
  const preview = () => {
    prev.innerHTML = ''; const src = d.flatten();
    for (const t of checks.filter(t => t.c.checked).slice(0, 6)) { const c = fitTo(src, Math.round(t.w / 10), Math.round(t.hh / 10), mode.value as any, col.value); c.title = t.name; prev.append(h('div', { class: 'soc-thumb' }, c, h('span', {}, t.name))); }
  };
  checks.forEach(t => t.c.onchange = preview); mode.onchange = preview; col.oninput = preview;
  showDialog({ title: 'Exportar para redes sociales', width: 640, okLabel: 'Exportar',
    body: [h('div', { class: 'soc-grid' }, ...checks.map(t => t.el)), h('div', { class: 'form-row' }, h('span', { class: 'lbl' }, 'Si no encaja'), mode, col), h('div', { class: 'form-row' }, h('span', { class: 'lbl' }, 'Formato'), fmt), prev,
      h('div', { class: 'hint' }, 'Se crea una imagen por cada red, con su tamaño recomendado. Si eliges varias, se guardan juntas en un ZIP.')],
    onOk: async () => {
      const list = checks.filter(t => t.c.checked); if (!list.length) { app.toast('Elige al menos una red', 'warn'); return false; }
      const src = d.flatten(), ext = fmt.value === 'image/png' ? '.png' : fmt.value === 'image/webp' ? '.webp' : '.jpg', base = d.name.replace(/\.[^.]+$/, '');
      const io = await import('../io/files');
      const files: { name: string; data: Uint8Array }[] = [];
      for (const t of list) {
        const c = fitTo(src, t.w, t.hh, mode.value as any, col.value);
        const blob = await new Promise<Blob>(r => c.toBlob(b => r(b!), fmt.value, 0.92));
        files.push({ name: `${base} - ${t.name.replace(/[\\/:*?"<>|]/g, '')} ${t.w}x${t.hh}${ext}`, data: new Uint8Array(await blob.arrayBuffer()) });
      }
      if (files.length === 1) await io.saveBlob(new Blob([files[0].data], { type: fmt.value }), files[0].name);
      else { const { makeZip } = await import('../io/zip'); await io.saveBlob(makeZip(files), base + ' - redes.zip'); }
      app.toast(`${files.length} ${files.length === 1 ? 'imagen exportada' : 'imágenes exportadas'}`);
    } });
  preview();
}

// ---- Enderezar automáticamente -------------------------------------------------------------------
/**
 * Ángulo de inclinación de la foto (en grados, como la Regla) a partir de sus líneas casi horizontales o casi
 * verticales (horizonte, edificios, marcos). Devuelve null si no encuentra líneas claras.
 */
export function detectTilt(src: HTMLCanvasElement): number | null {
  const k = Math.min(1, 900 / Math.max(src.width, src.height)), w = Math.max(3, Math.round(src.width * k)), hh = Math.max(3, Math.round(src.height * k));
  const c = makeCanvas(w, hh), x = ctx2d(c); x.drawImage(src, 0, 0, w, hh);
  const d = x.getImageData(0, 0, w, hh).data, L = new Float32Array(w * hh);
  for (let i = 0; i < w * hh; i++) L[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  // puntos de borde fuertes, separados según sean de líneas casi horizontales (H) o casi verticales (V)
  const R = 15, tanR = Math.tan(R * Math.PI / 180);
  const hx: number[] = [], hy: number[] = [], hm: number[] = [], vx: number[] = [], vy: number[] = [], vm: number[] = [];
  for (let y = 1; y < hh - 1; y++) for (let xx = 1; xx < w - 1; xx++) {
    const i = y * w + xx;
    const gx = (L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1]) - (L[i - w - 1] + 2 * L[i - 1] + L[i + w - 1]);
    const gy = (L[i + w - 1] + 2 * L[i + w] + L[i + w + 1]) - (L[i - w - 1] + 2 * L[i - w] + L[i - w + 1]);
    const mag = Math.hypot(gx, gy); if (mag < 80) continue;
    if (Math.abs(gx) <= Math.abs(gy) * tanR) { hx.push(xx); hy.push(y); hm.push(mag); }
    else if (Math.abs(gy) <= Math.abs(gx) * tanR) { vx.push(xx); vy.push(y); vm.push(mag); }
  }
  if (hx.length + vx.length < 50) return null;
  const n = w + hh * 2 + 10, hist = new Float64Array(n * 2);
  // con el ángulo bueno, los puntos de cada línea caen todos en la misma fila (o columna): el histograma tiene picos altos
  const score = (deg: number) => {
    const t = Math.tan(deg * Math.PI / 180); hist.fill(0);
    for (let i = 0; i < hx.length; i++) { const p = hy[i] + hx[i] * t + hh * 0 + w; const b = Math.round(p); if (b >= 0 && b < n) hist[b] += hm[i]; }
    for (let i = 0; i < vx.length; i++) { const p = vx[i] - vy[i] * t + hh; const b = Math.round(p); if (b >= 0 && b < n) hist[n + b] += vm[i]; }
    let s2 = 0; for (let i = 0; i < hist.length; i++) s2 += hist[i] * hist[i]; return s2;
  };
  let best = 0, bs = -1;
  for (let a = -R; a <= R; a += 0.25) { const s2 = score(a); if (s2 > bs) { bs = s2; best = a; } }
  const coarse = best;
  for (let a = coarse - 0.3; a <= coarse + 0.3; a += 0.02) { const s2 = score(a); if (s2 > bs) { bs = s2; best = a; } }
  // si casi no hay diferencia con no girar, no hay líneas claras
  // (con líneas rectas de verdad, girar al ángulo bueno las junta en una fila y la mejora es grande; con curvas, como
  // un círculo, siempre hay algún ángulo «un poco mejor» y se giraba sin motivo)
  // (medido: un horizonte o edificio torcido mejora entre 6 y 17 veces; un círculo, 1,13)
  if (bs < score(0) * 1.5 && Math.abs(best) > 0.2) return null;
  return best;
}
/** Endereza la imagen y recorta (o rellena) las esquinas que quedan vacías. */
export async function autoStraighten() {
  const d = app.doc; if (!d) return;
  const a = detectTilt(d.flatten());
  if (a === null) { app.toast('No encuentro líneas claras (horizonte, edificios…) para enderezar', 'warn'); return; }
  if (Math.abs(a) < 0.15) { app.toast('La imagen ya está recta'); return; }
  const ops = await import('./ops');
  const W = d.width, H = d.height, r = Math.abs(a) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  ops.rotateImageArbitrary(a, false);
  // el giro y el recorte quedan como un solo paso del historial
  const hs = d.history; if (hs.index > 0) { hs.steps.splice(hs.index, 1); hs.index--; }
  // el rectángulo más grande con la misma proporción que cabe dentro de la imagen girada
  const k = Math.min(W / (W * c + H * s), H / (W * s + H * c)), cw = Math.floor(W * k), ch = Math.floor(H * k);
  d.resizeCanvas(cw, ch, -Math.round((d.width - cw) / 2), -Math.round((d.height - ch) / 2));
  d.invalidate(); d.commit('Enderezar automáticamente'); app.viewport.fit(true);
  app.toast(`Enderezada ${Math.abs(a).toFixed(1)}° y recortada`);
}
