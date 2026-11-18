// Pincel, lápiz, borrador y tampón de clonar: comparten el motor de trazos.

import { app } from '../ui/app';
import { Tool, ToolEvent } from './tool';
import { icon } from '../ui/icons';
import { Stroke, getPaintTarget, brushTip, strokeSetup, PaintTarget } from './paint';
import { ctx2d, makeCanvas, cloneCanvas, getPixels, putPixels } from '../core/canvas';
import { heal } from '../filters/heal';
import { rgb2hsl, hsl2rgb } from '../filters/adjustments';
import { allPatterns, getPattern, patternFill } from '../core/patterns';
import { healHole } from '../ui/ops';
import type { Viewport } from '../ui/viewport';
import { layerCanvasIn } from '../core/history';
import { sampledTip, getTip, allTips, loadUserTips, removeUserTip } from '../core/brushtips';

const SIZE = { key: 'size', label: 'Tamaño', type: 'range' as const, min: 1, max: 1000, default: 20, unit: 'px' };
const HARD = { key: 'hardness', label: 'Dureza', type: 'range' as const, min: 0, max: 100, default: 80, unit: '%' };
const OPAC = { key: 'opacity', label: 'Opacidad', type: 'range' as const, min: 1, max: 100, default: 100, unit: '%' };
const FLOW = { key: 'flow', label: 'Flujo', type: 'range' as const, min: 1, max: 100, default: 100, unit: '%' };
const PRESS = { key: 'pressure', label: 'Presión = tamaño', type: 'checkbox' as const, default: true };
const PRESS_OP = { key: 'pressureOpacity', label: 'Presión = opacidad', type: 'checkbox' as const, default: false };
const SMOOTH = { key: 'smoothing', label: 'Suavizar', type: 'range' as const, min: 0, max: 100, default: 10, unit: '%' };
const ANGLE = { key: 'angle', label: 'Ángulo', type: 'range' as const, min: -180, max: 180, default: 0, unit: '°' };
const ROUND = { key: 'roundness', label: 'Redondez', type: 'range' as const, min: 1, max: 100, default: 100, unit: '%' };
const FGBG_JIT = { key: 'fgbgJitter', label: 'Variar frontal/fondo', type: 'range' as const, min: 0, max: 100, default: 0, unit: '%' };
const HUE_JIT = { key: 'hueJitter', label: 'Variar tono', type: 'range' as const, min: 0, max: 100, default: 0, unit: '%' };
const BRI_JIT = { key: 'briJitter', label: 'Variar brillo', type: 'range' as const, min: 0, max: 100, default: 0, unit: '%' };
const SCATTER = { key: 'scatter', label: 'Dispersión', type: 'range' as const, min: 0, max: 500, default: 0, unit: '%' };
const SPACING = { key: 'spacing', label: 'Espaciado', type: 'range' as const, min: 1, max: 200, default: 12, unit: '%' };

/** Toma el color de la imagen combinada en (x, y) como color frontal (Alt mientras se pinta). */
export function pickColorAt(x: number, y: number) {
  const d = app.doc; if (!d) return;
  const px = Math.floor(x), py = Math.floor(y);
  if (px < 0 || py < 0 || px >= d.width || py >= d.height) return;
  const c = ctx2d(d.getComposite()).getImageData(px, py, 1, 1).data;
  if (c[3] === 0) return;
  app.setColors('#' + [c[0], c[1], c[2]].map(v => v.toString(16).padStart(2, '0')).join(''), app.bg);
}

