// Documento: tamaño, árbol de capas, selección, guías, historial y vista.

import { makeCanvas, ctx2d, Rect } from './canvas';
import { GroupLayer, Layer, RasterLayer, walkLayers, isRaster, isParametric , blendIfActive } from './layers';
import { Selection } from './selection';
import { History } from './history';
import { renderComposite, compositeGroup, LayerOverride } from './compositor';

export interface ViewState { zoom: number; panX: number; panY: number; /** Giro de la vista en radianes (no afecta a la imagen). */ rot?: number; }

export interface DocPath { name: string; subpaths: { closed: boolean; pts: import('./layers').PathPoint[] }[] }

export interface LayerComp { name: string; visibility: boolean; position: boolean; appearance: boolean; states: Record<number, { visible: boolean; x?: number; y?: number; opacity?: number; blendMode?: string; styles?: string | null }> }

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
  /** Instantáneas del historial (estados guardados a los que se puede volver). */
  snapshots: { name: string; snap: import('./history').DocSnap }[] = [];
  /** Canales alfa: selecciones guardadas (lienzos inmutables: se sustituyen, no se editan). */
  channels: { id: number; name: string; canvas: HTMLCanvasElement }[] = [];
  /** Trazados guardados (panel Trazados): cada uno puede tener varios subtrazados. */
  paths: DocPath[] = [];
  /** Composiciones de capas: variantes guardadas (visibilidad, posición y aspecto de cada capa). */
  layerComps: LayerComp[] = [];
  /** Sectores (zonas que se exportan cada una en su archivo, para la web). */
  slices: { x: number; y: number; w: number; h: number; name: string }[] = [];
  /** Resolución para imprimir (píxeles por pulgada). */
  ppi = 72;
  /** Información del archivo: datos de la cámara (solo lectura) y título, autor, copyright… (editables). */
  meta: { exif?: Record<string, string>; title?: string; author?: string; copyright?: string; description?: string; keywords?: string } = {};
  /** Modo de color: en «gris» se trabaja en escala de grises. */
  mode: 'rgb' | 'gray' = 'rgb';
  /** Trazado activo en el panel (-1 = ninguno). */
  activePath = -1;
  /** Máscara rápida: el pincel edita la selección, que se ve como una capa roja. */
  quickMask = false;
  quickPreview: HTMLCanvasElement | null = null;
  /** Vista previa de «Seleccionar y aplicar máscara». */
  refinePreview: { mask: HTMLCanvasElement; mode: 'overlay' | 'black' | 'white' | 'transparent' } | null = null;
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

  /** Zonas de la imagen combinada que han cambiado desde la última vez que la vista las pidió. */
  private viewChanges: Rect | true | null = true;
  takeCompositeChanges(): Rect | true | null { const c = this.viewChanges; this.viewChanges = null; return c; }
  private noteChange(r: Rect | null) {
    if (this.viewChanges === true) return;
    if (!r) { this.viewChanges = true; return; }
    const v = this.viewChanges;
    if (!v) { this.viewChanges = { ...r }; return; }
    const x = Math.min(v.x, r.x), y = Math.min(v.y, r.y);
    this.viewChanges = { x, y, w: Math.max(v.x + v.w, r.x + r.w) - x, h: Math.max(v.y + v.h, r.y + r.h) - y };
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
      const big = !rect || rect.w * rect.h > this.width * this.height / 4;
      if (!this.renderWithCache(rect, big)) renderComposite(this.root, this.composite, { overrides: this.overrides, rect });
      this.noteChange(rect);
      this.compositeDirty = null;
    }
    return this.composite;
  }

  // ---- Caché de interacción ----------------------------------------------------------
  // Mientras se mueve, transforma o pinta una sola capa, lo que hay debajo y encima no
  // cambia: se combina una vez y en cada fotograma solo se dibujan 3 imágenes.
  private icache: { key: string; layer: Layer; below: HTMLCanvasElement; above: HTMLCanvasElement } | null = null;

  private interactionLayer(): Layer | null {
    if (this.overrides.size !== 1) return null;
    const l = this.overrides.keys().next().value as Layer;
    if (l.parent !== this.root || l.kind === 'group' || l.clip) return null;
    const ch = this.root.children, i = ch.indexOf(l);
    if (i < 0 || ch[i + 1]?.clip) return null;
    const special = (x: Layer): boolean => blendIfActive(x.styles) || x.kind === 'adjust' || (x.blendMode !== 'source-over' && x.blendMode !== 'pass-through') || (x instanceof GroupLayer && x.children.some(special));
    for (let k = i + 1; k < ch.length; k++) {
      const a = ch[k];
      if (!a.visible) continue;
      if (blendIfActive(a.styles) || a.kind === 'adjust' || (a.blendMode !== 'source-over' && a.blendMode !== 'pass-through')) return null;
      if (a instanceof GroupLayer && a.blendMode === 'pass-through' && a.children.some(special)) return null;
    }
    return l;
  }
  private signature(skip: Layer): string {
    const sig = (x: Layer): string => x === skip ? 'X' : `${x.id}:${x.version}:${+x.visible}:${x.opacity}:${x.blendMode}:${+x.clip}:${x.mask ? x.mask.version + '' + +x.mask.enabled : ''}:${x.styles ? JSON.stringify(x.styles) : ''}:${x.kind === 'adjust' ? JSON.stringify((x as any).params) : ''}` + (x instanceof GroupLayer ? '(' + x.children.map(sig).join(',') + ')' : '');
    return `${this.width}x${this.height}|` + this.root.children.map(sig).join(',');
  }
  private renderWithCache(rect: Rect | null, allowBuild: boolean): boolean {
    const l = this.interactionLayer();
    if (!l) { this.icache = null; return false; }
    const key = this.signature(l);
    if (!this.icache || this.icache.layer !== l || this.icache.key !== key) {
      if (!allowBuild) return false;
      const ch = this.root.children, i = ch.indexOf(l);
      const below = makeCanvas(this.width, this.height), above = makeCanvas(this.width, this.height);
      renderComposite({ children: ch.slice(0, i) } as GroupLayer, below, {});
      renderComposite({ children: ch.slice(i + 1) } as GroupLayer, above, {});
      this.icache = { key, layer: l, below, above };
    }
    const c = this.icache, ctx = ctx2d(this.composite);
    ctx.save();
    if (rect) { ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip(); ctx.clearRect(rect.x, rect.y, rect.w, rect.h); }
    else ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(c.below, 0, 0);
    compositeGroup({ children: [l] } as GroupLayer, ctx, this.width, this.height, { overrides: this.overrides, rect });
    ctx.drawImage(c.above, 0, 0);
    ctx.restore();
    return true;
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
      const ab = (l as any).artboard; if (ab) { ab.x += dx; ab.y += dy; }
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
    this.channels = this.channels.map(c => { const m = makeCanvas(w, h); ctx2d(m).drawImage(c.canvas, dx, dy); return { ...c, canvas: m }; });
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
    this.channels = this.channels.map(c => ({ ...c, canvas: scale(c.canvas) }));
    this.width = w; this.height = h;
    this.selection.resize(w, h);
    this.guides.v = this.guides.v.map(g => g * sx);
    this.guides.h = this.guides.h.map(g => g * sy);
    this.invalidate();
  }
}
