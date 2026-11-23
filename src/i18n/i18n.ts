// Idiomas. El programa está escrito en español; para los demás idiomas hay un diccionario «texto en español → traducción»
// (y plantillas para los textos con partes variables: «Capa {0}», «{0} × {1} px»…). Lo que se ve en pantalla se traduce
// solo: menús, botones, ventanas, avisos y descripciones, también lo que se crea después (se vigila el documento).

import en from './en.json';

type Dict = { s: Record<string, string>; t: [string, string][] };
export const LANGS: [string, string][] = [['es', 'Español'], ['en', 'English']];
const DICTS: Record<string, Dict> = { en: en as unknown as Dict };
const KEY = 'editor.lang';

function pick(): string {
  try { const v = localStorage.getItem(KEY); if (v && (v === 'es' || DICTS[v])) return v; } catch { /* sin almacenamiento */ }
  // primera vez: el idioma del navegador si lo tenemos; si no, inglés (el español solo si el navegador está en español)
  for (const l of navigator.languages ?? [navigator.language]) { const c = (l || '').slice(0, 2).toLowerCase(); if (c === 'es' || DICTS[c]) return c; }
  return 'en';
}
export const lang = pick();
const dict = DICTS[lang] ?? null;

/** Cambia el idioma (se recarga la página para rehacer toda la interfaz). */
export function setLang(l: string) {
  try { localStorage.setItem(KEY, l); } catch { /* */ }
  location.reload();
}

// plantillas: «Capa {0}» → /^Capa (.*?)$/ y la traducción con {0}, {1}… (pueden cambiar de orden o no usarse)
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tmpls = (dict?.t ?? []).map(([es, tr]) => {
  const lit = es.replace(/\{\}/g, '').trim().length;
  // con poco texto fijo («Capa {}», «Pincel {}»), lo variable tiene que ser un número: si no, atraparía «Pincel corrector»
  const any = lit >= 9 || /[«:]/.test(es);
  return { re: new RegExp('^' + es.split('{}').map(esc).join(any ? '([\\s\\S]*?)' : '(\\S{0,3}|[\\d\\s.,×x%°()+\\-]*?)') + '$'), tr, lit };
}).sort((a, b) => b.lit - a.lit); // primero las más concretas
const cache = new Map<string, string | null>();
/** Los textos ya traducidos no se vuelven a traducir (evita cadenas «A → B → C» si una traducción coincide con otra palabra en español). */
const outputs = new Set<string>(dict ? Object.values(dict.s) : []);

function lookup(s: string): string | null {
  const d = dict!.s;
  if (s in d) return d[s];
  // nombres de filtros y ajustes sin los puntos suspensivos («Brillo/Contraste»)
  if (!s.endsWith('…') && (s + '…') in d) return d[s + '…'].replace(/…$/, '');
  for (const p of tmpls) {
    const m = p.re.exec(s); if (!m) continue;
    return p.tr.replace(/\{(\d)\}/g, (_, i) => { const v = m[+i + 1] ?? ''; return lookup1(v) ?? v; });
  }
  return null;
}
/** «color de fondo» en minúscula dentro de una frase: se busca «Color de fondo». */
function lower(x: string) { if (!/^[a-záéíóúñ]/.test(x)) return null; const r = lookup(x[0].toUpperCase() + x.slice(1)); return r === null ? null : r[0].toLowerCase() + r.slice(1); }
/** Una parte variable también puede ser un texto conocido («Capa: Fondo»). */
function lookup1(s: string) { return s && s.length > 1 && dict && s in dict.s ? dict.s[s] : null; }

