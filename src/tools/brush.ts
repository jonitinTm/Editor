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
import { fitShape } from './quickshape';
import { assistOn, assistBegin, assistMap, assistEnd, hitVP, moveVP, drawAssist } from './assist';

const SIZE = { key: 'size', label: 'Tamaño', type: 'range' as const, min: 1, max: 1000, default: 20, unit: 'px' };
const HARD = { key: 'hardness', label: 'Dureza', type: 'range' as const, min: 0, max: 100, default: 80, unit: '%' };
const OPAC = { key: 'opacity', label: 'Opacidad', type: 'range' as const, min: 1, max: 100, default: 100, unit: '%' };
const FLOW = { key: 'flow', label: 'Flujo', type: 'range' as const, min: 1, max: 100, default: 100, unit: '%' };
const PRESS = { key: 'pressure', label: 'Presión = tamaño', type: 'checkbox' as const, default: true, pin: 'pressureSize', title: 'La presión del lápiz controla el grosor. Desactívalo para pintar siempre con el mismo grosor' };
const PRESS_OP = { key: 'pressureOpacity', label: 'Presión = opacidad', type: 'checkbox' as const, default: false, pin: 'pressureOpacity', title: 'La presión del lápiz controla la opacidad: apretando poco, el trazo sale más transparente' };
const SMOOTH = { key: 'smoothing', label: 'Suavizar', type: 'range' as const, min: 0, max: 100, default: 10, unit: '%' };
const ANGLE = { key: 'angle', label: 'Ángulo', type: 'range' as const, min: -180, max: 180, default: 0, unit: '°' };
const ROUND = { key: 'roundness', label: 'Redondez', type: 'range' as const, min: 1, max: 100, default: 100, unit: '%' };
const FGBG_JIT = { key: 'fgbgJitter', label: 'Variar frontal/fondo', type: 'range' as const, min: 0, max: 100, default: 0, unit: '%' };
const HUE_JIT = { key: 'hueJitter', label: 'Variar tono', type: 'range' as const, min: 0, max: 100, default: 0, unit: '%' };
const BRI_JIT = { key: 'briJitter', label: 'Variar brillo', type: 'range' as const, min: 0, max: 100, default: 0, unit: '%' };
const BLEND = { key: 'blendMode', label: 'Modo', type: 'select' as const, default: 'source-over', choices: [
  { value: 'source-over', label: 'Normal' }, { value: 'destination-over', label: 'Detrás' }, { value: 'multiply', label: 'Multiplicar' }, { value: 'screen', label: 'Trama' }, { value: 'overlay', label: 'Superponer' },
  { value: 'soft-light', label: 'Luz suave' }, { value: 'hard-light', label: 'Luz fuerte' }, { value: 'color-dodge', label: 'Sobreexponer color' }, { value: 'color-burn', label: 'Subexponer color' },
  { value: 'darken', label: 'Oscurecer' }, { value: 'lighten', label: 'Aclarar' }, { value: 'difference', label: 'Diferencia' }, { value: 'hue', label: 'Tono' }, { value: 'saturation', label: 'Saturación' },
  { value: 'color', label: 'Color' }, { value: 'luminosity', label: 'Luminosidad' }] };
export const SYM = { key: 'symmetry', label: 'Simetría', type: 'select' as const, default: 'none', pin: 'symmetry', title: 'Lo que pintas se repite como en un espejo. El eje pasa por el centro de la imagen, o de la selección si hay una', choices: [
  { value: 'none', label: 'Sin simetría' }, { value: 'v', label: 'Vertical (espejo izq./der.)' }, { value: 'h', label: 'Horizontal (arriba/abajo)' }, { value: 'vh', label: 'Doble (4 partes)' },
  { value: 'r3', label: 'Radial 3' }, { value: 'r4', label: 'Radial 4' }, { value: 'r6', label: 'Radial 6' }, { value: 'r8', label: 'Radial 8' }, { value: 'r12', label: 'Radial 12' },
  { value: 'm6', label: 'Mandala 6 (radial + espejo)' }, { value: 'm8', label: 'Mandala 8 (radial + espejo)' }] };
