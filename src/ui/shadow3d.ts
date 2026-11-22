// Sombras y 3D a partir de una capa:
// · Sombra proyectada: la silueta del objeto se proyecta en el suelo (en perspectiva) o en la pared de detrás,
//   y se difumina y aclara al alejarse del objeto, como una sombra real. Más una sombra de contacto en la base.
// · Extrusión 3D: da volumen a textos, logotipos y formas (profundidad, dirección, perspectiva y sombreado).

import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog, row } from './dialog';
import { RasterLayer, isRaster, type Layer } from '../core/layers';
import { contentBounds, ctx2d, makeCanvas } from '../core/canvas';

const clamp01 = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v;

/** Silueta (solo transparencia) de una capa, del tamaño del documento. */
function silhouette(l: Layer, color: string): HTMLCanvasElement | null {
  if (!isRaster(l)) return null;
  const src = (l as RasterLayer).canvas, c = makeCanvas(src.width, src.height), x = ctx2d(c);
  x.drawImage(src, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height); x.globalCompositeOperation = 'source-over';
  return c;
}
function blurred(src: HTMLCanvasElement, r: number): HTMLCanvasElement {
  if (r < 0.3) return src;
  const c = makeCanvas(src.width, src.height), x = ctx2d(c); x.filter = `blur(${r}px)`; x.drawImage(src, 0, 0); x.filter = 'none'; return c;
}

export type ShadowParams = { type: 'floor' | 'wall'; angle: number; length: number; squash: number; blur: number; blurFar: number; opacity: number; fade: number; color: string; contact: number };
export const SHADOW_DEFAULTS: ShadowParams = { type: 'floor', angle: 55, length: 140, squash: 40, blur: 2, blurFar: 16, opacity: 65, fade: 55, color: '#000000', contact: 60 };

/** Dibuja la sombra de la capa `l` en un lienzo del tamaño del documento. */
export function renderCastShadow(l: Layer, p: ShadowParams): HTMLCanvasElement | null {
  const sil = silhouette(l, p.color); if (!sil) return null;
  const b = contentBounds(sil); if (!b) return null;
  const W = sil.width, H = sil.height, out = makeCanvas(W, H), ox = ctx2d(out);
  const yb = b.y + b.h, th = p.angle * Math.PI / 180, L = p.length / 100;
  // proyección: cada punto a altura h sobre la base se desplaza en la dirección de la sombra
  let m: [number, number, number, number, number, number];
  if (p.type === 'floor') {
    const a = L * Math.cos(th), bb = L * Math.sin(th) * (p.squash / 100);
    m = [1, 0, -a, bb, a * yb, yb * (1 - bb)];
  } else {
    // pared: la sombra cae detrás del objeto, desplazada y algo más grande cuanto más lejos está la pared
    const dx = Math.cos(th) * b.h * L * 0.25, dy = -Math.sin(th) * b.h * L * 0.25, s = 1 + L * 0.08, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    m = [s, 0, 0, s, cx - cx * s + dx, cy - cy * s + dy];
  }
  const flat = makeCanvas(W, H), fx = ctx2d(flat); fx.setTransform(...m); fx.drawImage(sil, 0, 0); fx.setTransform(1, 0, 0, 1, 0, 0);
  // varias versiones más o menos desenfocadas; cada píxel toma la que le toca según lo lejos que está del objeto
  const nL = 5, levels = Array.from({ length: nL }, (_, i) => blurred(flat, p.blur + (p.blurFar - p.blur) * (i / (nL - 1))));
  const fb = contentBounds(flat) ?? { x: 0, y: 0, w: W, h: H };
  const pad = Math.ceil(p.blurFar * 2.5) + 2, X0 = Math.max(0, fb.x - pad), Y0 = Math.max(0, fb.y - pad), X1 = Math.min(W, fb.x + fb.w + pad), Y1 = Math.min(H, fb.y + fb.h + pad);
  const w = X1 - X0, hh = Y1 - Y0; if (w < 1 || hh < 1) return out;
  const datas = levels.map(c => ctx2d(c).getImageData(X0, Y0, w, hh).data), o = ox.createImageData(w, hh), od = o.data;
  // «t» = 0 junto al objeto y 1 en el extremo de la sombra
  const bbProj = m[3], far = p.type === 'floor' ? Math.max(1, Math.abs(b.h * bbProj)) : 1;
  const aLen = Math.max(1, Math.abs(b.h * L * Math.cos(th)));
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    const gy = Y0 + y, gx = X0 + x;
    let t: number;
    if (p.type === 'floor') t = Math.abs(bbProj) > 0.05 ? clamp01(Math.abs(gy - yb) / far) : clamp01(Math.min(Math.abs(gx - b.x), Math.abs(gx - b.x - b.w)) / aLen);
    else t = 0.5; // en la pared, el mismo desenfoque en toda la sombra (intermedio)
    const f = t * (nL - 1), i0 = Math.min(nL - 2, Math.floor(f)), k = f - i0, i = (y * w + x) * 4;
    const A = datas[i0], B = datas[i0 + 1];
    const al = (A[i + 3] * (1 - k) + B[i + 3] * k) * (1 - (p.fade / 100) * t);
    od[i] = A[i]; od[i + 1] = A[i + 1]; od[i + 2] = A[i + 2]; od[i + 3] = al;
  }
  ox.putImageData(o, X0, Y0);
  // sombra de contacto: una mancha oscura y estrecha justo en la base del objeto
  if (p.contact > 0 && p.type === 'floor') {
    const c = makeCanvas(W, H), cx = ctx2d(c);
    cx.setTransform(1, 0, 0, 0.06, 0, yb * 0.94); cx.drawImage(sil, 0, 0); cx.setTransform(1, 0, 0, 1, 0, 0);
    ox.globalAlpha = p.contact / 100; ox.drawImage(blurred(c, Math.max(1.5, b.h * 0.012)), 0, 0); ox.globalAlpha = 1;
  }
  // opacidad general aplicada al final (la capa también se puede bajar luego)
  const fin = makeCanvas(W, H), fc = ctx2d(fin); fc.globalAlpha = p.opacity / 100; fc.drawImage(out, 0, 0);
  return fin;
}

