// Deja la aplicación construida donde hace falta:
//  - app/Editor.html      → para abrir con doble clic
//  - index.html (raíz)    → lo que sirve GitHub Pages
//  - manifest, icono y service worker en la raíz → instalación y uso sin conexión
import { renameSync, copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
if (existsSync('app/index.html')) renameSync('app/index.html', 'app/Editor.html');
copyFileSync('app/Editor.html', 'index.html');
for (const f of ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'privacidad.html']) copyFileSync('public/' + f, f);
// El service worker lleva la fecha de construcción para renovar la caché en cada versión
writeFileSync('sw.js', readFileSync('public/sw.js', 'utf8').replace('__BUILD__', new Date().toISOString()));
writeFileSync('.nojekyll', '');
// la política de privacidad también junto a app/Editor.html (para el enlace de «Acerca de»)
copyFileSync('public/privacidad.html', 'app/privacidad.html');
// idiomas: un archivo por idioma (solo se descarga el elegido), junto a index.html y a app/Editor.html
const keys = JSON.parse(readFileSync('src/i18n/data/keys.json', 'utf8'));
for (const dir of ['i18n', 'app/i18n']) mkdirSync(dir, { recursive: true });
for (const f of readdirSync('src/i18n/data')) {
  if (f === 'keys.json') continue;
  const l = f.replace('.json', ''), vals = JSON.parse(readFileSync('src/i18n/data/' + f, 'utf8')), d = { s: {}, t: [] };
  keys.forEach((k, i) => { const v = vals[i]; if (!v) return; if (k.startsWith('T:')) d.t.push([k.slice(2), v]); else d.s[k] = v; });
  const js = `(window.__editorI18n=window.__editorI18n||{})[${JSON.stringify(l)}]=${JSON.stringify(d)};`;
  for (const dir of ['i18n', 'app/i18n']) writeFileSync(`${dir}/${l}.js`, js);
}
console.log('Listo: app/Editor.html e index.html');
