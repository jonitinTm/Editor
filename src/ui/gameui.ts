// Recursos de juego: punto de pivote y cajas de colisión por fotograma (se guardan en el proyecto y salen en el JSON de la
// hoja de sprites), y generador de interfaz del juego (botones con sus estados, barras de vida o energía y paneles).
import { presetBar } from './presets';
import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog } from './dialog';
import { ctx2d, makeCanvas, contentBounds } from '../core/canvas';
import { RasterLayer, GroupLayer } from '../core/layers';
import { EditorDocument } from '../core/document';
import { renderFrames } from './timeline';
import { t } from '../i18n/i18n';

export type Box = { kind: string; x: number; y: number; w: number; h: number };
export type SpriteInfo = { pivot?: { x: number; y: number }; boxes?: Box[] };
export const BOX_KINDS: { id: string; name: string; color: string }[] = [
  { id: 'body', name: 'Cuerpo (choca con el suelo y las paredes)', color: '#3aa0ff' },
  { id: 'hurt', name: 'Zona vulnerable (donde le hacen daño)', color: '#3ddc84' },
  { id: 'hit', name: 'Golpe (donde hace daño: espada, puño…)', color: '#ff4d4d' },
  { id: 'trigger', name: 'Zona de aviso (recoger, hablar…)', color: '#ffc83d' },
];
/** Datos del fotograma i (o del documento si no es una animación). */
export function infoOf(d: EditorDocument, i: number): SpriteInfo {
  if (d.frames.length) { const f = d.frames[i] ?? d.frames[0]; return f; }
  return (d.meta.sprite ??= {});
}
/** Pivote por defecto: abajo en el centro de lo dibujado (los pies). */
export function defaultPivot(c: HTMLCanvasElement) { const b = contentBounds(c, 8); return b ? { x: Math.round(b.x + b.w / 2), y: b.y + b.h } : { x: Math.round(c.width / 2), y: c.height }; }
/** Pivote y cajas para el JSON: en píxeles y también en proporción (0..1), como TexturePacker y Godot. */
export function spriteJson(d: EditorDocument, i: number) {
  const s = infoOf(d, i), out: Record<string, unknown> = {};
  if (s.pivot) { out.pivot = { x: +(s.pivot.x / d.width).toFixed(4), y: +(s.pivot.y / d.height).toFixed(4) }; out.pivotPx = { ...s.pivot }; }
  if (s.boxes?.length) out.boxes = s.boxes.map(b => ({ ...b }));
  return out;
}

