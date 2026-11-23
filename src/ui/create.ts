// Crear sin saber diseño (funciones propias de Editor):
// · Plantillas editables (post de oferta, historia, miniatura de YouTube, invitación, tarjeta, frase, cartel, meme).
// · Collage automático con varias fotos.
// · Efectos de texto en un clic (neón, 3D, contorno, retro, dorado, pegatina…).
// · Fondos generativos (degradado de malla, burbujas, ondas, puntos).
// · Código QR como capa.
// · Armonías de color a partir del color frontal.

import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog, row } from './dialog';
import { EditorDocument } from '../core/document';
import { GroupLayer, RasterLayer, ShapeLayer, TextLayer, type LayerStyles, type PathPoint, type TextProps, type ShapeProps } from '../core/layers';
import { BEVEL_DEFAULT } from '../core/bevel';
import { ctx2d, makeCanvas } from '../core/canvas';
import { encodeQR } from '../io/qr';
import { icon } from './icons';

type R = { x: number; y: number; w: number; h: number };

// ---- Piezas para construir diseños ---------------------------------------------------------------------
function roundRectPath(r: R, rad: number): PathPoint[] {
  const k = 0.5523, q = Math.max(0, Math.min(rad, r.w / 2, r.h / 2)), x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
  if (q < 0.5) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => ({ x, y, ix: x, iy: y, ox: x, oy: y }));
  return [
    { x: x0 + q, y: y0, ix: x0 + q - q * k, iy: y0, ox: x0 + q, oy: y0 }, { x: x1 - q, y: y0, ix: x1 - q, iy: y0, ox: x1 - q + q * k, oy: y0 },
    { x: x1, y: y0 + q, ix: x1, iy: y0 + q - q * k, ox: x1, oy: y0 + q }, { x: x1, y: y1 - q, ix: x1, iy: y1 - q, ox: x1, oy: y1 - q + q * k },
    { x: x1 - q, y: y1, ix: x1 - q + q * k, iy: y1, ox: x1 - q, oy: y1 }, { x: x0 + q, y: y1, ix: x0 + q, iy: y1, ox: x0 + q - q * k, oy: y1 },
    { x: x0, y: y1 - q, ix: x0, iy: y1 - q + q * k, ox: x0, oy: y1 - q }, { x: x0, y: y0 + q, ix: x0, iy: y0 + q, ox: x0, oy: y0 + q - q * k },
  ];
}
function ellipsePath(r: R): PathPoint[] {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2, ry = r.h / 2, k = 0.5523;
  return [{ x: cx, y: cy - ry, ix: cx - rx * k, iy: cy - ry, ox: cx + rx * k, oy: cy - ry }, { x: cx + rx, y: cy, ix: cx + rx, iy: cy - ry * k, ox: cx + rx, oy: cy + ry * k }, { x: cx, y: cy + ry, ix: cx + rx * k, iy: cy + ry, ox: cx - rx * k, oy: cy + ry }, { x: cx - rx, y: cy, ix: cx - rx, iy: cy + ry * k, ox: cx - rx, oy: cy - ry * k }];
}
/** Marco para foto (grupo con máscara vectorial y un relleno provisional). */
function frame(d: EditorDocument, name: string, r: R, shape: 'rect' | 'ellipse' = 'rect', radius = 0): GroupLayer {
  const g = new GroupLayer(name); g.frame = true;
  g.vmask = { subpaths: [{ closed: true, pts: shape === 'ellipse' ? ellipsePath(r) : roundRectPath(r, radius) }], enabled: true };
  const ph = new RasterLayer('Vacío', d.width, d.height), x = ctx2d(ph.canvas);
  const gr = x.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h); gr.addColorStop(0, '#c9ced6'); gr.addColorStop(1, '#e6e9ee'); x.fillStyle = gr; x.fillRect(r.x, r.y, r.w, r.h);
  // icono de foto en el centro, para que se entienda que ahí va una imagen
  const s = Math.min(r.w, r.h) * 0.18, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  x.strokeStyle = '#8b929c'; x.lineWidth = Math.max(2, s / 10); x.lineJoin = 'round';
  x.strokeRect(cx - s, cy - s * 0.75, s * 2, s * 1.5); x.beginPath(); x.moveTo(cx - s, cy + s * 0.5); x.lineTo(cx - s * 0.3, cy - s * 0.1); x.lineTo(cx + s * 0.2, cy + s * 0.35); x.lineTo(cx + s * 0.5, cy + s * 0.1); x.lineTo(cx + s, cy + s * 0.5); x.stroke();
  x.beginPath(); x.arc(cx + s * 0.45, cy - s * 0.35, s * 0.15, 0, 7); x.stroke();
  // el aviso se encoge para caber en el marco
  const msg = 'Toca dos veces para poner tu foto'; let fs = Math.max(12, Math.round(s * 0.42));
  x.font = `600 ${fs}px system-ui, sans-serif`; const mw = x.measureText(msg).width; if (mw > r.w * 0.86) { fs = Math.max(9, Math.floor(fs * r.w * 0.86 / mw)); x.font = `600 ${fs}px system-ui, sans-serif`; }
  x.fillStyle = '#6b727c'; x.textAlign = 'center'; x.fillText(msg, cx, cy + s * 1.35);
  ph.touch(); (ph as any).framePlaceholder = true; g.add(ph);
  return g;
}
function text(d: EditorDocument, t: string, x: number, y: number, o: Partial<TextProps> & { size: number }, styles?: LayerStyles): TextLayer {
  const l = new TextLayer(t.split('\n')[0].slice(0, 30), d.width, d.height, { text: t, font: 'Montserrat', color: '#111111', bold: false, italic: false, align: 'left', lineHeight: 1.15, tracking: 0, x, y, ...o } as TextProps);
  if (styles) l.styles = styles;
  return l;
}
function shape(d: EditorDocument, name: string, p: Partial<ShapeProps> & { shape: ShapeProps['shape']; x0: number; y0: number; x1: number; y1: number }, styles?: LayerStyles): ShapeLayer {
  const l = new ShapeLayer(name, d.width, d.height, { fill: '#000000', stroke: null, strokeWidth: 4, radius: 0, ...p } as ShapeProps);
  if (styles) l.styles = styles;
  return l;
}
function fillBg(d: EditorDocument, paint: (x: CanvasRenderingContext2D, W: number, H: number) => void): RasterLayer {
  const l = new RasterLayer('Fondo', d.width, d.height); paint(ctx2d(l.canvas), d.width, d.height); l.touch(); return l;
}
const lin = (x: CanvasRenderingContext2D, W: number, H: number, cols: string[], vertical = false) => { const g = vertical ? x.createLinearGradient(0, 0, 0, H) : x.createLinearGradient(0, 0, W, H); cols.forEach((c, i) => g.addColorStop(i / (cols.length - 1), c)); x.fillStyle = g; x.fillRect(0, 0, W, H); };

