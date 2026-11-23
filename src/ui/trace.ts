// Imagen › Calco de imagen: convierte una foto o un dibujo en formas vectoriales (como «Calco de imagen» de los
// programas de ilustración). Sigue los pasos que describe VectorCraft (https://github.com/storytold/vectorcraft,
// crates/trace, licencia MIT) a partir de ideas publicadas (el artículo de potrace y la cuantización de color):
//   1. reducir la imagen a unos pocos colores (umbral, niveles de gris o paleta por corte mediano + k-medias);
//   2. quitar manchas: las zonas más pequeñas que el umbral pasan al color vecino más común;
//   3. seguir el borde de cada color en lazos cerrados (con sus huecos);
//   4. convertir cada lazo en curvas suaves, conservando las esquinas de verdad.
// El resultado son capas vectoriales editables (una por color) y se puede guardar como SVG.

import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog, row } from './dialog';
import { ctx2d, makeCanvas } from '../core/canvas';
import { maskContours } from '../core/contour';
import { extractPalette } from './unique';
import { AdjustmentLayer, GroupLayer, PathPoint, tracePath } from '../core/layers';
import { FILTERS, defaultParams } from '../filters/registry';
import { surfaceBlur } from '../filters/more';

export type TraceMode = 'bw' | 'gray' | 'color';
export interface TraceOpts { mode: TraceMode; colors: number; threshold: number; noise: number; detail: number; corners: number; smoothPhoto: boolean }
export interface TracedColor { color: string; area: number; subpaths: { closed: boolean; pts: PathPoint[]; op?: number }[]; /** fondo de toda la imagen (sin forma) */ full?: boolean }

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const rgb = (s: string) => { const n = parseInt(s.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };

/** Lazo de puntos → curvas Bézier (Catmull-Rom), sin suavizar donde el giro es brusco (esquinas). */
export function smoothLoop(P: { x: number; y: number }[], cornerDeg: number, scale: number): PathPoint[] {
  const n = P.length, out: PathPoint[] = [], lim = Math.cos(cornerDeg * Math.PI / 180);
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n], p = P[i], b = P[(i + 1) % n];
    const v1x = p.x - a.x, v1y = p.y - a.y, v2x = b.x - p.x, v2y = b.y - p.y, l1 = Math.hypot(v1x, v1y) || 1, l2 = Math.hypot(v2x, v2y) || 1;
    const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
    const x = p.x * scale, y = p.y * scale;
    if (cos < lim) { out.push({ x, y, ix: x, iy: y, ox: x, oy: y }); continue; }   // esquina: sin curvar
    // tangente: de la anterior a la siguiente; cada asa mide un tercio de su tramo
    const tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty) || 1, ux = tx / tl, uy = ty / tl;
    out.push({ x, y, ix: x - ux * l1 / 3 * scale, iy: y - uy * l1 / 3 * scale, ox: x + ux * l2 / 3 * scale, oy: y + uy * l2 / 3 * scale });
  }
  return out;
}

