// Lectura de los datos EXIF de una foto JPEG (cámara, objetivo, exposición, fecha, GPS…), solo para mostrarlos.

export type Exif = Record<string, string>;

const TAGS: Record<number, string> = {
  0x010f: 'Fabricante', 0x0110: 'Cámara', 0x0131: 'Programa', 0x0132: 'Fecha de modificación', 0x013b: 'Autor', 0x8298: 'Copyright', 0x010e: 'Descripción',
  0x829a: 'Exposición', 0x829d: 'Diafragma', 0x8827: 'ISO', 0x9003: 'Fecha de la foto', 0x920a: 'Distancia focal', 0x9209: 'Flash',
  0xa434: 'Objetivo', 0xa405: 'Focal equivalente (35 mm)', 0x9204: 'Compensación de exposición', 0xa002: 'Ancho original', 0xa003: 'Alto original', 0x0112: 'Orientación',
};

/** Datos EXIF de un JPEG, o null si no tiene. */
export async function readExif(file: Blob): Promise<Exif | null> {
  if (file.size < 4) return null;
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, 256 * 1024)).arrayBuffer());
  if (head[0] !== 0xff || head[1] !== 0xd8) return null;
  let p = 2;
  while (p + 4 < head.length) {
    if (head[p] !== 0xff) return null;
    const marker = head[p + 1], len = (head[p + 2] << 8) | head[p + 3];
    if (marker === 0xe1 && String.fromCharCode(...head.subarray(p + 4, p + 8)) === 'Exif') return parseTiff(head, p + 10, Math.min(head.length, p + 2 + len));
    if (marker === 0xda) return null;
    p += 2 + len;
  }
  return null;
}

function parseTiff(b: Uint8Array, base: number, end: number): Exif | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const le = b[base] === 0x49; const u16 = (o: number) => v.getUint16(base + o, le), u32 = (o: number) => v.getUint32(base + o, le), i32 = (o: number) => v.getInt32(base + o, le);
  if (base + 8 > end || u16(2) !== 42) return null;
  const out: Exif = {}; const sizes = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
  let gps: Record<number, number[] | string> = {};
  const readIfd = (off: number, into: (tag: number, val: number[] | string) => void) => {
    if (base + off + 2 > end) return;
    const n = u16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12; if (base + e + 12 > end) return;
      const tag = u16(e), type = u16(e + 2), cnt = u32(e + 4), sz = (sizes[type] ?? 1) * cnt, vo = sz > 4 ? u32(e + 8) : e + 8;
      if (base + vo + sz > end) continue;
      let val: number[] | string;
      if (type === 2) { const raw = b.subarray(base + vo, base + vo + Math.max(0, cnt - 1)); let s: string; try { s = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { s = String.fromCharCode(...raw); } val = s.replace(/\0+$/, '').trim(); }
      else if (type === 5 || type === 10) { val = []; for (let k = 0; k < cnt; k++) { const nu = type === 5 ? u32(vo + k * 8) : i32(vo + k * 8), de = type === 5 ? u32(vo + k * 8 + 4) : i32(vo + k * 8 + 4); val.push(de ? nu / de : 0); } }
      else if (type === 3) { val = []; for (let k = 0; k < cnt; k++) val.push(u16(vo + k * 2)); }
      else if (type === 4) { val = []; for (let k = 0; k < cnt; k++) val.push(u32(vo + k * 4)); }
      else continue;
      into(tag, val);
    }
  };
  const put = (tag: number, val: number[] | string) => {
    if (tag === 0x8769 && Array.isArray(val)) { readIfd(val[0], put); return; }
    if (tag === 0x8825 && Array.isArray(val)) { readIfd(val[0], (t, x) => { gps[t] = x; }); return; }
    const name = TAGS[tag]; if (!name) return;
    const n = Array.isArray(val) ? val[0] : NaN;
    let s: string;
    if (tag === 0x829a) s = n >= 1 ? `${n} s` : `1/${Math.round(1 / n)} s`;
    else if (tag === 0x829d) s = `f/${+n.toFixed(1)}`;
    else if (tag === 0x920a) s = `${+n.toFixed(1)} mm`;
    else if (tag === 0xa405) s = `${n} mm`;
    else if (tag === 0x9204) s = `${n > 0 ? '+' : ''}${+n.toFixed(2)} EV`;
    else if (tag === 0x9209) s = (n & 1) ? 'Disparado' : 'No';
    else s = Array.isArray(val) ? val.map(x => +(+x).toFixed(3)).join(', ') : val;
    if (s) out[name] = s;
  };
  readIfd(u32(4), put);
  const dms = (a: number[] | string | undefined) => Array.isArray(a) && a.length >= 3 ? a[0] + a[1] / 60 + a[2] / 3600 : NaN;
  const lat = dms(gps[2]), lon = dms(gps[4]);
  if (isFinite(lat) && isFinite(lon)) out['GPS'] = `${(gps[1] === 'S' ? -lat : lat).toFixed(5)}, ${(gps[3] === 'W' ? -lon : lon).toFixed(5)}`;
  return Object.keys(out).length ? out : null;
}
