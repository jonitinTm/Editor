// Deja la aplicación construida donde hace falta:
//  - app/Editor.html      → para abrir con doble clic
//  - index.html (raíz)    → lo que sirve GitHub Pages
//  - manifest, icono y service worker en la raíz → instalación y uso sin conexión
import { renameSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
if (existsSync('app/index.html')) renameSync('app/index.html', 'app/Editor.html');
copyFileSync('app/Editor.html', 'index.html');
for (const f of ['manifest.webmanifest', 'icon.svg']) copyFileSync('public/' + f, f);
// El service worker lleva la fecha de construcción para renovar la caché en cada versión
writeFileSync('sw.js', readFileSync('public/sw.js', 'utf8').replace('__BUILD__', new Date().toISOString()));
writeFileSync('.nojekyll', '');
console.log('Listo: app/Editor.html e index.html');
