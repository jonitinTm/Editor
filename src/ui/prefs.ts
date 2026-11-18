// Preferencias del usuario (se guardan en este navegador).
import { historyConfig } from '../core/history';

export interface Prefs { theme: 'dark' | 'medium' | 'light'; historySteps: number; snapTolerance: number; autosave: boolean; uiScale: number; gridSize: number; gridColor: string; guideColor: string }
export const prefs: Prefs = { theme: 'dark', historySteps: 60, snapTolerance: 6, autosave: true, uiScale: 100, gridSize: 50, gridColor: '#787878', guideColor: '#19d3f0' };
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
