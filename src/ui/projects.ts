// Mis proyectos: ventana con la biblioteca (carpetas, buscar, abrir, cambiar de nombre, duplicar, mover, versiones
// anteriores, exportar como .edp, borrar, copia de seguridad de todo) y el guardado en ella.
import { app } from './app';
import { h } from './dom';
import { icon } from './icons';
import { showDialog, confirmDialog, promptDialog, alertDialog } from './dialog';
import { snapshot } from '../core/history';
import type { EditorDocument } from '../core/document';
import * as io from '../io/files';
import * as P from '../io/projects';
import { forget } from '../io/autosave';
import { embedInPng, shareOrSave, extractFromPng } from '../io/transfer';

/** Miniatura del documento (JPEG pequeño en una data URL). */
async function thumbOf(d: EditorDocument): Promise<string> {
  const src = d.flatten(), k = Math.min(1, 320 / Math.max(src.width, src.height));
  let cur: HTMLCanvasElement = src;
  const tw = Math.max(1, Math.round(src.width * k)), th = Math.max(1, Math.round(src.height * k));
  while (cur.width / 2 >= tw * 1.5) { const n = document.createElement('canvas'); n.width = Math.ceil(cur.width / 2); n.height = Math.ceil(cur.height / 2); n.getContext('2d')!.drawImage(cur, 0, 0, n.width, n.height); cur = n; }
  const c = document.createElement('canvas'); c.width = tw; c.height = th; const x = c.getContext('2d')!;
  x.fillStyle = '#fff'; x.fillRect(0, 0, tw, th); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, tw, th);
  return c.toDataURL('image/jpeg', 0.75);
}

/** Guarda el documento en Mis proyectos (nuevo o actualizando el suyo). */
export async function saveToLibrary(d: EditorDocument, asNew = false, folder?: string): Promise<boolean> {
  try {
    const blob = await io.serializeProject(d);
    const id = await P.putProject({ id: asNew ? undefined : d.projectId ?? undefined, name: d.name, folder, blob, thumb: await thumbOf(d), dims: `${d.width} × ${d.height}` });
    d.projectId = id; d.modified = false; d.savedSnap = snapshot(d); app.emit('docs');
    forget(d);
    return true;
  } catch (e: any) {
    alertDialog('No se ha podido guardar', /quota/i.test(String(e?.name ?? e)) ? 'No queda espacio en el dispositivo para guardar el proyecto. Borra proyectos que ya no uses o haz una copia de seguridad y libera espacio.' : String(e?.message ?? e));
    return false;
  }
}

/** Abre un proyecto de la biblioteca (si ya está abierto, solo lo muestra). */
export async function openFromLibrary(id: string, versionKey?: string) {
  if (!versionKey) { const open = app.docs.find(x => x.projectId === id); if (open) { app.setDocument(open); return; } }
  const meta = await P.getMeta(id), blob = versionKey ? await P.getVersion(versionKey) : await P.getData(id);
  if (!meta || !blob) { app.toast('No se encuentra el proyecto', 'warn'); return; }
  try {
    const d = await io.openProject(blob);
    d.name = versionKey ? `${meta.name} (${new Date(+versionKey.split(':')[1]).toLocaleString()})` : meta.name;
    // una versión anterior se abre como copia aparte: guardarla crea un proyecto nuevo y no pisa el actual
    d.projectId = versionKey ? null : id;
    app.addDocument(d);
  } catch (e: any) { alertDialog('No se ha podido abrir', String(e?.message ?? e)); }
}

