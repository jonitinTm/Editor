// Estilos de capa listos para usar (panel Estilos) y los que guarda el usuario.

import type { LayerStyles } from './layers';
import { BEVEL_DEFAULT } from './bevel';

const sh = (o: Partial<NonNullable<LayerStyles['shadow']>> = {}) => ({ enabled: true, color: '#000000', opacity: 50, angle: 120, distance: 6, blur: 10, spread: 0, ...o });
const bev = (o: Partial<typeof BEVEL_DEFAULT> = {}) => ({ ...BEVEL_DEFAULT, enabled: true, ...o });
const gr = (angle: number, ...stops: [number, string][]) => ({ enabled: true, opacity: 100, angle, stops });

export const STYLE_PRESETS: { name: string; styles: LayerStyles }[] = [
  { name: 'Sombra suave', styles: { shadow: sh({ opacity: 35, distance: 8, blur: 18 }) } },
  { name: 'Sombra dura', styles: { shadow: sh({ opacity: 80, distance: 5, blur: 0 }) } },
  { name: 'Elevado', styles: { shadow: sh({ opacity: 30, distance: 14, blur: 28, angle: 90 }) } },
  { name: 'Contorno blanco', styles: { stroke: { enabled: true, color: '#ffffff', size: 6, position: 'outside', opacity: 100 }, shadow: sh({ opacity: 40, distance: 3, blur: 6 }) } },
  { name: 'Contorno negro', styles: { stroke: { enabled: true, color: '#000000', size: 4, position: 'outside', opacity: 100 } } },
  { name: 'Pegatina', styles: { stroke: { enabled: true, color: '#ffffff', size: 10, position: 'outside', opacity: 100 }, shadow: sh({ opacity: 45, distance: 4, blur: 8, spread: 10 }) } },
  { name: 'Neón', styles: { colorOverlay: { enabled: true, color: '#e8fbff', opacity: 100 }, glow: { enabled: true, color: '#00d9ff', opacity: 100, size: 22, spread: 10 }, innerGlow: { enabled: true, color: '#00d9ff', opacity: 70, size: 6 } } },
  { name: 'Neón rosa', styles: { colorOverlay: { enabled: true, color: '#fff0fb', opacity: 100 }, glow: { enabled: true, color: '#ff2bd6', opacity: 100, size: 22, spread: 10 }, innerGlow: { enabled: true, color: '#ff2bd6', opacity: 70, size: 6 } } },
  { name: 'Oro', styles: { gradientOverlay: gr(90, [0, '#7a5310'], [0.45, '#f7e08b'], [0.55, '#e2b13c'], [1, '#8f6416']), bevel: bev({ size: 6, depth: 160, highlightOpacity: 85, shadowColor: '#4a3000', shadowOpacity: 60 }), shadow: sh({ opacity: 45, distance: 4, blur: 6 }) } },
  { name: 'Plata', styles: { gradientOverlay: gr(90, [0, '#6d7177'], [0.48, '#f4f6f8'], [0.55, '#c3c7cc'], [1, '#70747a']), bevel: bev({ size: 5, depth: 140 }), shadow: sh({ opacity: 40, distance: 4, blur: 6 }) } },
  { name: 'Relieve', styles: { bevel: bev({ style: 'emboss', size: 6, depth: 120 }) } },
  { name: 'Grabado', styles: { innerShadow: { enabled: true, color: '#000000', opacity: 70, angle: 120, distance: 3, blur: 4 }, bevel: bev({ style: 'emboss', up: false, size: 3, depth: 80, highlightOpacity: 50 }) } },
  { name: 'Botón brillante', styles: { gradientOverlay: gr(90, [0, '#1f6fd6'], [1, '#69b3ff']), bevel: bev({ style: 'inner', size: 10, soften: 4, depth: 90, altitude: 50 }), stroke: { enabled: true, color: '#0d3f80', size: 1, position: 'inside', opacity: 100 }, shadow: sh({ opacity: 40, distance: 3, blur: 5 }) } },
  { name: 'Cristal', styles: { colorOverlay: { enabled: true, color: '#bfe6ff', opacity: 35 }, bevel: bev({ style: 'inner', size: 14, soften: 6, depth: 200, altitude: 60, highlightOpacity: 90, shadowOpacity: 30 }), innerGlow: { enabled: true, color: '#ffffff', opacity: 60, size: 10 } } },
  { name: 'Fuego', styles: { gradientOverlay: gr(90, [0, '#ffe46b'], [0.5, '#ff8a00'], [1, '#c01400']), glow: { enabled: true, color: '#ff5a00', opacity: 85, size: 18, spread: 0 }, innerGlow: { enabled: true, color: '#fff2a8', opacity: 60, size: 6 } } },
  { name: 'Hielo', styles: { gradientOverlay: gr(90, [0, '#ffffff'], [1, '#7ccfff']), innerGlow: { enabled: true, color: '#3aa8ff', opacity: 60, size: 8 }, stroke: { enabled: true, color: '#1f7fd1', size: 2, position: 'outside', opacity: 90 } } },
  { name: 'Retro 3D', styles: { stroke: { enabled: true, color: '#1b1b3a', size: 3, position: 'outside', opacity: 100 }, shadow: sh({ color: '#ff3c7f', opacity: 100, distance: 8, blur: 0, angle: 135 }) } },
  { name: 'Satinado', styles: { satin: { enabled: true, color: '#000000', opacity: 45, angle: 19, distance: 11, size: 14, invert: true }, shadow: sh({ opacity: 30 }) } },
  { name: 'Arcoíris', styles: { gradientOverlay: gr(0, [0, '#ff004c'], [0.2, '#ff9900'], [0.4, '#ffee00'], [0.6, '#33dd55'], [0.8, '#2288ff'], [1, '#9933ff']) } },
  { name: 'Sombra larga', styles: { shadow: { ...sh({ opacity: 28, distance: 90, blur: 0, spread: 0, angle: 135 }), long: true } } },
];

const KEY = 'editor.userStyles';
export function userStyles(): { name: string; styles: LayerStyles }[] { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
export function saveUserStyles(list: { name: string; styles: LayerStyles }[]) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* sin almacenamiento */ } }