/** Círculo del tamaño del pincel que sigue al ratón. */
export function drawBrushCursor(ctx: CanvasRenderingContext2D, vp: Viewport, size: number) {
  if (!vp.mouseScreen) return;
  const r = size * vp.zoom / 2;
  const { x, y } = vp.mouseScreen;
  ctx.lineWidth = 1;
  if (r > 3) {
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.beginPath(); ctx.arc(x, y, r + .5, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(x, y, r - .5, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.beginPath();
  ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.stroke();
}

abstract class StrokeTool implements Tool {
  abstract id: string; abstract name: string; abstract icon: string;
  cursor = 'none';
  options = [SIZE, HARD, OPAC, FLOW, SMOOTH, SPACING, ANGLE, ROUND, SCATTER, PRESS, PRESS_OP] as any[];
  protected stroke: Stroke | null = null;
  private picking = false;
  /** Posición suavizada (el trazo sigue al ratón con algo de retraso para eliminar temblores). */
  private sm: { x: number; y: number; p: number } | null = null;
  protected target: PaintTarget | null = null;
  protected lastPoint: { x: number; y: number } | null = null;
  protected erase = false;
  protected aliased = false;
  abstract historyName: string;

  protected size(p: number) {
    const s = app.opt<number>('size', this.id);
    return app.opt('pressure', this.id) ? Math.max(1, s * p) : s;
  }

  protected makeDab(color: string): (x: number, y: number, p: number) => any {
    const hard = (app.opt<number>('hardness', this.id) ?? 100) / 100;
    const flow = (app.opt<number>('flow', this.id) ?? 100) / 100;
    const ctx = ctx2d(this.stroke!.buffer);
    const round = (app.opt<number>('roundness', this.id) ?? 100) / 100, angle = app.opt<number>('angle', this.id) ?? 0, scatter = (app.opt<number>('scatter', this.id) ?? 0) / 100;
    const tipId = this.aliased ? '' : (app.opt<string>('tip', this.id) ?? ''), jitter = !!app.opt('tipJitter', this.id);
    // dinámica de color: cada pincelada con un color algo distinto
    const fj = (app.opt<number>('fgbgJitter', this.id) ?? 0) / 100, hj = (app.opt<number>('hueJitter', this.id) ?? 0) / 100, bj = (app.opt<number>('briJitter', this.id) ?? 0) / 100;
    const dyn = !this.erase && (fj > 0 || hj > 0 || bj > 0) && /^#[0-9a-f]{6}$/i.test(color);
    const c0 = dyn ? [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)) : [0, 0, 0];
    const c1 = dyn ? [1, 3, 5].map(i => parseInt((app.bg || '#ffffff').slice(i, i + 2), 16)) : [0, 0, 0];
    const tintC = makeCanvas(4, 4);
    const dynColor = () => {
      const t = Math.random() * fj; let r = c0[0] + (c1[0] - c0[0]) * t, g = c0[1] + (c1[1] - c0[1]) * t, b = c0[2] + (c1[2] - c0[2]) * t;
      if (hj > 0) { const [hh, ss, ll] = rgb2hsl(r, g, b); const [r2, g2, b2] = hsl2rgb((hh + (Math.random() * 2 - 1) * hj * 0.5 + 1) % 1, ss, ll); r = r2; g = g2; b = b2; }
      if (bj > 0) { const k = 1 + (Math.random() * 2 - 1) * bj * 0.6; r *= k; g *= k; b *= k; }
      return `rgb(${Math.max(0, Math.min(255, r)) | 0},${Math.max(0, Math.min(255, g)) | 0},${Math.max(0, Math.min(255, b)) | 0})`;
    };
    return (x, y, p) => {
      const size = this.size(p);
      // punta con imagen (si hay) o la redonda de siempre
      let tip = (tipId && sampledTip(tipId, size, dyn ? '#ffffff' : color, jitter ? Math.random() * 360 : angle, round)) || brushTip(size, hard, dyn ? '#ffffff' : color, this.aliased, round, angle);
      if (dyn) {
        if (tintC.width !== tip.width || tintC.height !== tip.height) { tintC.width = tip.width; tintC.height = tip.height; }
        const tc = ctx2d(tintC); tc.globalCompositeOperation = 'copy'; tc.drawImage(tip, 0, 0); tc.globalCompositeOperation = 'source-in'; tc.fillStyle = dynColor(); tc.fillRect(0, 0, tip.width, tip.height); tc.globalCompositeOperation = 'source-over';
        tip = tintC;
      }
      if (scatter > 0) { x += (Math.random() * 2 - 1) * scatter * size; y += (Math.random() * 2 - 1) * scatter * size; }
      let dx = x - tip.width / 2, dy = y - tip.height / 2;
      if (this.aliased) { dx = Math.round(dx); dy = Math.round(dy); }
      // con tableta, la presión también puede controlar la opacidad de cada pincelada
      if (app.opt('pressureOpacity', this.id)) {
        // las pinceladas se solapan: cada una aporta lo justo para que el trazo llegue a la opacidad de la presión
        const overlap = Math.max(1, size / Math.max(0.5, this.spacing(p)));
        ctx.globalAlpha = flow * (1 - Math.pow(1 - Math.min(1, Math.max(0.02, p)), 1 / overlap));
      } else ctx.globalAlpha = flow;
      ctx.drawImage(tip, dx, dy);
      return { x: dx, y: dy, w: tip.width, h: tip.height };
    };
  }

  private dab: ((x: number, y: number, p: number) => any) | null = null;

  protected spacing(p: number) {
    const k = (app.opt<number>('spacing', this.id) ?? (this.aliased ? 25 : 12)) / 100;
    return Math.max(this.aliased ? 1 : 0.5, this.size(p) * k);
  }
  down(e: ToolEvent) {
    if (e.alt && !this.erase) { this.picking = true; pickColorAt(e.x, e.y); return; }
    const t = getPaintTarget();
    if (!t) return;
    this.target = t;
    const s = strokeSetup(t, this.erase);
    this.stroke = new Stroke(t, s.mode, app.opt<number>('opacity', this.id) / 100, s.maskValue);
    this.dab = this.makeDab(s.color);
    this.sm = { x: e.x, y: e.y, p: e.pressure };
    const sp = this.spacing(e.pressure);
    if (e.shift && this.lastPoint) {
      // Mayús + clic: línea recta desde el punto anterior
      this.stroke.lineTo(this.lastPoint.x, this.lastPoint.y, e.pressure, sp, this.dab);
    }
    this.stroke.lineTo(e.x, e.y, e.pressure, sp, this.dab);
    this.stroke.update();
    this.lastPoint = { x: e.x, y: e.y };
  }
  move(e: ToolEvent) {
    if (this.picking) { pickColorAt(e.x, e.y); return; }
    if (!this.stroke || !this.dab) return;
    let { x, y, pressure: p } = e;
    const k = Math.min(0.95, (app.opt<number>('smoothing', this.id) ?? 0) / 100 * 0.93);
    if (k > 0 && this.sm) { this.sm.x += (x - this.sm.x) * (1 - k); this.sm.y += (y - this.sm.y) * (1 - k); this.sm.p += (p - this.sm.p) * (1 - k); x = this.sm.x; y = this.sm.y; p = this.sm.p; }
    this.stroke.lineTo(x, y, p, this.spacing(p), this.dab);
    this.stroke.update();
    this.lastPoint = { x, y };
  }
  up(e?: ToolEvent) {
    if (this.picking) { this.picking = false; return; }
    if (!this.stroke) return;
    // Con suavizado, el trazo termina en el punto real donde se soltó
    if (e && this.sm && this.dab && (app.opt<number>('smoothing', this.id) ?? 0) > 0) { this.stroke.lineTo(e.x, e.y, e.pressure, this.spacing(e.pressure), this.dab); this.lastPoint = { x: e.x, y: e.y }; }
    this.sm = null;
    const changed = this.stroke.finish();
    this.stroke = null;
    if (changed) app.doc!.commit(this.historyName);
  }
  cancel() { this.stroke?.cancel(); this.stroke = null; }
  hover() { /* el cursor se dibuja en drawOverlay */ }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) { drawBrushCursor(ctx, vp, app.opt<number>('size', this.id)); }
  docChanged() { this.lastPoint = null; }
}

export class BrushTool extends StrokeTool {
  id = 'brush'; name = 'Pincel'; icon = icon('brush'); key = 'B'; group = 'brush'; historyName = 'Pincel';
  options = [SIZE, HARD, OPAC, FLOW, SMOOTH, SPACING, ANGLE, ROUND, SCATTER, FGBG_JIT, HUE_JIT, BRI_JIT, PRESS, PRESS_OP] as any[];
  extraFirst = true;
  extraOptions(bar: HTMLElement) { tipPicker(bar, this.id); }
}

/** Selector de punta (redonda o con imagen) para la barra de opciones. */
export function tipPicker(bar: HTMLElement, toolId: string) {
  loadUserTips();
  const btn = document.createElement('button'); btn.className = 'btn tip-btn'; btn.title = 'Punta del pincel';
  const paint = () => {
    const id = app.opt<string>('tip', toolId) ?? '', t = id ? getTip(id) : null;
    btn.innerHTML = '';
    const c = document.createElement('canvas'); c.width = c.height = 22; const x = c.getContext('2d')!;
    if (t) { x.drawImage(sampledTip(t.id, 20, '#ddd')!, 1, 1, 20, 20); } else { x.fillStyle = '#ddd'; x.beginPath(); x.arc(11, 11, 8, 0, 7); x.fill(); }
    btn.append(c, document.createTextNode(' ' + (t ? t.name : 'Redonda') + ' ▾'));
  };
  paint();
  btn.onclick = e => {
    e.stopPropagation();
    document.querySelector('.tip-fly')?.remove();
    const fly = document.createElement('div'); fly.className = 'flyout tip-fly';
    const r = btn.getBoundingClientRect(); fly.style.left = r.left + 'px'; fly.style.top = r.bottom + 4 + 'px';
    const grid = document.createElement('div'); grid.className = 'tip-grid';
    const item = (id: string, name: string, draw: (x: CanvasRenderingContext2D) => void, del?: () => void) => {
      const el = document.createElement('div'); el.className = 'tip-item' + ((app.opt<string>('tip', toolId) ?? '') === id ? ' on' : ''); el.title = name;
      const c = document.createElement('canvas'); c.width = c.height = 40; draw(c.getContext('2d')!); el.append(c);
      const lab = document.createElement('span'); lab.textContent = name; el.append(lab);
      el.onclick = () => { app.setOpt(toolId, 'tip', id); paint(); fly.remove(); };
      if (del) { const b = document.createElement('button'); b.className = 'brush-del'; b.textContent = '×'; b.title = 'Eliminar esta punta'; b.onclick = ev => { ev.stopPropagation(); del(); fly.remove(); }; el.append(b); }
      grid.append(el);
    };
    item('', 'Redonda', x => { x.fillStyle = '#ddd'; x.beginPath(); x.arc(20, 20, 14, 0, 7); x.fill(); });
    for (const t of allTips()) item(t.id, t.name, x => x.drawImage(sampledTip(t.id, 36, '#ddd')!, 2, 2, 36, 36), t.user ? () => { removeUserTip(t.id); if (app.opt('tip', toolId) === t.id) app.setOpt(toolId, 'tip', ''); paint(); } : undefined);
    const jit = document.createElement('label'); jit.className = 'check tip-jit';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!app.opt('tipJitter', toolId); cb.onchange = () => app.setOpt(toolId, 'tipJitter', cb.checked);
    jit.append(cb, document.createTextNode(' Ángulo aleatorio en cada pincelada'));
    const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = 'Crea las tuyas con Edición › Definir pincel (a partir de una selección).';
    fly.append(grid, jit, hint); document.body.append(fly);
    setTimeout(() => document.addEventListener('pointerdown', function close(ev) { if (!fly.contains(ev.target as Node)) { fly.remove(); document.removeEventListener('pointerdown', close); } }), 0);
  };
  bar.append(btn);
}

export class PencilTool extends StrokeTool {
  id = 'pencil'; name = 'Lápiz'; icon = icon('pencil'); key = 'B'; group = 'brush'; historyName = 'Lápiz';
  aliased = true;
  options = [{ ...SIZE, default: 1 }, OPAC, SMOOTH, { ...PRESS, default: false }] as any[];
}

export class EraserTool extends StrokeTool {
  id = 'eraser'; name = 'Borrador'; icon = icon('eraser'); key = 'E'; group = 'eraser'; historyName = 'Borrador';
  extraFirst = true;
  extraOptions(bar: HTMLElement) { tipPicker(bar, this.id); }
  erase = true;
}

/** Tampón de clonar: Alt + clic marca el origen; luego se pinta copiando de él. */
export class CloneTool extends StrokeTool {
  id = 'clone'; name = 'Tampón de clonar'; icon = icon('clone'); key = 'S'; group = 'clone'; historyName = 'Tampón de clonar';
  options = [SIZE, { ...HARD, default: 50 }, OPAC, FLOW,
    { key: 'aligned', label: 'Alineado', type: 'checkbox', default: true },
    { key: 'sample', label: 'Muestra', type: 'select', default: 'layer', choices: [{ value: 'layer', label: 'Capa actual' }, { value: 'all', label: 'Todas las capas' }] },
  ] as any[];
  private source: { x: number; y: number } | null = null;
  protected offset: { x: number; y: number } | null = null;
  protected srcCanvas: HTMLCanvasElement | null = null;
  private current: { x: number; y: number } | null = null;

  down(e: ToolEvent) {
    if (e.alt) {
      this.source = { x: e.x, y: e.y }; this.offset = null;
      app.toast('Origen del tampón fijado'); return;
    }
    if (!this.source) { app.toast('Mantén pulsado Alt y haz clic para elegir el origen', 'warn'); return; }
    const t = getPaintTarget();
    if (!t) return;
    if (!this.offset || !app.opt('aligned', this.id)) this.offset = { x: this.source.x - e.x, y: this.source.y - e.y };
    this.srcCanvas = app.opt('sample', this.id) === 'all' ? cloneCanvas(app.doc!.flatten()) : cloneCanvas(t.canvas);
    this.target = t;
    const s = strokeSetup(t, false);
    this.stroke = new Stroke(t, s.mode === 'mask' ? 'mask' : 'paint', app.opt<number>('opacity', this.id) / 100, s.maskValue);
    (this as any).dabFn = this.makeCloneDab();
    this.current = { x: e.x, y: e.y };
    this.stroke.lineTo(e.x, e.y, e.pressure, this.spacing(), (this as any).dabFn);
    this.stroke.update();
  }
  protected spacing() { return Math.max(1, app.opt<number>('size', this.id) * 0.12); }
  protected makeCloneDab() {
    const hard = app.opt<number>('hardness', this.id) / 100;
    const flow = app.opt<number>('flow', this.id) / 100;
    const ctx = ctx2d(this.stroke!.buffer);
    const scratch = makeCanvas(4, 4);
    return (x: number, y: number) => {
      const size = app.opt<number>('size', this.id);
      const tip = brushTip(size, hard, '#ffffff');
      const w = tip.width, hh = tip.height;
      if (scratch.width !== w || scratch.height !== hh) { scratch.width = w; scratch.height = hh; }
      const sc = ctx2d(scratch);
      const dx = Math.round(x - w / 2), dy = Math.round(y - hh / 2);
      sc.globalCompositeOperation = 'copy';
      sc.drawImage(this.srcCanvas!, -(dx + this.offset!.x), -(dy + this.offset!.y));
      sc.globalCompositeOperation = 'destination-in';
      sc.drawImage(tip, 0, 0);
      ctx.globalAlpha = flow;
      ctx.drawImage(scratch, dx, dy);
      return { x: dx, y: dy, w, h: hh };
    };
  }
  move(e: ToolEvent) {
    this.current = { x: e.x, y: e.y };
    if (!this.stroke) return;
    this.stroke.lineTo(e.x, e.y, e.pressure, this.spacing(), (this as any).dabFn);
    this.stroke.update();
  }
  up(e?: ToolEvent) { super.up(e); this.srcCanvas = null; }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    super.drawOverlay(ctx, vp);
    // Marca del punto de origen
    let p: { x: number; y: number } | null = null;
    if (this.offset && vp.mouse) p = { x: vp.mouse.x + this.offset.x, y: vp.mouse.y + this.offset.y };
    else if (this.source) p = this.source;
    if (!p) return;
    const s = vp.toScreen(p.x, p.y);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(s.x - 7, s.y); ctx.lineTo(s.x + 7, s.y); ctx.moveTo(s.x, s.y - 7); ctx.lineTo(s.x, s.y + 7); ctx.stroke();
    ctx.strokeStyle = '#000'; ctx.lineWidth = .7; ctx.stroke();
  }
}

