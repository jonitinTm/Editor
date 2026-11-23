// Interfaz de las herramientas con IA (menú «IA», tareas rápidas y la herramienta «Selección con IA»).

import { app } from '../ui/app';
import { h, numberSlider } from '../ui/dom';
import { showDialog, row } from '../ui/dialog';
import { icon } from '../ui/icons';
import type { Tool, ToolEvent } from '../tools/tool';
import type { Viewport } from '../ui/viewport';
import { LayerMask, RasterLayer, isRaster } from '../core/layers';
import { EditorDocument } from '../core/document';
import { ctx2d, makeCanvas } from '../core/canvas';
import { maxCanvasPixels } from '../core/polyfills';
import { aiSubjectMask, aiSegmentAt, aiDepth, aiUpscale, aiSpeedHint } from './ai';

const docKey = () => { const d = app.doc!; return `${(d as any).__aiId ??= Math.random().toString(36).slice(2)}:${d.history.index}:${d.width}x${d.height}`; };

// ---- Quitar fondo con IA -------------------------------------------------------------------------------------
export async function aiRemoveBackground() {
  const d = app.doc, l = d?.active; if (!d || !l || !isRaster(l)) { app.toast('Elige la capa con la foto', 'warn'); return; }
  const m = await aiSubjectMask((l as RasterLayer).canvas); if (!m) return;
  if (l.mask) { const mc = ctx2d(l.mask.canvas); mc.globalCompositeOperation = 'destination-in'; mc.drawImage(m, 0, 0); mc.globalCompositeOperation = 'source-over'; l.mask.enabled = true; l.mask.touch(); }
  else { const mk = new LayerMask(d.width, d.height, 'white'); mk.canvas = m; mk.touch(); l.mask = mk; }
  d.editMask = false; d.invalidate(); d.commit('Quitar fondo (IA)');
  app.toast('Fondo quitado con una máscara (no se borra nada): pinta en ella en blanco o negro para retocar');
}
export async function aiSelectSubject() {
  const d = app.doc; if (!d) return;
  const m = await aiSubjectMask(d.getComposite()); if (!m) return;
  d.selection.setMask(m); d.commit('Seleccionar sujeto (IA)');
}

// ---- Herramienta: seleccionar objeto con un clic -----------------------------------------------------------------
export class AISelectTool implements Tool {
  id = 'aiSel'; name = 'Selección con IA'; icon = icon('magic'); key = 'W'; group = 'wand'; cursor = 'crosshair';
  options = [{ key: 'mode', type: 'selmode', default: 'new' }] as any[];
  private pts: { x: number; y: number; label: 0 | 1 }[] = [];
  private busy = false; private base: HTMLCanvasElement | null = null;
  extraOptions(bar: HTMLElement) {
    bar.append(h('span', { class: 'hint' }, 'Toca un objeto y la IA lo selecciona entero · Toca otra parte para añadirla · Alt+clic: quitar esa parte · Intro: terminar'),
      h('button', { class: 'btn', type: 'button', onclick: () => this.reset() }, 'Empezar de nuevo'));
  }
  activate() { this.reset(); }
  docChanged() { this.reset(); }
  private reset() { this.pts = []; this.base = null; app.viewport?.requestRender(); }
  async down(e: ToolEvent) {
    const d = app.doc; if (!d || this.busy) return;
    if (!this.pts.length) {
      // la nueva selección se combina con la que había según el modo (nueva, añadir, restar, intersecar)
      this.base = d.selection.mask; this.mode = e.shift ? 'add' : e.alt ? 'subtract' : (app.opt<string>('mode', this.id) as any) || 'new';
      this.pts.push({ x: e.x, y: e.y, label: 1 });
    } else this.pts.push({ x: e.x, y: e.y, label: e.alt ? 0 : 1 });
    app.viewport.requestRender();
    this.busy = true;
    try {
      const m = await aiSegmentAt(d.getComposite(), docKey().replace(/:\d+:/, ':'), this.pts);
      if (!m) { this.pts.pop(); return; }
      const out = makeCanvas(d.width, d.height), x = ctx2d(out);
      if (this.base && this.mode !== 'new') {
        x.drawImage(this.base, 0, 0);
        x.globalCompositeOperation = this.mode === 'add' ? 'source-over' : this.mode === 'subtract' ? 'destination-out' : 'destination-in';
      }
      x.drawImage(m, 0, 0); x.globalCompositeOperation = 'source-over';
      d.selection.setMask(out); d.commit('Selección con IA');
    } finally { this.busy = false; app.viewport.requestRender(); }
  }
  private mode: 'new' | 'add' | 'subtract' | 'intersect' = 'new';
  key_(e: KeyboardEvent) { if (e.key === 'Enter' || e.key === 'Escape') { this.reset(); return true; } return false; }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    ctx.save();
    for (const p of this.pts) { const s = vp.toScreen(p.x, p.y); ctx.fillStyle = p.label ? '#2ecc71' : '#e74c3c'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, 7, 0, 7); ctx.fill(); ctx.stroke(); }
    if (this.busy && this.pts.length) { const s = vp.toScreen(this.pts[this.pts.length - 1].x, this.pts[this.pts.length - 1].y); ctx.strokeStyle = '#3d8bfd'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(s.x, s.y, 14, (performance.now() / 150) % 7, ((performance.now() / 150) % 7) + 4); ctx.stroke(); requestAnimationFrame(() => app.viewport.requestRender()); }
    ctx.restore();
  }
}

