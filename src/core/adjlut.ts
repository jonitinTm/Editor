// Capas de ajuste rápidas: los ajustes que cambian cada píxel solo según su color (brillo, curvas, tono/saturación…)
// se resumen en una tabla de color 3D. Varios ajustes seguidos se juntan en una sola tabla y se aplican de una vez,
// con la tarjeta gráfica (WebGL2) si la hay, o en una sola pasada por el procesador.
// Así, 6 capas de ajuste cuestan casi lo mismo que una.

import type { FilterDef } from '../filters/registry';
import { makeCanvas, ctx2d } from './canvas';

/** Ajustes que dependen solo del color de cada píxel (comprobado en las pruebas). Umbral y posterizar no: tienen saltos bruscos. */
export const POINTWISE = new Set(['brightness', 'levels', 'curves', 'huesat', 'bw', 'desaturate', 'invert', 'exposure', 'vibrance', 'colorbalance', 'mixer', 'gradmap', 'photofilter', 'selcolor', 'colorlookup', 'duotone', 'variations']);

/** Puntos por lado de la tabla (65 → cada casilla abarca 4 niveles: el error es de ±1). */
const N = 65;
export type LutStep = { def: FilterDef; params: any; opacity: number };

const cache = new Map<string, Uint8Array>();
/** Tabla de color (RGBA, N³) del resultado de aplicar los ajustes en orden a todos los colores. */
export function buildLut(steps: LutStep[]): Uint8Array {
  const key = steps.map(s => s.def.id + ':' + s.opacity + ':' + JSON.stringify(s.params)).join('|');
  const hit = cache.get(key); if (hit) return hit;
  const n3 = N * N * N, img = new ImageData(N * N, N), d = img.data;
  for (let b = 0, i = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++, i += 4) {
    d[i] = Math.round(r * 255 / (N - 1)); d[i + 1] = Math.round(g * 255 / (N - 1)); d[i + 2] = Math.round(b * 255 / (N - 1)); d[i + 3] = 255;
  }
  for (const s of steps) {
    const orig = s.opacity < 1 ? new Uint8ClampedArray(d) : null;
    s.def.apply(img, s.params);
    if (orig) for (let i = 0; i < d.length; i += 4) { const k = s.opacity; d[i] = orig[i] + (d[i] - orig[i]) * k; d[i + 1] = orig[i + 1] + (d[i + 1] - orig[i + 1]) * k; d[i + 2] = orig[i + 2] + (d[i + 2] - orig[i + 2]) * k; }
  }
  const out = new Uint8Array(n3 * 4); out.set(d);
  if (cache.size > 24) cache.clear();
  cache.set(key, out); return out;
}