/** Pincel corrector: como el tampón (Alt+clic marca el origen) pero adapta color y luz al entorno. */
export class HealTool extends CloneTool {
  id = 'heal'; name = 'Pincel corrector'; icon = icon('heal'); key = 'J'; group = 'heal'; historyName = 'Pincel corrector';
  up(e?: ToolEvent) {
    const s = this.stroke;
    if (s && !s.target.isMask) {
      s.update();
      s.ensurePreview();
      const b = s.bounds;
      if (b) {
        const d = app.doc!, m = Math.max(6, Math.round(app.opt<number>('size', this.id) * 0.6));
        const reg = { x: Math.max(0, b.x - m), y: Math.max(0, b.y - m), w: 0, h: 0 };
        reg.w = Math.min(d.width, b.x + b.w + m) - reg.x; reg.h = Math.min(d.height, b.y + b.h + m) - reg.y;
        const ba = getPixels(s.buffer, reg).data, hole = new Float32Array(reg.w * reg.h);
        const sel = d.selection.mask ? getPixels(d.selection.mask, reg).data : null;
        const op = app.opt<number>('opacity', this.id) / 100;
        for (let i = 0; i < hole.length; i++) hole[i] = ba[i * 4 + 3] / 255 * op * (sel ? sel[i * 4 + 3] / 255 : 1);
        // C = la zona de origen completa (también alrededor del trazo, para medir la diferencia de color)
        const cc = makeCanvas(reg.w, reg.h), off = this.offset!;
        ctx2d(cc).drawImage(this.srcCanvas!, -(reg.x + off.x), -(reg.y + off.y));
        const C = ctx2d(cc).getImageData(0, 0, reg.w, reg.h), O = getPixels(s.original, reg);
        // donde el origen cae fuera de la imagen no hay dato: se usa el original
        for (let i = 0; i < hole.length; i++) if (C.data[i * 4 + 3] === 0 && O.data[i * 4 + 3] > 0) for (let c = 0; c < 4; c++) C.data[i * 4 + c] = O.data[i * 4 + c];
        putPixels(s.preview, heal(O, C, hole), reg.x, reg.y);
      }
    }
    super.up(e);
  }
}

