// Cámara 2D: un encuadre inicial y uno final sobre la imagen o la animación, y la cámara se mueve (y acerca o aleja) de uno
// a otro con suavizado. También puede temblar (golpes, explosiones). El resultado es una animación nueva del tamaño de
// salida, lista para exportar a vídeo o GIF. Sirve para escenas animadas y para el efecto Ken Burns en fotos.
import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog } from './dialog';
import { ctx2d, makeCanvas } from '../core/canvas';
import { RasterLayer } from '../core/layers';
import { EditorDocument } from '../core/document';
import { renderFrames } from './timeline';
import { EASE } from './anim';
import { t } from '../i18n/i18n';

export type Shot = { cx: number; cy: number; zoom: number }; // centro (0..1) y zoom (1 = cabe entera la imagen)
export type CamParams = { W: number; H: number; a: Shot; b: Shot; ease: string; frames: number; fps: number; shake: number; loops: number };

/** Rectángulo de la imagen (en píxeles) que ve la cámara para un encuadre. */
export function viewRect(sw: number, sh: number, W: number, H: number, s: Shot) {
  const base = Math.min(sw / W, sh / H), k = base / Math.max(0.05, s.zoom), w = W * k, hh = H * k;
  // la cámara no se sale de la imagen (si cabe), para que no aparezcan bandas negras
  let x = s.cx * sw - w / 2, y = s.cy * sh - hh / 2;
  x = w <= sw ? Math.max(0, Math.min(sw - w, x)) : (sw - w) / 2; y = hh <= sh ? Math.max(0, Math.min(sh - hh, y)) : (sh - hh) / 2;
  return { x, y, w, h: hh };
}
/** Encuadre intermedio (t de 0 a 1, ya con suavizado). El zoom se interpola de forma geométrica (avance uniforme). */
export const lerpShot = (a: Shot, b: Shot, t: number): Shot => ({ cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t, zoom: a.zoom * Math.pow(b.zoom / a.zoom, t) });

export function renderCamera(src: { canvas: HTMLCanvasElement; delay: number }[], p: CamParams, pixel: boolean) {
  const ease = EASE[p.ease] ?? EASE.smooth, out: { canvas: HTMLCanvasElement; delay: number }[] = [];
  const n = Math.max(1, p.frames);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1), s = lerpShot(p.a, p.b, ease(t)), f = src[i % src.length];
    const r = viewRect(f.canvas.width, f.canvas.height, p.W, p.H, s);
    if (p.shake) { const amp = p.shake / 100 * r.w * 0.04 * (1 - t * 0.6); r.x += rnd() * 2 * amp; r.y += rnd() * 2 * amp; }
    const c = makeCanvas(p.W, p.H), x = ctx2d(c); x.imageSmoothingEnabled = !pixel; x.imageSmoothingQuality = 'high';
    x.fillStyle = '#000'; x.fillRect(0, 0, p.W, p.H);
    x.drawImage(f.canvas, r.x, r.y, r.w, r.h, 0, 0, p.W, p.H);
    out.push({ canvas: c, delay: src.length > 1 ? f.delay : Math.round(1000 / p.fps) });
  }
  return out;
}

