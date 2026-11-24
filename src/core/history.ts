// Historial (deshacer/rehacer). Cada paso guarda una "foto" del documento.
// Para no gastar memoria de más, una capa cuyos píxeles no han cambiado
// reutiliza la copia del paso anterior (solo se copian las capas tocadas).

import { cloneCanvas, makeCanvas } from './canvas';
import { Layer, GroupLayer, RasterLayer, TextLayer, ShapeLayer, SmartLayer, SmartSource, AdjustmentLayer, LayerMask, BlendMode, isParametric } from './layers';
import type { EditorDocument } from './document';

interface MaskSnap { canvas: HTMLCanvasElement; enabled: boolean; full?: boolean; }
export interface LayerSnap {
  id: number; kind: Layer['kind']; name: string; visible: boolean; opacity: number;
  blendMode: BlendMode; locked: boolean; lockAlpha?: boolean; lockPos?: boolean; lockPixels?: boolean; fillOpacity?: number; link?: number | null; clip: boolean; label?: string | null;
  canvas?: HTMLCanvasElement; /** capa nueva vacía: no se guarda su lienzo */ blank?: boolean; mask?: MaskSnap | null; props?: any; smart?: SmartSource; styles?: string | null; adjust?: string;
  full?: { canvas: HTMLCanvasElement; x: number; y: number } | null;
  children?: LayerSnap[]; expanded?: boolean; artboard?: any; vmask?: string; frame?: boolean;
}
export interface DocSnap {
  width: number; height: number; root: LayerSnap; activeId: number | null;
  selection: HTMLCanvasElement | null;
  quickMask?: boolean;
  channels?: { id: number; name: string; canvas: HTMLCanvasElement }[];
  paths?: string; activePath?: number; ppi?: number; mode?: 'rgb' | 'gray';
}
export interface HistoryStep { name: string; icon?: string; snap: DocSnap; }

// Copias congeladas asociadas a cada objeto vivo (capa o máscara).
const frozen = new WeakMap<object, { version: number; canvas: HTMLCanvasElement }>();
function freeze(owner: object, version: number, canvas: HTMLCanvasElement): HTMLCanvasElement {
  const f = frozen.get(owner);
  if (f && f.version === version) return f.canvas;
  const c = cloneCanvas(canvas);
  frozen.set(owner, { version, canvas: c });
  return c;
}

function snapLayer(l: Layer): LayerSnap {
  const s: LayerSnap = {
    id: l.id, kind: l.kind, name: l.name, visible: l.visible, opacity: l.opacity,
    blendMode: l.blendMode, locked: l.locked, lockAlpha: l.lockAlpha, lockPos: l.lockPos, lockPixels: l.lockPixels, fillOpacity: l.fillOpacity, link: l.link, clip: l.clip, label: l.label,
    mask: l.mask ? { canvas: freeze(l.mask, l.mask.version, l.mask.canvas), enabled: l.mask.enabled, full: l.mask.isFull() } : null,
  };
  s.styles = l.styles ? JSON.stringify(l.styles) : null;
  s.vmask = l.vmask ? JSON.stringify(l.vmask) : undefined;
  if (l instanceof AdjustmentLayer) s.adjust = JSON.stringify({ filterId: l.filterId, params: l.params });
  if (l instanceof GroupLayer) { s.children = l.children.map(snapLayer); s.expanded = l.expanded; s.artboard = l.artboard ? { ...l.artboard } : undefined; s.frame = l.frame; }
  else if (l instanceof RasterLayer) {
    if (l.isBlank()) s.blank = true; else s.canvas = freeze(l, l.version, l.canvas);
    if (isParametric(l)) s.props = JSON.parse(JSON.stringify(l.props)); // copia completa (los trazados tienen puntos anidados)
    if (l instanceof SmartLayer) s.smart = l.inner;
    const f = l.fullContent(); s.full = f.canvas !== l.canvas ? { canvas: f.canvas, x: f.x, y: f.y } : null;
  }
  return s;
}

let selFrozen: { version: number; canvas: HTMLCanvasElement | null; owner: object } | null = null;

export function snapshot(doc: EditorDocument): DocSnap {
  const sel = doc.selection;
  let selCanvas: HTMLCanvasElement | null = null;
  if (sel.mask) {
    if (selFrozen && selFrozen.owner === sel && selFrozen.version === sel.version) selCanvas = selFrozen.canvas;
    else { selCanvas = cloneCanvas(sel.mask); selFrozen = { version: sel.version, canvas: selCanvas, owner: sel }; }
  }
  return {
    width: doc.width, height: doc.height, ppi: doc.ppi, mode: doc.mode, root: snapLayer(doc.root),
    activeId: doc.active?.id ?? null, selection: selCanvas, quickMask: doc.quickMask, channels: doc.channels.slice(), paths: JSON.stringify(doc.paths), activePath: doc.activePath,
  };
}

