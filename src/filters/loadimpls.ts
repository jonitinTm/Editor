// Carga, al usarlos, los filtros de efectos (artísticos, galería, interpretar…) y se los pasa al catálogo.
// Va aparte del catálogo para que el hilo de fondo de los filtros (que los importa directamente) no tenga cargas
// diferidas.
import { setFilterImpls } from './registry';
let p: Promise<void> | null = null;
export function loadFilterImpls(): Promise<void> {
  return p ??= Promise.all([import('./more2'), import('./artistic'), import('./render2'), import('./gallery'), import('./retouch')])
    .then(([N, R, R2, G, RT]) => setFilterImpls({ N, R, R2, G, RT }));
}
