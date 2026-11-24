// Para dibujantes: rueda de color (anillo de tono + cuadro de saturación/brillo), colores recientes
// y una ventana flotante con una imagen de referencia (se mueve, se amplía y se puede coger color de ella).

import { app } from './app';
import { h } from './dom';
import { icon } from './icons';
import { hexToRgb, rgbToHex } from '../core/canvas';
import { rgb2hsv, hsv2rgb } from './colorpicker';

// ---- Colores recientes ------------------------------------------------------------------------
const RECENT_KEY = 'editor.recentColors';
export function recentColors(): string[] { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter(x => /^#[0-9a-f]{6}$/i.test(x)) : []; } catch { return []; } }
/** Apunta un color usado al pintar (los 16 últimos, sin repetir). */
export function addRecentColor(c: string) {
  if (!/^#[0-9a-f]{6}$/i.test(c)) return;
  const l = [c.toLowerCase(), ...recentColors().filter(x => x.toLowerCase() !== c.toLowerCase())].slice(0, 16);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(l)); } catch { /* */ }
  window.dispatchEvent(new Event('editor-recent-colors'));
}
/** Fila de colores recientes (toque: color frontal; Alt+clic: de fondo). */
export function recentRow(onPick?: () => void) {
  const row = h('div', { class: 'recent-colors', title: 'Colores recientes' });
  const render = () => {
    row.innerHTML = '';
    const l = recentColors();
    if (!l.length) { row.append(h('span', { class: 'hint' }, 'Los colores con los que pintes aparecerán aquí.')); return; }
    for (const c of l) {
      const b = h('button', { class: 'rc', type: 'button', style: { background: c }, title: c, 'aria-label': c });
      b.onclick = e => { e.altKey ? app.setColors(app.fg, c) : app.setColors(c, app.bg); onPick?.(); };
      row.append(b);
    }
  };
  render(); window.addEventListener('editor-recent-colors', render);
  return row;
}

// ---- Rueda de color ---------------------------------------------------------------------------
/** Anillo de tono con un cuadro de saturación (horizontal) y brillo (vertical) dentro, como en las apps de dibujo. */
export function colorWheel(size = 200, onChange?: (hex: string) => void) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const cv = h('canvas', { class: 'color-wheel', width: size * dpr, height: size * dpr, style: { width: size + 'px', height: size + 'px' } }) as HTMLCanvasElement;
  const x = cv.getContext('2d')!;
  let [hue, sat, val] = rgb2hsv(...hexToRgb(app.fg));
  const R = size / 2, ring = Math.max(14, size * 0.11), inner = R - ring - 6, sq = inner * Math.SQRT2 * 0.98;
  let ringImg: HTMLCanvasElement | null = null;
  const drawRing = () => {
    const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
    const g = c.getContext('2d')!; g.scale(dpr, dpr);
    for (let a = 0; a < 360; a += 1) {
      g.beginPath(); g.strokeStyle = `hsl(${a},100%,50%)`; g.lineWidth = ring;
      g.arc(R, R, R - ring / 2 - 1, (a - 90.6) * Math.PI / 180, (a - 89) * Math.PI / 180); g.stroke();
    }
    ringImg = c;
  };
  const paint = () => {
    if (!ringImg) drawRing();
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height); x.drawImage(ringImg!, 0, 0); x.scale(dpr, dpr);
    const x0 = R - sq / 2, y0 = R - sq / 2;
    x.fillStyle = `hsl(${hue},100%,50%)`; x.fillRect(x0, y0, sq, sq);
    let g = x.createLinearGradient(x0, 0, x0 + sq, 0); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(x0, y0, sq, sq);
    g = x.createLinearGradient(0, y0, 0, y0 + sq); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000'); x.fillStyle = g; x.fillRect(x0, y0, sq, sq);
    // marcadores
    const ha = (hue - 90) * Math.PI / 180, hr = R - ring / 2 - 1;
    const mark = (mx: number, my: number, r: number) => { x.lineWidth = 2; x.strokeStyle = '#000'; x.beginPath(); x.arc(mx, my, r + 1, 0, 7); x.stroke(); x.strokeStyle = '#fff'; x.beginPath(); x.arc(mx, my, r, 0, 7); x.stroke(); };
    mark(R + Math.cos(ha) * hr, R + Math.sin(ha) * hr, ring / 2 - 2);
    mark(x0 + sat * sq, y0 + (1 - val) * sq, 6);
  };
  const emit = () => { const hex = rgbToHex(...hsv2rgb(hue, sat, val).map(Math.round) as [number, number, number]); app.setColors(hex, app.bg); onChange?.(hex); };
  let mode: 'ring' | 'sq' | null = null;
  const at = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect(), px = (e.clientX - r.left) * size / r.width, py = (e.clientY - r.top) * size / r.height;
    if (!mode) mode = Math.hypot(px - R, py - R) > inner + 3 ? 'ring' : 'sq';
    if (mode === 'ring') hue = (Math.atan2(py - R, px - R) * 180 / Math.PI + 90 + 360) % 360;
    else {
      // cerca de los bordes se ajusta a 0 o 1 exactos (para poder elegir blanco, negro o el color puro)
      const snap = (v: number) => v < 0.02 ? 0 : v > 0.98 ? 1 : v;
      sat = snap(Math.max(0, Math.min(1, (px - (R - sq / 2)) / sq))); val = snap(Math.max(0, Math.min(1, 1 - (py - (R - sq / 2)) / sq)));
    }
    paint(); emit();
  };
  cv.addEventListener('pointerdown', e => { e.preventDefault(); cv.setPointerCapture(e.pointerId); mode = null; at(e); });
  cv.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch') { if (cv.hasPointerCapture(e.pointerId)) at(e); } });
  cv.addEventListener('pointerup', () => { mode = null; });
  // si el color cambia desde fuera (cuentagotas, muestras…), la rueda lo sigue (sin perder el tono de los grises)
  const sync = () => { const [hh, s, v] = rgb2hsv(...hexToRgb(app.fg)); if (s > 0.01 && v > 0.01) hue = hh; sat = s; val = v; paint(); };
  app.on('colors', () => { if (!mode) sync(); });
  paint();
  return cv;
}

