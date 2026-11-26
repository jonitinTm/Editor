// Imagen › Expandir imagen: amplía el lienzo a un formato (1:1, 4:5, 9:16…) o con un margen, y rellena lo nuevo
// según el contenido de la foto (sin IA ni servidores: reconstrucción por parches de la propia imagen).
import { app } from './app';
import { h } from './dom';
import { showDialog, row } from './dialog';
import { makeCanvas, ctx2d, cloneCanvas, getPixels, putPixels } from '../core/canvas';
import { getPaintTarget, setTargetCanvas } from '../tools/paint';

type Side = 'center' | 'top' | 'bottom' | 'left' | 'right';
const lum = (d: Uint8ClampedArray, i: number) => d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
/** Peso de «zona lisa» a lo largo del borde (1 = lisa, 0 = con textura), suavizado para que no haya saltos. */
function smoothness(n: number, texture: (i: number) => number): Float32Array {
  const raw = new Float32Array(n); for (let i = 0; i < n; i++) raw[i] = Math.max(0, Math.min(1, (7 - texture(i)) / 4));
  const out = new Float32Array(n), R = Math.max(2, Math.round(n * 0.03));
  let acc = 0; for (let i = -R; i <= R; i++) acc += raw[Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < n; i++) { out[i] = acc / (2 * R + 1); acc += raw[Math.min(n - 1, i + R + 1)] - raw[Math.max(0, i - R)]; }
  return out;
}
const RATIOS: [string, number][] = [['1:1', 1], ['4:5', 4 / 5], ['3:4', 3 / 4], ['2:3', 2 / 3], ['9:16', 9 / 16], ['16:9', 16 / 9], ['3:2', 3 / 2], ['4:3', 4 / 3]];

/** Tamaño y posición nuevos para un formato o un margen (en tanto por uno de cada lado). */
export function expandGeometry(w: number, h: number, mode: string, margin: number, side: Side) {
  let W = w, H = h;
  if (mode === 'margin') { W = Math.round(w * (1 + 2 * margin)); H = Math.round(h * (1 + 2 * margin)); }
  else { const r = RATIOS.find(x => x[0] === mode)![1]; if (w / h < r) W = Math.round(h * r); else H = Math.round(w / r); }
  // dónde queda la foto: centrada, o pegada al lado contrario del que crece
  const dx = side === 'left' ? W - w : side === 'right' ? 0 : Math.round((W - w) / 2);
  const dy = side === 'top' ? H - h : side === 'bottom' ? 0 : Math.round((H - h) / 2);
  return { W, H, dx, dy };
}

