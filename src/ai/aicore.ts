// Núcleo de la IA: carga transformers.js y ejecuta los modelos. No toca la interfaz ni el DOM, así que
// funciona igual en el hilo de fondo (aiworker.ts, lo normal) que en la ventana (si el navegador no
// permite el hilo). Recibe y devuelve píxeles en bruto (RGBA), nunca lienzos.

const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
export type ModelKey = 'bg' | 'sam' | 'depth' | 'up2' | 'up4' | 'erase';
export const MODEL_IDS: Record<ModelKey, { id: string; dtype: string }> = {
  bg: { id: 'onnx-community/ormbg-ONNX', dtype: 'uint8' },
  sam: { id: 'Xenova/slimsam-77-uniform', dtype: 'q8' },
  depth: { id: 'onnx-community/depth-anything-v2-small', dtype: 'uint8' },
  up2: { id: 'Xenova/swin2SR-lightweight-x2-64', dtype: 'uint8' },
  up4: { id: 'Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr', dtype: 'uint8' },
  // MI-GAN (Picsart AI Research, licencia MIT): borrar objetos y rellenar huecos
  erase: { id: 'andraniksargsyan/migan', dtype: 'uint8' },
};
const MIGAN_URL = 'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx';
// el mismo motor ONNX (y la misma versión) que usa transformers.js: sus archivos se comparten en la caché del navegador
const ORT_DIR = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/';
export type Prog = (e: { status: string; file?: string; loaded?: number; total?: number }) => void;
export class LoadError extends Error {}

let T: any = null;
async function lib() {
  if (T) return T;
  try { T = await import(/* @vite-ignore */ TJS); }
  catch { throw new LoadError('No se pudo cargar el motor de IA. Comprueba tu conexión a internet (solo hace falta la primera vez).'); }
  T.env.allowLocalModels = false; T.env.useBrowserCache = true;
  return T;
}
let gpu: boolean | null = null;
export async function hasGPU() {
  if (gpu === null) { try { const g = (navigator as any).gpu; gpu = !!g && !!(await g.requestAdapter()); } catch { gpu = false; } }
  return gpu;
}
const dev = async () => (await hasGPU()) ? 'webgpu' : 'wasm';
/** Carga un modelo probando primero la tarjeta gráfica y, si falla, el procesador. */
async function load<R>(fn: (device: string) => Promise<R>): Promise<R> {
  const d = await dev();
  try { return await fn(d); } catch (e) { if (d === 'webgpu') { gpu = false; return fn('wasm'); } throw e; }
}
const pipes = new Map<string, any>();
async function pipe(k: ModelKey, task: string, prog: Prog) {
  if (pipes.has(k)) return pipes.get(k);
  const t = await lib(), m = MODEL_IDS[k];
  const p = await load(device => t.pipeline(task, m.id, { dtype: m.dtype, device, progress_callback: prog }));
  pipes.set(k, p); return p;
}
const raw = async (data: ArrayBuffer, w: number, h: number) => new (await lib()).RawImage(new Uint8ClampedArray(data), w, h, 4);

let ORT: any = null;
async function ort() {
  if (ORT) return ORT;
  try { ORT = await import(/* @vite-ignore */ ORT_DIR + 'ort.webgpu.min.mjs'); }
  catch { throw new LoadError('No se pudo cargar el motor de IA. Comprueba tu conexión a internet (solo hace falta la primera vez).'); }
  ORT.env.wasm.wasmPaths = ORT_DIR; return ORT;
}
/** Descarga un modelo (con progreso) y lo guarda para usarlo sin conexión. */
async function fetchModel(url: string, prog: Prog): Promise<Uint8Array> {
  let cache: Cache | null = null;
  // «ai-models» no empieza por «editor-», así que el service worker no la borra al actualizar la app
  try { cache = await caches.open('ai-models'); const hit = await cache.match(url); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch { cache = null; }
  const r = await fetch(url); if (!r.ok || !r.body) throw new Error('No se pudo descargar el modelo (' + r.status + ')');
  const total = +(r.headers.get('content-length') || 0), rd = r.body.getReader(), parts: Uint8Array[] = []; let loaded = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); loaded += value.length; prog({ status: 'progress', file: url, loaded, total: total || loaded }); }
  const buf = new Uint8Array(loaded); let o = 0; for (const q of parts) { buf.set(q, o); o += q.length; }
  try { await cache?.put(url, new Response(buf)); } catch { /* sin espacio: se usará sin guardar */ }
  return buf;
}
let migan: any = null;