const fmtSize = (b: number) => b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
const fmtDate = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Tarjeta de un proyecto (también se usa en la pantalla de inicio). */
function card(p: P.ProjectMeta, onOpen: () => void, onMenu?: (anchor: HTMLElement) => void) {
  const more = onMenu ? h('button', { class: 'pj-more', type: 'button', title: 'Más opciones del proyecto', 'aria-label': 'Más opciones del proyecto', html: icon('menu') }) : null;
  const el = h('div', { class: 'pj-card no-i18n-title', role: 'button', tabindex: '0', title: p.name },
    p.thumb ? h('img', { src: p.thumb, alt: '' }) : h('div', { class: 'pj-noimg' }),
    h('div', { class: 'pj-name no-i18n' }, p.name), h('div', { class: 'pj-sub' }, `${p.dims} · ${fmtDate(p.modified)}`), more);
  el.addEventListener('click', e => { if ((e.target as HTMLElement).closest('.pj-more')) return; onOpen(); });
  el.addEventListener('keydown', e => { if (e.key === 'Enter') onOpen(); });
  if (more && onMenu) { more.addEventListener('click', e => { e.stopPropagation(); onMenu(more); }); el.addEventListener('contextmenu', e => { e.preventDefault(); onMenu(more); }); }
  return el;
}

/** Fila de proyectos recientes para la pantalla de inicio. */
export function projectsStrip(): HTMLElement {
  const box = h('div', { class: 'pj-strip-box' });
  const fill = async () => {
    const list = (await P.listProjects()).slice(0, 6);
    box.innerHTML = '';
    if (!list.length) return;
    const all = h('button', { class: 'link-btn', type: 'button' }, 'Ver todos'); all.onclick = () => projectsDialog();
    box.append(h('div', { class: 'pj-strip-head' }, h('span', { class: 'hint' }, 'Mis proyectos:'), all), h('div', { class: 'pj-strip' }, ...list.map(p => card(p, () => openFromLibrary(p.id)))));
  };
  fill(); window.addEventListener('editor-projects', fill);
  return box;
}

