// Pixel art fácil: lienzo pequeño listo para dibujar, paletas de colores, barra de colores sobre el lienzo y
// exportación ampliada sin que se vea borroso (cada píxel se convierte en un cuadrado nítido).
import { app } from './app';
import { h } from './dom';
import { showDialog } from './dialog';
import { icon } from './icons';
import * as more from './more';
import { renderFrames } from './timeline';
import { isAnim, isPlaying, startAnim, stopAnim, animRow, onAnimChange } from './anim';
import { RasterLayer } from '../core/layers';
import { ctx2d, makeCanvas } from '../core/canvas';
import { EditorDocument } from '../core/document';

/** Paletas propias (colores elegidos para que combinen entre sí). */
export const PALETTES: { id: string; name: string; colors: string[] }[] = [
  { id: 'basic16', name: 'Básica (16 colores)', colors: ['#000000', '#3b3b4f', '#7a7a8c', '#c9c9d6', '#ffffff', '#6b2e2e', '#c33c3c', '#f08a4b', '#f5d24a', '#7cc947', '#2f8f4e', '#2a5c8f', '#4aa3f0', '#8a5cd6', '#e07cc0', '#8a5a3c'] },
  { id: 'retro', name: 'Retro (cálida)', colors: ['#1a1423', '#3d2b3d', '#6b3e4f', '#a3485a', '#e0705c', '#f2a65e', '#f7d488', '#fff3d6', '#5b8c5a', '#2f5d50', '#3f7cac', '#95c3d8'] },
  { id: 'pastel', name: 'Pastel', colors: ['#4a4458', '#8e86a3', '#ffffff', '#ffd1dc', '#ffb3ba', '#ffdfba', '#fff5ba', '#baffc9', '#bae1ff', '#d5baff', '#f0c6ff', '#c9f2e8'] },
  { id: 'green4', name: 'Consola verde (4 tonos)', colors: ['#0f2a1a', '#2f5f35', '#7fae5a', '#d6eba0'] },
  { id: 'night', name: 'Noche y neón', colors: ['#0b0b1a', '#1d1b3a', '#33306b', '#5a4fcf', '#9b6dff', '#ff4fa3', '#ff9e5e', '#ffe66d', '#3ff2c8', '#2bb0ed', '#e8e8ff', '#7d7a99'] },
  { id: 'skin', name: 'Personajes (pieles y pelo)', colors: ['#2b1a12', '#5a3825', '#8d5a3b', '#c68863', '#e8b08c', '#f6d5bd', '#fff1e6', '#3b2b20', '#a0522d', '#d9a441', '#f2e2a0', '#1f2a44', '#c0392b', '#3a7bd5'] },
  { id: 'gray8', name: 'Grises (8)', colors: ['#000000', '#242424', '#494949', '#6d6d6d', '#929292', '#b6b6b6', '#dbdbdb', '#ffffff'] },
];
const MINE = 'editor.pixelMine', CUR = 'editor.pixelPalette';
const mine = (): string[] => { try { const v = JSON.parse(localStorage.getItem(MINE) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 64) : []; } catch { return []; } };
const saveMine = (l: string[]) => { try { localStorage.setItem(MINE, JSON.stringify(l.slice(0, 64))); } catch { /* sin almacenamiento */ } };
export function currentPalette(): { id: string; name: string; colors: string[] } {
  let id = 'basic16'; try { id = localStorage.getItem(CUR) || id; } catch { /* */ }
  if (id === 'mine') return { id, name: 'Mis colores', colors: mine() };
  return PALETTES.find(p => p.id === id) ?? PALETTES[0];
}
function setPalette(id: string) { try { localStorage.setItem(CUR, id); } catch { /* */ } renderBar(); }

