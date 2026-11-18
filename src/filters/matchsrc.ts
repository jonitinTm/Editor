// Fuentes para «Igualar color»: los demás documentos abiertos y las otras capas del documento.
// Cada opción lleva ya calculadas las estadísticas de color, así el filtro no depende de la interfaz
// (funciona igual en segundo plano y como filtro inteligente).

import { app } from '../ui/app';
import { FILTERS } from './registry';
import { labStats } from './matchcolor';
import { ctx2d, makeCanvas } from '../core/canvas';
import { isRaster } from '../core/layers';

function statsOf(c: HTMLCanvasElement) {
  // basta una copia reducida para medir los colores
  const k = Math.min(1, 600 / Math.max(c.width, c.height)), w = Math.max(1, Math.round(c.width * k)), h = Math.max(1, Math.round(c.height * k));
  const t = makeCanvas(w, h); ctx2d(t).drawImage(c, 0, 0, w, h);
  const st = labStats(ctx2d(t).getImageData(0, 0, w, h));
  return JSON.stringify({ mean: st.mean.map(v => +v.toFixed(3)), std: st.std.map(v => +v.toFixed(3)) });
}

const def = FILTERS.find(f => f.id === 'matchcolor');
if (def) def.prepare = () => {
  const par = def.params?.find(p => p.key === 'source') as any; if (!par) return;
  const ch: [string, string][] = [['', '(ninguna: solo neutralizar)']];
  for (const d of app.docs) if (d !== app.doc) ch.push([statsOf(d.getComposite()), `Documento: ${d.name}`]);
  const cur = app.doc;
  if (cur) for (const l of cur.allLayers().slice(0, 40)) if (l !== cur.active && isRaster(l) && l.visible) ch.push([statsOf(l.canvas), `Capa: ${l.name}`]);
  par.choices = ch;
  par.default = ch[1]?.[0] ?? '';
};
