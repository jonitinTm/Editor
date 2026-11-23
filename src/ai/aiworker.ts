// Hilo de fondo de la IA: los modelos calculan aquí para que la ventana siga respondiendo.
import { run, LoadError } from './aicore';

self.onmessage = async (e: MessageEvent) => {
  const { id, op, a } = e.data;
  const prog = (p: any) => (self as any).postMessage({ id, prog: { status: p.status, file: p.file, loaded: p.loaded, total: p.total } });
  try {
    const out = await run(op, a, prog);
    (self as any).postMessage({ id, out }, [out.data]);
  } catch (err: any) {
    // «fatal»: el hilo no puede cargar el motor (p. ej. el navegador no permite import() en hilos) → se usa la ventana
    (self as any).postMessage({ id, error: String(err?.message ?? err), fatal: err instanceof LoadError });
  }
};