/** Archivo › Nuevo pixel art: tamaño pequeño, paleta y fondo; deja elegido el pincel de píxeles con el zoom adecuado. */
export function newPixelArtDialog() {
  const SIZES = [16, 24, 32, 48, 64, 128];
  let w = 32, hh = 32;
  const wIn = h('input', { type: 'number', min: 1, max: 1024, value: '32', class: 'num' }) as HTMLInputElement;
  const hIn = h('input', { type: 'number', min: 1, max: 1024, value: '32', class: 'num' }) as HTMLInputElement;
  const sizeBtns = h('div', { class: 'px-sizes' });
  const mark = () => sizeBtns.querySelectorAll<HTMLElement>('button').forEach(b => b.classList.toggle('on', +b.dataset.s! === w && w === hh));
  for (const s of SIZES) {
    const b = h('button', { type: 'button', class: 'btn', 'data-s': String(s) }, `${s} × ${s}`);
    b.onclick = () => { w = hh = s; wIn.value = hIn.value = String(s); mark(); };
    sizeBtns.append(b);
  }
  wIn.oninput = () => { w = Math.max(1, Math.min(1024, Math.round(+wIn.value || 1))); mark(); };
  hIn.oninput = () => { hh = Math.max(1, Math.min(1024, Math.round(+hIn.value || 1))); mark(); };
  mark();
  const pal = h('select', {}, ...PALETTES.map(p => h('option', { value: p.id }, p.name)), h('option', { value: 'mine' }, 'Mis colores'));
  pal.value = currentPalette().id;
  const bg = h('select', {}, h('option', { value: 'none' }, 'Transparente'), h('option', { value: '#ffffff' }, 'Blanco'), h('option', { value: '#000000' }, 'Negro'));
  const row = (label: string, ...els: (HTMLElement | string)[]) => h('div', { class: 'form-row' }, h('label', {}, label), ...els);
  showDialog({
    title: 'Nuevo pixel art', okLabel: 'Crear', width: 440,
    body: [
      h('div', { class: 'hint' }, 'Un lienzo pequeño en el que cada píxel se ve como un cuadrado. Al exportar se amplía sin que se vea borroso.'),
      row('Tamaño', sizeBtns),
      row('Ancho × alto', wIn, ' × ', hIn, ' px'),
      row('Paleta', pal),
      row('Fondo', bg),
    ],
    onOk: () => {
      setPalette(pal.value);
      // con fondo de color, se dibuja en una capa transparente encima del fondo (así, al animar, el fondo es común
      // a todos los fotogramas y el papel cebolla solo muestra el dibujo)
      const d = new EditorDocument(`Pixel art ${w}×${hh}`, w, hh);
      if (bg.value !== 'none') { const f = new RasterLayer('Fondo', w, hh), x = ctx2d(f.canvas); x.fillStyle = bg.value; x.fillRect(0, 0, w, hh); d.root.add(f); }
      const l = new RasterLayer(bg.value !== 'none' ? 'Capa 1' : 'Capa 1', w, hh); d.root.add(l); d.setActive(l, false);
      d.meta.pixelArt = true;
      app.addDocument(d, 'Nuevo');
      const p = currentPalette(); if (p.colors.length) app.setColors(p.colors[0], p.colors[p.colors.length - 1] ?? '#ffffff');
      app.setTool('pixel');
      if (!more.viewOpts.pixelGrid) more.togglePixelGrid();
      requestAnimationFrame(() => { app.viewport.fit(); renderBar(); });
    },
  });
}

/** Marca o desmarca el documento como pixel art (barra de paleta y exportación nítida). */
export function togglePixelMode() {
  const d = app.doc; if (!d) return;
  d.meta.pixelArt = !d.meta.pixelArt; d.modified = true;
  if (d.meta.pixelArt) { app.setTool('pixel'); if (!more.viewOpts.pixelGrid) more.togglePixelGrid(); }
  app.toast(d.meta.pixelArt ? 'Modo pixel art: paleta abajo y exportación sin suavizar' : 'Modo pixel art desactivado');
  app.emit('docs'); renderBar();
}