// ---- Profundidad ----------------------------------------------------------------------------------------------------
function blurCanvas(src: HTMLCanvasElement, r: number) { if (r < 0.3) return src; const c = makeCanvas(src.width, src.height), x = ctx2d(c); x.filter = `blur(${r}px)`; x.drawImage(src, 0, 0); x.filter = 'none'; return c; }
/** Desenfoque de lente según la profundidad: nítido a la distancia elegida y cada vez más borroso al alejarse. */
export function depthBlur(src: HTMLCanvasElement, depth: Float32Array, focus: number, amount: number, range: number): HTMLCanvasElement {
  const W = src.width, H = src.height, levels = [0, 0.25, 0.5, 0.75, 1].map(f => f * amount);
  const L = levels.map(r => ctx2d(blurCanvas(src, r)).getImageData(0, 0, W, H).data), out = makeCanvas(W, H), o = ctx2d(out).createImageData(W, H), D = o.data;
  for (let i = 0; i < W * H; i++) {
    const t = Math.max(0, Math.min(1, (Math.abs(depth[i] - focus) - range) / Math.max(0.02, 0.6 - range))) * (L.length - 1), k = Math.min(L.length - 2, Math.floor(t)), f = t - k, A = L[k], B = L[k + 1], q = i * 4;
    for (let c = 0; c < 4; c++) D[q + c] = A[q + c] + (B[q + c] - A[q + c]) * f;
  }
  ctx2d(out).putImageData(o, 0, 0); return out;
}
export async function depthBlurDialog() {
  const d = app.doc, l = d?.active; if (!d || !l || !isRaster(l)) { app.toast('Elige la capa con la foto', 'warn'); return; }
  const src = (l as RasterLayer).canvas, before = makeCanvas(src.width, src.height); ctx2d(before).drawImage(src, 0, 0);
  const dep = await aiDepth(before, docKey() + ':' + l.id); if (!dep) return;
  // por defecto se enfoca lo más cercano (normalmente la persona o el objeto)
  let sorted = Array.from(dep.d.filter((_, i) => i % 97 === 0)).sort((a, b) => b - a), focus = sorted[Math.floor(sorted.length * 0.05)] ?? 0.9, amount = Math.max(4, Math.round(Math.min(src.width, src.height) / 80)), range = 0.08;
  const run = (full: boolean) => {
    if (!full) { const k = Math.min(1, 700 / Math.max(src.width, src.height)); if (k < 1) { const sw = Math.round(src.width * k), sh = Math.round(src.height * k), s = makeCanvas(sw, sh); ctx2d(s).drawImage(before, 0, 0, sw, sh); const sd = new Float32Array(sw * sh); for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) sd[y * sw + x] = dep.d[Math.min(src.height - 1, Math.round(y / k)) * src.width + Math.min(src.width - 1, Math.round(x / k))]; const r = depthBlur(s, sd, focus, amount * k, range), big = makeCanvas(src.width, src.height); ctx2d(big).drawImage(r, 0, 0, src.width, src.height); (l as RasterLayer).canvas = big; (l as RasterLayer).touch(); d.invalidate(); return; } }
    (l as RasterLayer).canvas = depthBlur(before, dep.d, focus, amount, range); (l as RasterLayer).touch(); d.invalidate();
  };
  let t = 0; const later = () => { clearTimeout(t); t = window.setTimeout(() => run(false), 60); };
  // tocar la imagen elige a qué distancia enfocar
  const pick = (e: PointerEvent) => { const r = app.viewport.canvas.getBoundingClientRect(), p = app.viewport.toDoc(e.clientX - r.left, e.clientY - r.top); const x = Math.round(p.x), y = Math.round(p.y); if (x < 0 || y < 0 || x >= src.width || y >= src.height) return; focus = dep.d[y * src.width + x]; focusSl.set(Math.round(focus * 100)); later(); e.stopPropagation(); };
  app.viewport.canvas.addEventListener('pointerdown', pick, true);
  const focusSl = numberSlider({ min: 0, max: 100, value: Math.round(focus * 100), unit: '%', onInput: v => { focus = v / 100; later(); } });
  showDialog({ title: 'Desenfoque por profundidad (IA)', width: 420, side: true, okLabel: 'Aplicar',
    body: [h('div', { class: 'hint' }, 'Toca en la foto lo que quieres nítido: lo que está más lejos o más cerca se desenfoca, como con una cámara profesional.'), row('Distancia enfocada', focusSl.el),
      row('Desenfoque', numberSlider({ min: 1, max: 80, value: amount, unit: 'px', onInput: v => { amount = v; later(); } }).el), row('Zona nítida', numberSlider({ min: 0, max: 40, value: Math.round(range * 100), unit: '%', onInput: v => { range = v / 100; later(); } }).el)],
    onOk: () => { app.viewport.canvas.removeEventListener('pointerdown', pick, true); clearTimeout(t); run(true); d.commit('Desenfoque por profundidad (IA)'); },
    onCancel: () => { app.viewport.canvas.removeEventListener('pointerdown', pick, true); clearTimeout(t); (l as RasterLayer).canvas = before; (l as RasterLayer).touch(); d.invalidate(); } });
  run(false);
}
export async function depthLayer() {
  const d = app.doc; if (!d) return;
  const dep = await aiDepth(d.getComposite(), docKey()); if (!dep) return;
  const l = new RasterLayer('Profundidad (IA)', d.width, d.height), x = ctx2d(l.canvas), id = x.createImageData(d.width, d.height);
  for (let i = 0; i < dep.d.length; i++) { const v = dep.d[i] * 255; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
  x.putImageData(id, 0, 0); l.touch(); d.insertAboveActive(l); d.setActive(l); d.invalidate(); d.commit('Mapa de profundidad (IA)');
  app.toast('Blanco = cerca, negro = lejos. Úsala como máscara o con Filtro › Desplazar');
}
/** Cuadros de la «foto 3D»: cada píxel se desplaza según su profundidad mientras la cámara se mueve en círculo. */
export function parallaxFrames(src: HTMLCanvasElement, depth: Float32Array, amp: number, n: number, motion: 'circle' | 'horizontal' | 'zoom'): HTMLCanvasElement[] {
  const W = src.width, H = src.height, S = ctx2d(src).getImageData(0, 0, W, H).data, frames: HTMLCanvasElement[] = [];
  for (let f = 0; f < n; f++) {
    const a = f / n * Math.PI * 2, dx = motion === 'zoom' ? 0 : Math.cos(a) * amp, dy = motion === 'circle' ? Math.sin(a) * amp * 0.6 : 0, z = motion === 'zoom' ? (1 - Math.cos(a)) * 0.5 * amp / Math.max(W, H) * 2 : 0;
    const c = makeCanvas(W, H), x = ctx2d(c), o = x.createImageData(W, H), D = o.data;
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
      const i = y * W + xx, dd = depth[i] - 0.5;
      let sx = xx - dx * dd, sy = y - dy * dd;
      if (z) { const s = 1 + z * (dd + 0.5); sx = W / 2 + (sx - W / 2) / s; sy = H / 2 + (sy - H / 2) / s; }
      const px = Math.max(0, Math.min(W - 1, Math.round(sx))), py = Math.max(0, Math.min(H - 1, Math.round(sy))), q = (py * W + px) * 4, r = i * 4;
      D[r] = S[q]; D[r + 1] = S[q + 1]; D[r + 2] = S[q + 2]; D[r + 3] = 255;
    }
    x.putImageData(o, 0, 0); frames.push(c);
  }
  return frames;
}
export async function photo3DDialog() {
  const d = app.doc; if (!d) return;
  const motion = h('select', {}, h('option', { value: 'circle' }, 'Círculo'), h('option', { value: 'horizontal' }, 'De lado a lado'), h('option', { value: 'zoom' }, 'Acercarse')) as HTMLSelectElement;
  const fmt = h('select', {}, h('option', { value: 'gif' }, 'GIF animado'), h('option', { value: 'video' }, 'Vídeo')) as HTMLSelectElement;
  let amp = 3;
  showDialog({ title: 'Foto 3D animada (IA)', width: 400, okLabel: 'Crear',
    body: [h('div', { class: 'hint' }, 'La IA calcula qué está cerca y qué lejos, y crea una animación en la que la foto parece tener volumen (efecto paralaje).'), row('Movimiento', motion), row('Intensidad', numberSlider({ min: 1, max: 8, value: amp, unit: '%', onInput: v => amp = v }).el), row('Formato', fmt)],
    onOk: async () => {
      const comp = d.getComposite(), k = Math.min(1, 720 / Math.max(comp.width, comp.height)), W = Math.round(comp.width * k / 2) * 2, H = Math.round(comp.height * k / 2) * 2;
      const small = makeCanvas(W, H); ctx2d(small).drawImage(comp, 0, 0, W, H);
      const dep = await aiDepth(small, docKey() + ':3d'); if (!dep) return;
      // un poco de suavizado de la profundidad evita grietas en los bordes
      const dm = makeCanvas(W, H), dx = ctx2d(dm), id = dx.createImageData(W, H); for (let i = 0; i < dep.d.length; i++) { id.data[i * 4 + 3] = dep.d[i] * 255; } dx.putImageData(id, 0, 0);
      const sm = makeCanvas(W, H), smx = ctx2d(sm); smx.filter = 'blur(3px)'; smx.drawImage(dm, 0, 0); smx.filter = 'none';
      const sd = smx.getImageData(0, 0, W, H).data, depth = new Float32Array(W * H); for (let i = 0; i < depth.length; i++) depth[i] = sd[i * 4 + 3] / 255;
      const frames = parallaxFrames(small, depth, Math.max(W, H) * amp / 100, 36, motion.value as any).map(c => ({ canvas: c, delay: 50 }));
      const io = await import('../io/files'), base = d.name.replace(/\.[^.]+$/, '') + ' - 3D';
      if (fmt.value === 'gif') { const { encodeGif } = await import('../io/gif'); await io.saveBlob(encodeGif(frames), base + '.gif'); app.toast('Foto 3D guardada como GIF'); }
      else { const { recordFrames } = await import('../ui/unique'); await recordFrames([...frames, ...frames], base); }
    } });
}

