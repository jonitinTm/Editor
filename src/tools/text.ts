// Herramienta Texto: clic para escribir. Crea capas de texto editables.

import { applyRunStyle, shiftRuns, normalizeRuns, type RunStyle } from '../core/textruns';
import { app } from '../ui/app';
import { ctx2d } from '../core/canvas';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import type { Viewport } from '../ui/viewport';
import { TextLayer, walkLayers, hasStyles } from '../core/layers';

export const FONTS = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Georgia', 'Times New Roman', 'Garamond', 'Courier New', 'Consolas', 'Impact', 'Comic Sans MS', 'serif', 'sans-serif', 'monospace', 'cursive'];

export class TextTool implements Tool {
  id = 'text'; name = 'Texto'; icon = icon('text'); key = 'T'; group = 'text'; cursor = 'text';
  options = [
    { key: 'font', type: 'font', default: 'Arial' },
    { key: 'size', label: 'Tamaño', type: 'range', min: 4, max: 800, default: 48, unit: 'px' },
    { key: 'bold', label: 'Negrita', type: 'checkbox', default: false },
    { key: 'italic', label: 'Cursiva', type: 'checkbox', default: false },
    { key: 'align', label: 'Alinear', type: 'select', default: 'left', choices: [
      { value: 'left', label: 'Izquierda' }, { value: 'center', label: 'Centro' }, { value: 'right', label: 'Derecha' }, { value: 'justify', label: 'Justificar' }] },
    { key: 'tracking', label: 'Interletraje', type: 'range', min: -200, max: 1000, default: 0 },
    { key: 'leading', label: 'Interlineado', type: 'range', min: 50, max: 400, default: 120, unit: '%' },
    { key: 'underline', label: 'Subrayado', type: 'checkbox', default: false },
    { key: 'caps', label: 'Mayúsculas', type: 'checkbox', default: false },
  ] as any[];
  extraOptions(bar: HTMLElement) {
    const b = document.createElement('button'); b.className = 'btn icon-btn'; b.title = 'Deformar texto'; b.textContent = 'T͡';
    b.onclick = () => { const l = app.doc?.active; if (l instanceof TextLayer) import('../ui/dialogs').then(m => m.warpTextDialog(l)); else app.toast('Selecciona una capa de texto', 'warn'); };
    const cp = document.createElement('button'); cp.className = 'btn'; cp.title = 'Abrir los paneles Carácter y Párrafo (escala, línea base, sangrías, justificado…)'; cp.textContent = 'Carácter y párrafo';
    cp.onclick = () => import('../ui/actions').then(m => m.actionById.get('panel:Carácter')?.run());
    bar.append(b, cp);
  }
  /** Texto vertical (columnas de arriba abajo). */
  protected vertical = false;
  /** Clic: texto de punto. Arrastrar: caja de texto de párrafo. */
  private dragStart: { x: number; y: number } | null = null;
  private dragNow: { x: number; y: number } | null = null;
  private editing: { layer: TextLayer; isNew: boolean; before: string; area: HTMLTextAreaElement } | null = null;

  constructor() {
    app.on('options', () => this.syncFromOptions());
    app.on('colors', () => { if (this.editing) this.syncFromOptions(); });
    app.on('doc', () => { const l = app.doc?.active; if (app.tool === this && !this.editing && l instanceof TextLayer && l.id !== this.loaded) this.loadFrom(l); });
  }

