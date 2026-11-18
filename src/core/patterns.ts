// Motivos (patrones que se repiten en mosaico): unos incluidos y los que defina el usuario.
// Los del usuario se guardan en el navegador para tenerlos en todas las sesiones.

import { makeCanvas, ctx2d } from './canvas';
import { setPatternSource } from '../filters/registry';

export interface Pattern { id: string; name: string; canvas: HTMLCanvasElement; }

function make(name: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): Pattern {
  const c = makeCanvas(w, h); draw(ctx2d(c)); return { id: 'base:' + name, name, canvas: c };
}
const BUILTIN: Pattern[] = [
  make('Damero', 16, 16, c => { c.fillStyle = '#fff'; c.fillRect(0, 0, 16, 16); c.fillStyle = '#bbb'; c.fillRect(0, 0, 8, 8); c.fillRect(8, 8, 8, 8); }),
  make('Rayas diagonales', 12, 12, c => { c.fillStyle = '#fff'; c.fillRect(0, 0, 12, 12); c.strokeStyle = '#333'; c.lineWidth = 3; c.beginPath(); for (const o of [-12, 0, 12]) { c.moveTo(o, 12); c.lineTo(o + 12, 0); } c.stroke(); }),
  make('Lunares', 20, 20, c => { c.fillStyle = '#fff'; c.fillRect(0, 0, 20, 20); c.fillStyle = '#e04050'; for (const [x, y] of [[5, 5], [15, 15]]) { c.beginPath(); c.arc(x, y, 3.5, 0, 7); c.fill(); } }),
  make('Cuadrícula', 24, 24, c => { c.fillStyle = '#fff'; c.fillRect(0, 0, 24, 24); c.fillStyle = '#9ab'; c.fillRect(0, 0, 24, 1); c.fillRect(0, 0, 1, 24); }),
  make('Ladrillos', 40, 20, c => { c.fillStyle = '#b5532f'; c.fillRect(0, 0, 40, 20); c.fillStyle = '#ddd'; c.fillRect(0, 9, 40, 2); c.fillRect(0, 19, 40, 1); c.fillRect(19, 0, 2, 9); c.fillRect(0, 11, 1, 8); c.fillRect(39, 11, 1, 8); }),
  make('Ruido', 64, 64, c => { const img = c.createImageData(64, 64); let s = 1; for (let i = 0; i < img.data.length; i += 4) { s = (s * 16807) % 2147483647; const v = 90 + s % 120; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; } c.putImageData(img, 0, 0); }),
  make('Lienzo', 8, 8, c => { c.fillStyle = '#e9e2d0'; c.fillRect(0, 0, 8, 8); c.fillStyle = 'rgba(120,100,70,.25)'; c.fillRect(0, 0, 8, 1); c.fillRect(0, 4, 8, 1); c.fillRect(0, 0, 1, 8); c.fillRect(4, 0, 1, 8); }),
];

const user: Pattern[] = [];
const KEY = 'editor.patterns';
(async () => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '[]') as { id: string; name: string; data: string }[];
    for (const s of saved) {
      const img = new Image(); img.src = s.data; await img.decode();
      const c = makeCanvas(img.width, img.height); ctx2d(c).drawImage(img, 0, 0);
      user.push({ id: s.id, name: s.name, canvas: c });
    }
  } catch { /* sin almacenamiento */ }
})();

export function allPatterns(): Pattern[] { return [...user, ...BUILTIN]; }
const dataCache = new Map<string, { w: number; h: number; data: Uint8ClampedArray }>();
setPatternSource(id => {
  const p = getPattern(id); if (!p) return null;
  let c = dataCache.get(id);
  if (!c) { c = { w: p.canvas.width, h: p.canvas.height, data: ctx2d(p.canvas).getImageData(0, 0, p.canvas.width, p.canvas.height).data }; dataCache.set(id, c); }
  return c;
});
export function getPattern(id: string): Pattern | undefined { return allPatterns().find(p => p.id === id); }
export function addPattern(name: string, canvas: HTMLCanvasElement): Pattern {
  const p = { id: 'user:' + Date.now().toString(36), name, canvas };
  user.unshift(p);
  try { localStorage.setItem(KEY, JSON.stringify(user.slice(0, 40).map(u => ({ id: u.id, name: u.name, data: u.canvas.toDataURL('image/png') })))); } catch { /* demasiado grande */ }
  return p;
}
/** Registra un motivo con un id fijo (p. ej. los que vienen dentro de un PSD); si ya existe, se reutiliza. */
export function addPatternWithId(id: string, name: string, canvas: HTMLCanvasElement): Pattern {
  const old = getPattern(id); if (old) return old;
  const p = { id, name, canvas };
  user.unshift(p);
  try { localStorage.setItem(KEY, JSON.stringify(user.slice(0, 40).map(u => ({ id: u.id, name: u.name, data: u.canvas.toDataURL('image/png') })))); } catch { /* demasiado grande */ }
  return p;
}
/** Lienzo del tamaño indicado rellenado con el motivo en mosaico. */
export function patternFill(p: Pattern, w: number, h: number, scale = 1): HTMLCanvasElement {
  const c = makeCanvas(w, h), x = ctx2d(c);
  const pat = x.createPattern(p.canvas, 'repeat')!;
  if (scale !== 1) pat.setTransform(new DOMMatrix().scale(scale));
  x.fillStyle = pat; x.fillRect(0, 0, w, h);
  return c;
}