// ---- Plantillas ----------------------------------------------------------------------------------------------
type Template = { id: string; name: string; desc: string; w: number; h: number; build: (d: EditorDocument) => void };
export const TEMPLATES: Template[] = [
  { id: 'sale', name: 'Oferta (Instagram)', desc: '1080 × 1080', w: 1080, h: 1080, build: d => {
    d.root.add(fillBg(d, (x, W, H) => lin(x, W, H, ['#ff5f6d', '#ffc371'])));
    d.root.add(frame(d, 'Foto del producto', { x: 540, y: 140, w: 470, h: 620 }, 'rect', 36));
    d.root.add(text(d, 'OFERTA', 70, 150, { size: 140, bold: true, color: '#ffffff', font: 'Anton', tracking: 20 }, { shadow: { enabled: true, color: '#7a1020', opacity: 0.35, angle: 120, distance: 8, blur: 12 } }));
    d.root.add(text(d, 'en toda la\ncolección', 75, 360, { size: 58, color: '#ffffff', bold: true, lineHeight: 1.1 }));
    d.root.add(shape(d, 'Insignia', { shape: 'star', sides: 16, inner: 0.85, x0: 70, y0: 560, x1: 380, y1: 870, fill: '#ffffff' }, { shadow: { enabled: true, color: '#000000', opacity: 0.2, angle: 120, distance: 10, blur: 18 } }));
    d.root.add(text(d, '-30%', 75, 664, { size: 92, bold: true, color: '#ff5f6d', font: 'Anton', boxWidth: 300, align: 'center' }));
    d.root.add(text(d, 'Solo esta semana · tutienda.com', 70, 960, { size: 40, color: '#ffffff' }));
  } },
  { id: 'story', name: 'Historia', desc: '1080 × 1920', w: 1080, h: 1920, build: d => {
    d.root.add(fillBg(d, (x, W, H) => { x.fillStyle = '#101418'; x.fillRect(0, 0, W, H); }));
    d.root.add(frame(d, 'Foto', { x: 0, y: 0, w: 1080, h: 1250 }));
    d.root.add(shape(d, 'Barra', { shape: 'rect', x0: 80, y0: 1340, x1: 200, y1: 1352, fill: '#ffd166' }));
    d.root.add(text(d, 'Nuevo en\nnuestro blog', 80, 1390, { size: 110, bold: true, color: '#ffffff', lineHeight: 1.05 }));
    d.root.add(text(d, 'Desliza hacia arriba para leer más', 80, 1680, { size: 44, color: '#c9d1d9' }));
  } },
  { id: 'youtube', name: 'Miniatura de YouTube', desc: '1280 × 720', w: 1280, h: 720, build: d => {
    d.root.add(fillBg(d, (x, W, H) => lin(x, W, H, ['#1e1e2f', '#3a1c71'])));
    d.root.add(frame(d, 'Foto (persona o tema)', { x: 690, y: 0, w: 590, h: 720 }));
    d.root.add(text(d, 'CÓMO LO\nHICE EN\n7 DÍAS', 60, 80, { size: 140, bold: true, font: 'Anton', color: '#ffffff', lineHeight: 0.98 }, { stroke: { enabled: true, color: '#000000', size: 10, position: 'outside' }, shadow: { enabled: true, color: '#000000', opacity: 0.6, angle: 120, distance: 12, blur: 6 } }));
    d.root.add(shape(d, 'Flecha', { shape: 'arrow', x0: 520, y0: 560, x1: 700, y1: 470, fill: '#ffd400', strokeWidth: 30 }, { stroke: { enabled: true, color: '#000000', size: 6, position: 'outside' } }));
  } },
  { id: 'invite', name: 'Invitación', desc: '1080 × 1350', w: 1080, h: 1350, build: d => {
    d.root.add(fillBg(d, (x, W, H) => { lin(x, W, H, ['#fdf6ec', '#f3e3d3'], true); x.strokeStyle = '#c9a66b'; x.lineWidth = 4; x.strokeRect(50, 50, W - 100, H - 100); x.lineWidth = 1.5; x.strokeRect(70, 70, W - 140, H - 140); }));
    d.root.add(frame(d, 'Foto', { x: 390, y: 150, w: 300, h: 300 }, 'ellipse'));
    d.root.add(text(d, 'Estás invitado', 140, 520, { size: 46, font: 'Playfair Display', italic: true, color: '#8a6d3b', align: 'center', boxWidth: 800 }));
    d.root.add(text(d, 'Laura & Daniel', 140, 600, { size: 110, font: 'Playfair Display', color: '#3d2b1f', align: 'center', boxWidth: 800 }));
    d.root.add(text(d, 'SÁBADO 14 DE JUNIO · 18:00', 140, 790, { size: 38, color: '#3d2b1f', tracking: 120, align: 'center', boxWidth: 800 }));
    d.root.add(text(d, 'Finca Los Olivos\nCamino del Río, 12', 140, 880, { size: 38, color: '#6b5444', align: 'center', boxWidth: 800, lineHeight: 1.4 }));
    d.root.add(text(d, 'Confirma tu asistencia antes del 1 de junio', 140, 1130, { size: 30, italic: true, color: '#8a6d3b', align: 'center', boxWidth: 800 }));
  } },
  { id: 'card', name: 'Tarjeta de visita', desc: '1050 × 600 (8,9 × 5 cm)', w: 1050, h: 600, build: d => {
    d.ppi = 300;
    d.root.add(fillBg(d, (x, W, H) => { x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H); }));
    d.root.add(shape(d, 'Franja', { shape: 'rect', x0: 0, y0: 0, x1: 300, y1: 600, fill: '#0f766e' }));
    d.root.add(text(d, 'AB', 60, 220, { size: 140, bold: true, color: '#ffffff', font: 'Playfair Display' }));
    d.root.add(text(d, 'Ana Blanco', 360, 150, { size: 64, bold: true, color: '#0f172a' }));
    d.root.add(text(d, 'Diseñadora gráfica', 362, 235, { size: 34, color: '#0f766e' }));
    d.root.add(text(d, '+34 600 123 456\nana@estudio.com\nestudio.com', 362, 340, { size: 30, color: '#334155', lineHeight: 1.5 }));
  } },
  { id: 'quote', name: 'Frase', desc: '1080 × 1080', w: 1080, h: 1080, build: d => {
    d.root.add(fillBg(d, (x, W, H) => lin(x, W, H, ['#0f2027', '#2c5364'])));
    d.root.add(text(d, '“', 120, 90, { size: 320, font: 'Playfair Display', color: '#7dd3fc' }));
    d.root.add(text(d, 'La creatividad es la inteligencia divirtiéndose.', 140, 380, { size: 76, font: 'Playfair Display', color: '#ffffff', boxWidth: 800, lineHeight: 1.25 }));
    d.root.add(shape(d, 'Línea', { shape: 'rect', x0: 140, y0: 820, x1: 260, y1: 826, fill: '#7dd3fc' }));
    d.root.add(text(d, 'ALBERT EINSTEIN', 140, 850, { size: 34, color: '#bae6fd', tracking: 200 }));
  } },
  { id: 'poster', name: 'Cartel de evento', desc: 'A4 (1240 × 1754)', w: 1240, h: 1754, build: d => {
    d.root.add(fillBg(d, (x, W, H) => { x.fillStyle = '#111111'; x.fillRect(0, 0, W, H); }));
    d.root.add(frame(d, 'Foto', { x: 0, y: 0, w: 1240, h: 1000 }));
    d.root.add(shape(d, 'Bloque', { shape: 'rect', x0: 0, y0: 1000, x1: 1240, y1: 1754, fill: '#ffde00' }));
    d.root.add(text(d, 'CONCIERTO\nDE VERANO', 80, 1060, { size: 160, font: 'Anton', color: '#111111', lineHeight: 0.95 }));
    d.root.add(text(d, '21 JULIO · 21:00 · PLAZA MAYOR', 84, 1440, { size: 52, bold: true, color: '#111111' }));
    d.root.add(text(d, 'Entrada libre', 84, 1560, { size: 44, color: '#111111' }));
  } },
  { id: 'meme', name: 'Meme', desc: '1080 × 1080', w: 1080, h: 1080, build: d => {
    d.root.add(fillBg(d, (x, W, H) => { x.fillStyle = '#000'; x.fillRect(0, 0, W, H); }));
    d.root.add(frame(d, 'Foto', { x: 0, y: 0, w: 1080, h: 1080 }));
    const st: LayerStyles = { stroke: { enabled: true, color: '#000000', size: 8, position: 'outside' } };
    d.root.add(text(d, 'CUANDO POR FIN', 40, 40, { size: 110, font: 'Anton', color: '#ffffff', align: 'center', boxWidth: 1000, caps: true }, st));
    d.root.add(text(d, 'FUNCIONA A LA PRIMERA', 40, 880, { size: 110, font: 'Anton', color: '#ffffff', align: 'center', boxWidth: 1000, caps: true }, st));
  } },
];
function buildTemplate(t: Template): EditorDocument {
  const d = new EditorDocument(t.name, t.w, t.h);
  t.build(d);
  for (const l of d.allLayers()) if (l instanceof TextLayer || l instanceof ShapeLayer) l.render();
  d.setActive(d.root.children[d.root.children.length - 1], false);
  return d;
}
export function templatesDialog() {
  const grid = h('div', { class: 'tpl-grid' });
  let dlg: { close(): void } | null = null;
  for (const t of TEMPLATES) {
    const c = makeCanvas(1, 1), item = h('button', { class: 'tpl-item', type: 'button' }, c, h('b', {}, t.name), h('span', { class: 'hint' }, t.desc));
    item.onclick = () => { dlg?.close(); const d = buildTemplate(t); app.addDocument(d, 'Plantilla: ' + t.name); app.toast('Cambia los textos con doble clic (o la herramienta T) y toca dos veces un marco gris para poner tu foto'); };
    grid.append(item);
    // miniatura (se calcula después de abrir la ventana)
    setTimeout(() => { try { const d = buildTemplate(t), comp = d.getComposite(), s = 220 / Math.max(t.w, t.h); c.width = Math.round(t.w * s); c.height = Math.round(t.h * s); const x = ctx2d(c); x.imageSmoothingQuality = 'high'; x.drawImage(comp, 0, 0, c.width, c.height); } catch { /* */ } }, 20);
  }
  dlg = showDialog({ title: 'Plantillas', width: 760, okLabel: 'Cerrar', cancelLabel: null, body: [h('div', { class: 'hint' }, 'Diseños listos para editar: cambia los textos, pon tus fotos y los colores. Todo son capas normales.'), grid] });
}