  /** Capa de texto cuyos valores muestra la barra de opciones (sin estar editándola). */
  private loaded = -1; private loading = false;
  private prevOpts: ReturnType<TextTool['optsNow']> | null = null;
  private optsNow() { const o = (k: string) => app.opt<any>(k, this.id); return { font: o('font'), size: o('size'), bold: !!o('bold'), italic: !!o('italic'), underline: !!o('underline'), color: app.fg }; }
  private loadFrom(l: TextLayer) {
    this.loading = true;
    const p = l.props;
    app.setOpt(this.id, 'font', p.font); app.setOpt(this.id, 'size', Math.round(p.size * 10) / 10);
    app.setOpt(this.id, 'bold', p.bold); app.setOpt(this.id, 'italic', p.italic); app.setOpt(this.id, 'align', p.align);
    app.setOpt(this.id, 'tracking', p.tracking ?? 0); app.setOpt(this.id, 'leading', Math.round(p.lineHeight * 100)); app.setOpt(this.id, 'underline', !!p.underline); app.setOpt(this.id, 'caps', !!p.caps);
    this.loaded = l.id; this.loading = false;
  }
  activate() { const l = app.doc?.active; if (l instanceof TextLayer) this.loadFrom(l); }
  private syncFromOptions() {
    if (app.tool !== this || this.loading) return;
    if (!this.editing) {
      // Capa de texto seleccionada: lo que cambie en la barra se aplica a toda la capa
      const l = app.doc?.active;
      if (!(l instanceof TextLayer) || l.id !== this.loaded || l.isLocked()) return;
      const p = l.props, o = (k: string) => app.opt<any>(k, this.id);
      const next = { font: o('font'), size: o('size'), bold: o('bold'), italic: o('italic'), align: o('align'), tracking: o('tracking'), lineHeight: o('leading') / 100, underline: o('underline'), caps: o('caps') };
      let changed = false;
      for (const [k, v] of Object.entries(next)) {
        const cur = (p as any)[k] ?? (k === 'tracking' ? 0 : k === 'underline' || k === 'caps' ? false : undefined);
        if (v !== undefined && (k === 'size' ? Math.abs(v - cur) > 0.05 : k === 'lineHeight' ? Math.abs(v - cur) > 0.001 : v !== cur)) { (p as any)[k] = v; changed = true; }
      }
      if (changed) { l.render(); app.doc!.commit('Editar texto'); }
      return;
    }
    const p = this.editing.layer.props, area = this.editing.area;
    const now = this.optsNow(), prev = this.prevOpts ?? now; this.prevOpts = now;
    const a = area.selectionStart ?? 0, b = area.selectionEnd ?? 0;
    // qué ha cambiado (fuente, tamaño, negrita, cursiva, subrayado o color)
    const changed: RunStyle = {};
    if (now.font !== prev.font) changed.font = now.font;
    if (now.size !== prev.size) changed.size = now.size;
    if (now.bold !== prev.bold) changed.bold = now.bold;
    if (now.italic !== prev.italic) changed.italic = now.italic;
    if (now.underline !== prev.underline) changed.underline = now.underline;
    if (now.color !== prev.color) changed.color = now.color;
    if (b > a && Object.keys(changed).length) {
      // Hay texto seleccionado: el cambio solo afecta a esa parte
      p.runs = applyRunStyle(p.runs ?? [], a, b, changed, p.text.length);
      this.editing.layer.render(); app.touchDoc();
      setTimeout(() => { area.focus(); area.setSelectionRange(a, b); }, 0);
      return;
    }
    // Texto de punto (sin caja): al cambiar el tamaño, la línea base (donde se hizo clic)
    // se queda en su sitio, como en Photoshop; si no, el texto crecería hacia abajo y se movería
    if ('size' in changed && !p.boxWidth && !p.vertical && !p.onPath && !p.area?.length && prev.size > 0) p.y = Math.round(p.y + (prev.size - now.size) * 0.6);
    // Sin selección: se aplica a todo el texto (y deja de ser excepción en los trozos que lo tuvieran)
    if (p.runs?.length) { const keys = Object.keys(changed) as (keyof RunStyle)[]; p.runs = normalizeRuns(p.runs.map(r => { const c = { ...r }; for (const k of keys) delete (c as any)[k]; return c; }), p.text.length); }
    // solo lo que ha cambiado (el color, por ejemplo, avisa dos veces y no debe pisar nada la segunda)
    if (p.runs?.length) {
      if ('font' in changed) p.font = now.font; if ('size' in changed) p.size = now.size; if ('bold' in changed) p.bold = now.bold;
      if ('italic' in changed) p.italic = now.italic; if ('underline' in changed) p.underline = now.underline; if ('color' in changed) p.color = now.color;
    } else {
      p.font = app.opt('font', this.id); p.size = app.opt('size', this.id);
      p.bold = app.opt('bold', this.id); p.italic = app.opt('italic', this.id); p.underline = app.opt('underline', this.id);
      p.color = app.fg;
    }
    p.align = app.opt('align', this.id); p.tracking = app.opt('tracking', this.id); p.lineHeight = app.opt<number>('leading', this.id) / 100; p.caps = app.opt('caps', this.id);
    this.editing.layer.render();
    app.touchDoc();
  }

