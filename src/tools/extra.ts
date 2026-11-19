// Más herramientas: borrador mágico, borrador de fondo, pincel de ojos rojos y regla.

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import type { Viewport } from '../ui/viewport';
import { cloneCanvas, ctx2d, getPixels } from '../core/canvas';
import { getPaintTarget, setPreview, setTargetCanvas, PaintTarget } from './paint';
import { drawBrushCursor } from './brush';
import { floodMask } from './floodfill';
import { h } from '../ui/dom';
import { rgb2hsl, hsl2rgb } from '../filters/adjustments';

/** Borrador mágico: un clic borra la zona de color parecido (como la varita, pero borrando). */
export class MagicEraserTool implements Tool {
  id = 'magicEraser'; name = 'Borrador mágico'; icon = icon('magicEraser'); key = 'E'; group = 'eraser'; cursor = 'crosshair';
  options = [
    { key: 'tolerance', label: 'Tolerancia', type: 'range', min: 0, max: 255, default: 32 },
    { key: 'contiguous', label: 'Contiguo', type: 'checkbox', default: true },
    { key: 'opacity', label: 'Opacidad', type: 'range', min: 1, max: 100, default: 100, unit: '%' },
  ] as any[];
  down(e: ToolEvent) {
    const t = getPaintTarget(); if (!t || t.isMask) { if (t?.isMask) app.toast('El borrador mágico trabaja sobre los píxeles de la capa', 'warn'); return; }
    if (t.lockAlpha) { app.toast('La transparencia de la capa está bloqueada', 'warn'); return; }
    const res = floodMask(getPixels(t.canvas), e.x, e.y, app.opt('tolerance', this.id), app.opt('contiguous', this.id));
    if (!res) return;
    const out = cloneCanvas(t.canvas), c = ctx2d(out);
    const sel = app.doc!.selection.mask;
    if (sel) { const m = ctx2d(res.canvas); m.globalCompositeOperation = 'destination-in'; m.drawImage(sel, 0, 0); }
    c.globalAlpha = app.opt<number>('opacity', this.id) / 100; c.globalCompositeOperation = 'destination-out'; c.drawImage(res.canvas, 0, 0);
    setTargetCanvas(t, out); app.doc!.commit(this.name);
  }
}