// ---- Poner una foto en el marco ------------------------------------------------------------------------
export async function photoIntoFrame() {
  const { activeFrame } = await import('../tools/shape'); const fr = activeFrame();
  if (!fr) { app.toast('Selecciona antes un marco (los recuadros grises de las plantillas y collages)', 'warn'); return; }
  const io = await import('../io/files'); const files = await io.pickFiles('image/*');
  if (!files?.length) return;
  const ops = await import('./ops'); app.doc!.setActive(fr); await ops.placeImage(files[0], files[0].name.replace(/\.[^.]+$/, ''));
}

// ---- Collage ------------------------------------------------------------------------------------------------
/** Distribuciones de n huecos en un lienzo 0..1 (filas de distinto número de fotos). */
function layoutFor(n: number, style: string): number[][] {
  const rows: Record<number, number[][]> = { 1: [[1]], 2: [[2], [1, 1]], 3: [[1, 2], [3], [2, 1]], 4: [[2, 2], [1, 3], [4]], 5: [[2, 3], [3, 2], [1, 4]], 6: [[3, 3], [2, 2, 2], [1, 2, 3]], 7: [[3, 4], [2, 3, 2]], 8: [[4, 4], [2, 3, 3]], 9: [[3, 3, 3]] };
  const opts = rows[Math.min(9, Math.max(1, n))] ?? [[3, 3, 3]], i = Math.max(0, Math.min(opts.length - 1, +style || 0));
  return [opts[i]];
}
export function collageDialog() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
  inp.onchange = () => { const fs = [...(inp.files ?? [])].slice(0, 9); if (fs.length) collageOptions(fs); };
  inp.click();
}
function collageOptions(files: File[]) {
  const n = files.length;
  const size = h('select', {}, ...[['sq', 'Cuadrado 2000 × 2000'], ['v', 'Vertical 1600 × 2000'], ['h', 'Horizontal 2400 × 1600'], ['story', 'Historia 1080 × 1920']].map(([v, t]) => h('option', { value: v }, t))) as HTMLSelectElement;
  const variants = ({ 1: 1, 2: 2, 3: 3, 4: 3, 5: 3, 6: 3, 7: 2, 8: 2, 9: 1 } as Record<number, number>)[n] ?? 1;
  const dist = h('select', {}, ...Array.from({ length: variants }, (_, i) => h('option', { value: String(i) }, `Distribución ${i + 1} (${layoutFor(n, String(i))[0].join(' + ')})`))) as HTMLSelectElement;
  const bg = h('input', { type: 'color', class: 'color-input', value: '#ffffff' }) as HTMLInputElement;
  let gap = 2, rad = 2;
  showDialog({ title: `Collage con ${n} ${n === 1 ? 'foto' : 'fotos'}`, width: 420,
    body: [row('Tamaño', size), row('Distribución', dist), row('Separación', numberSlider({ min: 0, max: 8, value: gap, unit: '%', onInput: v => gap = v }).el), row('Esquinas redondeadas', numberSlider({ min: 0, max: 20, value: rad, unit: '%', onInput: v => rad = v }).el), row('Fondo', bg),
      h('div', { class: 'hint' }, 'Cada foto va en un marco: luego puedes moverla dentro, cambiarla (doble clic) o mover los textos y marcos.')],
    onOk: () => { makeCollage(files, size.value, dist.value, gap, rad, bg.value); } });
}
export async function makeCollage(files: File[], size: string, dist: string, gapPct: number, radPct: number, bg: string) {
  const [W, H] = size === 'v' ? [1600, 2000] : size === 'h' ? [2400, 1600] : size === 'story' ? [1080, 1920] : [2000, 2000];
  const d = new EditorDocument('Collage', W, H);
  d.root.add(fillBg(d, (x) => { x.fillStyle = bg; x.fillRect(0, 0, W, H); }));
  const rows = layoutFor(files.length, dist)[0], g = Math.round(Math.min(W, H) * gapPct / 100), rad = Math.min(W, H) * radPct / 100;
  // si hay más filas que columnas en un lienzo horizontal, se reparten en columnas
  const byCols = W > H * 1.2 && rows.length > 1;
  const frames: GroupLayer[] = [];
  const nR = rows.length;
  rows.forEach((cnt, ri) => {
    for (let ci = 0; ci < cnt; ci++) {
      let r: R;
      if (!byCols) { const rh = (H - g * (nR + 1)) / nR, cw = (W - g * (cnt + 1)) / cnt; r = { x: g + ci * (cw + g), y: g + ri * (rh + g), w: cw, h: rh }; }
      else { const cw = (W - g * (nR + 1)) / nR, rh = (H - g * (cnt + 1)) / cnt; r = { x: g + ri * (cw + g), y: g + ci * (rh + g), w: cw, h: rh }; }
      const fr = frame(d, `Foto ${frames.length + 1}`, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }, 'rect', rad);
      d.root.add(fr); frames.push(fr);
    }
  });
  d.setActive(frames[0], false);
  app.addDocument(d, 'Collage');
  const ops = await import('./ops');
  for (let i = 0; i < frames.length && i < files.length; i++) { d.setActive(frames[i], false); await ops.placeImage(files[i], files[i].name.replace(/\.[^.]+$/, '')); }
  // los pasos de colocar quedan como uno solo: «Collage»
  const hs = d.history; if (hs.steps.length > 2) { const last = hs.steps[hs.index]; hs.steps.splice(1, hs.steps.length - 1, { ...last, name: 'Collage' }); hs.index = 1; }
  app.emit('doc'); app.toast('Collage listo');
}

