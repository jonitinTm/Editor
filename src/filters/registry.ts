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
      { key: 'r', label: 'Rojos', type: 'range', min: -50, max: 200, default: 30, unit: '%' },
      { key: 'g', label: 'Verdes', type: 'range', min: -50, max: 200, default: 59, unit: '%' },
      { key: 'b', label: 'Azules', type: 'range', min: -50, max: 200, default: 11, unit: '%' },
    ],
    apply: (img, p) => A.blackWhite(img, p.r, p.g, p.b),
  },
  { id: 'desaturate', name: 'Desaturar', group: 'ajuste', shortcut: 'Shift+Ctrl+U', apply: img => A.blackWhite(img) },
  { id: 'invert', name: 'Invertir', group: 'ajuste', shortcut: 'Ctrl+I', apply: img => A.invert(img) },
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