/** Borrador de fondo: borra bajo el pincel solo los colores parecidos al del centro. */
export class BackgroundEraserTool implements Tool {
  id = 'bgEraser'; name = 'Borrador de fondos'; icon = icon('bgEraser'); key = 'E'; group = 'eraser'; cursor = 'none';
  options = [
    { key: 'size', label: 'Tamaño', type: 'range', min: 1, max: 500, default: 60, unit: 'px' },
    { key: 'tolerance', label: 'Tolerancia', type: 'range', min: 1, max: 100, default: 30, unit: '%' },
    { key: 'sampling', label: 'Muestreo', type: 'select', default: 'continuous', choices: [{ value: 'continuous', label: 'Continuo' }, { value: 'once', label: 'Una vez' }] },
    { key: 'protect', label: 'Proteger color frontal', type: 'checkbox', default: false },
  ] as any[];
  /** Qué se hace con cada píxel parecido: aquí, borrarlo. */
  protected apply(d: Uint8ClampedArray, i: number, f: number) { d[i + 3] = d[i + 3] * (1 - f); }
  private t: PaintTarget | null = null; private work: HTMLCanvasElement | null = null; private last: { x: number; y: number } | null = null;
  private sample: number[] | null = null; private changed = false;
  down(e: ToolEvent) {
    const t = getPaintTarget(); if (!t || t.isMask) return;
    if (t.lockAlpha && this.id === 'bgEraser') { app.toast('La transparencia de la capa está bloqueada', 'warn'); return; }
    this.t = t; this.work = cloneCanvas(t.canvas); this.changed = false; this.sample = null;
    setPreview(t, this.work); this.last = { x: e.x, y: e.y }; this.dab(e.x, e.y);
  }
  move(e: ToolEvent) {
    if (!this.work || !this.last) return;
    const step = Math.max(1, app.opt<number>('size', this.id) * 0.15), d = Math.hypot(e.x - this.last.x, e.y - this.last.y);
    for (let s = step; s <= d; s += step) this.dab(this.last.x + (e.x - this.last.x) * s / d, this.last.y + (e.y - this.last.y) * s / d);
    if (d >= step) this.last = { x: e.x, y: e.y };
  }
  private dab(cx: number, cy: number) {
    const c = this.work!, r = app.opt<number>('size', this.id) / 2, tol = app.opt<number>('tolerance', this.id) * 2.55;
    const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r)), x1 = Math.min(c.width, Math.ceil(cx + r)), y1 = Math.min(c.height, Math.ceil(cy + r));
    const w = x1 - x0, hh = y1 - y0; if (w < 1 || hh < 1) return;
    const ctx = ctx2d(c), img = ctx.getImageData(x0, y0, w, hh), d = img.data;
    const ci = (Math.min(hh - 1, Math.max(0, Math.round(cy) - y0)) * w + Math.min(w - 1, Math.max(0, Math.round(cx) - x0))) * 4;
    if (!this.sample || app.opt('sampling', this.id) === 'continuous') { if (d[ci + 3] > 0) this.sample = [d[ci], d[ci + 1], d[ci + 2]]; }
    const s = this.sample; if (!s) return;
    const fg = app.opt('protect', this.id) ? parseInt(app.fg.slice(1), 16) : -1, fr = fg >> 16 & 255, fgc = fg >> 8 & 255, fb = fg & 255;
    const sel = app.doc!.selection.mask ? ctx2d(app.doc!.selection.mask).getImageData(x0, y0, w, hh).data : null;
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const dist = Math.hypot(x0 + x + 0.5 - cx, y0 + y + 0.5 - cy) / r; if (dist >= 1) continue;
      const i = (y * w + x) * 4; if (!d[i + 3]) continue;
      const cd = Math.max(Math.abs(d[i] - s[0]), Math.abs(d[i + 1] - s[1]), Math.abs(d[i + 2] - s[2]));
      if (cd > tol) continue;
      if (fg >= 0 && Math.max(Math.abs(d[i] - fr), Math.abs(d[i + 1] - fgc), Math.abs(d[i + 2] - fb)) < 20) continue;
      // borde suave del pincel y de la tolerancia
      const f = Math.min(1, (1 - dist) * 3) * Math.min(1, (tol - cd) / Math.max(1, tol * 0.25)) * (sel ? sel[i + 3] / 255 : 1);
      this.apply(d, i, f);
    }
    ctx.putImageData(img, x0, y0); this.changed = true;
    app.doc!.invalidate({ x: x0, y: y0, w, h: hh });
  }
  up() {
    const t = this.t; if (!t || !this.work) return;
    setPreview(t, null);
    if (this.changed) { setTargetCanvas(t, this.work); app.doc!.commit(this.name); }
    this.t = null; this.work = null; this.last = null;
  }
  cancel() { if (this.t) setPreview(this.t, null); this.t = null; this.work = null; app.doc?.invalidate(); }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    drawBrushCursor(ctx, vp, app.opt<number>('size', this.id));
    if (vp.mouseScreen) { ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.moveTo(vp.mouseScreen.x - 3, vp.mouseScreen.y - 3); ctx.lineTo(vp.mouseScreen.x + 3, vp.mouseScreen.y + 3); ctx.stroke(); }
  }
}