/** Pincel corrector puntual: pinta sobre la imperfección y se corrige sola, sin elegir origen. */
export class SpotHealTool implements Tool {
  id = 'spotHeal'; name = 'Pincel corrector puntual'; icon = icon('spotHeal'); key = 'J'; group = 'heal'; cursor = 'none';
  options = [{ ...SIZE, default: 30 }] as any[];
  private hole: HTMLCanvasElement | null = null;
  private box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private last: { x: number; y: number } | null = null;
  private t: PaintTarget | null = null;
  down(e: ToolEvent) {
    const t = getPaintTarget(); if (!t) return;
    if (t.isMask) { app.toast('El corrector trabaja sobre los píxeles de la capa, no sobre la máscara', 'warn'); return; }
    const d = app.doc!;
    this.t = t; this.hole = makeCanvas(d.width, d.height); this.box = null; this.last = null;
    this.dab(e.x, e.y);
  }
  private dab(x: number, y: number) {
    const size = app.opt<number>('size', this.id), tip = brushTip(size, 0.7, '#202020');
    const steps = this.last ? Math.max(1, Math.ceil(Math.hypot(x - this.last.x, y - this.last.y) / Math.max(1, size * 0.15))) : 1;
    const c = ctx2d(this.hole!);
    for (let i = 1; i <= steps; i++) {
      const px = this.last ? this.last.x + (x - this.last.x) * i / steps : x, py = this.last ? this.last.y + (y - this.last.y) * i / steps : y;
      c.drawImage(tip, px - tip.width / 2, py - tip.height / 2);
      const b = this.box, r = tip.width / 2 + 1;
      this.box = b ? { x0: Math.min(b.x0, px - r), y0: Math.min(b.y0, py - r), x1: Math.max(b.x1, px + r), y1: Math.max(b.y1, py + r) } : { x0: px - r, y0: py - r, x1: px + r, y1: py + r };
    }
    this.last = { x, y };
  }
  move(e: ToolEvent) { if (this.hole) this.dab(e.x, e.y); }
  up() {
    const t = this.t, hole = this.hole, b = this.box;
    this.t = null; this.hole = null; this.box = null; this.last = null;
    if (!t || !hole || !b) return;
    const d = app.doc!;
    if (d.selection.mask) { const c = ctx2d(hole); c.globalCompositeOperation = 'destination-in'; c.drawImage(d.selection.mask, 0, 0); }
    const x = Math.max(0, Math.floor(b.x0)), y = Math.max(0, Math.floor(b.y0));
    const box = { x, y, w: Math.min(d.width, Math.ceil(b.x1)) - x, h: Math.min(d.height, Math.ceil(b.y1)) - y };
    if (box.w < 1 || box.h < 1) return;
    healHole(t, hole, box, 'Pincel corrector puntual');
  }
  cancel() { this.t = null; this.hole = null; this.box = null; }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (this.hole) { const v = vp.doc!.view; ctx.save(); ctx.globalAlpha = 0.45; ctx.imageSmoothingEnabled = v.zoom < 1; vp.docTransform(ctx); ctx.drawImage(this.hole, 0, 0); ctx.restore(); }
    drawBrushCursor(ctx, vp, app.opt<number>('size', this.id));
  }
}