/** Traduce un texto (o lo deja igual si no hay traducción). Respeta los espacios y símbolos de alrededor («✓ Píxeles», «Pinceles ▾»). */
export function t(s: string): string {
  if (!dict || !s) return s;
  const hit = cache.get(s); if (hit !== undefined) return hit ?? s;
  let out: string | null = null;
  const core = s.trim();
  if (outputs.has(core)) { cache.set(s, null); return s; }
  if (core && /[A-Za-zÁÉÍÓÚáéíóúÑñ¿¡]/.test(core)) {
    out = lookup(core);
    if (out === null && core.includes('\n')) {
      // varias líneas (descripciones de los botones): cada una por separado
      const parts = core.split('\n'), tr = parts.map(x => t(x));
      if (tr.some((x, i) => x !== parts[i])) out = tr.join('\n');
    }
    if (out === null && KEYS.test(core)) out = keyName(core);
    if (out === null) {
      // nombre con su atajo: «Marco elíptico (M)», «Deshacer (Ctrl+Z)»
      const k = /^([\s\S]+?) \(([^()]{1,14})\)$/.exec(core);
      if (k && /^[A-Z0-9]$|[+]|^F\d+$|^Esc$|^Supr$|^Intro$/.test(k[2])) { const r = lookup(k[1]); if (r !== null) out = r + ' (' + keyName(k[2]) + ')'; }
    }
    if (out === null) {
      // símbolos delante o detrás que no forman parte del texto
      const m = /^([\s ✓•·▸►◂←→↺＋+✕×🗑🎲⚠️ℹ️]*)([\s\S]*?)([\s▾▴:·]*)$/u.exec(core);
      if (m && (m[1] || m[3]) && m[2]) { const r = lookup(m[2]); if (r !== null) out = m[1] + r + m[3]; }
    }
    if (out === null) {
      // «Interletraje (milésimas de em) (arrastra para cambiar)»: lo de dentro del último paréntesis aparte
      const m = /^([\s\S]+) (\([^()]+\))$/.exec(core);
      if (m) { const a = t(m[1]), b = lookup(m[2]); if (b !== null || a !== m[1]) out = a + ' ' + (b ?? m[2]); }
    }
    if (out === null) {
      // frases unidas con « — », «: » o « · »: cada trozo por su lado
      for (const dl of [' · ', ' — ', ': ']) {
        if (!core.includes(dl)) continue;
        const parts = core.split(dl), tr = parts.map(x => t(x));
        if (tr.some((x, i) => x !== parts[i])) { out = tr.join(dl); break; }
      }
    }
    if (out === null && /( — |: | · | \()/.test(core)) {
      // textos compuestos («Duotono: se añade como capa de ajuste», «#ff0000 (Alt+clic…)», «Tinta — 3 px»): por partes
      const parts = core.split(/( — |: | · | \(|\)$)/);
      let changed = false;
      const tr = parts.map(x => { if (!x || /^( — |: | · | \(|\))$/.test(x)) return x; const r = lookup(x) ?? lookup('(' + x + ')')?.replace(/^\(|\)$/g, '') ?? lower(x); if (r !== null) { changed = true; return r; } return x; });
      if (changed) out = tr.join('');
    }
    if (out !== null) { const lead = s.match(/^\s*/)![0], tail = s.match(/\s*$/)![0]; out = lead + out + tail; }
  }
  if (cache.size > 5000) cache.clear();
  cache.set(s, out); return out ?? s;
}

/** Atajos de teclado: «Mayús+Ctrl+D» → «Shift+Ctrl+D». */
const KEYS = /^(?:(?:Ctrl|Alt|Mayús|Shift|Cmd|Meta)\+)+[^\s]{1,12}$|^(?:Retroceso|Supr|Intro|Espacio|Mayús|Re ?Pág|Av ?Pág|Inicio|Fin)$/;
function keyName(k: string) { return k.replace(/Mayús/g, 'Shift').replace(/Retroceso/g, 'Backspace').replace(/Supr/g, 'Del').replace(/Intro/g, 'Enter').replace(/Espacio/g, 'Space'); }

/** Nombres que pone el programa a las capas nuevas («Capa 3», «Fondo», «Grupo 1»…): se crean ya traducidos. */
const LAYER_NAME = /^(Capa|Grupo|Trazado|Marco|Mesa de trabajo|Cuadro|Forma|Fotograma|Instantánea|Composición) ?\d*$|^(Fondo|Texto|Forma|Vacío|Combinada|Cielo|Panorámica|Fondo generativo|Código QR|Profundidad \(IA\)|Texto en forma|En perspectiva|Iluminación del primer plano|Sustitución de cielo|Fusión de exposiciones|Fusión de enfoque|Separación de frecuencias|Baja frecuencia \(color y luz\)|Alta frecuencia \(textura\)|Calco de imagen|Forma combinada|Sin título)$/;
export function tName(name: string): string { return dict && LAYER_NAME.test(name) ? t(name) : name; }

// ---- Traducción de la interfaz ---------------------------------------------------------------
const ATTRS = ['title', 'placeholder', 'aria-label'];
/** Partes con texto del usuario: no se tocan. */
const SKIP = 'textarea, input, [contenteditable], .lname, .no-i18n, script, style, .fp-name';
function skip(el: Element | null) { return !!el && !!el.closest(SKIP); }
function doText(n: Text) {
  const v = n.nodeValue; if (!v || v.length < 2 || skip(n.parentElement)) return;
  // títulos de menú: algunos se traducen distinto que la misma palabra en otro sitio («Selección» → «Select»)
  const ctx = n.parentElement?.classList.contains('menu-title') ? dict?.s['menu:' + v.trim()] : undefined;
  const r = ctx ?? t(v); if (r !== v) n.nodeValue = r;
}
const SKIP_ATTR = '.lname, .no-i18n, [contenteditable]';
function doAttrs(el: Element) {
  if (el.closest(SKIP_ATTR)) return;
  for (const a of ATTRS) { const v = el.getAttribute(a); if (v && v.length > 1) { const r = t(v); if (r !== v) el.setAttribute(a, r); } }
}
function doTree(root: Node) {
  if (root.nodeType === 3) { doText(root as Text); return; }
  if (root.nodeType !== 1 && root.nodeType !== 11) return;
  if (root.nodeType === 1) { doAttrs(root as Element); if (skip(root as Element)) return; }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: n => { if (n.nodeType === 1 && (n as Element).matches(SKIP)) { doAttrs(n as Element); return NodeFilter.FILTER_REJECT; } return NodeFilter.FILTER_ACCEPT; },
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) doText(n as Text); else doAttrs(n as Element); }
}

/** Empieza a traducir la página (y todo lo que se añada después). */
export function startI18n() {
  document.documentElement.lang = lang;
  if (!dict) return;
  doTree(document.body);
  document.title = t(document.title);
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(doTree);
      else if (m.type === 'characterData') doText(m.target as Text);
      else if (m.type === 'attributes') doAttrs(m.target as Element);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
