// Módulos que se cargan la primera vez que se usan (no al abrir la app). lazyModule(() => import('./x')) devuelve
// un objeto con las mismas funciones: la primera llamada espera a que el módulo esté (devuelve una promesa) y las
// siguientes van directas. preload() lo carga ya (por ejemplo, cuando la app está libre).
export function lazyModule<T extends object>(load: () => Promise<T>): T & { preload: () => Promise<T> } {
  let mod: T | null = null, p: Promise<T> | null = null;
  const get = () => (p ??= load().then(m => (mod = m)));
  return new Proxy({} as any, {
    get: (_t, k: string) => k === 'preload' ? get : (...a: any[]) => mod ? (mod as any)[k](...a) : get().then(m => (m as any)[k](...a)),
  });
}
