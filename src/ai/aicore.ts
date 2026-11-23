// Núcleo de la IA: carga transformers.js y ejecuta los modelos. No toca la interfaz ni el DOM, así que
// funciona igual en el hilo de fondo (aiworker.ts, lo normal) que en la ventana (si el navegador no
// permite el hilo). Recibe y devuelve píxeles en bruto (RGBA), nunca lienzos.

const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
export type ModelKey = 'bg' | 'sam' | 'depth' | 'up2' | 'up4';
export const MODEL_IDS: Record<ModelKey, { id: string; dtype: string }> = {
  bg: { id: 'onnx-community/ormbg-ONNX', dtype: 'uint8' },
  sam: { id: 'Xenova/slimsam-77-uniform', dtype: 'q8' },
  depth: { id: 'onnx-community/depth-anything-v2-small', dtype: 'uint8' },
  up2: { id: 'Xenova/swin2SR-lightweight-x2-64', dtype: 'uint8' },
  up4: { id: 'Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr', dtype: 'uint8' },
};
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
  throw new Error('Operación desconocida: ' + op);
}