export function castShadowDialog() {
  const d = app.doc, l = d?.active;
  if (!d || !l || !isRaster(l)) { app.toast('Elige la capa del objeto (recortado, con fondo transparente)', 'warn'); return; }
  const test = silhouette(l, '#000'); const tb = test && contentBounds(test);
  if (!tb) { app.toast('La capa está vacía', 'warn'); return; }
  if (tb.w >= d.width - 1 && tb.h >= d.height - 1) app.toast('Consejo: la sombra se ve bien con un objeto recortado (sin fondo). Prueba antes Capa › Quitar fondo', 'warn');
  const p: ShadowParams = { ...SHADOW_DEFAULTS };
  const sh = new RasterLayer('Sombra de ' + l.name, d.width, d.height); sh.blendMode = 'multiply';
  l.parent!.add(sh, l.parent!.children.indexOf(l));
  const update = () => { const c = renderCastShadow(l, p); if (c) { sh.canvas = c; sh.touch(); d.invalidate(); } };
  let t = 0; const later = () => { clearTimeout(t); t = window.setTimeout(update, 40); };
  const sl = (key: keyof ShadowParams, label: string, min: number, max: number, unit = '') => row(label, numberSlider({ min, max, value: p[key] as number, unit, onInput: v => { (p as any)[key] = v; later(); } }).el);
  const type = h('select', {}, h('option', { value: 'floor' }, 'En el suelo (en perspectiva)'), h('option', { value: 'wall' }, 'En la pared de detrás')) as HTMLSelectElement;
  type.onchange = () => { p.type = type.value as any; later(); };
  const col = h('input', { type: 'color', class: 'color-input', value: p.color }) as HTMLInputElement; col.oninput = () => { p.color = col.value; later(); };
  update();
  showDialog({ title: 'Sombra proyectada', width: 420, side: true, okLabel: 'Crear sombra',
    body: [row('Tipo', type), sl('angle', 'Dirección de la sombra', -180, 180, '°'), sl('length', 'Longitud', 5, 300, '%'), sl('squash', 'Inclinación del suelo', 5, 100, '%'),
      sl('blur', 'Desenfoque junto al objeto', 0, 40, 'px'), sl('blurFar', 'Desenfoque lejos', 0, 120, 'px'), sl('opacity', 'Opacidad', 1, 100, '%'), sl('fade', 'Desvanecer al alejarse', 0, 100, '%'), sl('contact', 'Sombra de contacto', 0, 100, '%'), row('Color', col),
      h('div', { class: 'hint' }, 'La sombra va en una capa propia debajo del objeto (en modo Multiplicar): puedes moverla, borrarla en parte o bajar su opacidad. 90° = hacia el fondo, 0° = a la derecha, 180° = a la izquierda, −90° = hacia delante.')],
    onOk: () => { clearTimeout(t); update(); d.setActive(l); d.commit('Sombra proyectada'); },
    onCancel: () => { clearTimeout(t); sh.parent?.remove(sh); d.invalidate(); },
  });
}

// ---- Extrusión 3D ---------------------------------------------------------------------------------
export type ExtrudeParams = { depth: number; angle: number; persp: number; shade: number; side: 'object' | 'color'; color: string; light: number };
export const EXTRUDE_DEFAULTS: ExtrudeParams = { depth: 40, angle: -45, persp: 0, shade: 55, side: 'object', color: '#2a2a2a', light: 30 };

