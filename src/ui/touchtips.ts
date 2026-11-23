// En pantallas táctiles no hay «pasar el ratón por encima»: si mantienes pulsado un botón o control con descripción
// (atributo title), sale un globo con lo que hace y, al soltar, el botón no se activa. Un toque normal funciona como siempre.

const HOLD = 500;
let tip: HTMLElement | null = null, hideTimer = 0;

function hideTip() { clearTimeout(hideTimer); tip?.remove(); tip = null; }

function showTip(el: Element, text: string) {
  hideTip();
  tip = document.createElement('div');
  tip.className = 'touch-tip'; tip.setAttribute('role', 'tooltip'); tip.textContent = text;
  document.body.append(tip);
  const r = el.getBoundingClientRect(), w = tip.offsetWidth, ht = tip.offsetHeight, m = 8;
  let x = r.left + r.width / 2 - w / 2, y = r.top - ht - 10;
  if (y < m) y = r.bottom + 10;                       // sin sitio arriba: debajo
  x = Math.max(m, Math.min(innerWidth - w - m, x));
  y = Math.max(m, Math.min(innerHeight - ht - m, y));
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
  hideTimer = window.setTimeout(hideTip, 2600);
}

/** Elemento con descripción bajo el dedo, o null si ahí la pulsación larga ya hace otra cosa. */
function target(t: EventTarget | null): HTMLElement | null {
  const el = (t as Element | null)?.closest?.('[title]') as HTMLElement | null;
  if (!el || !el.title.trim()) return null;
  // sitios donde mantener pulsado tiene su propia función (lienzo, campos de texto, grupos de herramientas, «ver sin el ajuste»)
  if (el.closest('canvas, textarea, input:not([type=checkbox]):not([type=radio]):not([type=range]), select, [contenteditable], [role=slider], .tool-btn.grouped, [data-hold], .viewport-canvas')) return null;
  return el;
}

export function installTouchTips() {
  let timer = 0, sx = 0, sy = 0, swallow = 0, pid = -1;
  const cancel = () => { clearTimeout(timer); timer = 0; pid = -1; };
  document.addEventListener('pointerdown', e => {
    hideTip(); cancel(); swallow = 0;
    if (e.pointerType === 'mouse' || !e.isPrimary) return;
    const el = target(e.target); if (!el) return;
    sx = e.clientX; sy = e.clientY; pid = e.pointerId;
    timer = window.setTimeout(() => { timer = 0; showTip(el, el.title); swallow = performance.now(); }, HOLD);
  }, { capture: true, passive: true });
  document.addEventListener('pointermove', e => { if (timer && e.pointerId === pid && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); }, { capture: true, passive: true });
  for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, cancel, { capture: true, passive: true });
  // tras enseñar la ayuda, el toque que acaba no activa el botón (ni abre el menú del sistema)
  const eat = (e: Event) => { if (swallow && performance.now() - swallow < 3000) { e.preventDefault(); e.stopPropagation(); if (e.type === 'click') swallow = 0; } };
  document.addEventListener('click', eat, true);
  document.addEventListener('contextmenu', e => { if (tip) { e.preventDefault(); } }, true);
  addEventListener('scroll', hideTip, { capture: true, passive: true });
}