/** Pincel de ojos rojos: clic en la pupila (o arrastra un recuadro sobre el ojo). */
export class RedEyeTool implements Tool {
  id = 'redEye'; name = 'Pincel de ojos rojos'; icon = icon('redEye'); key = 'J'; group = 'heal'; cursor = 'crosshair';
  options = [
    { key: 'pupil', label: 'Tamaño de pupila', type: 'range', min: 1, max: 100, default: 50, unit: '%' },
    { key: 'darken', label: 'Oscurecer', type: 'range', min: 1, max: 100, default: 50, unit: '%' },
  ] as any[];
  private start: { x: number; y: number } | null = null; private now: { x: number; y: number } | null = null;
  down(e: ToolEvent) { this.start = { x: e.x, y: e.y }; this.now = { ...this.start }; }
  move(e: ToolEvent) { if (this.start) { this.now = { x: e.x, y: e.y }; app.viewport.requestRender(); } }
  up() {
    const s = this.start, n = this.now; this.start = this.now = null; if (!s || !n) return;
    const t = getPaintTarget(); if (!t || t.isMask) return;
    const d = app.doc!;
    // sin arrastre: zona proporcional a la imagen alrededor del clic
    let r = Math.max(Math.abs(n.x - s.x), Math.abs(n.y - s.y)) / 2;
    const cx = r > 3 ? (s.x + n.x) / 2 : s.x, cy = r > 3 ? (s.y + n.y) / 2 : s.y;
    if (r <= 3) r = Math.max(8, Math.min(d.width, d.height) * 0.03 * (0.5 + app.opt<number>('pupil', this.id) / 100));
    const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r)), x1 = Math.min(d.width, Math.ceil(cx + r)), y1 = Math.min(d.height, Math.ceil(cy + r));
    const w = x1 - x0, hh = y1 - y0; if (w < 1 || hh < 1) return;
    const out = cloneCanvas(t.canvas), c = ctx2d(out), img = c.getImageData(x0, y0, w, hh), p = img.data;
    const dark = 1 - app.opt<number>('darken', this.id) / 100 * 0.7;
    let n2 = 0;
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const dist = Math.hypot(x0 + x + 0.5 - cx, y0 + y + 0.5 - cy) / r; if (dist > 1) continue;
      const i = (y * w + x) * 4, R = p[i], G = p[i + 1], B = p[i + 2];
      const redness = R - Math.max(G, B);
      if (R < 60 || redness < 30) continue;
      const k = Math.min(1, (redness - 30) / 50) * Math.min(1, (1 - dist) * 4);
      const v = (G + B) / 2 * dark;
      p[i] = R + (v - R) * k; p[i + 1] = G + (G * dark - G) * k; p[i + 2] = B + (B * dark - B) * k; n2++;
    }
    if (!n2) { app.toast('No se ha encontrado rojo en esa zona', 'warn'); return; }
    c.putImageData(img, x0, y0);
    setTargetCanvas(t, out); d.commit(this.name);
  }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (!this.start || !this.now) return;
    const a = vp.toScreen(this.start.x, this.start.y), b = vp.toScreen(this.now.x, this.now.y);
    ctx.strokeStyle = '#fff'; ctx.setLineDash([4, 3]); ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); ctx.setLineDash([]);
  }
}