let samParts: { model: any; proc: any } | null = null;
let samEmb: { key: string; emb: any; img: any } | null = null;

export interface Pixels { data: ArrayBuffer; w: number; h: number }
/** Resultado: un canal o varios, de tamaño w×h. */
export interface Out { data: ArrayBuffer; w: number; h: number; channels: number }
const outOf = (img: any): Out => { const a = img.data instanceof Uint8Array || img.data instanceof Uint8ClampedArray ? img.data : Uint8Array.from(img.data); const c = new Uint8Array(a.length); c.set(a); return { data: c.buffer, w: img.width, h: img.height, channels: img.channels }; };

export async function run(op: string, a: any, prog: Prog): Promise<Out> {
  if (op === 'bg') {
    const seg = await pipe('bg', 'background-removal', prog); prog({ status: 'run' });
    const o = (await seg([await raw(a.data, a.w, a.h)]))[0]; return outOf(o);
  }
  if (op === 'depth') {
    const de = await pipe('depth', 'depth-estimation', prog); prog({ status: 'run' });
    return outOf((await de(await raw(a.data, a.w, a.h))).depth);
  }
  if (op === 'up2' || op === 'up4') {
    const up = await pipe(op, 'image-to-image', prog); prog({ status: 'run' });
    return outOf(await up(await raw(a.data, a.w, a.h)));
  }
  if (op === 'sam') {
    const t = await lib();
    if (!samParts) {
      const m = MODEL_IDS.sam;
      const model = await load(device => t.SamModel.from_pretrained(m.id, { dtype: m.dtype, device, progress_callback: prog }));
      samParts = { model, proc: await t.AutoProcessor.from_pretrained(m.id, { progress_callback: prog }) };
    }
    prog({ status: 'run' });
    const { model, proc } = samParts;
    // la imagen se analiza una sola vez; cada clic después es casi instantáneo
    if (samEmb?.key !== a.key) {
      const img = await raw(a.data, a.w, a.h), inputs = await proc(img);
      samEmb = { key: a.key, emb: await model.get_image_embeddings(inputs), img };
    }
    const se = samEmb!, inputs = await proc(se.img, { input_points: [[a.points]], input_labels: [[a.labels]] });
    const out = await model({ ...se.emb, input_points: inputs.input_points, input_labels: inputs.input_labels });
    const masks = await proc.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
    const scores = Array.from(out.iou_scores.data as Float32Array), best = scores.indexOf(Math.max(...scores));
    const m = masks[0], [, , mh, mw] = m.dims, plane = mh * mw, r = new Uint8Array(plane);
    for (let i = 0; i < plane; i++) r[i] = m.data[best * plane + i] ? 255 : 0;
    return { data: r.buffer, w: mw, h: mh, channels: 1 };
  }
  if (op === 'erase') {
    const o = await ort();
    if (!migan) { const buf = await fetchModel(MIGAN_URL, prog); prog({ status: 'ready' }); migan = await o.InferenceSession.create(buf, { executionProviders: ['wasm'] }); }
    prog({ status: 'run' });
    const W = a.w, H = a.h, px = new Uint8Array(a.data), chw = new Uint8Array(3 * W * H);
    for (let i = 0; i < W * H; i++) { chw[i] = px[i * 4]; chw[W * H + i] = px[i * 4 + 1]; chw[2 * W * H + i] = px[i * 4 + 2]; }
    // máscara: 255 = se conserva, 0 = hueco a rellenar
    const res = await migan.run({ image: new o.Tensor('uint8', chw, [1, 3, H, W]), mask: new o.Tensor('uint8', new Uint8Array(a.mask), [1, 1, H, W]) });
    const r = (res.result ?? Object.values(res)[0]).data as Uint8Array, out = new Uint8Array(W * H * 3);
    for (let i = 0; i < W * H; i++) { out[i * 3] = r[i]; out[i * 3 + 1] = r[W * H + i]; out[i * 3 + 2] = r[2 * W * H + i]; }
    return { data: out.buffer, w: W, h: H, channels: 3 };
  }
  throw new Error('Operación desconocida: ' + op);
}