// ---- Ampliar ----------------------------------------------------------------------------------------------------------
export async function upscaleDialog() {
  const d = app.doc; if (!d) return;
  const hint = await aiSpeedHint();
  const sel = h('select', {}, h('option', { value: 'up2' }, '×2 (rápido, para dibujos y fotos)'), h('option', { value: 'up4' }, '×4 (fotos)')) as HTMLSelectElement;
  showDialog({ title: 'Ampliar con IA', width: 420, okLabel: 'Ampliar',
    body: [h('div', { class: 'hint' }, `Hace la imagen más grande inventando el detalle que falta (no se ve borrosa ni pixelada). Se calcula ${hint}. El resultado se abre como documento nuevo.`), row('Tamaño', sel), h('div', { class: 'hint' }, `Ahora: ${d.width} × ${d.height} px`)],
    onOk: async () => {
      const k = sel.value as 'up2' | 'up4', S = k === 'up4' ? 4 : 2;
      if (d.width * d.height * S * S > maxCanvasPixels()) { app.toast('El resultado sería demasiado grande para este dispositivo: recorta o reduce antes la imagen', 'warn'); return; }
      if (d.width * d.height > 1.2e6 && !confirm(`La imagen es grande (${d.width} × ${d.height}); ampliarla puede tardar varios minutos. ¿Seguir?`)) return;
      const out = await aiUpscale(d.flatten(), k); if (!out) return;
      const nd = new EditorDocument(d.name.replace(/\.[^.]+$/, '') + ` (×${S})`, out.width, out.height); nd.ppi = d.ppi;
      const l = new RasterLayer('Fondo', out.width, out.height); l.canvas = out; nd.root.add(l); nd.setActive(l, false);
      app.addDocument(nd, `Ampliar ×${S} (IA)`); app.toast(`Ampliada a ${out.width} × ${out.height}`);
    } });
}
