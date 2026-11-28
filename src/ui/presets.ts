// «Mis ajustes»: en los generadores (texturas, detalles, interfaz del juego, cámara, animaciones rápidas, interpolación) se
// guardan los ajustes con un nombre para volver a usarlos y seguir modificándolos. Al elegir uno se reabre la ventana con
// esos valores (cada ventana ya recuerda «lo último usado», así que basta con dejarlo ahí).
import { app } from './app';
import { h } from './dom';
import { t } from '../i18n/i18n';

export type Preset = { name: string; data: unknown };
const K = (key: string) => 'editor.presets.' + key;
export function listPresets(key: string): Preset[] { try { const v = JSON.parse(localStorage.getItem(K(key)) || '[]'); return Array.isArray(v) ? v.filter(p => p && typeof p.name === 'string') : []; } catch { return []; } }
function store(key: string, list: Preset[]) { try { localStorage.setItem(K(key), JSON.stringify(list)); return true; } catch { app.toast('No hay sitio para guardar más ajustes', 'warn'); return false; } }
export function savePreset(key: string, name: string, data: unknown) { const l = listPresets(key), i = l.findIndex(p => p.name === name), v = { name, data: JSON.parse(JSON.stringify(data)) }; if (i >= 0) l[i] = v; else l.push(v); return store(key, l) ? (i >= 0 ? 'updated' : 'added') : null; }
export function deletePreset(key: string, name: string) { store(key, listPresets(key).filter(p => p.name !== name)); }

/** Los últimos ajustes elegidos en cada ventana (se quedan marcados al reabrirla). */
const chosen: Record<string, string> = {};
/** Barra de «Mis ajustes» para una ventana. `current` da los ajustes de ahora; `reopen` vuelve a abrir la ventana. */
export function presetBar(o: { key: string; lastKey: string; current: () => unknown; close: () => void; reopen: () => void }): HTMLElement {
  const sel = h('select', { class: 'preset-sel', 'aria-label': t('Mis ajustes') }) as HTMLSelectElement;
  const fill = () => { const l = listPresets(o.key); sel.replaceChildren(h('option', { value: '' }, l.length ? t('Mis ajustes…') : t('Aún no hay ajustes guardados')), ...l.map(p => h('option', { value: p.name, class: 'no-i18n' }, p.name))); const c = chosen[o.key]; sel.value = c && l.some(p => p.name === c) ? c : ''; del.disabled = !sel.value; };
  const name = h('input', { type: 'text', class: 'input preset-name', placeholder: t('Nombre'), 'aria-label': t('Nombre de los ajustes') }) as HTMLInputElement;
  const save = h('button', { type: 'button', class: 'btn' }, 'Guardar ajustes');
  const del = h('button', { type: 'button', class: 'btn', title: 'Borrar los ajustes elegidos' }, 'Borrar');
  save.onclick = () => {
    const nm = name.value.trim() || sel.value || `${t('Ajustes')} ${listPresets(o.key).length + 1}`;
    const r = savePreset(o.key, nm, o.current()); if (!r) return;
    app.toast(r === 'updated' ? t('Ajustes actualizados') : t('Ajustes guardados')); name.value = ''; chosen[o.key] = nm; fill();
  };
  sel.onchange = () => {
    del.disabled = !sel.value; if (!sel.value) return;
    const p = listPresets(o.key).find(x => x.name === sel.value); if (!p) return;
    try { localStorage.setItem(o.lastKey, JSON.stringify(p.data)); } catch { /* */ }
    chosen[o.key] = p.name;
    o.close(); o.reopen();
  };
  del.onclick = () => { if (!sel.value) return; deletePreset(o.key, sel.value); delete chosen[o.key]; app.toast(t('Ajustes borrados')); fill(); };
  fill();
  return h('div', { class: 'preset-bar' }, sel, name, save, del);
}
