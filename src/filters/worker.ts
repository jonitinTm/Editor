// Hilo de fondo para los filtros: así la ventana sigue respondiendo mientras calcula.

import { FILTERS, setFilterImpls } from './registry';
import * as N from './more2';
import * as R from './artistic';
import * as R2 from './render2';
import * as G from './gallery';
import * as RT from './retouch';
// en el hilo de fondo los filtros de efectos van incluidos (no retrasan el arranque de la app)
setFilterImpls({ N, R, R2, G, RT });
import { computeFilter } from './compute';

interface Session { orig: ImageData; sel: Uint8ClampedArray | null; filterId: string; isMask: boolean; lockAlpha: boolean; }
const sessions = new Map<number, Session>();

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') {
    sessions.set(m.session, { orig: new ImageData(new Uint8ClampedArray(m.data), m.w, m.h), sel: m.sel ? new Uint8ClampedArray(m.sel) : null, filterId: m.filterId, isMask: m.isMask, lockAlpha: m.lockAlpha });
  } else if (m.type === 'end') sessions.delete(m.session);
  else if (m.type === 'run') {
    // Solo se calcula el último encargo de cada sesión: si el usuario sigue moviendo
    // el deslizador, los intermedios se descartan.
    pending.set(m.session, m);
    if (!scheduled) { scheduled = true; setTimeout(work, 0); }
  }
};
const pending = new Map<number, any>();
let scheduled = false;
function work() {
  scheduled = false;
  for (const [id, m] of pending) {
    pending.delete(id);
    const s = sessions.get(id); if (!s) continue;
    const def = FILTERS.find(f => f.id === s.filterId); if (!def) continue;
    const out = computeFilter(s.orig, s.sel, def.apply, m.params, s.isMask, s.lockAlpha);
    (self as any).postMessage({ session: id, job: m.job, data: out.data.buffer }, [out.data.buffer]);
  }
}
