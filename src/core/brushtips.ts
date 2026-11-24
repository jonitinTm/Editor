// Puntas de pincel con imagen (pinceles «muestreados»): unas de serie, generadas aquí, y las que
// crea el usuario con Edición › Definir pincel. Cada punta es una máscara: lo opaco pinta.

import { makeCanvas, ctx2d } from './canvas';

export interface BrushTip { id: string; name: string; canvas: HTMLCanvasElement; user?: boolean }

function seeded(seed: number) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
function gen(name: string, size: number, draw: (c: CanvasRenderingContext2D, s: number, rnd: () => number) => void, seed = 7): BrushTip {
  // la imagen se genera la primera vez que se usa (antes, todas al arrancar la app)
  let c: HTMLCanvasElement | null = null;
  return { id: 'base:' + name, name, get canvas() { if (!c) { c = makeCanvas(size, size); const x = ctx2d(c); x.fillStyle = '#fff'; x.strokeStyle = '#fff'; draw(x, size, seeded(seed)); } return c; }, set canvas(v) { c = v; } };
}
const BUILTIN: BrushTip[] = [
  gen('Tiza', 128, (c, s, r) => { for (let i = 0; i < 2600; i++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * s * 0.46; c.globalAlpha = 0.25 + r() * 0.6; c.fillRect(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, 1 + r() * 2.5, 1 + r() * 2.5); } }),
  gen('Esponja', 128, (c, s, r) => { for (let i = 0; i < 220; i++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * s * 0.42; c.globalAlpha = 0.3 + r() * 0.5; c.beginPath(); c.arc(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, 1.5 + r() * 6, 0, 7); c.fill(); } }, 11),
  gen('Salpicadura', 128, (c, s, r) => { c.beginPath(); c.arc(s / 2, s / 2, s * 0.16, 0, 7); c.fill(); for (let i = 0; i < 46; i++) { const a = r() * Math.PI * 2, d = s * (0.18 + r() * 0.3); c.beginPath(); c.arc(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, 1 + r() * 4.5 * (1 - d / s), 0, 7); c.fill(); } }, 23),
  gen('Pincel seco', 128, (c, s, r) => { for (let i = 0; i < 40; i++) { const y = s * 0.18 + r() * s * 0.64; c.globalAlpha = 0.35 + r() * 0.65; c.lineWidth = 0.6 + r() * 2.2; c.beginPath(); c.moveTo(s * 0.1 + r() * s * 0.1, y); c.lineTo(s * 0.8 + r() * s * 0.1, y + (r() - 0.5) * 3); c.stroke(); } }, 5),
  gen('Hierba', 128, (c, s, r) => { for (let i = 0; i < 9; i++) { const x = s * (0.3 + r() * 0.4), lean = (r() - 0.5) * s * 0.35, w = 2 + r() * 4; c.beginPath(); c.moveTo(x - w, s * 0.95); c.quadraticCurveTo(x + lean * 0.3, s * 0.5, x + lean, s * (0.05 + r() * 0.25)); c.quadraticCurveTo(x + lean * 0.3 + w, s * 0.5, x + w, s * 0.95); c.fill(); } }, 3),
  gen('Estrella', 128, (c, s) => { c.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? s * 0.2 : s * 0.47; c.lineTo(s / 2 + Math.cos(a) * rr, s / 2 + Math.sin(a) * rr); } c.closePath(); c.fill(); }),
  gen('Hoja', 128, (c, s) => { c.beginPath(); c.moveTo(s / 2, s * 0.04); c.quadraticCurveTo(s * 0.95, s * 0.45, s / 2, s * 0.96); c.quadraticCurveTo(s * 0.05, s * 0.45, s / 2, s * 0.04); c.fill(); c.globalCompositeOperation = 'destination-out'; c.lineWidth = 2; c.beginPath(); c.moveTo(s / 2, s * 0.1); c.lineTo(s / 2, s * 0.9); c.stroke(); }),
  gen('Nube', 128, (c, s, r) => { const g = (x: number, y: number, rad: number) => { const gr = c.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, s, s); }; for (let i = 0; i < 14; i++) g(s / 2 + (r() - 0.5) * s * 0.5, s / 2 + (r() - 0.5) * s * 0.35, s * (0.12 + r() * 0.2)); }, 17),
];

const KEY = 'editor.brushTips';
let user: BrushTip[] = [];
let loaded = false;
/** Carga (una vez) las puntas guardadas en el navegador. */
export async function loadUserTips() {
  if (loaded) return; loaded = true;
  let list: { id: string; name: string; data: string }[] = [];
  try { list = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { /* sin almacenamiento */ }
  for (const t of list) {
    try {
      const img = new Image(); img.src = t.data; await img.decode();
      const c = makeCanvas(img.width, img.height); ctx2d(c).drawImage(img, 0, 0);
      user.push({ id: t.id, name: t.name, canvas: c, user: true });
    } catch { /* imagen dañada */ }
  }
}
function saveUser() {
  try { localStorage.setItem(KEY, JSON.stringify(user.map(t => ({ id: t.id, name: t.name, data: t.canvas.toDataURL('image/png') })))); } catch { /* lleno */ }
}
export const allTips = () => [...user, ...BUILTIN];
export const getTip = (id: string) => allTips().find(t => t.id === id) ?? null;
export function addUserTip(name: string, canvas: HTMLCanvasElement): BrushTip {
  const t = { id: 'user:' + Date.now().toString(36), name, canvas, user: true };
  user.unshift(t); saveUser(); return t;
}
export function removeUserTip(id: string) { user = user.filter(t => t.id !== id); saveUser(); }

const cache = new Map<string, HTMLCanvasElement>();
/** Punta coloreada, al tamaño (lado mayor) y ángulo pedidos. */
export function sampledTip(id: string, size: number, color: string, angle = 0, roundness = 1): HTMLCanvasElement | null {
  const t = getTip(id); if (!t) return null;
  const s = Math.max(1, size <= 16 ? Math.round(size) : Math.round(Math.exp(Math.round(Math.log(size) / Math.log(1.03)) * Math.log(1.03)))), key = `${id}|${s}|${color}|${Math.round(angle)}|${roundness.toFixed(2)}`;
  let c = cache.get(key); if (c) return c;
  if (cache.size > 300) { const k0 = cache.keys().next().value; if (k0 !== undefined) cache.delete(k0); }
  const k = s / Math.max(t.canvas.width, t.canvas.height), w = t.canvas.width * k, hh = t.canvas.height * k * roundness;
  const d = Math.ceil(Math.hypot(w, hh)) + 2;
  c = makeCanvas(d, d); const x = ctx2d(c);
  x.translate(d / 2, d / 2); x.rotate(-angle * Math.PI / 180);
  x.imageSmoothingQuality = 'high'; x.drawImage(t.canvas, -w / 2, -hh / 2, w, hh);
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, d, d);
  cache.set(key, c); return c;
}