/** Centro de la simetría: el de la selección si hay una, si no el del documento. */
function symCenter() { const d = app.doc!, b = d.selection.active ? d.selection.bounds : null; return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : { x: d.width / 2, y: d.height / 2 }; }
/** Puntos simétricos de (x, y) según el modo. */
export function symPoints(mode: string, x: number, y: number): { x: number; y: number }[] {
  if (!mode || mode === 'none' || !app.doc) return [{ x, y }];
  const c = symCenter(), dx = x - c.x, dy = y - c.y;
  if (mode === 'v') return [{ x, y }, { x: c.x - dx, y }];
  if (mode === 'h') return [{ x, y }, { x, y: c.y - dy }];
  if (mode === 'vh') return [{ x, y }, { x: c.x - dx, y }, { x, y: c.y - dy }, { x: c.x - dx, y: c.y - dy }];
  const n = +mode.slice(1), mirror = mode[0] === 'm', out: { x: number; y: number }[] = [];
  for (let k = 0; k < n; k++) {
    const a = k * 2 * Math.PI / n, ca = Math.cos(a), sa = Math.sin(a);
    out.push({ x: c.x + dx * ca - dy * sa, y: c.y + dx * sa + dy * ca });
    if (mirror) out.push({ x: c.x - dx * ca - dy * sa, y: c.y - dx * sa + dy * ca });
  }
  return out;
}
/** Líneas de los ejes de simetría (en coordenadas de pantalla). */
export function drawSymAxes(ctx: CanvasRenderingContext2D, vp: Viewport, mode: string) {
  if (!mode || mode === 'none' || !app.doc) return;
  const c = symCenter(), R = Math.hypot(app.doc.width, app.doc.height);
  const angs: number[] = mode === 'v' ? [Math.PI / 2] : mode === 'h' ? [0] : mode === 'vh' ? [0, Math.PI / 2] : Array.from({ length: +mode.slice(1) }, (_, k) => k * Math.PI / +mode.slice(1));
  ctx.save(); ctx.setLineDash([6, 4]); ctx.lineWidth = 1;
  for (const col of ['rgba(0,0,0,.5)', 'rgba(61,139,253,.9)']) {
    ctx.strokeStyle = col; ctx.beginPath();
    for (const a of angs) { const p = vp.toScreen(c.x - Math.cos(a) * R, c.y - Math.sin(a) * R), q = vp.toScreen(c.x + Math.cos(a) * R, c.y + Math.sin(a) * R); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); }
    ctx.stroke(); ctx.lineDashOffset = 5;
  }
  ctx.restore();
}
const SIZE_JIT = { key: 'sizeJitter', label: 'Variar tamaño', type: 'range' as const, min: 0, max: 100, default: 0, unit: '%' };
const ANG_JIT = { key: 'angleJitter', label: 'Variar ángulo', type: 'range' as const, min: 0, max: 100, default: 0, unit: '%' };
const OPAC_JIT = { key: 'opacityJitter', label: 'Variar opacidad', type: 'range' as const, min: 0, max: 100, default: 0, unit: '%' };
const WET = { key: 'wetEdges', label: 'Bordes húmedos', type: 'checkbox' as const, default: false };
const NOISE = { key: 'brushNoise', label: 'Ruido', type: 'checkbox' as const, default: false };
// Textura: el trazo toma el grano de un motivo (lienzo, papel…) fijo a la imagen. Pincel doble: cada pincelada recortada por otra punta.
const TEX = { key: 'texture', label: 'Textura', type: 'select' as const, default: '', choices: [] as { value: string; label: string }[] };
const TEX_SCALE = { key: 'texScale', label: 'Escala de la textura', type: 'range' as const, min: 10, max: 400, default: 100, unit: '%' };
const TEX_DEPTH = { key: 'texDepth', label: 'Profundidad', type: 'range' as const, min: 0, max: 100, default: 60, unit: '%' };
const TEX_INV = { key: 'texInvert', label: 'Invertir textura', type: 'checkbox' as const, default: false };
const DUAL = { key: 'dualSize', label: 'Pincel doble', type: 'range' as const, min: 0, max: 100, default: 0, unit: '%' };
const DUAL_SC = { key: 'dualScatter', label: 'Dispersión del doble', type: 'range' as const, min: 0, max: 100, default: 50, unit: '%' };
/** Transparencia del motivo para usarlo de textura: lo claro deja pasar la pintura, lo oscuro la frena. */
const texAlpha = new Map<string, HTMLCanvasElement>();
function textureAlpha(id: string, depth: number, invert: boolean): HTMLCanvasElement | null {
  const key = `${id}|${depth}|${invert}`; const hit = texAlpha.get(key); if (hit) return hit;
  const pat = getPattern(id); if (!pat) return null;
  const c = cloneCanvas(pat.canvas), x = ctx2d(c), im = x.getImageData(0, 0, c.width, c.height), d = im.data;
  for (let i = 0; i < d.length; i += 4) { let l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255; if (invert) l = 1 - l; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = 255 * (1 - depth * (1 - l)); }
  x.putImageData(im, 0, 0); if (texAlpha.size > 12) texAlpha.clear(); texAlpha.set(key, c); return c;
}
/** Punta modificada: bordes húmedos (más pintura en el borde, como la acuarela) y/o ruido (textura granulada). */
const modTips = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();
function modTip(tip: HTMLCanvasElement, wet: boolean, noise: boolean): HTMLCanvasElement {
  const key = `${wet}|${noise}`; let m = modTips.get(tip); if (!m) { m = new Map(); modTips.set(tip, m); }
  let c = m.get(key); if (c) return c;
  c = makeCanvas(tip.width, tip.height); const x = ctx2d(c); x.drawImage(tip, 0, 0);
  const w = tip.width, hh = tip.height;
  if (wet) { const g = x.createRadialGradient(w / 2, hh / 2, 0, w / 2, hh / 2, Math.min(w, hh) * 0.45); g.addColorStop(0, 'rgba(0,0,0,.6)'); g.addColorStop(0.7, 'rgba(0,0,0,.45)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.globalCompositeOperation = 'destination-out'; x.fillStyle = g; x.fillRect(0, 0, w, hh); }
  if (noise) { const n = x.createImageData(w, hh); for (let i = 3; i < n.data.length; i += 4) n.data[i] = Math.random() < 0.5 ? 255 : 90 + Math.random() * 165; const t = makeCanvas(w, hh); ctx2d(t).putImageData(n, 0, 0); x.globalCompositeOperation = 'destination-in'; x.drawImage(t, 0, 0); }
  x.globalCompositeOperation = 'source-over'; m.set(key, c); return c;
}
const AIRBRUSH = { key: 'airbrush', label: 'Aerógrafo (acumula al quedarse quieto)', type: 'checkbox' as const, default: false };
const SCATTER = { key: 'scatter', label: 'Dispersión', type: 'range' as const, min: 0, max: 500, default: 0, unit: '%' };
// Lápiz digital: la inclinación puede sombrear (como un lápiz de lado) o girar la punta (caligrafía). Estabilizador de cuerda.
const TILT = { key: 'tiltMode', label: 'Inclinación del lápiz', type: 'select' as const, default: 'shade', choices: [
  { value: 'none', label: 'No hace nada' }, { value: 'shade', label: 'Sombrear (más ancho y suave)' }, { value: 'angle', label: 'Gira la punta (caligrafía)' }] };
const TAPER = { key: 'taper', label: 'Afinar al empezar', type: 'range' as const, min: 0, max: 100, default: 0, unit: '%' };
const QSHAPE = { key: 'quickShape', label: 'Forma rápida (mantén quieto al final)', type: 'checkbox' as const, default: true };
const ROPE = { key: 'rope', label: 'Estabilizador (cuerda)', type: 'range' as const, min: 0, max: 100, default: 0, unit: 'px' };
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
    const round0 = (app.opt<number>('roundness', this.id) ?? 100) / 100, angle0 = app.opt<number>('angle', this.id) ?? 0, scatter = (app.opt<number>('scatter', this.id) ?? 0) / 100;
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
    const wetE = !!app.opt('wetEdges', this.id) && !this.aliased, noiseE = !!app.opt('brushNoise', this.id);
    const sj = (app.opt<number>('sizeJitter', this.id) ?? 0) / 100, aj = (app.opt<number>('angleJitter', this.id) ?? 0) / 100, oj = (app.opt<number>('opacityJitter', this.id) ?? 0) / 100;
    // textura y pincel doble (solo en las herramientas que tienen esas opciones)
    const dualK = this.options.some((o: any) => o.key === 'dualSize') ? (app.opt<number>('dualSize', this.id) ?? 0) / 100 : 0, dualSc = (app.opt<number>('dualScatter', this.id) ?? 50) / 100;
    const modC = makeCanvas(4, 4), dualC = makeCanvas(4, 4);
    const tiltMode = this.options.some((o: any) => o.key === 'tiltMode') && !this.aliased ? app.opt<string>('tiltMode', this.id) || 'none' : 'none';
    return (x, y, p) => {
      // dinámica de forma: cada pincelada con tamaño, ángulo y opacidad algo distintos
      let size = sj > 0 ? Math.max(1, this.size(p) * (1 - Math.random() * sj)) : this.size(p);
      let angle = aj > 0 ? angle0 + (Math.random() * 2 - 1) * aj * 180 : angle0;
      let round = round0, tiltAlpha = 1;
      // lápiz inclinado: con «sombrear» la marca se ensancha, se alarga hacia donde apunta y se aclara; con «girar» la punta sigue al lápiz
      // (al escribir normal el lápiz va a unos 55°: solo cuenta cuando se tumba bastante)
      const tl = this.tilt > 0.5 ? Math.min(1, (this.tilt - 0.5) / 0.38) : 0;
      if (tiltMode === 'shade' && tl > 0) { size = Math.round(size * (1 + 2 * tl)); round = Math.round(Math.max(0.2, round * (1 - 0.65 * tl)) * 20) / 20; angle = Math.round(-this.azi * 180 / Math.PI / 6) * 6; tiltAlpha = 1 - 0.7 * tl; }
      else if (tiltMode === 'angle' && this.tilt > 0.05) angle = Math.round((angle0 - this.azi * 180 / Math.PI) / 6) * 6;
      // punta con imagen (si hay) o la redonda de siempre
      let tip = (tipId && sampledTip(tipId, size, dyn ? '#ffffff' : color, jitter ? Math.random() * 360 : angle, round)) || brushTip(size, hard, dyn ? '#ffffff' : color, this.aliased, round, angle);
      if (wetE || noiseE) tip = modTip(tip, wetE, noiseE);
      if (dyn) {
        if (tintC.width !== tip.width || tintC.height !== tip.height) { tintC.width = tip.width; tintC.height = tip.height; }
        const tc = ctx2d(tintC); tc.globalCompositeOperation = 'copy'; tc.drawImage(tip, 0, 0); tc.globalCompositeOperation = 'source-in'; tc.fillStyle = dynColor(); tc.fillRect(0, 0, tip.width, tip.height); tc.globalCompositeOperation = 'source-over';
        tip = tintC;
      }
      if (scatter > 0) { x += (Math.random() * 2 - 1) * scatter * size; y += (Math.random() * 2 - 1) * scatter * size; }
      let dx = x - tip.width / 2, dy = y - tip.height / 2;
      if (this.aliased) { dx = Math.round(dx); dy = Math.round(dy); }
      if (dualK > 0 && !this.aliased) {
        if (modC.width !== tip.width || modC.height !== tip.height) { modC.width = tip.width; modC.height = tip.height; }
        const m = ctx2d(modC); m.globalCompositeOperation = 'copy'; m.drawImage(tip, 0, 0); m.globalCompositeOperation = 'destination-in';
        {
          if (dualC.width !== tip.width || dualC.height !== tip.height) { dualC.width = tip.width; dualC.height = tip.height; }
          const dc = ctx2d(dualC), r = Math.max(0.6, size * dualK * 0.3), spread = size * 0.5 * (0.2 + dualSc), n = 3 + Math.round(5 * dualSc);
          dc.globalCompositeOperation = 'copy'; dc.clearRect(0, 0, tip.width, tip.height); dc.globalCompositeOperation = 'source-over'; dc.fillStyle = '#fff';
          for (let k = 0; k < n; k++) { const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * spread; dc.beginPath(); dc.arc(tip.width / 2 + Math.cos(a) * rr, tip.height / 2 + Math.sin(a) * rr, r, 0, 7); dc.fill(); }
          m.drawImage(dualC, 0, 0);
        }
        m.globalCompositeOperation = 'source-over'; tip = modC;
      }
      // con tableta, la presión también puede controlar la opacidad de cada pincelada
      // (y la inclinación, al sombrear, la rebaja)
      const target = (app.opt('pressureOpacity', this.id) ? Math.min(1, Math.max(0.02, p)) : 1) * tiltAlpha;
      if (target < 1) {
        // las pinceladas se solapan: cada una aporta lo justo para que el trazo llegue a la opacidad buscada
        const overlap = Math.max(1, size / Math.max(0.5, this.spacing(p)));
        ctx.globalAlpha = flow * (1 - Math.pow(1 - target, 1 / overlap));
      } else ctx.globalAlpha = flow;
      if (oj > 0) ctx.globalAlpha *= 1 - Math.random() * oj;
      ctx.drawImage(tip, dx, dy);
      return { x: dx, y: dy, w: tip.width, h: tip.height };
    };
  }

  private dab: ((x: number, y: number, p: number) => any) | null = null;
  /** Distancia recorrida en el trazo (para afinar el comienzo) y última presión (para suavizar sus saltos). */
  private travel = 0; private lastP = 1; private tapLast: { x: number; y: number } | null = null;
  // forma rápida: puntos del trazo, temporizador de «mantener quieto» y si ya se ha convertido
  private qsPts: { x: number; y: number; p: number }[] = []; private qsTimer = 0; private qsAnchor: { sx: number; sy: number } | null = null;
  private qsDone = false; private qsReplay = false; private qsDown: ToolEvent | null = null;
  /** Arrastrando un punto de fuga del asistente de perspectiva. */
  private vpDrag = -1;
  private hasOpt(k: string) { return this.options.some((o: any) => o.key === k); }
  private qsOn() { return this.hasOpt('quickShape') && app.opt('quickShape', this.id) !== false && !assistOn(); }
  private qsArm(e: ToolEvent) {
    clearTimeout(this.qsTimer); this.qsAnchor = { sx: e.sx, sy: e.sy };
    this.qsTimer = window.setTimeout(() => this.quickShape(), 600);
  }
  /** Mantener quieto al final del trazo: se cambia por la forma perfecta (línea, círculo, rectángulo…). */
  private quickShape() {
    if (!this.stroke || this.qsDone || !this.qsDown || this.qsPts.length < 5) return;
    const zoom = app.viewport?.zoom || 1;
    const f = fitShape(this.qsPts, 14 / zoom); if (!f) return;
    const ps = this.qsPts.map(q => q.p).sort((a, b) => a - b), p = ps[Math.floor(ps.length / 2)] || 1;
    this.stroke.cancel(); this.stroke = null;
    this.qsReplay = true;
    try { this.down({ ...this.qsDown, x: f.pts[0].x, y: f.pts[0].y, pressure: p, shift: false }); } finally { this.qsReplay = false; }
    const st = this.stroke as Stroke | null; if (!st || !this.dab) return;
    for (const q of f.pts.slice(1)) st.lineTo(q.x, q.y, p, this.spacing(p), this.dab);
    st.update();
    this.lastPoint = f.pts[f.pts.length - 1]; this.sm = null; this.ropePt = null; this.ropeCursor = null; this.qsDone = true;
    app.viewport?.requestRender();
    app.toast('Forma rápida: ' + f.name);
  }
  /** Presión ajustada: sin saltos bruscos (lápiz) y más fina al empezar si se pide. */
  private shapeP(p: number, e: ToolEvent, x: number, y: number) {
    if (e.pointerType === 'pen') { p = this.lastP + (p - this.lastP) * 0.55; this.lastP = p; }
    const tp = this.options.some((o: any) => o.key === 'taper') ? (app.opt<number>('taper', this.id) ?? 0) : 0;
    if (tp > 0 && this.tapLast) {
      this.travel += Math.hypot(x - this.tapLast.x, y - this.tapLast.y); this.tapLast = { x, y };
      const L = (app.opt<number>('size', this.id) ?? 10) * (1 + tp / 10);
      p *= Math.min(1, 0.12 + 0.88 * Math.sqrt(this.travel / L));
    }
    return p;
  }
  /** Inclinación y dirección del lápiz en el último punto. */
  protected tilt = 0; protected azi = 0;
  /** Estabilizador de cuerda: la punta solo avanza cuando el lápiz se aleja más que la cuerda. */
  private ropePt: { x: number; y: number } | null = null;
  private ropeCursor: { x: number; y: number } | null = null;
  private ropeLen() { return this.options.some((o: any) => o.key === 'rope') ? (app.opt<number>('rope', this.id) ?? 0) / (app.viewport?.zoom || 1) : 0; }

  protected spacing(p: number) {
    const k = (app.opt<number>('spacing', this.id) ?? (this.aliased ? 25 : 12)) / 100;
    return Math.max(this.aliased ? 1 : 0.5, this.size(p) * k);
  }
  down(e: ToolEvent) {
    if (e.alt && !this.erase) { this.picking = true; pickColorAt(e.x, e.y); return; }
    // asistente de perspectiva: tocar un punto de fuga lo arrastra (no pinta)
    if (!this.qsReplay && app.viewport) { const i = hitVP(app.viewport, e.sx, e.sy); if (i >= 0) { this.vpDrag = i; return; } }
    this.tilt = e.tilt ?? 0; this.azi = e.azimuth ?? 0;
    this.ropePt = this.ropeLen() > 0 ? { x: e.x, y: e.y } : null; this.ropeCursor = null;
    const t = getPaintTarget();
    if (!t) return;
    this.target = t;
    const s = strokeSetup(t, this.erase);
    this.stroke = new Stroke(t, s.mode, app.opt<number>('opacity', this.id) / 100, s.maskValue, (s.mode === 'paint' ? app.opt<string>('blendMode', this.id) : undefined) as GlobalCompositeOperation || 'source-over');
    // textura: todo el trazo se ve a través del grano del motivo (anclado a la imagen), así no se pierde al repasar
    const texId = this.options.some((o: any) => o.key === 'texture') ? app.opt<string>('texture', this.id) || '' : '';
    const texC = texId ? textureAlpha(texId, (app.opt<number>('texDepth', this.id) ?? 60) / 100, !!app.opt('texInvert', this.id)) : null;
    if (texC) {
      const m = makeCanvas(t.canvas.width, t.canvas.height), mx = ctx2d(m), pat = mx.createPattern(texC, 'repeat')!, k = (app.opt<number>('texScale', this.id) ?? 100) / 100;
      pat.setTransform(new DOMMatrix().scaleSelf(k, k)); mx.fillStyle = pat; mx.fillRect(0, 0, m.width, m.height); this.stroke.addMask(m);
    }
    const dab0 = this.makeDab(s.color), sym = app.opt<string>('symmetry', this.id) || 'none';
    // bordes húmedos: al terminar, el centro del trazo se aclara y el borde se queda con más pintura
    if (app.opt('wetEdges', this.id) && !this.aliased) {
      const r = Math.max(1.5, (app.opt<number>('size', this.id) ?? 20) * 0.22);
      this.stroke.post = (buf, b) => {
        const pad = Math.ceil(r * 3), x0 = Math.max(0, Math.floor(b.x) - pad), y0 = Math.max(0, Math.floor(b.y) - pad), x1 = Math.min(buf.width, Math.ceil(b.x + b.w) + pad), y1 = Math.min(buf.height, Math.ceil(b.y + b.h) + pad), w = x1 - x0, hh = y1 - y0;
        if (w < 1 || hh < 1) return;
        const bc = ctx2d(buf), img = bc.getImageData(x0, y0, w, hh), bl = makeCanvas(w, hh), bx = ctx2d(bl);
        bx.filter = `blur(${r}px)`; bx.drawImage(buf, x0, y0, w, hh, 0, 0, w, hh); bx.filter = 'none';
        const B2 = bx.getImageData(0, 0, w, hh).data, D = img.data;
        for (let i = 3; i < D.length; i += 4) { const interior = Math.min(1, B2[i] / 255 / Math.max(0.01, D[i] / 255)); D[i] = D[i] * (1 - 0.6 * Math.pow(interior, 3)); }
        bc.putImageData(img, x0, y0);
      };
    }
    // con simetría, cada pincelada se repite en los puntos reflejados o girados
    this.dab = sym === 'none' ? dab0 : (x: number, y: number, p: number) => {
      let r: any = null;
      for (const q of symPoints(sym, x, y)) { const b = dab0(q.x, q.y, p); if (!b) continue; if (!r) r = { ...b }; else { const x1 = Math.max(r.x + r.w, b.x + b.w), y1 = Math.max(r.y + r.h, b.y + b.h); r.x = Math.min(r.x, b.x); r.y = Math.min(r.y, b.y); r.w = x1 - r.x; r.h = y1 - r.y; } }
      return r;
    };
    // textura repetible: lo que se sale por un borde entra por el contrario (así no quedan cortes al repetirla)
    if (app.doc?.meta.tileable) {
      const inner = this.dab!, W = t.canvas.width, H = t.canvas.height;
      this.dab = (x: number, y: number, p: number) => {
        const rad = (app.opt<number>('size', this.id) ?? 20) * 0.75 + 4;
        let r: any = null;
        for (const ox of [0, -W, W]) for (const oy of [0, -H, H]) {
          const qx = x + ox, qy = y + oy; if (qx < -rad || qy < -rad || qx > W + rad || qy > H + rad) continue;
          const b = inner(qx, qy, p); if (!b) continue;
          if (!r) r = { ...b }; else { const x1 = Math.max(r.x + r.w, b.x + b.w), y1 = Math.max(r.y + r.h, b.y + b.h); r.x = Math.min(r.x, b.x); r.y = Math.min(r.y, b.y); r.w = x1 - r.x; r.h = y1 - r.y; }
        }
        // muy lejos del lienzo: se pinta como siempre (queda fuera)
        return r ?? inner(x, y, p);
      };
    }
    this.sm = { x: e.x, y: e.y, p: e.pressure };
    if (!this.qsReplay) {
      assistBegin(e.x, e.y);
      this.qsDone = false; this.qsPts = [{ x: e.x, y: e.y, p: e.pressure }]; this.qsDown = e;
      if (this.qsOn()) this.qsArm(e);
    }
    this.travel = 0; this.lastP = e.pressure; this.tapLast = { x: e.x, y: e.y };
    if (app.opt('airbrush', this.id)) {
      // aerógrafo: mientras se mantiene pulsado, sigue soltando pintura aunque no se mueva
      clearInterval(this.airTimer);
      this.airTimer = window.setInterval(() => { const s = this.stroke, f = this.dab, q = this.lastPoint ?? this.sm; if (!s || !f || !q) return; (s as any).addDirty(f(q.x, q.y, this.sm?.p ?? 1)); s.update(); }, 60);
    }
    const sp = this.spacing(e.pressure);
    if (e.shift && this.lastPoint) {
      // Mayús + clic: línea recta desde el punto anterior
      this.stroke.lineTo(this.lastPoint.x, this.lastPoint.y, e.pressure, sp, this.dab);
    }
    const p0 = (app.opt<number>('taper', this.id) ?? 0) > 0 && this.options.some((o: any) => o.key === 'taper') ? e.pressure * 0.12 : e.pressure;
    this.stroke.lineTo(e.x, e.y, p0, sp, this.dab);
    this.stroke.update();
    this.lastPoint = { x: e.x, y: e.y };
  }
  move(e: ToolEvent) {
    if (this.picking) { pickColorAt(e.x, e.y); return; }
    if (this.vpDrag >= 0) { moveVP(this.vpDrag, e.x, e.y); app.viewport?.requestRender(); return; }
    if (!this.stroke || !this.dab || this.qsDone) return;
    let { x, y, pressure: p } = e;
    if (assistOn()) ({ x, y } = assistMap(x, y, app.viewport?.zoom || 1));
    // forma rápida: se guarda el recorrido y, si el puntero se queda quieto, se cuenta el tiempo
    if (this.qsOn()) { this.qsPts.push({ x, y, p }); if (!this.qsAnchor || Math.hypot(e.sx - this.qsAnchor.sx, e.sy - this.qsAnchor.sy) > 5) this.qsArm(e); }
    if (e.tilt !== undefined) { this.tilt += (e.tilt - this.tilt) * 0.5; this.azi = e.azimuth ?? this.azi; }
    const R = this.ropeLen();
    if (R > 0 && this.ropePt) {
      this.ropeCursor = { x, y };
      const dx = x - this.ropePt.x, dy = y - this.ropePt.y, dist = Math.hypot(dx, dy);
      if (dist <= R) return;
      this.ropePt.x += dx * (dist - R) / dist; this.ropePt.y += dy * (dist - R) / dist;
      x = this.ropePt.x; y = this.ropePt.y;
    }
    p = this.shapeP(p, e, x, y);
    const k = Math.min(0.95, (app.opt<number>('smoothing', this.id) ?? 0) / 100 * 0.93);
    if (k > 0 && this.sm) { this.sm.x += (x - this.sm.x) * (1 - k); this.sm.y += (y - this.sm.y) * (1 - k); this.sm.p += (p - this.sm.p) * (1 - k); x = this.sm.x; y = this.sm.y; p = this.sm.p; }
    this.stroke.lineTo(x, y, p, this.spacing(p), this.dab);
    this.stroke.update();
    this.lastPoint = { x, y };
  }
  private airTimer = 0;
  up(e?: ToolEvent) {
    clearInterval(this.airTimer); this.airTimer = 0; clearTimeout(this.qsTimer); this.qsAnchor = null; assistEnd();
    if (this.picking) { this.picking = false; return; }
    if (this.vpDrag >= 0) { this.vpDrag = -1; return; }
    if (!this.stroke) return;
    if (this.qsDone) { e = undefined; this.qsDone = false; }
    // Con suavizado, el trazo termina en el punto real donde se soltó
    const roped = !!this.ropePt; this.ropePt = null; this.ropeCursor = null;
    if (e && !roped && this.sm && this.dab && (app.opt<number>('smoothing', this.id) ?? 0) > 0) { this.stroke.lineTo(e.x, e.y, e.pressure, this.spacing(e.pressure), this.dab); this.lastPoint = { x: e.x, y: e.y }; }
    this.sm = null;
    const st = this.stroke, changed = st.finish();
    this.stroke = null;
    if (changed) { app.doc!.commit(this.historyName, st.bounds ?? undefined); if (!this.erase) import('../ui/artist').then(m => m.addRecentColor(app.fg)); }
  }
  cancel() { clearTimeout(this.qsTimer); this.qsDone = false; assistEnd(); this.vpDrag = -1; this.stroke?.cancel(); this.stroke = null; }
  hover() { /* el cursor se dibuja en drawOverlay */ }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    drawAssist(ctx, vp);
    // trazo provisional hasta donde el navegador prevé que irá el lápiz (se sustituye por el real en el siguiente fotograma)
    const pr = vp.predicted;
    if (pr && this.stroke && this.lastPoint && !this.erase && !this.qsDone && !this.ropePt && !assistOn() && (app.opt<number>('smoothing', this.id) ?? 0) <= 25) {
      const a = vp.toScreen(this.lastPoint.x, this.lastPoint.y);
      ctx.save(); ctx.lineCap = ctx.lineJoin = 'round'; ctx.strokeStyle = app.fg;
      ctx.globalAlpha = Math.min(1, (app.opt<number>('opacity', this.id) ?? 100) / 100) * 0.9;
      ctx.lineWidth = Math.max(1, this.size(this.lastP) * vp.zoom * 0.9);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); for (const q of pr) { const s = vp.toScreen(q.x, q.y); ctx.lineTo(s.x, s.y); } ctx.stroke(); ctx.restore();
    }
    const R = this.ropeLen();
    if (R > 0 && !this.stroke && vp.mouseScreen) {
      // círculo de la cuerda alrededor del puntero
      ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(61,139,253,.8)'; ctx.beginPath(); ctx.arc(vp.mouseScreen.x, vp.mouseScreen.y, R * vp.zoom, 0, 7); ctx.stroke(); ctx.restore();
    }
    if (this.ropePt && this.ropeCursor) {
      const a = vp.toScreen(this.ropePt.x, this.ropePt.y), b = vp.toScreen(this.ropeCursor.x, this.ropeCursor.y);
      ctx.save(); ctx.strokeStyle = 'rgba(61,139,253,.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.fillStyle = 'rgba(61,139,253,.9)'; ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, 7); ctx.fill(); ctx.restore();
      const ms = vp.mouseScreen; (vp as any).mouseScreen = a; drawBrushCursor(ctx, vp, app.opt<number>('size', this.id)); (vp as any).mouseScreen = ms;
      return;
    }
    drawBrushCursor(ctx, vp, app.opt<number>('size', this.id));
  }
  docChanged() { this.lastPoint = null; }
}

