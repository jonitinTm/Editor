// Deja la aplicación construida donde hace falta:
//  - app/Editor.html      → para abrir con doble clic
//  - index.html (raíz)    → lo que sirve GitHub Pages
//  - manifest, icono y service worker en la raíz → instalación y uso sin conexión
import { execSync } from 'node:child_process';
import { renameSync, copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
if (existsSync('app/index.html')) renameSync('app/index.html', 'app/Editor.html');
// la web (raíz) usa la compilación en partes (web-build/): index.html + assets/ (si no existe, la de un archivo)
let assets = [];
if (existsSync('web-build/index.html')) {
  copyFileSync('web-build/index.html', 'index.html');
  // se conservan también las partes de la versión anterior: una pestaña que siga abierta con ella (el móvil las
  // guarda en memoria) puede seguir cargando sus ventanas en vez de fallar. Solo la anterior, para no acumular.
  const LIST = 'assets/.versiones.json', fresh = readdirSync('web-build/assets');
  mkdirSync('assets', { recursive: true });
  // «anterior» = la versión publicada (la del último commit), no la de la última compilación local: así se puede
  // compilar varias veces seguidas sin borrar lo que usa una pestaña abierta con la versión publicada
  let prev = [];
  try { prev = JSON.parse(execSync('git show HEAD:' + LIST, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).actual ?? []; }
  catch { try { prev = JSON.parse(readFileSync(LIST, 'utf8')).actual ?? []; } catch { prev = readdirSync('assets').filter(f => !f.startsWith('.')); } }
  // si alguna parte publicada falta en la carpeta (se borró en una compilación anterior), se recupera del commit
  for (const f of prev) if (!existsSync('assets/' + f)) try { writeFileSync('assets/' + f, execSync('git show HEAD:assets/' + f, { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 })); } catch { /* no estaba publicada */ }
  for (const f of readdirSync('assets')) if (!f.startsWith('.') && !fresh.includes(f) && !prev.includes(f)) rmSync('assets/' + f, { force: true });
  for (const f of fresh) { copyFileSync('web-build/assets/' + f, 'assets/' + f); assets.push('./assets/' + f); }
  writeFileSync(LIST, JSON.stringify({ actual: fresh, anterior: prev.filter(f => !fresh.includes(f)) }));
} else copyFileSync('app/Editor.html', 'index.html');
for (const f of ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'privacidad.html']) copyFileSync('public/' + f, f);
// El service worker lleva la fecha de construcción para renovar la caché en cada versión
// …y la lista de partes de la web, para guardarlas todas al instalarse (y poder usarlo todo sin conexión)
writeFileSync('sw.js', readFileSync('public/sw.js', 'utf8').replace('__BUILD__', new Date().toISOString()).replace("'__ASSETS__'", assets.map(a => JSON.stringify(a)).join(', ') || "'./'"));
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