/** Regla: mide distancia y ángulo; «Enderezar» gira la imagen para que la línea quede horizontal. */
export class RulerTool implements Tool {
  id = 'ruler'; name = 'Regla'; icon = icon('ruler'); key = 'I'; group = 'eyedropper'; cursor = 'crosshair';
  options = [{ key: 'fill', label: 'Esquinas', type: 'select', default: 'bg', choices: [{ value: 'bg', label: 'Color de fondo' }, { value: 'content', label: 'Según el contenido' }, { value: 'none', label: 'Transparentes' }] }] as any[];
  private a: { x: number; y: number } | null = null; private b: { x: number; y: number } | null = null; private dragging = false;
  private info: HTMLElement | null = null;
  extraOptions(bar: HTMLElement) {
    this.info = h('span', { class: 'hint ruler-info' }, this.text());
    bar.append(this.info,
      h('button', { class: 'btn', title: 'Gira la imagen para que la línea medida quede recta', onclick: () => this.straighten() }, 'Enderezar'),
      h('button', { class: 'btn', onclick: () => { this.a = this.b = null; this.sync(); } }, 'Borrar'));
  }
  private measure() { if (!this.a || !this.b) return null; const dx = this.b.x - this.a.x, dy = this.b.y - this.a.y; return { dx, dy, len: Math.hypot(dx, dy), ang: -Math.atan2(dy, dx) * 180 / Math.PI }; }
  private text() { const m = this.measure(); return m ? `X: ${Math.round(this.a!.x)}  Y: ${Math.round(this.a!.y)}   An: ${Math.round(m.dx)}  Al: ${Math.round(m.dy)}   Ángulo: ${m.ang.toFixed(1)}°   Distancia: ${m.len.toFixed(1)} px` : 'Arrastra para medir'; }
  private sync() { if (this.info) this.info.textContent = this.text(); app.viewport.requestRender(); }
  down(e: ToolEvent) { this.a = { x: e.x, y: e.y }; this.b = { ...this.a }; this.dragging = true; this.sync(); }
  move(e: ToolEvent) {
    if (!this.dragging || !this.a) return;
    let x = e.x, y = e.y;
    if (e.shift) { const ang = Math.round(Math.atan2(y - this.a.y, x - this.a.x) / (Math.PI / 4)) * Math.PI / 4, d = Math.hypot(x - this.a.x, y - this.a.y); x = this.a.x + Math.cos(ang) * d; y = this.a.y + Math.sin(ang) * d; }
    this.b = { x, y }; this.sync();
  }
  up() { this.dragging = false; }
  private straighten() {
    const m = this.measure(); if (!m || m.len < 2) { app.toast('Mide primero una línea que debería ser recta', 'warn'); return; }
    // el ángulo más cercano a horizontal o vertical
    let a = m.ang; while (a > 45) a -= 90; while (a < -45) a += 90;
    if (Math.abs(a) < 0.05) { app.toast('La línea ya está recta'); return; }
    import('../ui/ops').then(o => { const f = app.opt('fill', this.id); o.rotateImageArbitrary(a, f === 'content' ? 'content' : f !== 'none'); this.a = this.b = null; this.sync(); });
  }
  deactivate() { this.dragging = false; }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (!this.a || !this.b) return;
    const p = vp.toScreen(this.a.x, this.a.y), q = vp.toScreen(this.b.x, this.b.y);
    ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
    for (const s of [p, q]) { ctx.beginPath(); ctx.moveTo(s.x - 5, s.y); ctx.lineTo(s.x + 5, s.y); ctx.moveTo(s.x, s.y - 5); ctx.lineTo(s.x, s.y + 5); ctx.stroke(); }
    ctx.restore();
  }
}

/** Sustitución de color: cambia el tono y la saturación de los colores parecidos al muestreado, conservando la luz. */
export class ColorReplaceTool extends BackgroundEraserTool {
  id = 'colorReplace'; name = 'Sustitución de color'; icon = icon('colorReplace'); key = 'B'; group = 'brush'; cursor = 'none';
  options = [
    { key: 'size', label: 'Tamaño', type: 'range', min: 1, max: 500, default: 40, unit: 'px' },
    { key: 'tolerance', label: 'Tolerancia', type: 'range', min: 1, max: 100, default: 30, unit: '%' },
    { key: 'sampling', label: 'Muestreo', type: 'select', default: 'continuous', choices: [{ value: 'continuous', label: 'Continuo' }, { value: 'once', label: 'Una vez' }] },
    { key: 'mode', label: 'Modo', type: 'select', default: 'color', choices: [{ value: 'color', label: 'Color' }, { value: 'hue', label: 'Tono' }, { value: 'saturation', label: 'Saturación' }, { value: 'luminosity', label: 'Luminosidad' }] },
  ] as any[];
  protected apply(d: Uint8ClampedArray, i: number, f: number) {
    const fg = parseInt(app.fg.slice(1), 16), [fh, fs, fl] = rgb2hsl(fg >> 16 & 255, fg >> 8 & 255, fg & 255);
    let [h0, s0, l0] = rgb2hsl(d[i], d[i + 1], d[i + 2]);
    const m = app.opt('mode', this.id);
    if (m === 'color') { h0 = fh; s0 = fs; } else if (m === 'hue') h0 = fh; else if (m === 'saturation') s0 = fs; else l0 = fl;
    const [r, g, b] = hsl2rgb(h0, s0, l0);
    d[i] += (r - d[i]) * f; d[i + 1] += (g - d[i + 1]) * f; d[i + 2] += (b - d[i + 2]) * f;
  }
}

