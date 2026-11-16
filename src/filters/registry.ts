// Catálogo de ajustes y filtros. Cada entrada describe sus parámetros y cómo
// aplicarse; el diálogo y los menús se generan a partir de aquí. Añadir un
// filtro nuevo = añadir una entrada.

import * as A from './adjustments';
import * as F from './advanced';

export type ParamDef =
  | { key: string; label: string; type: 'range'; min: number; max: number; step?: number; default: number; unit?: string }
  | { key: string; label: string; type: 'checkbox'; default: boolean }
  | { key: string; label: string; type: 'color'; default: string };

export interface FilterDef {
  id: string;
  name: string;
  group: 'ajuste' | 'filtro';
  submenu?: string;
  shortcut?: string;
  /** Sin parámetros = se aplica directamente sin diálogo. */
  params?: ParamDef[];
  /** Diálogo especial ('levels' | 'curves'). */
  custom?: 'levels' | 'curves';
  /** true = no tiene sentido como capa de ajuste (se calcula a partir de la propia imagen). */
  noLayer?: boolean;
  apply(img: ImageData, p: any): void;
}

export const FILTERS: FilterDef[] = [
  {
    id: 'brightness', name: 'Brillo/Contraste…', group: 'ajuste',
    params: [
      { key: 'brightness', label: 'Brillo', type: 'range', min: -150, max: 150, default: 0 },
      { key: 'contrast', label: 'Contraste', type: 'range', min: -50, max: 100, default: 0 },
    ],
    apply: (img, p) => A.brightnessContrast(img, p.brightness, p.contrast),
  },
  {
    id: 'levels', name: 'Niveles…', group: 'ajuste', shortcut: 'Ctrl+L', custom: 'levels',
    apply: (img, p) => A.levels(img, p),
  },
  {
    id: 'curves', name: 'Curvas…', group: 'ajuste', shortcut: 'Ctrl+M', custom: 'curves',
    apply: (img, p) => A.curves(img, p),
  },
  {
    id: 'huesat', name: 'Tono/Saturación…', group: 'ajuste', shortcut: 'Ctrl+U',
    params: [
      { key: 'hue', label: 'Tono', type: 'range', min: -180, max: 180, default: 0, unit: '°' },
      { key: 'sat', label: 'Saturación', type: 'range', min: -100, max: 100, default: 0 },
      { key: 'light', label: 'Luminosidad', type: 'range', min: -100, max: 100, default: 0 },
      { key: 'colorize', label: 'Colorear', type: 'checkbox', default: false },
    ],
    apply: (img, p) => A.hueSaturation(img, p.hue, p.sat, p.light, p.colorize),
  },
  {
    id: 'bw', name: 'Blanco y negro…', group: 'ajuste', shortcut: 'Alt+Shift+Ctrl+B',
    params: [
      { key: 'reds', label: 'Rojos', type: 'range', min: -200, max: 300, default: 40, unit: '%' },
      { key: 'yellows', label: 'Amarillos', type: 'range', min: -200, max: 300, default: 60, unit: '%' },
      { key: 'greens', label: 'Verdes', type: 'range', min: -200, max: 300, default: 40, unit: '%' },
      { key: 'cyans', label: 'Cian', type: 'range', min: -200, max: 300, default: 60, unit: '%' },
      { key: 'blues', label: 'Azules', type: 'range', min: -200, max: 300, default: 20, unit: '%' },
      { key: 'magentas', label: 'Magentas', type: 'range', min: -200, max: 300, default: 80, unit: '%' },
    ],
    apply: (img, p) => p.reds === undefined ? A.blackWhite(img) : A.blackWhite(img, p),
  },
  { id: 'desaturate', name: 'Desaturar', group: 'ajuste', shortcut: 'Shift+Ctrl+U', apply: img => A.desaturate(img) },
  { id: 'invert', name: 'Invertir', group: 'ajuste', shortcut: 'Ctrl+I', apply: img => A.invert(img) },
  {
    id: 'exposure', name: 'Exposición…', group: 'ajuste',
    params: [
      { key: 'stops', label: 'Exposición', type: 'range', min: -5, max: 5, default: 0, step: 0.01 },
      { key: 'offset', label: 'Desplazamiento', type: 'range', min: -0.5, max: 0.5, default: 0, step: 0.001 },
      { key: 'gamma', label: 'Gamma', type: 'range', min: 0.1, max: 5, default: 1, step: 0.01 },
    ],
    apply: (img, p) => A.exposure(img, p.stops, p.offset, p.gamma),
  },
  {
    id: 'vibrance', name: 'Intensidad…', group: 'ajuste',
    params: [
      { key: 'vibrance', label: 'Intensidad', type: 'range', min: -100, max: 100, default: 0 },
      { key: 'sat', label: 'Saturación', type: 'range', min: -100, max: 100, default: 0 },
    ],
    apply: (img, p) => A.vibrance(img, p.vibrance, p.sat),
  },
  {
    id: 'colorbalance', name: 'Equilibrio de color…', group: 'ajuste', shortcut: 'Ctrl+B',
    params: [
      { key: 'm0', label: 'Medios: Cian–Rojo', type: 'range', min: -100, max: 100, default: 0 },
      { key: 'm1', label: 'Medios: Magenta–Verde', type: 'range', min: -100, max: 100, default: 0 },
      { key: 'm2', label: 'Medios: Amarillo–Azul', type: 'range', min: -100, max: 100, default: 0 },
      { key: 's0', label: 'Sombras: Cian–Rojo', type: 'range', min: -100, max: 100, default: 0 },
      { key: 's1', label: 'Sombras: Magenta–Verde', type: 'range', min: -100, max: 100, default: 0 },
      { key: 's2', label: 'Sombras: Amarillo–Azul', type: 'range', min: -100, max: 100, default: 0 },
      { key: 'h0', label: 'Luces: Cian–Rojo', type: 'range', min: -100, max: 100, default: 0 },
      { key: 'h1', label: 'Luces: Magenta–Verde', type: 'range', min: -100, max: 100, default: 0 },
      { key: 'h2', label: 'Luces: Amarillo–Azul', type: 'range', min: -100, max: 100, default: 0 },
      { key: 'preserve', label: 'Conservar luminosidad', type: 'checkbox', default: true },
    ],
    apply: (img, p) => A.colorBalance(img, p),
  },
  {
    id: 'mixer', name: 'Mezclador de canales…', group: 'ajuste',
    params: [
      { key: 'rr', label: 'Rojo ← rojo', type: 'range', min: -200, max: 200, default: 100, unit: '%' },
      { key: 'rg', label: 'Rojo ← verde', type: 'range', min: -200, max: 200, default: 0, unit: '%' },
      { key: 'rb', label: 'Rojo ← azul', type: 'range', min: -200, max: 200, default: 0, unit: '%' },
      { key: 'rc', label: 'Rojo: constante', type: 'range', min: -200, max: 200, default: 0, unit: '%' },
      { key: 'gr', label: 'Verde ← rojo', type: 'range', min: -200, max: 200, default: 0, unit: '%' },
      { key: 'gg', label: 'Verde ← verde', type: 'range', min: -200, max: 200, default: 100, unit: '%' },
      { key: 'gb', label: 'Verde ← azul', type: 'range', min: -200, max: 200, default: 0, unit: '%' },
      { key: 'gc', label: 'Verde: constante', type: 'range', min: -200, max: 200, default: 0, unit: '%' },
      { key: 'br', label: 'Azul ← rojo', type: 'range', min: -200, max: 200, default: 0, unit: '%' },
      { key: 'bg', label: 'Azul ← verde', type: 'range', min: -200, max: 200, default: 0, unit: '%' },
      { key: 'bb', label: 'Azul ← azul', type: 'range', min: -200, max: 200, default: 100, unit: '%' },
      { key: 'bc', label: 'Azul: constante', type: 'range', min: -200, max: 200, default: 0, unit: '%' },
      { key: 'mono', label: 'Monocromo (usa la fila del rojo)', type: 'checkbox', default: false },
    ],
    apply: (img, p) => A.channelMixer(img, p),
  },
  {
    id: 'posterize', name: 'Posterizar…', group: 'ajuste',
    params: [
      { key: 'levels', label: 'Niveles', type: 'range', min: 2, max: 255, default: 4 },
    ],
    apply: (img, p) => A.posterize(img, p.levels),
  },
  {
    id: 'threshold', name: 'Umbral…', group: 'ajuste',
    params: [
      { key: 'level', label: 'Nivel', type: 'range', min: 1, max: 255, default: 128 },
    ],
    apply: (img, p) => A.threshold(img, p.level),
  },
  { id: 'gradmap', name: 'Mapa de degradado…', group: 'ajuste', params: [{ key: 'c1', label: 'Sombras', type: 'color', default: '#1a1040' }, { key: 'c2', label: 'Luces', type: 'color', default: '#ffd27a' }], apply: (img, p) => A.gradientMap(img, p.c1, p.c2) },
  { id: 'photofilter', name: 'Filtro de fotografía…', group: 'ajuste', params: [{ key: 'color', label: 'Color', type: 'color', default: '#ec8a00' }, { key: 'density', label: 'Densidad', type: 'range', min: 1, max: 100, default: 25, unit: '%' }, { key: 'preserve', label: 'Conservar luminosidad', type: 'checkbox', default: true }], apply: (img, p) => A.photoFilter(img, p.color, p.density, p.preserve) },
  { id: 'autotone', name: 'Tono automático', group: 'ajuste', shortcut: 'Shift+Ctrl+L', noLayer: true, apply: img => A.autoAdjust(img, 'tone') },
  { id: 'autocontrast', name: 'Contraste automático', group: 'ajuste', shortcut: 'Alt+Shift+Ctrl+L', noLayer: true, apply: img => A.autoAdjust(img, 'contrast') },
  { id: 'autocolor', name: 'Color automático', group: 'ajuste', shortcut: 'Shift+Ctrl+B', noLayer: true, apply: img => A.autoAdjust(img, 'color') },
  {
    id: 'gblur', name: 'Desenfoque gaussiano…', group: 'filtro', submenu: 'Desenfocar',
    params: [{ key: 'radius', label: 'Radio', type: 'range', min: 0.1, max: 100, step: 0.1, default: 4, unit: 'px' }],
    apply: (img, p) => A.blur(img, p.radius),
  },
  {
    id: 'unsharp', name: 'Máscara de enfoque…', group: 'filtro', submenu: 'Enfocar',
    params: [
      { key: 'amount', label: 'Cantidad', type: 'range', min: 1, max: 500, default: 100, unit: '%' },
      { key: 'radius', label: 'Radio', type: 'range', min: 0.1, max: 50, step: 0.1, default: 1.5, unit: 'px' },
      { key: 'threshold', label: 'Umbral', type: 'range', min: 0, max: 255, default: 0 },
    ],
    apply: (img, p) => A.unsharpMask(img, p.amount, p.radius, p.threshold),
  },
  { id: 'sharpen', name: 'Enfocar', group: 'filtro', submenu: 'Enfocar', apply: img => A.unsharpMask(img, 60, 1, 0) },
  {
    id: 'noise', name: 'Añadir ruido…', group: 'filtro', submenu: 'Ruido',
    params: [
      { key: 'amount', label: 'Cantidad', type: 'range', min: 0, max: 100, step: 0.5, default: 10, unit: '%' },
      { key: 'gaussian', label: 'Distribución gaussiana', type: 'checkbox', default: true },
      { key: 'mono', label: 'Monocromático', type: 'checkbox', default: false },
    ],
    apply: (img, p) => A.addNoise(img, p.amount, p.mono, p.gaussian),
  },
  { id: 'motion', name: 'Desenfoque de movimiento…', group: 'filtro', submenu: 'Desenfocar', params: [{ key: 'angle', label: 'Ángulo', type: 'range', min: -180, max: 180, default: 0, unit: '°' }, { key: 'distance', label: 'Distancia', type: 'range', min: 1, max: 300, default: 20, unit: 'px' }], apply: (img, p) => F.motionBlur(img, p.angle, p.distance) },
  { id: 'radial', name: 'Desenfoque radial…', group: 'filtro', submenu: 'Desenfocar', params: [{ key: 'amount', label: 'Cantidad', type: 'range', min: 1, max: 100, default: 20 }, { key: 'spin', label: 'Giro (si no, zoom)', type: 'checkbox', default: false }], apply: (img, p) => F.radialBlur(img, p.amount, p.spin) },
  { id: 'twirl', name: 'Molinete…', group: 'filtro', submenu: 'Distorsionar', params: [{ key: 'angle', label: 'Ángulo', type: 'range', min: -999, max: 999, default: 120, unit: '°' }], apply: (img, p) => F.twirl(img, p.angle) },
  { id: 'pinch', name: 'Encoger…', group: 'filtro', submenu: 'Distorsionar', params: [{ key: 'amount', label: 'Cantidad', type: 'range', min: -100, max: 100, default: 50, unit: '%' }], apply: (img, p) => F.pinch(img, p.amount) },
  { id: 'spherize', name: 'Esferizar…', group: 'filtro', submenu: 'Distorsionar', params: [{ key: 'amount', label: 'Cantidad', type: 'range', min: -100, max: 100, default: 60, unit: '%' }], apply: (img, p) => F.pinch(img, -p.amount) },
  { id: 'wave', name: 'Onda…', group: 'filtro', submenu: 'Distorsionar', params: [{ key: 'amplitude', label: 'Amplitud', type: 'range', min: 1, max: 200, default: 10, unit: 'px' }, { key: 'wavelength', label: 'Longitud de onda', type: 'range', min: 2, max: 999, default: 80, unit: 'px' }], apply: (img, p) => F.wave(img, p.amplitude, p.wavelength) },
  { id: 'edges', name: 'Hallar bordes', group: 'filtro', submenu: 'Estilizar', apply: img => F.findEdges(img) },
  { id: 'emboss', name: 'Relieve…', group: 'filtro', submenu: 'Estilizar', params: [{ key: 'angle', label: 'Ángulo', type: 'range', min: -180, max: 180, default: 135, unit: '°' }, { key: 'height', label: 'Altura', type: 'range', min: 1, max: 20, default: 3, unit: 'px' }, { key: 'amount', label: 'Cantidad', type: 'range', min: 1, max: 500, default: 100, unit: '%' }], apply: (img, p) => F.emboss(img, p.angle, p.height, p.amount) },
  { id: 'mosaic', name: 'Mosaico…', group: 'filtro', submenu: 'Pixelizar', params: [{ key: 'cell', label: 'Tamaño de celda', type: 'range', min: 2, max: 200, default: 10, unit: 'px' }], apply: (img, p) => F.mosaic(img, p.cell) },
  { id: 'median', name: 'Mediana…', group: 'filtro', submenu: 'Ruido', params: [{ key: 'radius', label: 'Radio', type: 'range', min: 1, max: 6, default: 2, unit: 'px' }], apply: (img, p) => F.median(img, p.radius) },
  { id: 'highpass', name: 'Paso alto…', group: 'filtro', submenu: 'Otro', params: [{ key: 'radius', label: 'Radio', type: 'range', min: 0.1, max: 250, default: 10, unit: 'px', step: 0.1 }], apply: (img, p) => F.highPass(img, p.radius) },
  { id: 'offset', name: 'Desplazamiento…', group: 'filtro', submenu: 'Otro', params: [{ key: 'dx', label: 'Horizontal', type: 'range', min: -2000, max: 2000, default: 50, unit: 'px' }, { key: 'dy', label: 'Vertical', type: 'range', min: -2000, max: 2000, default: 50, unit: 'px' }], apply: (img, p) => F.offset(img, p.dx, p.dy) },
  { id: 'maximum', name: 'Máximo…', group: 'filtro', submenu: 'Otro', params: [{ key: 'radius', label: 'Radio', type: 'range', min: 1, max: 50, default: 2, unit: 'px' }], apply: (img, p) => F.minMax(img, p.radius, true) },
  { id: 'minimum', name: 'Mínimo…', group: 'filtro', submenu: 'Otro', params: [{ key: 'radius', label: 'Radio', type: 'range', min: 1, max: 50, default: 2, unit: 'px' }], apply: (img, p) => F.minMax(img, p.radius, false) },
];

export function defaultParams(f: FilterDef): any {
  if (f.custom === 'levels') return { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
  if (f.custom === 'curves') return { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] };
  const p: any = {};
  for (const d of f.params ?? []) p[d.key] = d.default;
  return p;
}