// ---- Tarjeta gráfica --------------------------------------------------------------------------
type GL = { gl: WebGL2RenderingContext; canvas: HTMLCanvasElement; prog: WebGLProgram; src: WebGLTexture; mask: WebGLTexture; lut: WebGLTexture; lutKey: Uint8Array | null; tile: number; u: Record<string, WebGLUniformLocation | null> };
let G: GL | null | undefined;
/** Desactivar a mano (pruebas) o si la tarjeta falla. */
export const adjGpu = { enabled: true, used: 0, /** usarla aunque sea una emulación por software (pruebas) */ force: false, software: false };
function gpu(): GL | null {
  if (G !== undefined) return G && !G.gl.isContextLost() ? G : null;
  G = null;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false });
    if (!gl) return null;
    // una «gráfica» emulada por software es más lenta que el procesador: entonces no se usa
    const dbg = gl.getExtension('WEBGL_debug_renderer_info'), ren = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    adjGpu.software = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(ren);
    const sh = (t: number, src: string) => { const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader'); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, `#version 300 es
in vec2 p; out vec2 uv; void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float; precision highp sampler3D;
uniform sampler2D src; uniform sampler2D msk; uniform sampler3D lut; uniform float useMask; uniform float opacity;
in vec2 uv; out vec4 o;
void main() {
  vec4 c = texture(src, uv);
  vec3 q = c.rgb * ${((N - 1) / N).toFixed(8)} + ${(0.5 / N).toFixed(8)};
  vec3 r = texture(lut, q).rgb;
  float k = opacity * (useMask > 0.5 ? texture(msk, uv).a : 1.0);
  o = vec4(mix(c.rgb, r, k), c.a);
}`));
    gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex2 = () => { const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; };
    gl.activeTexture(gl.TEXTURE0); const src = tex2();
    gl.activeTexture(gl.TEXTURE1); const mask = tex2();
    gl.activeTexture(gl.TEXTURE2); const lut = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_3D, lut);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
    const u: GL['u'] = {}; for (const n of ['src', 'msk', 'lut', 'useMask', 'opacity']) u[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(u.src, 0); gl.uniform1i(u.msk, 1); gl.uniform1i(u.lut, 2);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const tile = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    canvas.addEventListener('webglcontextlost', () => { G = undefined; });
    G = { gl, canvas, prog, src, mask, lut, lutKey: null, tile, u };
  } catch { G = null; }
  return G;
}

/** Aplica una tabla de color a la zona (x, y, w, h) de `ctx` (con máscara y opacidad opcionales). Devuelve false si no se pudo con la gráfica. */
function applyGpu(ctx: CanvasRenderingContext2D, lut: Uint8Array, x: number, y: number, w: number, h: number, mask: HTMLCanvasElement | null, opacity: number): boolean {
  const g = adjGpu.enabled ? gpu() : null; if (!g || (adjGpu.software && !adjGpu.force)) return false;
  const { gl } = g;
  try {
    if (g.lutKey !== lut) { gl.activeTexture(gl.TEXTURE2); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, N, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); g.lutKey = lut; }
    gl.uniform1f(g.u.useMask, mask ? 1 : 0); gl.uniform1f(g.u.opacity, opacity);
    const T = g.tile, tmp = makeCanvas(1, 1), tc = ctx2d(tmp), mtmp = mask ? makeCanvas(1, 1) : null;
    for (let ty = y; ty < y + h; ty += T) for (let tx = x; tx < x + w; tx += T) {
      const tw = Math.min(T, x + w - tx), th = Math.min(T, y + h - ty);
      if (tmp.width !== tw || tmp.height !== th) { tmp.width = tw; tmp.height = th; } else tc.clearRect(0, 0, tw, th);
      tc.globalCompositeOperation = 'copy'; tc.drawImage(ctx.canvas, tx, ty, tw, th, 0, 0, tw, th);
      gl.activeTexture(gl.TEXTURE0); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tmp);
      if (mask && mtmp) {
        mtmp.width = tw; mtmp.height = th; ctx2d(mtmp).drawImage(mask, tx, ty, tw, th, 0, 0, tw, th);
        gl.activeTexture(gl.TEXTURE1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mtmp);
      }
      if (g.canvas.width !== tw || g.canvas.height !== th) { g.canvas.width = tw; g.canvas.height = th; }
      gl.viewport(0, 0, tw, th); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      ctx.save(); ctx.globalCompositeOperation = 'copy'; ctx.beginPath(); ctx.rect(tx, ty, tw, th); ctx.clip(); ctx.globalAlpha = 1; ctx.drawImage(g.canvas, tx, ty); ctx.restore();
    }
    adjGpu.used++;
    return !gl.isContextLost();
  } catch { G = null; return false; }
}

/** Lo mismo con el procesador: una sola lectura de la imagen y una pasada (interpolación tetraédrica: 4 lecturas por píxel). */
function applyCpu(ctx: CanvasRenderingContext2D, lut: Uint8Array, x: number, y: number, w: number, h: number, mask: HTMLCanvasElement | null, opacity: number) {
  const img = ctx.getImageData(x, y, w, h), d = img.data, m = mask ? ctx2d(mask).getImageData(x, y, w, h).data : null;
  const S = (N - 1) / 255, SR = 4, SG = N * 4, SB = N * N * 4, last = N - 1;
  let pr = -1, pg = -1, pb = -1, or = 0, og = 0, ob = 0; // el último color (en zonas lisas se repite mucho)
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const k = m ? opacity * m[i + 3] / 255 : opacity; if (k <= 0) continue;
    const R = d[i], Gc = d[i + 1], B = d[i + 2];
    if (R !== pr || Gc !== pg || B !== pb) {
      pr = R; pg = Gc; pb = B;
      const fr = R * S, fg = Gc * S, fb = B * S;
      let r0 = fr | 0, g0 = fg | 0, b0 = fb | 0; if (r0 === last) r0--; if (g0 === last) g0--; if (b0 === last) b0--;
      const dr = fr - r0, dg = fg - g0, db = fb - b0, o = b0 * SB + g0 * SG + r0 * SR;
      // tetraedro según el orden de dr, dg, db
      let s1, s2, w0, w1, w2, w3;
      if (dr >= dg) {
        if (dg >= db) { s1 = SR; s2 = SR + SG; w0 = 1 - dr; w1 = dr - dg; w2 = dg - db; w3 = db; }
        else if (dr >= db) { s1 = SR; s2 = SR + SB; w0 = 1 - dr; w1 = dr - db; w2 = db - dg; w3 = dg; }
        else { s1 = SB; s2 = SB + SR; w0 = 1 - db; w1 = db - dr; w2 = dr - dg; w3 = dg; }
      } else {
        if (db >= dg) { s1 = SB; s2 = SB + SG; w0 = 1 - db; w1 = db - dg; w2 = dg - dr; w3 = dr; }
        else if (db >= dr) { s1 = SG; s2 = SG + SB; w0 = 1 - dg; w1 = dg - db; w2 = db - dr; w3 = dr; }
        else { s1 = SG; s2 = SG + SR; w0 = 1 - dg; w1 = dg - dr; w2 = dr - db; w3 = db; }
      }
      const a = o, b = o + s1, c = o + s2, e = o + SR + SG + SB;
      or = lut[a] * w0 + lut[b] * w1 + lut[c] * w2 + lut[e] * w3;
      og = lut[a + 1] * w0 + lut[b + 1] * w1 + lut[c + 1] * w2 + lut[e + 1] * w3;
      ob = lut[a + 2] * w0 + lut[b + 2] * w1 + lut[c + 2] * w2 + lut[e + 2] * w3;
    }
    if (k >= 1) { d[i] = or; d[i + 1] = og; d[i + 2] = ob; }
    else { d[i] = R + (or - R) * k; d[i + 1] = Gc + (og - Gc) * k; d[i + 2] = B + (ob - B) * k; }
  }
  ctx.putImageData(img, x, y);
}

/** Aplica una tanda de ajustes «de color» seguidos a la zona indicada. */
export function applyLutSteps(ctx: CanvasRenderingContext2D, steps: LutStep[], x: number, y: number, w: number, h: number, mask: HTMLCanvasElement | null = null) {
  // con máscara, la opacidad se mezcla aparte (junto con la máscara); sin ella, va dentro de la tabla
  const opacity = mask ? steps[0].opacity : 1;
  const lut = buildLut(mask ? steps.map(s => ({ ...s, opacity: 1 })) : steps);
  if (!applyGpu(ctx, lut, x, y, w, h, mask, opacity)) applyCpu(ctx, lut, x, y, w, h, mask, opacity);
}
