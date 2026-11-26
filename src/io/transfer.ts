// Pasar proyectos entre dispositivos (empezar en el móvil y terminar en la tableta) sin servidores:
// el proyecto completo (.edp) va dentro de un PNG, en un fragmento privado. Quien no tenga el editor ve una imagen
// normal (la vista previa); el editor detecta el proyecto y lo abre con todas sus capas. Se usa un PNG porque Android
// solo deja compartir ciertos tipos de archivo (imágenes, PDF…), no .edp ni .zip.
// Fragmentos: «edPj» = un proyecto; «edBk» = copia de seguridad de toda la biblioteca (ZIP).

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
let crcT: Uint32Array | null = null;
function crc32(parts: Uint8Array[]): number {
  if (!crcT) { crcT = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; } }
  let c = 0xffffffff; for (const d of parts) for (let i = 0; i < d.length; i++) c = crcT[(c ^ d[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Mete `data` en un PNG (antes de su final) en un fragmento del tipo dado. */
export async function embedInPng(png: Blob, type: 'edPj' | 'edBk', data: Uint8Array, name: string): Promise<Blob> {
  const b = new Uint8Array(await png.arrayBuffer());
  // final del PNG: los últimos 12 bytes son el fragmento IEND
  const iend = b.length - 12;
  if (String.fromCharCode(b[iend + 4], b[iend + 5], b[iend + 6], b[iend + 7]) !== 'IEND') throw new Error('PNG inesperado');
  // contenido: nombre (UTF-8) + 0 + datos, para recuperar el nombre del proyecto al recibirlo
  const nm = new TextEncoder().encode(name), body = new Uint8Array(nm.length + 1 + data.length); body.set(nm); body[nm.length] = 0; body.set(data, nm.length + 1);
  const head = new Uint8Array(8), hv = new DataView(head.buffer); hv.setUint32(0, body.length); for (let i = 0; i < 4; i++) head[4 + i] = type.charCodeAt(i);
  const crc = new Uint8Array(4); new DataView(crc.buffer).setUint32(0, crc32([head.subarray(4), body]));
  return new Blob([b.subarray(0, iend), head, body, crc, b.subarray(iend)], { type: 'image/png' });
}

/** Si el archivo es un PNG con un proyecto o una copia dentro, lo devuelve (si no, null). */
export async function extractFromPng(f: Blob): Promise<{ kind: 'project' | 'backup'; name: string; data: Blob } | null> {
  if (f.size < 64) return null;
  const head = new Uint8Array(await f.slice(0, 8).arrayBuffer());
  if (SIG.some((v, i) => head[i] !== v)) return null;
  // se recorren las cabeceras de los fragmentos leyendo solo lo necesario (el archivo puede ser grande)
  let p = 8;
  while (p + 12 <= f.size) {
    const h = new DataView(await f.slice(p, p + 8).arrayBuffer()), len = h.getUint32(0), type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
    if (type === 'edPj' || type === 'edBk') {
      const body = new Uint8Array(await f.slice(p + 8, p + 8 + len).arrayBuffer()), z = body.indexOf(0);
      const name = new TextDecoder().decode(body.subarray(0, Math.max(0, z)));
      return { kind: type === 'edPj' ? 'project' : 'backup', name, data: new Blob([body.subarray(z + 1)]) };
    }
    if (type === 'IEND') break;
    p += 12 + len;
  }
  return null;
}

/** Comparte un archivo con el menú del sistema (Quick Share, Drive, correo…); si no se puede, lo descarga. */
export async function shareOrSave(file: File, save: (b: Blob, name: string) => Promise<any>): Promise<'shared' | 'saved' | 'cancelled'> {
  const nav = navigator as any;
  try {
    if (nav.canShare?.({ files: [file] })) { await nav.share({ files: [file], title: file.name }); return 'shared'; }
  } catch (e: any) { if (e?.name === 'AbortError') return 'cancelled'; }
  await save(file, file.name);
  return 'saved';
}
