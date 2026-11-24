import { defineConfig } from 'vite';
import base from './vite.config';

// Versión web (index.html de la raíz, la que se publica y la que usará la app de Google Play): en varias partes,
// así al abrir solo se descarga y se lee lo necesario; el resto (ventanas, PSD, creación…) cuando se usa.
// La versión de doble clic (app/Editor.html) sigue siendo un único archivo con todo dentro.
export default defineConfig({
  ...base,
  plugins: [],
  build: { outDir: '../web-build', emptyOutDir: true, target: 'es2020', assetsDir: 'assets', modulePreload: { polyfill: false } },
});
