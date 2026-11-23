// Filtro › Gran angular adaptable: corrige la curvatura de las lentes de ojo de pez y gran angular.
// Se puede ajustar a mano o marcar líneas que deberían ser rectas (3 toques a lo largo de cada una): el editor
// busca la corrección que mejor las endereza.

import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog, row } from './dialog';
import { ctx2d, makeCanvas } from '../core/canvas';
import { getPaintTarget, setPreview, setTargetCanvas } from '../tools/paint';
import type { Viewport } from './viewport';

export type Lens = 'fisheye' | 'wide';
/** Para un punto de la imagen corregida (normalizado al radio de la diagonal, desde el centro), dónde está en la original. */
function sourceRadius(lens: Lens, a: number, ru: number) {
  if (a <= 0) return ru;
  if (lens === 'fisheye') { const f = 1 / a; return f * Math.atan(ru / f); }   // ojo de pez equidistante → proyección normal
  return ru * (1 - 0.55 * a * ru * ru);                                          // gran angular: distorsión de barril
}
/** Al revés: de un punto de la original a la corregida (para las líneas marcadas). */
function correctedRadius(lens: Lens, a: number, rd: number) {
  if (a <= 0) return rd;
  if (lens === 'fisheye') { const f = 1 / a, t = rd / f; return t >= Math.PI / 2 - 1e-3 ? 50 : f * Math.tan(t); }
  // r·(1 − c·r²) solo crece hasta r = 1/√(3c): se busca ahí (más allá no hay imagen que corregir)
  const top = Math.min(50, 1 / Math.sqrt(3 * 0.55 * a)); let lo = 0, hi = top;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (sourceRadius(lens, a, m) < rd) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
/** Imagen corregida (mismo tamaño). `scale` > 1 muestra más (puede dejar esquinas vacías), < 1 recorta. */
export function wideAngle(src: HTMLCanvasElement, lens: Lens, a: number, scale: number): HTMLCanvasElement {
  const W = src.width, H = src.height, S = ctx2d(src).getImageData(0, 0, W, H).data, out = makeCanvas(W, H), oc = ctx2d(out), O = oc.createImageData(W, H), D = O.data;
  const cx = W / 2, cy = H / 2, R = Math.hypot(cx, cy);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ux = (x + 0.5 - cx) / R * scale, uy = (y + 0.5 - cy) / R * scale, ru = Math.hypot(ux, uy);
    const k = ru > 1e-9 ? sourceRadius(lens, a, ru) / ru : 1, sx = cx + ux * k * R - 0.5, sy = cy + uy * k * R - 0.5;
    if (sx < -0.5 || sy < -0.5 || sx > W - 0.5 || sy > H - 0.5) continue;
    const x0 = Math.max(0, Math.min(W - 2, Math.floor(sx))), y0 = Math.max(0, Math.min(H - 2, Math.floor(sy))), fx = Math.max(0, Math.min(1, sx - x0)), fy = Math.max(0, Math.min(1, sy - y0));
    const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4, o = (y * W + x) * 4;
    for (let c = 0; c < 4; c++) D[o + c] = (S[i00 + c] * (1 - fx) + S[i10 + c] * fx) * (1 - fy) + (S[i01 + c] * (1 - fx) + S[i11 + c] * fx) * fy;
  }
  oc.putImageData(O, 0, 0); return out;
}
/** Cuánto se separan de una recta los puntos de cada línea una vez corregidos (0 = perfectamente rectas). */
export function bendError(lines: { x: number; y: number }[][], W: number, H: number, lens: Lens, a: number) {
  const cx = W / 2, cy = H / 2, R = Math.hypot(cx, cy); let err = 0;
  for (const L of lines) {
    const P = L.map(p => { const dx = (p.x - cx) / R, dy = (p.y - cy) / R, rd = Math.hypot(dx, dy), k = rd > 1e-9 ? correctedRadius(lens, a, rd) / rd : 1; return { x: dx * k, y: dy * k }; });
    const A = P[0], B = P[P.length - 1], len = Math.hypot(B.x - A.x, B.y - A.y) || 1e-9;
    for (let i = 1; i < P.length - 1; i++) err += (Math.abs((B.x - A.x) * (A.y - P[i].y) - (A.x - P[i].x) * (B.y - A.y)) / len / len) ** 2;
  }
  return err;
}
/** La corrección (0..1) que mejor endereza las líneas marcadas. */
export function solveStrength(lines: { x: number; y: number }[][], W: number, H: number, lens: Lens) {
  let best = 0, be = Infinity;
  for (let i = 0; i <= 200; i++) { const a = i / 200, e = bendError(lines, W, H, lens, a); if (e < be) { be = e; best = a; } }
  for (let step = 1 / 400; step > 1e-5; step /= 2) for (const a of [best - step, best + step]) { if (a < 0 || a > 1) continue; const e = bendError(lines, W, H, lens, a); if (e < be) { be = e; best = a; } }
  return best;
}

