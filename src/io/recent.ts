// Archivos recientes: se guarda una copia de los últimos archivos abiertos en el propio navegador
// (IndexedDB) para volver a abrirlos con un clic. Nada sale del equipo.

const DB = 'editor-recent', STORE = 'files', MAX = 12, MAX_SIZE = 80e6;
export interface Recent { key: string; name: string; date: number; bytes: number; dims: string; thumb: string; blob: Blob; type: string }

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => { const rq = fn(d.transaction(STORE, mode).objectStore(STORE)); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
}

export async function listRecent(): Promise<Recent[]> {
  try {
    const keys = await tx('readonly', s => s.getAllKeys()) as string[], vals = await tx('readonly', s => s.getAll()) as any[];
    return vals.map((v, i) => ({ key: keys[i], ...v })).sort((a, b) => b.date - a.date);
  } catch { return []; }
}
export async function addRecent(f: File, thumbSrc: HTMLCanvasElement | null, dims: string) {
  if (f.size > MAX_SIZE) return;
  try {
    let thumb = '';
    if (thumbSrc) { const k = Math.min(1, 160 / Math.max(thumbSrc.width, thumbSrc.height)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(thumbSrc.width * k)); c.height = Math.max(1, Math.round(thumbSrc.height * k)); const x = c.getContext('2d')!; x.imageSmoothingQuality = 'high'; x.drawImage(thumbSrc, 0, 0, c.width, c.height); thumb = c.toDataURL('image/jpeg', 0.7); }
    const key = f.name + '|' + f.size;
    await tx('readwrite', s => s.put({ name: f.name, date: Date.now(), bytes: f.size, dims, thumb, blob: f, type: f.type }, key));
    const all = await listRecent();
    for (const r of all.slice(MAX)) await tx('readwrite', s => s.delete(r.key));
    window.dispatchEvent(new Event('editor-recent'));
  } catch { /* sin espacio o sin almacenamiento */ }
}
export async function removeRecent(key: string) { try { await tx('readwrite', s => s.delete(key)); window.dispatchEvent(new Event('editor-recent')); } catch { /* */ } }
export async function clearRecent() { try { await tx('readwrite', s => s.clear()); window.dispatchEvent(new Event('editor-recent')); } catch { /* */ } }
export const recentFile = (r: Recent) => new File([r.blob], r.name, { type: r.type || r.blob.type });
