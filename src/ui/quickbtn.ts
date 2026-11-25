// Botón rápido sobre el lienzo, pensado para tabletas sin teclado:
//  - mantenerlo pulsado con una mano hace de tecla (Alt, Mayús o Ctrl) mientras la otra dibuja: Alt + pincel coge un
//    color, Alt + tampón elige el origen, Mayús hace líneas rectas y proporciones fijas, etc.;
//  - un toque abre un menú circular con 8 acciones a elegir (deshacer, herramientas, intercambiar colores…);
//  - arrastrarlo lo cambia de sitio (se recuerda).
import { app } from './app';
import { h } from './dom';
import { icon } from './icons';
import { prefs, savePrefs } from './prefs';
import { softMods } from './softmods';
import { ACTIONS } from './actions';
import { showDialog, row } from './dialog';

const MOD_NAMES: Record<string, string> = { alt: 'Alt', shift: 'Mayús', ctrl: 'Ctrl' };
const POS_KEY = 'editor.quickBtnPos';
/** Acciones que se pueden poner en el menú circular (además de cualquier herramienta). */
const ACTION_SLOTS = ['undo', 'redo', 'swap', 'newLayerQuiet', 'flipView', 'drawMode', 'deselect', 'selectAll', 'invertSel', 'fillFg', 'clear', 'dupLayer', 'mergeDown', 'lockAlphaToggle', 'clip', 'refLayer', 'freeTransform', 'fit', 'actual', 'resetRot', 'reference', 'lastFilter', 'quickPng', 'save'];
const ACTION_ICONS: Record<string, string> = { undo: 'undo', redo: 'redo', swap: 'swap', newLayerQuiet: 'newLayer', flipView: 'flipH', drawMode: 'brush', deselect: 'selNew', selectAll: 'marqueeRect', invertSel: 'selInt', fillFg: 'bucket', clear: 'trash', dupLayer: 'duplicate', mergeDown: 'layers', lockAlphaToggle: 'lockAlpha', clip: 'clip', refLayer: 'reference', freeTransform: 'resize', fit: 'zoom', actual: 'zoom', resetRot: 'rotateView', reference: 'image', lastFilter: 'fx', quickPng: 'download', save: 'download' };

/** Nombres cortos para el anillo (el nombre entero va en la descripción). */
const SHORT: Record<string, string> = { swap: 'Intercambiar', newLayerQuiet: 'Nueva capa', flipView: 'Espejo', drawMode: 'Modo dibujo', lockAlphaToggle: 'Bloq. transparencia', refLayer: 'Referencia', freeTransform: 'Transformar', fit: 'Ajustar', actual: '100 %', resetRot: 'Enderezar vista', reference: 'Imagen de referencia', lastFilter: 'Repetir filtro', quickPng: 'Exportar PNG', mergeDown: 'Combinar abajo', dupLayer: 'Duplicar capa', fillFg: 'Rellenar', clip: 'Recorte', save: 'Guardar' };
interface Item { short?: string; label: string; svg: string; run: () => void; on?: boolean; off?: boolean }
function item(id: string): Item | null {
  if (id.startsWith('tool:')) {
    const t = app.tools.get(id.slice(5)); if (!t) return null;
    return { label: t.name, svg: t.icon, run: () => app.setTool(t.id), on: app.tool?.id === t.id };
  }
  if (id === 'swap') return { label: 'Intercambiar colores', short: SHORT.swap, svg: icon('swap'), run: () => app.setColors(app.bg, app.fg) };
  const a = ACTIONS.find(x => x.id === id); if (!a) return null;
  return { label: a.label.replace(/…$/, ''), short: SHORT[id], svg: icon(ACTION_ICONS[id] ?? 'menu'), run: () => a.run(), on: a.checked?.(), off: a.enabled ? !a.enabled() : false };
}

let btn: HTMLElement | null = null, ring: HTMLElement | null = null, sticky = false;
function setMod(on: boolean) {
  softMods.alt = softMods.shift = softMods.ctrl = false;
  if (on) softMods[prefs.quickMod] = true;
  btn?.classList.toggle('on', on);
  btn?.setAttribute('aria-pressed', String(on));
}
function closeRing() { ring?.remove(); ring = null; btn?.classList.remove('ringed'); }

