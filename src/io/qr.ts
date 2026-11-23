// Codificador de códigos QR (modo byte, UTF-8, versiones 1 a 20, corrección L/M/Q/H), sin dependencias.
// Devuelve la matriz de módulos (true = negro).

// tablas de la norma (versiones 1 a 20): códigos de corrección por bloque y número de bloques
const ECC_PER_BLOCK: Record<string, number[]> = {
  L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28],
  M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26],
  Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30],
  H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28],
};
const NUM_BLOCKS: Record<string, number[]> = {
  L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8],
  M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16],
  Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20],
  H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25],
};
/** Módulos disponibles para datos en una versión (fórmula de la norma). */
function rawModules(v: number) { let r = (16 * v + 128) * v + 64; if (v >= 2) { const na = Math.floor(v / 7) + 2; r -= (25 * na - 10) * na - 55; if (v >= 7) r -= 36; } return r; }
const ALIGN: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90]];

// aritmética en GF(256)
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const gmul = (a: number, b: number) => a && b ? EXP[LOG[a] + LOG[b]] : 0;
function rsGenerator(n: number) { let g = [1]; for (let i = 0; i < n; i++) { const ng = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= gmul(g[j], EXP[i]); } g = ng; } return g; }
function rsEncode(data: number[], n: number) { const g = rsGenerator(n), r = new Array(n).fill(0); for (const d of data) { const f = d ^ r[0]; r.shift(); r.push(0); for (let i = 0; i < n; i++) r[i] ^= gmul(g[i + 1], f); } return r; }

function bchFormat(ec: string, mask: number) {
  const ecb = { L: 1, M: 0, Q: 3, H: 2 }[ec]!; const d = (ecb << 3) | mask; let v = d << 10;
  for (let i = 14; i >= 10; i--) if (v & (1 << i)) v ^= 0x537 << (i - 10);
  return ((d << 10) | v) ^ 0x5412;
}
function bchVersion(v: number) { let r = v << 12; for (let i = 17; i >= 12; i--) if (r & (1 << i)) r ^= 0x1f25 << (i - 12); return (v << 12) | r; }