/** Muestra de color: hasta 4 puntos fijos cuyo color se ve en el panel Info (Alt+clic quita uno). */
export class ColorSamplerTool implements Tool {
  id = 'colorSampler'; name = 'Muestra de color'; icon = icon('colorSampler'); key = 'I'; group = 'eyedropper'; cursor = 'crosshair';
  private drag = -1;
  extraOptions(bar: HTMLElement) {
    bar.append(h('span', { class: 'hint' }, 'Clic: añadir un punto (hasta 4) · arrastra para moverlo · Alt+clic para quitarlo. Los colores se ven en Ventana › Info.'),
      h('button', { class: 'btn', onclick: () => { const d = app.doc; if (d) { (d as any).samplers = []; app.viewport.requestRender(); app.emit('view'); } } }, 'Borrar todos'));
  }
  private list(): { x: number; y: number }[] { const d = app.doc as any; if (!d.samplers) d.samplers = []; return d.samplers; }
  private hit(e: ToolEvent) { return this.list().findIndex(p => { const s = app.viewport.toScreen(p.x, p.y); return Math.hypot(s.x - e.sx, s.y - e.sy) < 9; }); }
  down(e: ToolEvent) {
    const L = this.list(), k = this.hit(e);
    if (e.alt) { if (k >= 0) L.splice(k, 1); app.viewport.requestRender(); app.emit('view'); return; }
    if (k >= 0) { this.drag = k; return; }
    if (L.length >= 4) { app.toast('Como mucho 4 puntos de muestra (Alt+clic para quitar uno)', 'warn'); return; }
    L.push({ x: Math.floor(e.x), y: Math.floor(e.y) }); this.drag = L.length - 1;
    app.viewport.requestRender(); app.emit('view');
  }
  move(e: ToolEvent) { if (this.drag < 0) return; const p = this.list()[this.drag]; if (p) { p.x = Math.floor(e.x); p.y = Math.floor(e.y); app.emit('view'); } }
  up() { this.drag = -1; }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) { drawSamplers(ctx, vp); }
}
/** Dibuja los puntos de muestra (se ven con cualquier herramienta). */
export function drawSamplers(ctx: CanvasRenderingContext2D, vp: Viewport) {
  const L = (app.doc as any)?.samplers as { x: number; y: number }[] | undefined; if (!L?.length) return;
  ctx.save(); ctx.font = 'bold 11px system-ui';
  L.forEach((p, i) => {
    const s = vp.toScreen(p.x + 0.5, p.y + 0.5);
    for (const [c, w] of [['#000', 3], ['#fff', 1.4]] as const) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, 7); ctx.moveTo(s.x - 10, s.y); ctx.lineTo(s.x - 3, s.y); ctx.moveTo(s.x + 3, s.y); ctx.lineTo(s.x + 10, s.y); ctx.moveTo(s.x, s.y - 10); ctx.lineTo(s.x, s.y - 3); ctx.moveTo(s.x, s.y + 3); ctx.lineTo(s.x, s.y + 10); ctx.stroke(); }
    ctx.fillStyle = '#000'; ctx.fillText(String(i + 1), s.x + 9, s.y + 15); ctx.fillStyle = '#fff'; ctx.fillText(String(i + 1), s.x + 8, s.y + 14);
  });
  ctx.restore();
}

(app as any).drawSamplers = drawSamplers;