export function wideAngleDialog() {
  const d = app.doc, t = getPaintTarget(); if (!d || !t || t.isMask) { app.toast('Elige la capa con la foto', 'warn'); return; }
  const src = t.canvas, W = src.width, H = src.height;
  // vista previa rápida a menor tamaño
  const k = Math.min(1, 900 / Math.max(W, H)), small = makeCanvas(Math.max(1, Math.round(W * k)), Math.max(1, Math.round(H * k))); ctx2d(small).drawImage(src, 0, 0, small.width, small.height);
  let lens: Lens = 'fisheye', strength = 0, scale = 100;
  const lines: { x: number; y: number }[][] = []; let cur: { x: number; y: number }[] = [];
  const preview = makeCanvas(W, H);
  let tm = 0;
  const render = () => { clearTimeout(tm); tm = window.setTimeout(() => { const r = wideAngle(small, lens, strength / 100, scale / 100), px = ctx2d(preview); px.clearRect(0, 0, W, H); px.imageSmoothingQuality = 'high'; px.drawImage(r, 0, 0, W, H); setPreview(t, preview); d.invalidate(); app.viewport.requestRender(); }, 40); };
  const lensSel = h('select', {}, h('option', { value: 'fisheye' }, 'Ojo de pez'), h('option', { value: 'wide' }, 'Gran angular (distorsión de barril)')) as HTMLSelectElement;
  const st = numberSlider({ min: 0, max: 100, value: 0, unit: '%', onInput: v => { strength = v; render(); } });
  const sc = numberSlider({ min: 50, max: 150, value: 100, unit: '%', onInput: v => { scale = v; render(); } });
  const info = h('div', { class: 'hint' });
  const updInfo = () => { info.textContent = lines.length ? `${lines.length} línea${lines.length > 1 ? 's' : ''} marcada${lines.length > 1 ? 's' : ''}${cur.length ? ` · esta: ${cur.length} de 3 toques` : ''}` : cur.length ? `${cur.length} de 3 toques` : 'Aún no hay líneas marcadas.'; app.viewport.requestRender(); };
  const auto = () => { if (!lines.length) { app.toast('Marca primero al menos una línea (3 toques a lo largo de algo que debería ser recto)', 'warn'); return; } strength = Math.round(solveStrength(lines, W, H, lens) * 1000) / 10; st.set(strength); render(); app.toast(`Corrección calculada: ${strength} %`); };
  lensSel.onchange = () => { lens = lensSel.value as Lens; if (lines.length) auto(); else render(); };
  // tocar la imagen: 3 puntos por línea (principio, medio y final de algo que debería ser recto)
  const pick = (e: PointerEvent) => {
    const r = app.viewport.canvas.getBoundingClientRect(), p = app.viewport.toDoc(e.clientX - r.left, e.clientY - r.top);
    if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) return;
    e.stopPropagation(); e.preventDefault(); cur.push({ x: p.x, y: p.y });
    if (cur.length === 3) { lines.push(cur); cur = []; auto(); }
    updInfo();
  };
  app.viewport.canvas.addEventListener('pointerdown', pick, true);
  // las líneas marcadas se dibujan encima de la imagen
  const prevExtras = (app as any).drawViewExtras;
  (app as any).drawViewExtras = (ctx: CanvasRenderingContext2D, vp: Viewport) => {
    prevExtras?.(ctx, vp);
    ctx.save(); ctx.lineWidth = 2;
    for (const L of [...lines, cur]) {
      if (!L.length) continue; const s = L.map(q => vp.toScreen(q.x, q.y));
      ctx.strokeStyle = L === cur ? '#f5a524' : '#3d8bfd'; ctx.beginPath(); s.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.stroke();
      for (const q of s) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, 7); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke(); ctx.lineWidth = 2; }
    }
    ctx.restore();
  };
  const close = () => { app.viewport.canvas.removeEventListener('pointerdown', pick, true); (app as any).drawViewExtras = prevExtras; clearTimeout(tm); };
  updInfo();
  showDialog({ title: 'Gran angular adaptable', width: 430, side: true, okLabel: 'Aplicar',
    body: [h('div', { class: 'hint' }, 'Endereza lo que la lente curvó (paredes, horizontes). Toca 3 puntos a lo largo de algo que debería ser recto —principio, medio y final— y la corrección se calcula sola. Puedes marcar varias líneas.'),
      row('Lente', lensSel), row('Corrección', st.el), row('Escala', sc.el), info,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: () => { lines.length = 0; cur = []; updInfo(); } }, 'Borrar líneas'), h('button', { class: 'btn', type: 'button', onclick: auto }, 'Calcular con las líneas'))],
    onOk: () => { close(); const out = wideAngle(src, lens, strength / 100, scale / 100); setPreview(t, null); setTargetCanvas(t, out); d.commit('Gran angular adaptable'); },
    onCancel: () => { close(); setPreview(t, null); d.invalidate(); app.viewport.requestRender(); } });
  render();
}
