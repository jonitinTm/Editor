// Texto con varios estilos: tramos [inicio, fin) del texto con su propio color, fuente, tamaño,
// negrita, cursiva, subrayado o tachado. Lo que un tramo no indica se toma del estilo de la capa.

export interface TextRun { start: number; end: number; color?: string; font?: string; size?: number; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean }
export type RunStyle = Omit<TextRun, 'start' | 'end'>;
const KEYS = ['color', 'font', 'size', 'bold', 'italic', 'underline', 'strike'] as const;

const same = (a: RunStyle, b: RunStyle) => KEYS.every(k => a[k] === b[k]);
const styleOf = (r: TextRun): RunStyle => { const s: any = {}; for (const k of KEYS) if (r[k] !== undefined) s[k] = r[k]; return s; };

/** Ordena, quita vacíos y une tramos vecinos iguales. */
export function normalizeRuns(runs: TextRun[], len: number): TextRun[] {
  const out: TextRun[] = [];
  for (const r of [...runs].sort((a, b) => a.start - b.start)) {
    const s = Math.max(0, Math.min(len, r.start)), e = Math.max(s, Math.min(len, r.end));
    if (e <= s || !KEYS.some(k => r[k] !== undefined)) continue;
    const last = out[out.length - 1];
    if (last && last.end === s && same(styleOf(last), styleOf(r))) last.end = e; else out.push({ ...r, start: s, end: e });
  }
  return out;
}

/** Aplica un estilo a [a, b) (lo que ya tuvieran esos caracteres se conserva salvo lo que se cambia). */
export function applyRunStyle(runs: TextRun[], a: number, b: number, style: RunStyle, len: number): TextRun[] {
  if (b <= a) return runs;
  const out: TextRun[] = [];
  // se trocea por los bordes de los tramos y del rango
  const cuts = new Set<number>([0, len, a, b]); for (const r of runs) { cuts.add(r.start); cuts.add(r.end); }
  const pts = [...cuts].filter(x => x >= 0 && x <= len).sort((x, y) => x - y);
  for (let i = 0; i < pts.length - 1; i++) {
    const s = pts[i], e = pts[i + 1]; if (e <= s) continue;
    const cur = runs.find(r => r.start <= s && r.end >= e);
    let st: RunStyle = cur ? styleOf(cur) : {};
    if (s >= a && e <= b) st = { ...st, ...style };
    out.push({ start: s, end: e, ...st });
  }
  return normalizeRuns(out, len);
}

/** Ajusta los tramos tras editar el texto (se ha cambiado `oldText` por `newText`). */
export function shiftRuns(runs: TextRun[], oldText: string, newText: string): TextRun[] {
  if (!runs.length) return runs;
  let pre = 0; while (pre < oldText.length && pre < newText.length && oldText[pre] === newText[pre]) pre++;
  let suf = 0; while (suf < oldText.length - pre && suf < newText.length - pre && oldText[oldText.length - 1 - suf] === newText[newText.length - 1 - suf]) suf++;
  const delEnd = oldText.length - suf, ins = newText.length - pre - suf, delta = ins - (delEnd - pre);
  const out: TextRun[] = [];
  for (const r of runs) {
    let s = r.start, e = r.end;
    // lo borrado desaparece del tramo; lo escrito hereda el estilo del carácter anterior
    const mapStart = (x: number) => x <= pre ? x : x >= delEnd ? x + delta : pre;
    const mapEnd = (x: number) => x < pre ? x : x >= delEnd ? x + delta : pre;
    s = mapStart(s); e = mapEnd(e);
    if (r.start < pre && r.end >= pre && r.end <= delEnd) e = pre + ins; // el tramo llega al punto de escritura: crece
    if (r.start < pre && r.end > delEnd) e = r.end + delta;
    out.push({ ...r, start: s, end: e });
  }
  return normalizeRuns(out, newText.length);
}

/** Trozos de una línea [a, b) con estilo uniforme. */
export function segments(runs: TextRun[], a: number, b: number): { a: number; b: number; st: RunStyle }[] {
  const cuts = new Set<number>([a, b]); for (const r of runs) { if (r.start > a && r.start < b) cuts.add(r.start); if (r.end > a && r.end < b) cuts.add(r.end); }
  const pts = [...cuts].sort((x, y) => x - y), out: { a: number; b: number; st: RunStyle }[] = [];
  for (let i = 0; i < pts.length - 1; i++) { const r = runs.find(q => q.start <= pts[i] && q.end >= pts[i + 1]); out.push({ a: pts[i], b: pts[i + 1], st: r ? styleOf(r) : {} }); }
  return out;
}
