import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Genera un único archivo HTML autocontenido (app/Editor.html) que se abre
// con doble clic, sin servidor ni conexión a internet.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: 'app',
    emptyOutDir: true,
    target: 'es2020',
  },
});
