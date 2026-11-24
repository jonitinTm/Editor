// Guardado automático en el propio navegador (IndexedDB), para recuperar el
// trabajo si se cierra la pestaña por accidente. Nada sale del equipo.

import type { EditorDocument } from '../core/document';
import { autosaveData, openProject, openProjectData } from './files';

const DB = 'editor', STORE = 'autosave';
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => { const rq = fn(d.transaction(STORE, mode).objectStore(STORE)); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
}

export interface Saved { key: string; name: string; date: number; size: string; /** versiones anteriores */ blob?: Blob; data?: any; }
const uids = new WeakMap<EditorDocument, string>();
const lastStep = new WeakMap<EditorDocument, unknown>();
const uid = (d: EditorDocument) => { if (!uids.has(d)) uids.set(d, Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); return uids.get(d)!; };

/** Guarda los documentos con cambios desde la última copia. */
export async function autosave(docs: EditorDocument[]) {
  for (const d of docs) {
    if (d.embedded || !d.modified) continue;
    const step = d.history.steps[d.history.index];
    if (lastStep.get(d) === step) continue;
    if (d.width * d.height * d.allLayers().length > 120e6) continue; // demasiado grande para copiarlo cada poco
    try {
      // imágenes como archivos binarios y solo se codifican las capas que han cambiado (antes: todo a texto, cada vez)
      const data = await autosaveData(d);
      await tx('readwrite', s => s.put({ name: d.name, date: Date.now(), size: `${d.width} × ${d.height}`, data }, uid(d)));
      lastStep.set(d, step);
    } catch { /* sin espacio o almacenamiento no disponible */ }
  }
}
export async function forget(d: EditorDocument) { try { await tx('readwrite', s => s.delete(uid(d))); lastStep.delete(d); } catch { /* */ } }
export async function listSaved(): Promise<Saved[]> {
  try {
    const keys = await tx('readonly', s => s.getAllKeys()) as string[], vals = await tx('readonly', s => s.getAll()) as any[];
    return vals.map((v, i) => ({ key: keys[i], ...v })).sort((a, b) => b.date - a.date);
  } catch { return []; }
}
export async function removeSaved(key: string) { try { await tx('readwrite', s => s.delete(key)); } catch { /* */ } }
export async function restoreSaved(s: Saved): Promise<EditorDocument> {
  const d = s.data ? await openProjectData(s.data) : await openProject(s.blob!);
  uids.set(d, s.key);
  return d;
}