export class BrushTool extends StrokeTool {
  id = 'brush'; name = 'Pincel'; icon = icon('brush'); key = 'B'; group = 'brush'; historyName = 'Pincel';
  options = [SIZE, HARD, BLEND, OPAC, FLOW, SMOOTH, ROPE, QSHAPE, TILT, TAPER, SYM, AIRBRUSH, WET, NOISE, SPACING, ANGLE, ROUND, SCATTER, SIZE_JIT, ANG_JIT, OPAC_JIT, FGBG_JIT, HUE_JIT, BRI_JIT, PRESS, PRESS_OP, { ...TEX }, TEX_SCALE, TEX_DEPTH, TEX_INV, DUAL, DUAL_SC] as any[];
  extraFirst = true;
  extraOptions(bar: HTMLElement) {
    // pinceles de dibujo listos para usar (lápiz, tinta, carboncillo…)
    const b = document.createElement('button'); b.className = 'btn brush-presets'; b.type = 'button'; b.title = 'Pinceles de dibujo listos para usar'; b.textContent = 'Pinceles ▾';
    b.onclick = ev => { ev.stopPropagation(); import('../ui/optionsbar').then(m => m.presetMenu(b, this)); };
    bar.append(b); tipPicker(bar, this.id);
  }
  activate() {
    // la lista de motivos para la textura puede cambiar (motivos definidos por el usuario)
    const o = this.options.find((x: any) => x.key === 'texture'); o.choices = [{ value: '', label: 'Sin textura' }, ...allPatterns().map(p => ({ value: p.id, label: p.name }))];
  }
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
  paint(); app.onBar('options', paint);
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
  options = [{ ...SIZE, default: 1 }, OPAC, SMOOTH, ROPE, QSHAPE, SYM, { ...PRESS, default: false }] as any[];
}