/**
 * Reconstruye una capa desde la foto. Si la capa viva con el mismo id no ha
 * cambiado desde esa foto, se reutiliza tal cual (sin copiar píxeles): así
 * deshacer solo cuesta lo que realmente cambió.
 */
function restoreLayer(s: LayerSnap, w: number, h: number, olds: Map<number, Layer>): Layer {
  const old = olds.get(s.id);
  let l: Layer;
  if (s.kind === 'group') {
    const g = old instanceof GroupLayer ? old : new GroupLayer(s.name);
    g.children = [];
    g.expanded = s.expanded ?? true; g.artboard = s.artboard ? { ...s.artboard } : undefined; g.frame = s.frame;
    for (const c of s.children ?? []) g.add(restoreLayer(c, w, h, olds));
    l = g;
  } else if (s.kind === 'adjust') {
    const a = JSON.parse(s.adjust!);
    if (old instanceof AdjustmentLayer) { old.filterId = a.filterId; old.params = a.params; l = old; }
    else l = new AdjustmentLayer(s.name, a.filterId, a.params);
  } else {
    const f = old ? frozen.get(old) : undefined;
    const same = s.blank ? old instanceof RasterLayer && old.isBlank() && old.canvas.width === w && old.canvas.height === h
      : old instanceof RasterLayer && old.kind === s.kind && f && f.version === old.version && f.canvas === s.canvas
      && old.canvas.width === w && old.canvas.height === h
      && (!isParametric(old) || JSON.stringify(old.props) === JSON.stringify(s.props))
      && (!(old instanceof SmartLayer) || old.inner === s.smart);
    let r: RasterLayer;
    if (same) r = old as RasterLayer;
    else {
      r = s.kind === 'smart' ? new SmartLayer(s.name, w, h, s.smart!, s.props.m, s.props.filters ?? []) : s.kind === 'text' ? new TextLayer(s.name, w, h, JSON.parse(JSON.stringify(s.props))) : s.kind === 'shape' ? new ShapeLayer(s.name, w, h, JSON.parse(JSON.stringify(s.props))) : new RasterLayer(s.name, w, h);
      if (s.blank) r.markBlank();
      else if (s.kind !== 'smart') { r.canvas = cloneCanvas(s.canvas!); frozen.set(r, { version: r.version, canvas: s.canvas! }); } // el objeto inteligente se redibuja desde su contenido actual
    }
    r.full = s.full ? { ...s.full, version: r.version } : null;
    l = r;
  }
  l.name = s.name; l.id = s.id; l.visible = s.visible; l.opacity = s.opacity; l.blendMode = s.blendMode; l.locked = s.locked; l.lockAlpha = !!s.lockAlpha; l.lockPos = !!s.lockPos; l.lockPixels = !!s.lockPixels; l.fillOpacity = s.fillOpacity ?? 1; l.link = s.link ?? null; l.clip = s.clip; l.label = s.label ?? null;
  l.styles = s.styles ? JSON.parse(s.styles) : null;
  l.vmask = s.vmask ? JSON.parse(s.vmask) : undefined;
  if (s.mask) {
    const om = old?.mask, fm = om ? frozen.get(om) : undefined;
    if (om && fm && fm.version === om.version && fm.canvas === s.mask.canvas && om.canvas.width === w && om.canvas.height === h) { om.enabled = s.mask.enabled; l.mask = om; }
    else {
      const m = new LayerMask(w, h, 'black');
      m.canvas = cloneCanvas(s.mask.canvas); m.enabled = s.mask.enabled;
      frozen.set(m, { version: m.version, canvas: s.mask.canvas });
      if (s.mask.full) m.fullVersion = m.version;
      l.mask = m;
    }
  } else l.mask = null;
  return l;
}
export function restore(doc: EditorDocument, snap: DocSnap) {
  doc.width = snap.width; doc.height = snap.height; if (snap.ppi) doc.ppi = snap.ppi; doc.mode = snap.mode ?? 'rgb';
  const olds = new Map<number, Layer>([[doc.root.id, doc.root], ...doc.allLayers().map(l => [l.id, l] as [number, Layer])]);
  const root = restoreLayer(snap.root, snap.width, snap.height, olds) as GroupLayer;
  doc.root = root;
  doc.selection.width = snap.width; doc.selection.height = snap.height;
  doc.selection.setMask(snap.selection);
  doc.quickMask = !!snap.quickMask; doc.quickPreview = null;
  doc.channels = (snap.channels ?? []).slice();
  doc.paths = snap.paths ? JSON.parse(snap.paths) : []; doc.activePath = Math.min(snap.activePath ?? -1, doc.paths.length - 1);
  if (snap.selection) selFrozen = { version: doc.selection.version, canvas: snap.selection, owner: doc.selection };
  // Se mantiene la capa que el usuario tenía seleccionada si sigue existiendo.
  const keepId = doc.active?.id ?? -1;
  const editMask = doc.editMask;
  doc.setActive(doc.findLayer(keepId) ?? doc.findLayer(snap.activeId ?? -1) ?? doc.allLayers().pop() ?? null, false);
  doc.editMask = editMask && !!doc.active?.mask;
}

