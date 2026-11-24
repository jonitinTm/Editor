// Catálogo de ajustes y filtros. Cada entrada describe sus parámetros y cómo
// aplicarse; el diálogo y los menús se generan a partir de aquí. Añadir un
// filtro nuevo = añadir una entrada.

import * as A from './adjustments';
import * as F from './advanced';
import { develop, DEVELOP_DEFAULTS } from './develop';
import * as M from './more';
import * as L from './lut';
import * as N from './more2';
import * as R from './artistic';
import * as MD from './modes';
import * as R2 from './render2';
import * as G from './gallery';
import * as RT from './retouch';
import { indexColors } from './indexed';
import { matchColor } from './matchcolor';
import { colorGrade } from './colorgrade';

export type ParamDef =
  | { key: string; label: string; type: 'range'; min: number; max: number; step?: number; default: number; unit?: string; section?: string; showIf?: [string, string] }
  | { key: string; label: string; type: 'select'; choices: [string, string][]; default: string; section?: string }
  | { key: string; label: string; type: 'lut'; default: string }
  | { key: string; label: string; type: 'gradient'; default: A.Stop[] }
  | { key: string; label: string; type: 'checkbox'; default: boolean }
  | { key: string; label: string; type: 'color'; default: string }
  | { key: string; label: string; type: 'pattern'; default: string }
  | { key: string; label: string; type: 'matrix'; default: number[] }
  | { key: string; label: string; type: 'wheel'; default: [number, number] };

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
  /** Se llama justo antes de abrir el diálogo (p. ej. para rellenar opciones que dependen de lo abierto). */
  prepare?: () => void;
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
    id: 'colorgrade', name: 'Gradación de color…', group: 'ajuste',
    params: [
      { key: 'shadows', label: 'Sombras', type: 'wheel', default: [220, 0] },
      { key: 'mids', label: 'Medios tonos', type: 'wheel', default: [40, 0] },
      { key: 'highs', label: 'Iluminaciones', type: 'wheel', default: [45, 0] },
      { key: 'lumS', label: 'Luminancia de sombras', type: 'range', min: -100, max: 100, default: 0 },
      { key: 'lumM', label: 'Luminancia de medios tonos', type: 'range', min: -100, max: 100, default: 0 },
      { key: 'lumH', label: 'Luminancia de iluminaciones', type: 'range', min: -100, max: 100, default: 0 },
      { key: 'global', label: 'Global', type: 'wheel', default: [0, 0] },
      { key: 'balance', label: 'Equilibrio', type: 'range', min: -100, max: 100, default: 0 },
      { key: 'blending', label: 'Fusión', type: 'range', min: 0, max: 100, default: 50 },
      { key: 'preserve', label: 'Conservar luminosidad', type: 'checkbox', default: true },
    ],
    apply: (img, p) => colorGrade(img, p),
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
    id: 'matchcolor', name: 'Igualar color…', group: 'ajuste', noLayer: true,
    params: [
      { key: 'source', label: 'Tomar los colores de', type: 'select', default: '', choices: [['', '(ninguna: solo neutralizar)']] },
      { key: 'luminance', label: 'Luminancia', type: 'range', min: 1, max: 200, default: 100, unit: '%' },
      { key: 'intensity', label: 'Intensidad del color', type: 'range', min: 0, max: 200, default: 100, unit: '%' },
      { key: 'fade', label: 'Transición', type: 'range', min: 0, max: 100, default: 0, unit: '%' },
      { key: 'neutralize', label: 'Neutralizar (quitar dominantes de color)', type: 'checkbox', default: false },
    ],
    // las opciones de «source» (con las estadísticas de color ya calculadas) las rellena la interfaz al abrir el diálogo
    apply: (img, p) => matchColor(img, p.source ? JSON.parse(p.source) : null, p),
  },
  {
    id: 'custom', name: 'Personalizado…', group: 'filtro', submenu: 'Otro',
    params: [
      { key: 'm', label: 'Matriz (5 × 5)', type: 'matrix', default: [0, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, -1, 5, -1, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0] },
      { key: 'scale', label: 'Escala (0 = automática)', type: 'range', min: 0, max: 100, default: 0 },
      { key: 'offset', label: 'Desplazamiento', type: 'range', min: -255, max: 255, default: 0 },
    ],
    apply: (img, p) => customConvolve(img, p.m, p.scale, p.offset),
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
  { id: 'tiltshift', name: 'Inclinación-desplazamiento…', group: 'filtro', submenu: 'Galería de desenfoque',
    params: [{ key: 'blur', label: 'Desenfoque', type: 'range', min: 1, max: 100, default: 15, unit: 'px' }, { key: 'center', label: 'Posición', type: 'range', min: 0, max: 100, default: 55, unit: '%' },
      { key: 'focus', label: 'Zona nítida', type: 'range', min: 0, max: 100, default: 20, unit: '%' }, { key: 'transition', label: 'Transición', type: 'range', min: 1, max: 100, default: 25, unit: '%' },
      { key: 'angle', label: 'Ángulo', type: 'range', min: -90, max: 90, default: 0, unit: '°' }, { key: 'saturation', label: 'Saturación extra', type: 'range', min: 0, max: 100, default: 0, unit: '%' }],
    apply: (img, p) => M.tiltShift(img, p) },
  { id: 'irisblur', name: 'Desenfoque de iris…', group: 'filtro', submenu: 'Galería de desenfoque',
    params: [{ key: 'blur', label: 'Desenfoque', type: 'range', min: 1, max: 100, default: 20, unit: 'px' }, { key: 'x', label: 'Centro horizontal', type: 'range', min: 0, max: 100, default: 50, unit: '%' }, { key: 'y', label: 'Centro vertical', type: 'range', min: 0, max: 100, default: 50, unit: '%' },
      { key: 'size', label: 'Tamaño de la elipse', type: 'range', min: 5, max: 100, default: 35, unit: '%' }, { key: 'ratio', label: 'Alargamiento', type: 'range', min: 0.3, max: 3, step: 0.05, default: 1 }, { key: 'angle', label: 'Ángulo', type: 'range', min: -90, max: 90, default: 0, unit: '°' },
      { key: 'focus', label: 'Zona totalmente nítida', type: 'range', min: 0, max: 95, default: 55, unit: '%' }, { key: 'lights', label: 'Brillo de las luces (bokeh)', type: 'range', min: 0, max: 100, default: 0, unit: '%' }],
    apply: (img, p) => M.irisBlur(img, p) },
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
  { id: 'lighting', name: 'Efectos de iluminación…', group: 'filtro', submenu: 'Interpretar',
    params: [{ key: 'type', label: 'Tipo de luz', type: 'select', default: 'spot', choices: [['spot', 'Foco'], ['omni', 'Omnidireccional'], ['directional', 'Direccional']] },
      { key: 'x', label: 'Posición horizontal', type: 'range', min: 0, max: 100, default: 50, unit: '%' }, { key: 'y', label: 'Posición vertical', type: 'range', min: 0, max: 100, default: 35, unit: '%' },
      { key: 'radius', label: 'Alcance', type: 'range', min: 5, max: 200, default: 70, unit: '%' }, { key: 'angle', label: 'Ángulo (direccional)', type: 'range', min: -180, max: 180, default: 60, unit: '°' },
      { key: 'intensity', label: 'Intensidad', type: 'range', min: 0, max: 200, default: 75, unit: '%' }, { key: 'ambient', label: 'Luz ambiente', type: 'range', min: 0, max: 100, default: 20, unit: '%' },
      { key: 'color', label: 'Color de la luz', type: 'color', default: '#ffffff' }, { key: 'height', label: 'Relieve (textura de la imagen)', type: 'range', min: 0, max: 100, default: 0, unit: '%' }],
    apply: (img, p) => N.lighting(img, p) },
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
  { id: 'watercolor', name: 'Acuarela…', group: 'filtro', submenu: 'Artístico', params: [{ key: 'detail', label: 'Detalle de pincel', type: 'range', min: 1, max: 14, default: 6 }, { key: 'shadow', label: 'Intensidad de sombra', type: 'range', min: 0, max: 100, default: 30, unit: '%' }, { key: 'texture', label: 'Textura', type: 'range', min: 0, max: 100, default: 40, unit: '%' }], apply: (img, p) => R.watercolor(img, p) },
  { id: 'filmgrain', name: 'Grano de película…', group: 'filtro', submenu: 'Artístico', params: [{ key: 'amount', label: 'Cantidad', type: 'range', min: 1, max: 100, default: 30, unit: '%' }, { key: 'size', label: 'Tamaño del grano', type: 'range', min: 0.5, max: 6, default: 1.5, unit: 'px', step: 0.1 }, { key: 'highlights', label: 'Área de iluminación', type: 'range', min: 0, max: 100, default: 20, unit: '%' }], apply: (img, p) => R.filmGrain(img, p) },
  { id: 'neonglow', name: 'Resplandor de neón…', group: 'filtro', submenu: 'Artístico', params: [{ key: 'size', label: 'Tamaño', type: 'range', min: 1, max: 40, default: 5, unit: 'px' }, { key: 'brightness', label: 'Brillo', type: 'range', min: 0, max: 100, default: 60, unit: '%' }, { key: 'color', label: 'Color', type: 'color', default: '#33ccff' }], apply: (img, p) => R.neonGlow(img, p) },
  { id: 'posteredges', name: 'Bordes posterizados…', group: 'filtro', submenu: 'Artístico', params: [{ key: 'thickness', label: 'Grosor de borde', type: 'range', min: 0, max: 10, default: 2 }, { key: 'intensity', label: 'Intensidad de borde', type: 'range', min: 0, max: 10, default: 1 }, { key: 'levels', label: 'Posterización', type: 'range', min: 2, max: 6, default: 4 }], apply: (img, p) => R.posterEdges(img, p) },
  { id: 'pencilsketch', name: 'Boceto a lápiz…', group: 'filtro', submenu: 'Bosquejar', params: [{ key: 'width', label: 'Ancho del trazo', type: 'range', min: 1, max: 40, default: 6, unit: 'px' }, { key: 'darkness', label: 'Oscuridad', type: 'range', min: 0, max: 100, default: 50, unit: '%' }, { key: 'color', label: 'Conservar color', type: 'checkbox', default: false }], apply: (img, p) => R.pencilSketch(img, p) },
  { id: 'charcoal', name: 'Tiza y carboncillo…', group: 'filtro', submenu: 'Bosquejar', params: [{ key: 'balance', label: 'Equilibrio', type: 'range', min: 10, max: 90, default: 50, unit: '%' }, { key: 'pressure', label: 'Presión del trazo', type: 'range', min: 0, max: 100, default: 50, unit: '%' }, { key: 'fg', label: 'Carboncillo', type: 'color', default: '#1a1a1a' }, { key: 'bg', label: 'Papel', type: 'color', default: '#f4f1ea' }], apply: (img, p) => R.charcoal(img, p) },
  { id: 'inkoutlines', name: 'Pluma de tinta…', group: 'filtro', submenu: 'Bosquejar', params: [{ key: 'detail', label: 'Detalle', type: 'range', min: 0, max: 100, default: 50, unit: '%' }, { key: 'darkness', label: 'Oscuridad', type: 'range', min: 0, max: 100, default: 50, unit: '%' }, { key: 'keepColor', label: 'Conservar color', type: 'checkbox', default: false }], apply: (img, p) => R.inkOutlines(img, p) },
  { id: 'stamp', name: 'Sello…', group: 'filtro', submenu: 'Bosquejar', params: [{ key: 'balance', label: 'Equilibrio claro/oscuro', type: 'range', min: 5, max: 95, default: 50, unit: '%' }, { key: 'smooth', label: 'Suavizar', type: 'range', min: 0, max: 20, default: 4 }, { key: 'fg', label: 'Tinta', type: 'color', default: '#000000' }, { key: 'bg', label: 'Papel', type: 'color', default: '#ffffff' }], apply: (img, p) => R.stamp(img, p) },
  { id: 'glowedges', name: 'Bordes resplandecientes…', group: 'filtro', submenu: 'Estilizar', params: [{ key: 'width', label: 'Anchura de bordes', type: 'range', min: 1, max: 14, default: 2, unit: 'px' }, { key: 'brightness', label: 'Brillo', type: 'range', min: 0, max: 20, default: 6 }, { key: 'smooth', label: 'Suavizado', type: 'range', min: 1, max: 15, default: 5 }], apply: (img, p) => R.glowingEdges(img, p) },
  { id: 'extrude', name: 'Extrusión…', group: 'filtro', submenu: 'Estilizar', params: [{ key: 'type', label: 'Tipo', type: 'select', default: 'blocks', choices: [['blocks', 'Bloques'], ['pyramids', 'Pirámides']] }, { key: 'size', label: 'Tamaño', type: 'range', min: 4, max: 200, default: 20, unit: 'px' }], apply: (img, p) => R.extrude(img, p) },
  { id: 'craquelure', name: 'Cuarteado…', group: 'filtro', submenu: 'Textura', params: [{ key: 'spacing', label: 'Espaciado de grietas', type: 'range', min: 6, max: 100, default: 30, unit: 'px' }, { key: 'depth', label: 'Profundidad', type: 'range', min: 0, max: 10, default: 6 }, { key: 'brightness', label: 'Brillo', type: 'range', min: 0, max: 10, default: 9 }], apply: (img, p) => R.craquelure(img, p) },
  { id: 'texturizer', name: 'Texturizador…', group: 'filtro', submenu: 'Textura', params: [{ key: 'kind', label: 'Textura', type: 'select', default: 'canvas', choices: [['canvas', 'Lienzo'], ['burlap', 'Arpillera'], ['brick', 'Ladrillo'], ['sandstone', 'Arenisca']] }, { key: 'scale', label: 'Escala', type: 'range', min: 50, max: 300, default: 100, unit: '%' }, { key: 'relief', label: 'Relieve', type: 'range', min: 0, max: 20, default: 4 }], apply: (img, p) => R.texturizer(img, p) },
  { id: 'stainedglass', name: 'Vidriera…', group: 'filtro', submenu: 'Textura', params: [{ key: 'cell', label: 'Tamaño de celda', type: 'range', min: 4, max: 200, default: 24, unit: 'px' }, { key: 'border', label: 'Grosor del borde', type: 'range', min: 1, max: 20, default: 3, unit: 'px' }, { key: 'light', label: 'Intensidad de luz', type: 'range', min: 0, max: 100, default: 30, unit: '%' }, { key: 'borderColor', label: 'Color del borde', type: 'color', default: '#202020' }], apply: (img, p) => R.stainedGlass(img, p) },
  { id: 'mezzotint', name: 'Grabado…', group: 'filtro', submenu: 'Pixelizar', params: [{ key: 'type', label: 'Tipo', type: 'select', default: 'dots', choices: [['dots', 'Puntos'], ['lines', 'Líneas'], ['strokes', 'Trazos']] }], apply: (img, p) => R.mezzotint(img, p) },
  { id: 'smartblur', name: 'Desenfoque inteligente…', group: 'filtro', submenu: 'Desenfocar', params: [{ key: 'radius', label: 'Radio', type: 'range', min: 1, max: 20, default: 3, unit: 'px' }, { key: 'threshold', label: 'Umbral', type: 'range', min: 2, max: 100, default: 25 }, { key: 'mode', label: 'Modo', type: 'select', default: 'normal', choices: [['normal', 'Normal'], ['edges', 'Solo bordes'], ['overlay', 'Superponer bordes']] }], apply: (img, p) => R.smartBlur(img, p) },
  { id: 'shear', name: 'Cizalla…', group: 'filtro', submenu: 'Distorsionar', params: [{ key: 'amount', label: 'Cantidad', type: 'range', min: -100, max: 100, default: 30, unit: '%' }, { key: 'shape', label: 'Curva', type: 'select', default: 'arc', choices: [['arc', 'Arco'], ['wave', 'Onda'], ['line', 'Recta (inclinar)']] }, { key: 'edge', label: 'Zonas sin definir', type: 'select', default: 'wrap', choices: [['wrap', 'Dar la vuelta'], ['repeat', 'Repetir píxeles de borde']] }], apply: (img, p) => R.shear(img, p) },
  { id: 'despeckle', name: 'Destramar', group: 'filtro', submenu: 'Ruido', apply: img => R.despeckle(img) },
  { id: 'duotone', name: 'Duotono…', group: 'ajuste', params: [
    { key: 'inks', label: 'Tintas', type: 'select', default: '2', choices: [['1', 'Monotono (1 tinta)'], ['2', 'Duotono (2 tintas)'], ['3', 'Tritono (3 tintas)']] },
    { key: 'ink1', label: 'Tinta 1 (sombras)', type: 'color', default: '#1a1a40' }, { key: 'ink2', label: 'Tinta 2', type: 'color', default: '#e0a040' }, { key: 'ink3', label: 'Tinta 3', type: 'color', default: '#f0e0c0' },
    { key: 'paper', label: 'Papel', type: 'color', default: '#ffffff' },
    { key: 'gamma', label: 'Densidad', type: 'range', min: 30, max: 300, default: 100, unit: '%' }], apply: (img, p) => MD.duotone(img, p) },
  { id: 'bitmap', name: 'Mapa de bits (blanco y negro)…', group: 'ajuste', params: [
    { key: 'method', label: 'Método', type: 'select', default: 'diffusion', choices: [['threshold', 'Umbral al 50 %'], ['pattern', 'Tramado de motivo'], ['diffusion', 'Tramado de difusión'], ['halftone', 'Trama de semitonos']] },
    { key: 'threshold', label: 'Umbral', type: 'range', min: 1, max: 99, default: 50, unit: '%' },
    { key: 'cell', label: 'Lineatura (semitono)', type: 'range', min: 3, max: 60, default: 8, unit: 'px' },
    { key: 'angle', label: 'Ángulo (semitono)', type: 'range', min: 0, max: 90, default: 45, unit: '°' }], apply: (img, p) => MD.bitmap(img, p) },
  { id: 'hdrtoning', name: 'Tonos HDR…', group: 'ajuste', params: [
    { key: 'radius', label: 'Radio', type: 'range', min: 5, max: 300, default: 60, unit: 'px', section: 'Brillo de bordes' },
    { key: 'strength', label: 'Intensidad', type: 'range', min: 0, max: 100, default: 50, unit: '%' },
    { key: 'gamma', label: 'Gamma', type: 'range', min: 30, max: 300, default: 100, unit: '%', section: 'Tono y detalle' },
    { key: 'exposure', label: 'Exposición', type: 'range', min: -100, max: 100, default: 0 },
    { key: 'detail', label: 'Detalle', type: 'range', min: 0, max: 100, default: 30, unit: '%' },
    { key: 'shadow', label: 'Sombras', type: 'range', min: -100, max: 100, default: 0, section: 'Avanzado' },
    { key: 'highlight', label: 'Iluminaciones', type: 'range', min: -100, max: 100, default: 0 },
    { key: 'saturation', label: 'Saturación', type: 'range', min: -100, max: 100, default: 20 }], apply: (img, p) => MD.hdrToning(img, p) },
  { id: 'variations', name: 'Variaciones…', group: 'ajuste', inMenu: false,
    apply: (img, p) => {
      // combinación de equilibrio de color por rango, saturación y brillo (lo que se va eligiendo en Variaciones)
      FILTERS.find(f => f.id === 'colorbalance')!.apply(img, { ...p, preserve: true });
      if (p.sat) FILTERS.find(f => f.id === 'huesat')!.apply(img, { hue: 0, sat: p.sat, light: 0, colorize: false });
      if (p.light) FILTERS.find(f => f.id === 'brightness')!.apply(img, { brightness: p.light, contrast: 0 });
    } },
  { id: 'spinblur', name: 'Desenfoque de giro…', group: 'filtro', submenu: 'Galería de desenfoque', params: [
    { key: 'x', label: 'Centro X', type: 'range', min: 0, max: 100, default: 50, unit: '%' }, { key: 'y', label: 'Centro Y', type: 'range', min: 0, max: 100, default: 50, unit: '%' },
    { key: 'radius', label: 'Radio', type: 'range', min: 2, max: 100, default: 30, unit: '%' }, { key: 'angle', label: 'Ángulo de desenfoque', type: 'range', min: 1, max: 360, default: 15, unit: '°' },
    { key: 'feather', label: 'Transición del borde', type: 'range', min: 0, max: 100, default: 20, unit: '%' }], apply: (img, p) => MD.spinBlur(img, p) },
  { id: 'fieldblur', name: 'Desenfoque de campo…', group: 'filtro', submenu: 'Galería de desenfoque', params: [
    { key: 'x1', label: 'Chincheta 1: X', type: 'range', min: 0, max: 100, default: 50, unit: '%', section: 'Chincheta 1' }, { key: 'y1', label: 'Chincheta 1: Y', type: 'range', min: 0, max: 100, default: 25, unit: '%' }, { key: 'b1', label: 'Chincheta 1: desenfoque', type: 'range', min: 0, max: 80, default: 0, unit: 'px' },
    { key: 'x2', label: 'Chincheta 2: X', type: 'range', min: 0, max: 100, default: 50, unit: '%', section: 'Chincheta 2' }, { key: 'y2', label: 'Chincheta 2: Y', type: 'range', min: 0, max: 100, default: 85, unit: '%' }, { key: 'b2', label: 'Chincheta 2: desenfoque', type: 'range', min: 0, max: 80, default: 20, unit: 'px' }], apply: (img, p) => MD.fieldBlur(img, p) },
  { id: 'impasto', name: 'Relieve de pintura (impasto)…', group: 'filtro', submenu: 'Artístico', params: [
    { key: 'depth', label: 'Relieve', type: 'range', min: 0, max: 100, default: 50, unit: '%' }, { key: 'size', label: 'Tamaño de pincelada', type: 'range', min: 1, max: 30, default: 6, unit: 'px' },
    { key: 'strokes', label: 'Dirección de las pinceladas', type: 'range', min: -90, max: 90, default: 30, unit: '°' }, { key: 'light', label: 'Dirección de la luz', type: 'range', min: -180, max: 180, default: 135, unit: '°' },
    { key: 'gloss', label: 'Brillo (barniz)', type: 'range', min: 0, max: 100, default: 30, unit: '%' }], apply: (img, p) => R.impasto(img, p) },
  { id: 'bumpmap', name: 'Generar mapa de relieve…', group: 'filtro', submenu: '3D', params: [{ key: 'blur', label: 'Suavizar', type: 'range', min: 0, max: 20, default: 2, unit: 'px' }, { key: 'contrast', label: 'Contraste', type: 'range', min: 10, max: 200, default: 50 }, { key: 'invert', label: 'Invertir altura', type: 'checkbox', default: false }], apply: (img, p) => R.bumpMap(img, p) },
  { id: 'normalmap', name: 'Generar mapa de normales…', group: 'filtro', submenu: '3D', params: [{ key: 'strength', label: 'Intensidad', type: 'range', min: 1, max: 200, default: 50 }, { key: 'blur', label: 'Suavizar', type: 'range', min: 0, max: 20, default: 1, unit: 'px' }, { key: 'invert', label: 'Invertir altura', type: 'checkbox', default: false }], apply: (img, p) => R.normalMap(img, p) },
  { id: 'tree', name: 'Árbol…', group: 'filtro', submenu: 'Interpretar', params: [
    { key: 'x', label: 'Posición horizontal', type: 'range', min: 0, max: 100, default: 50, unit: '%' }, { key: 'y', label: 'Base (altura)', type: 'range', min: 10, max: 100, default: 98, unit: '%' },
    { key: 'size', label: 'Tamaño', type: 'range', min: 10, max: 100, default: 60, unit: '%' }, { key: 'depth', label: 'Ramificación', type: 'range', min: 3, max: 11, default: 8 },
    { key: 'spread', label: 'Apertura de ramas', type: 'range', min: 5, max: 60, default: 28, unit: '°' }, { key: 'density', label: 'Hojas', type: 'range', min: 0, max: 100, default: 60, unit: '%' },
    { key: 'bark', label: 'Tronco', type: 'color', default: '#4a3020' }, { key: 'leaves', label: 'Hojas', type: 'color', default: '#3f8f3a' }, { key: 'seed', label: 'Variación', type: 'range', min: 1, max: 100, default: 3 }], apply: (img, p) => R2.tree(img, p) },
  { id: 'flame', name: 'Llama…', group: 'filtro', submenu: 'Interpretar', params: [
    { key: 'x', label: 'Posición horizontal', type: 'range', min: 0, max: 100, default: 50, unit: '%' }, { key: 'y', label: 'Base (altura)', type: 'range', min: 5, max: 100, default: 90, unit: '%' },
    { key: 'height', label: 'Altura de la llama', type: 'range', min: 5, max: 100, default: 45, unit: '%' }, { key: 'width', label: 'Anchura', type: 'range', min: 2, max: 60, default: 18, unit: '%' },
    { key: 'turbulence', label: 'Turbulencia', type: 'range', min: 0, max: 100, default: 50, unit: '%' }, { key: 'color', label: 'Color', type: 'select', default: 'natural', choices: [['natural', 'Natural'], ['blue', 'Azul (gas)']] },
    { key: 'seed', label: 'Variación', type: 'range', min: 1, max: 100, default: 5 }], apply: (img, p) => R2.flame(img, p) },
  { id: 'pictureframe', name: 'Marco de imagen…', group: 'filtro', submenu: 'Interpretar', params: [
    { key: 'style', label: 'Estilo', type: 'select', default: 'wood', choices: [['wood', 'Madera'], ['gold', 'Dorado'], ['black', 'Negro'], ['white', 'Blanco'], ['mat', 'Con paspartú'], ['polaroid', 'Polaroid'], ['vintage', 'Antiguo (viñeta)']] },
    { key: 'width', label: 'Grosor', type: 'range', min: 1, max: 20, default: 6, unit: '%' }], apply: (img, p) => R2.pictureFrame(img, p) },
  { id: 'shake', name: 'Reducción de movimiento…', group: 'filtro', submenu: 'Enfocar', params: [
    { key: 'angle', label: 'Dirección del movimiento', type: 'range', min: -90, max: 90, default: 0, unit: '°' }, { key: 'length', label: 'Longitud del movimiento', type: 'range', min: 2, max: 40, default: 8, unit: 'px' },
    { key: 'iterations', label: 'Intensidad', type: 'range', min: 1, max: 30, default: 10 }, { key: 'noise', label: 'Contener el ruido', type: 'range', min: 0, max: 100, default: 20, unit: '%' }], apply: (img, p) => R2.shakeReduction(img, p) },
  { id: 'deinterlace', name: 'Desentrelazar…', group: 'filtro', submenu: 'Vídeo', params: [
    { key: 'lines', label: 'Quitar líneas', type: 'select', default: 'odd', choices: [['odd', 'Impares'], ['even', 'Pares']] }, { key: 'mode', label: 'Rellenar con', type: 'select', default: 'interp', choices: [['interp', 'Interpolación'], ['dup', 'Duplicación']] }], apply: (img, p) => R2.deinterlace(img, p) },
  // ---- retoque automático
  { id: 'skinSmooth', name: 'Suavizar piel…', group: 'filtro', submenu: 'Retrato', params: [{ key: 'amount', label: 'Intensidad', type: 'range', min: 0, max: 100, default: 60, unit: '%' }, { key: 'radius', label: 'Tamaño de las imperfecciones', type: 'range', min: 2, max: 60, default: 8, unit: 'px' }, { key: 'texture', label: 'Conservar textura', type: 'range', min: 0, max: 100, default: 30, unit: '%' }, { key: 'onlySkin', label: 'Solo en los tonos de piel', type: 'checkbox', default: true }], apply: (img, p) => RT.skinSmooth(img, p) },
  { id: 'jpegClean', name: 'Quitar artefactos JPEG…', group: 'filtro', submenu: 'Ruido', params: [{ key: 'strength', label: 'Intensidad', type: 'range', min: 0, max: 100, default: 50, unit: '%' }], apply: (img, p) => RT.jpegClean(img, p) },
  // ---- galería de filtros (algoritmos adaptados de VectorCraft, licencia MIT: ver src/filters/gallery.ts)
  { id: 'coloredPencil', name: 'Lápiz de color…', group: 'filtro', submenu: 'Artístico', params: [{ key: 'width', label: 'Anchura del lápiz', type: 'range', min: 1, max: 24, default: 5 }, { key: 'pressure', label: 'Presión del trazo', type: 'range', min: 0, max: 15, default: 5 }, { key: 'paper', label: 'Brillo del papel', type: 'range', min: 0, max: 50, default: 25 }], apply: (img, p) => G.coloredPencil(img, p) },
  { id: 'dryBrush', name: 'Pincel seco…', group: 'filtro', submenu: 'Artístico', params: [{ key: 'size', label: 'Tamaño del pincel', type: 'range', min: 1, max: 10, default: 2 }, { key: 'detail', label: 'Detalle del pincel', type: 'range', min: 0, max: 10, default: 10 }, { key: 'texture', label: 'Textura', type: 'range', min: 1, max: 3, default: 1 }], apply: (img, p) => G.dryBrush(img, p) },
  { id: 'fresco', name: 'Fresco…', group: 'filtro', submenu: 'Artístico', params: [{ key: 'size', label: 'Tamaño del pincel', type: 'range', min: 1, max: 10, default: 2 }, { key: 'detail', label: 'Detalle del pincel', type: 'range', min: 0, max: 10, default: 10 }, { key: 'texture', label: 'Textura', type: 'range', min: 1, max: 3, default: 1 }], apply: (img, p) => G.fresco(img, p) },
  { id: 'paintDaubs', name: 'Manchas de pintura…', group: 'filtro', submenu: 'Artístico', params: [{ key: 'size', label: 'Tamaño del pincel', type: 'range', min: 1, max: 50, default: 10 }, { key: 'sharpness', label: 'Nitidez', type: 'range', min: 0, max: 40, default: 25 }, { key: 'kind', label: 'Tipo de pincel', type: 'select', default: 'simple', choices: [['simple', 'Simple'], ['lightRough', 'Claro áspero'], ['darkRough', 'Oscuro áspero'], ['wideSharp', 'Ancho y nítido'], ['wideBlurry', 'Ancho y borroso'], ['sparkle', 'Destellos']] }], apply: (img, p) => G.paintDaubs(img, p) },
  { id: 'paletteKnife', name: 'Espátula…', group: 'filtro', submenu: 'Artístico', params: [{ key: 'size', label: 'Tamaño del trazo', type: 'range', min: 1, max: 50, default: 10 }, { key: 'detail', label: 'Detalle del trazo', type: 'range', min: 1, max: 3, default: 2 }, { key: 'softness', label: 'Suavizado', type: 'range', min: 0, max: 10, default: 3 }], apply: (img, p) => G.paletteKnife(img, p) },
  { id: 'plasticWrap', name: 'Envoltura plástica…', group: 'filtro', submenu: 'Artístico', params: [{ key: 'highlight', label: 'Intensidad de los brillos', type: 'range', min: 0, max: 20, default: 20 }, { key: 'detail', label: 'Detalle', type: 'range', min: 0, max: 15, default: 12 }, { key: 'smoothness', label: 'Suavizado', type: 'range', min: 1, max: 15, default: 15 }], apply: (img, p) => G.plasticWrap(img, p) },
  { id: 'roughPastels', name: 'Pastel grueso…', group: 'filtro', submenu: 'Artístico', params: [{ key: 'length', label: 'Longitud del trazo', type: 'range', min: 0, max: 40, default: 6 }, { key: 'detail', label: 'Detalle del trazo', type: 'range', min: 1, max: 20, default: 10 }, { key: 'kind', label: 'Textura', type: 'select', default: 'canvas', choices: [['canvas', 'Lienzo'], ['burlap', 'Arpillera'], ['brick', 'Ladrillo'], ['sandstone', 'Arenisca']] }, { key: 'scaling', label: 'Escala', type: 'range', min: 50, max: 200, default: 100, unit: '%' }, { key: 'relief', label: 'Relieve', type: 'range', min: 0, max: 20, default: 4 }], apply: (img, p) => G.roughPastels(img, p) },
  { id: 'smudgeStick', name: 'Barra difuminada…', group: 'filtro', submenu: 'Artístico', params: [{ key: 'length', label: 'Longitud del trazo', type: 'range', min: 0, max: 10, default: 2 }, { key: 'highlight', label: 'Zona de iluminaciones', type: 'range', min: 0, max: 20, default: 12 }, { key: 'intensity', label: 'Intensidad', type: 'range', min: 0, max: 10, default: 10 }], apply: (img, p) => G.smudgeStick(img, p) },
  { id: 'spongeFx', name: 'Esponja…', group: 'filtro', submenu: 'Artístico', params: [{ key: 'size', label: 'Tamaño del pincel', type: 'range', min: 0, max: 10, default: 2 }, { key: 'definition', label: 'Definición', type: 'range', min: 0, max: 25, default: 12 }, { key: 'smoothness', label: 'Suavizado', type: 'range', min: 1, max: 15, default: 5 }], apply: (img, p) => G.sponge(img, p) },
  { id: 'underpainting', name: 'Pintura base…', group: 'filtro', submenu: 'Artístico', params: [{ key: 'size', label: 'Tamaño del pincel', type: 'range', min: 0, max: 40, default: 6 }, { key: 'coverage', label: 'Cobertura de la textura', type: 'range', min: 0, max: 40, default: 16 }, { key: 'kind', label: 'Textura', type: 'select', default: 'canvas', choices: [['canvas', 'Lienzo'], ['burlap', 'Arpillera'], ['brick', 'Ladrillo'], ['sandstone', 'Arenisca']] }, { key: 'scaling', label: 'Escala', type: 'range', min: 50, max: 200, default: 100, unit: '%' }, { key: 'relief', label: 'Relieve', type: 'range', min: 0, max: 20, default: 4 }], apply: (img, p) => G.underpainting(img, p) },
  { id: 'accentedEdges', name: 'Bordes acentuados…', group: 'filtro', submenu: 'Trazos de pincel', params: [{ key: 'width', label: 'Anchura del borde', type: 'range', min: 1, max: 14, default: 2 }, { key: 'brightness', label: 'Brillo del borde', type: 'range', min: 0, max: 50, default: 38 }, { key: 'smoothness', label: 'Suavizado', type: 'range', min: 1, max: 15, default: 5 }], apply: (img, p) => G.accentedEdges(img, p) },
  { id: 'angledStrokes', name: 'Trazos en ángulo…', group: 'filtro', submenu: 'Trazos de pincel', params: [{ key: 'balance', label: 'Equilibrio de dirección', type: 'range', min: 0, max: 100, default: 50 }, { key: 'length', label: 'Longitud del trazo', type: 'range', min: 3, max: 50, default: 15 }, { key: 'sharpness', label: 'Nitidez', type: 'range', min: 0, max: 10, default: 3 }], apply: (img, p) => G.angledStrokes(img, p) },
  { id: 'crosshatch', name: 'Sombreado cruzado…', group: 'filtro', submenu: 'Trazos de pincel', params: [{ key: 'length', label: 'Longitud del trazo', type: 'range', min: 3, max: 50, default: 9 }, { key: 'sharpness', label: 'Nitidez', type: 'range', min: 0, max: 20, default: 6 }, { key: 'strength', label: 'Intensidad', type: 'range', min: 1, max: 3, default: 1 }], apply: (img, p) => G.crosshatch(img, p) },
  { id: 'darkStrokes', name: 'Trazos oscuros…', group: 'filtro', submenu: 'Trazos de pincel', params: [{ key: 'balance', label: 'Equilibrio', type: 'range', min: 0, max: 10, default: 5 }, { key: 'black', label: 'Intensidad del negro', type: 'range', min: 0, max: 10, default: 6 }, { key: 'white', label: 'Intensidad del blanco', type: 'range', min: 0, max: 10, default: 2 }], apply: (img, p) => G.darkStrokes(img, p) },
  { id: 'spatter', name: 'Salpicadura…', group: 'filtro', submenu: 'Trazos de pincel', params: [{ key: 'radius', label: 'Radio de rociado', type: 'range', min: 0, max: 25, default: 10 }, { key: 'smoothness', label: 'Suavizado', type: 'range', min: 1, max: 15, default: 5 }], apply: (img, p) => G.spatter(img, p) },
  { id: 'sprayedStrokes', name: 'Trazos pulverizados…', group: 'filtro', submenu: 'Trazos de pincel', params: [{ key: 'length', label: 'Longitud del trazo', type: 'range', min: 0, max: 20, default: 12 }, { key: 'radius', label: 'Radio de rociado', type: 'range', min: 0, max: 25, default: 7 }, { key: 'dir', label: 'Dirección del trazo', type: 'select', default: 'rightDiagonal', choices: [['rightDiagonal', 'Diagonal derecha'], ['horizontal', 'Horizontal'], ['leftDiagonal', 'Diagonal izquierda'], ['vertical', 'Vertical']] }], apply: (img, p) => G.sprayedStrokes(img, p) },
  { id: 'sumiE', name: 'Sumi-e…', group: 'filtro', submenu: 'Trazos de pincel', params: [{ key: 'width', label: 'Anchura del trazo', type: 'range', min: 3, max: 15, default: 10 }, { key: 'pressure', label: 'Presión del trazo', type: 'range', min: 0, max: 15, default: 2 }, { key: 'contrast', label: 'Contraste', type: 'range', min: 0, max: 40, default: 16 }], apply: (img, p) => G.sumiE(img, p) },
  { id: 'basRelief', name: 'Bajorrelieve…', group: 'filtro', submenu: 'Bosquejar', params: [{ key: 'detail', label: 'Detalle', type: 'range', min: 1, max: 15, default: 13 }, { key: 'smoothness', label: 'Suavizado', type: 'range', min: 1, max: 15, default: 3 }, { key: 'light', label: 'Luz', type: 'select', default: 'bottom', choices: [['top', 'Arriba'], ['bottom', 'Abajo'], ['left', 'Izquierda'], ['right', 'Derecha'], ['topLeft', 'Arriba a la izquierda'], ['topRight', 'Arriba a la derecha'], ['bottomLeft', 'Abajo a la izquierda'], ['bottomRight', 'Abajo a la derecha']] }], apply: (img, p) => G.basRelief(img, p) },
  { id: 'chromeFx', name: 'Cromo…', group: 'filtro', submenu: 'Bosquejar', params: [{ key: 'detail', label: 'Detalle', type: 'range', min: 0, max: 10, default: 4 }, { key: 'smoothness', label: 'Suavizado', type: 'range', min: 0, max: 10, default: 4 }], apply: (img, p) => G.chrome(img, p) },
  { id: 'charcoalSketch', name: 'Carboncillo…', group: 'filtro', submenu: 'Bosquejar', params: [{ key: 'thickness', label: 'Grosor', type: 'range', min: 1, max: 7, default: 1 }, { key: 'detail', label: 'Detalle', type: 'range', min: 0, max: 5, default: 1 }, { key: 'balance', label: 'Equilibrio claro/oscuro', type: 'range', min: 0, max: 100, default: 50 }], apply: (img, p) => G.charcoal2(img, p) },
  { id: 'conteCrayon', name: 'Creta…', group: 'filtro', submenu: 'Bosquejar', params: [{ key: 'fg', label: 'Nivel de primer plano', type: 'range', min: 0, max: 20, default: 12 }, { key: 'bg', label: 'Nivel de fondo', type: 'range', min: 0, max: 20, default: 10 }, { key: 'kind', label: 'Textura', type: 'select', default: 'canvas', choices: [['canvas', 'Lienzo'], ['burlap', 'Arpillera'], ['brick', 'Ladrillo'], ['sandstone', 'Arenisca']] }, { key: 'scaling', label: 'Escala', type: 'range', min: 50, max: 200, default: 100, unit: '%' }, { key: 'relief', label: 'Relieve', type: 'range', min: 0, max: 20, default: 4 }], apply: (img, p) => G.conteCrayon(img, p) },
  { id: 'graphicPen', name: 'Pluma gráfica…', group: 'filtro', submenu: 'Bosquejar', params: [{ key: 'length', label: 'Longitud del trazo', type: 'range', min: 1, max: 15, default: 5 }, { key: 'balance', label: 'Equilibrio claro/oscuro', type: 'range', min: 0, max: 100, default: 50 }, { key: 'dir', label: 'Dirección del trazo', type: 'select', default: 'rightDiagonal', choices: [['rightDiagonal', 'Diagonal derecha'], ['horizontal', 'Horizontal'], ['leftDiagonal', 'Diagonal izquierda'], ['vertical', 'Vertical']] }], apply: (img, p) => G.graphicPen(img, p) },
  { id: 'halftonePattern', name: 'Trama de semitonos…', group: 'filtro', submenu: 'Bosquejar', params: [{ key: 'size', label: 'Tamaño', type: 'range', min: 1, max: 12, default: 1 }, { key: 'contrast', label: 'Contraste', type: 'range', min: 0, max: 50, default: 5 }, { key: 'kind', label: 'Tipo de trama', type: 'select', default: 'dot', choices: [['dot', 'Punto'], ['circle', 'Círculo'], ['line', 'Línea']] }], apply: (img, p) => G.halftonePattern(img, p) },
  { id: 'notePaper', name: 'Papel de notas…', group: 'filtro', submenu: 'Bosquejar', params: [{ key: 'balance', label: 'Equilibrio de la imagen', type: 'range', min: 0, max: 50, default: 25 }, { key: 'graininess', label: 'Granulado', type: 'range', min: 0, max: 10, default: 0 }, { key: 'relief', label: 'Relieve', type: 'range', min: 0, max: 50, default: 4 }], apply: (img, p) => G.notePaper(img, p) },
  { id: 'photocopy', name: 'Fotocopia…', group: 'filtro', submenu: 'Bosquejar', params: [{ key: 'detail', label: 'Detalle', type: 'range', min: 1, max: 24, default: 7 }, { key: 'darkness', label: 'Oscuridad', type: 'range', min: 1, max: 50, default: 25 }], apply: (img, p) => G.photocopy(img, p) },
  { id: 'plaster', name: 'Yeso…', group: 'filtro', submenu: 'Bosquejar', params: [{ key: 'balance', label: 'Equilibrio de la imagen', type: 'range', min: 1, max: 50, default: 20 }, { key: 'smoothness', label: 'Suavizado', type: 'range', min: 1, max: 15, default: 8 }, { key: 'light', label: 'Luz', type: 'select', default: 'top', choices: [['top', 'Arriba'], ['bottom', 'Abajo'], ['left', 'Izquierda'], ['right', 'Derecha'], ['topLeft', 'Arriba a la izquierda'], ['topRight', 'Arriba a la derecha'], ['bottomLeft', 'Abajo a la izquierda'], ['bottomRight', 'Abajo a la derecha']] }], apply: (img, p) => G.plaster(img, p) },
  { id: 'reticulation', name: 'Reticulación…', group: 'filtro', submenu: 'Bosquejar', params: [{ key: 'density', label: 'Densidad', type: 'range', min: 0, max: 50, default: 12 }, { key: 'fg', label: 'Nivel de primer plano', type: 'range', min: 0, max: 50, default: 6 }, { key: 'bg', label: 'Nivel de fondo', type: 'range', min: 0, max: 50, default: 6 }], apply: (img, p) => G.reticulation(img, p) },
  { id: 'tornEdges', name: 'Bordes rasgados…', group: 'filtro', submenu: 'Bosquejar', params: [{ key: 'balance', label: 'Equilibrio de la imagen', type: 'range', min: 0, max: 50, default: 25 }, { key: 'smoothness', label: 'Suavizado', type: 'range', min: 0, max: 15, default: 11 }, { key: 'contrast', label: 'Contraste', type: 'range', min: 0, max: 20, default: 17 }], apply: (img, p) => G.tornEdges(img, p) },
  { id: 'waterPaper', name: 'Papel húmedo…', group: 'filtro', submenu: 'Bosquejar', params: [{ key: 'fiber', label: 'Longitud de las fibras', type: 'range', min: 3, max: 50, default: 15 }, { key: 'brightness', label: 'Brillo', type: 'range', min: 0, max: 100, default: 50 }, { key: 'contrast', label: 'Contraste', type: 'range', min: 0, max: 100, default: 50 }], apply: (img, p) => G.waterPaper(img, p) },
  { id: 'diffuseGlow', name: 'Resplandor difuso…', group: 'filtro', submenu: 'Distorsionar', params: [{ key: 'graininess', label: 'Granulado', type: 'range', min: 0, max: 10, default: 6 }, { key: 'glow', label: 'Cantidad de resplandor', type: 'range', min: 0, max: 20, default: 10 }, { key: 'clear', label: 'Cantidad de limpieza', type: 'range', min: 0, max: 20, default: 15 }], apply: (img, p) => G.diffuseGlow(img, p) },
  { id: 'oceanRipple', name: 'Ondas oceánicas…', group: 'filtro', submenu: 'Distorsionar', params: [{ key: 'size', label: 'Tamaño de las ondas', type: 'range', min: 1, max: 15, default: 9 }, { key: 'magnitude', label: 'Magnitud', type: 'range', min: 0, max: 20, default: 9 }], apply: (img, p) => G.oceanRipple(img, p) },
  { id: 'grainFx', name: 'Granulado…', group: 'filtro', submenu: 'Textura', params: [{ key: 'intensity', label: 'Intensidad', type: 'range', min: 0, max: 100, default: 40 }, { key: 'contrast', label: 'Contraste', type: 'range', min: 0, max: 100, default: 50 }, { key: 'kind', label: 'Tipo de grano', type: 'select', default: 'regular', choices: [['regular', 'Normal'], ['soft', 'Suave'], ['sprinkles', 'Rociado'], ['clumped', 'Agrupado'], ['contrasty', 'Contrastado'], ['enlarged', 'Ampliado'], ['stippled', 'Punteado'], ['horizontal', 'Horizontal'], ['vertical', 'Vertical'], ['speckle', 'Moteado']] }], apply: (img, p) => G.grain(img, p) },
  { id: 'mosaicTiles', name: 'Teselas de mosaico…', group: 'filtro', submenu: 'Textura', params: [{ key: 'tile', label: 'Tamaño de las teselas', type: 'range', min: 2, max: 100, default: 12 }, { key: 'grout', label: 'Anchura de la junta', type: 'range', min: 1, max: 15, default: 3 }, { key: 'lighten', label: 'Aclarar las juntas', type: 'range', min: 0, max: 10, default: 9 }], apply: (img, p) => G.mosaicTiles(img, p) },
  { id: 'patchwork', name: 'Retazos…', group: 'filtro', submenu: 'Textura', params: [{ key: 'square', label: 'Tamaño de los cuadros', type: 'range', min: 0, max: 10, default: 4 }, { key: 'relief', label: 'Relieve', type: 'range', min: 0, max: 25, default: 8 }], apply: (img, p) => G.patchwork(img, p) },
  { id: 'ntsc', name: 'Colores NTSC', group: 'filtro', submenu: 'Vídeo', apply: (img, p) => G.ntscColors(img) },
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

/** Filtro › Otro › Personalizado: convolución con una matriz de 5 × 5. */
function customConvolve(img: ImageData, m: number[], scale: number, offset: number) {
  const sum = m.reduce((a, v) => a + (+v || 0), 0);
  const { width: w, height: h, data: d } = img, src = new Uint8ClampedArray(d), k = 1 / (scale || (sum > 0 ? sum : 1));
  const taps: [number, number, number][] = [];
  for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) { const v = +m[j * 5 + i] || 0; if (v) taps.push([i - 2, j - 2, v]); }
  if (!taps.length) return;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (const [dx, dy, v] of taps) { const xx = x + dx < 0 ? 0 : x + dx >= w ? w - 1 : x + dx, yy = y + dy < 0 ? 0 : y + dy >= h ? h - 1 : y + dy, q = (yy * w + xx) * 4; r += src[q] * v; g += src[q + 1] * v; b += src[q + 2] * v; }
    const o = (y * w + x) * 4; d[o] = r * k + offset; d[o + 1] = g * k + offset; d[o + 2] = b * k + offset;
  }
}