/** Objeto con volumen: copias desplazadas hacia el fondo, sombreadas, y la cara delantera encima. */
export function renderExtrude(l: Layer, p: ExtrudeParams): HTMLCanvasElement | null {
  if (!isRaster(l)) return null;
  const src = (l as RasterLayer).canvas, b = contentBounds(src); if (!b) return null;
  const W = src.width, H = src.height, out = makeCanvas(W, H), ox = ctx2d(out);
  const th = p.angle * Math.PI / 180, dx = Math.cos(th), dy = -Math.sin(th), n = Math.max(1, Math.round(p.depth));
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  // cara lateral: la silueta en el color elegido (o el del objeto, oscurecido)
  const side = makeCanvas(W, H), sx = ctx2d(side);
  if (p.side === 'color') { sx.drawImage(src, 0, 0); sx.globalCompositeOperation = 'source-in'; sx.fillStyle = p.color; sx.fillRect(0, 0, W, H); }
  else { sx.drawImage(src, 0, 0); sx.globalCompositeOperation = 'source-atop'; sx.fillStyle = `rgba(0,0,0,${0.25 + p.shade / 100 * 0.5})`; sx.fillRect(0, 0, W, H); }
  sx.globalCompositeOperation = 'source-over';
  const tint = makeCanvas(W, H), tx = ctx2d(tint);
  for (let i = n; i >= 1; i--) {
    const k = i / n, s = 1 - (p.persp / 100) * k * 0.5;
    // las capas del fondo, más oscuras (sombreado del volumen); la luz aclara las cercanas al frente
    tx.clearRect(0, 0, W, H); tx.globalCompositeOperation = 'source-over'; tx.drawImage(side, 0, 0);
    tx.globalCompositeOperation = 'source-atop'; tx.fillStyle = `rgba(0,0,0,${(p.shade / 100) * 0.6 * k})`; tx.fillRect(0, 0, W, H);
    if (p.light > 0 && i < n * 0.15) { tx.fillStyle = `rgba(255,255,255,${(p.light / 100) * 0.4 * (1 - i / (n * 0.15))})`; tx.fillRect(0, 0, W, H); }
    tx.globalCompositeOperation = 'source-over';
    ox.save(); ox.translate(cx + dx * i, cy + dy * i); ox.scale(s, s); ox.translate(-cx, -cy); ox.drawImage(tint, 0, 0); ox.restore();
  }
  ox.drawImage(src, 0, 0);
  return out;
}
export function extrudeDialog() {
  const d = app.doc, l = d?.active;
  if (!d || !l || !isRaster(l)) { app.toast('Elige una capa de texto, forma o un objeto recortado', 'warn'); return; }
  const p: ExtrudeParams = { ...EXTRUDE_DEFAULTS };
  const res = new RasterLayer(l.name + ' 3D', d.width, d.height);
  l.parent!.add(res, l.parent!.children.indexOf(l) + 1); const wasVisible = l.visible; l.visible = false;
  const update = () => { const c = renderExtrude(l, p); if (c) { res.canvas = c; res.touch(); d.invalidate(); } };
  let t = 0; const later = () => { clearTimeout(t); t = window.setTimeout(update, 30); };
  const sl = (key: keyof ExtrudeParams, label: string, min: number, max: number, unit = '') => row(label, numberSlider({ min, max, value: p[key] as number, unit, onInput: v => { (p as any)[key] = v; later(); } }).el);
  const side = h('select', {}, h('option', { value: 'object' }, 'Los colores del objeto, más oscuros'), h('option', { value: 'color' }, 'Un color')) as HTMLSelectElement;
  const col = h('input', { type: 'color', class: 'color-input', value: p.color }) as HTMLInputElement;
  side.onchange = () => { p.side = side.value as any; later(); }; col.oninput = () => { p.color = col.value; if (p.side !== 'color') { p.side = 'color'; side.value = 'color'; } later(); };
  update();
  showDialog({ title: 'Extrusión 3D', width: 420, side: true, okLabel: 'Aplicar',
    body: [sl('depth', 'Profundidad', 1, 400, 'px'), sl('angle', 'Dirección', -180, 180, '°'), sl('persp', 'Perspectiva', 0, 100, '%'), sl('shade', 'Sombreado', 0, 100, '%'), sl('light', 'Brillo del borde', 0, 100, '%'), row('Laterales', side, col),
      h('div', { class: 'hint' }, 'Crea una capa nueva con el volumen; la original queda oculta debajo por si quieres volver a ella.')],
    onOk: () => { clearTimeout(t); update(); d.setActive(res); d.commit('Extrusión 3D'); },
    onCancel: () => { clearTimeout(t); res.parent?.remove(res); l.visible = wasVisible; d.invalidate(); },
  });
}