function openRing() {
  closeRing();
  if (!sticky) setMod(false);
  const r = btn!.getBoundingClientRect(), R = 100, cx0 = r.left + r.width / 2, cy0 = r.top + r.height / 2;
  // el anillo cabe entero en la pantalla aunque el botón esté en una esquina
  const cx = Math.max(R + 34, Math.min(innerWidth - R - 34, cx0)), cy = Math.max(R + 34, Math.min(innerHeight - R - 34, cy0));
  const items = prefs.quickSlots.map(item).filter((x): x is Item => !!x).slice(0, 8);
  const el = h('div', { class: 'qring-overlay' }), opened = performance.now();
  // un doble toque rápido sobre el botón no debe pulsar lo que hay debajo del dedo en el menú recién abierto
  const fresh = () => performance.now() - opened < 350;
  el.addEventListener('pointerdown', e => { if (e.target === el) { e.preventDefault(); closeRing(); } });
  items.forEach((it, i) => {
    const a = -Math.PI / 2 + i / items.length * Math.PI * 2;
    const b = h('button', { class: 'qring-item' + (it.on ? ' on' : ''), type: 'button', title: it.label, 'aria-label': it.label, disabled: it.off || undefined },
      h('span', { class: 'qi-ic', html: it.svg }), h('span', { class: 'qi-lb' }, it.short ?? it.label));
    b.style.left = cx + Math.cos(a) * R + 'px'; b.style.top = cy + Math.sin(a) * R + 'px';
    b.onclick = () => { if (fresh()) return; closeRing(); it.run(); };
    el.append(b);
  });
  // en el centro: fijar la tecla (para usarla con una sola mano) y los ajustes del botón
  const name = MOD_NAMES[prefs.quickMod];
  const lock = h('button', { class: 'qring-center' + (sticky ? ' on' : ''), type: 'button', title: sticky ? `Soltar ${name}` : `Fijar ${name}`, 'aria-label': sticky ? `Soltar ${name}` : `Fijar ${name}` }, h('span', { html: icon('modKey') }), h('span', { class: 'qi-lb' }, sticky ? `Soltar ${name}` : `Fijar ${name}`));
  lock.style.left = cx + 'px'; lock.style.top = cy - 16 + 'px';
  lock.onclick = () => { if (fresh()) return; closeRing(); sticky = !sticky; setMod(sticky); app.toast(sticky ? `${name} fijada: toca el botón rápido para soltarla` : `${name} suelta`); };
  const cfg = h('button', { class: 'qring-cfg', type: 'button', title: 'Personalizar el botón rápido', 'aria-label': 'Personalizar el botón rápido' }, 'Personalizar');
  cfg.style.left = cx + 'px'; cfg.style.top = cy + 24 + 'px';
  cfg.onclick = () => { if (fresh()) return; closeRing(); quickBtnDialog(); };
  el.append(lock, cfg);
  document.body.append(el); ring = el; btn!.classList.add('ringed');
}

/** Ajustes: cuándo se ve, qué tecla hace y qué acciones salen en el menú circular. */
export function quickBtnDialog() {
  const sel = (v: string, opts: [string, string][]) => h('select', {}, ...opts.map(([k, n]) => h('option', { value: k, selected: v === k }, n))) as HTMLSelectElement;
  const when = sel(prefs.quickBtn, [['auto', 'Automático (tablet o lápiz)'], ['on', 'Siempre'], ['off', 'Nunca']]);
  const mod = sel(prefs.quickMod, [['alt', 'Alt (coger color, origen del tampón, restar de la selección)'], ['shift', 'Mayús (líneas rectas, proporciones, sumar a la selección)'], ['ctrl', 'Ctrl (mover con otras herramientas)']]);
  const choices: [string, string][] = [['', '(vacío)'], ...ACTION_SLOTS.map(id => [id, item(id)?.label ?? id] as [string, string]).filter(([, n]) => !!n),
    ...[...app.tools.values()].map(t => ['tool:' + t.id, t.name] as [string, string])];
  const slots = Array.from({ length: 8 }, (_, i) => sel(prefs.quickSlots[i] ?? '', choices));
  showDialog({
    title: 'Botón rápido', width: 440,
    body: [
      h('div', { class: 'hint' }, 'Mantén pulsado el botón rápido con una mano mientras dibujas con la otra: hace de tecla. Tócalo para abrir el menú circular. Arrástralo para cambiarlo de sitio.'),
      row('Mostrar', when), row('Al mantenerlo', mod),
      h('div', { class: 'dlg-section' }, 'Menú circular'),
      ...slots.map((s, i) => row(String(i + 1), s)),
    ],
    onOk: () => {
      prefs.quickBtn = when.value as any; prefs.quickMod = mod.value as any;
      prefs.quickSlots = slots.map(s => s.value).filter(Boolean);
      savePrefs(); sticky = false; setMod(false); update();
    },
  });
}