// ---- editor de pivote y colisiones -----------------------------------------------------------------
export function pivotDialog() {
  const d = app.doc; if (!d) return;
  const frames = d.frames.length ? renderFrames(d) : [{ canvas: d.flatten(), delay: 100 }];
  let i = Math.max(0, Math.min(frames.length - 1, d.frameIndex)), mode = 'pivot', kind = 'hurt', drag: { x: number; y: number } | null = null, live: Box | null = null;
  const pix = !!d.meta.pixelArt, k = Math.max(1, Math.min(pix ? 12 : 4, Math.floor(380 / Math.max(d.width, d.height)))) || 1, ks = Math.min(1, 380 / Math.max(d.width, d.height));
  const Z = d.width * k > 380 || d.height * k > 380 ? ks : k;
  const cv = h('canvas', { class: 'gd-pv pv-edit', width: Math.round(d.width * Z), height: Math.round(d.height * Z) }) as HTMLCanvasElement;
  const list = h('div', { class: 'pv-list' }), info = h('div', { class: 'hint' });
  const draw = () => {
    const x = ctx2d(cv); x.imageSmoothingEnabled = !pix; x.clearRect(0, 0, cv.width, cv.height); x.drawImage(frames[i].canvas, 0, 0, cv.width, cv.height);
    const s = infoOf(d, i);
    for (const b of [...(s.boxes ?? []), ...(live ? [live] : [])]) { const c = BOX_KINDS.find(q => q.id === b.kind)?.color ?? '#fff'; x.fillStyle = c + '33'; x.strokeStyle = c; x.lineWidth = 2; x.fillRect(b.x * Z, b.y * Z, b.w * Z, b.h * Z); x.strokeRect(b.x * Z + 1, b.y * Z + 1, b.w * Z - 2, b.h * Z - 2); }
    const p = s.pivot; if (p) { x.strokeStyle = '#000'; x.lineWidth = 3; x.beginPath(); x.moveTo(p.x * Z - 8, p.y * Z); x.lineTo(p.x * Z + 8, p.y * Z); x.moveTo(p.x * Z, p.y * Z - 8); x.lineTo(p.x * Z, p.y * Z + 8); x.stroke(); x.strokeStyle = '#ff2fd0'; x.lineWidth = 1.5; x.stroke(); }
    info.textContent = `${t('Fotograma')} ${i + 1} / ${frames.length}` + (p ? ` · ${t('Pivote')} ${p.x}, ${p.y}` : '');
    list.replaceChildren(...(s.boxes ?? []).map((b, bi) => { const del = h('button', { type: 'button', class: 'btn', title: 'Quitar esta caja' }, '×'); del.onclick = () => { s.boxes!.splice(bi, 1); draw(); }; return h('div', { class: 'pv-item' }, h('span', { class: 'pv-dot', style: `background:${BOX_KINDS.find(q => q.id === b.kind)?.color}` }), h('span', {}, `${t(BOX_KINDS.find(q => q.id === b.kind)?.name.split(' (')[0] ?? b.kind)}: ${b.w} × ${b.h} (${b.x}, ${b.y})`), del); }));
  };
  const pt = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return { x: Math.max(0, Math.min(d.width, Math.round((e.clientX - r.left) / r.width * d.width))), y: Math.max(0, Math.min(d.height, Math.round((e.clientY - r.top) / r.height * d.height))) }; };
  cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); const p = pt(e); if (mode === 'pivot') { infoOf(d, i).pivot = p; draw(); } else { drag = p; live = { kind, x: p.x, y: p.y, w: 0, h: 0 }; } };
  cv.onpointermove = e => { const p = pt(e); if (mode === 'pivot' && e.buttons) { infoOf(d, i).pivot = p; draw(); } else if (drag && live) { live.x = Math.min(drag.x, p.x); live.y = Math.min(drag.y, p.y); live.w = Math.abs(p.x - drag.x); live.h = Math.abs(p.y - drag.y); draw(); } };
  cv.onpointerup = () => { if (live && live.w >= 1 && live.h >= 1) { const s = infoOf(d, i); (s.boxes ??= []).push(live); } live = null; drag = null; draw(); };
  const modeSel = h('select', {}, h('option', { value: 'pivot' }, 'Colocar el punto de pivote'), h('option', { value: 'box' }, 'Dibujar una caja de colisión')) as HTMLSelectElement;
  const kindSel = h('select', {}, ...BOX_KINDS.map(q => h('option', { value: q.id }, q.name))) as HTMLSelectElement; kindSel.value = kind;
  modeSel.onchange = () => { mode = modeSel.value; kindSel.disabled = mode !== 'box'; }; kindSel.onchange = () => { kind = kindSel.value; }; kindSel.disabled = true;
  const btn = (label: string, fn: () => void) => { const b = h('button', { type: 'button', class: 'btn' }, label); b.onclick = fn; return b; };
  const nav = h('div', { class: 'pv-nav' },
    btn('‹', () => { i = (i - 1 + frames.length) % frames.length; draw(); }), btn('›', () => { i = (i + 1) % frames.length; draw(); }),
    btn('Pivote en los pies', () => { infoOf(d, i).pivot = defaultPivot(frames[i].canvas); draw(); }),
    btn('Igual en todos los fotogramas', () => { const s = infoOf(d, i); for (let j = 0; j < frames.length; j++) if (j !== i) { const o = infoOf(d, j); o.pivot = s.pivot ? { ...s.pivot } : undefined; o.boxes = (s.boxes ?? []).map(b => ({ ...b })); } app.toast('Copiado a todos los fotogramas'); }),
    btn('Cuerpo automático', () => { const b = contentBounds(frames[i].canvas, 8); if (!b) return; const s = infoOf(d, i); s.boxes = (s.boxes ?? []).filter(x => x.kind !== 'body'); s.boxes.push({ kind: 'body', x: b.x, y: b.y, w: b.w, h: b.h }); draw(); }));
  // copia para poder deshacer todo con «Cancelar»
  const backup = JSON.stringify(d.frames.length ? d.frames.map(f => ({ pivot: f.pivot, boxes: f.boxes })) : d.meta.sprite ?? {});
  draw();
  showDialog({
    title: 'Pivote y colisiones', okLabel: 'Guardar', width: 560,
    body: [h('div', { class: 'hint' }, 'El pivote es el punto de apoyo del sprite (normalmente los pies): el motor lo usa para colocarlo y girarlo. Las cajas dicen dónde choca, dónde le pueden hacer daño y dónde golpea. Todo sale en el JSON de la hoja de sprites.'),
      h('div', { class: 'gd-pv-wrap' }, cv), info, nav,
      h('div', { class: 'form-row' }, h('label', {}, 'Al tocar la imagen'), modeSel), h('div', { class: 'form-row' }, h('label', {}, 'Tipo de caja'), kindSel), list],
    onOk: () => { d.commit('Pivote y colisiones'); },
    onCancel: () => { const b = JSON.parse(backup); if (d.frames.length) d.frames.forEach((f, j) => { f.pivot = b[j]?.pivot; f.boxes = b[j]?.boxes; }); else d.meta.sprite = b; },
  });
}