// ---- Efectos de texto ------------------------------------------------------------------------------------------
type TextFx = { name: string; color?: string; styles: (size: number) => LayerStyles; fill?: number };
export const TEXT_FX: TextFx[] = [
  { name: 'Neón', color: '#ffffff', styles: s => ({ glow: { enabled: true, color: '#ff2bd6', opacity: 0.9, size: Math.max(8, s * 0.35), spread: 10 }, stroke: { enabled: true, color: '#ff7be8', size: Math.max(2, s * 0.03), position: 'outside' } }) },
  { name: '3D', color: '#ffcc00', styles: s => ({ shadow: { enabled: true, color: '#b35900', opacity: 1, angle: 135, distance: Math.max(4, s * 0.12), blur: 0 }, stroke: { enabled: true, color: '#7a3d00', size: Math.max(1, s * 0.02), position: 'outside' } }) },
  { name: 'Contorno', color: '#ffffff', fill: 0, styles: s => ({ stroke: { enabled: true, color: '#111111', size: Math.max(2, s * 0.04), position: 'outside' } }) },
  { name: 'Retro', color: '#ff5470', styles: s => ({ stroke: { enabled: true, color: '#1b1b3a', size: Math.max(2, s * 0.05), position: 'outside' }, shadow: { enabled: true, color: '#00c2d1', opacity: 1, angle: 135, distance: Math.max(4, s * 0.1), blur: 0 } }) },
  { name: 'Dorado', color: '#d4a017', styles: s => ({ gradientOverlay: { enabled: true, opacity: 1, angle: 90, stops: [[0, '#fff2a8'], [0.45, '#d4a017'], [0.55, '#9c6b00'], [1, '#ffe27a']] }, bevel: { ...BEVEL_DEFAULT, enabled: true, size: Math.max(2, s * 0.06), depth: 120 }, shadow: { enabled: true, color: '#000000', opacity: 0.45, angle: 120, distance: Math.max(2, s * 0.05), blur: Math.max(2, s * 0.08) } }) },
  { name: 'Pegatina', color: '#111111', styles: s => ({ stroke: { enabled: true, color: '#ffffff', size: Math.max(4, s * 0.12), position: 'outside' }, shadow: { enabled: true, color: '#000000', opacity: 0.35, angle: 120, distance: Math.max(2, s * 0.05), blur: Math.max(3, s * 0.1) } }) },
  { name: 'Cromado', color: '#cccccc', styles: s => ({ gradientOverlay: { enabled: true, opacity: 1, angle: 90, stops: [[0, '#ffffff'], [0.48, '#9aa4ad'], [0.52, '#3b4249'], [1, '#e8eef2']] }, bevel: { ...BEVEL_DEFAULT, enabled: true, size: Math.max(2, s * 0.05) }, stroke: { enabled: true, color: '#2b2f33', size: Math.max(1, s * 0.02), position: 'outside' } }) },
  { name: 'Fuego', color: '#ffb000', styles: s => ({ gradientOverlay: { enabled: true, opacity: 1, angle: 90, stops: [[0, '#fff3a0'], [0.5, '#ff8a00'], [1, '#d60000']] }, glow: { enabled: true, color: '#ff4500', opacity: 0.8, size: Math.max(6, s * 0.3) } }) },
  { name: 'Sombra suave', styles: s => ({ shadow: { enabled: true, color: '#000000', opacity: 0.35, angle: 120, distance: Math.max(2, s * 0.06), blur: Math.max(4, s * 0.18) } }) },
  { name: 'Sin efecto', styles: () => ({}) },
];
export function textEffectsDialog() {
  const d = app.doc, l = d?.active;
  if (!d || !l || !(l instanceof TextLayer || l instanceof ShapeLayer)) { app.toast('Selecciona una capa de texto (o una forma)', 'warn'); return; }
  const size = l instanceof TextLayer ? l.props.size : 60;
  const grid = h('div', { class: 'fx-grid' });
  const before = { styles: l.styles ? JSON.parse(JSON.stringify(l.styles)) : null, color: l instanceof TextLayer ? l.props.color : '', fill: l.fillOpacity };
  for (const fx of TEXT_FX) {
    const b = h('button', { class: 'fx-item', type: 'button' }, h('span', { class: 'fx-name fx-' + fx.name.toLowerCase().replace(/\s+/g, '-') }, fx.name));
    b.onclick = () => {
      l.styles = fx.name === 'Sin efecto' ? null : fx.styles(size); l.fillOpacity = fx.fill ?? 1;
      if (fx.color && l instanceof TextLayer) { l.props.color = fx.color; l.render(); }
      d.invalidate(); grid.querySelectorAll('.fx-item').forEach(x => x.classList.toggle('on', x === b));
    };
    grid.append(b);
  }
  showDialog({ title: 'Efectos de texto', width: 460, side: true, okLabel: 'Aplicar',
    body: [h('div', { class: 'hint' }, 'Toca un efecto para verlo. Luego puedes ajustarlo en Capa › Estilo de capa.'), grid],
    onOk: () => d.commit('Efecto de texto'),
    onCancel: () => { l.styles = before.styles; l.fillOpacity = before.fill; if (l instanceof TextLayer) { l.props.color = before.color; l.render(); } d.invalidate(); } });
}

