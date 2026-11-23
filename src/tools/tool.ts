// Interfaz común de todas las herramientas.

import type { Viewport } from '../ui/viewport';

export interface ToolEvent {
  /** Coordenadas en píxeles del documento (con decimales). */
  x: number; y: number;
  /** Coordenadas en pantalla (px CSS relativos al visor). */
  sx: number; sy: number;
  shift: boolean; alt: boolean; ctrl: boolean;
  pressure: number;
  /** Inclinación del lápiz: 0 = vertical, 1 = tumbado. */
  tilt?: number;
  /** Hacia dónde apunta el lápiz (radianes, en coordenadas del documento). */
  azimuth?: number;
  pointerType: string;
  button: number;
  detail: number;
}

export type OptionDef =
  | { key: string; label?: string; type: 'range'; min: number; max: number; step?: number; default: number; unit?: string }
  | { key: string; label?: string; type: 'select'; choices: { value: string; label: string }[]; default: string }
  | { key: string; label: string; type: 'checkbox'; default: boolean }
  | { key: string; label?: string; type: 'selmode'; default: string }
  | { key: string; label: string; type: 'number'; min?: number; max?: number; default: number; unit?: string; title?: string }
  | { key: string; label?: string; type: 'font'; default: string }
  | { key: string; label?: string; type: 'color'; default: string };

export interface Tool {
  id: string;
  name: string;
  icon: string;
  /** Tecla de acceso rápido (una letra). */
  key?: string;
  /** Grupo en la barra de herramientas (herramientas que comparten botón). */
  group?: string;
  cursor?: string;
  options?: OptionDef[];
  /** Controles adicionales para la barra de opciones. */
  extraOptions?(bar: HTMLElement): void;
  /** Los controles adicionales van al principio de la barra (p. ej. la punta del pincel). */
  extraFirst?: boolean;
  activate?(): void;
  deactivate?(): void;
  down?(e: ToolEvent): void;
  move?(e: ToolEvent): void;
  up?(e: ToolEvent): void;
  hover?(e: ToolEvent): void;
  /** Cancela la operación en curso (Esc o gesto táctil). */
  cancel?(): void;
  /** Devuelve true si ha consumido la tecla. */
  key_?(e: KeyboardEvent): boolean;
  drawOverlay?(ctx: CanvasRenderingContext2D, vp: Viewport): void;
  /** El documento activo ha cambiado (deshacer, otra pestaña…). */
  docChanged?(): void;
}
