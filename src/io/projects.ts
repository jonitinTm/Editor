// Mis proyectos: biblioteca de proyectos editables guardada en el propio dispositivo (IndexedDB), como en las apps de
// dibujo de tableta: carpetas, duplicar, cambiar de nombre, versiones anteriores y copia de seguridad en un ZIP.
// Cada proyecto es un .edp completo (capas, máscaras, textos, ajustes, estilos…). Nada sale del dispositivo.
import { makeZip } from './zip';

export interface ProjectMeta { id: string; name: string; folder: string; created: number; modified: number; thumb: string; bytes: number; dims: string }
export interface ProjectVersion { key: string; id: string; date: number; bytes: number }

const DB = 'editor-projects', META = 'meta', DATA = 'data', VERS = 'versions', FOLD = 'folders';
/** Versiones anteriores que se guardan de cada proyecto, y cada cuánto como mínimo (para no llenar el espacio). */
const MAX_VERSIONS = 10, VERSION_EVERY = 5 * 60_000;

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { const d = r.result; for (const s of [META, DATA, VERS, FOLD]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); };
    r.onsuccess = () => res(r.result); r.onerror = () => { dbp = null; rej(r.error); };
  });
}
function req<T>(r: IDBRequest<T>): Promise<T> { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function store(name: string, mode: IDBTransactionMode = 'readonly') { return (await db()).transaction(name, mode).objectStore(name); }
const changed = () => window.dispatchEvent(new Event('editor-projects'));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function listProjects(): Promise<ProjectMeta[]> {
  try { return ((await req((await store(META)).getAll())) as ProjectMeta[]).sort((a, b) => b.modified - a.modified); } catch { return []; }
}
export async function getMeta(id: string): Promise<ProjectMeta | null> { return (await req((await store(META)).get(id))) as ProjectMeta ?? null; }
export async function getData(id: string): Promise<Blob | null> { return (await req((await store(DATA)).get(id))) as Blob ?? null; }

/** Guarda (o actualiza) un proyecto. La versión anterior pasa a «versiones anteriores» si hace rato que no se guardaba una. */
export async function putProject(o: { id?: string; name: string; folder?: string; blob: Blob; thumb: string; dims: string }): Promise<string> {
  const id = o.id ?? newId(), now = Date.now();
  const old = o.id ? await getMeta(o.id) : null;
  if (old) {
    const prev = await getData(old.id), vers = await listVersions(old.id);
    if (prev && (!vers.length || now - vers[0].date > VERSION_EVERY)) {
      await req((await store(VERS, 'readwrite')).put({ id: old.id, date: old.modified, bytes: prev.size, blob: prev }, `${old.id}:${old.modified}`));
      for (const v of (await listVersions(old.id)).slice(MAX_VERSIONS)) await req((await store(VERS, 'readwrite')).delete(v.key));
    }
  }
  const meta: ProjectMeta = { id, name: o.name, folder: o.folder ?? old?.folder ?? '', created: old?.created ?? now, modified: now, thumb: o.thumb, bytes: o.blob.size, dims: o.dims };
  await req((await store(DATA, 'readwrite')).put(o.blob, id));
  await req((await store(META, 'readwrite')).put(meta, id));
  // que el navegador no borre la biblioteca si le falta espacio
  try { await navigator.storage?.persist?.(); } catch { /* */ }
  changed();
  return id;
}
export async function renameProject(id: string, name: string) { const m = await getMeta(id); if (!m) return; m.name = name; await req((await store(META, 'readwrite')).put(m, id)); changed(); }
export async function moveProject(id: string, folder: string) { const m = await getMeta(id); if (!m) return; m.folder = folder; await req((await store(META, 'readwrite')).put(m, id)); changed(); }
export async function duplicateProject(id: string, name: string): Promise<string | null> {
  const m = await getMeta(id), b = await getData(id); if (!m || !b) return null;
  const nid = newId(), now = Date.now();
  await req((await store(DATA, 'readwrite')).put(b, nid));
  await req((await store(META, 'readwrite')).put({ ...m, id: nid, name, created: now, modified: now }, nid));
  changed(); return nid;
}
export async function deleteProject(id: string) {
  for (const v of await listVersions(id)) await req((await store(VERS, 'readwrite')).delete(v.key));
  await req((await store(DATA, 'readwrite')).delete(id)); await req((await store(META, 'readwrite')).delete(id)); changed();
}

export async function listVersions(id: string): Promise<ProjectVersion[]> {
  const s = await store(VERS), keys = (await req(s.getAllKeys(IDBKeyRange.bound(id + ':', id + ':￿')))) as string[];
  return keys.map(k => ({ key: k, id, date: +k.slice(id.length + 1), bytes: 0 })).sort((a, b) => b.date - a.date);
}
export async function getVersion(key: string): Promise<Blob | null> { const v = await req((await store(VERS)).get(key)) as any; return v?.blob ?? null; }

export async function listFolders(): Promise<string[]> {
  const own = (await req((await store(FOLD)).getAllKeys())) as string[];
  const used = (await listProjects()).map(p => p.folder).filter(Boolean);
  return [...new Set([...own, ...used])].sort((a, b) => a.localeCompare(b));
}
export async function addFolder(name: string) { await req((await store(FOLD, 'readwrite')).put(1, name)); changed(); }
export async function renameFolder(from: string, to: string) {
  for (const p of await listProjects()) if (p.folder === from) { p.folder = to; await req((await store(META, 'readwrite')).put(p, p.id)); }
  await req((await store(FOLD, 'readwrite')).delete(from)); await req((await store(FOLD, 'readwrite')).put(1, to)); changed();
}
/** Borra la carpeta; sus proyectos pasan a «Sin carpeta» (no se borra ningún proyecto). */
export async function deleteFolder(name: string) {
  for (const p of await listProjects()) if (p.folder === name) { p.folder = ''; await req((await store(META, 'readwrite')).put(p, p.id)); }
  await req((await store(FOLD, 'readwrite')).delete(name)); changed();
}

/** Espacio usado y disponible (si el navegador lo dice). */
export async function storageInfo(): Promise<{ used: number; quota: number } | null> {
  try { const e = await navigator.storage?.estimate?.(); return e ? { used: e.usage ?? 0, quota: e.quota ?? 0 } : null; } catch { return null; }
}

// ---- Copia de seguridad ------------------------------------------------------------------------------
/** Todos los proyectos (con sus carpetas) en un ZIP: carpeta/nombre.edp, más un índice para restaurarlos tal cual. */
export async function backupAll(): Promise<Blob> {
  const files: { name: string; data: Uint8Array }[] = [], index: any[] = [], used = new Set<string>();
  for (const p of await listProjects()) {
    const b = await getData(p.id); if (!b) continue;
    const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'proyecto';
    let path = (p.folder ? safe(p.folder) + '/' : '') + safe(p.name), k = 2;
    while (used.has(path)) path = (p.folder ? safe(p.folder) + '/' : '') + safe(p.name) + ' ' + k++;
    used.add(path);
    files.push({ name: path + '.edp', data: new Uint8Array(await b.arrayBuffer()) });
    index.push({ file: path + '.edp', name: p.name, folder: p.folder, created: p.created, modified: p.modified, thumb: p.thumb, dims: p.dims });
  }
  files.push({ name: 'proyectos.json', data: new TextEncoder().encode(JSON.stringify({ app: 'Photocap', version: 1, folders: await listFolders(), projects: index })) });
  return makeZip(files);
}
/** Lee un ZIP sin comprimir (el de la copia de seguridad). */
export function readZip(buf: ArrayBuffer): Map<string, Uint8Array> {
  const v = new DataView(buf), out = new Map<string, Uint8Array>(), dec = new TextDecoder();
  let end = -1; for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('No es un archivo ZIP');
  let p = v.getUint32(end + 16, true); const n = v.getUint16(end + 10, true);
  for (let i = 0; i < n; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nl));
    if (method !== 0) throw new Error('El ZIP está comprimido: usa la copia de seguridad que crea el propio editor');
    const lnl = v.getUint16(off + 26, true), lxl = v.getUint16(off + 28, true);
    out.set(name, new Uint8Array(buf, off + 30 + lnl + lxl, size));
    p += 46 + nl + xl + cl;
  }
  return out;
}
/** Restaura una copia de seguridad: añade sus proyectos (no borra ni sustituye los que ya hay). Devuelve cuántos. */
export async function restoreBackup(zip: Blob): Promise<number> {
  const files = readZip(await zip.arrayBuffer()), idx = files.get('proyectos.json');
  const index = idx ? JSON.parse(new TextDecoder().decode(idx)) : { folders: [], projects: [...files.keys()].filter(f => f.endsWith('.edp')).map(f => ({ file: f, name: f.replace(/^.*\//, '').replace(/\.edp$/, ''), folder: f.includes('/') ? f.split('/')[0] : '' })) };
  for (const f of index.folders ?? []) await addFolder(f);
  let n = 0;
  for (const p of index.projects ?? []) {
    const data = files.get(p.file); if (!data) continue;
    const id = newId(), now = Date.now();
    await req((await store(DATA, 'readwrite')).put(new Blob([data.slice()], { type: 'application/octet-stream' }), id));
    await req((await store(META, 'readwrite')).put({ id, name: p.name, folder: p.folder ?? '', created: p.created ?? now, modified: p.modified ?? now, thumb: p.thumb ?? '', bytes: data.length, dims: p.dims ?? '' } as ProjectMeta, id));
    n++;
  }
  changed();
  return n;
}
