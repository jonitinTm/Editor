// Preferencias del usuario (se guardan en este navegador).
import { historyConfig } from '../core/history';

export interface Prefs { theme: 'dark' | 'medium' | 'light'; historySteps: number; snapTolerance: number; autosave: boolean; uiScale: number; gridSize: number; gridColor: string; guideColor: string; units: Unit;
  /** Lápiz: curva de presión (-100 firme … 100 suave), presión mínima (%), solo el lápiz dibuja, el pellizco gira la vista, barras laterales. */
  penCurve: number; penMin: number; penOnly: 'auto' | 'on' | 'off'; pinchRotate: boolean; sideSliders: 'auto' | 'on' | 'off'; touchGestures: boolean; lowLatency: boolean;
  /** Ajustes, looks y efectos: en capas nuevas (editables) o sobre la capa elegida (por defecto, la decisión es del usuario). */
  autoLayers: boolean }
export type Unit = 'px' | 'cm' | 'mm' | 'in' | 'pt' | '%';
export const UNIT_NAMES: [Unit, string][] = [['px', 'Píxeles'], ['cm', 'Centímetros'], ['mm', 'Milímetros'], ['in', 'Pulgadas'], ['pt', 'Puntos'], ['%', 'Porcentaje']];
/** Píxeles por unidad (con la resolución del documento; el porcentaje depende del tamaño). */
export function pxPerUnit(u: Unit, ppi: number, size: number): number { return u === 'cm' ? ppi / 2.54 : u === 'mm' ? ppi / 25.4 : u === 'in' ? ppi : u === 'pt' ? ppi / 72 : u === '%' ? size / 100 : 1; }
/** Un valor en píxeles escrito en la unidad elegida. */
export function fmtUnit(px: number, ppi: number, size: number, u: Unit = prefs.units): string { if (u === 'px') return String(Math.round(px)); const v = px / pxPerUnit(u, ppi, size); return (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)).replace('.', ',') + ' ' + u; }
export const prefs: Prefs = { theme: 'dark', historySteps: 60, snapTolerance: 6, autosave: true, uiScale: 100, gridSize: 50, gridColor: '#787878', guideColor: '#19d3f0', units: 'px', penCurve: 0, penMin: 0, penOnly: 'auto', pinchRotate: true, sideSliders: 'auto', touchGestures: true, autoLayers: false, lowLatency: false };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('editor.prefs') || '{}')); } catch { /* sin almacenamiento */ }

export function applyPrefs() {
  document.body.dataset.theme = prefs.theme;
  historyConfig.limit = prefs.historySteps;
  document.documentElement.style.fontSize = prefs.uiScale === 100 ? '' : `${prefs.uiScale}%`;
}
export function savePrefs() {
  try { localStorage.setItem('editor.prefs', JSON.stringify(prefs)); } catch { /* sin almacenamiento */ }
  applyPrefs();
}

/** Presión del lápiz con la curva y el mínimo elegidos. */
export function penPressure(p: number): number {
  const g = Math.pow(2, -prefs.penCurve / 50), m = prefs.penMin / 100;
  return m + (1 - m) * Math.pow(Math.max(0, Math.min(1, p)), g);
}