/** Ventana «Mis proyectos». */
export function projectsDialog() {
  let folder: string | null = null; // null = todos, '' = sin carpeta
  let query = '';
  const side = h('div', { class: 'pj-side' }), grid = h('div', { class: 'pj-grid' }), info = h('div', { class: 'hint pj-info' });
  const search = h('input', { type: 'search', placeholder: 'Buscar proyectos…', class: 'pj-search', 'aria-label': 'Buscar proyectos' }) as HTMLInputElement;
  search.oninput = () => { query = search.value.trim().toLowerCase(); render(); };
  const menu = (anchor: HTMLElement, p: P.ProjectMeta) => {
    document.querySelector('.pj-menu')?.remove();
    const r = anchor.getBoundingClientRect();
    const item = (label: string, fn: () => void, danger = false) => { const b = h('button', { class: 'pj-mi' + (danger ? ' danger' : ''), type: 'button' }, label); b.onclick = () => { m.remove(); fn(); }; return b; };
    const m = h('div', { class: 'pj-menu', role: 'menu' },
      item('Abrir', () => { dlg.close(); openFromLibrary(p.id); }),
      item('Cambiar nombre…', async () => { const n = await promptDialog('Cambiar nombre', 'Nombre', p.name); if (n?.trim()) { await P.renameProject(p.id, n.trim()); for (const d of app.docs) if (d.projectId === p.id) d.name = n.trim(); app.emit('docs'); } }),
      item('Duplicar', async () => { await P.duplicateProject(p.id, p.name + ' copia'); app.toast('Proyecto duplicado'); }),
      item('Mover a carpeta…', () => moveDialog(p)),
      item('Versiones anteriores…', () => versionsDialog(p)),
      item('Enviar a otro dispositivo…', () => sendFromLibrary(p)),
      item('Exportar como archivo (.edp)', async () => { const b = await P.getData(p.id); if (b) await io.saveBlob(b, p.name + io.PROJECT_EXT).catch(() => {}); }),
      item('Eliminar…', async () => { if (await confirmDialog('Eliminar proyecto', `¿Eliminar «${p.name}» y sus versiones anteriores? No se puede deshacer.`, 'Eliminar')) { await P.deleteProject(p.id); for (const d of app.docs) if (d.projectId === p.id) d.projectId = null; } }, true));
    document.body.append(m);
    const W = 220; m.style.left = Math.max(8, Math.min(innerWidth - W - 8, r.right - W)) + 'px'; m.style.top = Math.min(innerHeight - 330, r.bottom + 4) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!m.contains(e.target as Node)) { m.remove(); document.removeEventListener('pointerdown', off, true); } }, true), 0);
  };
  const moveDialog = async (p: P.ProjectMeta) => {
    const folders = await P.listFolders();
    const sel = h('select', {}, h('option', { value: '' }, 'Sin carpeta'), ...folders.map(f => h('option', { value: f, selected: f === p.folder }, f))) as HTMLSelectElement;
    showDialog({ title: 'Mover a carpeta', body: [sel], onOk: () => { P.moveProject(p.id, sel.value); } });
  };
  const versionsDialog = async (p: P.ProjectMeta) => {
    const vs = await P.listVersions(p.id);
    const list = h('div', { class: 'pj-versions' }, ...(vs.length ? vs.map(v => { const b = h('button', { class: 'btn', type: 'button' }, fmtDate(v.date)); b.onclick = () => { d2.close(); dlg.close(); openFromLibrary(p.id, v.key); }; return b; }) : [h('div', { class: 'hint' }, 'Aún no hay versiones anteriores. Se guarda una cada vez que guardas el proyecto (como mucho una cada 5 minutos; se conservan las 10 últimas).')]));
    const d2 = showDialog({ title: 'Versiones anteriores', body: [h('div', { class: 'hint' }, 'Una versión anterior se abre como copia aparte: el proyecto actual no cambia.'), list], cancelLabel: null, okLabel: 'Cerrar' });
  };
  const render = async () => {
    const [all, folders, st] = await Promise.all([P.listProjects(), P.listFolders(), P.storageInfo()]);
    // carpetas
    side.innerHTML = '';
    const fbtn = (label: string, value: string | null, n: number) => {
      const b = h('button', { class: 'pj-folder' + (folder === value ? ' on' : ''), type: 'button' }, h('span', { html: icon('folder') }), h('span', { class: 'pj-fname' + (value ? ' no-i18n' : '') }, label), h('span', { class: 'pj-count' }, String(n)));
      b.onclick = () => { folder = value; render(); };
      if (value) b.addEventListener('contextmenu', async e => { e.preventDefault(); folderMenu(value); });
      return b;
    };
    side.append(fbtn('Todos', null, all.length), fbtn('Sin carpeta', '', all.filter(p => !p.folder).length), ...folders.map(f => fbtn(f, f, all.filter(p => p.folder === f).length)));
    const nf = h('button', { class: 'btn pj-newfolder', type: 'button', html: icon('plus') + ' Nueva carpeta' });
    nf.onclick = async () => { const n = await promptDialog('Nueva carpeta', 'Nombre', ''); if (n?.trim()) { await P.addFolder(n.trim()); folder = n.trim(); render(); } };
    side.append(nf);
    if (folder) { const fm = h('button', { class: 'link-btn', type: 'button' }, 'Opciones de la carpeta…'); fm.onclick = () => folderMenu(folder!); side.append(fm); }
    // proyectos
    const shown = all.filter(p => (folder === null || p.folder === folder) && (!query || p.name.toLowerCase().includes(query)));
    grid.innerHTML = '';
    if (!shown.length) grid.append(h('div', { class: 'pj-empty' }, all.length ? 'No hay proyectos aquí.' : 'Aún no tienes proyectos guardados. Al guardar (Ctrl+S o el botón de guardar) tu trabajo se queda aquí, con todas sus capas, para seguir otro día.'));
    for (const p of shown) grid.append(card(p, () => { dlg.close(); openFromLibrary(p.id); }, a => menu(a, p)));
    const tot = all.reduce((s, p) => s + p.bytes, 0);
    info.textContent = `${all.length} proyecto(s) · ${fmtSize(tot)}` + (st && st.quota ? ` · espacio libre en el dispositivo: ${fmtSize(Math.max(0, st.quota - st.used))}` : '');
  };
  const folderMenu = async (f: string) => {
    const ren = h('button', { class: 'btn', type: 'button' }, 'Cambiar nombre…'), del = h('button', { class: 'btn', type: 'button' }, 'Eliminar carpeta');
    const d3 = showDialog({ title: `Carpeta «${f}»`, body: [h('div', { class: 'hint' }, 'Al eliminar la carpeta, sus proyectos pasan a «Sin carpeta» (no se borra ninguno).'), h('div', { class: 'pj-row' }, ren, del)], cancelLabel: null, okLabel: 'Cerrar' });
    ren.onclick = async () => { d3.close(); const n = await promptDialog('Cambiar nombre de la carpeta', 'Nombre', f); if (n?.trim() && n.trim() !== f) { await P.renameFolder(f, n.trim()); if (folder === f) folder = n.trim(); render(); } };
    del.onclick = async () => { d3.close(); await P.deleteFolder(f); if (folder === f) folder = null; render(); };
  };
  // copia de seguridad e importación
  const backup = h('button', { class: 'btn', type: 'button', title: 'Guarda todos los proyectos en un solo archivo ZIP (para pasarlos a otro dispositivo o guardarlos aparte)' }, 'Copia de seguridad');
  backup.onclick = async () => { app.toast('Preparando la copia de seguridad…'); const z = await P.backupAll(); await io.saveBlob(z, `Mis proyectos ${new Date().toISOString().slice(0, 10)}.zip`).catch(() => {}); };
  const sendAllBtn = h('button', { class: 'btn', type: 'button', title: 'Pasa todos los proyectos a otro dispositivo (Quick Share, Drive, correo…)' }, 'Enviar todos…');
  sendAllBtn.onclick = () => sendAll();
  const imp = h('button', { class: 'btn', type: 'button', title: 'Añade proyectos desde un archivo .edp, un proyecto enviado (.png) o una copia de seguridad (.zip)' }, 'Importar…');
  imp.onclick = async () => {
    const files = await io.pickFiles('.edp,.zip,.png,application/zip,image/png');
    let n = 0;
    for (const f of files) {
      try {
        if (/\.zip$/i.test(f.name)) n += await P.restoreBackup(f);
        else if (/\.png$/i.test(f.name) || f.type === 'image/png') { const got = await extractFromPng(f); if (!got) throw new Error('Esta imagen no lleva un proyecto dentro'); if (got.kind === 'backup') n += await P.restoreBackup(got.data); else { const d = await io.openProject(got.data); d.name = got.name || io.baseName(f.name); if (await saveToLibrary(d, true, folder ?? '')) n++; } }
        else { const d = await io.openProject(f); d.name = io.baseName(f.name); if (await saveToLibrary(d, true, folder ?? '')) n++; }
      } catch (e: any) { alertDialog('No se ha podido importar', `${f.name}: ${e?.message ?? e}`); }
    }
    if (n) app.toast(`${n} proyecto(s) importados`);
    render();
  };
  const saveCur = h('button', { class: 'btn', type: 'button', disabled: !app.doc || undefined }, 'Guardar el actual aquí');
  saveCur.onclick = async () => { const d = app.doc; if (!d) return; if (await saveToLibrary(d, false, folder ?? undefined)) app.toast('Guardado en Mis proyectos'); };
  const body = h('div', { class: 'pj-wrap' }, side, h('div', { class: 'pj-main' }, h('div', { class: 'pj-top' }, search, saveCur, imp, sendAllBtn, backup), grid, info));
  const dlg = showDialog({ title: 'Mis proyectos', body, width: 900, cancelLabel: null, okLabel: 'Cerrar' });
  dlg.form.classList.add('pj-dialog');
  const re = () => { if (document.body.contains(body)) render(); else window.removeEventListener('editor-projects', re); };
  window.addEventListener('editor-projects', re);
  render();
}