/** Pincel de historia: pinta con cómo estaba la capa en el estado inicial (o en la última instantánea). */
export class HistoryBrushTool extends CloneTool {
  id = 'historyBrush'; name = 'Pincel de historia'; icon = icon('historyBrush'); key = 'Y'; group = 'history'; historyName = 'Pincel de historia';
  options = [SIZE, { ...HARD, default: 50 }, OPAC, FLOW,
    { key: 'origin', label: 'Origen', type: 'select', default: 'first', choices: [{ value: 'first', label: 'Estado inicial' }, { value: 'snapshot', label: 'Última instantánea' }] },
  ] as any[];
  down(e: ToolEvent) {
    const d = app.doc!, t = getPaintTarget(); if (!t || t.isMask) return;
    const useSnap = app.opt('origin', this.id) === 'snapshot' && d.snapshots.length;
    const snap = useSnap ? d.snapshots[d.snapshots.length - 1].snap : d.history.steps[0]?.snap;
    const src = snap ? layerCanvasIn(snap, t.layer.id) : null;
    if (!src) { app.toast('Esta capa no existía en ese estado', 'warn'); return; }
    this.srcCanvas = cloneCanvas(src); this.offset = { x: 0, y: 0 };
    this.target = t;
    const s = strokeSetup(t, false);
    this.stroke = new Stroke(t, s.mode === 'mask' ? 'mask' : 'paint', app.opt<number>('opacity', this.id) / 100, s.maskValue);
    (this as any).dabFn = (this as any).makeCloneDab();
    this.stroke.lineTo(e.x, e.y, e.pressure, this.spacing(), (this as any).dabFn);
    this.stroke.update();
  }
  move(e: ToolEvent) { if (!this.stroke) return; this.stroke.lineTo(e.x, e.y, e.pressure, this.spacing(), (this as any).dabFn); this.stroke.update(); }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) { drawBrushCursor(ctx, vp, app.opt<number>('size', this.id)); }
}

