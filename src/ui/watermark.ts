// Marca de agua: un texto (por defecto «© año») en una esquina, en el centro o repetido en diagonal por toda la
// imagen. Se crea en una capa propia (se puede mover, bajar la opacidad o borrar después) y se ve en directo.
import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog, row } from './dialog';
import { t } from '../i18n/i18n';
import { RasterLayer } from '../core/layers';

const KEY = 'editor.watermark';
type WM = { text: string; size: number; color: string; opacity: number; pos: string; margin: number; angle: number; shadow: boolean };
const DEF: WM = { text: '© ' + new Date().getFullYear(), size: 5, color: '#ffffff', opacity: 60, pos: 'br', margin: 3, angle: -30, shadow: true };

export function drawWatermark(c: CanvasRenderingContext2D, W: number, H: number, o: WM) {
  c.clearRect(0, 0, W, H);
  if (!o.text.trim()) return;
  const fs = Math.max(6, Math.round(Math.min(W, H) * o.size / 100 * 1.6)), m = Math.min(W, H) * o.margin / 100;
  c.save();
  c.font = `600 ${fs}px Inter, system-ui, sans-serif`; c.fillStyle = o.color; c.globalAlpha = o.opacity / 100;
  if (o.shadow) { c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = fs * 0.12; c.shadowOffsetY = fs * 0.04; }
  const tw = c.measureText(o.text).width;
  if (o.pos === 'tile') {
    // repetida en diagonal: filas alternas desplazadas, cubriendo también las esquinas al girar
    c.translate(W / 2, H / 2); c.rotate(o.angle * Math.PI / 180);
    const D = Math.hypot(W, H), gx = tw + fs * 3, gy = fs * 3.2;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let y = -D / 2, r = 0; y <= D / 2; y += gy, r++) for (let x = -D / 2 + (r % 2) * gx / 2; x <= D / 2; x += gx) c.fillText(o.text, x, y);
  } else {
    const [v, hz] = [o.pos[0], o.pos[1]];
    c.textAlign = hz === 'l' ? 'left' : hz === 'r' ? 'right' : 'center';
    c.textBaseline = v === 't' ? 'top' : v === 'b' ? 'bottom' : 'middle';
    const x = hz === 'l' ? m : hz === 'r' ? W - m : W / 2, y = v === 't' ? m : v === 'b' ? H - m : H / 2;
    if (o.angle && o.pos === 'mc') { c.translate(x, y); c.rotate(o.angle * Math.PI / 180); c.fillText(o.text, 0, 0); } else c.fillText(o.text, x, y);
  }
  c.restore();
}

export function watermarkDialog() {
  const d = app.doc; if (!d) return;
  let o: WM = { ...DEF }; try { o = { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* */ }
  const layer = d.newRasterLayer(t('Marca de agua'));
  const ctx = layer.canvas.getContext('2d')!;
  const render = () => { drawWatermark(ctx, layer.canvas.width, layer.canvas.height, o); layer.touch(); d.invalidate(); app.viewport.requestRender(); };
  const text = h('input', { type: 'text', value: o.text, maxlength: 120 }) as HTMLInputElement;
  text.addEventListener('input', () => { o.text = text.value; render(); });
  const POS: [string, string][] = [['tl', 'Arriba a la izquierda'], ['tc', 'Arriba en el centro'], ['tr', 'Arriba a la derecha'], ['ml', 'Centro a la izquierda'], ['mc', 'Centro'], ['mr', 'Centro a la derecha'], ['bl', 'Abajo a la izquierda'], ['bc', 'Abajo en el centro'], ['br', 'Abajo a la derecha'], ['tile', 'Repetida en diagonal (toda la imagen)']];
  const pos = h('select', {}, ...POS.map(([v, n]) => h('option', { value: v, selected: o.pos === v }, n))) as HTMLSelectElement;
  const color = h('input', { type: 'color', class: 'color-input', value: o.color }) as HTMLInputElement;
  color.addEventListener('input', () => { o.color = color.value; render(); });
  const shadow = h('input', { type: 'checkbox', checked: o.shadow }) as HTMLInputElement;
  shadow.addEventListener('change', () => { o.shadow = shadow.checked; render(); });
  const sl = (k: 'size' | 'opacity' | 'margin' | 'angle', min: number, max: number, unit: string) => numberSlider({ min, max, value: o[k], unit, onInput: v => { o[k] = v; render(); } }).el;
  const angleRow = row('Ángulo', sl('angle', -90, 90, '°'));
  const marginRow = row('Margen', sl('margin', 0, 20, '%'));
  const sync = () => { angleRow.style.display = o.pos === 'tile' || o.pos === 'mc' ? '' : 'none'; marginRow.style.display = o.pos === 'tile' || o.pos === 'mc' ? 'none' : ''; };
  pos.addEventListener('change', () => { o.pos = pos.value; sync(); render(); });
  sync(); render();
  let done = false;
  showDialog({
    title: 'Añadir marca de agua', side: true, width: 380,
    body: [row('Texto', text), row('Posición', pos), row('Tamaño', sl('size', 1, 30, '%')), row('Opacidad', sl('opacity', 5, 100, '%')), row('Color', color), angleRow, marginRow,
      row('', h('label', { class: 'check' }, shadow, ' ' + 'Sombra suave (se lee sobre fondos claros y oscuros)')),
      h('div', { class: 'hint' }, 'Se añade en una capa nueva: luego puedes moverla, cambiar su opacidad o borrarla.')],
    onOk: () => {
      done = true; try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* */ }
      if (!o.text.trim()) { layer.parent?.remove(layer); d.invalidate(); app.emit('doc'); return; }
      d.commit('Marca de agua');
    },
    onCancel: () => { if (done) return; layer.parent?.remove(layer); d.setActive(d.allLayers().pop() ?? null); d.invalidate(); app.viewport.requestRender(); app.emit('doc'); },
  });
}

/** Recorte circular (foto de perfil): cuadrado centrado (o el de la selección) y fuera del círculo, transparente. */
export function circleCrop() {
  const d = app.doc; if (!d) return;
  const b = d.selection.bounds;
  const s = Math.round(b ? Math.min(b.w, b.h) : Math.min(d.width, d.height));
  const x = Math.round(b ? b.x + (b.w - s) / 2 : (d.width - s) / 2), y = Math.round(b ? b.y + (b.h - s) / 2 : (d.height - s) / 2);
  // toda la imagen en una capa, recortada al cuadrado y con el círculo (un solo paso de deshacer)
  const flat = d.flatten(), out = document.createElement('canvas'); out.width = out.height = s;
  const c = out.getContext('2d')!;
  c.beginPath(); c.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); c.clip(); c.drawImage(flat, -x, -y);
  d.root.children.slice().forEach(ch => d.root.remove(ch));
  d.resizeCanvas(s, s, -x, -y); d.selection.clear();
  const l = new RasterLayer(t('Foto de perfil'), s, s); l.canvas = out; d.root.add(l); d.setActive(l, false);
  d.invalidate(); d.commit('Recorte circular'); app.viewport.fit(true);
  app.toast('Recorte circular listo: expórtalo en PNG para que las esquinas queden transparentes');
}