/** Archivo › Exportar pixel art ampliado: cada píxel se convierte en un cuadrado de N × N, nítido. */
export function exportPixelDialog() {
  const d = app.doc; if (!d) return;
  let k = Math.max(1, Math.min(32, Math.round(512 / Math.max(d.width, d.height)))) || 1;
  const info = h('div', { class: 'hint' });
  const btns = h('div', { class: 'px-sizes' });
  const upd = () => { info.textContent = `${d.width * k} × ${d.height * k} px`; btns.querySelectorAll<HTMLElement>('button').forEach(b => b.classList.toggle('on', +b.dataset.k! === k)); };
  for (const n of [1, 2, 4, 8, 10, 16, 20, 32]) { const b = h('button', { type: 'button', class: 'btn', 'data-k': String(n) }, `×${n}`); b.onclick = () => { k = n; upd(); }; btns.append(b); }
  upd();
  // con animación: GIF animado o tira de sprites (todos los fotogramas en fila), además de la imagen actual
  const multi = d.frames.length > 1;
  const fmt = h('select', {}, ...(multi ? [h('option', { value: 'gif' }, 'GIF animado'), h('option', { value: 'sheet' }, 'Tira de sprites (PNG, fotogramas en fila)')] : []), h('option', { value: 'png' }, multi ? 'PNG (solo el fotograma actual)' : 'PNG'));
  const nearest = (c: HTMLCanvasElement) => { if (k === 1) return c; const n = makeCanvas(c.width * k, c.height * k), x = ctx2d(n); x.imageSmoothingEnabled = false; x.drawImage(c, 0, 0, n.width, n.height); return n; };
  showDialog({
    title: 'Exportar pixel art ampliado', okLabel: 'Exportar', width: 440,
    body: [h('div', { class: 'hint' }, 'Cada píxel se convierte en un cuadrado nítido, sin bordes borrosos. Ideal para compartir o imprimir.'),
      h('div', { class: 'form-row' }, h('label', {}, 'Formato'), fmt), h('div', { class: 'form-row' }, h('label', {}, 'Ampliar'), btns), info],
    onOk: async () => {
      const io = await import('../io/files');
      const base = `${d.name}${k > 1 ? `-x${k}` : ''}`;
      let blob: Blob, name: string;
      if (fmt.value === 'gif') {
        stopAnim();
        const { encodeGif } = await import('../io/gif');
        blob = encodeGif(renderFrames(d).map(f => ({ canvas: nearest(f.canvas), delay: f.delay }))); name = base + '.gif';
      } else if (fmt.value === 'sheet') {
        stopAnim();
        const fr = renderFrames(d), sheet = makeCanvas(d.width * fr.length, d.height), x = ctx2d(sheet);
        fr.forEach((f, i) => x.drawImage(f.canvas, i * d.width, 0));
        blob = await io.exportImage(d, 'image/png', 1, k, sheet, true); name = base + '-sprites.png';
      } else { blob = await io.exportImage(d, 'image/png', 1, k, undefined, true); name = base + '.png'; }
      try { await io.saveBlob(blob, name); app.toast('Exportado'); }
      catch (e: any) { if (e?.name !== 'AbortError') app.toast('No se pudo exportar: ' + (e?.message ?? e), 'warn'); } // cancelar no es un error
    },
  });
}

// ---- Barra de colores sobre el lienzo --------------------------------------------------------
let bar: HTMLElement | null = null;
const wanted = () => !!app.doc && (app.doc.meta.pixelArt || app.tool?.id === 'pixel');
export function renderBar() {
  if (!wanted()) { bar?.remove(); bar = null; return; }
  if (isPlaying() && bar?.querySelector('.px-anim') && app.doc && bar.querySelectorAll('.px-frame').length === app.doc.frames.length) {
    const i = app.doc.frameIndex; bar.querySelectorAll('.px-frame').forEach((c, j) => c.classList.toggle('on', j === i)); return;
  }
  const host = app.viewport.canvas.parentElement; if (!host) return;
  if (!bar || bar.parentElement !== host) { bar?.remove(); bar = h('div', { class: 'px-bar', role: 'toolbar', 'aria-label': 'Paleta de pixel art' }); host.append(bar); }
  const p = currentPalette();
  const sel = h('select', { class: 'px-pal', title: 'Paleta', 'aria-label': 'Paleta' }, ...PALETTES.map(x => h('option', { value: x.id }, x.name)), h('option', { value: 'mine' }, 'Mis colores'));
  sel.value = p.id; sel.onchange = () => setPalette(sel.value);
  const sw = h('div', { class: 'px-swatches' });
  for (const c of p.colors) {
    const b = h('button', { type: 'button', class: 'px-sw' + (c.toLowerCase() === app.fg.toLowerCase() ? ' on' : ''), title: c, 'aria-label': c, style: { background: c } });
    b.onclick = () => app.setColors(c);
    b.oncontextmenu = e => { e.preventDefault(); app.setColors(app.fg, c); };
    sw.append(b);
  }
  if (p.id === 'mine' && !p.colors.length) sw.append(h('span', { class: 'hint' }, 'Pulsa ＋ para guardar aquí el color actual'));
  const add = h('button', { type: 'button', class: 'btn icon-btn px-add', title: 'Guardar el color actual en «Mis colores»', 'aria-label': 'Guardar el color actual en «Mis colores»' }, '＋');
  add.onclick = () => { const l = mine(); if (!l.includes(app.fg)) { l.push(app.fg); saveMine(l); } setPalette('mine'); app.toast('Color guardado en «Mis colores»'); };
  const exp = h('button', { type: 'button', class: 'btn icon-btn px-exp', title: 'Exportar pixel art ampliado', 'aria-label': 'Exportar pixel art ampliado', html: icon('download') });
  exp.onclick = () => exportPixelDialog();
  const d = app.doc!;
  const animBtn = isAnim(d) ? null : h('button', { type: 'button', class: 'btn icon-btn px-animate', title: 'Animar: convierte el dibujo en fotogramas', 'aria-label': 'Animar: convierte el dibujo en fotogramas', html: icon('film') });
  if (animBtn) animBtn.onclick = () => startAnim();
  bar.replaceChildren(...(isAnim(d) ? [animRow(d)] : []), h('div', { class: 'px-row' }, sel, sw, add, animBtn, exp));
  // el botón rápido flotante no debe tapar la barra: si coincide con ella, sube justo por encima
  requestAnimationFrame(() => {
    const qb = document.querySelector<HTMLElement>('.quick-btn.show'); if (!qb || !bar) return;
    const q = qb.getBoundingClientRect(), r = bar.getBoundingClientRect();
    if (q.right > r.left && q.left < r.right && q.bottom > r.top && q.top < r.bottom) qb.style.top = Math.max(4, qb.offsetTop - (q.bottom - r.top) - 8) + 'px';
  });
}
export function initPixelBar() {
  for (const ev of ['tool', 'docs', 'doc', 'colors'] as const) app.on(ev, () => renderBar());
  onAnimChange(renderBar);
  renderBar();
}

