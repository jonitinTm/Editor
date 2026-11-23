import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

// huella de las traducciones: si cambian, los navegadores vuelven a descargar el idioma
const i18nHash = createHash('sha1').update(readdirSync('src/i18n/data').sort().map(f => readFileSync('src/i18n/data/' + f, 'utf8')).join('')).digest('hex').slice(0, 10);

// Genera un único archivo HTML autocontenido. Tras construir, scripts/postbuild.js
// lo deja en dos sitios: app/Editor.html (para abrir con doble clic) e index.html
// en la raíz (lo que publica GitHub Pages).
export default defineConfig({
  root: 'src',
  base: './',
  publicDir: '../public',
  plugins: [viteSingleFile()],
  define: { __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)), __I18N_HASH__: JSON.stringify(i18nHash) },
  build: {
    outDir: '../app',
    emptyOutDir: true,
    target: 'es2020',
  },
});
