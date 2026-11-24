// Historial (deshacer/rehacer). Cada paso guarda una "foto" del documento.
// Para no gastar memoria de más, una capa cuyos píxeles no han cambiado
// reutiliza la copia del paso anterior (solo se copian las capas tocadas).

import { cloneCanvas, makeCanvas } from './canvas';
import { Layer, GroupLayer, RasterLayer, TextLayer, ShapeLayer, SmartLayer, SmartSource, AdjustmentLayer, LayerMask, BlendMode, isParametric } from './layers';
import type { EditorDocument } from './document';

interface MaskSnap { /** copia entera (si la hay) */ canvas?: HTMLCanvasElement; ref: FrozenRef; enabled: boolean; full?: boolean; }
export interface LayerSnap {
  id: number; kind: Layer['kind']; name: string; visible: boolean; opacity: number;
  blendMode: BlendMode; locked: boolean; lockAlpha?: boolean; lockPos?: boolean; lockPixels?: boolean; fillOpacity?: number; link?: number | null; clip: boolean; label?: string | null;
  canvas?: HTMLCanvasElement; /** capa nueva vacía: no se guarda su lienzo */ blank?: boolean;
  /** Estado de los píxeles de la capa: copia entera o «estado anterior + parche» (ver FrozenRef). */ ref?: FrozenRef; mask?: MaskSnap | null; props?: any; smart?: SmartSource; styles?: string | null; adjust?: string;
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


// ---- Capas de píxeles: copia entera o parche sobre el estado anterior ----
// Un trazo solo cambia una zona: en vez de copiar la capa entera en cada paso (48 MB con una foto de 12 MP),
// se guarda el estado anterior más la zona cambiada. Al deshacer se reconstruye la capa (copia entera más
// los parches, como mucho MAX_DEPTH seguidos; después se vuelve a guardar una copia entera). Deshacer o rehacer
// un solo paso no reconstruye nada: pone el parche, o lo que había antes, sobre la capa actual.
export type FrozenRef =
  | { kind: 'full'; canvas: HTMLCanvasElement }
  | { kind: 'blank'; w: number; h: number }
  | { kind: 'patch'; base: FrozenRef; rect: { x: number; y: number; w: number; h: number }; patch: HTMLCanvasElement; w: number; h: number; depth: number; /** píxeles de antes en esa zona (para deshacer sin reconstruir) */ before?: HTMLCanvasElement };
const MAX_DEPTH = 40;
const refSize = (r: FrozenRef) => r.kind === 'full' ? { w: r.canvas.width, h: r.canvas.height } : { w: r.w, h: r.h };
/** Lienzo nuevo con el estado guardado. */
export function materialize(r: FrozenRef): HTMLCanvasElement {
  if (r.kind === 'full') return cloneCanvas(r.canvas);
  if (r.kind === 'blank') return makeCanvas(r.w, r.h);
  const c = materialize(r.base), x = c.getContext('2d')!;
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  x.clearRect(r.rect.x, r.rect.y, r.rect.w, r.rect.h); x.drawImage(r.patch, r.rect.x, r.rect.y); x.restore();
  return c;
}
function refCanvases(r: FrozenRef, out: Set<HTMLCanvasElement>) {
  for (let q: FrozenRef | null = r; q; q = q.kind === 'patch' ? q.base : null) { if (q.kind === 'full') out.add(q.canvas); else if (q.kind === 'patch') { out.add(q.patch); if (q.before) out.add(q.before); } }
}
/** Lo que se ha copiado de cada capa o máscara viva (versión y estado guardado). */
type PixelOwner = { canvas: HTMLCanvasElement; version: number; dirty: { x: number; y: number; w: number; h: number } | 'all' | null; pendingBefore: { rect: { x: number; y: number; w: number; h: number }; canvas: HTMLCanvasElement } | null };
const frozenL = new WeakMap<object, { version: number; ref: FrozenRef }>();
function freezeLayer(l: PixelOwner): FrozenRef {
  const f = frozenL.get(l), c = l.canvas;
  if (f && f.version === l.version) { l.dirty = null; return f.ref; }
  const dirty = l.dirty, before = l.pendingBefore; l.dirty = null; l.pendingBefore = null;
  let ref: FrozenRef;
  if (f && dirty && dirty !== 'all') {
    const sz = refSize(f.ref), depth = f.ref.kind === 'patch' ? f.ref.depth : 0;
    const x0 = Math.max(0, Math.floor(dirty.x)), y0 = Math.max(0, Math.floor(dirty.y)), x1 = Math.min(c.width, Math.ceil(dirty.x + dirty.w)), y1 = Math.min(c.height, Math.ceil(dirty.y + dirty.h));
    if (sz.w === c.width && sz.h === c.height && depth < MAX_DEPTH && x1 > x0 && y1 > y0 && (x1 - x0) * (y1 - y0) < c.width * c.height * 0.5) {
      const patch = makeCanvas(x1 - x0, y1 - y0); patch.getContext('2d')!.drawImage(c, -x0, -y0);
      ref = { kind: 'patch', base: f.ref, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, patch, w: c.width, h: c.height, depth: depth + 1 };
      // los píxeles de antes valen si cubren exactamente la zona del parche (un solo trazo desde la última copia)
      if (before && before.rect.x === x0 && before.rect.y === y0 && before.canvas.width === x1 - x0 && before.canvas.height === y1 - y0) ref.before = before.canvas;
    } else ref = { kind: 'full', canvas: cloneCanvas(c) };
  } else ref = { kind: 'full', canvas: cloneCanvas(c) };
  frozenL.set(l, { version: l.version, ref });
  return ref;
}

function snapLayer(l: Layer): LayerSnap {
  const s: LayerSnap = {
    id: l.id, kind: l.kind, name: l.name, visible: l.visible, opacity: l.opacity,
    blendMode: l.blendMode, locked: l.locked, lockAlpha: l.lockAlpha, lockPos: l.lockPos, lockPixels: l.lockPixels, fillOpacity: l.fillOpacity, link: l.link, clip: l.clip, label: l.label,
    mask: l.mask ? (() => { const ref = freezeLayer(l.mask!); return { ref, canvas: ref.kind === 'full' ? ref.canvas : undefined, enabled: l.mask!.enabled, full: l.mask!.isFull() }; })() : null,
  };
  s.styles = l.styles ? JSON.stringify(l.styles) : null;
  s.vmask = l.vmask ? JSON.stringify(l.vmask) : undefined;
  if (l instanceof AdjustmentLayer) s.adjust = JSON.stringify({ filterId: l.filterId, params: l.params });
  if (l instanceof GroupLayer) { s.children = l.children.map(snapLayer); s.expanded = l.expanded; s.artboard = l.artboard ? { ...l.artboard } : undefined; s.frame = l.frame; }
  else if (l instanceof RasterLayer) {
    if (l.isBlank()) { s.blank = true; const ref: FrozenRef = { kind: 'blank', w: l.canvas.width, h: l.canvas.height }; frozenL.set(l, { version: l.version, ref }); l.dirty = null; }
    else { s.ref = freezeLayer(l); if (s.ref.kind === 'full') s.canvas = s.ref.canvas; }
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
    const f = old instanceof RasterLayer ? frozenL.get(old) : undefined;
    const same = s.blank ? old instanceof RasterLayer && old.isBlank() && old.canvas.width === w && old.canvas.height === h
      : old instanceof RasterLayer && old.kind === s.kind && f && f.version === old.version && f.ref === s.ref
      && old.canvas.width === w && old.canvas.height === h
      && (!isParametric(old) || JSON.stringify(old.props) === JSON.stringify(s.props))
      && (!(old instanceof SmartLayer) || old.inner === s.smart);
    let r: RasterLayer;
    // deshacer o rehacer un solo paso de un trazo: basta con poner el parche (o lo de antes) sobre la capa actual
    const step = !same && !s.blank && s.ref && old instanceof RasterLayer && old.kind === s.kind && s.kind === 'raster' && f && f.version === old.version && old.canvas.width === w && old.canvas.height === h
      ? (s.ref.kind === 'patch' && s.ref.base === f.ref ? { rect: s.ref.rect, px: s.ref.patch } : f.ref.kind === 'patch' && f.ref.base === s.ref && f.ref.before ? { rect: f.ref.rect, px: f.ref.before } : null) : null;
    if (step) {
      r = old as RasterLayer;
      const x = r.canvas.getContext('2d')!;
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      x.clearRect(step.rect.x, step.rect.y, step.rect.w, step.rect.h); x.drawImage(step.px, step.rect.x, step.rect.y); x.restore();
      r.touch(); frozenL.set(r, { version: r.version, ref: s.ref! }); r.dirty = null;
    } else if (same) r = old as RasterLayer;
    else {
      r = s.kind === 'smart' ? new SmartLayer(s.name, w, h, s.smart!, s.props.m, s.props.filters ?? []) : s.kind === 'text' ? new TextLayer(s.name, w, h, JSON.parse(JSON.stringify(s.props))) : s.kind === 'shape' ? new ShapeLayer(s.name, w, h, JSON.parse(JSON.stringify(s.props))) : new RasterLayer(s.name, w, h);
      if (s.blank) { r.markBlank(); frozenL.set(r, { version: r.version, ref: { kind: 'blank', w: r.canvas.width, h: r.canvas.height } }); r.dirty = null; }
      else if (s.kind !== 'smart' && s.ref) { r.canvas = materialize(s.ref); frozenL.set(r, { version: r.version, ref: s.ref }); r.dirty = null; } // el objeto inteligente se redibuja desde su contenido actual
    }
    r.full = s.full ? { ...s.full, version: r.version } : null;
    l = r;
  }
  l.name = s.name; l.id = s.id; l.visible = s.visible; l.opacity = s.opacity; l.blendMode = s.blendMode; l.locked = s.locked; l.lockAlpha = !!s.lockAlpha; l.lockPos = !!s.lockPos; l.lockPixels = !!s.lockPixels; l.fillOpacity = s.fillOpacity ?? 1; l.link = s.link ?? null; l.clip = s.clip; l.label = s.label ?? null;
  l.styles = s.styles ? JSON.parse(s.styles) : null;
  l.vmask = s.vmask ? JSON.parse(s.vmask) : undefined;
  if (s.mask) {
    const om = old?.mask, fm = om ? frozenL.get(om) : undefined, sm = s.mask;
    const okSize = !!om && om.canvas.width === w && om.canvas.height === h;
    // un paso de un trazo en la máscara: se pone el parche (o lo de antes) sobre la máscara actual
    const mstep = om && fm && okSize && fm.version === om.version && fm.ref !== sm.ref
      ? (sm.ref.kind === 'patch' && sm.ref.base === fm.ref ? { rect: sm.ref.rect, px: sm.ref.patch } : fm.ref.kind === 'patch' && fm.ref.base === sm.ref && fm.ref.before ? { rect: fm.ref.rect, px: fm.ref.before } : null) : null;
    if (om && fm && okSize && fm.version === om.version && fm.ref === sm.ref) { om.enabled = sm.enabled; l.mask = om; }
    else if (om && mstep) {
      const x = om.canvas.getContext('2d')!;
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      x.clearRect(mstep.rect.x, mstep.rect.y, mstep.rect.w, mstep.rect.h); x.drawImage(mstep.px, mstep.rect.x, mstep.rect.y); x.restore();
      om.touch(); om.dirty = null; frozenL.set(om, { version: om.version, ref: sm.ref }); om.enabled = sm.enabled;
      if (sm.full) om.fullVersion = om.version;
      l.mask = om;
    }
    else {
      const m = new LayerMask(w, h, 'black');
      m.canvas = materialize(sm.ref); m.enabled = sm.enabled; m.dirty = null;
      frozenL.set(m, { version: m.version, ref: sm.ref });
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
  const walk = (l: LayerSnap) => { if (l.ref) refCanvases(l.ref, out); else if (l.canvas) out.add(l.canvas); if (l.mask) refCanvases(l.mask.ref, out); if (l.full) out.add(l.full.canvas); l.children?.forEach(walk); };
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
  /** Va al paso i. Devuelve la zona que ha cambiado si solo cambió un trazo (si no, null = todo). */
  goto(doc: EditorDocument, i: number): { x: number; y: number; w: number; h: number } | null {
    if (i < 0 || i >= this.steps.length || i === this.index) return null;
    const from = this.steps[this.index]?.snap;
    this.index = i;
    const to = this.steps[i].snap;
    restore(doc, to);
    return from ? onlyPatchBetween(from, to) : null;
  }
}

/** Lienzo de una capa (por id) dentro de un estado guardado, o null si no existía o no era de píxeles. */
export function layerCanvasIn(snap: DocSnap, id: number): HTMLCanvasElement | null {
  const find = (s: LayerSnap): LayerSnap | null => { if (s.id === id) return s; for (const c of s.children ?? []) { const r = find(c); if (r) return r; } return null; };
  const f = find(snap.root);
  // capa vacía (no se guardó su lienzo): uno transparente del tamaño del documento
  if (f?.blank) return makeCanvas(snap.width, snap.height);
  if (f?.ref && f.ref.kind !== 'full') return materialize(f.ref);
  return f?.canvas ?? null;
}

/** Si de un estado a otro solo cambian los píxeles de una capa por un parche (un trazo), la zona; si no, null. */
function onlyPatchBetween(a: DocSnap, b: DocSnap): { x: number; y: number; w: number; h: number } | null {
  if (a.width !== b.width || a.height !== b.height || a.selection !== b.selection || !!a.quickMask !== !!b.quickMask || a.paths !== b.paths || a.activePath !== b.activePath
    || a.ppi !== b.ppi || a.mode !== b.mode || (a.channels?.length ?? 0) !== (b.channels?.length ?? 0) || (a.channels ?? []).some((c, i) => c !== b.channels![i])) return null;
  let rect: { x: number; y: number; w: number; h: number } | null = null, diffs = 0;
  const KEYS: (keyof LayerSnap)[] = ['id', 'kind', 'name', 'visible', 'opacity', 'blendMode', 'locked', 'lockAlpha', 'lockPos', 'lockPixels', 'fillOpacity', 'link', 'clip', 'label', 'styles', 'vmask', 'adjust', 'smart', 'expanded', 'frame', 'blank'];
  const walk = (x: LayerSnap, y: LayerSnap): boolean => {
    for (const k of KEYS) if (x[k] !== y[k]) return false;
    if (JSON.stringify(x.props) !== JSON.stringify(y.props) || JSON.stringify(x.artboard) !== JSON.stringify(y.artboard)) return false;
    if (!!x.mask !== !!y.mask || (x.mask?.enabled ?? null) !== (y.mask?.enabled ?? null)) return false;
    if (x.mask && y.mask && x.mask.ref !== y.mask.ref) {
      const p = x.mask.ref, q = y.mask.ref;
      const r = q.kind === 'patch' && q.base === p ? q.rect : p.kind === 'patch' && p.base === q ? p.rect : null;
      if (!r || ++diffs > 1) return false;
      rect = { ...r };
    }
    if ((x.full?.canvas ?? null) !== (y.full?.canvas ?? null)) return false;
    if (x.ref !== y.ref) {
      const p = x.ref, q = y.ref;
      if (!p || !q) return false;
      const r = q.kind === 'patch' && q.base === p ? q.rect : p.kind === 'patch' && p.base === q ? p.rect : null;
      if (!r || ++diffs > 1) return false;
      rect = { ...r };
    } else if (x.canvas !== y.canvas) return false;
    const xc = x.children ?? [], yc = y.children ?? [];
    if (xc.length !== yc.length) return false;
    for (let i = 0; i < xc.length; i++) if (!walk(xc[i], yc[i])) return false;
    return true;
  };
  return walk(a.root, b.root) && rect ? rect : null;
}