/** Recuento: cada clic pone un número sobre la imagen (para contar objetos). Alt+clic quita el más cercano. */
export class CountTool implements Tool {
  id = 'count'; name = 'Recuento'; icon = icon('count'); key = 'I'; group = 'eyedropper'; cursor = 'crosshair';
  options = [
    { key: 'color', label: 'Color', type: 'color', default: '#ff2d55' },
    { key: 'size', label: 'Tamaño', type: 'range', min: 6, max: 80, default: 14, unit: 'px' },
  ] as any[];
  private info: HTMLElement | null = null;
  private list(): { x: number; y: number }[] { const d = app.doc as any; if (!d.counts) d.counts = []; return d.counts; }
  private upd() { if (this.info) this.info.textContent = `Total: ${app.doc ? this.list().length : 0}`; app.viewport.requestRender(); }
  extraOptions(bar: HTMLElement) {
    this.info = h('b', { class: 'opt' }, '');
    bar.append(this.info,
      h('span', { class: 'hint' }, 'Clic: contar · Alt+clic: quitar'),
      h('button', { class: 'btn', onclick: () => { if (app.doc) { (app.doc as any).counts = []; this.upd(); } } }, 'Borrar'),
      h('button', { class: 'btn', title: 'Dibuja los números en una capa nueva para que se vean al exportar', onclick: () => this.bake() }, 'Pasar a capa'));
    this.upd();
  }
  activate() { this.upd(); }
  docChanged() { this.upd(); }
  down(e: ToolEvent) {
    const L = this.list();
    if (e.alt) {
      let k = -1, best = 1e9; L.forEach((p, i) => { const d = Math.hypot(p.x - e.x, p.y - e.y); if (d < best) { best = d; k = i; } });
      if (k >= 0 && best * app.viewport.zoom < 30) L.splice(k, 1);
    } else L.push({ x: Math.round(e.x), y: Math.round(e.y) });
    this.upd();
  }
  private paint(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], scale: number) {
    const col = app.opt<string>('color', this.id) || '#ff2d55', sz = (app.opt<number>('size', this.id) || 14) * scale;
    ctx.save(); ctx.font = `bold ${sz}px system-ui, sans-serif`; ctx.textBaseline = 'middle';
    pts.forEach((p, i) => {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(2, sz * 0.22), 0, 7); ctx.fill();
      ctx.lineWidth = Math.max(2, sz / 5); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(String(i + 1), p.x + sz * 0.35, p.y - sz * 0.45);
      ctx.fillText(String(i + 1), p.x + sz * 0.35, p.y - sz * 0.45);
    });
    ctx.restore();
  }
  private bake() {
    const d = app.doc, L = d ? this.list() : []; if (!d || !L.length) { app.toast('No hay nada contado', 'warn'); return; }
    const t = d.newRasterLayer('Recuento') as any;
    this.paint(ctx2d(t.canvas), L, 1); t.touch(); d.invalidate(); d.commit('Recuento a capa'); (d as any).counts = []; this.upd();
  }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (!app.doc) return;
    this.paint(ctx, this.list().map(p => vp.toScreen(p.x, p.y)), vp.zoom);
  }
}

// ---- Notas ------------------------------------------------------------------
export type Note = { x: number; y: number; text: string; author: string; color: string; date: number };
const notesOf = (): Note[] => { const d = app.doc as any; if (!d) return []; if (!d.notes) d.notes = []; return d.notes; };
/** Dibuja las notas como pequeños papeles amarillos (se ven con cualquier herramienta; se guardan en el proyecto). */
export function drawNotes(ctx: CanvasRenderingContext2D, vp: Viewport, active = -1) {
  const L = (app.doc as any)?.notes as Note[] | undefined; if (!L?.length) return;
  ctx.save();
  L.forEach((n, i) => {
    const s = vp.toScreen(n.x, n.y), x = Math.round(s.x), y = Math.round(s.y);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x + 2, y + 2, 16, 18);
    ctx.fillStyle = n.color || '#ffd84d'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 16, y); ctx.lineTo(x + 16, y + 13); ctx.lineTo(x + 11, y + 18); ctx.lineTo(x, y + 18); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = i === active ? '#3d8bfd' : 'rgba(0,0,0,.6)'; ctx.lineWidth = i === active ? 2 : 1; ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1; ctx.beginPath(); for (const k of [5, 9, 13]) { ctx.moveTo(x + 3, y + k + .5); ctx.lineTo(x + 13, y + k + .5); } ctx.stroke();
  });
  ctx.restore();
}
(app as any).drawNotes = drawNotes;

