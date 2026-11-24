// Visor: muestra el documento con zoom y desplazamiento, reglas, guías,
// la selección ("hormigas en marcha") y lo que dibuje la herramienta activa.

import { setOnOutlineStale } from '../core/selection';
import { app } from './app';
import { prefs, savePrefs, pxPerUnit, UNIT_NAMES, penPressure } from './prefs';
import type { ToolEvent } from '../tools/tool';
import { h } from './dom';
import { drawSnap } from '../tools/snap';
import { GroupLayer, tracePath } from '../core/layers';

/** Móvil con poca memoria: se ahorra resolución de pantalla al dibujar el lienzo. */
const LOW_END = ((navigator as any).deviceMemory ?? 8) <= 3 || (navigator.hardwareConcurrency ?? 8) <= 2;
/** ¿El navegador dibuja sin tarjeta gráfica (emulación por software)? Pasa en tabletas baratas con la gráfica
 *  bloqueada: entonces cada píxel de pantalla cuesta mucho y conviene dibujar el lienzo con menos densidad. */
const SOFTWARE_GFX = (() => {
  try {
    const k = 'editor.gfx', saved = sessionStorage.getItem(k); if (saved) return saved === 'sw';
    const gl = document.createElement('canvas').getContext('webgl'); let sw = !gl;
    if (gl) { const ext = gl.getExtension('WEBGL_debug_renderer_info'); const ren = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''; sw = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(ren); gl.getExtension('WEBGL_lose_context')?.loseContext(); }
    sessionStorage.setItem(k, sw ? 'sw' : 'hw'); return sw;
  } catch { return false; }
})();
/** Densidad máxima del lienzo en pantalla (se puede forzar con localStorage «editor.dprCap» para pruebas). */
const DPR_CAP = (() => { try { const v = +(localStorage.getItem('editor.dprCap') || 0); if (v > 0) return v; } catch { /* */ } return SOFTWARE_GFX ? 1 : LOW_END ? 1.5 : 2; })();

const RULER = 20;

