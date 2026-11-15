// Renombra app/index.html a app/Editor.html para que sea fácil de encontrar.
import { renameSync, existsSync } from 'node:fs';
if (existsSync('app/index.html')) renameSync('app/index.html', 'app/Editor.html');
console.log('Listo: app/Editor.html');
