// Panel «Pinceles»: ajustes de pincel guardados (predefinidos y del usuario) con vista previa del trazo.

import { app } from './app';
import { h } from './dom';
import { brushTip } from '../tools/paint';
import { promptDialog } from './dialog';

export interface BrushPreset { name: string; size: number; hardness: number; opacity: number; flow: number; spacing: number; angle: number; roundness: number; scatter: number; smoothing: number; pressure: boolean; user?: boolean }

const P = (name: string, o: Partial<BrushPreset>): BrushPreset => ({ name, size: 20, hardness: 80, opacity: 100, flow: 100, spacing: 12, angle: 0, roundness: 100, scatter: 0, smoothing: 10, pressure: true, ...o });
export const BUILTIN_BRUSHES: BrushPreset[] = [
  P('Redondo duro', { size: 12, hardness: 100 }),
  P('Redondo suave', { size: 40, hardness: 0 }),
  P('Aerógrafo suave', { size: 80, hardness: 0, flow: 12, spacing: 6 }),
  P('Entintado', { size: 6, hardness: 95, smoothing: 45 }),
  P('Lápiz técnico', { size: 3, hardness: 100, smoothing: 30, pressure: false }),
  P('Caligráfico', { size: 22, hardness: 90, roundness: 25, angle: 45, smoothing: 30 }),
  P('Marcador', { size: 26, hardness: 70, opacity: 60, roundness: 60, angle: -30 }),
  P('Tiza', { size: 14, hardness: 60, flow: 60, scatter: 60, spacing: 30 }),
  P('Salpicado', { size: 10, hardness: 90, scatter: 300, spacing: 60 }),
  P('Difuminado grande', { size: 200, hardness: 0, opacity: 40, flow: 30 }),
];

const KEY = 'editor.brushes';
let user: BrushPreset[] = [];
try { user = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { /* sin almacenamiento */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(user)); } catch { /* lleno */ } };
export const allBrushes = () => [...user.map(b => ({ ...b, user: true })), ...BUILTIN_BRUSHES];

const FIELDS = ['size', 'hardness', 'opacity', 'flow', 'spacing', 'angle', 'roundness', 'scatter', 'smoothing', 'pressure'] as const;

/** Aplica un ajuste al pincel (y lo activa). */
export function applyBrush(b: BrushPreset) {
  const tool = ['brush', 'eraser'].includes(app.tool?.id) ? app.tool.id : 'brush';
  for (const f of FIELDS) app.setOpt(tool, f, b[f]);
  if (app.tool?.id !== tool) app.setTool(tool); else app.emit('tool');
  current = b.name;
  app.emit('brushes');
}
let current = '';

/** Dibuja el trazo de muestra de un ajuste. */
function preview(b: BrushPreset, color: string, w = 150, hh = 34) {
  const c = h('canvas', { width: w * 2, height: hh * 2, class: 'brush-prev' }) as HTMLCanvasElement;
  c.style.width = w + 'px'; c.style.height = hh + 'px';
  const ctx = c.getContext('2d')!; ctx.scale(2, 2);
  const maxSize = hh * 0.7, size = Math.max(1.5, Math.min(maxSize, b.size));
  const tip = brushTip(size * 2, b.hardness / 100, color, false, b.roundness / 100, b.angle);
  const step = Math.max(0.5, size * b.spacing / 100);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  ctx.globalAlpha = b.flow / 100 * (b.opacity / 100);
  for (let x = 8; x < w - 8; x += step) {
    const t = (x - 8) / (w - 16), y = hh / 2 + Math.sin(t * Math.PI * 2) * (hh / 2 - size / 2 - 2) * 0.8;
    const pr = b.pressure ? 0.35 + 0.65 * Math.sin(t * Math.PI) : 1;
    const sc = b.scatter / 100 * size;
    const s = size * pr, ox = sc ? (rnd() - 0.5) * sc : 0, oy = sc ? (rnd() - 0.5) * sc : 0;
    ctx.drawImage(tip, x + ox - s / 2, y + oy - s / 2, s, s);
  }
  return c;
}

export function buildBrushesPanel(parent: HTMLElement) {
  const list = h('div', { class: 'brush-list' });
  const render = () => {
    list.innerHTML = '';
    const color = getComputedStyle(document.body).getPropertyValue('--text').trim() || '#ddd';
    for (const b of allBrushes()) {
      const row = h('div', { class: 'brush-item' + (b.name === current ? ' on' : ''), title: `${b.name} — ${b.size} px` },
        preview(b, color), h('div', { class: 'brush-meta' }, h('span', { class: 'brush-name' }, b.name), h('span', { class: 'brush-size' }, String(b.size))));
      row.onclick = () => applyBrush(b);
      if (b.user) {
        const del = h('button', { class: 'brush-del', title: 'Eliminar este ajuste', html: '×' });
        del.onclick = ev => { ev.stopPropagation(); user = user.filter(u => u.name !== b.name); save(); render(); };
        row.append(del);
      }
      list.append(row);
    }
  };
  const add = h('button', { class: 'btn', title: 'Guarda los ajustes actuales del pincel' }, '+ Nuevo ajuste de pincel');
  add.onclick = async () => {
    const tool = ['brush', 'eraser'].includes(app.tool?.id) ? app.tool.id : 'brush';
    const name = await promptDialog('Nuevo ajuste de pincel', 'Nombre', `Pincel ${user.length + 1}`); if (!name) return;
    const b: any = { name }; for (const f of FIELDS) b[f] = app.opt(f, tool);
    user = [b, ...user.filter(u => u.name !== name)]; save(); current = name; render();
    app.toast('Ajuste de pincel guardado');
  };
  parent.append(h('div', { class: 'brush-panel' }, h('div', { class: 'brush-foot' }, add), list));
  render();
  app.on('brushes', render);
  // si se cambia el tema, la vista previa se repinta con el nuevo color de texto
  new MutationObserver(render).observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
}