/** Ventanita flotante con la rueda y los colores recientes (para el modo dibujo y las tablets). */
export function colorPopover(anchor: HTMLElement) {
  document.querySelector('.color-pop')?.remove();
  const pop = h('div', { class: 'flyout color-pop' }, colorWheel(220), recentRow());
  document.body.append(pop);
  const r = anchor.getBoundingClientRect(), w = pop.offsetWidth;
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  pop.style.top = Math.min(innerHeight - pop.offsetHeight - 8, r.bottom + 8) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', function close(ev) { if (!pop.contains(ev.target as Node) && ev.target !== anchor) { pop.remove(); document.removeEventListener('pointerdown', close); } }), 0);
}

/** Selector de color rápido junto al puntero (Alt + Mayús + clic derecho, como el de Photoshop). */
export function colorHud(x: number, y: number) {
  document.querySelector('.color-pop')?.remove();
  const pop = h('div', { class: 'flyout color-pop color-hud' }, colorWheel(200), recentRow());
  document.body.append(pop);
  const w = pop.offsetWidth, hh = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)) + 'px';
  pop.style.top = Math.max(8, Math.min(innerHeight - hh - 8, y - hh / 2)) + 'px';
  const close = () => { pop.remove(); document.removeEventListener('pointerdown', out, true); document.removeEventListener('keydown', esc, true); };
  const out = (ev: Event) => { if (!pop.contains(ev.target as Node)) close(); };
  const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape' || ev.key === 'Enter') { ev.preventDefault(); close(); } };
  setTimeout(() => { document.addEventListener('pointerdown', out, true); document.addEventListener('keydown', esc, true); }, 0);
}

