import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Genera un único archivo HTML autocontenido. Tras construir, scripts/postbuild.js
// lo deja en dos sitios: app/Editor.html (para abrir con doble clic) e index.html
// en la raíz (lo que publica GitHub Pages).
export default defineConfig({
  root: 'src',
  base: './',
  publicDir: '../public',
  plugins: [viteSingleFile()],
  build: {
    outDir: '../app',
    emptyOutDir: true,
    target: 'es2020',
  },
});
