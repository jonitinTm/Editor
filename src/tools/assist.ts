// Asistente de perspectiva para dibujar: uno o dos puntos de fuga (se arrastran para colocarlos).
// Al pintar, el trazo se endereza hacia el punto de fuga más parecido a la dirección del gesto, o en vertical
// (y en horizontal con un punto de fuga). Así salen calles, habitaciones y edificios con la perspectiva correcta.
import { app } from '../ui/app';
import type { Viewport } from '../ui/viewport';

export type AssistMode = 'off' | 'p1' | 'p2';
type Pt = { x: number; y: number };
export const assist = { mode: 'off' as AssistMode, vps: [] as Pt[], forDoc: null as unknown, forMode: '' };
const stale = () => assist.forDoc !== app.doc || assist.forMode !== assist.mode;
let start: Pt | null = null, lock: { o: Pt; d: Pt } | null = null;

/** Coloca los puntos de fuga por defecto para el documento actual (horizonte a un 40 % de la altura). */
function defaults() {
  const d = app.doc!; const y = d.height * 0.4;
  let l = -d.width * 0.35, r = d.width * 1.35;
  // los puntos tienen que verse para poder arrastrarlos: dentro de la parte visible del lienzo
  const vp = app.viewport;
  if (vp && vp.width > 80) { const m = 28, a = vp.toDoc(m, 0).x, b = vp.toDoc(vp.width - m, 0).x; l = Math.max(l, Math.min(a, b)); r = Math.min(r, Math.max(a, b)); if (r - l < d.width * 0.5) { l = -d.width * 0.35; r = d.width * 1.35; } }
  assist.vps = assist.mode === 'p1' ? [{ x: d.width / 2, y }] : [{ x: l, y }, { x: r, y }];
  assist.forDoc = d; assist.forMode = assist.mode;
}
export function setAssist(m: AssistMode) {
  assist.mode = m;
  if (m !== 'off' && app.doc && stale()) defaults();
  app.viewport?.requestRender();
}
export const assistOn = () => assist.mode !== 'off' && !!app.doc;
/** Punto de fuga bajo el puntero (en pantalla), para arrastrarlo. */
export function hitVP(vp: Viewport, sx: number, sy: number): number {
  if (!assistOn()) return -1;
  if (stale()) defaults();
  for (let i = 0; i < assist.vps.length; i++) { const s = vp.toScreen(assist.vps[i].x, assist.vps[i].y); if (Math.hypot(s.x - sx, s.y - sy) < 18) return i; }
  return -1;
}
export function moveVP(i: number, x: number, y: number) {
  assist.vps[i] = { x, y };
  // con dos puntos, el horizonte se mantiene recto: los dos a la misma altura
  if (assist.vps.length === 2) assist.vps[1 - i].y = y;
}
export function assistBegin(x: number, y: number) { start = { x, y }; lock = null; }
/** Devuelve el punto corregido. Hasta que el gesto marca una dirección (unos píxeles), se queda en el inicio. */
export function assistMap(x: number, y: number, zoom: number): Pt {
  if (!assistOn() || !start) return { x, y };
  if (!lock) {
    const dx = x - start.x, dy = y - start.y, len = Math.hypot(dx, dy);
    if (len * zoom < 14) return start; // con menos, el temblor del inicio del trazo elige mal la dirección
    const m = { x: dx / len, y: dy / len };
    const dirs: Pt[] = [{ x: 0, y: 1 }];
    if (assist.mode === 'p1') dirs.push({ x: 1, y: 0 });
    for (const v of assist.vps) { const vx = v.x - start.x, vy = v.y - start.y, l = Math.hypot(vx, vy); if (l > 1) dirs.push({ x: vx / l, y: vy / l }); }
    let best = dirs[0], bd = -1;
    for (const d of dirs) { const k = Math.abs(d.x * m.x + d.y * m.y); if (k > bd) { bd = k; best = d; } }
    lock = { o: start, d: best };
  }
  const t = (x - lock.o.x) * lock.d.x + (y - lock.o.y) * lock.d.y;
  return { x: lock.o.x + lock.d.x * t, y: lock.o.y + lock.d.y * t };
}
export function assistEnd() { start = null; lock = null; }

/** Dibuja el horizonte, unas líneas de guía desde cada punto de fuga y los puntos (para arrastrarlos). */
export function drawAssist(ctx: CanvasRenderingContext2D, vp: Viewport) {
  if (!assistOn()) return;
  if (stale()) defaults();
  const d = app.doc!, R = Math.hypot(d.width, d.height) * 2;
  ctx.save(); ctx.lineWidth = 1;
  const line = (a: Pt, b: Pt) => { const p = vp.toScreen(a.x, a.y), q = vp.toScreen(b.x, b.y); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); };
  ctx.strokeStyle = 'rgba(61,139,253,.28)'; ctx.beginPath();
  for (const v of assist.vps) for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; line(v, { x: v.x + Math.cos(a) * R, y: v.y + Math.sin(a) * R }); }
  ctx.stroke();
  // horizonte
  const hy = assist.vps[0].y; ctx.strokeStyle = 'rgba(245,165,36,.85)'; ctx.setLineDash([8, 5]); ctx.beginPath(); line({ x: -R, y: hy }, { x: d.width + R, y: hy }); ctx.stroke(); ctx.setLineDash([]);
  for (const v of assist.vps) {
    const s = vp.toScreen(v.x, v.y);
    ctx.fillStyle = 'rgba(61,139,253,.95)'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  // línea a la que se está pegando el trazo
  if (lock) { ctx.strokeStyle = 'rgba(61,139,253,.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); line({ x: lock.o.x - lock.d.x * R, y: lock.o.y - lock.d.y * R }, { x: lock.o.x + lock.d.x * R, y: lock.o.y + lock.d.y * R }); ctx.stroke(); }
  ctx.restore();
}