export class Viewport {
  el: HTMLElement;
  canvas: HTMLCanvasElement;
  rulerH: HTMLCanvasElement;
  rulerV: HTMLCanvasElement;
  private markH: HTMLElement; private markV: HTMLElement;
  private rulerKey = '';
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
  private pinch: { dist: number; cx: number; cy: number; zoom: number; ang: number; rot: number; rotating: boolean } | null = null;
  /** ¿Se ha usado un lápiz? Entonces (en modo automático) el dedo solo mueve la vista y el lápiz dibuja. */
  /** Puntos previstos por el navegador para el trazo en curso (coordenadas del documento), o null. */
  predicted: { x: number; y: number }[] | null = null;
  penSeen = (() => { try { return localStorage.getItem('editor.penSeen') === '1'; } catch { return false; } })();
  /** El usuario ha pedido que el dedo también dibuje aunque haya lápiz (botón del lienzo). */
  fingerDraw = false;
  private penDown = false;
  /** El trazo en curso lo empezó un dedo (si luego apoya el lápiz, era la palma: se anula). */
  private strokeTouch = false;
  /** Toque con varios dedos: si se sueltan enseguida sin moverse, 2 dedos = deshacer, 3 = rehacer. */
  private tap: { t: number; n: number; moved: boolean; pts: Map<number, { x: number; y: number }> } | null = null;
  /** Mantener pulsado con el dedo (en modo lápiz): cuentagotas. */
  private holdTimer = 0;
  private touchPick: { x: number; y: number; color: string } | null = null;
  /** Herramienta puesta por el lápiz (goma del lápiz). */
  private penSpring = false;
  private penPick = false
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
    // marcas de la posición del ratón en las reglas: elementos aparte que solo se mueven (no hay que redibujar las reglas)
    this.markH = h('div', { class: 'ruler-mark ruler-mark-h' }); this.markV = h('div', { class: 'ruler-mark ruler-mark-v' });
    this.el = h('div', { class: 'viewport' },
      h('div', { class: 'ruler-corner' }), this.rulerH, this.rulerV,
      h('div', { class: 'view-wrap' }, this.canvas), this.markH, this.markV);
    parent.append(this.el);
    // opaco (el fondo se pinta siempre): el navegador no tiene que mezclarlo con lo de detrás; «baja latencia»
    // (opcional) dibuja directamente en pantalla, sin esperar al resto de la página
    this.ctx = (this.canvas.getContext('2d', { alpha: false, desynchronized: !!prefs.lowLatency }) ?? this.canvas.getContext('2d'))!;
    setOnOutlineStale(() => this.requestRender());
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
  // con la vista volteada (espejo), la x del documento cambia de signo antes del zum y el giro
  toDoc(sx: number, sy: number) {
    const v = this.doc!.view, r = v.rot ?? 0, f = v.flip ? -1 : 1;
    const dx = sx - v.panX, dy = sy - v.panY;
    if (!r) return { x: f * dx / v.zoom, y: dy / v.zoom };
    const c = Math.cos(-r), s = Math.sin(-r);
    return { x: f * (dx * c - dy * s) / v.zoom, y: (dx * s + dy * c) / v.zoom };
  }
  toScreen(x: number, y: number) {
    const v = this.doc!.view, r = v.rot ?? 0;
    if (v.flip) x = -x;
    if (!r) return { x: x * v.zoom + v.panX, y: y * v.zoom + v.panY };
    const c = Math.cos(r), s = Math.sin(r), X = x * v.zoom, Y = y * v.zoom;
    return { x: X * c - Y * s + v.panX, y: X * s + Y * c + v.panY };
  }
  get rot() { return this.doc?.view.rot ?? 0; }
  /** Aplica al contexto la transformación documento → pantalla (para dibujar en coordenadas del documento). */
  docTransform(ctx: CanvasRenderingContext2D) {
    const v = this.doc!.view, r = v.rot ?? 0, c = Math.cos(r) * v.zoom, s = Math.sin(r) * v.zoom;
    ctx.transform(c, s, -s, c, v.panX, v.panY);
    if (v.flip) ctx.scale(-1, 1);
  }
  /** Vista girada o volteada: los atajos de dibujo «alineado al píxel» y las reglas no valen. */
  get skewed() { const v = this.doc?.view; return !!v && (!!v.rot || !!v.flip); }
  /** Voltea la vista en horizontal (espejo) alrededor del centro de la pantalla; la imagen no cambia. */
  toggleFlip() {
    const d = this.doc; if (!d) return;
    const c = { x: this.width / 2, y: this.height / 2 }, dc = this.toDoc(c.x, c.y);
    d.view.flip = !d.view.flip;
    this.placeDocPoint(dc.x, dc.y, c);
    app.emit('view'); this.requestRender(); this.renderRulers?.();
  }
  /** Coloca el punto del documento (x, y) en el punto de pantalla p. */
  placeDocPoint(x: number, y: number, p: { x: number; y: number }) {
    const v = this.doc!.view, r = v.rot ?? 0, c = Math.cos(r), s = Math.sin(r), X = (v.flip ? -x : x) * v.zoom, Y = y * v.zoom;
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
    if (!this.skewed) { if (x0 === x1) { a.x = b.x = Math.round(a.x) + .5; } if (y0 === y1) { a.y = b.y = Math.round(a.y) + .5; } }
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
  private mip: { doc: object; canvas: HTMLCanvasElement; s: number; comp: HTMLCanvasElement; rough?: boolean } | null = null;
  /** Otros niveles de reducción ya calculados (al ampliar y reducir con los dedos se pasa por ellos una y otra vez). */
  private mipLevels = new Map<number, { doc: object; canvas: HTMLCanvasElement; comp: HTMLCanvasElement }>();
  private drawComposite(ctx: CanvasRenderingContext2D, comp: HTMLCanvasElement) {
    const d = this.doc!, eff = d.view.zoom * this.dpr;
    const changes = d.takeCompositeChanges();
    let s = 1; while (s / 2 >= eff && s > 1 / 32) s /= 2;
    if (s === 1 || comp.width * comp.height < 1.5e6) { this.mip = null; this.docImage(ctx, comp); return; }
    const W = Math.max(1, Math.ceil(comp.width * s)), H = Math.max(1, Math.ceil(comp.height * s));
    // si la imagen ha cambiado, los niveles guardados ya no valen (el actual se pone al día más abajo)
    if (changes) this.mipLevels.clear();
    if (this.mip && !this.mip.rough && this.mip.s !== s) {
      const old = this.mip; this.mipLevels.set(old.s, { doc: old.doc, canvas: old.canvas, comp: old.comp });
      const lv = this.mipLevels.get(s);
      if (lv && lv.doc === d && lv.comp === comp && lv.canvas.width === W && lv.canvas.height === H && !changes) { this.mip = { doc: d, canvas: lv.canvas, s, comp }; this.mipLevels.delete(s); }
      // no se guardan más de 4 niveles
      while (this.mipLevels.size > 4) this.mipLevels.delete(this.mipLevels.keys().next().value!);
    }
    let m = this.mip;
    const huge = changes && (changes === true || changes.w * changes.h > comp.width * comp.height / 3);
    if (!m || huge || m.rough && !this.toolActive || m.doc !== d || m.s !== s || m.comp !== comp || m.canvas.width !== W || m.canvas.height !== H) {
      if (huge && this.toolActive) {
        // mientras se arrastra algo que cambia toda la imagen (degradado, mover…): un solo paso, más rápido;
        // al soltar se rehace con calidad
        const n = m && m.canvas.width === W && m.canvas.height === H && m.rough ? m.canvas : document.createElement('canvas');
        n.width = W; n.height = H; const c = n.getContext('2d')!; c.imageSmoothingQuality = 'low'; c.drawImage(comp, 0, 0, W, H);
        m = this.mip = { doc: d, canvas: n, s, comp, rough: true };
      } else {
      // se reconstruye entera, reduciendo a la mitad en cada paso para que quede nítida
      let cur: HTMLCanvasElement = comp, k = 1;
      // se parte del nivel guardado más pequeño que aún sea mayor que el pedido (menos trabajo que desde la imagen entera)
      if (!changes) for (const [ls, lv] of this.mipLevels) if (ls > s && ls < k && lv.doc === d && lv.comp === comp) { cur = lv.canvas; k = ls; }
      while (k / 2 >= s) { k /= 2; const n = document.createElement('canvas'); n.width = Math.max(1, Math.ceil(comp.width * k)); n.height = Math.max(1, Math.ceil(comp.height * k)); const c = n.getContext('2d')!; c.imageSmoothingQuality = 'high'; c.drawImage(cur, 0, 0, n.width, n.height); cur = n; }
      m = this.mip = { doc: d, canvas: cur, s, comp };
      }
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
    this.rectCache = null;
    const wrap = this.canvas.parentElement!;
    // en pantallas muy densas (3×) se dibuja a 2×: se ve igual de nítido y es mucho más ligero;
    // en móviles con poca memoria (≤ 3 GB), a 1,5× (casi la mitad de píxeles por fotograma); sin gráfica, a 1×
    this.dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
    this.width = wrap.clientWidth; this.height = wrap.clientHeight;
    for (const [c, w, hh] of [[this.canvas, this.width, this.height], [this.rulerH, this.width, RULER], [this.rulerV, RULER, this.height]] as const) {
      c.width = Math.max(1, Math.round(w * this.dpr)); c.height = Math.max(1, Math.round(hh * this.dpr));
      c.style.width = w + 'px'; c.style.height = hh + 'px';
    }
    this.rulerKey = '';
    this.el.classList.toggle('no-rulers', !app.showRulers);
    if (this.doc && !this.doc.viewInitialized && this.width > 10) this.fit(true);
    this.render();
  }

  setRulers(show: boolean) { app.showRulers = show; this.el.classList.toggle('no-rulers', !show); requestAnimationFrame(() => this.resize()); }

  /** Rellenar pantalla: la imagen ocupa todo el área (puede quedar cortada por un lado). */
  fill() { const d = this.doc; if (!d || this.width < 10) return; this.setZoom(Math.max(this.width / d.width, this.height / d.height), null, true); }
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
      if (!this.skewed) { d.view.panX = Math.round(d.view.panX); d.view.panY = Math.round(d.view.panY); }
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

  private viewPending = false;
  emitViewSoon() {
    if (this.viewPending) return; this.viewPending = true;
    requestAnimationFrame(() => { this.viewPending = false; app.emit('view'); });
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
    const bgKey = `${zoom}|${d.view.panX}|${d.view.panY}|${rot}|${d.view.flip ? 1 : 0}|${this.width}|${this.height}|${this.dpr}|${bgColor}|${d.width}|${d.height}|${areas}`;
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

    // Imagen combinada (mientras se arrastra algo que cambia toda la imagen, una vista previa ya reducida)
    const eff = d.view.zoom * this.dpr; let ps = 1; while (ps / 2 >= eff && ps > 1 / 32) ps /= 2;
    const quick = this.toolActive && ps < 1 ? d.interactivePreview(ps) : null;
    ctx.save();
    this.areaPath(ctx); ctx.clip();
    ctx.imageSmoothingEnabled = zoom < 1 || (this.skewed && zoom < 4);
    ctx.imageSmoothingQuality = 'high';
    if (quick) { ctx.imageSmoothingQuality = 'low'; this.docTransform(ctx); ctx.drawImage(quick, 0, 0, quick.width / ps, quick.height / ps); }
    else this.drawComposite(ctx, d.getComposite());
    // papel cebolla: el cuadro anterior de la animación, en transparencia
    const onion = (app as any).onionCanvas?.(d) as HTMLCanvasElement | null;
    if (onion) { ctx.save(); ctx.globalAlpha = 0.3; this.docTransform(ctx); ctx.drawImage(onion, 0, 0); ctx.restore(); }
    ctx.restore();
    // vistas especiales: antes/después y simulación de daltonismo
    (app as any).drawCompare?.(ctx, this);
    (app as any).applyViewSim?.(ctx, this);
    (app as any).drawViewExtras?.(ctx, this);

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
        oc.drawImage(d.getComposite(), 0, 0); oc.globalCompositeOperation = 'destination-in'; oc.drawImage(rp.mask, 0, 0);
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
    if (app.tool?.id !== 'note' && !app.hideExtras) (app as any).drawNotes?.(ctx, this);
    app.tool?.drawOverlay?.(ctx, this);
    this.drawTouchPick(ctx);
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
    // marca del ratón: solo se mueve (barato); las reglas se redibujan solo si cambia el zum, el desplazamiento o el tamaño
    const m = d && this.mouse && !this.skewed ? { x: d.view.panX + this.mouse.x * d.view.zoom, y: d.view.panY + this.mouse.y * d.view.zoom } : null;
    this.markH.style.display = this.markV.style.display = m ? '' : 'none';
    if (m) { this.markH.style.transform = `translateX(${Math.round(m.x)}px)`; this.markV.style.transform = `translateY(${Math.round(m.y)}px)`; }
    const key = d ? [this.width, this.height, this.dpr, d.view.zoom, d.view.panX, d.view.panY, this.rot, d.view.flip ? 1 : 0, prefs.units, d.ppi, d.width, d.height, document.documentElement.dataset.theme ?? ''].join('|') : 'x' + this.width + 'x' + this.height;
    if (key === this.rulerKey) return;
    this.rulerKey = key;
    const css = getComputedStyle(document.body), cv = (n: string, f: string) => css.getPropertyValue(n).trim() || f;
    for (const horiz of [true, false]) {
      const c = horiz ? this.rulerH : this.rulerV;
      const ctx = c.getContext('2d')!;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const len = horiz ? this.width : this.height;
      ctx.fillStyle = cv('--panel', '#2b2d31'); ctx.fillRect(0, 0, horiz ? len : RULER, horiz ? RULER : len);
      ctx.fillStyle = cv('--border', '#3a3c42'); horiz ? ctx.fillRect(0, RULER - 1, len, 1) : ctx.fillRect(RULER - 1, 0, 1, len);
      if (!d || this.skewed) continue;
      const pan = horiz ? d.view.panX : d.view.panY;
      // en otras unidades se trabaja en «unidades» y se pasa a píxeles con el factor
      const ppu = pxPerUnit(prefs.units, d.ppi || 72, horiz ? d.width : d.height), zoom = d.view.zoom * ppu;
      const nice = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000].filter(s => prefs.units !== 'px' || s >= 1);
      const step = nice.find(s => s * zoom >= 60) ?? 10000;
      const mant = Math.round(step / Math.pow(10, Math.floor(Math.log10(step) + 1e-9)));
      const minor = step / (mant === 5 || mant === 1 ? 5 : mant === 2 ? 2 : 5);
      ctx.strokeStyle = cv('--ruler-tick', '#80838a'); ctx.fillStyle = cv('--ruler-text', '#a9acb3'); ctx.font = '9px system-ui, sans-serif'; ctx.lineWidth = 1;
      ctx.beginPath();
      const start = Math.floor(-pan / zoom / minor) * minor, end = (len - pan) / zoom;
      for (let k = 0, v = start; v <= end; k++, v = start + k * minor) {
        const p = Math.round(pan + v * zoom) + .5;
        const major = Math.abs(v / step - Math.round(v / step)) < 1e-4;
        const tl = major ? RULER : 5;
        if (horiz) { ctx.moveTo(p, RULER); ctx.lineTo(p, RULER - tl); }
        else { ctx.moveTo(RULER, p); ctx.lineTo(RULER - tl, p); }
        if (major) {
          const label = String(+v.toFixed(2)).replace('.', ',');
          if (horiz) ctx.fillText(label, p + 3, 9);
          else { ctx.save(); ctx.translate(9, p + 3); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(label, 0, 0); ctx.restore(); }
        }
      }
      ctx.stroke();
    }
  }

  // ---- Eventos --------------------------------------------------------
  /** Rectángulo del lienzo en la página, guardado: pedirlo en cada evento obliga al navegador a recalcular la
   *  maquetación si algo ha cambiado (y con el lápiz llegan cientos de eventos por segundo). Se renueva al tocar
   *  la pantalla, al cambiar de tamaño y al desplazarse la página. */
  private rectCache: DOMRect | null = null;
  canvasRect(fresh = false) { if (fresh || !this.rectCache) this.rectCache = this.canvas.getBoundingClientRect(); return this.rectCache; }
  private makeEvent(e: PointerEvent): ToolEvent {
    const r = this.canvasRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const p = this.toDoc(sx, sy);
    return {
      x: p.x, y: p.y, sx, sy, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey,
      pressure: e.pointerType === 'pen' ? penPressure(e.pressure || 0.5) : 1, pointerType: e.pointerType, button: e.button, detail: e.detail,
      ...(e.pointerType === 'pen' ? penTilt(e, this.rot) : {}),
    };
  }

  isSpaceDown() { return this.spaceDown; }
  /** ¿El dedo debe mover la vista en lugar de dibujar? (hay lápiz) */
  penMode() { return prefs.penOnly === 'on' || (prefs.penOnly === 'auto' && this.penSeen && !this.fingerDraw); }
  private notePen() {
    if (this.penSeen) return;
    this.penSeen = true; app.emit('pen');
    try { localStorage.setItem('editor.penSeen', '1'); } catch { /* se recuerda en este aparato */ }
    // si un dedo (o la palma) estaba pintando cuando llegó el lápiz, ese trazo se anula
    if (this.toolActive && this.strokeTouch && prefs.penOnly === 'auto' && !this.fingerDraw) this.cancelTouchStroke();
    if (prefs.penOnly === 'auto') app.toast('Lápiz detectado: ahora el lápiz dibuja y el dedo mueve, amplía y gira la vista (mantén el dedo para coger un color)');
  }
  /** Anula el trazo que empezó un dedo o la palma (al apoyar el lápiz). */
  private cancelTouchStroke() {
    this.toolActive = false; this.strokeTouch = false;
    app.tool?.cancel?.();
    for (const id of [...this.pointers.keys()]) if (id !== -1) this.pointers.delete(id);
    this.tap = null; this.requestRender();
  }
  /** Color que se está cogiendo con el dedo (para dibujar la lupa). */
  get touchPicking() { return this.touchPick; }
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
    cv.addEventListener('pointerenter', () => { this.rectCache = null; });
    for (const ev of ['resize', 'scroll']) window.addEventListener(ev, () => { this.rectCache = null; }, { passive: true, capture: true });

    cv.addEventListener('pointerdown', e => {
      if (!this.doc) return;
      this.canvasRect(true);
      const touch = e.pointerType === 'touch';
      if (e.pointerType === 'pen') { this.notePen(); this.penDown = true; if (this.toolActive && this.strokeTouch && this.penMode()) this.cancelTouchStroke(); }
      // rechazo de la palma: mientras el lápiz está apoyado, los toques no cuentan
      if (touch && this.penDown) return;
      // un contacto muy grande es la palma o el canto de la mano, no un dedo
      if (touch && (e.width > 48 || e.height > 48)) return;
      (document.activeElement as HTMLElement | null)?.blur?.();
      try { cv.setPointerCapture(e.pointerId); } catch { /* puntero sintético */ }
      const r = cv.getBoundingClientRect();
      const sp = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.pointers.set(e.pointerId, sp);
      if (touch) {
        const n = [...this.pointers.keys()].length;
        if (n === 1) this.tap = { t: performance.now(), n: 1, moved: false, pts: new Map([[e.pointerId, sp]]) };
        else if (this.tap) { this.tap.n = Math.max(this.tap.n, n); this.tap.pts.set(e.pointerId, sp); if (performance.now() - this.tap.t > 400) this.tap.moved = true; }
      }
      if (this.pointers.size >= 2 && touch) {
        // Gesto de pellizco: cancela el trazo en curso.
        clearTimeout(this.holdTimer); this.touchPick = null; this.panning = null;
        if (this.toolActive) { this.toolActive = false; app.tool?.cancel?.(); if (this.springMove) { this.springMove = false; app.restoreTool(); } }
        if (this.pointers.size === 2) this.startPinch();
        return;
      }
      const te = this.makeEvent(e);
      // con lápiz, un dedo mueve la vista (y mantenerlo quieto coge el color)
      if (touch && this.penMode()) {
        this.panning = { x: te.sx, y: te.sy, px: this.doc.view.panX, py: this.doc.view.panY };
        clearTimeout(this.holdTimer);
        if (typeof app.opt('size', app.tool?.id) === 'number' || app.tool?.id === 'eyedropper') this.holdTimer = window.setTimeout(() => {
          if (!this.panning || this.pointers.size !== 1) return;
          this.doc!.view.panX = this.panning.px; this.doc!.view.panY = this.panning.py; this.panning = null;
          this.pickTouch(te.sx, te.sy);
        }, 450);
        return;
      }
      // botón lateral del lápiz: cuentagotas con las herramientas de pintar
      if (e.pointerType === 'pen' && e.button === 2 && typeof app.opt('size', app.tool?.id) === 'number') { this.penPick = true; this.pickTouch(te.sx, te.sy); return; }
      // goma del lápiz (el otro extremo): borra mientras se use
      if (e.pointerType === 'pen' && (e.buttons & 32) && app.tool?.id !== 'eraser') { this.penSpring = true; app.setTool('eraser', true); }
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
      if (e.button !== 0 && e.button !== 2 && !this.penSpring) return;
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
        // Alt + Mayús + clic derecho: selector de color rápido junto al puntero
        if (e.altKey && e.shiftKey) { import('./artist').then(m => m.colorHud(e.clientX, e.clientY)); return; }
        if (e.altKey && typeof app.opt('size', t.id) === 'number') {
          this.brushResize = { sx: te.sx, sy: te.sy, size: app.opt<number>('size', t.id), hard: app.opt<number>('hardness', t.id) ?? null };
          return;
        }
        this.openContextMenu(e.clientX, e.clientY);
        return;
      }
      // Ctrl + arrastrar con casi cualquier herramienta: mover (y elegir la capa bajo el ratón)
      if (te.ctrl && !['move', 'transform', 'pen', 'node', 'text', 'hand', 'zoom', 'rotateView', 'crop'].includes(app.tool?.id)) { this.springMove = true; app.setTool('move', true); }
      this.toolActive = true; this.strokeTouch = touch;
      app.tool?.down?.(te);
      this.requestRender();
    });

