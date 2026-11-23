// Mini tutorial para móvil y tableta: tarjetas con un dibujo animado de cada gesto (deslizar para pasar).
// Sale la primera vez que se abre una imagen en una pantalla táctil y se puede volver a ver desde Ayuda.
import { h } from './dom';
import { icon } from './icons';

export const TOUCH_TOUR_KEY = 'editor.mobileTour';

// dibujos: un lienzo y uno o varios dedos (círculos) que se mueven con animaciones CSS
const SVG = (body: string) => `<svg viewBox="0 0 200 120" class="tt-art" aria-hidden="true"><rect x="20" y="12" width="160" height="96" rx="8" class="tt-canvas"/>${body}</svg>`;
const finger = (cls: string, cx = 100, cy = 60) => `<circle class="tt-f ${cls}" cx="${cx}" cy="${cy}" r="9"/>`;
const CARDS: { art: string; title: string; text: string; pen?: boolean }[] = [
  { art: SVG(`<path class="tt-line" d="M45 80 C 70 30, 110 100, 155 40" pathLength="1"/>${finger('tt-draw', 0, 0)}`), title: 'Dibujar', text: 'Arrastra un dedo sobre la imagen para usar la herramienta elegida: pincel, borrador, selección…' },
  { art: SVG(`${finger('tt-pin-a', 85, 60)}${finger('tt-pin-b', 115, 60)}<path class="tt-arrow" d="M70 60h-18M130 60h18"/>`), title: 'Acercar, mover y girar', text: 'Separa o junta dos dedos para acercar o alejar. Muévelos juntos para desplazarte y gíralos para girar el lienzo.' },
  { art: SVG(`${finger('tt-tap', 85, 60)}${finger('tt-tap', 115, 60)}<text x="100" y="100" class="tt-lbl">2</text>`), title: 'Deshacer y rehacer', text: 'Un toque rápido con dos dedos deshace el último paso; con tres dedos, lo rehace. También tienes las flechas de arriba.' },
  { art: SVG(`<rect x="80" y="40" width="40" height="40" rx="8" class="tt-btn"/>${finger('tt-hold', 100, 60)}<rect x="58" y="16" width="84" height="18" rx="5" class="tt-tip"/>`), title: 'Mantén pulsado para saber qué hace', text: 'Si no sabes qué hace un botón, mantenlo pulsado: aparece su nombre y para qué sirve, sin activarlo.' },
  { art: SVG(`<path class="tt-line tt-static" d="M50 85 C 80 40, 120 90, 150 45"/><path class="tt-pen" d="M150 45 l18 -30 l6 4 l-18 30 z"/><ellipse class="tt-palm" cx="148" cy="90" rx="22" ry="12"/>`), title: 'Con lápiz', text: 'Si usas un lápiz, el lápiz dibuja y el dedo solo mueve la vista: puedes apoyar la mano sin manchar. El botón «Dedo» de abajo lo cambia.', pen: true },
  { art: SVG(`<rect x="28" y="20" width="58" height="80" rx="6" class="tt-btn"/><path class="tt-arrow" d="M40 36h34M40 52h34M40 68h34M40 84h24"/><rect x="118" y="20" width="54" height="80" rx="6" class="tt-btn tt-slide"/>`), title: 'Menú y paneles', text: '«Menú» (arriba) tiene todas las funciones por categorías y un buscador. «Paneles», o deslizar el dedo desde el borde derecho, abre las capas, el color y el historial.' },
];

let open = false;
export function startTouchTour(onDone?: () => void) {
  if (open) return; open = true;
  let i = 0;
  const track = h('div', { class: 'tt-track' });
  CARDS.forEach(c => track.append(h('div', { class: 'tt-card' }, h('div', { class: 'tt-pic', html: c.art }), h('h3', {}, c.title), h('p', {}, c.text))));
  const dots = h('div', { class: 'tt-dots' }, ...CARDS.map(() => h('span', {})));
  const skip = h('button', { class: 'btn', type: 'button' }, 'Saltar');
  const next = h('button', { class: 'btn primary', type: 'button' }, 'Siguiente');
  const box = h('div', { class: 'tt-box', role: 'dialog', 'aria-label': 'Guía rápida' },
    h('div', { class: 'tt-head' }, h('span', { html: icon('finger') }), h('b', {}, 'Guía rápida de gestos')), h('div', { class: 'tt-view' }, track), dots, h('div', { class: 'tt-btns' }, skip, next));
  const ov = h('div', { class: 'tt-overlay' }, box);
  const go = (n: number) => {
    i = Math.max(0, Math.min(CARDS.length - 1, n));
    track.style.transform = `translateX(${-i * 100}%)`;
    [...dots.children].forEach((d, j) => d.classList.toggle('on', j === i));
    [...track.children].forEach((c, j) => c.classList.toggle('cur', j === i));
    next.textContent = i === CARDS.length - 1 ? 'Empezar' : 'Siguiente';
  };
  // la guía ya explica el gesto del borde: no hace falta el aviso aparte
  const end = () => { try { localStorage.setItem(TOUCH_TOUR_KEY, '1'); localStorage.setItem('editor.swipeHint', '1'); } catch { /* */ } ov.remove(); open = false; onDone?.(); };
  skip.onclick = end;
  next.onclick = () => { if (i === CARDS.length - 1) end(); else go(i + 1); };
  [...dots.children].forEach((d, j) => d.addEventListener('click', () => go(j)));
  // deslizar con el dedo para pasar de tarjeta
  let x0: number | null = null;
  track.addEventListener('pointerdown', e => { x0 = e.clientX; });
  track.addEventListener('pointerup', e => { if (x0 === null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1)); });
  ov.addEventListener('keydown', e => { if (e.key === 'Escape') end(); if (e.key === 'ArrowRight') go(i + 1); if (e.key === 'ArrowLeft') go(i - 1); });
  document.body.append(ov); go(0); next.focus();
}

let checked = false;
/** La primera vez en una pantalla táctil: true si se ha mostrado (entonces no se enseña la guía de escritorio). */
export function maybeTouchTour(): boolean {
  if (checked) return false; checked = true;
  if (!matchMedia('(pointer: coarse)').matches) return false;
  try { if (localStorage.getItem(TOUCH_TOUR_KEY)) return true; } catch { return false; }
  setTimeout(() => startTouchTour(), 700);
  return true;
}
