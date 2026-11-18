// Selector de fuentes con buscador, categorías y vista previa de cada fuente.

import { h } from './dom';
import { app } from './app';
import { SYSTEM_FONTS, WEB_FONTS, CATEGORY_NAMES, ensureFont, isWebFont, localFonts, loadLocalFonts } from '../core/fonts';

const previewed = new Set<string>();
/** Carga una versión mínima de la fuente (solo las letras de su nombre) para la vista previa. */
function previewFont(family: string) {
  if (previewed.has(family) || !isWebFont(family)) return;
  previewed.add(family);
  const fam = encodeURIComponent(family).replace(/%20/g, '+');
  fetch(`https://fonts.googleapis.com/css2?family=${fam}&text=${encodeURIComponent(family)}`).then(r => r.ok ? r.text() : '').then(css => {
    const src = /url\(([^)]+)\)/.exec(css)?.[1]; if (!src) return;
    const ff = new FontFace(family + ' Preview', `url(${src})`); (document.fonts as any).add(ff); ff.load().catch(() => {});
  }).catch(() => {});
}

export function fontPicker(value: string, onChange: (family: string) => void): HTMLElement {
  const btn = h('button', { class: 'btn font-btn', type: 'button', title: 'Fuente' });
  const paint = (f: string) => { btn.textContent = f + ' ▾'; btn.style.fontFamily = `"${f}", "${f} Preview", sans-serif`; previewFont(f); };
  paint(value);
  btn.addEventListener('click', e => {
    e.stopPropagation();
    document.querySelector('.font-fly')?.remove();
    const fly = h('div', { class: 'flyout font-fly' });
    const r = btn.getBoundingClientRect(); fly.style.left = Math.min(r.left, innerWidth - 330) + 'px'; fly.style.top = r.bottom + 4 + 'px';
    const search = h('input', { type: 'search', class: 'wide', placeholder: 'Buscar fuente…' });
    let cat = 'all';
    const cats = h('div', { class: 'font-cats' });
    const list = h('div', { class: 'font-list' });
    const io = new IntersectionObserver(ents => { for (const en of ents) if (en.isIntersecting) { previewFont((en.target as HTMLElement).dataset.f!); io.unobserve(en.target); } }, { root: list });
    const all = (): [string, string][] => [...SYSTEM_FONTS.map(f => [f, 'system'] as [string, string]), ...WEB_FONTS, ...localFonts.map(f => [f, 'local'] as [string, string])];
    const render = () => {
      list.innerHTML = '';
      const q = search.value.trim().toLowerCase();
      for (const [f, c] of all()) {
        if (cat !== 'all' && c !== cat) continue;
        if (q && !f.toLowerCase().includes(q)) continue;
        const it = h('div', { class: 'font-item' + (f === value ? ' on' : ''), 'data-f': f }, h('span', { class: 'font-name', style: { fontFamily: `"${f}", "${f} Preview", sans-serif` } }, f), h('span', { class: 'font-cat' }, CATEGORY_NAMES[c] ?? ''));
        it.onclick = async () => {
          fly.remove(); value = f; paint(f);
          if (isWebFont(f)) { app.toast(`Cargando la fuente ${f}…`); const ok = await ensureFont(f); if (!ok) app.toast('No se pudo descargar la fuente (¿sin conexión?)', 'warn'); }
          onChange(f);
        };
        list.append(it); io.observe(it);
      }
      if (!list.children.length) list.append(h('div', { class: 'hint' }, 'No hay fuentes con ese nombre.'));
    };
    for (const [k, n] of [['all', 'Todas'], ['sans', 'Sin serifa'], ['serif', 'Serifa'], ['display', 'Decorativas'], ['handwriting', 'Manuscritas'], ['mono', 'Mono'], ['system', 'Sistema'], ['local', 'Equipo']] as const) {
      const b = h('button', { class: 'font-cat-btn' + (k === cat ? ' on' : ''), type: 'button' }, n);
      b.onclick = async () => {
        if (k === 'local' && !localFonts.length) { try { await loadLocalFonts(); } catch (er: any) { app.toast(er?.message ?? 'No se pudieron leer las fuentes', 'warn'); return; } }
        cat = k; [...cats.children].forEach(x => x.classList.toggle('on', x === b)); render();
      };
      cats.append(b);
    }
    search.addEventListener('input', render);
    fly.append(search, cats, list, h('div', { class: 'hint font-note' }, 'Las fuentes de la biblioteca se descargan de Google Fonts al usarlas (solo la fuente; tus imágenes no salen del equipo).'));
    document.body.append(fly); render(); search.focus();
    list.querySelector('.on')?.scrollIntoView({ block: 'center' });
    setTimeout(() => document.addEventListener('pointerdown', function close(ev) { if (!fly.contains(ev.target as Node)) { fly.remove(); io.disconnect(); document.removeEventListener('pointerdown', close); } }), 0);
  });
  return btn;
}