export class EraserTool extends StrokeTool {
  id = 'eraser'; name = 'Borrador'; icon = icon('eraser'); key = 'E'; group = 'eraser'; historyName = 'Borrador';
  extraFirst = true;
  extraOptions(bar: HTMLElement) { tipPicker(bar, this.id); }
  erase = true;
  options = [{ key: 'eraseMode', label: 'Modo', type: 'select', default: 'brush', choices: [{ value: 'brush', label: 'Pincel' }, { value: 'pencil', label: 'Lápiz' }, { value: 'block', label: 'Bloque' }] },
    SIZE, HARD, OPAC, FLOW, SMOOTH, ROPE, TILT, SYM, SPACING, ANGLE, ROUND, SCATTER, PRESS, PRESS_OP] as any[];
  private mode() { return app.opt<string>('eraseMode', this.id) || 'brush'; }
  down(e: ToolEvent) { this.aliased = this.mode() !== 'brush'; super.down(e); }
  protected size(p: number) { return this.mode() === 'block' ? Math.max(1, Math.round(16 / (app.viewport?.zoom || 1))) : super.size(p); }
  protected makeDab(color: string) {
    if (this.mode() !== 'block') return super.makeDab(color);
    // bloque: un cuadrado de 16 píxeles de pantalla, sin suavizado
    const ctx = ctx2d(this.stroke!.buffer);
    return (x: number, y: number) => { const s = this.size(1), dx = Math.round(x - s / 2), dy = Math.round(y - s / 2); ctx.globalAlpha = 1; ctx.fillStyle = color; ctx.fillRect(dx, dy, s, s); return { x: dx, y: dy, w: s, h: s }; };
  }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (this.mode() !== 'block') { super.drawOverlay(ctx, vp); return; }
    drawSymAxes(ctx, vp, app.opt<string>('symmetry', this.id));
    const m = vp.mouseScreen; if (!m) return; ctx.save(); ctx.strokeStyle = '#000'; ctx.strokeRect(m.x - 8.5, m.y - 8.5, 17, 17); ctx.strokeStyle = '#fff'; ctx.strokeRect(m.x - 7.5, m.y - 7.5, 15, 15); ctx.restore();
  }
}