/** Calca `src` (ya reducida al tamaño de trabajo); las coordenadas salen multiplicadas por `scale`. */
export function traceImage(src: HTMLCanvasElement, o: TraceOpts, scale: number): TracedColor[] {
  const W = src.width, H = src.height, n = W * H;
  let work = src;
  if (o.smoothPhoto) { const c = makeCanvas(W, H), x = ctx2d(c); x.drawImage(src, 0, 0); const im = x.getImageData(0, 0, W, H); surfaceBlur(im, 3, 28); x.putImageData(im, 0, 0); work = c; }
  const d = ctx2d(work).getImageData(0, 0, W, H).data;
  // 1. paleta y etiqueta de cada píxel (255 = transparente)
  let pal: number[][];
  if (o.mode === 'bw') pal = [[0, 0, 0], [255, 255, 255]];
  else if (o.mode === 'gray') { const k = Math.max(2, o.colors); pal = Array.from({ length: k }, (_, i) => { const v = Math.round(i * 255 / (k - 1)); return [v, v, v]; }); }
  else pal = extractPalette(work, Math.max(2, o.colors)).map(p => rgb(p.color));
  if (!pal.length) return [];
  const lab = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; if (d[i * 4 + 3] < 128) { lab[i] = 255; continue; }
    if (o.mode === 'bw') { lab[i] = 0.299 * r + 0.587 * g + 0.114 * b < o.threshold ? 0 : 1; continue; }
    if (o.mode === 'gray') { lab[i] = Math.round((0.299 * r + 0.587 * g + 0.114 * b) / 255 * (pal.length - 1)); continue; }
    let best = 0, bd = Infinity; for (let k = 0; k < pal.length; k++) { const q = pal[k], e = (r - q[0]) ** 2 * 0.3 + (g - q[1]) ** 2 * 0.59 + (b - q[2]) ** 2 * 0.11; if (e < bd) { bd = e; best = k; } }
    lab[i] = best;
  }
  // 2. manchas: zonas conectadas más pequeñas que `noise` píxeles pasan al color vecino más común
  if (o.noise > 0) for (let pass = 0; pass < 2; pass++) {
    const seen = new Uint8Array(n), stack: number[] = [], comp: number[] = [];
    for (let s = 0; s < n; s++) {
      if (seen[s] || lab[s] === 255) continue;
      const L = lab[s]; comp.length = 0; stack.push(s); seen[s] = 1; const nb = new Map<number, number>();
      while (stack.length) {
        const p = stack.pop()!; comp.push(p); const x = p % W, y = (p - x) / W;
        for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
          if (q < 0) continue; const lq = lab[q];
          if (lq === L) { if (!seen[q]) { seen[q] = 1; stack.push(q); } } else if (lq !== 255) nb.set(lq, (nb.get(lq) ?? 0) + 1);
        }
      }
      if (comp.length < o.noise && nb.size) { let bl = L, bc = -1; for (const [k, c] of nb) if (c > bc) { bc = c; bl = k; } for (const p of comp) lab[p] = bl; }
    }
  }
  // 3 y 4. bordes de cada color (ensanchados medio píxel para que no queden rendijas entre colores) y curvas
  const out: TracedColor[] = [];
  for (let k = 0; k < pal.length; k++) {
    const m = makeCanvas(W, H), mx = ctx2d(m), im = mx.createImageData(W, H); let area = 0;
    for (let i = 0; i < n; i++) if (lab[i] === k) { im.data[i * 4 + 3] = 255; area++; }
    if (!area) continue;
    mx.putImageData(im, 0, 0);
    // ensanchar 1 píxel por los lados: las zonas vecinas se solapan un poco y no se ve el fondo entre ellas
    const grow = makeCanvas(W, H), gx = ctx2d(grow); for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) gx.drawImage(m, dx * 0.5, dy * 0.5);
    const loops = maskContours(grow, o.detail).filter(l => l.length >= 3);
    if (!loops.length) continue;
    // el primer lazo suma; los demás alternan (par-impar): los huecos se restan y las islas dentro de huecos se suman
    const subpaths = loops.map((l, i) => ({ closed: true, pts: smoothLoop(l, o.corners, scale), op: i === 0 ? 1 : 0 }));
    out.push({ color: hex(pal[k][0], pal[k][1], pal[k][2]), area, subpaths });
  }
  // los colores más extensos debajo; si la imagen no tiene transparencia, el primero hace de fondo de toda la imagen
  // (así no puede verse ninguna rendija entre colores)
  out.sort((a, b) => b.area - a.area);
  if (out.length && !lab.includes(255)) out[0].full = true;
  return out;
}