export function cameraDialog() {
  const d = app.doc; if (!d) return;
  const anim = d.frames.length > 1, src = anim ? renderFrames(d) : [{ canvas: d.flatten(), delay: 100 }], pix = !!d.meta.pixelArt;
  const SIZES: [string, string][] = [['1920x1080', 'Vídeo 1920 × 1080'], ['1280x720', 'Vídeo 1280 × 720'], ['1080x1920', 'Vertical 1080 × 1920'], ['1080x1080', 'Cuadrado 1080 × 1080'], ['doc', `${t('Como la imagen')} (${d.width} × ${d.height})`]];
  if (pix) SIZES.unshift(['320x180', 'Pixel art 320 × 180'], ['256x224', 'Pixel art 256 × 224']);
  const p: CamParams = { W: 1280, H: 720, a: { cx: 0.5, cy: 0.5, zoom: 1 }, b: { cx: 0.5, cy: 0.5, zoom: 1.6 }, ease: 'smooth', frames: anim ? src.length : 48, fps: 24, shake: 0, loops: 1 };
  if (pix) { p.W = 320; p.H = 180; }
  const PV = 420, k = Math.min(PV / src[0].canvas.width, 300 / src[0].canvas.height), pw = Math.round(src[0].canvas.width * k), ph = Math.round(src[0].canvas.height * k);
  const pv = h('canvas', { class: 'gd-pv cam-pv', width: pw, height: ph }) as HTMLCanvasElement;
  const out = h('canvas', { class: 'gd-pv cam-out' }) as HTMLCanvasElement;
  let which: 'a' | 'b' = 'a', drag: { x: number; y: number; s: Shot } | null = null, tPrev = 0, timer = 0;
  const draw = () => {
    const x = ctx2d(pv); x.imageSmoothingEnabled = !pix; x.clearRect(0, 0, pw, ph); x.drawImage(src[0].canvas, 0, 0, pw, ph);
    for (const [key, col] of [['a', '#3ddc84'], ['b', '#ffb020']] as const) {
      const r = viewRect(src[0].canvas.width, src[0].canvas.height, p.W, p.H, p[key]);
      x.lineWidth = key === which ? 3 : 1.5; x.strokeStyle = col; x.strokeRect(r.x * k, r.y * k, r.w * k, r.h * k);
      x.fillStyle = col; x.font = '600 12px system-ui, sans-serif'; x.fillText(key === 'a' ? t('Inicio') : t('Final'), r.x * k + 4, r.y * k + 14);
    }
  };
  // vista previa del resultado en movimiento
  const anim1 = () => {
    clearTimeout(timer); if (!out.isConnected && tPrev > 0) return;
    const sc = Math.min(1, 240 / p.W, 140 / p.H), W = Math.max(1, Math.round(p.W * sc)), H = Math.max(1, Math.round(p.H * sc));
    if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
    const n = Math.max(2, p.frames), i = Math.floor(tPrev) % n, fr = renderCamera([src[i % src.length]], { ...p, W, H, frames: 1, a: lerpShot(p.a, p.b, (EASE[p.ease] ?? EASE.smooth)(i / (n - 1))), shake: 0 }, pix)[0];
    ctx2d(out).drawImage(fr.canvas, 0, 0); tPrev++;
    timer = window.setTimeout(anim1, anim ? src[i % src.length].delay : 1000 / p.fps);
  };
  const pt = (e: PointerEvent) => { const r = pv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  pv.onpointerdown = e => {
    pv.setPointerCapture(e.pointerId); const q = pt(e);
    // se coge el encuadre que esté más cerca del dedo
    const dist = (s: Shot) => Math.hypot(s.cx - q.x, s.cy - q.y), other = which === 'a' ? 'b' : 'a'; if (dist(p[other]) + 0.05 < dist(p[which])) which = other; whichSel.value = which;
    drag = { x: q.x, y: q.y, s: { ...p[which] } }; draw();
  };
  pv.onpointermove = e => { if (!drag) return; const q = pt(e), s = p[which]; s.cx = Math.max(0, Math.min(1, drag.s.cx + q.x - drag.x)); s.cy = Math.max(0, Math.min(1, drag.s.cy + q.y - drag.y)); draw(); };
  pv.onpointerup = () => { drag = null; };
  const zA = numberSlider({ min: 50, max: 800, value: p.a.zoom * 100, unit: '%', onInput: v => { p.a.zoom = v / 100; draw(); } }), zB = numberSlider({ min: 50, max: 800, value: p.b.zoom * 100, unit: '%', onInput: v => { p.b.zoom = v / 100; draw(); } });
  const whichSel = h('select', {}, h('option', { value: 'a' }, 'Encuadre de inicio'), h('option', { value: 'b' }, 'Encuadre final')) as HTMLSelectElement; whichSel.onchange = () => { which = whichSel.value as 'a' | 'b'; draw(); };
  const size = h('select', {}, ...SIZES.map(([v, n]) => h('option', { value: v }, n))) as HTMLSelectElement; size.value = pix ? '320x180' : '1280x720';
  size.onchange = () => { const [W, H] = size.value === 'doc' ? [d.width, d.height] : size.value.split('x').map(Number); p.W = W; p.H = H; draw(); };
  const ease = h('select', {}, ...[['smooth', 'Suave (acelera y frena)'], ['linear', 'Constante'], ['in', 'Acelerando'], ['out', 'Frenando']].map(([v, n]) => h('option', { value: v }, n))) as HTMLSelectElement; ease.onchange = () => { p.ease = ease.value; };
  const row = (l: string, ...e: HTMLElement[]) => h('div', { class: 'form-row' }, h('label', {}, l), ...e);
  draw(); anim1();
  showDialog({
    title: 'Cámara 2D', okLabel: 'Crear animación', width: 560,
    body: [h('div', { class: 'hint' }, anim ? 'La cámara recorre tu animación: arrastra los recuadros para colocar el encuadre de inicio (verde) y el final (naranja), y elige cuánto se acerca.' : 'Mueve la cámara sobre la imagen (efecto Ken Burns): arrastra los recuadros de inicio (verde) y final (naranja) y elige cuánto se acerca.'),
      h('div', { class: 'cam-wrap' }, h('div', { class: 'gd-pv-wrap' }, pv), h('div', { class: 'cam-side' }, h('div', { class: 'hint' }, 'Resultado'), out)),
      row('Tamaño de salida', size), row('Mover', whichSel),
      row('Zoom de inicio', zA.el), row('Zoom final', zB.el), row('Movimiento', ease),
      row(anim ? 'Fotogramas' : 'Fotogramas', numberSlider({ min: 2, max: anim ? src.length * 8 : 240, value: p.frames, onInput: v => { p.frames = v; } }).el),
      ...(anim ? [] : [row('Velocidad', numberSlider({ min: 6, max: 60, value: p.fps, unit: ' fps', onInput: v => { p.fps = v; } }).el)]),
      row('Temblor', numberSlider({ min: 0, max: 100, value: 0, unit: '%', onInput: v => { p.shake = v; } }).el)],
    onCancel: () => clearTimeout(timer),
    onOk: () => {
      // cada fotograma es una imagen entera: se limita para no agotar la memoria (sobre todo en el móvil)
      if (p.W * p.H * p.frames > 80e6) { app.toast(`${t('Demasiado grande')}: ${p.frames} × ${p.W} × ${p.H}. ${t('Usa menos fotogramas o un tamaño menor')}`, 'warn'); return false; }
      clearTimeout(timer);
      const fr = renderCamera(src, p, pix), nd = new EditorDocument(`${d.name} ${t('cámara')}`, p.W, p.H);
      fr.forEach((f, i) => { const l = new RasterLayer(`Fotograma ${i + 1}`, p.W, p.H); ctx2d(l.canvas).drawImage(f.canvas, 0, 0); l.visible = i === 0; nd.root.add(l); nd.frames.push({ delay: f.delay, visible: [l.id], own: l.id }); });
      nd.frameIndex = 0; if (pix) nd.meta.pixelArt = true;
      app.addDocument(nd, 'Cámara 2D');
      import('./anim').then(m => { if (!pix && !m.dockShown()) m.toggleAnimDock(); });
      requestAnimationFrame(() => app.viewport.fit());
      app.toast(`${fr.length} fotogramas creados: pulsa reproducir para verlo`);
    },
  });
}