// ---- Fondos generativos ----------------------------------------------------------------------------------------
function seeded(seed: number) { let s = seed * 9301 + 49297; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const hexRgb = (s: string) => { const n = parseInt(s.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
export function renderBackground(W: number, H: number, kind: string, cols: string[], seed: number): HTMLCanvasElement {
  const c = makeCanvas(W, H), x = ctx2d(c), r = seeded(seed), C = cols.map(hexRgb);
  if (kind === 'mesh') {
    // degradado de malla: varios puntos de color que se funden suavemente
    const pts = C.map((col, i) => ({ x: r() * W, y: r() * H, col, i })); const S = 4, w = Math.ceil(W / S), hh = Math.ceil(H / S), small = makeCanvas(w, hh), sx = ctx2d(small), img = sx.createImageData(w, hh);
    for (let y = 0; y < hh; y++) for (let xx = 0; xx < w; xx++) { let tw = 0, R = 0, G = 0, B = 0; for (const p of pts) { const dd = Math.hypot(xx * S - p.x, y * S - p.y) / Math.max(W, H), wt = 1 / Math.pow(dd + 0.05, 2.6); tw += wt; R += p.col[0] * wt; G += p.col[1] * wt; B += p.col[2] * wt; } const q = (y * w + xx) * 4; img.data[q] = R / tw; img.data[q + 1] = G / tw; img.data[q + 2] = B / tw; img.data[q + 3] = 255; }
    sx.putImageData(img, 0, 0); x.imageSmoothingQuality = 'high'; x.filter = `blur(${Math.max(2, Math.min(W, H) / 80)}px)`; x.drawImage(small, -20, -20, W + 40, H + 40); x.filter = 'none';
  } else if (kind === 'blobs') {
    x.fillStyle = cols[0]; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 9; i++) { const col = cols[1 + (i % (cols.length - 1))], rr = Math.min(W, H) * (0.15 + r() * 0.3); x.globalAlpha = 0.55 + r() * 0.35; x.fillStyle = col; x.beginPath(); const cx = r() * W, cy = r() * H; for (let k = 0; k <= 64; k++) { const a = k / 64 * Math.PI * 2, rad = rr * (1 + 0.18 * Math.sin(a * 3 + i) + 0.1 * Math.cos(a * 5 + i * 2)); const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad; k ? x.lineTo(px, py) : x.moveTo(px, py); } x.fill(); }
    x.globalAlpha = 1; const t = makeCanvas(W, H), tx = ctx2d(t); tx.filter = `blur(${Math.min(W, H) / 18}px)`; tx.drawImage(c, 0, 0); tx.filter = 'none'; x.drawImage(t, 0, 0);
  } else if (kind === 'waves') {
    x.fillStyle = cols[0]; x.fillRect(0, 0, W, H);
    const n = Math.max(3, cols.length + 2);
    for (let i = 0; i < n; i++) { const base = H * (0.35 + i * 0.6 / n), amp = H * (0.04 + r() * 0.06), fr = (1 + r() * 2) * Math.PI * 2 / W, ph = r() * 7; x.fillStyle = cols[1 + (i % (cols.length - 1))]; x.globalAlpha = 0.85; x.beginPath(); x.moveTo(0, H); for (let xx = 0; xx <= W; xx += 8) x.lineTo(xx, base + Math.sin(xx * fr + ph) * amp + Math.sin(xx * fr * 2.3 + ph) * amp * 0.35); x.lineTo(W, H); x.closePath(); x.fill(); }
    x.globalAlpha = 1;
  } else {
    lin(x, W, H, [cols[0], cols[cols.length - 1]]);
    const step = Math.max(16, Math.min(W, H) / 28); x.fillStyle = cols[1] ?? '#ffffff';
    for (let y = step / 2; y < H; y += step) for (let xx = step / 2; xx < W; xx += step) { const dd = Math.hypot(xx - W * 0.7, y - H * 0.3) / Math.max(W, H); x.globalAlpha = Math.max(0.08, 0.9 - dd * 1.3); x.beginPath(); x.arc(xx, y, step * 0.18 * (1.2 - dd), 0, 7); x.fill(); }
    x.globalAlpha = 1;
  }
  return c;
}
const BG_PALETTES = [['#ff9a8b', '#ff6a88', '#ff99ac', '#fad0c4'], ['#4facfe', '#00f2fe', '#a18cd1', '#fbc2eb'], ['#0f2027', '#203a43', '#2c5364', '#7dd3fc'], ['#f6d365', '#fda085', '#f093fb', '#f5576c'], ['#d4fc79', '#96e6a1', '#43e97b', '#38f9d7'], ['#1e1e2f', '#6a11cb', '#2575fc', '#ff6ec4']];
export function backgroundDialog() {
  const d = app.doc;
  const W = d?.width ?? 1080, H = d?.height ?? 1080;
  let kind = 'mesh', pal = 0, seed = 1;
  const prev = makeCanvas(1, 1); prev.className = 'bg-prev';
  const draw = () => { const s = 260 / Math.max(W, H); prev.width = Math.round(W * s); prev.height = Math.round(H * s); ctx2d(prev).drawImage(renderBackground(prev.width, prev.height, kind, BG_PALETTES[pal], seed), 0, 0); };
  const kinds = h('div', { class: 'btn-group' }, ...[['mesh', 'Malla'], ['blobs', 'Burbujas'], ['waves', 'Ondas'], ['dots', 'Puntos']].map(([v, t]) => { const b = h('button', { class: 'btn' + (v === kind ? ' on' : ''), type: 'button' }, t); b.onclick = () => { kind = v; kinds.querySelectorAll('.btn').forEach(x => x.classList.toggle('on', x === b)); draw(); }; return b; }));
  const pals = h('div', { class: 'bg-pals' }, ...BG_PALETTES.map((p, i) => { const b = h('button', { class: 'bg-pal' + (i === pal ? ' on' : ''), type: 'button', style: { background: `linear-gradient(90deg, ${p.join(',')})` } }); b.onclick = () => { pal = i; pals.querySelectorAll('.bg-pal').forEach(x => x.classList.toggle('on', x === b)); draw(); }; return b; }));
  const again = h('button', { class: 'btn', type: 'button', onclick: () => { seed++; draw(); }, html: icon('dice') + '<span>Otra variación</span>' });
  draw();
  showDialog({ title: 'Fondos generativos', width: 440, body: [kinds, pals, h('div', { class: 'bg-prev-wrap' }, prev), again, h('div', { class: 'hint' }, d ? 'Se añade como capa al fondo del documento.' : 'Se crea un documento nuevo con el fondo.')],
    okLabel: 'Usar este fondo',
    onOk: () => {
      const c = renderBackground(W, H, kind, BG_PALETTES[pal], seed);
      if (!d) { const nd = new EditorDocument('Fondo', W, H); const l = new RasterLayer('Fondo generativo', W, H); l.canvas = c; nd.root.add(l); nd.setActive(l, false); app.addDocument(nd, 'Fondo generativo'); return; }
      const l = new RasterLayer('Fondo generativo', W, H); l.canvas = c; l.touch(); d.root.add(l, 0); d.setActive(l); d.invalidate(); d.commit('Fondo generativo');
    } });
}

// ---- Código QR ---------------------------------------------------------------------------------------------------
export function qrDialog() {
  const d = app.doc; if (!d) { app.toast('Abre o crea antes una imagen', 'warn'); return; }
  const inp = h('input', { type: 'text', class: 'wide', value: 'https://', placeholder: 'Web, teléfono, texto…' }) as HTMLInputElement;
  const fg = h('input', { type: 'color', class: 'color-input', value: '#000000' }) as HTMLInputElement, bg = h('input', { type: 'color', class: 'color-input', value: '#ffffff' }) as HTMLInputElement;
  const ec = h('select', {}, h('option', { value: 'M' }, 'Normal'), h('option', { value: 'H' }, 'Alta (resiste manchas o un logo encima)'), h('option', { value: 'L' }, 'Baja (más simple)')) as HTMLSelectElement;
  const prev = makeCanvas(160, 160); prev.className = 'qr-prev';
  const draw = () => { try { const m = encodeQR(inp.value || ' ', ec.value as any); paintQR(prev, m, fg.value, bg.value); } catch (e: any) { const x = ctx2d(prev); x.clearRect(0, 0, 160, 160); x.fillStyle = '#c00'; x.font = '12px system-ui'; x.fillText('Texto demasiado largo', 10, 80); } };
  [inp, fg, bg, ec].forEach(e => e.addEventListener('input', draw)); ec.onchange = draw;
  draw();
  showDialog({ title: 'Código QR', width: 420, body: [row('Contenido', inp), row('Corrección', ec), row('Colores', fg, bg), h('div', { class: 'bg-prev-wrap' }, prev), h('div', { class: 'hint' }, 'Usa colores con mucho contraste (oscuro sobre claro) para que lo lean todos los móviles.')],
    okLabel: 'Añadir',
    onOk: () => {
      let m: boolean[][]; try { m = encodeQR(inp.value, ec.value as any); } catch (e: any) { app.toast(e.message, 'warn'); return false; }
      const side = Math.round(Math.min(d.width, d.height) * 0.3), c = makeCanvas(side, side); paintQR(c, m, fg.value, bg.value);
      const l = new RasterLayer('Código QR', d.width, d.height); ctx2d(l.canvas).drawImage(c, Math.round((d.width - side) / 2), Math.round((d.height - side) / 2));
      l.touch(); d.insertAboveActive(l); d.setActive(l); d.invalidate(); d.commit('Código QR');
    } });
}
function paintQR(c: HTMLCanvasElement, m: boolean[][], fg: string, bg: string) {
  const n = m.length + 8, x = ctx2d(c), s = c.width / n; x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); x.fillStyle = fg;
  m.forEach((row, r) => row.forEach((v, cc) => { if (v) x.fillRect(Math.floor((cc + 4) * s), Math.floor((r + 4) * s), Math.ceil(s), Math.ceil(s)); }));
}

// ---- Armonías de color --------------------------------------------------------------------------------------------
const toHsl = (hex: string) => { const [r, g, b] = hexRgb(hex).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let hh = 0, s = 0; if (mx !== mn) { const dd = mx - mn; s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn); hh = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4; hh *= 60; } return [hh, s, l]; };
const fromHsl = (hh: number, s: number, l: number) => { hh = ((hh % 360) + 360) % 360; const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((hh / 60) % 2 - 1)), m = l - c / 2; const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x]; return '#' + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join(''); };
export function harmonies(hex: string): [string, string[]][] {
  const [hh, s, l] = toHsl(hex);
  return [
    ['Complementario', [hex, fromHsl(hh + 180, s, l)]],
    ['Análogos', [fromHsl(hh - 30, s, l), hex, fromHsl(hh + 30, s, l)]],
    ['Tríada', [hex, fromHsl(hh + 120, s, l), fromHsl(hh + 240, s, l)]],
    ['Complementario dividido', [hex, fromHsl(hh + 150, s, l), fromHsl(hh + 210, s, l)]],
    ['Tétrada', [hex, fromHsl(hh + 90, s, l), fromHsl(hh + 180, s, l), fromHsl(hh + 270, s, l)]],
    ['Monocromático', [fromHsl(hh, s, Math.max(0.12, l - 0.3)), fromHsl(hh, s, Math.max(0.08, l - 0.15)), hex, fromHsl(hh, s, Math.min(0.92, l + 0.15)), fromHsl(hh, s, Math.min(0.96, l + 0.3))]],
  ];
}
export function harmonyDialog() {
  const list = h('div', { class: 'harm-list' });
  const render = () => {
    list.innerHTML = '';
    for (const [name, cols] of harmonies(app.fg)) {
      const sw = h('div', { class: 'harm-sw' }, ...cols.map(c => { const b = h('button', { class: 'harm-c', type: 'button', title: c + ' — clic: color frontal', style: { background: c } }); b.onclick = () => { app.setColors(c, app.bg); render(); }; return b; }));
      const add = h('button', { class: 'btn', type: 'button', onclick: async () => { const { userSwatches, saveUserSwatches } = await import('./panels'); saveUserSwatches([...cols.map(c => ({ name: name, color: c })), ...userSwatches()]); app.toast('Añadidos a Muestras'); } }, 'A Muestras');
      list.append(h('div', { class: 'harm-row' }, h('b', {}, name), sw, add));
    }
  };
  render();
  showDialog({ title: 'Armonías de color', width: 460, side: true, okLabel: 'Cerrar', cancelLabel: null, body: [h('div', { class: 'hint' }, 'Combinaciones que quedan bien con tu color frontal. Clic en un color para usarlo (y ver sus armonías).'), list] });
}
