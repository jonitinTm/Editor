// Visor: muestra el documento con zoom y desplazamiento, reglas, guías,
// la selección ("hormigas en marcha") y lo que dibuje la herramienta activa.

import { app } from './app';
import type { ToolEvent } from '../tools/tool';
import { h } from './dom';
import { drawSnap } from '../tools/snap';

const RULER = 20;

export class Viewport {
  el: HTMLElement;
  canvas: HTMLCanvasElement;
  rulerH: HTMLCanvasElement;
  rulerV: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  width = 0; height = 0;
  private scheduled = false;
  private antsOffset = 0;
  /** Última posición del ratón en coordenadas del documento. */
  mouse: { x: number; y: number } | null = null;
  mouseScreen: { x: number; y: number } | null = null;
  private spaceDown = false;
  private panning: { x: number; y: number; px: number; py: number } | null = null;
  private toolActive = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; cx: number; cy: number; zoom: number; px: number; py: number } | null = null;
  /** Guía que se está arrastrando. */
  private guideDrag: { axis: 'h' | 'v'; index: number; pos: number } | null = null;
  private checker: CanvasPattern | null = null;
  private quickCanvas: HTMLCanvasElement | null = null;
  private lastClick: { t: number; x: number; y: number; n: number } | null = null;

  constructor(parent: HTMLElement) {
    this.canvas = h('canvas', { class: 'view-canvas' });
    this.rulerH = h('canvas', { class: 'ruler ruler-h' });
    this.rulerV = h('canvas', { class: 'ruler ruler-v' });
    this.el = h('div', { class: 'viewport' },
      h('div', { class: 'ruler-corner' }), this.rulerH, this.rulerV,
      h('div', { class: 'view-wrap' }, this.canvas));
    parent.append(this.el);
    this.ctx = this.canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(this.el.querySelector('.view-wrap')!);
    this.bindEvents();
    setInterval(() => {
      if (app.doc?.selection.active || app.tool?.id === 'crop') { this.antsOffset = (this.antsOffset + 1) % 8; this.requestRender(); }
    }, 140);
  }

  get doc() { return app.doc; }
  get zoom() { return this.doc?.view.zoom ?? 1; }

  // ---- Coordenadas ----------------------------------------------------
  toDoc(sx: number, sy: number) {
    const v = this.doc!.view;
    return { x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom };
  }
  toScreen(x: number, y: number) {
    const v = this.doc!.view;
    return { x: x * v.zoom + v.panX, y: y * v.zoom + v.panY };
  }

  resize() {
    const wrap = this.canvas.parentElement!;
    this.dpr = window.devicePixelRatio || 1;
    this.width = wrap.clientWidth; this.height = wrap.clientHeight;
    for (const [c, w, hh] of [[this.canvas, this.width, this.height], [this.rulerH, this.width, RULER], [this.rulerV, RULER, this.height]] as const) {
      c.width = Math.max(1, Math.round(w * this.dpr)); c.height = Math.max(1, Math.round(hh * this.dpr));
      c.style.width = w + 'px'; c.style.height = hh + 'px';
    }
    this.el.classList.toggle('no-rulers', !app.showRulers);
    if (this.doc && !this.doc.viewInitialized && this.width > 10) this.fit(true);
    this.render();
  }

  setRulers(show: boolean) { app.showRulers = show; this.el.classList.toggle('no-rulers', !show); requestAnimationFrame(() => this.resize()); }

  fit(onlyShrink = false) {
    const d = this.doc; if (!d || this.width < 10) return;
    const m = 40;
    let z = Math.min((this.width - m) / d.width, (this.height - m) / d.height);
    if (onlyShrink) z = Math.min(z, 1);
    this.setZoom(z, null, true);
    d.viewInitialized = true;
  }

  /** Cambia el zoom manteniendo fijo el punto de pantalla (sx, sy). */
  setZoom(z: number, at: { x: number; y: number } | null, center = false) {
    const d = this.doc; if (!d) return;
    z = Math.min(64, Math.max(0.01, z));
    if (center) {
      d.view.zoom = z;
      d.view.panX = Math.round((this.width - d.width * z) / 2);
      d.view.panY = Math.round((this.height - d.height * z) / 2);
    } else {
      const p = at ?? { x: this.width / 2, y: this.height / 2 };
      const dp = this.toDoc(p.x, p.y);
      d.view.zoom = z;
      d.view.panX = p.x - dp.x * z; d.view.panY = p.y - dp.y * z;
    }
    app.emit('view');
    this.requestRender();
  }
  zoomStep(dir: 1 | -1, at: { x: number; y: number } | null = null) {
    const steps = [0.01, 0.02, 0.03, 0.05, 0.0667, 0.0833, 0.125, 0.1667, 0.25, 0.333, 0.5, 0.6667, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 24, 32, 64];
    const z = this.zoom;
    const next = dir > 0 ? steps.find(s => s > z * 1.001) : [...steps].reverse().find(s => s < z * 0.999);
    if (next) this.setZoom(next, at);
  }

  requestRender() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => { this.scheduled = false; this.render(); });
  }

  // ---- Dibujo ---------------------------------------------------------
  private checkerPattern() {
    if (this.checker) return this.checker;
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const x = c.getContext('2d')!;
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 16, 16);
    x.fillStyle = '#cfcfcf'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
    this.checker = this.ctx.createPattern(c, 'repeat');
    return this.checker!;
  }

  render() {
    const ctx = this.ctx, d = this.doc;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--canvas-bg') || '#1b1c1f';
    ctx.fillRect(0, 0, this.width, this.height);
    if (!d) { this.renderRulers(); return; }
    const { zoom, panX, panY } = d.view;
    const dw = d.width * zoom, dh = d.height * zoom;

    // Sombra + cuadrícula de transparencia
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 12;
    ctx.fillStyle = '#fff'; ctx.fillRect(panX, panY, dw, dh);
    ctx.restore();
    ctx.save();
    ctx.translate(panX, panY);
    ctx.fillStyle = this.checkerPattern();
    ctx.fillRect(0, 0, dw, dh);
    ctx.restore();

    // Imagen combinada
    const comp = d.getComposite();
    ctx.save();
    ctx.imageSmoothingEnabled = zoom < 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(comp, panX, panY, dw, dh);
    ctx.restore();

    // Cuadrícula de píxeles a mucho zoom
    if (zoom >= 12) {
      ctx.save(); ctx.strokeStyle = 'rgba(128,128,128,.25)'; ctx.lineWidth = 1; ctx.beginPath();
      const x0 = Math.max(0, Math.floor(-panX / zoom)), x1 = Math.min(d.width, Math.ceil((this.width - panX) / zoom));
      const y0 = Math.max(0, Math.floor(-panY / zoom)), y1 = Math.min(d.height, Math.ceil((this.height - panY) / zoom));
      for (let x = x0; x <= x1; x++) { const sx = Math.round(panX + x * zoom) + .5; ctx.moveTo(sx, panY + y0 * zoom); ctx.lineTo(sx, panY + y1 * zoom); }
      for (let y = y0; y <= y1; y++) { const sy = Math.round(panY + y * zoom) + .5; ctx.moveTo(panX + x0 * zoom, sy); ctx.lineTo(panX + x1 * zoom, sy); }
      ctx.stroke(); ctx.restore();
    }

    // Cuadrícula
    if (app.showGrid && app.gridSize * zoom >= 6) {
      const g = app.gridSize;
      ctx.save(); ctx.beginPath(); ctx.rect(panX, panY, dw, dh); ctx.clip();
      ctx.strokeStyle = 'rgba(120,120,120,.55)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 0; x <= d.width; x += g) { const sx = Math.round(panX + x * zoom) + .5; ctx.moveTo(sx, panY); ctx.lineTo(sx, panY + dh); }
      for (let y = 0; y <= d.height; y += g) { const sy = Math.round(panY + y * zoom) + .5; ctx.moveTo(panX, sy); ctx.lineTo(panX + dw, sy); }
      ctx.stroke(); ctx.restore();
    }

    // Vista previa de refinar selección
    if (d.refinePreview) {
      const rp = d.refinePreview, ov = this.quickCanvas ??= document.createElement('canvas');
      if (ov.width !== d.width || ov.height !== d.height) { ov.width = d.width; ov.height = d.height; }
      const oc = ov.getContext('2d')!;
      oc.globalCompositeOperation = 'copy';
      if (rp.mode === 'overlay') { oc.fillStyle = 'rgba(255,0,0,.5)'; oc.fillRect(0, 0, d.width, d.height); oc.globalCompositeOperation = 'destination-out'; oc.drawImage(rp.mask, 0, 0); }
      else {
        oc.drawImage(comp, 0, 0); oc.globalCompositeOperation = 'destination-in'; oc.drawImage(rp.mask, 0, 0);
        if (rp.mode !== 'transparent') { oc.globalCompositeOperation = 'destination-over'; oc.fillStyle = rp.mode === 'black' ? '#000' : '#fff'; oc.fillRect(0, 0, d.width, d.height); }
        else { ctx.save(); ctx.translate(panX, panY); ctx.fillStyle = this.checkerPattern(); ctx.fillRect(0, 0, dw, dh); ctx.restore(); }
      }
      ctx.save(); ctx.imageSmoothingEnabled = zoom < 1; ctx.drawImage(ov, panX, panY, dw, dh); ctx.restore();
    }
    // Máscara rápida: lo no seleccionado se tiñe de rojo
    if (d.quickMask) {
      const qm = d.quickPreview ?? d.selection.mask;
      const ov = this.quickCanvas ??= document.createElement('canvas');
      if (ov.width !== d.width || ov.height !== d.height) { ov.width = d.width; ov.height = d.height; }
      const oc = ov.getContext('2d')!;
      oc.globalCompositeOperation = 'copy'; oc.fillStyle = 'rgba(255,0,0,.5)'; oc.fillRect(0, 0, d.width, d.height);
      if (qm) { oc.globalCompositeOperation = 'destination-out'; oc.drawImage(qm, 0, 0); }
      ctx.save(); ctx.imageSmoothingEnabled = zoom < 1; ctx.drawImage(ov, panX, panY, dw, dh); ctx.restore();
    }

    // Selección
    const outline = d.quickMask || d.refinePreview ? null : d.selection.getOutline();
    if (outline) this.drawAnts(outline, (d as any).selectionOffset);

    // Guías
    if (app.showGuides) {
      ctx.save(); ctx.strokeStyle = '#19d3f0'; ctx.lineWidth = 1; ctx.beginPath();
      for (const g of d.guides.v) { const x = Math.round(panX + g * zoom) + .5; ctx.moveTo(x, 0); ctx.lineTo(x, this.height); }
      for (const g of d.guides.h) { const y = Math.round(panY + g * zoom) + .5; ctx.moveTo(0, y); ctx.lineTo(this.width, y); }
      if (this.guideDrag) {
        const g = this.guideDrag;
        if (g.axis === 'v') { const x = Math.round(panX + g.pos * zoom) + .5; ctx.moveTo(x, 0); ctx.lineTo(x, this.height); }
        else { const y = Math.round(panY + g.pos * zoom) + .5; ctx.moveTo(0, y); ctx.lineTo(this.width, y); }
      }
      ctx.stroke(); ctx.restore();
    }

    // Capa superpuesta de la herramienta
    ctx.save();
    app.tool?.drawOverlay?.(ctx, this);
    ctx.restore();
    drawSnap(ctx, this);
    this.renderRulers();
  }

  /** Dibuja un trazado en coordenadas del documento como línea discontinua animada. */
  drawAnts(path: Path2D, offset?: { x: number; y: number }) {
    const ctx = this.ctx, v = this.doc!.view;
    ctx.save();
    ctx.translate(v.panX + (offset?.x ?? 0) * v.zoom, v.panY + (offset?.y ?? 0) * v.zoom);
    ctx.scale(v.zoom, v.zoom);
    ctx.lineWidth = 1 / v.zoom;
    ctx.strokeStyle = '#fff'; ctx.setLineDash([]); ctx.stroke(path);
    ctx.strokeStyle = '#000'; ctx.setLineDash([4 / v.zoom, 4 / v.zoom]); ctx.lineDashOffset = -this.antsOffset / v.zoom;
    ctx.stroke(path);
    ctx.restore();
  }

  private renderRulers() {
    if (!app.showRulers) return;
    const d = this.doc;
    for (const horiz of [true, false]) {
      const c = horiz ? this.rulerH : this.rulerV;
      const ctx = c.getContext('2d')!;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const len = horiz ? this.width : this.height;
      ctx.fillStyle = '#2b2d31'; ctx.fillRect(0, 0, horiz ? len : RULER, horiz ? RULER : len);
      ctx.fillStyle = '#3a3c42'; horiz ? ctx.fillRect(0, RULER - 1, len, 1) : ctx.fillRect(RULER - 1, 0, 1, len);
      if (!d) continue;
      const zoom = d.view.zoom, pan = horiz ? d.view.panX : d.view.panY;
      const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
      const step = nice.find(s => s * zoom >= 60) ?? 10000;
      const minor = step / (step % 5 === 0 ? 5 : step % 2 === 0 ? 2 : 1);
      ctx.strokeStyle = '#80838a'; ctx.fillStyle = '#a9acb3'; ctx.font = '9px system-ui, sans-serif'; ctx.lineWidth = 1;
      ctx.beginPath();
      const start = Math.floor(-pan / zoom / minor) * minor, end = (len - pan) / zoom;
      for (let v = start; v <= end; v += minor) {
        const p = Math.round(pan + v * zoom) + .5;
        const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
        const tl = major ? RULER : 5;
        if (horiz) { ctx.moveTo(p, RULER); ctx.lineTo(p, RULER - tl); }
        else { ctx.moveTo(RULER, p); ctx.lineTo(RULER - tl, p); }
        if (major) {
          const label = String(Math.round(v));
          if (horiz) ctx.fillText(label, p + 3, 9);
          else { ctx.save(); ctx.translate(9, p + 3); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(label, 0, 0); ctx.restore(); }
        }
      }
      ctx.stroke();
      if (this.mouse) {
        const p = Math.round(pan + (horiz ? this.mouse.x : this.mouse.y) * zoom) + .5;
        ctx.strokeStyle = '#4ea1ff'; ctx.beginPath();
        if (horiz) { ctx.moveTo(p, 0); ctx.lineTo(p, RULER); } else { ctx.moveTo(0, p); ctx.lineTo(RULER, p); }
        ctx.stroke();
      }
    }
  }

  // ---- Eventos --------------------------------------------------------
  private makeEvent(e: PointerEvent): ToolEvent {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const p = this.toDoc(sx, sy);
    return {
      x: p.x, y: p.y, sx, sy, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey,
      pressure: e.pointerType === 'pen' ? (e.pressure || 0.5) : 1, pointerType: e.pointerType, button: e.button, detail: e.detail,
    };
  }

  isSpaceDown() { return this.spaceDown; }

  private guideAt(sx: number, sy: number): { axis: 'h' | 'v'; index: number } | null {
    const d = this.doc; if (!d || !app.showGuides) return null;
    const v = d.view;
    for (let i = 0; i < d.guides.v.length; i++) if (Math.abs(v.panX + d.guides.v[i] * v.zoom - sx) < 4) return { axis: 'v', index: i };
    for (let i = 0; i < d.guides.h.length; i++) if (Math.abs(v.panY + d.guides.h[i] * v.zoom - sy) < 4) return { axis: 'h', index: i };
    return null;
  }

  private updateCursor(e?: ToolEvent) {
    let cur = app.tool?.cursor ?? 'default';
    if (this.spaceDown || this.panning) cur = this.panning ? 'grabbing' : 'grab';
    else if (e && app.tool?.id === 'move') {
      const g = this.guideAt(e.sx, e.sy);
      if (g) cur = g.axis === 'v' ? 'ew-resize' : 'ns-resize';
    }
    if (this.canvas.style.cursor !== cur) this.canvas.style.cursor = cur;
  }

  private bindEvents() {
    const cv = this.canvas;
    cv.addEventListener('contextmenu', e => e.preventDefault());

    cv.addEventListener('pointerdown', e => {
      if (!this.doc) return;
      (document.activeElement as HTMLElement | null)?.blur?.();
      try { cv.setPointerCapture(e.pointerId); } catch { /* puntero sintético */ }
      const r = cv.getBoundingClientRect();
      this.pointers.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
      if (this.pointers.size === 2 && e.pointerType === 'touch') {
        // Gesto de pellizco: cancela el trazo en curso.
        if (this.toolActive) { this.toolActive = false; app.tool?.cancel?.(); }
        this.startPinch(); return;
      }
      const te = this.makeEvent(e);
      // Los eventos de puntero no indican doble clic: se detecta por tiempo y distancia
      const now = performance.now(), lc = this.lastClick;
      te.detail = lc && now - lc.t < 400 && Math.hypot(te.sx - lc.x, te.sy - lc.y) < 6 ? lc.n + 1 : 1;
      this.lastClick = { t: now, x: te.sx, y: te.sy, n: te.detail };
      if (this.spaceDown || e.button === 1 || app.tool?.id === 'hand' && e.button === 0) {
        this.panning = { x: te.sx, y: te.sy, px: this.doc.view.panX, py: this.doc.view.panY };
        this.updateCursor(); return;
      }
      if (e.button !== 0 && e.button !== 2) return;
      if (app.tool?.id === 'move' && e.button === 0) {
        const g = this.guideAt(te.sx, te.sy);
        if (g) {
          const list = g.axis === 'v' ? this.doc.guides.v : this.doc.guides.h;
          this.guideDrag = { axis: g.axis, index: g.index, pos: list[g.index] };
          list.splice(g.index, 1);
          return;
        }
      }
      if (e.button === 2) return;
      this.toolActive = true;
      app.tool?.down?.(te);
      this.requestRender();
    });

    cv.addEventListener('pointermove', e => {
      if (!this.doc) return;
      const r = cv.getBoundingClientRect();
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
      if (this.pinch) { this.updatePinch(); return; }
      const te = this.makeEvent(e);
      this.mouse = { x: te.x, y: te.y }; this.mouseScreen = { x: te.sx, y: te.sy };
      app.emit('view');
      if (this.panning) {
        this.doc.view.panX = this.panning.px + te.sx - this.panning.x;
        this.doc.view.panY = this.panning.py + te.sy - this.panning.y;
        this.requestRender(); return;
      }
      if (this.guideDrag) {
        this.guideDrag.pos = Math.round(this.guideDrag.axis === 'v' ? te.x : te.y);
        this.requestRender(); return;
      }
      if (this.toolActive) {
        const evs = (e as any).getCoalescedEvents?.() as PointerEvent[] | undefined;
        if (evs && evs.length > 1) for (const ce of evs) app.tool?.move?.(this.makeEvent(ce));
        else app.tool?.move?.(te);
      } else app.tool?.hover?.(te);
      this.updateCursor(te);
      this.requestRender();
    });

    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; return; }
      if (!this.doc) return;
      if (this.panning) { this.panning = null; this.updateCursor(); return; }
      if (this.guideDrag) {
        const g = this.guideDrag; this.guideDrag = null;
        const te = this.makeEvent(e);
        const inside = te.sx >= 0 && te.sy >= 0 && te.sx < this.width && te.sy < this.height;
        if (inside) (g.axis === 'v' ? this.doc.guides.v : this.doc.guides.h).push(g.pos);
        this.requestRender(); return;
      }
      if (this.toolActive) {
        this.toolActive = false;
        app.tool?.up?.(this.makeEvent(e));
        this.requestRender();
      }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => { if (!this.toolActive) { this.mouse = null; this.mouseScreen = null; this.requestRender(); app.emit('view'); } });

    cv.addEventListener('wheel', e => {
      if (!this.doc) return;
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const at = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (e.ctrlKey || e.altKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025));
        this.setZoom(this.zoom * factor, at);
      } else {
        const k = e.deltaMode ? 30 : 1;
        const dx = e.shiftKey ? e.deltaY : e.deltaX, dy = e.shiftKey ? 0 : e.deltaY;
        this.doc.view.panX -= dx * k; this.doc.view.panY -= dy * k;
        this.requestRender();
      }
    }, { passive: false });

    // Arrastrar desde las reglas crea guías.
    const rulerDrag = (axis: 'h' | 'v') => (e: PointerEvent) => {
      if (!this.doc) return;
      e.preventDefault();
      const move = (ev: PointerEvent) => {
        const r = cv.getBoundingClientRect();
        const p = this.toDoc(ev.clientX - r.left, ev.clientY - r.top);
        this.guideDrag = { axis, index: -1, pos: Math.round(axis === 'v' ? p.x : p.y) };
        this.requestRender();
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        end(ev as PointerEvent);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
    this.rulerH.addEventListener('pointerdown', rulerDrag('h'));
    this.rulerV.addEventListener('pointerdown', rulerDrag('v'));

    window.addEventListener('keydown', e => {
      if (e.code === 'Space' && !isTyping()) {
        if (!this.spaceDown && !this.toolActive) { this.spaceDown = true; this.updateCursor(); }
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', e => { if (e.code === 'Space') { this.spaceDown = false; this.updateCursor(); } });
    window.addEventListener('blur', () => { this.spaceDown = false; });
  }

  private startPinch() {
    const [a, b] = [...this.pointers.values()];
    this.pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
      zoom: this.zoom, px: this.doc!.view.panX, py: this.doc!.view.panY,
    };
  }
  private updatePinch() {
    const p = this.pinch!, d = this.doc!;
    const [a, b] = [...this.pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const z = Math.min(64, Math.max(0.01, p.zoom * dist / p.dist));
    const docX = (p.cx - p.px) / p.zoom, docY = (p.cy - p.py) / p.zoom;
    d.view.zoom = z; d.view.panX = cx - docX * z; d.view.panY = cy - docY * z;
    app.emit('view'); this.requestRender();
  }
}

export function isTyping() {
  const a = document.activeElement as HTMLElement | null;
  if (!a) return false;
  const tag = a.tagName;
  return (tag === 'INPUT' && !['range', 'checkbox', 'button', 'radio', 'color'].includes((a as HTMLInputElement).type)) || tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable;
}