    cv.addEventListener('pointermove', e => {
      if (!this.doc) return;
      const r = this.canvasRect();
      if (e.pointerType === 'pen') this.notePen();
      if (e.pointerType === 'touch' && !this.pointers.has(e.pointerId)) return;
      if (this.pointers.has(e.pointerId)) {
        const q = { x: e.clientX - r.left, y: e.clientY - r.top }; this.pointers.set(e.pointerId, q);
        const t0 = this.tap?.pts.get(e.pointerId); if (t0 && Math.hypot(q.x - t0.x, q.y - t0.y) > 12) this.tap!.moved = true;
      }
      if (this.pinch) { this.updatePinch(); return; }
      if (this.pointers.size > 1 && e.pointerType === 'touch') return;
      const te = this.makeEvent(e);
      if (this.touchPick || this.penPick) { if (this.pointers.has(e.pointerId)) this.pickTouch(te.sx, te.sy); return; }
      if (this.panning && e.pointerType === 'touch' && Math.hypot(te.sx - this.panning.x, te.sy - this.panning.y) > 8) clearTimeout(this.holdTimer);
      this.mouse = { x: te.x, y: te.y }; this.mouseScreen = { x: te.sx, y: te.sy };
      // la barra de estado, el panel Info y el navegador se actualizan como mucho una vez por fotograma,
      // y mientras se pinta no (cada cambio en la página cuesta tiempo al navegador); al soltar se ponen al día
      if (!this.toolActive) this.emitViewSoon();
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
        // predicción del navegador: hacia dónde va el lápiz en los próximos milisegundos; el pincel dibuja ahí un
        // trazo provisional (solo en pantalla) y así la línea va pegada a la punta
        const pr = e.pointerType !== 'mouse' ? (e as any).getPredictedEvents?.() as PointerEvent[] | undefined : undefined;
        this.predicted = pr?.length ? pr.slice(-3).map(pe => { const q = this.makeEvent(pe); return { x: q.x, y: q.y }; }) : null;
        const evs = (e as any).getCoalescedEvents?.() as PointerEvent[] | undefined;
        if (evs && evs.length > 1) for (const ce of evs) app.tool?.move?.(this.makeEvent(ce));
        else app.tool?.move?.(te);
      } else app.tool?.hover?.(te);
      this.updateCursor(te);
      this.requestRender();
    });

    const end = (e: PointerEvent) => {
      this.emitViewSoon(); this.predicted = null;
      if (e.pointerType === 'pen') this.penDown = false;
      const had = this.pointers.delete(e.pointerId);
      if (e.pointerType === 'touch') {
        if (!had) return;
        clearTimeout(this.holdTimer);
        if (!this.pointers.size && this.tap) {
          // toque rápido con 2 o 3 dedos: deshacer / rehacer
          const t = this.tap; this.tap = null;
          if (prefs.touchGestures && !t.moved && t.n >= 2 && performance.now() - t.t < 400) {
            import('./ops').then(o => { if (t.n === 2) { if (app.doc?.history.canUndo()) { o.undo(); app.toast('Deshacer (toque con 2 dedos)'); } } else if (app.doc?.history.canRedo()) { o.redo(); app.toast('Rehacer (toque con 3 dedos)'); } });
          }
        }
      }
      if (this.touchPick || this.penPick) { if (!this.pointers.size) { this.touchPick = null; this.penPick = false; this.requestRender(); } return; }
      if (this.pinch) { if (this.pointers.size < 2) { this.pinch = null; this.panning = null; } return; }
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
        if (this.penSpring) { this.penSpring = false; app.restoreTool(); }
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
      if (!this.doc || e.button !== 0) return;
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
    // clic derecho en una regla: elegir unidades
    for (const r of [this.rulerH, this.rulerV]) r.addEventListener('contextmenu', e => {
      e.preventDefault();
      document.querySelector('.units-menu')?.remove();
      const m = h('div', { class: 'flyout units-menu', style: { left: e.clientX + 'px', top: e.clientY + 'px' } },
        ...UNIT_NAMES.map(([u, n]) => h('div', { class: 'fly-item' + (prefs.units === u ? ' on' : ''), onclick: () => { prefs.units = u; savePrefs(); m.remove(); this.requestRender(); app.emit('view'); } }, (prefs.units === u ? '✓ ' : '\u2003 ') + n)));
      document.body.append(m);
      setTimeout(() => document.addEventListener('pointerdown', function close(ev) { if (!m.contains(ev.target as Node)) { m.remove(); document.removeEventListener('pointerdown', close); } }), 0);
    });
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
    this.pinch = { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), cx: dp.x, cy: dp.y, zoom: this.zoom, ang: Math.atan2(b.y - a.y, b.x - a.x), rot: this.rot, rotating: false };
  }
  private updatePinch() {
    const p = this.pinch!, d = this.doc!;
    const [a, b] = [...this.pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const z = Math.min(64, Math.max(0.01, p.zoom * dist / p.dist));
    d.view.zoom = z;
    if (prefs.pinchRotate) {
      // girar con dos dedos: empieza tras un pequeño giro (para no girar sin querer al ampliar) y se imanta a 0°, 90°…
      let da = Math.atan2(b.y - a.y, b.x - a.x) - p.ang; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (!p.rotating && Math.abs(da) > 0.2) { p.rotating = true; p.ang += da; da = 0; }
      if (p.rotating) {
        let r = p.rot + da; const q = Math.round(r / (Math.PI / 2)) * Math.PI / 2;
        if (Math.abs(r - q) < 0.07) r = q;
        r = Math.atan2(Math.sin(r), Math.cos(r)); d.view.rot = Math.abs(r) < 1e-6 ? 0 : r;
      }
    }
    this.placeDocPoint(p.cx, p.cy, { x: cx, y: cy });
    app.emit('view'); this.requestRender();
  }
  /** Coge el color bajo el dedo o el lápiz (y lo muestra en una lupa). */
  private pickTouch(sx: number, sy: number) {
    const p = this.toDoc(sx, sy), d = this.doc!, px = Math.floor(p.x), py = Math.floor(p.y);
    if (px >= 0 && py >= 0 && px < d.width && py < d.height) {
      const c = d.getComposite().getContext('2d')!.getImageData(px, py, 1, 1).data;
      if (c[3]) app.setColors('#' + [c[0], c[1], c[2]].map(v => v.toString(16).padStart(2, '0')).join(''), app.bg);
    }
    this.touchPick = { x: sx, y: sy, color: app.fg }; this.requestRender();
  }
  /** Lupa del cuentagotas táctil: un anillo con el color nuevo arriba y el de antes abajo. */
  drawTouchPick(ctx: CanvasRenderingContext2D) {
    const t = this.touchPick; if (!t) return;
    const y = t.y - 70 < 40 ? t.y + 70 : t.y - 70;
    ctx.save(); ctx.lineWidth = 14;
    ctx.strokeStyle = t.color; ctx.beginPath(); ctx.arc(t.x, y, 34, Math.PI, 0); ctx.stroke();
    ctx.strokeStyle = app.bg; ctx.beginPath(); ctx.arc(t.x, y, 34, 0, Math.PI); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.beginPath(); ctx.arc(t.x, y, 41.5, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(t.x, y, 26.5, 0, 7); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(t.x - 5, t.y); ctx.lineTo(t.x + 5, t.y); ctx.moveTo(t.x, t.y - 5); ctx.lineTo(t.x, t.y + 5); ctx.stroke();
    ctx.restore();
  }
}

export function isTyping() {
  const a = document.activeElement as HTMLElement | null;
  if (!a) return false;
  const tag = a.tagName;
  return (tag === 'INPUT' && !['range', 'checkbox', 'button', 'radio', 'color'].includes((a as HTMLInputElement).type)) || tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable;
}

/** Inclinación y dirección del lápiz (con altitudeAngle/azimuthAngle si el navegador los da, si no con tiltX/tiltY). */
function penTilt(e: PointerEvent, viewRot: number): { tilt: number; azimuth: number } {
  const ev = e as any;
  let alt: number, az: number;
  if (typeof ev.altitudeAngle === 'number' && typeof ev.azimuthAngle === 'number' && (ev.tiltX || ev.tiltY || ev.altitudeAngle !== Math.PI / 2)) { alt = ev.altitudeAngle; az = ev.azimuthAngle; }
  else {
    const tx = Math.tan((e.tiltX || 0) * Math.PI / 180), ty = Math.tan((e.tiltY || 0) * Math.PI / 180);
    alt = Math.atan2(1, Math.hypot(tx, ty)); az = Math.atan2(ty, tx);
  }
  return { tilt: Math.max(0, Math.min(1, 1 - alt / (Math.PI / 2))), azimuth: az - viewRot };
}