/** Nota: clic para poner una nota de texto sobre la imagen; clic en una nota para leerla o editarla; arrastrar para moverla. */
export class NoteTool implements Tool {
  id = 'note'; name = 'Nota'; icon = icon('note'); key = 'I'; group = 'eyedropper'; cursor = 'crosshair';
  options = [
    { key: 'color', label: 'Color', type: 'color', default: '#ffd84d' },
  ] as any[];
  private active = -1; private drag: { i: number; dx: number; dy: number; moved: boolean } | null = null;
  private pop: HTMLElement | null = null;
  extraOptions(bar: HTMLElement) {
    const who = h('input', { type: 'text', class: 'num', value: localStorage.getItem('editor.noteAuthor') ?? '', placeholder: 'Tu nombre' }) as HTMLInputElement;
    who.style.width = '110px'; who.oninput = () => { try { localStorage.setItem('editor.noteAuthor', who.value); } catch { /* */ } };
    bar.append(h('label', { class: 'opt' }, h('span', { class: 'lbl' }, 'Autor'), who),
      h('span', { class: 'hint' }, `Notas: ${notesOf().length} · clic: nueva o abrir · arrastrar: mover`),
      h('button', { class: 'btn', onclick: () => { if (!app.doc) return; (app.doc as any).notes = []; this.close(); app.doc.changed(); app.viewport.requestRender(); } }, 'Borrar todas'));
  }
  private hit(e: ToolEvent) { const L = notesOf(); for (let i = L.length - 1; i >= 0; i--) { const s = app.viewport.toScreen(L[i].x, L[i].y); if (e.sx >= s.x - 2 && e.sx <= s.x + 18 && e.sy >= s.y - 2 && e.sy <= s.y + 20) return i; } return -1; }
  down(e: ToolEvent) {
    const k = this.hit(e);
    if (k >= 0) { const n = notesOf()[k]; this.drag = { i: k, dx: e.x - n.x, dy: e.y - n.y, moved: false }; return; }
    this.close();
    let author = ''; try { author = localStorage.getItem('editor.noteAuthor') ?? ''; } catch { /* */ }
    notesOf().push({ x: Math.round(e.x), y: Math.round(e.y), text: '', author, color: app.opt<string>('color', this.id) || '#ffd84d', date: Date.now() });
    this.open(notesOf().length - 1, true);
  }
  move(e: ToolEvent) { const g = this.drag; if (!g) return; const n = notesOf()[g.i]; n.x = Math.round(e.x - g.dx); n.y = Math.round(e.y - g.dy); g.moved = true; this.close(); app.viewport.requestRender(); }
  up() { const g = this.drag; this.drag = null; if (!g) return; if (g.moved) app.doc!.changed(); else this.open(g.i, false); }
  private open(i: number, isNew: boolean) {
    this.close(); this.active = i; const n = notesOf()[i]; if (!n) return;
    const ta = h('textarea', { placeholder: 'Escribe la nota…' }) as HTMLTextAreaElement; ta.value = n.text;
    ta.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Escape') this.close(); });
    ta.oninput = () => { n.text = ta.value; };
    const meta = `${n.author || 'Sin autor'} · ${new Date(n.date).toLocaleString()}`;
    const pop = h('div', { class: 'note-pop' },
      h('div', { class: 'note-head' }, h('span', {}, meta),
        h('button', { class: 'btn', title: 'Borrar esta nota', onclick: () => { notesOf().splice(i, 1); this.close(); app.doc!.changed(); } }, 'Borrar'),
        h('button', { class: 'btn', title: 'Cerrar', html: icon('close'), onclick: () => this.close() })), ta);
    const s = app.viewport.toScreen(n.x, n.y); pop.style.left = (s.x + 22) + 'px'; pop.style.top = s.y + 'px';
    app.viewport.canvas.parentElement!.append(pop); this.pop = pop; (pop as any).isNew = isNew;
    setTimeout(() => ta.focus(), 0); app.viewport.requestRender();
  }
  private close() {
    if (!this.pop) return; const n = notesOf()[this.active];
    if (n && !n.text.trim() && (this.pop as any).isNew) notesOf().splice(this.active, 1);
    this.pop.remove(); this.pop = null; this.active = -1; app.doc?.changed(); app.viewport?.requestRender();
  }
  deactivate() { this.close(); }
  docChanged() { if (this.pop) { this.pop.remove(); this.pop = null; this.active = -1; } }
  cancel() { this.close(); }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) { drawNotes(ctx, vp, this.active); }
}