// ---- Pasar proyectos a otro dispositivo -------------------------------------------------------------------
/** Vista previa (PNG de hasta 2048 px) de un documento. */
async function previewPng(d: EditorDocument): Promise<Blob> {
  const src = d.flatten(), k = Math.min(1, 2048 / Math.max(src.width, src.height));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k));
  const x = c.getContext('2d')!; x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('No se ha podido crear la imagen')), 'image/png'));
}
const sentNote = 'Ábrelo con Editor en el otro dispositivo: se abre con todas sus capas y se guarda en Mis proyectos. Envíalo con Quick Share, Drive, el correo o un cable (WhatsApp comprime las fotos y se perderían las capas).';
async function send(png: Blob, fileName: string) {
  const r = await shareOrSave(new File([png], fileName, { type: 'image/png' }), (b, n) => io.saveBlob(b, n));
  if (r === 'saved') alertDialog('Listo para pasar a otro dispositivo', `Se ha guardado «${fileName}». ${sentNote}`);
  else if (r === 'shared') app.toast('Enviado. En el otro dispositivo, ábrelo con Editor');
}
/** Envía el documento actual (proyecto completo dentro de un PNG). */
export async function sendCurrent() {
  const d = app.doc; if (!d) return;
  app.toast('Preparando el proyecto para enviar…');
  const blob = await io.serializeProject(d);
  await send(await embedInPng(await previewPng(d), 'edPj', new Uint8Array(await blob.arrayBuffer()), d.name), `${d.name}.png`);
}
async function sendFromLibrary(p: P.ProjectMeta) {
  const blob = await P.getData(p.id); if (!blob) return;
  app.toast('Preparando el proyecto para enviar…');
  const d = await io.openProject(blob);
  await send(await embedInPng(await previewPng(d), 'edPj', new Uint8Array(await blob.arrayBuffer()), p.name), `${p.name}.png`);
}
/** Todos los proyectos de una vez (la copia de seguridad dentro de un PNG con un mosaico de miniaturas). */
async function sendAll() {
  const list = await P.listProjects(); if (!list.length) { app.toast('Aún no hay proyectos que enviar', 'warn'); return; }
  app.toast('Preparando todos los proyectos…');
  const zip = await P.backupAll();
  const n = Math.min(list.length, 9), cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), S = 300;
  const c = document.createElement('canvas'); c.width = cols * S; c.height = rows * S + 60; const x = c.getContext('2d')!;
  x.fillStyle = '#1d1e21'; x.fillRect(0, 0, c.width, c.height);
  await Promise.all(list.slice(0, n).map((p, i) => new Promise<void>(res => { if (!p.thumb) return res(); const im = new Image(); im.onload = () => { const k = Math.min((S - 12) / im.width, (S - 12) / im.height); x.drawImage(im, (i % cols) * S + (S - im.width * k) / 2, Math.floor(i / cols) * S + (S - im.height * k) / 2, im.width * k, im.height * k); res(); }; im.onerror = () => res(); im.src = p.thumb; })));
  x.fillStyle = '#d7d9dd'; x.font = '600 26px sans-serif'; x.fillText(`Editor · ${list.length} proyecto(s)`, 16, c.height - 20);
  const png = await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/png'));
  await send(await embedInPng(png, 'edBk', new Uint8Array(await zip.arrayBuffer()), 'Mis proyectos'), `Mis proyectos ${new Date().toISOString().slice(0, 10)}.png`);
}
/** Al abrir un PNG: si lleva un proyecto o una copia dentro, se abre o se restaura (y se guarda en Mis proyectos). */
export async function openTransferred(f: Blob): Promise<boolean> {
  const got = await extractFromPng(f).catch(() => null); if (!got) return false;
  // si lo que lleva dentro está roto, se abre la imagen como una foto normal (y se avisa)
  const broken = (e: unknown) => { (window as any).__editorLogError?.('Proyecto dentro de PNG: ' + String((e as any)?.message ?? e)); app.toast('El proyecto que lleva esta imagen está dañado: se abre solo la imagen', 'warn'); return false; };
  if (got.kind === 'backup') {
    let n = 0; try { n = await P.restoreBackup(got.data); } catch (e) { return broken(e); }
    app.toast(`${n} proyecto(s) importados`); projectsDialog(); return true;
  }
  let d: EditorDocument; try { d = await io.openProject(got.data); } catch (e) { return broken(e); }
  if (got.name) d.name = got.name;
  app.addDocument(d);
  if (await saveToLibrary(d, true)) app.toast('Proyecto recibido con todas sus capas: guardado en Mis proyectos');
  return true;
}