/** Tampón de clonar: Alt + clic marca el origen; luego se pinta copiando de él. */
export class CloneTool extends StrokeTool {
  id = 'clone'; name = 'Tampón de clonar'; icon = icon('clone'); key = 'S'; group = 'clone'; historyName = 'Tampón de clonar';
  options = [SIZE, { ...HARD, default: 50 }, OPAC, FLOW,
    { key: 'aligned', label: 'Alineado', type: 'checkbox', default: true },
    { key: 'sample', label: 'Muestra', type: 'select', default: 'layer', choices: [{ value: 'layer', label: 'Capa actual' }, { value: 'all', label: 'Todas las capas' }] },
    { key: 'overlay', label: 'Superposición', type: 'checkbox', default: true },
    { key: 'srcScale', label: 'Escala', type: 'number', min: 10, max: 400, default: 100, unit: '%', title: 'Escala del origen (Fuente de clonación)' },
    { key: 'srcAngle', label: 'Ángulo', type: 'number', min: -180, max: 180, default: 0, unit: '°', title: 'Giro del origen' },
    { key: 'srcFlip', label: 'Voltear', type: 'checkbox', default: false },
  ] as any[];
  /** Punto donde empezó a pintarse con el origen actual (centro del giro y la escala). */
  private anchor: { x: number; y: number } | null = null;
  /** Matriz que lleva el origen al destino, o null si es un simple desplazamiento. */
  protected srcMatrix(dx: number, dy: number): DOMMatrix | null {
    const sc = (app.opt<number>('srcScale', this.id) ?? 100) / 100, an = (app.opt<number>('srcAngle', this.id) ?? 0) * Math.PI / 180, fl = !!app.opt('srcFlip', this.id);
    if (!this.source || !this.anchor || (sc === 1 && an === 0 && !fl)) return null;
    const m = new DOMMatrix().translate(this.anchor.x - dx, this.anchor.y - dy).rotate(an * 180 / Math.PI).scale(fl ? -sc : sc, sc);
    const srcPt = { x: this.anchor.x + this.offset!.x, y: this.anchor.y + this.offset!.y };
    return m.translate(-srcPt.x, -srcPt.y);
  }
  private source: { x: number; y: number } | null = null;
  protected offset: { x: number; y: number } | null = null;
  protected srcCanvas: HTMLCanvasElement | null = null;
  private current: { x: number; y: number } | null = null;