  /** ¿Hay letras de la capa a menos de `r` píxeles? */
  private nearInk(l: TextLayer, x: number, y: number, r: number) {
    const c = l.canvas, x0 = Math.max(0, Math.floor(x - r)), y0 = Math.max(0, Math.floor(y - r)), x1 = Math.min(c.width, Math.ceil(x + r)), y1 = Math.min(c.height, Math.ceil(y + r));
    if (x1 <= x0 || y1 <= y0) return false;
    const d = ctx2d(c).getImageData(x0, y0, x1 - x0, y1 - y0).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 20) return true;
    return false;
  }
  protected textLayerAt(x: number, y: number): TextLayer | null {
    const all = [...walkLayers(app.doc!.root)].filter(l => l instanceof TextLayer && l.isVisibleInTree()) as TextLayer[];
    for (let i = all.length - 1; i >= 0; i--) {
      const l = all[i], b = l.bounds();
      if (!(x >= b.x - 4 && x <= b.x + b.w + 4 && y >= b.y - 4 && y <= b.y + b.h + 4)) continue;
      // texto sobre un trazado: su caja abarca toda la curva (en un logotipo circular, todo el círculo); solo cuenta
      // si se toca cerca de las letras, para poder escribir otro texto dentro
      if (l.props.onPath && !this.nearInk(l, x, y, Math.max(6, l.props.size * 0.5))) continue;
      return l;
    }
    return null;
  }

  down(e: ToolEvent) {
    const doc = app.doc!;
    if (this.editing) {
      const b = this.editing.layer.bounds();
      const inside = e.x >= b.x - 4 && e.x <= b.x + b.w + 4 && e.y >= b.y - 4 && e.y <= b.y + b.h + 4;
      if (inside) return;
      this.commit();
      return;
    }
    const hit = this.textLayerAt(e.x, e.y);
    if (hit) {
      if (hit.isLocked()) { app.toast('La capa está bloqueada', 'warn'); return; }
      doc.setActive(hit);
      const p = hit.props;
      app.setOpt(this.id, 'font', p.font); app.setOpt(this.id, 'size', p.size);
      app.setOpt(this.id, 'bold', p.bold); app.setOpt(this.id, 'italic', p.italic); app.setOpt(this.id, 'align', p.align);
      app.setOpt(this.id, 'tracking', p.tracking ?? 0); app.setOpt(this.id, 'leading', Math.round(p.lineHeight * 100)); app.setOpt(this.id, 'underline', !!p.underline); app.setOpt(this.id, 'caps', !!p.caps);
      app.setColors(p.color, app.bg);
      this.startEditing(hit, false, hit.indexAt(e.x, e.y) ?? undefined);
      return;
    }
    this.dragStart = { x: e.x, y: e.y }; this.dragNow = { x: e.x, y: e.y };
  }
  move(e: ToolEvent) { if (this.dragStart) this.dragNow = { x: e.x, y: e.y }; }
  up() {
    const a = this.dragStart, b = this.dragNow; this.dragStart = this.dragNow = null;
    if (!a || !b) return;
    const doc = app.doc!;
    const size = app.opt<number>('size', this.id);
    const box = Math.abs(b.x - a.x) * app.viewport.zoom > 10 ? Math.abs(b.x - a.x) : 0;
    const layer = new TextLayer('Texto', doc.width, doc.height, {
      text: '', font: app.opt('font', this.id), size, color: app.fg,
      bold: app.opt('bold', this.id), italic: app.opt('italic', this.id), align: app.opt('align', this.id),
      lineHeight: (app.opt<number>('leading', this.id) ?? 120) / 100, tracking: app.opt('tracking', this.id) ?? 0,
      underline: app.opt('underline', this.id), caps: app.opt('caps', this.id),
      x: Math.round(box ? Math.min(a.x, b.x) : a.x), y: Math.round(box ? Math.min(a.y, b.y) : a.y - size * 0.6),
      boxWidth: box ? Math.round(box) : undefined,
    });
    if (this.vertical) { const lp = layer.props; lp.vertical = true; lp.boxWidth = undefined; lp.x = Math.round(a.x + size * lp.lineHeight / 2); lp.y = Math.round(a.y); layer.render(); }
    doc.insertAboveActive(layer);
    this.startEditing(layer, true);
    doc.changed();
  }

  /** Empieza a editar una capa de texto existente (p. ej. con doble clic desde la herramienta Mover). */
  editLayer(layer: TextLayer) { if (!layer.isLocked()) this.startEditing(layer, false); }
  private startEditing(layer: TextLayer, isNew: boolean, caret?: number) {
    this.loaded = layer.id;
    const area = document.createElement('textarea');
    area.className = 'text-editor';
    area.value = layer.props.text;
    area.spellcheck = false;
    app.viewport.canvas.parentElement!.append(area);
    this.editing = { layer, isNew, before: layer.props.text, area };
    this.prevOpts = this.optsNow();
    area.addEventListener('input', () => {
      // los estilos parciales se desplazan con lo que se escribe o se borra
      if (layer.props.runs?.length) layer.props.runs = shiftRuns(layer.props.runs, layer.props.text, area.value);
      layer.props.text = area.value;
      layer.render();
      // solo se recompone la zona del texto (si no tiene estilos que se extiendan fuera, como sombras)
      const d = app.doc!, local = layer.parent === d.root && !hasStyles(layer.styles);
      d.invalidate(local ? layer.lastChange : null); d.changed();
      this.position();
    });
    area.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); this.commit(); }
      ev.stopPropagation();
    });
    this.position();
    // al entrar en un texto que ya existe, el cursor va donde se ha tocado (o al final si no se puede calcular)
    setTimeout(() => { area.focus(); const n = Math.min(area.value.length, caret ?? area.value.length); area.setSelectionRange(n, n); }, 0);
  }

  private position() {
    const ed = this.editing; if (!ed) return;
    const vp = app.viewport;
    const b = ed.layer.bounds();
    const p = vp.toScreen(b.x, b.y);
    const z = vp.zoom;
    const s = ed.area.style;
    s.left = (p.x - 3) + 'px'; s.top = (p.y - 3) + 'px';
    s.width = Math.max(40, b.w * z + 30) + 'px'; s.height = Math.max(20, b.h * z + 8) + 'px';
    const tp = ed.layer.props;
    s.fontSize = tp.size * z + 'px';
    // El cuadro de edición imita la tipografía para que el cursor caiga en su sitio
    s.fontFamily = JSON.stringify(tp.font) + ', sans-serif'; s.fontWeight = tp.bold ? 'bold' : 'normal'; s.fontStyle = tp.italic ? 'italic' : 'normal';
    s.letterSpacing = (tp.tracking ?? 0) / 1000 * tp.size * z + 'px'; s.lineHeight = String(tp.lineHeight); s.textTransform = tp.caps ? 'uppercase' : 'none';
    s.textAlign = tp.align; s.whiteSpace = tp.boxWidth ? 'pre-wrap' : 'pre';
    s.writingMode = tp.vertical ? 'vertical-rl' : '';
    if (tp.boxWidth) s.width = tp.boxWidth * z + 6 + 'px';
  }

  commit() {
    const ed = this.editing; if (!ed) return;
    this.editing = null;
    ed.area.remove();
    const doc = app.doc!;
    const l = ed.layer;
    const text = l.props.text;
    if (!text.trim()) {
      if (ed.isNew) { l.parent?.remove(l); doc.setActive(doc.allLayers().pop() ?? null); doc.invalidate(); doc.changed(); }
      else doc.commit('Editar texto');
      return;
    }
    l.name = text.split('\n')[0].slice(0, 30);
    this.finished(l, ed.isNew);
  }
  /** Al terminar de escribir (la máscara de texto lo cambia para convertirlo en selección). */
  protected finished(_l: TextLayer, isNew: boolean) { app.doc!.commit(isNew ? 'Texto' : 'Editar texto'); }

  deactivate() { this.commit(); }
  cancel() { this.commit(); }
  docChanged() { if (this.editing) { this.editing.area.remove(); this.editing = null; } }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (this.dragStart && this.dragNow) {
      const p = vp.toScreen(Math.min(this.dragStart.x, this.dragNow.x), Math.min(this.dragStart.y, this.dragNow.y));
      ctx.strokeStyle = 'rgba(80,160,255,.9)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
      ctx.strokeRect(p.x, p.y, Math.abs(this.dragNow.x - this.dragStart.x) * vp.zoom, Math.abs(this.dragNow.y - this.dragStart.y) * vp.zoom); ctx.setLineDash([]);
    }
    const ed = this.editing; if (!ed) return;
    this.position();
    const b = ed.layer.bounds();
    const p = vp.toScreen(b.x, b.y);
    ctx.strokeStyle = 'rgba(80,160,255,.9)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.strokeRect(p.x - 3, p.y - 3, b.w * vp.zoom + 6, b.h * vp.zoom + 6);
  }
}

