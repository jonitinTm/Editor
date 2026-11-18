// Visor: muestra el documento con zoom y desplazamiento, reglas, guías,
// la selección ("hormigas en marcha") y lo que dibuje la herramienta activa.

import { app } from './app';
import { prefs } from './prefs';
import type { ToolEvent } from '../tools/tool';
import { h } from './dom';
import { drawSnap } from '../tools/snap';
import { GroupLayer, tracePath } from '../core/layers';

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
  private springMove = false;
  private brushResize: { sx: number; sy: number; size: number; hard: number | null } | null = null;

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
  // pantalla = giro(rot) · (documento · zoom) + pan
  toDoc(sx: number, sy: number) {
    const v = this.doc!.view, r = v.rot ?? 0;
    const dx = sx - v.panX, dy = sy - v.panY;
    if (!r) return { x: dx / v.zoom, y: dy / v.zoom };
    const c = Math.cos(-r), s = Math.sin(-r);
    return { x: (dx * c - dy * s) / v.zoom, y: (dx * s + dy * c) / v.zoom };
  }
  toScreen(x: number, y: number) {
    const v = this.doc!.view, r = v.rot ?? 0;
    if (!r) return { x: x * v.zoom + v.panX, y: y * v.zoom + v.panY };
    const c = Math.cos(r), s = Math.sin(r), X = x * v.zoom, Y = y * v.zoom;
    return { x: X * c - Y * s + v.panX, y: X * s + Y * c + v.panY };
  }
  get rot() { return this.doc?.view.rot ?? 0; }
  /** Aplica al contexto la transformación documento → pantalla (para dibujar en coordenadas del documento). */
  docTransform(ctx: CanvasRenderingContext2D) {
    const v = this.doc!.view, r = v.rot ?? 0, c = Math.cos(r) * v.zoom, s = Math.sin(r) * v.zoom;
    ctx.transform(c, s, -s, c, v.panX, v.panY);
  }
  /** Coloca el punto del documento (x, y) en el punto de pantalla p. */
  placeDocPoint(x: number, y: number, p: { x: number; y: number }) {
    const v = this.doc!.view, r = v.rot ?? 0, c = Math.cos(r), s = Math.sin(r), X = x * v.zoom, Y = y * v.zoom;
    v.panX = p.x - (X * c - Y * s); v.panY = p.y - (X * s + Y * c);
  }
  /** Gira la vista alrededor del centro de la pantalla (no cambia la imagen). */
  setRotation(rad: number) {
    const d = this.doc; if (!d) return;
    const c = { x: this.width / 2, y: this.height / 2 }, dc = this.toDoc(c.x, c.y);
    let r = rad % (Math.PI * 2); if (r > Math.PI) r -= Math.PI * 2; if (r < -Math.PI) r += Math.PI * 2;
    d.view.rot = Math.abs(r) < 1e-6 ? 0 : r;
    this.placeDocPoint(dc.x, dc.y, c);
    app.emit('view'); this.requestRender();
  }
  /** Polígono del documento en pantalla. */
  private docPath(ctx: CanvasRenderingContext2D, x = 0, y = 0, w = this.doc!.width, h = this.doc!.height, begin = true) {
    const q = [this.toScreen(x, y), this.toScreen(x + w, y), this.toScreen(x + w, y + h), this.toScreen(x, y + h)];
    if (begin) ctx.beginPath();
    q.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
  }
  /** Zona visible del documento: el lienzo entero o, con mesas de trabajo, solo ellas. */
  private areaPath(ctx: CanvasRenderingContext2D) {
    const boards = this.doc!.root.children.filter(g => (g as any).artboard && g.visible).map(g => (g as any).artboard);
    if (!boards.length) { this.docPath(ctx); return; }
    ctx.beginPath(); for (const a of boards) this.docPath(ctx, a.x, a.y, a.w, a.h, false);
  }
  /** Rectángulos de los nombres de las mesas de trabajo (en pantalla). */
  private boardLabels: { g: GroupLayer; x: number; y: number; w: number; h: number }[] = [];
  /** Línea entre dos puntos del documento; sin giro se alinea al píxel para que sea nítida. */
  private docLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
    const a = this.toScreen(x0, y0), b = this.toScreen(x1, y1);
    if (!this.rot) { if (x0 === x1) { a.x = b.x = Math.round(a.x) + .5; } if (y0 === y1) { a.y = b.y = Math.round(a.y) + .5; } }
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  /** Dibuja una imagen del tamaño del documento en su sitio. */
  private docImage(ctx: CanvasRenderingContext2D, img: CanvasImageSource) {
    ctx.save(); this.docTransform(ctx); ctx.drawImage(img, 0, 0); ctx.restore();
  }
  /** Copia reducida de la imagen combinada para cuando se ve alejada: dibujar la imagen grande
   *  reducida en cada fotograma es lo más caro; así solo se reduce la zona que cambia. */
  private mipTmp: HTMLCanvasElement | null = null;
  private bgCache: { key: string; canvas: HTMLCanvasElement } | null = null;
  private mip: { doc: object; canvas: HTMLCanvasElement; s: number; comp: HTMLCanvasElement } | null = null;
  private drawComposite(ctx: CanvasRenderingContext2D, comp: HTMLCanvasElement) {
    const d = this.doc!, eff = d.view.zoom * this.dpr;
    const changes = d.takeCompositeChanges();
    let s = 1; while (s / 2 >= eff && s > 1 / 32) s /= 2;
    if (s === 1 || comp.width * comp.height < 1.5e6) { this.mip = null; this.docImage(ctx, comp); return; }
    const W = Math.max(1, Math.ceil(comp.width * s)), H = Math.max(1, Math.ceil(comp.height * s));
    let m = this.mip;
    const huge = changes && (changes === true || changes.w * changes.h > comp.width * comp.height / 3);
    if (!m || huge || m.doc !== d || m.s !== s || m.comp !== comp || m.canvas.width !== W || m.canvas.height !== H) {
      // se reconstruye entera, reduciendo a la mitad en cada paso para que quede nítida
      let cur: HTMLCanvasElement = comp, k = 1;
      while (k / 2 >= s) { k /= 2; const n = document.createElement('canvas'); n.width = Math.max(1, Math.ceil(comp.width * k)); n.height = Math.max(1, Math.ceil(comp.height * k)); const c = n.getContext('2d')!; c.imageSmoothingQuality = 'high'; c.drawImage(cur, 0, 0, n.width, n.height); cur = n; }
      m = this.mip = { doc: d, canvas: cur, s, comp };
    } else if (changes) {
      const c = m.canvas.getContext('2d')!;
      const r = changes as { x: number; y: number; w: number; h: number };
      // zona en la copia reducida (alineada a píxeles enteros de la copia)
      const x0 = Math.max(0, Math.floor(r.x * s) - 1), y0 = Math.max(0, Math.floor(r.y * s) - 1);
      const x1 = Math.min(W, Math.ceil((r.x + r.w) * s) + 1), y1 = Math.min(H, Math.ceil((r.y + r.h) * s) + 1);
      if (x1 > x0 && y1 > y0) {
        c.save(); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'medium';
        c.clearRect(x0, y0, x1 - x0, y1 - y0);
        // se lee solo la zona cambiada: dibujar directamente desde la imagen grande recién
        // modificada obliga al navegador a copiarla entera en cada fotograma
        const sx = Math.floor(x0 / s), sy = Math.floor(y0 / s), sw = Math.min(comp.width - sx, Math.ceil((x1 - x0) / s)), sh = Math.min(comp.height - sy, Math.ceil((y1 - y0) / s));
        if (sw > 0 && sh > 0) {
          if (!this.mipTmp || this.mipTmp.width < sw || this.mipTmp.height < sh) { this.mipTmp = document.createElement('canvas'); this.mipTmp.width = Math.max(sw, 256); this.mipTmp.height = Math.max(sh, 256); }
          const t = this.mipTmp.getContext('2d', { willReadFrequently: false })!;
          t.putImageData(comp.getContext('2d')!.getImageData(sx, sy, sw, sh), 0, 0);
          c.drawImage(this.mipTmp, 0, 0, sw, sh, sx * s, sy * s, sw * s, sh * s);
        }
        c.restore();
      }
    }
    // la copia ya está prefiltrada: basta el suavizado normal (mucho más rápido que el de máxima calidad)
    ctx.save(); ctx.imageSmoothingQuality = 'low'; this.docTransform(ctx); ctx.drawImage(m.canvas, 0, 0, m.canvas.width / s, m.canvas.height / s); ctx.restore();
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
      this.placeDocPoint(d.width / 2, d.height / 2, { x: this.width / 2, y: this.height / 2 });
      if (!this.rot) { d.view.panX = Math.round(d.view.panX); d.view.panY = Math.round(d.view.panY); }
    } else {
      const p = at ?? { x: this.width / 2, y: this.height / 2 };
      const dp = this.toDoc(p.x, p.y);
      d.view.zoom = z;
      this.placeDocPoint(dp.x, dp.y, p);
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
    const bgColor = getComputedStyle(document.body).getPropertyValue('--canvas-bg') || '#1b1c1f';
    if (!d) { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, this.width, this.height); this.renderRulers(); return; }
    const { zoom } = d.view;
    const rot = this.rot;

    // Fondo, sombra y cuadrícula de transparencia: solo cambian al mover la vista, así que se
    // preparan una vez (la sombra difuminada es cara de pintar en cada fotograma)
    const areas = d.root.children.map(g => (g as any).artboard && g.visible ? `${(g as any).artboard.x},${(g as any).artboard.y},${(g as any).artboard.w},${(g as any).artboard.h}` : '').join('|');
    const bgKey = `${zoom}|${d.view.panX}|${d.view.panY}|${rot}|${this.width}|${this.height}|${this.dpr}|${bgColor}|${d.width}|${d.height}|${areas}`;
    if (!this.bgCache || this.bgCache.key !== bgKey) {
      const c = this.bgCache?.canvas ?? document.createElement('canvas');
      c.width = this.canvas.width; c.height = this.canvas.height;
      const b = c.getContext('2d')!; b.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      b.fillStyle = bgColor; b.fillRect(0, 0, this.width, this.height);
      b.save(); b.shadowColor = 'rgba(0,0,0,.5)'; b.shadowBlur = 12; b.fillStyle = '#fff'; this.areaPath(b); b.fill(); b.restore();
      b.save(); this.areaPath(b); b.clip(); b.fillStyle = this.checkerPattern(); b.fillRect(0, 0, this.width, this.height); b.restore();
      this.bgCache = { key: bgKey, canvas: c };
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.bgCache.canvas, 0, 0); ctx.restore();

    // Imagen combinada
    const comp = d.getComposite();
    ctx.save();
    this.areaPath(ctx); ctx.clip();
    ctx.imageSmoothingEnabled = zoom < 1 || (rot !== 0 && zoom < 4);
    ctx.imageSmoothingQuality = 'high';
    this.drawComposite(ctx, comp);
    ctx.restore();

    // Zona visible en coordenadas del documento
    const corners = [this.toDoc(0, 0), this.toDoc(this.width, 0), this.toDoc(this.width, this.height), this.toDoc(0, this.height)];
    const vx0 = Math.max(0, Math.floor(Math.min(...corners.map(c => c.x)))), vx1 = Math.min(d.width, Math.ceil(Math.max(...corners.map(c => c.x))));
    const vy0 = Math.max(0, Math.floor(Math.min(...corners.map(c => c.y)))), vy1 = Math.min(d.height, Math.ceil(Math.max(...corners.map(c => c.y))));

    // Cuadrícula de píxeles a mucho zoom
    if (zoom >= 12) {
      ctx.save(); ctx.strokeStyle = 'rgba(128,128,128,.25)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = vx0; x <= vx1; x++) this.docLine(ctx, x, vy0, x, vy1);
      for (let y = vy0; y <= vy1; y++) this.docLine(ctx, vx0, y, vx1, y);
      ctx.stroke(); ctx.restore();
    }

    // Cuadrícula
    if (app.showGrid && !app.hideExtras && (prefs.gridSize || app.gridSize) * zoom >= 6) {
      const g = prefs.gridSize || app.gridSize;
      ctx.save(); this.docPath(ctx); ctx.clip();
      ctx.strokeStyle = prefs.gridColor || '#787878'; ctx.globalAlpha = 0.6; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = Math.ceil(vx0 / g) * g; x <= vx1; x += g) this.docLine(ctx, x, vy0, x, vy1);
      for (let y = Math.ceil(vy0 / g) * g; y <= vy1; y += g) this.docLine(ctx, vx0, y, vx1, y);
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
        else { ctx.save(); this.docPath(ctx); ctx.clip(); ctx.fillStyle = this.checkerPattern(); ctx.fillRect(0, 0, this.width, this.height); ctx.restore(); }
      }
      ctx.save(); ctx.imageSmoothingEnabled = zoom < 1; this.docImage(ctx, ov); ctx.restore();
    }
    // Máscara rápida: lo no seleccionado se tiñe de rojo
    if (d.quickMask) {
      const qm = d.quickPreview ?? d.selection.mask;
      const ov = this.quickCanvas ??= document.createElement('canvas');
      if (ov.width !== d.width || ov.height !== d.height) { ov.width = d.width; ov.height = d.height; }
      const oc = ov.getContext('2d')!;
      oc.globalCompositeOperation = 'copy'; oc.fillStyle = 'rgba(255,0,0,.5)'; oc.fillRect(0, 0, d.width, d.height);
      if (qm) { oc.globalCompositeOperation = 'destination-out'; oc.drawImage(qm, 0, 0); }
      ctx.save(); ctx.imageSmoothingEnabled = zoom < 1; this.docImage(ctx, ov); ctx.restore();
    }

    // Selección
    const outline = d.quickMask || d.refinePreview || app.hideExtras ? null : d.selection.getOutline();
    if (outline) this.drawAnts(outline, (d as any).selectionOffset);

    // Guías
    if (app.showGuides && !app.hideExtras) {
      ctx.save(); ctx.strokeStyle = prefs.guideColor || '#19d3f0'; ctx.lineWidth = 1; ctx.beginPath();
      const far = 1e6;
      const list = [...d.guides.v.map(g => ['v', g] as const), ...d.guides.h.map(g => ['h', g] as const)];
      if (this.guideDrag) list.push([this.guideDrag.axis, this.guideDrag.pos]);
      for (const [axis, g] of list) axis === 'v' ? this.docLine(ctx, g, -far, g, far) : this.docLine(ctx, -far, g, far, g);
      ctx.stroke(); ctx.restore();
    }

    // Nombres de las mesas de trabajo (clic para seleccionarla)
    this.boardLabels = [];
    for (const g of d.root.children) {
      const a = (g as any).artboard; if (!a || !g.visible) continue;
      const p0 = this.toScreen(a.x, a.y), act = d.active === g || (d.active && g instanceof GroupLayer && g.children.includes(d.active));
      ctx.save(); ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = act ? '#5aa0ff' : getComputedStyle(document.body).getPropertyValue('--muted') || '#999';
      const tw = ctx.measureText(g.name).width; ctx.fillText(g.name, p0.x, p0.y - 4);
      this.boardLabels.push({ g: g as GroupLayer, x: p0.x, y: p0.y - 18, w: tw, h: 16 });
      if (act) { ctx.strokeStyle = '#5aa0ff'; ctx.lineWidth = 1; ctx.beginPath(); this.docPath(ctx, a.x, a.y, a.w, a.h); ctx.stroke(); }
      ctx.restore();
    }

    // Trazado activo del panel Trazados (la selección directa dibuja el suyo con puntos)
    const ap = d.paths[d.activePath];
    if (ap && app.tool?.id !== 'node') {
      ctx.save(); this.docTransform(ctx); ctx.beginPath(); for (const sp of ap.subpaths) tracePath(ctx, sp.pts, sp.closed);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.lineWidth = 1.5; ctx.strokeStyle = '#3d8bfd'; ctx.stroke(); ctx.restore();
    }

    // Capa superpuesta de la herramienta
    ctx.save();
    if (app.tool?.id !== 'colorSampler' && !app.hideExtras) (app as any).drawSamplers?.(ctx, this);
    app.tool?.drawOverlay?.(ctx, this);
    ctx.restore();
    drawSnap(ctx, this);
    this.renderRulers();
  }

  /** Dibuja un trazado en coordenadas del documento como línea discontinua animada. */
  drawAnts(path: Path2D, offset?: { x: number; y: number }) {
    const ctx = this.ctx, v = this.doc!.view;
    ctx.save();
    this.docTransform(ctx);
    if (offset) ctx.translate(offset.x, offset.y);
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
      const css = getComputedStyle(document.body), cv = (n: string, f: string) => css.getPropertyValue(n).trim() || f;
      ctx.fillStyle = cv('--panel', '#2b2d31'); ctx.fillRect(0, 0, horiz ? len : RULER, horiz ? RULER : len);
      ctx.fillStyle = cv('--border', '#3a3c42'); horiz ? ctx.fillRect(0, RULER - 1, len, 1) : ctx.fillRect(RULER - 1, 0, 1, len);
      if (!d || this.rot) continue;
      const zoom = d.view.zoom, pan = horiz ? d.view.panX : d.view.panY;
      const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
      const step = nice.find(s => s * zoom >= 60) ?? 10000;
      const minor = step / (step % 5 === 0 ? 5 : step % 2 === 0 ? 2 : 1);
      ctx.strokeStyle = cv('--ruler-tick', '#80838a'); ctx.fillStyle = cv('--ruler-text', '#a9acb3'); ctx.font = '9px system-ui, sans-serif'; ctx.lineWidth = 1;
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
  /** ¿Hay una operación con el ratón en curso? */
  isBusy() { return this.toolActive; }

  private guideAt(sx: number, sy: number): { axis: 'h' | 'v'; index: number } | null {
    const d = this.doc; if (!d || !app.showGuides) return null;
    const v = d.view;
    const p = this.toDoc(sx, sy);
    for (let i = 0; i < d.guides.v.length; i++) if (Math.abs(d.guides.v[i] - p.x) * v.zoom < 4) return { axis: 'v', index: i };
    for (let i = 0; i < d.guides.h.length; i++) if (Math.abs(d.guides.h[i] - p.y) * v.zoom < 4) return { axis: 'h', index: i };
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
      // clic en el nombre de una mesa de trabajo: la selecciona
      const lab = e.button === 0 && this.boardLabels.find(b => te.sx >= b.x && te.sx <= b.x + b.w && te.sy >= b.y && te.sy <= b.y + b.h);
      if (lab) { this.doc.setActive(lab.g); app.emit('doc'); this.requestRender(); return; }
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
      if (e.button === 2) {
        // Alt + clic derecho y arrastrar: tamaño (horizontal) y dureza (vertical) del pincel
        const t = app.tool;
        if (e.altKey && typeof app.opt('size', t.id) === 'number') {
          this.brushResize = { sx: te.sx, sy: te.sy, size: app.opt<number>('size', t.id), hard: app.opt<number>('hardness', t.id) ?? null };
          return;
        }
        this.openContextMenu(e.clientX, e.clientY);
        return;
      }
      // Ctrl + arrastrar con casi cualquier herramienta: mover (y elegir la capa bajo el ratón)
      if (te.ctrl && !['move', 'transform', 'pen', 'node', 'text', 'hand', 'zoom', 'rotateView', 'crop'].includes(app.tool?.id)) { this.springMove = true; app.setTool('move', true); }
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
      if (this.brushResize) {
        const b = this.brushResize, t = app.tool;
        app.setOpt(t.id, 'size', Math.max(1, Math.min(1000, Math.round(b.size + (te.sx - b.sx) * 2 / this.zoom))));
        if (b.hard !== null) app.setOpt(t.id, 'hardness', Math.max(0, Math.min(100, Math.round(b.hard - (te.sy - b.sy) * 0.5))));
        this.mouseScreen = { x: b.sx, y: b.sy };
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
      if (this.brushResize) { this.brushResize = null; app.saveOpts(); return; }
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
        if (this.springMove) { this.springMove = false; app.restoreTool(); }
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

  /** Menú del clic derecho: lo útil según haya selección y la herramienta activa. */
  private openContextMenu(x: number, y: number) {
    const d = this.doc!, t = app.tool;
    let extra: HTMLElement | undefined;
    if (typeof app.opt('size', t.id) === 'number') {
      // Ajustes rápidos del pincel, como en los editores profesionales
      const mk = (label: string, key: string, min: number, max: number) => {
        const v = h('input', { type: 'range', min: String(min), max: String(max), value: String(app.opt(key, t.id)) }), n = h('span', { class: 'cm-val' }, String(app.opt(key, t.id)));
        v.oninput = () => { app.setOpt(t.id, key, +v.value); n.textContent = v.value; };
        return h('div', { class: 'cm-slider' }, h('span', {}, label), v, n);
      };
      extra = h('div', { class: 'cm-brush' }, mk('Tamaño', 'size', 1, 500), app.opt('hardness', t.id) !== undefined ? mk('Dureza', 'hardness', 0, 100) : null);
    }
    const ids = d.selection.active
      ? ['deselect', 'invertSel', 'feather', 'refine', '-', 'layerViaCopy', 'layerViaCut', '-', 'freeTransform', 'skew', 'distort', 'perspective', 'warp', 'flipH', 'flipV', '-', 'fill', 'stroke', 'contentFill', '-', 'saveSel']
      : ['selectAll', '-', 'freeTransform', 'newLayer', 'dupLayer', 'mergeDown', '-', 'undo', 'redo'];
    import('./panels').then(m => m.contextMenu(x, y, ids, extra));
  }

  private startPinch() {
    const [a, b] = [...this.pointers.values()];
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, dp = this.toDoc(cx, cy);
    this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: dp.x, cy: dp.y, zoom: this.zoom, px: 0, py: 0 };
  }
  private updatePinch() {
    const p = this.pinch!, d = this.doc!;
    const [a, b] = [...this.pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const z = Math.min(64, Math.max(0.01, p.zoom * dist / p.dist));
    d.view.zoom = z; this.placeDocPoint(p.cx, p.cy, { x: cx, y: cy });
    app.emit('view'); this.requestRender();
  }
}

export function isTyping() {
  const a = document.activeElement as HTMLElement | null;
  if (!a) return false;
  const tag = a.tagName;
  return (tag === 'INPUT' && !['range', 'checkbox', 'button', 'radio', 'color'].includes((a as HTMLInputElement).type)) || tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable;
}
