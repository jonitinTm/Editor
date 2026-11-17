// Herramienta Texto: clic para escribir. Crea capas de texto editables.

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import type { Viewport } from '../ui/viewport';
import { TextLayer, walkLayers } from '../core/layers';

export const FONTS = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Georgia', 'Times New Roman', 'Garamond', 'Courier New', 'Consolas', 'Impact', 'Comic Sans MS', 'serif', 'sans-serif', 'monospace', 'cursive'];

export class TextTool implements Tool {
  id = 'text'; name = 'Texto'; icon = icon('text'); key = 'T'; cursor = 'text';
  options = [
    { key: 'font', type: 'font', default: 'Arial' },
    { key: 'size', label: 'Tamaño', type: 'range', min: 4, max: 800, default: 48, unit: 'px' },
    { key: 'bold', label: 'Negrita', type: 'checkbox', default: false },
    { key: 'italic', label: 'Cursiva', type: 'checkbox', default: false },
    { key: 'align', label: 'Alinear', type: 'select', default: 'left', choices: [
      { value: 'left', label: 'Izquierda' }, { value: 'center', label: 'Centro' }, { value: 'right', label: 'Derecha' }] },
    { key: 'tracking', label: 'Interletraje', type: 'range', min: -200, max: 1000, default: 0 },
    { key: 'leading', label: 'Interlineado', type: 'range', min: 50, max: 400, default: 120, unit: '%' },
    { key: 'underline', label: 'Subrayado', type: 'checkbox', default: false },
    { key: 'caps', label: 'Mayúsculas', type: 'checkbox', default: false },
  ] as any[];
  extraOptions(bar: HTMLElement) {
    const b = document.createElement('button'); b.className = 'btn icon-btn'; b.title = 'Deformar texto'; b.textContent = 'T͡';
    b.onclick = () => { const l = app.doc?.active; if (l instanceof TextLayer) import('../ui/dialogs').then(m => m.warpTextDialog(l)); else app.toast('Selecciona una capa de texto', 'warn'); };
    bar.append(b);
  }
  /** Clic: texto de punto. Arrastrar: caja de texto de párrafo. */
  private dragStart: { x: number; y: number } | null = null;
  private dragNow: { x: number; y: number } | null = null;
  private editing: { layer: TextLayer; isNew: boolean; before: string; area: HTMLTextAreaElement } | null = null;

  constructor() {
    app.on('options', () => this.syncFromOptions());
    app.on('colors', () => this.syncFromOptions());
  }

  private syncFromOptions() {
    if (!this.editing || app.tool !== this) return;
    const p = this.editing.layer.props;
    p.font = app.opt('font', this.id); p.size = app.opt('size', this.id);
    p.bold = app.opt('bold', this.id); p.italic = app.opt('italic', this.id); p.align = app.opt('align', this.id);
    p.tracking = app.opt('tracking', this.id); p.lineHeight = app.opt<number>('leading', this.id) / 100; p.underline = app.opt('underline', this.id); p.caps = app.opt('caps', this.id);
    p.color = app.fg;
    this.editing.layer.render();
    app.touchDoc();
  }

  private textLayerAt(x: number, y: number): TextLayer | null {
    const all = [...walkLayers(app.doc!.root)].filter(l => l instanceof TextLayer && l.isVisibleInTree()) as TextLayer[];
    for (let i = all.length - 1; i >= 0; i--) {
      const b = all[i].bounds();
      if (x >= b.x - 4 && x <= b.x + b.w + 4 && y >= b.y - 4 && y <= b.y + b.h + 4) return all[i];
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
      this.startEditing(hit, false);
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
    doc.insertAboveActive(layer);
    this.startEditing(layer, true);
    doc.changed();
  }

  private startEditing(layer: TextLayer, isNew: boolean) {
    const area = document.createElement('textarea');
    area.className = 'text-editor';
    area.value = layer.props.text;
    area.spellcheck = false;
    app.viewport.canvas.parentElement!.append(area);
    this.editing = { layer, isNew, before: layer.props.text, area };
    area.addEventListener('input', () => {
      layer.props.text = area.value;
      layer.render();
      app.touchDoc();
      this.position();
    });
    area.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); this.commit(); }
      ev.stopPropagation();
    });
    this.position();
    setTimeout(() => { area.focus(); area.select(); }, 0);
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
    doc.commit(ed.isNew ? 'Texto' : 'Editar texto');
  }

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
