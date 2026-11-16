// Historial (deshacer/rehacer). Cada paso guarda una "foto" del documento.
// Para no gastar memoria de más, una capa cuyos píxeles no han cambiado
// reutiliza la copia del paso anterior (solo se copian las capas tocadas).

import { cloneCanvas } from './canvas';
import { Layer, GroupLayer, RasterLayer, TextLayer, ShapeLayer, SmartLayer, SmartSource, AdjustmentLayer, LayerMask, BlendMode, isParametric } from './layers';
import type { EditorDocument } from './document';

interface MaskSnap { canvas: HTMLCanvasElement; enabled: boolean; }
export interface LayerSnap {
  id: number; kind: Layer['kind']; name: string; visible: boolean; opacity: number;
  blendMode: BlendMode; locked: boolean; clip: boolean;
  canvas?: HTMLCanvasElement; mask?: MaskSnap | null; props?: any; smart?: SmartSource; styles?: string | null; adjust?: string;
  full?: { canvas: HTMLCanvasElement; x: number; y: number } | null;
  children?: LayerSnap[]; expanded?: boolean;
}
export interface DocSnap {
  width: number; height: number; root: LayerSnap; activeId: number | null;
  selection: HTMLCanvasElement | null;
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
    blendMode: l.blendMode, locked: l.locked, clip: l.clip,
    mask: l.mask ? { canvas: freeze(l.mask, l.mask.version, l.mask.canvas), enabled: l.mask.enabled } : null,
  };
  s.styles = l.styles ? JSON.stringify(l.styles) : null;
  if (l instanceof AdjustmentLayer) s.adjust = JSON.stringify({ filterId: l.filterId, params: l.params });
  if (l instanceof GroupLayer) { s.children = l.children.map(snapLayer); s.expanded = l.expanded; }
  else if (l instanceof RasterLayer) {
    s.canvas = freeze(l, l.version, l.canvas);
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
    width: doc.width, height: doc.height, root: snapLayer(doc.root),
    activeId: doc.active?.id ?? null, selection: selCanvas,
  };
}

function restoreLayer(s: LayerSnap, w: number, h: number): Layer {
  let l: Layer;
  if (s.kind === 'group') {
    const g = new GroupLayer(s.name);
    g.expanded = s.expanded ?? true;
    for (const c of s.children ?? []) g.add(restoreLayer(c, w, h));
    l = g;
  } else if (s.kind === 'adjust') {
    const a = JSON.parse(s.adjust!);
    l = new AdjustmentLayer(s.name, a.filterId, a.params);
  } else {
    const r = s.kind === 'smart' ? new SmartLayer(s.name, w, h, s.smart!, s.props.m) : s.kind === 'text' ? new TextLayer(s.name, w, h, JSON.parse(JSON.stringify(s.props))) : s.kind === 'shape' ? new ShapeLayer(s.name, w, h, JSON.parse(JSON.stringify(s.props))) : new RasterLayer(s.name, w, h);
    if (s.kind !== 'smart') r.canvas = cloneCanvas(s.canvas!); // el objeto inteligente se redibuja desde su contenido actual
    if (s.full) r.full = { ...s.full, version: r.version };
    if (s.kind !== 'smart') frozen.set(r, { version: r.version, canvas: s.canvas! });
    l = r;
  }
  l.id = s.id; l.visible = s.visible; l.opacity = s.opacity; l.blendMode = s.blendMode; l.locked = s.locked; l.clip = s.clip;
  l.styles = s.styles ? JSON.parse(s.styles) : null;
  if (s.mask) {
    const m = new LayerMask(w, h, 'black');
    m.canvas = cloneCanvas(s.mask.canvas); m.enabled = s.mask.enabled;
    frozen.set(m, { version: m.version, canvas: s.mask.canvas });
    l.mask = m;
  }
  return l;
}

export function restore(doc: EditorDocument, snap: DocSnap) {
  doc.width = snap.width; doc.height = snap.height;
  const root = restoreLayer(snap.root, snap.width, snap.height) as GroupLayer;
  doc.root = root;
  doc.selection.width = snap.width; doc.selection.height = snap.height;
  doc.selection.setMask(snap.selection);
  if (snap.selection) selFrozen = { version: doc.selection.version, canvas: snap.selection, owner: doc.selection };
  // Se mantiene la capa que el usuario tenía seleccionada si sigue existiendo.
  const keepId = doc.active?.id ?? -1;
  const editMask = doc.editMask;
  doc.setActive(doc.findLayer(keepId) ?? doc.findLayer(snap.activeId ?? -1) ?? doc.allLayers().pop() ?? null, false);
  doc.editMask = editMask && !!doc.active?.mask;
}

export class History {
  steps: HistoryStep[] = [];
  index = -1;
  limit = 60;
  push(doc: EditorDocument, name: string) {
    this.steps.length = this.index + 1;
    this.steps.push({ name, snap: snapshot(doc) });
    if (this.steps.length > this.limit) this.steps.splice(1, 1); // conserva el estado inicial
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