export function encodeQR(text: string, ec: 'L' | 'M' | 'Q' | 'H' = 'M'): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 0;
  const dataCw = (v: number) => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[ec][v - 1] * NUM_BLOCKS[ec][v - 1];
  for (let v = 1; v <= 20; v++) { if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCw(v) * 8) { ver = v; break; } }
  if (!ver) throw new Error('El texto es demasiado largo para un código QR (máximo unos 800 caracteres)');
  const dataCap = dataCw(ver), ecn = ECC_PER_BLOCK[ec][ver - 1], nb = NUM_BLOCKS[ec][ver - 1], raw = Math.floor(rawModules(ver) / 8);
  // flujo de bits: modo byte (0100), longitud, datos, terminador y relleno
  const bits: number[] = []; const put = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); for (const b of bytes) put(b, 8);
  for (let i = 0; i < 4 && bits.length < dataCap * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data: number[] = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let i = 0; data.length < dataCap; i++) data.push(i % 2 ? 0x11 : 0xec);
  // bloques (los primeros, uno más cortos) con su corrección de errores, intercalados
  const nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), blocks: number[][] = [], ecs: number[][] = [];
  for (let i = 0, k = 0; i < nb; i++) { const n = shortLen - ecn + (i < nShort ? 0 : 1), blk = data.slice(k, k + n); k += n; blocks.push(blk); ecs.push(rsEncode(blk, ecn)); }
  const final: number[] = [];
  for (let i = 0; i <= shortLen - ecn; i++) for (const b of blocks) if (i < b.length) final.push(b[i]);
  for (let i = 0; i < ecn; i++) for (const e of ecs) final.push(e[i]);
  // matriz
  const N = ver * 4 + 17, M: (boolean | null)[][] = Array.from({ length: N }, () => new Array(N).fill(null)), fixed: boolean[][] = Array.from({ length: N }, () => new Array(N).fill(false));
  const set = (r: number, c: number, v: boolean) => { M[r][c] = v; fixed[r][c] = true; };
  const finder = (r: number, c: number) => { for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) { const y = r + i, x = c + j; if (y < 0 || x < 0 || y >= N || x >= N) continue; const on = i >= 0 && i <= 6 && j >= 0 && j <= 6 && (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4)); set(y, x, on); } };
  finder(0, 0); finder(0, N - 7); finder(N - 7, 0);
  for (let i = 8; i < N - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const al = ALIGN[ver - 1];
  const last = al.length - 1;
  al.forEach((r, ri) => al.forEach((c, ci) => { if ((ri === 0 && ci === 0) || (ri === 0 && ci === last) || (ri === last && ci === 0)) return; for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) set(r + i, c + j, Math.max(Math.abs(i), Math.abs(j)) !== 1); }));
  // reservar zonas de formato y versión
  for (let i = 0; i < 9; i++) { if (!fixed[8][i]) set(8, i, false); if (!fixed[i][8]) set(i, 8, false); }
  for (let i = 0; i < 8; i++) { set(8, N - 1 - i, false); set(N - 1 - i, 8, false); }
  if (ver >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { set(i, N - 11 + j, false); set(N - 11 + j, i, false); }
  set(N - 8, 8, true); // módulo oscuro (siempre negro)
  // colocar los datos en zigzag
  const dbits: number[] = []; for (const b of final) for (let i = 7; i >= 0; i--) dbits.push((b >> i) & 1);
  let k = 0;
  for (let c = N - 1; c > 0; c -= 2) {
    if (c === 6) c--;
    for (let n = 0; n < N; n++) for (let j = 0; j < 2; j++) {
      const x = c - j, up = ((c + 1) & 2) === 0, y = up ? N - 1 - n : n;
      if (fixed[y][x]) continue; M[y][x] = k < dbits.length ? dbits[k++] === 1 : false;
    }
  }
  // máscara: se prueba cada una y se queda la de menor penalización
  const masks = [(r: number, c: number) => (r + c) % 2 === 0, (r: number) => r % 2 === 0, (_: number, c: number) => c % 3 === 0, (r: number, c: number) => (r + c) % 3 === 0, (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r: number, c: number) => (r * c) % 2 + (r * c) % 3 === 0, (r: number, c: number) => ((r * c) % 2 + (r * c) % 3) % 2 === 0, (r: number, c: number) => ((r + c) % 2 + (r * c) % 3) % 2 === 0];
  let best: boolean[][] | null = null, bestScore = Infinity;
  for (let mi = 0; mi < 8; mi++) {
    const G = M.map((row, r) => row.map((v, c) => fixed[r][c] ? !!v : (!!v) !== masks[mi](r, c)));
    const f = bchFormat(ec, mi);
    const fb = (i: number) => ((f >> i) & 1) === 1;
    // primera copia, alrededor del cuadro de arriba a la izquierda
    for (let i = 0; i <= 5; i++) G[i][8] = fb(i);
    G[7][8] = fb(6); G[8][8] = fb(7); G[8][7] = fb(8);
    for (let i = 9; i < 15; i++) G[8][14 - i] = fb(i);
    // segunda copia, repartida entre los otros dos cuadros
    for (let i = 0; i < 8; i++) G[8][N - 1 - i] = fb(i);
    for (let i = 8; i < 15; i++) G[N - 15 + i][8] = fb(i);
    if (ver >= 7) { const vb = bchVersion(ver); for (let i = 0; i < 18; i++) { const bit = ((vb >> i) & 1) === 1, a = Math.floor(i / 3), b = N - 11 + (i % 3); G[a][b] = bit; G[b][a] = bit; } }
    const s = penalty(G);
    if (s < bestScore) { bestScore = s; best = G; }
  }
  return best!;
}
function penalty(G: boolean[][]) {
  const N = G.length; let s = 0;
  for (let r = 0; r < N; r++) for (const dir of [0, 1]) { let run = 1; for (let c = 1; c < N; c++) { const a = dir ? G[c][r] : G[r][c], b = dir ? G[c - 1][r] : G[r][c - 1]; if (a === b) run++; else { if (run >= 5) s += run - 2; run = 1; } } if (run >= 5) s += run - 2; }
  for (let r = 0; r < N - 1; r++) for (let c = 0; c < N - 1; c++) { const v = G[r][c]; if (v === G[r][c + 1] && v === G[r + 1][c] && v === G[r + 1][c + 1]) s += 3; }
  let dark = 0; for (const row of G) for (const v of row) if (v) dark++;
  s += Math.floor(Math.abs(dark * 100 / (N * N) - 50) / 5) * 10;
  return s;
}
