// Estado global de la aplicación: documentos abiertos, herramienta activa,
// colores y opciones. Los componentes de la interfaz se suscriben a eventos.

import { EditorDocument } from '../core/document';
import type { Tool } from '../tools/tool';
import type { Viewport } from './viewport';

type EventName = 'docs' | 'doc' | 'tool' | 'colors' | 'view' | 'options' | 'brushes' | 'pen';

class App {
  docs: EditorDocument[] = [];
  doc: EditorDocument | null = null;
  tools = new Map<string, Tool>();
  tool!: Tool;
  /** Última herramienta usada de cada grupo de la barra. */
  groupChoice: Record<string, string> = {};
  fg = '#000000';
  bg = '#ffffff';
  opts: Record<string, Record<string, any>> = {};
  viewport!: Viewport;
  showRulers = true;
  showGuides = true;
  showGrid = false;
  /** Vista › Extras desactivado: no se dibujan selección, guías, cuadrícula ni muestras. */
  hideExtras = false;
  /** Ajuste magnético a guías, lienzo y capas. */
  snapOn = true;
  /** Separación de la cuadrícula en píxeles. */
  gridSize = 50;
  /** Herramienta a la que volver al terminar un modo temporal (p. ej. transformar). */
  private returnTool: string | null = null;
  private handlers = new Map<EventName, Set<() => void>>();
  private docUnsub: (() => void) | null = null;
  private pending = new Set<EventName>();
  private raf = 0;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem('editor.opts') || '{}');
      if (saved && typeof saved === 'object') this.opts = saved;
      const c = JSON.parse(localStorage.getItem('editor.colors') || 'null');
      if (c) { this.fg = c.fg; this.bg = c.bg; }
    } catch { /* sin almacenamiento disponible */ }
  }

  on(ev: EventName, fn: () => void): () => void {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev)!.add(fn);
    return () => { this.handlers.get(ev)?.delete(fn); };
  }
  /** Escucha que dura mientras exista la barra de opciones actual (se quita sola al redibujarla). */
  onBar(ev: EventName, fn: () => void) { this.barOffs.push(this.on(ev, fn)); }
  barOffs: (() => void)[] = [];
  clearBar() { this.barOffs.forEach(f => f()); this.barOffs = []; }
  /** Emite un evento; se agrupan en el siguiente fotograma para no repintar de más. */
  emit(ev: EventName) {
    this.pending.add(ev);
    if (!this.raf) this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const evs = [...this.pending]; this.pending.clear();
      for (const e of evs) this.handlers.get(e)?.forEach(f => f());
    });
  }

  registerTool(t: Tool) {
    this.tools.set(t.id, t);
    const o = (this.opts[t.id] ??= {});
    // valores guardados que no encajan con la opción (de una versión anterior o dañados): se usa el de serie
    for (const d of t.options ?? []) if (!(d.key in o) || !optValid(d, o[d.key])) o[d.key] = d.default;
  }

  setTool(id: string, temporary = false) {
    const t = this.tools.get(id);
    if (!t || t === this.tool) return;
    if (!temporary) this.returnTool = null;
    else this.returnTool = this.tool?.id ?? null;
    this.tool?.deactivate?.();
    this.tool = t;
    if (t.group) this.groupChoice[t.group] = t.id;
    t.activate?.();
    this.emit('tool');
    this.viewport?.requestRender();
  }
  /** Sale de un modo temporal y vuelve a la herramienta anterior. */
  restoreTool() {
    const id = this.returnTool ?? 'move';
    this.returnTool = null;
    this.setTool(id);
  }

  opt<T = any>(key: string, toolId = this.tool.id): T { return this.opts[toolId]?.[key]; }
  setOpt(toolId: string, key: string, value: any) {
    const d = this.tools.get(toolId)?.options?.find((x: any) => x.key === key);
    if (d && !optValid(d, value)) value = d.default;
    (this.opts[toolId] ??= {})[key] = value;
    this.saveOpts();
    this.emit('options');
  }
  saveOpts() { try { localStorage.setItem('editor.opts', JSON.stringify(this.opts)); } catch { /* */ } }

  setColors(fg = this.fg, bg = this.bg) {
    // en un documento en escala de grises los colores también lo son
    if (this.doc?.mode === 'gray') { const g = (hex: string) => { const n = parseInt(hex.slice(1, 7), 16); if (isNaN(n)) return hex; const v = Math.round((n >> 16 & 255) * 0.3 + (n >> 8 & 255) * 0.59 + (n & 255) * 0.11).toString(16).padStart(2, '0'); return '#' + v + v + v; }; fg = g(fg); bg = g(bg); }
    this.fg = fg; this.bg = bg;
    try { localStorage.setItem('editor.colors', JSON.stringify({ fg, bg })); } catch { /* */ }
    this.emit('colors');
  }

  addDocument(doc: EditorDocument, firstStep = 'Abrir') {
    if (doc.history.steps.length === 0) doc.history.push(doc, firstStep);
    doc.modified = false;
    this.docs.push(doc);
    this.setDocument(doc);
    this.emit('docs');
  }
  setDocument(doc: EditorDocument | null) {
    if (this.doc === doc) return;
    this.tool?.deactivate?.();
    this.docUnsub?.();
    this.doc = doc;
    this.docUnsub = doc ? doc.onChange(() => { this.emit('doc'); this.viewport?.requestRender(); }) as any : null;
    if (doc && !doc.viewInitialized) this.viewport?.fit(true);
    this.tool?.activate?.();
    this.emit('docs'); this.emit('doc'); this.emit('view');
    this.viewport?.requestRender();
  }
  closeDocument(doc: EditorDocument) {
    const i = this.docs.indexOf(doc);
    if (i < 0) return;
    this.docs.splice(i, 1);
    if (this.doc === doc) this.setDocument(this.docs[Math.min(i, this.docs.length - 1)] ?? null);
    this.emit('docs');
  }

  /** Notifica que el documento activo ha cambiado sin crear paso de historial. */
  touchDoc() { this.doc?.invalidate(); this.doc?.changed(); }

  toast(msg: string, kind: 'info' | 'warn' = 'info') {
    const box = document.getElementById('toasts');
    if (!box) return;
    // el mismo aviso repetido no se apila: se renueva el que ya hay; y como mucho se ven 4 a la vez
    for (const o of [...box.children] as HTMLElement[]) if (o.dataset.msg === msg) o.remove();
    while (box.children.length >= 4) box.firstElementChild!.remove();
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.dataset.msg = msg;
    t.textContent = msg;
    box.append(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3100);
  }
}

export const app = new App();
(window as any).editorApp = app; // útil para depurar desde la consola

/** ¿El valor sirve para esa opción? (mismo tipo que el de serie; los números, finitos) */
function optValid(d: any, v: any): boolean {
  if (d.default === undefined || d.default === null) return true;
  if (typeof v !== typeof d.default) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  return true;
}
