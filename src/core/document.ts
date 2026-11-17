// Documento: tamaño, árbol de capas, selección, guías, historial y vista.

import { makeCanvas, ctx2d, Rect } from './canvas';
import { GroupLayer, Layer, RasterLayer, walkLayers, isRaster, isParametric } from './layers';
import { Selection } from './selection';
import { History } from './history';
import { renderComposite, LayerOverride } from './compositor';

export interface ViewState { zoom: number; panX: number; panY: number; }

export class EditorDocument {
  name: string;
  width: number;
  height: number;
  root = new GroupLayer('Raíz');
  active: Layer | null = null;
  /** Capas seleccionadas en el panel (además de la activa). */
  selectedIds = new Set<number>();
  /** true = el pincel pinta en la máscara de la capa activa. */
  editMask = false;
  selection: Selection;
  guides = { h: [] as number[], v: [] as number[] };
  history = new History();
  view: ViewState = { zoom: 1, panX: 0, panY: 0 };
  viewInitialized = false;
  overrides = new Map<Layer, LayerOverride>();
  /** Máscara rápida: el pincel edita la selección, que se ve como una capa roja. */
  quickMask = false;
  quickPreview: HTMLCanvasElement | null = null;
  /** Animación por cuadros: duración (ms) y capas visibles de cada cuadro. */
  frames: { delay: number; visible: number[] }[] = [];
  frameIndex = 0;
  /** true = es el contenido de un objeto inteligente (vive dentro de otro documento). */
  embedded = false;
  /** ¿Hay cambios sin guardar? */
  modified = false;
  composite: HTMLCanvasElement;
  private compositeDirty: Rect | null | true = true;
  private listeners = new Set<() => void>();

  constructor(name: string, width: number, height: number) {
    this.name = name;
    this.width = width; this.height = height;
    this.selection = new Selection(width, height);
    this.composite = makeCanvas(width, height);
  }

  // ---- Capas ----------------------------------------------------------
  allLayers(): Layer[] { return [...walkLayers(this.root)]; }
  findLayer(id: number): Layer | undefined { return this.allLayers().find(l => l.id === id); }
  activeRaster(): RasterLayer | null { return isRaster(this.active) ? this.active : null; }

  setActive(l: Layer | null, notify = true) {
    this.active = l;
    this.selectedIds = new Set(l ? [l.id] : []);
    if (!l?.mask) this.editMask = false;
    if (notify) this.changed();
  }

  newRasterLayer(name?: string): RasterLayer {
    const l = new RasterLayer(name ?? this.nextLayerName(), this.width, this.height);
    this.insertAboveActive(l);
    return l;
  }

  nextLayerName() {
    let n = 1;
    const names = new Set(this.allLayers().map(l => l.name));
    while (names.has(`Capa ${n}`)) n++;
    return `Capa ${n}`;
  }

  insertAboveActive(l: Layer) {
    const a = this.active;
    if (a instanceof GroupLayer && a.expanded) a.add(l);
    else if (a && a.parent) a.parent.add(l, a.parent.children.indexOf(a) + 1);
    else this.root.add(l);
    this.setActive(l, false);
  }

  // ---- Composición ----------------------------------------------------
  invalidate(rect?: Rect | null) {
    if (this.compositeDirty === true) return;
    if (!rect) { this.compositeDirty = true; return; }
    const d = this.compositeDirty;
    if (!d) this.compositeDirty = { ...rect };
    else {
      const x = Math.min(d.x, rect.x), y = Math.min(d.y, rect.y);
      this.compositeDirty = { x, y, w: Math.max(d.x + d.w, rect.x + rect.w) - x, h: Math.max(d.y + d.h, rect.y + rect.h) - y };
    }
  }

  /** Devuelve la imagen combinada actualizada. */
  getComposite(): HTMLCanvasElement {
    if (this.composite.width !== this.width || this.composite.height !== this.height) {
      this.composite = makeCanvas(this.width, this.height); this.compositeDirty = true;
    }
    if (this.compositeDirty) {
      const d = this.compositeDirty;
      const rect = d === true ? null : {
        x: Math.floor(d.x) - 1, y: Math.floor(d.y) - 1, w: Math.ceil(d.w) + 3, h: Math.ceil(d.h) + 3,
      };
      renderComposite(this.root, this.composite, { overrides: this.overrides, rect });
      this.compositeDirty = null;
    }
    return this.composite;
  }

  /** Imagen combinada sin previsualizaciones, en un lienzo nuevo. */
  flatten(): HTMLCanvasElement {
    const c = makeCanvas(this.width, this.height);
    renderComposite(this.root, c, {});
    return c;
  }

  // ---- Avisos / historial --------------------------------------------
  onChange(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed() { this.listeners.forEach(f => f()); }

  /** Registra un paso en el historial tras una modificación. */
  commit(name: string) {
    this.history.push(this, name);
    this.modified = true;
    this.invalidate();
    this.changed();
  }
  undo() { if (this.history.canUndo()) { this.history.goto(this, this.history.index - 1); this.afterRestore(); } }
  redo() { if (this.history.canRedo()) { this.history.goto(this, this.history.index + 1); this.afterRestore(); } }
  gotoHistory(i: number) { this.history.goto(this, i); this.afterRestore(); }
  private afterRestore() { this.overrides.clear(); this.modified = true; this.invalidate(); this.changed(); }

  /** Cambia el tamaño del lienzo desplazando el contenido (dx, dy). */
  resizeCanvas(w: number, h: number, dx: number, dy: number) {
    for (const l of this.allLayers()) {
      if (isParametric(l)) { const old = l.canvas; l.canvas = makeCanvas(w, h); if (l.props.keepPixels) ctx2d(l.canvas).drawImage(old, 0, 0); l.translate(dx, dy); }
      else if (isRaster(l)) { const f = l.fullContent(); l.placeFull(f.canvas, f.x + dx, f.y + dy, w, h); }
      if (l.mask) {
        const m = makeCanvas(w, h); const mc = ctx2d(m);
        mc.fillStyle = '#fff'; mc.fillRect(0, 0, w, h);
        mc.clearRect(dx, dy, this.width, this.height);
        mc.drawImage(l.mask.canvas, dx, dy);
        l.mask.canvas = m; l.mask.touch();
      }
    }
    this.width = w; this.height = h;
    this.selection.resize(w, h, dx, dy);
    this.guides.v = this.guides.v.map(g => g + dx);
    this.guides.h = this.guides.h.map(g => g + dy);
    this.invalidate();
  }

  /** Remuestrea todas las capas a un nuevo tamaño. */
  resample(w: number, h: number) {
    const sx = w / this.width, sy = h / this.height;
    const scale = (src: HTMLCanvasElement) => {
      const c = makeCanvas(w, h); const ctx = ctx2d(c);
      ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, w, h); return c;
    };
    for (const l of this.allLayers()) {
      if (isParametric(l)) { l.canvas = l.props.keepPixels ? scale(l.canvas) : makeCanvas(w, h); l.scale(sx, sy); }
      else if (isRaster(l)) { l.canvas = scale(l.canvas); l.touch(); }
      if (l.mask) { l.mask.canvas = scale(l.mask.canvas); l.mask.touch(); }
    }
    if (this.selection.mask) this.selection.setMask(scale(this.selection.mask));
    this.width = w; this.height = h;
    this.selection.resize(w, h);
    this.guides.v = this.guides.v.map(g => g * sx);
    this.guides.h = this.guides.h.map(g => g * sy);
    this.invalidate();
  }
}