// ---- Imagen de referencia ---------------------------------------------------------------------
let refWin: HTMLElement | null = null;
/** Abre (o cierra) la ventana de referencia. Sin imagen, ofrece abrir una o usar la imagen actual. */
export function toggleReference() {
  if (refWin) { refWin.remove(); refWin = null; return; }
  const img = h('canvas', { class: 'ref-img' }) as HTMLCanvasElement;
  const stage = h('div', { class: 'ref-stage' }, h('div', { class: 'ref-empty hint' }, 'Abre una imagen para tenerla a la vista mientras dibujas. Toca la imagen para coger un color.'));
  let src: HTMLCanvasElement | null = null, zoom = 1, ox = 0, oy = 0, flip = false, gray = false;
  const draw = () => {
    if (!src) return;
    const W = stage.clientWidth, H = stage.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
    img.width = W * dpr; img.height = H * dpr; img.style.width = W + 'px'; img.style.height = H + 'px';
    const x = img.getContext('2d')!, k = Math.min(W / src.width, H / src.height) * zoom;
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H); x.imageSmoothingQuality = 'high';
    x.save(); x.translate(W / 2 + ox, H / 2 + oy); if (flip) x.scale(-1, 1); x.filter = gray ? 'grayscale(1)' : 'none';
    x.drawImage(src, -src.width * k / 2, -src.height * k / 2, src.width * k, src.height * k); x.restore();
  };
  const setSrc = (c: HTMLCanvasElement) => { src = c; zoom = 1; ox = oy = 0; stage.innerHTML = ''; stage.append(img); draw(); };
  const open = h('button', { class: 'btn', type: 'button', title: 'Abrir una imagen de referencia' }, 'Abrir…');
  open.onclick = async () => {
    const io = await import('../io/files'); const f = (await io.pickFiles('image/*'))[0]; if (!f) return;
    const bmp = await createImageBitmap(f); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d')!.drawImage(bmp, 0, 0); setSrc(c);
  };
  const cur = h('button', { class: 'btn', type: 'button', title: 'Usar una copia de la imagen actual' }, 'Imagen actual');
  cur.onclick = () => { const d = app.doc; if (!d) { app.toast('Abre primero una imagen', 'warn'); return; } const c = document.createElement('canvas'); c.width = d.width; c.height = d.height; c.getContext('2d')!.drawImage(d.getComposite(), 0, 0); setSrc(c); };
  const fl = h('button', { class: 'btn icon-btn', type: 'button', title: 'Voltear horizontal', html: icon('flipH') }); fl.onclick = () => { flip = !flip; draw(); };
  const gr = h('button', { class: 'btn icon-btn', type: 'button', title: 'Ver en gris (para comparar valores)' }, 'Gris'); gr.onclick = () => { gray = !gray; gr.classList.toggle('on', gray); draw(); };
  const close = h('button', { class: 'btn icon-btn', type: 'button', title: 'Cerrar', html: icon('close') }); close.onclick = () => toggleReference();
  const head = h('div', { class: 'ref-head' }, h('span', { class: 'ref-title' }, 'Referencia'), open, cur, fl, gr, close);
  const grip = h('div', { class: 'ref-grip', title: 'Arrastra para cambiar el tamaño' });
  refWin = h('div', { class: 'ref-win' }, head, stage, grip);
  document.body.append(refWin);
  // mover la ventana por la cabecera y cambiar su tamaño por la esquina
  const drag = (el: HTMLElement, fn: (dx: number, dy: number, s: { l: number; t: number; w: number; h: number }) => void) => el.addEventListener('pointerdown', e => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault(); el.setPointerCapture(e.pointerId);
    const r = refWin!.getBoundingClientRect(), s = { l: r.left, t: r.top, w: r.width, h: r.height }, x0 = e.clientX, y0 = e.clientY;
    const mv = (ev: PointerEvent) => fn(ev.clientX - x0, ev.clientY - y0, s);
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); draw(); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  });
  drag(head, (dx, dy, s) => { refWin!.style.left = Math.max(0, Math.min(innerWidth - 60, s.l + dx)) + 'px'; refWin!.style.top = Math.max(0, Math.min(innerHeight - 40, s.t + dy)) + 'px'; });
  drag(grip, (dx, dy, s) => { refWin!.style.width = Math.max(180, s.w + dx) + 'px'; refWin!.style.height = Math.max(160, s.h + dy) + 'px'; draw(); });
  // en la imagen: toque = coger color; arrastrar = mover; rueda o pellizco = ampliar
  const pts = new Map<number, { x: number; y: number }>(); let pinch0 = 0, zoom0 = 1, moved = false, last: { x: number; y: number } | null = null;
  stage.addEventListener('pointerdown', e => { if (!src) return; stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false; last = { x: e.clientX, y: e.clientY }; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); zoom0 = zoom; } });
  stage.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { const [a, b] = [...pts.values()]; zoom = Math.max(0.2, Math.min(20, zoom0 * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch0))); moved = true; draw(); return; }
    if (last && Math.hypot(e.clientX - last.x, e.clientY - last.y) > 0) { if (moved || Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y) > 4) { ox += e.clientX - last.x; oy += e.clientY - last.y; moved = true; last = { x: e.clientX, y: e.clientY }; draw(); } }
  });
  stage.addEventListener('pointerup', e => {
    pts.delete(e.pointerId);
    if (!moved && src && !pts.size) {
      const r = img.getBoundingClientRect(), dpr = img.width / r.width, px = Math.floor((e.clientX - r.left) * dpr), py = Math.floor((e.clientY - r.top) * dpr);
      const d = img.getContext('2d')!.getImageData(px, py, 1, 1).data;
      if (d[3]) { const c = rgbToHex(d[0], d[1], d[2]); app.setColors(c, app.bg); app.toast(c); }
    }
  });
  stage.addEventListener('wheel', e => { if (!src) return; e.preventDefault(); zoom = Math.max(0.2, Math.min(20, zoom * Math.exp(-e.deltaY * 0.002))); draw(); }, { passive: false });
  new ResizeObserver(draw).observe(stage);
}