/** Amplía el lienzo y rellena la zona nueva de la capa activa según el contenido. */
export async function expandImage(mode: string, margin: number, side: Side): Promise<boolean> {
  const d = app.doc; if (!d) return false;
  const { W, H, dx, dy } = expandGeometry(d.width, d.height, mode, margin, side);
  if (W === d.width && H === d.height) { app.toast('La imagen ya tiene ese formato', 'warn'); return false; }
  if (W * H > 120e6) { app.toast('La imagen resultante sería demasiado grande para este dispositivo', 'warn'); return false; }
  const ow = d.width, oh = d.height;
  d.resizeCanvas(W, H, dx, dy);
  const t = getPaintTarget();
  if (!t || t.isMask) { d.commit('Expandir imagen'); app.viewport.fit(true); return true; }
  app.toast('Rellenando lo nuevo según la foto…');
  await new Promise(r => setTimeout(r, 30));
  const out = cloneCanvas(t.canvas);
  // cada lado por separado, y solo con trozos de la franja de la foto que toca ese lado (cielo con cielo, suelo con
  // suelo): así no se copian partes del sujeto. Primero arriba y abajo (a todo el ancho) y luego los lados.
  const { inpaint } = await import('../filters/inpaint');
  const sides: { side: Side; strip: { x: number; y: number; w: number; h: number } }[] = [];
  if (dy > 0) sides.push({ side: 'top', strip: { x: 0, y: 0, w: W, h: dy } });
  if (dy + oh < H) sides.push({ side: 'bottom', strip: { x: 0, y: dy + oh, w: W, h: H - dy - oh } });
  if (dx > 0) sides.push({ side: 'left', strip: { x: 0, y: 0, w: dx, h: H } });
  if (dx + ow < W) sides.push({ side: 'right', strip: { x: dx + ow, y: 0, w: W - dx - ow, h: H } });
  for (const { side, strip } of sides) {
    const vert = side === 'top' || side === 'bottom', depth = vert ? strip.h : strip.w, size = vert ? oh : ow;
    const band = Math.max(24, Math.min(Math.round(size * 0.4), Math.round(depth * 1.6)));
    // zona de trabajo: la franja nueva y la banda de foto pegada a ella
    const reg = side === 'top' ? { x: 0, y: 0, w: W, h: Math.min(H, dy + band) }
      : side === 'bottom' ? { x: 0, y: Math.max(0, strip.y - band), w: W, h: H - Math.max(0, strip.y - band) }
      : side === 'left' ? { x: 0, y: 0, w: Math.min(W, dx + band), h: H }
      : { x: Math.max(0, strip.x - band), y: 0, w: W - Math.max(0, strip.x - band), h: H };
    const O = getPixels(out, reg), hole = new Uint8Array(reg.w * reg.h);
    for (let y = 0; y < reg.h; y++) for (let x = 0; x < reg.w; x++) {
      const X = x + reg.x, Y = y + reg.y;
      // hueco: lo que aún no tiene foto (lo nuevo de este lado y lo de otros lados que todavía no se ha rellenado)
      const filledBefore = sides.indexOf(sides.find(s2 => s2.side === side)!);
      let inHole = X >= strip.x && X < strip.x + strip.w && Y >= strip.y && Y < strip.y + strip.h;
      if (!inHole) { const inPhoto = X >= dx && X < dx + ow && Y >= dy && Y < dy + oh; if (!inPhoto && !sides.slice(0, filledBefore).some(s2 => X >= s2.strip.x && X < s2.strip.x + s2.strip.w && Y >= s2.strip.y && Y < s2.strip.y + s2.strip.h)) inHole = true; }
      hole[y * reg.w + x] = inHole ? 1 : 0;
    }
    const R = inpaint(O, hole, 960);
    // unión sin costura: junto al borde, el relleno parte del color exacto del borde y se funde poco a poco
    const N = Math.max(2, Math.min(Math.round(depth * 0.3), Math.round(size * 0.05)));
    const at = (x: number, y: number) => ((y - reg.y) * reg.w + (x - reg.x)) * 4, d2 = R.data;
    const smooth = (k: number) => { const u = k / N; return u * u * (3 - 2 * u); };
    // color del borde suavizado (media de unos píxeles a lo largo y hacia dentro): si no, cada píxel del borde se
    // estira y salen rayas
    const rad = Math.max(2, Math.round(size * 0.012)), inner = Math.max(1, Math.round(rad / 2));
    const edgeAvg = (x: number, y: number, along: 'x' | 'y', into: number) => {
      const o = [0, 0, 0, 0]; let n = 0;
      for (let k = -rad; k <= rad; k++) for (let j = 0; j < inner; j++) {
        const X = along === 'x' ? x + k : x + into * j, Y = along === 'x' ? y + into * j : y + k;
        if (X < reg.x || Y < reg.y || X >= reg.x + reg.w || Y >= reg.y + reg.h) continue;
        const q = at(X, Y); for (let c = 0; c < 4; c++) o[c] += O.data[q + c]; n++;
      }
      return o.map(v => v / Math.max(1, n));
    };
    if (vert) {
      const edgeY = side === 'top' ? dy : dy + oh - 1, dir = side === 'top' ? -1 : 1;
      const E = Array.from({ length: ow }, (_, i) => edgeAvg(dx + i, edgeY, 'x', -dir));
      // zonas lisas (cielo, pared, fondo de estudio): se prolonga el color del borde en vez de copiar trozos
      const w = smoothness(ow, i => { const X = dx + i; let s = 0, n = 0; for (let j = 0; j < Math.min(band, oh) - 1; j += 2) { const Y = edgeY - dir * j, Y2 = Y - dir; if (Y2 < reg.y || Y2 >= reg.y + reg.h) continue; const a1 = at(X, Y), a2 = at(X, Y2), a3 = at(X + 1 < reg.x + reg.w ? X + 1 : X - 1, Y); s += Math.abs(lum(O.data, a1) - lum(O.data, a2)) + Math.abs(lum(O.data, a1) - lum(O.data, a3)); n++; } return n ? s / n : 99; });
      for (let k = 1; k <= depth; k++) { const y = edgeY + dir * k; for (let x = dx; x < dx + ow; x++) { const ww = w[x - dx]; if (ww <= 0) continue; const e = E[x - dx], i = at(x, y); for (let c = 0; c < 4; c++) d2[i + c] = d2[i + c] * (1 - ww) + e[c] * ww; } }
      for (let k = 1; k <= Math.min(N, depth); k++) { const y = edgeY + dir * k, tk = smooth(k); for (let x = dx; x < dx + ow; x++) { const e = E[x - dx], i = at(x, y); for (let c = 0; c < 4; c++) d2[i + c] = e[c] * (1 - tk) + d2[i + c] * tk; } }
    } else {
      const edgeX = side === 'left' ? dx : dx + ow - 1, dir = side === 'left' ? -1 : 1;
      const E = Array.from({ length: H }, (_, y) => edgeAvg(edgeX, y, 'y', -dir));
      const w = smoothness(H, Y => { let s = 0, n = 0; for (let j = 0; j < Math.min(band, ow) - 1; j += 2) { const X = edgeX - dir * j, X2 = X - dir; if (X2 < reg.x || X2 >= reg.x + reg.w) continue; const a1 = at(X, Y), a2 = at(X2, Y), a3 = at(X, Y + 1 < H ? Y + 1 : Y - 1); s += Math.abs(lum(O.data, a1) - lum(O.data, a2)) + Math.abs(lum(O.data, a1) - lum(O.data, a3)); n++; } return n ? s / n : 99; });
      for (let k = 1; k <= depth; k++) { const x = edgeX + dir * k; for (let y = 0; y < H; y++) { const ww = w[y]; if (ww <= 0) continue; const e = E[y], i = at(x, y); for (let c = 0; c < 4; c++) d2[i + c] = d2[i + c] * (1 - ww) + e[c] * ww; } }
      for (let k = 1; k <= Math.min(N, depth); k++) { const x = edgeX + dir * k, tk = smooth(k); for (let y = 0; y < H; y++) { const e = E[y], i = at(x, y); for (let c = 0; c < 4; c++) d2[i + c] = e[c] * (1 - tk) + d2[i + c] * tk; } }
    }
    putPixels(out, R, reg.x, reg.y);
  }
  // si la foto era opaca (lo normal), lo nuevo también: la mezcla de las esquinas deja algún píxel casi opaco
  const orig = getPixels(t.canvas, { x: dx, y: dy, w: ow, h: oh }).data; let opaque = true;
  for (let i = 3; i < orig.length; i += 4 * 97) if (orig[i] < 255) { opaque = false; break; }
  if (opaque) {
    const all = getPixels(out), q = all.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < dx || x >= dx + ow || y < dy || y >= dy + oh) { const i = (y * W + x) * 4 + 3; if (q[i] > 0) q[i] = 255; }
    putPixels(out, all, 0, 0);
  }
  setTargetCanvas(t, out, 'auto');
  d.commit('Expandir imagen');
  app.viewport.fit(true);
  return true;
}

