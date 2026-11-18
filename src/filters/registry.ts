// Catálogo de ajustes y filtros. Cada entrada describe sus parámetros y cómo
// aplicarse; el diálogo y los menús se generan a partir de aquí. Añadir un
// filtro nuevo = añadir una entrada.

import * as A from './adjustments';
import * as F from './advanced';
import { develop, DEVELOP_DEFAULTS } from './develop';
import * as M from './more';
import * as L from './lut';
import * as N from './more2';
import { indexColors } from './indexed';

export type ParamDef =
  | { key: string; label: string; type: 'range'; min: number; max: number; step?: number; default: number; unit?: string; section?: string; showIf?: [string, string] }
  | { key: string; label: string; type: 'select'; choices: [string, string][]; default: string; section?: string }
  | { key: string; label: string; type: 'lut'; default: string }
  | { key: string; label: string; type: 'gradient'; default: A.Stop[] }
  | { key: string; label: string; type: 'checkbox'; default: boolean }
  | { key: string; label: string; type: 'color'; default: string }
  | { key: string; label: string; type: 'pattern'; default: string };

export interface FilterDef {
  id: string;
  name: string;
  group: 'ajuste' | 'filtro' | 'relleno';
  /** Si es false, no se lista en los menús de Ajustes / Filtro (va en otro sitio). */
  inMenu?: boolean;
  submenu?: string;
  shortcut?: string;
  /** Sin parámetros = se aplica directamente sin diálogo. */
  params?: ParamDef[];
  /** Diálogo especial ('levels' | 'curves'). */
  custom?: 'levels' | 'curves';
  /** true = no tiene sentido como capa de ajuste (se calcula a partir de la propia imagen). */
  noLayer?: boolean;
  /** Capa de relleno: genera los píxeles en vez de modificar los de debajo. */
  fill?: boolean;
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
    id: 'indexed', name: 'Color indexado…', group: 'ajuste', inMenu: false, noLayer: true,
    params: [
      { key: 'palette', label: 'Paleta', type: 'select', default: 'adaptive', choices: [['adaptive', 'Adaptable (a partir de la imagen)'], ['web', 'Web (216 colores)'], ['gray', 'Grises'], ['bw', 'Blanco y negro'], ['retro', 'Consola retro (16 colores)'], ['gameboy', 'Portátil clásica (4 verdes)']] },
      { key: 'colors', label: 'Colores (adaptable y grises)', type: 'range', min: 2, max: 256, default: 16 },
      { key: 'dither', label: 'Tramado', type: 'select', default: 'diffusion', choices: [['none', 'Ninguno'], ['diffusion', 'Difusión'], ['pattern', 'Motivo']] },
      { key: 'amount', label: 'Intensidad del tramado', type: 'range', min: 0, max: 100, default: 100, unit: '%' },
    ],
    apply: (img, p) => indexColors(img, p as any),
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
  { id: 'gradmap', name: 'Mapa de degradado…', group: 'ajuste', params: [{ key: 'grad', label: 'Degradado', type: 'gradient', default: [{ t: 0, color: '#1a1040', a: 1 }, { t: 1, color: '#ffd27a', a: 1 }] }, { key: 'reverse', label: 'Invertir', type: 'checkbox', default: false }],
    // los proyectos antiguos guardaban solo dos colores (c1, c2)
    apply: (img, p) => p.grad ? A.gradientMapStops(img, p.grad, p.reverse) : A.gradientMap(img, p.c1, p.c2) },
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
  { id: 'develop', name: 'Revelado (tipo Camera Raw)…', group: 'filtro', shortcut: 'Shift+Ctrl+A', params: [{ key: 'temp', label: 'Temperatura', type: 'range', min: -100, max: 100, default: 0, section: 'Balance de blancos' }, { key: 'tint', label: 'Matiz', type: 'range', min: -100, max: 100, default: 0 }, { key: 'exposure', label: 'Exposición', type: 'range', min: -5, max: 5, default: 0, step: 0.05, section: 'Tono' }, { key: 'contrast', label: 'Contraste', type: 'range', min: -100, max: 100, default: 0 }, { key: 'highlights', label: 'Iluminaciones', type: 'range', min: -100, max: 100, default: 0 }, { key: 'shadows', label: 'Sombras', type: 'range', min: -100, max: 100, default: 0 }, { key: 'whites', label: 'Blancos', type: 'range', min: -100, max: 100, default: 0 }, { key: 'blacks', label: 'Negros', type: 'range', min: -100, max: 100, default: 0 }, { key: 'clarity', label: 'Claridad', type: 'range', min: -100, max: 100, default: 0, section: 'Presencia' }, { key: 'dehaze', label: 'Neblina', type: 'range', min: -100, max: 100, default: 0 }, { key: 'vibrance', label: 'Intensidad', type: 'range', min: -100, max: 100, default: 0 }, { key: 'saturation', label: 'Saturación', type: 'range', min: -100, max: 100, default: 0 }, { key: 'vignette', label: 'Viñeta', type: 'range', min: -100, max: 100, default: 0, section: 'Efectos' }, { key: 'sharpen', label: 'Enfoque', type: 'range', min: 0, max: 150, default: 0, section: 'Detalle' }, { key: 'noise', label: 'Reducción de ruido', type: 'range', min: 0, max: 100, default: 0 }], apply: (img, p) => develop(img, { ...DEVELOP_DEFAULTS, ...p }) },
  { id: 'shadowsHighlights', name: 'Sombras/Iluminaciones…', group: 'ajuste', params: [{ key: 'shadows', label: 'Sombras', type: 'range', min: -100, max: 100, default: 35, unit: '%' }, { key: 'highlights', label: 'Iluminaciones', type: 'range', min: -100, max: 100, default: 0, unit: '%' }], apply: (img, p) => develop(img, { ...DEVELOP_DEFAULTS, ...p }) },
  { id: 'denoise', name: 'Reducir ruido…', group: 'filtro', submenu: 'Ruido', params: [{ key: 'strength', label: 'Intensidad', type: 'range', min: 1, max: 100, default: 40, unit: '%' }, { key: 'detail', label: 'Conservar detalles', type: 'range', min: 0, max: 100, default: 10, unit: '%' }], apply: (img, p) => develop(img, { ...DEVELOP_DEFAULTS, noise: p.strength, sharpen: p.detail }) },
  { id: 'selcolor', name: 'Corrección selectiva…', group: 'ajuste',
    params: [{ key: 'group', label: 'Colores', type: 'select', choices: M.SELCOLOR_GROUPS, default: 'reds' },
      ...M.SELCOLOR_GROUPS.flatMap(([g]) => ([['c', 'Cian'], ['m', 'Magenta'], ['y', 'Amarillo'], ['k', 'Negro']] as const).map(([c, n]) => ({ key: `${g}_${c}`, label: n, type: 'range' as const, min: -100, max: 100, default: 0, unit: '%', showIf: ['group', g] as [string, string] }))),
      { key: 'absolute', label: 'Absoluto (si no, relativo)', type: 'checkbox', default: false }],
    apply: (img, p) => M.selectiveColor(img, p) },
  { id: 'colorlookup', name: 'Consulta de colores…', group: 'ajuste',
    params: [{ key: 'preset', label: 'Look', type: 'select', choices: L.LUT_PRESETS, default: 'tealorange' },
      { key: 'lutData', label: 'Archivo LUT', type: 'lut', default: '' },
      { key: 'amount', label: 'Intensidad', type: 'range', min: 0, max: 100, default: 100, unit: '%' }],
    apply: (img, p) => L.applyLut(img, p) },
  { id: 'replacecolor', name: 'Reemplazar color…', group: 'ajuste', noLayer: true,
    params: [{ key: 'color', label: 'Color a cambiar', type: 'color', default: '#d03030' }, { key: 'fuzziness', label: 'Tolerancia', type: 'range', min: 1, max: 200, default: 40 },
      { key: 'hue', label: 'Tono', type: 'range', min: -180, max: 180, default: 0, unit: '°', section: 'Reemplazo' }, { key: 'sat', label: 'Saturación', type: 'range', min: -100, max: 100, default: 0 }, { key: 'light', label: 'Luminosidad', type: 'range', min: -100, max: 100, default: 0 }],
    apply: (img, p) => M.replaceColor(img, p) },
  { id: 'equalize', name: 'Ecualizar', group: 'ajuste', noLayer: true, apply: img => M.equalize(img) },
  { id: 'surfaceblur', name: 'Desenfoque de superficie…', group: 'filtro', submenu: 'Desenfocar', params: [{ key: 'radius', label: 'Radio', type: 'range', min: 1, max: 40, default: 5, unit: 'px' }, { key: 'threshold', label: 'Umbral', type: 'range', min: 2, max: 255, default: 15 }], apply: (img, p) => M.surfaceBlur(img, p.radius, p.threshold) },
  { id: 'tiltshift', name: 'Inclinación-desplazamiento…', group: 'filtro', submenu: 'Desenfocar',
    params: [{ key: 'blur', label: 'Desenfoque', type: 'range', min: 1, max: 100, default: 15, unit: 'px' }, { key: 'center', label: 'Posición', type: 'range', min: 0, max: 100, default: 55, unit: '%' },
      { key: 'focus', label: 'Zona nítida', type: 'range', min: 0, max: 100, default: 20, unit: '%' }, { key: 'transition', label: 'Transición', type: 'range', min: 1, max: 100, default: 25, unit: '%' },
      { key: 'angle', label: 'Ángulo', type: 'range', min: -90, max: 90, default: 0, unit: '°' }, { key: 'saturation', label: 'Saturación extra', type: 'range', min: 0, max: 100, default: 0, unit: '%' }],
    apply: (img, p) => M.tiltShift(img, p) },
  { id: 'smartsharpen', name: 'Enfoque suavizado…', group: 'filtro', submenu: 'Enfocar', params: [{ key: 'amount', label: 'Cantidad', type: 'range', min: 1, max: 500, default: 150, unit: '%' }, { key: 'radius', label: 'Radio', type: 'range', min: 0.1, max: 64, step: 0.1, default: 1.5, unit: 'px' }, { key: 'noise', label: 'Reducir ruido', type: 'range', min: 0, max: 100, default: 10, unit: '%' }], apply: (img, p) => M.smartSharpen(img, p.amount, p.radius, p.noise) },
  { id: 'dust', name: 'Polvo y rascaduras…', group: 'filtro', submenu: 'Ruido', params: [{ key: 'radius', label: 'Radio', type: 'range', min: 1, max: 6, default: 2, unit: 'px' }, { key: 'threshold', label: 'Umbral', type: 'range', min: 0, max: 255, default: 10 }], apply: (img, p) => M.dustScratches(img, p.radius, p.threshold) },
  { id: 'polar', name: 'Coordenadas polares…', group: 'filtro', submenu: 'Distorsionar', params: [{ key: 'toPolar', label: 'Rectangulares a polares', type: 'checkbox', default: true }], apply: (img, p) => M.polar(img, p.toPolar) },
  { id: 'ripple', name: 'Rizo…', group: 'filtro', submenu: 'Distorsionar', params: [{ key: 'amount', label: 'Cantidad', type: 'range', min: -999, max: 999, default: 100, unit: '%' }, { key: 'size', label: 'Tamaño', type: 'range', min: 4, max: 100, default: 12, unit: 'px' }], apply: (img, p) => M.ripple(img, p.amount, p.size) },
  { id: 'crystallize', name: 'Cristalizar…', group: 'filtro', submenu: 'Pixelizar', params: [{ key: 'cell', label: 'Tamaño de celda', type: 'range', min: 3, max: 300, default: 10, unit: 'px' }], apply: (img, p) => M.crystallize(img, p.cell) },
  { id: 'oilpaint', name: 'Pintura al óleo…', group: 'filtro', submenu: 'Estilizar', params: [{ key: 'radius', label: 'Pincelada', type: 'range', min: 1, max: 20, default: 4, unit: 'px' }], apply: (img, p) => M.oilPaint(img, p.radius) },
  { id: 'clouds', name: 'Nubes', group: 'filtro', submenu: 'Interpretar', params: [{ key: 'c1', label: 'Color 1', type: 'color', default: '#000000' }, { key: 'c2', label: 'Color 2', type: 'color', default: '#ffffff' }, { key: 'scale', label: 'Escala', type: 'range', min: 8, max: 1000, default: 120, unit: 'px' }], apply: (img, p) => M.clouds(img, p.c1, p.c2, p.scale) },
  { id: 'lenscorr', name: 'Corrección de lente…', group: 'filtro', submenu: 'Distorsionar',
    params: [{ key: 'distortion', label: 'Distorsión (barril ↔ cojín)', type: 'range', min: -100, max: 100, default: 0 }, { key: 'chroma', label: 'Aberración cromática', type: 'range', min: -100, max: 100, default: 0 }, { key: 'vignette', label: 'Viñeta', type: 'range', min: -100, max: 100, default: 0 }],
    apply: (img, p) => N.lensCorrection(img, p) },
  { id: 'lensflare', name: 'Destello de lente…', group: 'filtro', submenu: 'Interpretar',
    params: [{ key: 'x', label: 'Posición horizontal', type: 'range', min: 0, max: 100, default: 30, unit: '%' }, { key: 'y', label: 'Posición vertical', type: 'range', min: 0, max: 100, default: 30, unit: '%' }, { key: 'brightness', label: 'Brillo', type: 'range', min: 10, max: 300, default: 100, unit: '%' }],
    apply: (img, p) => N.lensFlare(img, p) },
  { id: 'lensblur', name: 'Desenfoque de lente…', group: 'filtro', submenu: 'Desenfocar', params: [{ key: 'radius', label: 'Radio', type: 'range', min: 1, max: 60, default: 10, unit: 'px' }, { key: 'highlights', label: 'Brillo de las luces', type: 'range', min: 0, max: 100, default: 50, unit: '%' }], apply: (img, p) => N.lensBlur(img, p.radius, p.highlights) },
  { id: 'boxblur', name: 'Desenfoque de caja…', group: 'filtro', submenu: 'Desenfocar', params: [{ key: 'radius', label: 'Radio', type: 'range', min: 1, max: 200, default: 8, unit: 'px' }], apply: (img, p) => N.boxBlur(img, p.radius) },
  { id: 'average', name: 'Promediar', group: 'filtro', submenu: 'Desenfocar', apply: img => N.average(img) },
  { id: 'solarize', name: 'Solarizar', group: 'filtro', submenu: 'Estilizar', apply: img => N.solarize(img) },
  { id: 'wind', name: 'Viento…', group: 'filtro', submenu: 'Estilizar', params: [{ key: 'strength', label: 'Intensidad', type: 'range', min: 2, max: 200, default: 30, unit: 'px' }, { key: 'left', label: 'Desde la izquierda', type: 'checkbox', default: true }], apply: (img, p) => N.wind(img, p.strength, p.left) },
  { id: 'diffuse', name: 'Difusión…', group: 'filtro', submenu: 'Estilizar', params: [{ key: 'amount', label: 'Cantidad', type: 'range', min: 1, max: 20, default: 3, unit: 'px' }], apply: (img, p) => N.diffuse(img, p.amount) },
  { id: 'tiles', name: 'Azulejos…', group: 'filtro', submenu: 'Estilizar', params: [{ key: 'n', label: 'Número de azulejos', type: 'range', min: 1, max: 99, default: 10 }, { key: 'offset', label: 'Desplazamiento máx.', type: 'range', min: 1, max: 99, default: 10, unit: '%' }], apply: (img, p) => N.tiles(img, p.n, p.offset) },
  { id: 'tracecontour', name: 'Trazar contorno…', group: 'filtro', submenu: 'Estilizar', params: [{ key: 'level', label: 'Nivel', type: 'range', min: 1, max: 254, default: 128 }], apply: (img, p) => N.traceContour(img, p.level) },
  { id: 'cutout', name: 'Recortes…', group: 'filtro', submenu: 'Artístico', params: [{ key: 'levels', label: 'Número de niveles', type: 'range', min: 2, max: 8, default: 4 }, { key: 'simplicity', label: 'Simplicidad', type: 'range', min: 0, max: 10, default: 3 }], apply: (img, p) => N.cutout(img, p.levels, p.simplicity) },
  { id: 'halftone', name: 'Semitono de color…', group: 'filtro', submenu: 'Pixelizar', params: [{ key: 'radius', label: 'Radio máximo', type: 'range', min: 2, max: 60, default: 6, unit: 'px' }], apply: (img, p) => N.colorHalftone(img, p.radius) },
  { id: 'pointillize', name: 'Puntillista…', group: 'filtro', submenu: 'Pixelizar', params: [{ key: 'cell', label: 'Tamaño de celda', type: 'range', min: 3, max: 100, default: 6, unit: 'px' }, { key: 'bg', label: 'Fondo', type: 'color', default: '#ffffff' }], apply: (img, p) => N.pointillize(img, p.cell, p.bg) },
  { id: 'fragment', name: 'Fragmentar', group: 'filtro', submenu: 'Pixelizar', apply: img => N.fragment(img) },
  { id: 'diffclouds', name: 'Nubes de diferencia', group: 'filtro', submenu: 'Interpretar', params: [{ key: 'c1', label: 'Color 1', type: 'color', default: '#000000' }, { key: 'c2', label: 'Color 2', type: 'color', default: '#ffffff' }, { key: 'scale', label: 'Escala', type: 'range', min: 8, max: 1000, default: 120, unit: 'px' }], apply: (img, p) => N.differenceClouds(img, p.c1, p.c2, p.scale) },
  { id: 'fibers', name: 'Fibras…', group: 'filtro', submenu: 'Interpretar', params: [{ key: 'c1', label: 'Color 1', type: 'color', default: '#5a3a1a' }, { key: 'c2', label: 'Color 2', type: 'color', default: '#d9b07a' }, { key: 'variance', label: 'Varianza', type: 'range', min: 1, max: 64, default: 16 }, { key: 'strength', label: 'Intensidad', type: 'range', min: 1, max: 60, default: 4 }], apply: (img, p) => N.fibers(img, p.c1, p.c2, p.variance, p.strength) },
  { id: 'zigzag', name: 'Zigzag…', group: 'filtro', submenu: 'Distorsionar', params: [{ key: 'amount', label: 'Cantidad', type: 'range', min: -100, max: 100, default: 20 }, { key: 'ridges', label: 'Ondulaciones', type: 'range', min: 1, max: 20, default: 5 }], apply: (img, p) => N.zigzag(img, p.amount, p.ridges) },
  { id: 'glass', name: 'Vidrio…', group: 'filtro', submenu: 'Distorsionar', params: [{ key: 'distortion', label: 'Distorsión', type: 'range', min: 0, max: 20, default: 5 }, { key: 'smoothness', label: 'Suavidad', type: 'range', min: 1, max: 15, default: 3 }], apply: (img, p) => N.glass(img, p.distortion, p.smoothness) },
  { id: 'solidfill', name: 'Color sólido', group: 'relleno', fill: true, params: [{ key: 'color', label: 'Color', type: 'color', default: '#3d8bfd' }],
    apply: (img, p) => { const n = parseInt(String(p.color).slice(1), 16), d = img.data; for (let i = 0; i < d.length; i += 4) { d[i] = n >> 16 & 255; d[i + 1] = n >> 8 & 255; d[i + 2] = n & 255; d[i + 3] = 255; } } },
  { id: 'gradfill', name: 'Degradado', group: 'relleno', fill: true,
    params: [{ key: 'grad', label: 'Degradado', type: 'gradient', default: [{ t: 0, color: '#000000', a: 1 }, { t: 1, color: '#ffffff', a: 1 }] },
      { key: 'angle', label: 'Ángulo', type: 'range', min: -180, max: 180, default: 90, unit: '°' }, { key: 'scale', label: 'Escala', type: 'range', min: 10, max: 300, default: 100, unit: '%' },
      { key: 'radial', label: 'Radial', type: 'checkbox', default: false }],
    apply: (img, p) => {
      const lut = A.gradientLut(p.grad ?? [{ t: 0, color: p.c1 ?? '#000000', a: 1 }, { t: 1, color: p.c2 ?? '#ffffff', a: 1 }]), d = img.data, W = p._W ?? img.width, H = p._H ?? img.height;
      const a = -(p.angle ?? 90) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), k = (p.scale ?? 100) / 100;
      const half = (Math.abs(ca) * W + Math.abs(sa) * H) / 2 * k, rad = Math.hypot(W, H) / 2 * k;
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
        const X = x + (p._x ?? 0) - W / 2, Y = y + (p._y ?? 0) - H / 2;
        let t = p.radial ? Math.hypot(X, Y) / rad : ((X * ca + Y * sa) / half + 1) / 2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const i = (y * img.width + x) * 4;
        const k = Math.round(t * 255) * 4; d[i] = lut[k]; d[i + 1] = lut[k + 1]; d[i + 2] = lut[k + 2]; d[i + 3] = lut[k + 3];
      }
    } },
  { id: 'patternfill', name: 'Motivo', group: 'relleno', fill: true,
    params: [{ key: 'pattern', label: 'Motivo', type: 'pattern', default: 'base:Damero' }, { key: 'scale', label: 'Escala', type: 'range', min: 10, max: 1000, default: 100, unit: '%' }],
    apply: (img, p) => {
      const pd = patternData(p.pattern); if (!pd) return;
      const d = img.data, k = (p.scale ?? 100) / 100;
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
        const px = Math.floor((x + (p._x ?? 0)) / k) % pd.w, py = Math.floor((y + (p._y ?? 0)) / k) % pd.h, j = (py * pd.w + px) * 4, i = (y * img.width + x) * 4;
        d[i] = pd.data[j]; d[i + 1] = pd.data[j + 1]; d[i + 2] = pd.data[j + 2]; d[i + 3] = pd.data[j + 3];
      }
    } },
];

/** Los motivos se piden a quien los tenga (la página); en el hilo de fondo no existen. */
let patternSource: ((id: string) => { w: number; h: number; data: Uint8ClampedArray } | null) | null = null;
export function setPatternSource(f: typeof patternSource) { patternSource = f; }
function patternData(id: string) { return patternSource ? patternSource(id) : null; }

export function defaultParams(f: FilterDef): any {
  if (f.custom === 'levels') return { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
  if (f.custom === 'curves') return { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] };
  const p: any = {};
  for (const d of f.params ?? []) p[d.key] = typeof d.default === 'object' ? JSON.parse(JSON.stringify(d.default)) : d.default;
  return p;
}