/** Tampón de motivo: pinta con un motivo repetido (alineado con el documento). */
export class PatternStampTool extends CloneTool {
  id = 'patternStamp'; name = 'Tampón de motivo'; icon = icon('patternStamp'); key = 'S'; group = 'clone'; historyName = 'Tampón de motivo';
  options = [SIZE, { ...HARD, default: 50 }, OPAC, FLOW,
    { key: 'pattern', label: 'Motivo', type: 'select', default: 'base:Damero', choices: [] },
    { key: 'scale', label: 'Escala', type: 'range', min: 10, max: 400, default: 100, unit: '%' },
  ] as any[];
  activate() { const o = this.options.find((x: any) => x.key === 'pattern'); o.choices = allPatterns().map(p => ({ value: p.id, label: p.name })); }
  down(e: ToolEvent) {
    const t = getPaintTarget(); if (!t) return;
    const pat = getPattern(app.opt('pattern', this.id)) ?? allPatterns()[0]; if (!pat) return;
    this.offset = { x: 0, y: 0 };
    this.srcCanvas = patternFill(pat, t.canvas.width, t.canvas.height, app.opt<number>('scale', this.id) / 100);
    this.target = t;
    const s = strokeSetup(t, false);
    this.stroke = new Stroke(t, s.mode === 'mask' ? 'mask' : 'paint', app.opt<number>('opacity', this.id) / 100, s.maskValue);
    (this as any).dabFn = this.makeCloneDab();
    this.stroke.lineTo(e.x, e.y, e.pressure, this.spacing(), (this as any).dabFn);
    this.stroke.update();
  }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) { drawBrushCursor(ctx, vp, app.opt<number>('size', this.id)); }
}