  down(e: ToolEvent) {
    if (e.alt) {
      this.source = { x: e.x, y: e.y }; this.offset = null;
      this.anchor = null; app.toast('Origen del tampón fijado'); return;
    }
    if (!this.source) { app.toast('Mantén pulsado Alt y haz clic para elegir el origen', 'warn'); return; }
    const t = getPaintTarget();
    if (!t) return;
    if (!this.offset || !app.opt('aligned', this.id)) { this.offset = { x: this.source.x - e.x, y: this.source.y - e.y }; this.anchor = { x: e.x, y: e.y }; }
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
      const M = this.srcMatrix(dx, dy);
      if (M) { sc.setTransform(M); sc.drawImage(this.srcCanvas!, 0, 0); sc.setTransform(1, 0, 0, 1, 0, 0); }
      else sc.drawImage(this.srcCanvas!, -(dx + this.offset!.x), -(dy + this.offset!.y));
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
    // superposición: lo que se copiaría, visto bajo el pincel antes de pintar
    if (!this.stroke && app.opt('overlay', this.id) !== false && vp.mouse && vp.mouseScreen && this.id === 'clone') {
      const t = getPaintTarget(), src = t && !t.isMask ? (app.opt('sample', this.id) === 'all' ? app.doc!.getComposite() : t.canvas) : null;
      if (src) {
        const r = app.opt<number>('size', this.id) * vp.zoom / 2, m = vp.mouseScreen;
        ctx.save(); ctx.beginPath(); ctx.arc(m.x, m.y, Math.max(4, r), 0, 7); ctx.clip(); ctx.globalAlpha = 0.6;
        vp.docTransform(ctx);
        const off = this.offset ?? { x: p.x - vp.mouse.x, y: p.y - vp.mouse.y };
        const M = this.offset ? this.srcMatrix(0, 0) : null;
        if (M) ctx.transform(M.a, M.b, M.c, M.d, M.e, M.f); else ctx.translate(-off.x, -off.y);
        ctx.drawImage(src, 0, 0); ctx.restore();
      }
    }
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
  options = [{ ...SIZE, default: 30 },
    { key: 'healType', label: 'Tipo', type: 'select', default: 'content', choices: [{ value: 'content', label: 'Según el contenido' }, { value: 'proximity', label: 'Coincidencia de proximidad' }] }] as any[];
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
    this.finishHole(t, hole, box);
  }
  protected async finishHole(t: PaintTarget, hole: HTMLCanvasElement, box: { x: number; y: number; w: number; h: number }) {
    if (app.opt('healType', this.id) !== 'content' || box.w * box.h > 1500 * 1500) { healHole(t, hole, box, 'Pincel corrector puntual'); return; }
    // según el contenido: se rellena con textura parecida de alrededor y luego se funde el borde
    const g = makeCanvas(hole.width, hole.height), gx = ctx2d(g); gx.drawImage(hole, 0, 0);
    const id = gx.getImageData(box.x, box.y, box.w, box.h); for (let i = 3; i < id.data.length; i += 4) id.data[i] = id.data[i] > 10 ? 255 : 0; gx.putImageData(id, box.x, box.y);
    const { inpaintCanvas } = await import('../ui/ops');
    const out = await inpaintCanvas(t.canvas, g, { x: box.x - 2, y: box.y - 2, w: box.w + 4, h: box.h + 4 });
    if (!out) { healHole(t, hole, box, 'Pincel corrector puntual'); return; }
    const { setTargetCanvas } = await import('./paint'); const z = setTargetCanvas(t, out, 'auto'); app.doc!.commit('Pincel corrector puntual', z);
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

/** Quitar: pinta sobre lo que sobra (una persona, un cable, una mancha grande) y se reconstruye con el entorno. */
export class RemoveTool extends SpotHealTool {
  id = 'remove'; name = 'Quitar'; icon = icon('remove'); key = 'J'; group = 'heal';
  options = [{ ...SIZE, default: 60 }, { key: 'ai', label: 'Con IA (mejor resultado)', type: 'checkbox', default: true }] as any[];
  protected async finishHole(t: PaintTarget, hole: HTMLCanvasElement, box: { x: number; y: number; w: number; h: number }) {
    const d = app.doc!;
    // se agranda un poco lo pintado para no dejar restos del borde del objeto
    const g = makeCanvas(hole.width, hole.height), gx = ctx2d(g); gx.filter = 'blur(2px)'; gx.drawImage(hole, 0, 0); gx.drawImage(hole, 0, 0); gx.filter = 'none';
    const id = gx.getImageData(0, 0, g.width, g.height); for (let i = 3; i < id.data.length; i += 4) id.data[i] = id.data[i] > 10 ? 255 : 0; gx.putImageData(id, 0, 0);
    const bx = { x: box.x - 3, y: box.y - 3, w: box.w + 6, h: box.h + 6 };
    // con IA se inventa lo que había detrás; si no se puede (sin conexión la primera vez, o se rechaza la descarga), el método clásico
    let out: HTMLCanvasElement | null = null;
    if (app.opt('ai', this.id) !== false && !t.isMask) { const { aiInpaint } = await import('../ai/ai'); out = await aiInpaint(t.canvas, g, bx); }
    if (!out) {
      app.toast('Quitando…');
      const { inpaintCanvas } = await import('../ui/ops');
      out = await inpaintCanvas(t.canvas, g, bx);
    }
    if (!out) return;
    const { setTargetCanvas } = await import('./paint'); const z = setTargetCanvas(t, out, 'auto'); d.commit('Quitar', z);
  }
}

/** Pincel histórico artístico: pinta con trazos estilizados cuyo color sale de un estado anterior (efecto de cuadro pintado). */
export class ArtHistoryBrushTool extends StrokeTool {
  id = 'artHistory'; name = 'Pincel histórico artístico'; icon = icon('artHistory'); key = 'Y'; group = 'history'; historyName = 'Pincel histórico artístico';
  options = [{ ...SIZE, default: 6 }, OPAC,
    { key: 'style', label: 'Estilo', type: 'select', default: 'tight', choices: [
      { value: 'tight', label: 'Corto y apretado' }, { value: 'medium', label: 'Medio' }, { value: 'long', label: 'Largo' }, { value: 'dab', label: 'Toque' },
      { value: 'curl', label: 'Rizado' }, { value: 'curlLong', label: 'Rizado largo' }] },
    { key: 'area', label: 'Área', type: 'range', min: 1, max: 500, default: 50, unit: 'px' },
    { key: 'tol', label: 'Tolerancia', type: 'range', min: 0, max: 100, default: 0, unit: '%' },
    { key: 'origin', label: 'Origen', type: 'select', default: 'first', choices: [{ value: 'first', label: 'Estado inicial' }, { value: 'snapshot', label: 'Última instantánea' }] },
  ] as any[];
  private src: ImageData | null = null;
  down(e: ToolEvent) {
    if (e.alt) return;
    const d = app.doc!, t = getPaintTarget(); if (!t || t.isMask) return;
    const useSnap = app.opt('origin', this.id) === 'snapshot' && d.snapshots.length;
    const snap = useSnap ? d.snapshots[d.snapshots.length - 1].snap : d.history.steps[0]?.snap;
    const c = snap ? layerCanvasIn(snap, t.layer.id) : null;
    if (!c) { app.toast('Esta capa no existía en ese estado', 'warn'); return; }
    this.src = ctx2d(c).getImageData(0, 0, c.width, c.height);
    super.down(e);
  }
  protected spacing() { return Math.max(2, app.opt<number>('size', this.id) * 1.5); }
  protected makeDab(): (x: number, y: number, p: number) => any {
    const ctx = ctx2d(this.stroke!.buffer), S = this.src!, W = S.width, H = S.height;
    const size = Math.max(1, app.opt<number>('size', this.id)), area = app.opt<number>('area', this.id) || 50, style = app.opt<string>('style', this.id) || 'tight';
    const tol = (app.opt<number>('tol', this.id) ?? 0) / 100 * 255 * 3;
    const cur = ctx2d(this.target!.canvas).getImageData(0, 0, this.target!.canvas.width, this.target!.canvas.height).data;
    const len = { tight: 2, medium: 4, long: 8, dab: 0.6, curl: 3, curlLong: 6 }[style] ?? 2;
    const count = Math.max(1, Math.round(area / (size * 3)));
    const col = (x: number, y: number) => { const i = (Math.max(0, Math.min(H - 1, y | 0)) * W + Math.max(0, Math.min(W - 1, x | 0))) * 4; return [S.data[i], S.data[i + 1], S.data[i + 2], S.data[i + 3], i] as const; };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    return (x: number, y: number) => {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let k = 0; k < count; k++) {
        const r = Math.sqrt(Math.random()) * area / 2, a = Math.random() * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        const [cr, cg, cb, ca, i] = col(px, py); if (ca < 8) continue;
        // con tolerancia, solo se pinta donde el estado actual se diferencia del origen
        if (tol > 0 && Math.abs(cur[i] - cr) + Math.abs(cur[i + 1] - cg) + Math.abs(cur[i + 2] - cb) < tol) continue;
        // los trazos siguen el borde: dirección perpendicular al gradiente del origen
        const [lr] = col(px - 2, py), [rr] = col(px + 2, py), [ur] = col(px, py - 2), [dr] = col(px, py + 2);
        const gx = rr - lr, gy = dr - ur, dir = gx || gy ? Math.atan2(gy, gx) + Math.PI / 2 : Math.random() * Math.PI * 2;
        const L = size * len * (0.6 + Math.random() * 0.8), ex = px + Math.cos(dir) * L, ey = py + Math.sin(dir) * L;
        ctx.globalAlpha = 1; ctx.strokeStyle = `rgba(${cr},${cg},${cb},${ca / 255})`; ctx.lineWidth = size * (0.6 + Math.random() * 0.5);
        ctx.beginPath(); ctx.moveTo(px, py);
        if (style.startsWith('curl')) { const n = Math.cos(dir + Math.PI / 2) * L * 0.8, m = Math.sin(dir + Math.PI / 2) * L * 0.8; ctx.bezierCurveTo(px + n, py + m, ex + n, ey + m, ex - n * 0.3, ey - m * 0.3); }
        else { const bend = (Math.random() - 0.5) * L * 0.4; ctx.quadraticCurveTo((px + ex) / 2 - Math.sin(dir) * bend, (py + ey) / 2 + Math.cos(dir) * bend, ex, ey); }
        ctx.stroke();
        const m = L + size * 2; x0 = Math.min(x0, px - m); y0 = Math.min(y0, py - m); x1 = Math.max(x1, px + m); y1 = Math.max(y1, py + m);
      }
      return x1 < x0 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    };
  }
}