// ---- interfaz del juego ---------------------------------------------------------------------------
type UiOpts = { kind: string; w: number; h: number; color: string; color2: string; border: string; text: string; radius: number; pixel: boolean; value: number };
const shade = (hex: string, k: number) => { const n = parseInt(hex.slice(1, 7), 16), f = (v: number) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k)))); return '#' + [n >> 16 & 255, n >> 8 & 255, n & 255].map(f).map(v => v.toString(16).padStart(2, '0')).join(''); };
function rr(x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, r: number) { x.beginPath(); (x as any).roundRect(X, Y, W, H, Math.max(0, Math.min(r, W / 2, H / 2))); }
/** Texto: en pixel art sin bordes suaves (cada píxel lleno o vacío). */
function text(x: CanvasRenderingContext2D, s: string, cx: number, cy: number, color: string, pixel: boolean) {
  if (!pixel) { x.fillStyle = color; x.fillText(s, cx, cy); return; }
  const c = makeCanvas(x.canvas.width, x.canvas.height), tx = ctx2d(c); tx.font = x.font; tx.textAlign = x.textAlign; tx.textBaseline = x.textBaseline; tx.fillStyle = color; tx.fillText(s, Math.round(cx), Math.round(cy));
  const im = tx.getImageData(0, 0, c.width, c.height), D = im.data; for (let i = 3; i < D.length; i += 4) D[i] = D[i] < 110 ? 0 : 255; tx.putImageData(im, 0, 0); x.drawImage(c, 0, 0);
}
/** Dibuja una pieza de interfaz. En pixel art se dibuja pequeña, sin suavizado y con esquinas en escalón. */
export function drawUi(o: UiOpts, state: 'normal' | 'hover' | 'pressed' | 'disabled' = 'normal'): HTMLCanvasElement {
  const W = Math.max(4, Math.round(o.w)), H = Math.max(4, Math.round(o.h)), c = makeCanvas(W, H), x = ctx2d(c);
  const bw = o.pixel ? 1 : Math.max(2, Math.round(Math.min(W, H) / 16));
  let base = o.color; if (state === 'hover') base = shade(base, 0.15); if (state === 'pressed') base = shade(base, -0.2); if (state === 'disabled') base = '#7a7a7a';
  const body = (X: number, Y: number, w: number, hh: number, fill: string, r: number) => {
    if (o.pixel) {
      // esquinas en escalón de 1 píxel
      x.fillStyle = o.border; x.fillRect(X + 1, Y, w - 2, hh); x.fillRect(X, Y + 1, w, hh - 2);
      x.fillStyle = fill; x.fillRect(X + 1, Y + 1, w - 2, hh - 2);
      x.fillStyle = shade(fill, 0.3); x.fillRect(X + 1, Y + 1, w - 2, 1); x.fillStyle = shade(fill, -0.3); x.fillRect(X + 1, Y + hh - 2, w - 2, 1);
    } else {
      rr(x, X + bw / 2, Y + bw / 2, w - bw, hh - bw, r); const g = x.createLinearGradient(0, Y, 0, Y + hh); g.addColorStop(0, shade(fill, 0.18)); g.addColorStop(1, shade(fill, -0.18)); x.fillStyle = g; x.fill();
      x.lineWidth = bw; x.strokeStyle = o.border; x.stroke();
      // brillo
      x.save(); rr(x, X + bw * 1.5, Y + bw * 1.5, w - bw * 3, (hh - bw * 3) * 0.45, Math.max(0, r - bw)); x.fillStyle = 'rgba(255,255,255,.18)'; x.fill(); x.restore();
    }
  };
  if (o.kind === 'button') {
    const off = state === 'pressed' ? (o.pixel ? 1 : bw) : 0;
    if (state !== 'pressed') { x.globalAlpha = o.pixel ? 1 : 0.35; body(0, o.pixel ? 1 : bw, W, H - (o.pixel ? 1 : bw), o.pixel ? shade(o.border, -0.3) : '#000000', o.radius); x.globalAlpha = 1; }
    body(0, off, W, H - (o.pixel ? 1 : bw), base, o.radius);
    if (o.text) {
      const fs = Math.max(6, Math.round(H * (o.pixel ? 0.5 : 0.42))); x.font = `700 ${fs}px ${o.pixel ? 'monospace' : 'system-ui, sans-serif'}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      const ty = (H - (o.pixel ? 1 : bw)) / 2 + off;
      text(x, o.text, W / 2, ty + Math.max(1, fs / 12), o.pixel ? shade(base, -0.45) : 'rgba(0,0,0,.45)', o.pixel); text(x, o.text, W / 2, ty, state === 'disabled' ? '#d0d0d0' : '#ffffff', o.pixel);
    }
  } else if (o.kind === 'bar' || o.kind === 'barFill') {
    const v = Math.max(0, Math.min(1, o.value));
    if (o.kind === 'bar') body(0, 0, W, H, '#20232a', o.radius);
    const p = o.pixel ? 2 : bw * 1.5, fw = (W - 2 * p) * v;
    if (fw > 0) {
      if (o.pixel) { x.fillStyle = o.color; x.fillRect(p, p, Math.round(fw), H - 2 * p); x.fillStyle = shade(o.color, 0.35); x.fillRect(p, p, Math.round(fw), 1); x.fillStyle = shade(o.color, -0.3); x.fillRect(p, H - p - 1, Math.round(fw), 1); }
      else { rr(x, p, p, fw, H - 2 * p, Math.max(0, o.radius - p)); const g = x.createLinearGradient(p, 0, W - p, 0); g.addColorStop(0, o.color2); g.addColorStop(1, o.color); x.fillStyle = g; x.fill(); x.save(); rr(x, p, p, fw, (H - 2 * p) * 0.45, Math.max(0, o.radius - p)); x.fillStyle = 'rgba(255,255,255,.25)'; x.fill(); x.restore(); }
    }
    if (o.text && o.kind === 'bar') { const fs = Math.max(6, Math.round(H * 0.55)); x.font = `700 ${fs}px ${o.pixel ? 'monospace' : 'system-ui, sans-serif'}`; x.textAlign = 'center'; x.textBaseline = 'middle'; text(x, o.text, W / 2 + 1, H / 2 + 1, o.pixel ? '#000000' : 'rgba(0,0,0,.5)', o.pixel); text(x, o.text, W / 2, H / 2, '#ffffff', o.pixel); }
  } else if (o.kind === 'panel') {
    body(0, 0, W, H, o.color, o.radius);
    if (o.text) { const fs = Math.max(7, Math.round(Math.min(H * 0.12, W * 0.08))), th = fs * 1.8; x.fillStyle = shade(o.color, -0.25); if (o.pixel) x.fillRect(2, 2, W - 4, th); else { rr(x, bw, bw, W - 2 * bw, th, Math.max(0, o.radius - bw)); x.fill(); } x.font = `700 ${fs}px ${o.pixel ? 'monospace' : 'system-ui, sans-serif'}`; x.textAlign = 'center'; x.textBaseline = 'middle'; text(x, o.text, W / 2, (o.pixel ? 2 : bw) + th / 2, '#ffffff', o.pixel); }
  } else if (o.kind === 'heart') {
    // corazones de vida: lleno, medio y vacío uno al lado de otro
    const s = H, n = 3; c.width = s * n + (n - 1) * Math.max(1, Math.round(s / 8)); const gap = Math.max(1, Math.round(s / 8)); const x2 = ctx2d(c); x2.imageSmoothingEnabled = !o.pixel;
    const heart = (X: number, fill: number) => {
      const m = makeCanvas(s, s), mx = ctx2d(m), path = () => { mx.beginPath(); mx.moveTo(s / 2, s * 0.9); mx.bezierCurveTo(s * -0.1, s * 0.5, s * 0.1, s * 0.05, s / 2, s * 0.3); mx.bezierCurveTo(s * 0.9, s * 0.05, s * 1.1, s * 0.5, s / 2, s * 0.9); mx.closePath(); };
      path(); mx.fillStyle = o.border; mx.fill(); mx.save(); mx.translate(s * 0.1, s * 0.1); mx.scale(0.8, 0.8); path(); mx.fillStyle = '#3a2a2e'; mx.fill(); mx.beginPath(); mx.rect(0, 0, s * fill, s); mx.clip(); path(); mx.fillStyle = o.color; mx.fill(); mx.restore();
      if (o.pixel) { const im = mx.getImageData(0, 0, s, s), D = im.data; for (let q = 3; q < D.length; q += 4) D[q] = D[q] < 128 ? 0 : 255; mx.putImageData(im, 0, 0); }
      x2.drawImage(m, X, 0);
    };
    heart(0, 1); heart(s + gap, 0.5); heart(2 * (s + gap), 0);
  }
  return c;
}
export function gameUiDialog() {
  let saved: Partial<UiOpts> = {}; try { saved = JSON.parse(localStorage.getItem('editor.gameUi') || '{}'); } catch { /* */ }
  const d = app.doc, pixDoc = !!d?.meta.pixelArt;
  const o: UiOpts = { kind: 'button', w: pixDoc ? 48 : 240, h: pixDoc ? 16 : 72, color: '#3d8bfd', color2: '#2bd47d', border: '#16233d', text: 'JUGAR', radius: 18, pixel: pixDoc, value: 0.7, ...saved };
  const KIND: [string, string][] = [['button', 'Botón (normal, encima, pulsado y desactivado)'], ['bar', 'Barra de vida o energía (marco y relleno por separado)'], ['panel', 'Panel o ventana con título'], ['heart', 'Corazones de vida (lleno, medio, vacío)']];
  const PRESETS: Record<string, Partial<UiOpts>> = { button: { w: 240, h: 72, text: 'JUGAR', color: '#3d8bfd' }, bar: { w: 260, h: 28, text: '', color: '#e63946', color2: '#ff8a5b' }, panel: { w: 360, h: 260, text: 'INVENTARIO', color: '#5b4a3a' }, heart: { h: 48, color: '#e63946' } };
  const pv = h('canvas', { class: 'gd-pv ui-pv' }) as HTMLCanvasElement;
  const draw = () => {
    const parts = o.kind === 'button' ? (['normal', 'hover', 'pressed', 'disabled'] as const).map(s => drawUi(o, s)) : [drawUi(o)];
    const k = o.pixel ? Math.max(1, Math.floor(Math.min(6, 440 / ((parts[0].width + 8) * Math.min(2, parts.length) + 8), 260 / ((parts[0].height + 8) * Math.ceil(parts.length / 2) + 8)))) : Math.min(1, 440 / (parts[0].width * (o.kind === 'button' ? 2 : 1) + 16));
    const cols = o.kind === 'button' ? 2 : parts.length, rows = Math.ceil(parts.length / cols), cw = parts[0].width * k, ch = parts[0].height * k;
    pv.width = Math.ceil(cols * cw + (cols + 1) * 8); pv.height = Math.ceil(rows * ch + (rows + 1) * 8);
    const x = ctx2d(pv); x.imageSmoothingEnabled = !o.pixel; x.clearRect(0, 0, pv.width, pv.height);
    parts.forEach((p, j) => x.drawImage(p, 8 + (j % cols) * (cw + 8), 8 + Math.floor(j / cols) * (ch + 8), cw, ch));
  };
  const body = h('div', {});
  const build = () => {
    const kind = h('select', {}, ...KIND.map(([v, n]) => h('option', { value: v }, n))) as HTMLSelectElement; kind.value = o.kind;
    kind.onchange = () => { o.kind = kind.value; Object.assign(o, PRESETS[o.kind]); if (o.pixel) { o.w = Math.max(8, Math.round(o.w / 5)); o.h = Math.max(6, Math.round(o.h / 4.5)); } build(); };
    const col = (k: 'color' | 'color2' | 'border') => { const i = h('input', { type: 'color', value: o[k], class: 'color-input' }) as HTMLInputElement; i.oninput = () => { o[k] = i.value; draw(); }; return i; };
    const txt = h('input', { type: 'text', class: 'input', value: o.text }) as HTMLInputElement; txt.oninput = () => { o.text = txt.value; draw(); };
    const px = h('input', { type: 'checkbox', checked: o.pixel }) as HTMLInputElement; px.onchange = () => { o.pixel = px.checked; if (o.pixel) { o.w = Math.max(8, Math.round(o.w / 5)); o.h = Math.max(6, Math.round(o.h / 4.5)); } else { o.w *= 5; o.h = Math.round(o.h * 4.5); } build(); };
    const row = (l: string, ...e: HTMLElement[]) => h('div', { class: 'form-row' }, h('label', {}, l), ...e);
    const max = o.pixel ? 256 : 1600;
    body.replaceChildren(
      row('Pieza', kind), h('div', { class: 'gd-pv-wrap' }, pv),
      h('label', { class: 'check' }, px, ' Pixel art'),
      ...(o.kind !== 'heart' ? [row('Ancho', numberSlider({ min: 4, max, value: o.w, unit: ' px', onInput: v => { o.w = v; draw(); } }).el)] : []),
      row('Alto', numberSlider({ min: 4, max: o.pixel ? 128 : 900, value: o.h, unit: ' px', onInput: v => { o.h = v; draw(); } }).el),
      row('Color', col('color')), ...(o.kind === 'bar' ? [row('Color del principio', col('color2'))] : []), row('Borde', col('border')),
      ...(o.kind !== 'heart' ? [row('Texto', txt)] : []),
      ...(!o.pixel && o.kind !== 'heart' ? [row('Esquinas', numberSlider({ min: 0, max: 60, value: o.radius, unit: ' px', onInput: v => { o.radius = v; draw(); } }).el)] : []),
      ...(o.kind === 'bar' ? [row('Relleno de muestra', numberSlider({ min: 0, max: 100, value: Math.round(o.value * 100), unit: '%', onInput: v => { o.value = v / 100; draw(); } }).el)] : []),
      h('div', { class: 'hint' }, o.kind === 'bar' ? 'La barra sale en dos capas: el marco y el relleno lleno. En el juego se estira el relleno según la vida que quede.' : o.kind === 'button' ? 'Salen los 4 estados del botón, cada uno en su capa, listos para el motor.' : ''));
    draw();
  };
  build();
  let dlg: { close: () => void } | null = null;
  dlg = showDialog({
    title: 'Interfaz del juego', okLabel: 'Crear', width: 520, body: [body, presetBar({ key: 'gameUi', lastKey: 'editor.gameUi', current: () => o, close: () => dlg?.close(), reopen: gameUiDialog })],
    onOk: () => {
      try { localStorage.setItem('editor.gameUi', JSON.stringify(o)); } catch { /* */ }
      const parts: [string, HTMLCanvasElement][] = o.kind === 'button' ? (['normal', 'hover', 'pressed', 'disabled'] as const).map(s => [`${t('Botón')} – ${t({ normal: 'Normal', hover: 'Encima', pressed: 'Pulsado', disabled: 'Desactivado' }[s])}`, drawUi(o, s)])
        : o.kind === 'bar' ? [[t('Barra – marco'), drawUi({ ...o, value: 0 })], [t('Barra – relleno'), drawUi({ ...o, kind: 'barFill', value: 1 })]]
        : [[o.kind === 'panel' ? t('Panel') : t('Corazones'), drawUi(o)]];
      const W = parts[0][1].width, H = parts[0][1].height, gap = o.pixel ? 2 : 16;
      const doc = new EditorDocument(o.kind === 'button' ? t('Botón') : o.kind === 'bar' ? t('Barra de vida') : o.kind === 'panel' ? t('Panel') : t('Corazones'), o.kind === 'button' ? W * 4 + gap * 3 : W, H);
      const g = new GroupLayer(doc.name); doc.root.add(g);
      parts.forEach(([n, c], j) => { const l = new RasterLayer(n, doc.width, doc.height); ctx2d(l.canvas).drawImage(c, o.kind === 'button' ? j * (W + gap) : 0, 0); g.add(l); });
      if (o.pixel) doc.meta.pixelArt = true;
      app.addDocument(doc, 'Interfaz del juego'); requestAnimationFrame(() => app.viewport.fit());
    },
  });
}