/** Número máximo de pasos del historial (configurable en Preferencias). */
export const historyConfig = { limit: 60 };

/** Memoria máxima del historial (MB): según la memoria del aparato. Cada paso guarda copias de las capas
 *  que cambian; con fotos grandes, sin límite, el navegador se queda sin memoria y todo va a tirones. */
export function historyBudgetMB(): number {
  const dm = (navigator as any).deviceMemory as number | undefined, mobile = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  if (dm) return Math.max(160, Math.min(1024, dm * (mobile ? 64 : 112)));
  return mobile ? 256 : 640;
}
/** Bytes de las copias distintas de una lista de pasos (las copias compartidas cuentan una vez). */
function stepCanvases(snap: DocSnap, out: Set<HTMLCanvasElement>) {
  const walk = (l: LayerSnap) => { if (l.canvas) out.add(l.canvas); if (l.mask) out.add(l.mask.canvas); if (l.full) out.add(l.full.canvas); l.children?.forEach(walk); };
  walk(snap.root); if (snap.selection) out.add(snap.selection); snap.channels?.forEach(c => out.add(c.canvas));
}
const bytesOf = (set: Set<HTMLCanvasElement>) => { let b = 0; for (const c of set) b += c.width * c.height * 4; return b; };
let warned = false;

export class History {
  steps: HistoryStep[] = [];
  index = -1;
  get limit() { return historyConfig.limit; }
  /** Aviso (una vez) cuando se recorta el historial por memoria. */
  static onTrim: ((n: number) => void) | null = null;
  /** Memoria que ocupa ahora el historial (MB). */
  memoryMB() { const set = new Set<HTMLCanvasElement>(); for (const st of this.steps) stepCanvases(st.snap, set); return bytesOf(set) / 1048576; }
  push(doc: EditorDocument, name: string) {
    this.steps.length = this.index + 1;
    this.steps.push({ name, snap: snapshot(doc) });
    if (this.steps.length > this.limit) this.steps.splice(1, 1); // conserva el estado inicial
    // límite de memoria: se olvidan los pasos más antiguos (siempre quedan el inicial y los 3 últimos)
    const budget = historyBudgetMB() * 1048576;
    let dropped = 0;
    while (this.steps.length > 4) {
      const set = new Set<HTMLCanvasElement>(); for (const st of this.steps) stepCanvases(st.snap, set);
      if (bytesOf(set) <= budget) break;
      this.steps.splice(1, 1); dropped++;
    }
    if (dropped && !warned) { warned = true; History.onTrim?.(this.steps.length); }
    this.index = this.steps.length - 1;
  }
  canUndo() { return this.index > 0; }
  canRedo() { return this.index < this.steps.length - 1; }
  goto(doc: EditorDocument, i: number) {
    if (i < 0 || i >= this.steps.length || i === this.index) return;
    this.index = i;
    restore(doc, this.steps[i].snap);
  }
}

/** Lienzo de una capa (por id) dentro de un estado guardado, o null si no existía o no era de píxeles. */
export function layerCanvasIn(snap: DocSnap, id: number): HTMLCanvasElement | null {
  const find = (s: LayerSnap): LayerSnap | null => { if (s.id === id) return s; for (const c of s.children ?? []) { const r = find(c); if (r) return r; } return null; };
  const f = find(snap.root);
  // capa vacía (no se guardó su lienzo): uno transparente del tamaño del documento
  if (f?.blank) return makeCanvas(snap.width, snap.height);
  return f?.canvas ?? null;
}
