// Rueda de color para la gradación: el ángulo elige el tono y la distancia al centro, cuánto se tiñe.
// Arrastrar mueve el punto; doble toque (o doble clic) lo devuelve al centro.
import { h } from './dom';

export function gradeWheel(label: string, value: [number, number], onChange: (v: [number, number]) => void, size = 104): HTMLElement {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const cv = h('canvas', { class: 'gw-canvas', width: size * dpr, height: size * dpr, style: { width: size + 'px', height: size + 'px' }, role: 'slider', 'aria-label': label }) as HTMLCanvasElement;
  const info = h('span', { class: 'gw-info' });
  let v: [number, number] = [value?.[0] ?? 0, value?.[1] ?? 0];
  const R = size / 2 - 4;
  // fondo: tonos alrededor, que se apagan hacia el centro (se pinta una vez)
  const bg = document.createElement('canvas'); bg.width = bg.height = size * dpr;
  { const c = bg.getContext('2d')!, img = c.createImageData(bg.width, bg.height), D = img.data, cx = bg.width / 2, rr = R * dpr;
    for (let y = 0; y < bg.height; y++) for (let x = 0; x < bg.width; x++) {
      const dx = x - cx, dy = y - cx, dd = Math.hypot(dx, dy); if (dd > rr + 1) continue;
      const hue = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360, sat = Math.min(1, dd / rr) * 0.75;
      const hh = hue / 60, xx = 1 - Math.abs(hh % 2 - 1), [r, g, b] = hh < 1 ? [1, xx, 0] : hh < 2 ? [xx, 1, 0] : hh < 3 ? [0, 1, xx] : hh < 4 ? [0, xx, 1] : hh < 5 ? [xx, 0, 1] : [1, 0, xx];
      const i = (y * bg.width + x) * 4, L = 0.42; D[i] = 255 * (L + (r - 0.5) * sat * 0.9); D[i + 1] = 255 * (L + (g - 0.5) * sat * 0.9); D[i + 2] = 255 * (L + (b - 0.5) * sat * 0.9);
      D[i + 3] = dd > rr ? Math.max(0, 255 * (rr + 1 - dd)) : 255;
    }
    c.putImageData(img, 0, 0); }
  const paint = () => {
    const c = cv.getContext('2d')!; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height); c.drawImage(bg, 0, 0); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = size / 2, a = v[0] * Math.PI / 180, d = v[1] / 100 * R, x = cx + Math.cos(a) * d, y = cx - Math.sin(a) * d;
    c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1; c.beginPath(); c.moveTo(cx - 5, cx); c.lineTo(cx + 5, cx); c.moveTo(cx, cx - 5); c.lineTo(cx, cx + 5); c.stroke();
    c.lineWidth = 2; c.strokeStyle = '#fff'; c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.arc(x, y, 6, 0, Math.PI * 2); c.fill(); c.stroke();
    info.textContent = v[1] ? `${Math.round(v[0])}° · ${Math.round(v[1])} %` : '—';
    cv.setAttribute('aria-valuetext', info.textContent);
  };
  const set = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect(), dx = e.clientX - r.left - size / 2, dy = e.clientY - r.top - size / 2;
    const amt = Math.min(100, Math.hypot(dx, dy) / R * 100);
    v = [Math.round((Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360), Math.round(amt < 3 ? 0 : amt)];
    paint(); onChange(v);
  };
  cv.style.touchAction = 'none';
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); set(e); });
  cv.addEventListener('pointermove', e => { if (cv.hasPointerCapture(e.pointerId)) set(e); });
  cv.addEventListener('dblclick', () => { v = [0, 0]; paint(); onChange(v); });
  paint();
  return h('div', { class: 'gw' }, h('div', { class: 'gw-label' }, label), cv, info);
}