// ---- importar y exportar paletas ---------------------------------------------------------------
/** Lee una paleta en formato GIMP/Aseprite (.gpl), JASC (.pal) o lista de colores hexadecimales (.hex, .txt). */
export function parsePalette(text: string): string[] {
  const out: string[] = [], hex = (n: number) => n.toString(16).padStart(2, '0');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (/^JASC-PAL/i.test(lines[0] ?? '')) { for (const l of lines.slice(3)) { const m = l.match(/^(\d+)\s+(\d+)\s+(\d+)/); if (m) out.push('#' + [m[1], m[2], m[3]].map(v => hex(Math.min(255, +v))).join('')); } }
  else if (/^GIMP Palette/i.test(lines[0] ?? '')) { for (const l of lines.slice(1)) { if (/^(Name|Columns):|^#/.test(l)) continue; const m = l.match(/^(\d+)\s+(\d+)\s+(\d+)/); if (m) out.push('#' + [m[1], m[2], m[3]].map(v => hex(Math.min(255, +v))).join('')); } }
  else for (const l of lines) { const m = l.match(/#?([0-9a-f]{6})\b/i); if (m) out.push('#' + m[1].toLowerCase()); }
  return [...new Set(out)].slice(0, 256);
}
export async function importPalette() {
  const io = await import('../io/files'); const [f] = await io.pickFiles('.gpl,.pal,.hex,.txt'); if (!f) return;
  const colors = parsePalette(await f.text());
  if (!colors.length) { app.toast('No se han encontrado colores en el archivo', 'warn'); return; }
  try { localStorage.setItem(MINE, JSON.stringify(colors.slice(0, 64))); } catch { /* */ }
  setPalette('mine'); app.toast(`Paleta importada: ${Math.min(64, colors.length)} colores en «Mis colores»`);
}
export async function exportPalette() {
  const p = currentPalette(); if (!p.colors.length) { app.toast('La paleta está vacía', 'warn'); return; }
  const rgb = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const gpl = ['GIMP Palette', `Name: ${p.name}`, 'Columns: 8', '#', ...p.colors.map(c => rgb(c).map(v => String(v).padStart(3)).join(' ') + '\t' + c)].join('\n') + '\n';
  const io = await import('../io/files');
  try { await io.saveBlob(new Blob([gpl], { type: 'text/plain' }), `${p.name.replace(/[^\w-]+/g, '_')}.gpl`); app.toast('Paleta exportada (.gpl: GIMP, Aseprite, Krita…)'); } catch (e: any) { if (e?.name !== 'AbortError') app.toast(String(e?.message ?? e), 'warn'); }
}