/** Pincel mezclador: el color del pincel se mezcla con el de la imagen al pintar (como pintura húmeda). */
export class MixerBrushTool extends StrokeTool {
  id = 'mixer'; name = 'Pincel mezclador'; icon = icon('mixer'); key = 'B'; group = 'brush'; historyName = 'Pincel mezclador';
  options = [SIZE, { ...HARD, default: 60 },
    { key: 'wet', label: 'Humedad', type: 'range', min: 0, max: 100, default: 50, unit: '%' },
    { key: 'load', label: 'Carga', type: 'range', min: 1, max: 100, default: 60, unit: '%' },
    { key: 'mix', label: 'Mezcla', type: 'range', min: 0, max: 100, default: 50, unit: '%' },
    { ...FLOW, default: 60 }, OPAC,
    { key: 'clean', label: 'Limpiar tras cada trazo', type: 'checkbox', default: true },
    { key: 'dry', label: 'Solo mezclar (sin pintura)', type: 'checkbox', default: false },
  ] as any[];
  private reservoir: number[] | null = null;
  protected makeDab(color: string): (x: number, y: number, p: number) => any {
    const hard = app.opt<number>('hardness', this.id) / 100, flow = app.opt<number>('flow', this.id) / 100;
    const wet = app.opt<number>('wet', this.id) / 100, mix = app.opt<number>('mix', this.id) / 100, load = app.opt<number>('load', this.id) / 100;
    const dry = !!app.opt('dry', this.id);
    const fg = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
    if (!this.reservoir || app.opt('clean', this.id)) this.reservoir = [...fg];
    const R = this.reservoir, ctx = ctx2d(this.stroke!.buffer), t = this.target!;
    const src = t.canvas, sctx = ctx2d(src), buf = this.stroke!.buffer, bctx = ctx2d(buf);
    const scratch = makeCanvas(4, 4); let dabs = 0, paintLeft = 1;
    return (x, y, p) => {
      const size = this.size(p), tip = brushTip(size, hard, '#ffffff'), w = tip.width, hh = tip.height;
      const dx = Math.round(x - w / 2), dy = Math.round(y - hh / 2);
      // color medio bajo el pincel (lo que ya hay en la capa y lo pintado en este trazo)
      const sx = Math.max(0, dx), sy = Math.max(0, dy), sw = Math.min(src.width, dx + w) - sx, sh = Math.min(src.height, dy + hh) - sy;
      let cr = R[0], cg = R[1], cb = R[2], any = false;
      if (sw > 0 && sh > 0) {
        const a = sctx.getImageData(sx, sy, sw, sh).data, b = bctx.getImageData(sx, sy, sw, sh).data;
        let n = 0, r0 = 0, g0 = 0, b0 = 0; const step = Math.max(1, Math.floor(Math.sqrt(sw * sh / 400))) * 4;
        for (let i = 0; i < a.length; i += step) {
          const ba = b[i + 3] / 255, aa = a[i + 3] / 255 * (1 - ba) + ba; if (aa < 0.05) continue;
          r0 += (a[i] * (1 - ba) + b[i] * ba); g0 += (a[i + 1] * (1 - ba) + b[i + 1] * ba); b0 += (a[i + 2] * (1 - ba) + b[i + 2] * ba); n++;
        }
        if (n) { cr = r0 / n; cg = g0 / n; cb = b0 / n; any = true; }
      }
      // el depósito se ensucia con lo que toca y la carga se va gastando
      if (any) { const k = wet * 0.06; R[0] += (cr - R[0]) * k; R[1] += (cg - R[1]) * k; R[2] += (cb - R[2]) * k; }
      dabs++; paintLeft = load >= 0.999 ? 1 : Math.max(0, 1 - dabs / (20 + load * 400));
      const m = dry ? 1 : any ? Math.min(1, mix * 0.6 + (1 - paintLeft) * 0.4) : 0;
      const col = [R[0] + (cr - R[0]) * m, R[1] + (cg - R[1]) * m, R[2] + (cb - R[2]) * m];
      if (scratch.width !== w || scratch.height !== hh) { scratch.width = w; scratch.height = hh; }
      const sc = ctx2d(scratch); sc.globalCompositeOperation = 'copy'; sc.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`; sc.fillRect(0, 0, w, hh);
      sc.globalCompositeOperation = 'destination-in'; sc.drawImage(tip, 0, 0);
      ctx.globalAlpha = flow * (dry ? wet : 0.4 + 0.6 * paintLeft);
      ctx.drawImage(scratch, dx, dy);
      return { x: dx, y: dy, w, h: hh };
    };
  }
  protected spacing(p: number) { return Math.max(1, this.size(p) * 0.1); }
}