export function expandDialog() {
  const d = app.doc; if (!d) return;
  const mode = h('select', {}, ...RATIOS.map(([k]) => h('option', { value: k }, k)), h('option', { value: 'margin' }, 'Margen alrededor')) as HTMLSelectElement;
  const margin = h('input', { type: 'number', min: 1, max: 100, value: 15, style: { width: '70px' } }) as HTMLInputElement;
  const side = h('select', {},
    h('option', { value: 'center' }, 'Por todos los lados (centrada)'), h('option', { value: 'top' }, 'Hacia arriba'), h('option', { value: 'bottom' }, 'Hacia abajo'),
    h('option', { value: 'left' }, 'Hacia la izquierda'), h('option', { value: 'right' }, 'Hacia la derecha')) as HTMLSelectElement;
  const info = h('div', { class: 'hint' });
  const mRow = row('Margen', margin, '%');
  const upd = () => {
    mRow.style.display = mode.value === 'margin' ? '' : 'none';
    const g = expandGeometry(d.width, d.height, mode.value, (+margin.value || 0) / 100, side.value as Side);
    info.textContent = g.W === d.width && g.H === d.height ? 'La imagen ya tiene ese formato.' : `${d.width} × ${d.height} → ${g.W} × ${g.H} px`;
  };
  mode.onchange = upd; margin.oninput = upd; side.onchange = upd;
  // por defecto, el formato vertical de las redes si la foto es apaisada (y al revés)
  mode.value = d.width > d.height ? '4:5' : '16:9'; upd();
  showDialog({
    title: 'Expandir imagen',
    body: [h('div', { class: 'hint' }, 'Amplía la foto a otro formato y rellena lo nuevo con lo que hay alrededor (cielo, suelo, paredes, fondos…). Funciona mejor con fondos sencillos. Se aplica a la capa elegida; Ctrl+Z lo deshace.'),
      row('Formato', mode), mRow, row('Crece', side), info],
    okLabel: 'Expandir',
    onOk: () => expandImage(mode.value, (+margin.value || 0) / 100, side.value as Side),
  });
}