let update = () => {};
export function buildQuickButton(host: HTMLElement) {
  const b = h('button', { class: 'quick-btn', type: 'button', title: 'Botón rápido: mantenlo para usarlo como tecla, tócalo para el menú', 'aria-label': 'Botón rápido', 'aria-pressed': 'false' },
    h('span', { html: icon('modKey') }), h('span', { class: 'qb-mod' }));
  btn = b; host.append(b);
  const place = (x: number, y: number) => {
    const W = host.clientWidth, H = host.clientHeight;
    b.style.left = Math.max(4, Math.min(W - 60, x)) + 'px'; b.style.top = Math.max(4, Math.min(H - 60, y)) + 'px';
  };
  const restore = () => { let p: { x: number; y: number } | null = null; try { p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch { /* sin almacenamiento */ } const W = host.clientWidth, H = host.clientHeight; place(p ? p.x * W : 44, p ? p.y * H : H - 140); };
  let st: { x: number; y: number; bx: number; by: number; t: number; drag: boolean; held: boolean; timer: number; id: number } | null = null;
  b.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation(); b.setPointerCapture(e.pointerId); closeRing();
    st = { x: e.clientX, y: e.clientY, bx: b.offsetLeft, by: b.offsetTop, t: performance.now(), drag: false, held: false, timer: 0, id: e.pointerId };
    const s = st;
    s.timer = window.setTimeout(() => { if (st === s && !s.drag) { s.held = true; if (!sticky) setMod(true); } }, 220);
  });
  b.addEventListener('pointermove', e => {
    if (!st || st.held) return;
    if (!st.drag && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 10) { st.drag = true; clearTimeout(st.timer); }
    if (st.drag) place(st.bx + e.clientX - st.x, st.by + e.clientY - st.y);
  });
  const up = () => {
    const s = st; st = null; if (!s) return; clearTimeout(s.timer);
    if (s.drag) { tapAt = 0; try { localStorage.setItem(POS_KEY, JSON.stringify({ x: b.offsetLeft / host.clientWidth, y: b.offsetTop / host.clientHeight })); } catch { /* sin almacenamiento */ } return; }
    if (s.held) { if (!sticky) setMod(false); return; }
    if (sticky) { sticky = false; setMod(false); app.toast(`${MOD_NAMES[prefs.quickMod]} suelta`); tapAt = 0; return; }
    // el menú se abre con el «clic» que el navegador manda tras el toque (si se abriera ya, ese clic caería en el
    // botón del centro del menú); si no llega, se abre igual
    tapAt = performance.now(); clearTimeout(tapTimer); tapTimer = window.setTimeout(() => { if (tapAt) { tapAt = 0; openRing(); } }, 350);
  };
  let tapAt = 0, tapTimer = 0;
  b.addEventListener('click', e => {
    e.stopPropagation();
    if (tapAt) { tapAt = 0; clearTimeout(tapTimer); openRing(); return; }
    // teclado (Intro o espacio con el foco en el botón): abre el menú
    if (e.detail === 0 && !ring) openRing();
  });
  b.addEventListener('pointerup', up);
  // si el dedo se suelta fuera del botón (o el navegador pierde la captura), la tecla se suelta igual
  addEventListener('pointerup', e => { if (st && e.pointerId === st.id && e.target !== b) up(); }, true);
  b.addEventListener('lostpointercapture', e => { if (st && e.pointerId === st.id) { const s2 = st; setTimeout(() => { if (st === s2) up(); }, 0); } }); b.addEventListener('pointercancel', () => { if (st) { clearTimeout(st.timer); st = null; } if (!sticky) setMod(false); });
  // la tecla no se queda «pegada» si se pierde el foco o se cambia de app
  addEventListener('blur', () => { if (!sticky) setMod(false); });
  update = () => {
    const want = prefs.quickBtn === 'on' || (prefs.quickBtn === 'auto' && (app.viewport?.penSeen || matchMedia('(pointer: coarse)').matches));
    b.classList.toggle('show', !!want && !!app.doc);
    b.querySelector('.qb-mod')!.textContent = MOD_NAMES[prefs.quickMod];
    if (!want) { sticky = false; setMod(false); closeRing(); }
  };
  app.on('docs', update); app.on('pen', update);
  addEventListener('resize', () => { restore(); update(); });
  restore(); update();
}
