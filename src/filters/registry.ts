// Catálogo de ajustes y filtros. Cada entrada describe sus parámetros y cómo
// aplicarse; el diálogo y los menús se generan a partir de aquí. Añadir un
// filtro nuevo = añadir una entrada.

import * as A from './adjustments';

export type ParamDef =
  | { key: string; label: string; type: 'range'; min: number; max: number; step?: number; default: number; unit?: string }
  | { key: string; label: string; type: 'checkbox'; default: boolean };

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
];

export function defaultParams(f: FilterDef): any {
  if (f.custom === 'levels') return { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
  if (f.custom === 'curves') return { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] };
  const p: any = {};
  for (const d of f.params ?? []) p[d.key] = d.default;
  return p;
}
