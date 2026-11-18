// Muestras de color de Adobe: .aco (Photoshop) y .ase (intercambio entre programas). Se leen RGB, gris, CMYK,
// HSB y Lab, convertidos a RGB.

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function labToHex(L: number, a: number, b: number) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200, f = (t: number) => { const c = t * t * t; return c > 0.008856 ? c : (t - 16 / 116) / 7.787; };
  const X = f(fx) * 0.95047, Y = f(fy), Z = f(fz) * 1.08883;
  const g = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055) * 255;
  return hex(g(3.2406 * X - 1.5372 * Y - 0.4986 * Z), g(-0.9689 * X + 1.8758 * Y + 0.0415 * Z), g(0.0557 * X - 0.204 * Y + 1.057 * Z));
}
function hsbToHex(h: number, s: number, v: number) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
  return hex(r * 255, g * 255, b * 255);
}

export function readSwatches(buf: ArrayBuffer): { name: string; color: string }[] {
  const b = new Uint8Array(buf), v = new DataView(buf), out: { name: string; color: string }[] = [];
  if (String.fromCharCode(...b.subarray(0, 4)) === 'ASEF') {
    const n = v.getUint32(8); let p = 12;
    for (let i = 0; i < n && p + 6 <= b.length; i++) {
      const type = v.getUint16(p), len = v.getUint32(p + 2); let q = p + 6; const end = q + len;
      if (type === 1) {
        const nl = v.getUint16(q); q += 2; let name = ''; for (let k = 0; k < nl; k++) { const c = v.getUint16(q + k * 2); if (c) name += String.fromCharCode(c); } q += nl * 2;
        const model = String.fromCharCode(b[q], b[q + 1], b[q + 2], b[q + 3]); q += 4;
        const f = (k: number) => v.getFloat32(q + k * 4);
        let color = '';
        if (model === 'RGB ') color = hex(f(0) * 255, f(1) * 255, f(2) * 255);
        else if (model === 'CMYK') color = hex(255 * (1 - f(0)) * (1 - f(3)), 255 * (1 - f(1)) * (1 - f(3)), 255 * (1 - f(2)) * (1 - f(3)));
        else if (model === 'Gray') color = hex(f(0) * 255, f(0) * 255, f(0) * 255);
        else if (model === 'LAB ') color = labToHex(f(0) * 100, f(1), f(2));
        if (color) out.push({ name, color });
      }
      p = end;
    }
    return out;
  }
  // .aco: versión 1 (sin nombres) y, a continuación, versión 2 (con nombres); se prefiere la 2
  const readAco = (p: number): { list: { name: string; color: string }[]; end: number } | null => {
    if (p + 4 > b.length) return null;
    const ver = v.getUint16(p), n = v.getUint16(p + 2); if (ver !== 1 && ver !== 2) return null;
    let q = p + 4; const list: { name: string; color: string }[] = [];
    for (let i = 0; i < n && q + 10 <= b.length; i++) {
      const sp = v.getUint16(q), w = [v.getUint16(q + 2), v.getUint16(q + 4), v.getUint16(q + 6), v.getUint16(q + 8)]; q += 10;
      let name = '';
      if (ver === 2) { q += 2; const nl = v.getUint16(q); q += 2; for (let k = 0; k < nl; k++) { const c = v.getUint16(q + k * 2); if (c) name += String.fromCharCode(c); } q += nl * 2; }
      let color = '';
      if (sp === 0) color = hex(w[0] / 257, w[1] / 257, w[2] / 257);
      else if (sp === 1) color = hsbToHex(w[0] / 65535, w[1] / 65535, w[2] / 65535);
      else if (sp === 2) { const c = 1 - w[0] / 65535, m = 1 - w[1] / 65535, y = 1 - w[2] / 65535, k = 1 - w[3] / 65535; color = hex(255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)); }
      else if (sp === 7) color = labToHex(w[0] / 100, v.getInt16(q - 6) / 100, v.getInt16(q - 4) / 100);
      else if (sp === 8) { const g = 255 * (1 - w[0] / 10000); color = hex(g, g, g); }
      if (color) list.push({ name, color });
    }
    return { list, end: q };
  };
  const v1 = readAco(0); if (!v1) throw new Error('no es un archivo de muestras .aco ni .ase');
  const v2 = readAco(v1.end);
  return v2 && v2.list.length ? v2.list : v1.list;
}