/** El calco como SVG (un trazado por color, regla par-impar para los huecos). */
export function traceToSVG(t: TracedColor[], W: number, H: number) {
  const f = (v: number) => +v.toFixed(2);
  const paths = t.map(c => {
    if (c.full) return `<rect width="${W}" height="${H}" fill="${c.color}"/>`;
    let dd = '';
    for (const sp of c.subpaths) {
      const p = sp.pts; if (!p.length) continue; dd += `M${f(p[0].x)} ${f(p[0].y)}`;
      for (let i = 1; i <= p.length; i++) { const a = p[i - 1], b = p[i % p.length]; dd += `C${f(a.ox)} ${f(a.oy)} ${f(b.ix)} ${f(b.iy)} ${f(b.x)} ${f(b.y)}`; }
      dd += 'Z';
    }
    return `<path fill="${c.color}" fill-rule="evenodd" d="${dd}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">\n${paths.join('\n')}\n</svg>\n`;
}

const PRESETS: Record<string, Partial<TraceOpts> & { label: string }> = {
  logo: { label: 'Logotipo (pocos colores planos)', mode: 'color', colors: 4, noise: 30, detail: 1.2, corners: 60, smoothPhoto: false },
  bw: { label: 'Blanco y negro (dibujo, firma, texto)', mode: 'bw', threshold: 128, noise: 12, detail: 1, corners: 70, smoothPhoto: false },
  sketch: { label: 'Boceto a lápiz', mode: 'bw', threshold: 150, noise: 4, detail: 0.8, corners: 50, smoothPhoto: false },
  gray: { label: 'Escala de grises', mode: 'gray', colors: 5, noise: 20, detail: 1.2, corners: 60, smoothPhoto: true },
  poster: { label: 'Póster (6 colores)', mode: 'color', colors: 6, noise: 40, detail: 1.4, corners: 55, smoothPhoto: true },
  photo: { label: 'Foto (16 colores)', mode: 'color', colors: 16, noise: 16, detail: 1, corners: 45, smoothPhoto: true },
};

export function traceDialog() {
  const d = app.doc; if (!d) return;
  const src = d.activeRaster()?.canvas ?? d.getComposite();
  let o: TraceOpts = { mode: 'color', colors: 6, threshold: 128, noise: 40, detail: 1.4, corners: 55, smoothPhoto: true };
  const preset = h('select', {}, ...Object.entries(PRESETS).map(([k, p]) => h('option', { value: k, selected: k === 'poster' }, p.label))) as HTMLSelectElement;
  const modeSel = h('select', {}, h('option', { value: 'color' }, 'Color'), h('option', { value: 'gray' }, 'Escala de grises'), h('option', { value: 'bw' }, 'Blanco y negro')) as HTMLSelectElement;
  const pv = h('canvas', { class: 'trace-pv' }) as HTMLCanvasElement, info = h('div', { class: 'hint' });
  const sl: Record<string, ReturnType<typeof numberSlider>> = {
    colors: numberSlider({ min: 2, max: 30, value: o.colors, onInput: v => { o.colors = v; run(); } }),
    threshold: numberSlider({ min: 1, max: 254, value: o.threshold, onInput: v => { o.threshold = v; run(); } }),
    noise: numberSlider({ min: 0, max: 400, value: o.noise, unit: 'px', onInput: v => { o.noise = v; run(); } }),
    detail: numberSlider({ min: 0.3, max: 4, step: 0.1, value: o.detail, onInput: v => { o.detail = v; run(); } }),
    corners: numberSlider({ min: 10, max: 120, value: o.corners, unit: '°', onInput: v => { o.corners = v; run(); } }),
  };
  const smooth = h('input', { type: 'checkbox', checked: o.smoothPhoto }) as HTMLInputElement;
  const rowColors = row('Colores', sl.colors.el), rowThr = row('Umbral', sl.threshold.el);
  // tamaño de trabajo: hasta 900 px (calcar es costoso; el resultado vectorial se escala sin perder calidad)
  const k = Math.min(1, 900 / Math.max(src.width, src.height)), tw = Math.max(1, Math.round(src.width * k)), th = Math.max(1, Math.round(src.height * k));
  const small = makeCanvas(tw, th); ctx2d(small).drawImage(src, 0, 0, tw, th);
  pv.width = Math.min(420, tw); pv.height = Math.round(pv.width * th / tw);
  let result: TracedColor[] = [], tm = 0;
  const sync = () => { modeSel.value = o.mode; rowColors.style.display = o.mode === 'bw' ? 'none' : ''; rowThr.style.display = o.mode === 'bw' ? '' : 'none'; smooth.checked = o.smoothPhoto; for (const key of Object.keys(sl)) sl[key].set((o as any)[key]); };
  const run = () => {
    clearTimeout(tm); info.textContent = 'Calculando…';
    tm = window.setTimeout(() => {
      const t0 = performance.now();
      result = traceImage(small, o, 1 / k);
      // vista previa: las formas calcadas
      const c = ctx2d(pv); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, pv.width, pv.height); c.fillStyle = '#fff'; c.fillRect(0, 0, pv.width, pv.height);
      const s = pv.width / src.width; c.setTransform(s, 0, 0, s, 0, 0);
      for (const col of result) { c.fillStyle = col.color; if (col.full) { c.fillRect(0, 0, src.width, src.height); continue; } c.beginPath(); for (const sp of col.subpaths) tracePath(c, sp.pts, true); c.fill('evenodd'); }
      const nodes = result.reduce((a, r) => a + r.subpaths.reduce((b, sp) => b + sp.pts.length, 0), 0);
      info.textContent = `${result.length} colores · ${result.reduce((a, r) => a + r.subpaths.length, 0)} formas · ${nodes} puntos · ${Math.round(performance.now() - t0)} ms`;
    }, 120);
  };
  preset.onchange = () => { o = { ...o, ...PRESETS[preset.value] } as TraceOpts; delete (o as any).label; sync(); run(); };
  modeSel.onchange = () => { o.mode = modeSel.value as TraceMode; sync(); run(); };
  smooth.onchange = () => { o.smoothPhoto = smooth.checked; run(); };
  const svgBtn = h('button', { class: 'btn', type: 'button' }, 'Guardar SVG');
  svgBtn.onclick = async () => { if (!result.length) return; const io = await import('../io/files'); await io.saveBlob(new Blob([traceToSVG(result, src.width, src.height)], { type: 'image/svg+xml' }), d.name.replace(/\.[^.]+$/, '') + ' (calco).svg'); app.toast('SVG guardado'); };
  showDialog({ title: 'Calco de imagen', width: 470, okLabel: 'Crear capas vectoriales', extraButtons: [svgBtn],
    body: [h('div', { class: 'hint' }, 'Convierte la imagen en formas vectoriales: se pueden ampliar sin perder calidad, cambiar de color y guardar como SVG.'),
      row('Ajuste', preset), row('Modo', modeSel), rowColors, rowThr, row('Ignorar manchas de', sl.noise.el), row('Simplificar', sl.detail.el), row('Esquinas desde', sl.corners.el),
      row('', h('label', { class: 'check' }, smooth, ' Suavizar antes (fotos)')), pv, info],
    onOk: () => {
      if (!result.length) return;
      const def = FILTERS.find(f => f.id === 'solidfill')!, g = new GroupLayer('Calco de imagen');
      for (const col of result) { const pr = defaultParams(def); pr.color = col.color; const l = new AdjustmentLayer((col.full ? 'Fondo ' : 'Color ') + col.color, 'solidfill', pr); if (!col.full) l.vmask = { subpaths: col.subpaths, enabled: true }; g.add(l); }
      d.insertAboveActive(g); d.setActive(g); d.invalidate(); d.commit('Calco de imagen');
      app.toast('Calco creado: cada color es una capa vectorial (cámbiale el color en Propiedades)');
    } });
  sync(); run();
}