/** Máscara de texto: escribe como con la herramienta Texto y, al terminar, las letras se convierten en una selección. */
export class TypeMaskTool extends TextTool {
  id = 'typeMask'; name = 'Máscara de texto horizontal'; icon = icon('typeMask');
  constructor() { super(); this.options = [{ key: 'maskMode', type: 'selmode', default: 'new' }, ...this.options.filter((o: any) => o.key !== 'underline')]; }
  protected textLayerAt() { return null; }
  protected finished(l: TextLayer) {
    const doc = app.doc!, mask = document.createElement('canvas'); mask.width = doc.width; mask.height = doc.height;
    mask.getContext('2d')!.drawImage(l.canvas, 0, 0);
    l.parent?.remove(l); doc.setActive(doc.allLayers().pop() ?? null);
    const mode = app.opt<string>('maskMode', this.id) || 'new';
    if (mode === 'new' || !doc.selection.mask) doc.selection.setMask(mask);
    else {
      const out = document.createElement('canvas'); out.width = doc.width; out.height = doc.height; const x = out.getContext('2d')!;
      x.drawImage(doc.selection.mask, 0, 0);
      x.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'subtract' ? 'destination-out' : 'destination-in';
      x.drawImage(mask, 0, 0); x.globalCompositeOperation = 'source-over';
      doc.selection.setMask(out);
    }
    doc.invalidate(); doc.commit('Máscara de texto');
  }
}

/** Texto vertical: igual que Texto, pero las letras van de arriba abajo y las líneas de derecha a izquierda. */
export class VerticalTextTool extends TextTool {
  id = 'textV'; name = 'Texto vertical'; icon = icon('textV');
  protected vertical = true;
}
/** Máscara de texto vertical. */
export class VerticalTypeMaskTool extends TypeMaskTool {
  id = 'typeMaskV'; name = 'Máscara de texto vertical'; icon = icon('typeMaskV');
  protected vertical = true;
}
