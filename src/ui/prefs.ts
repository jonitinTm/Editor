// Preferencias del usuario (se guardan en este navegador).
import { historyConfig } from '../core/history';

export interface Prefs { theme: 'dark' | 'medium' | 'light'; historySteps: number; snapTolerance: number; autosave: boolean; uiScale: number; gridSize: number; gridColor: string; guideColor: string; units: Unit }
export type Unit = 'px' | 'cm' | 'mm' | 'in' | 'pt' | '%';
export const UNIT_NAMES: [Unit, string][] = [['px', 'Píxeles'], ['cm', 'Centímetros'], ['mm', 'Milímetros'], ['in', 'Pulgadas'], ['pt', 'Puntos'], ['%', 'Porcentaje']];
/** Píxeles por unidad (con la resolución del documento; el porcentaje depende del tamaño). */
export function pxPerUnit(u: Unit, ppi: number, size: number): number { return u === 'cm' ? ppi / 2.54 : u === 'mm' ? ppi / 25.4 : u === 'in' ? ppi : u === 'pt' ? ppi / 72 : u === '%' ? size / 100 : 1; }
/** Un valor en píxeles escrito en la unidad elegida. */
export function fmtUnit(px: number, ppi: number, size: number, u: Unit = prefs.units): string { if (u === 'px') return String(Math.round(px)); const v = px / pxPerUnit(u, ppi, size); return (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)).replace('.', ',') + ' ' + u; }
export const prefs: Prefs = { theme: 'dark', historySteps: 60, snapTolerance: 6, autosave: true, uiScale: 100, gridSize: 50, gridColor: '#787878', guideColor: '#19d3f0', units: 'px' };
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
