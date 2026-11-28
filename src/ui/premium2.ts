// Más funciones que otras apps cobran, aquí gratis: creador de pegatinas, tamaño para todas las redes de una vez,
// carrusel panorámico para Instagram, antes y después, foto en movimiento (agua y nubes que fluyen) y rotar pixel art
// sin estropearlo (como RotSprite).
import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog } from './dialog';
import { ctx2d, makeCanvas, contentBounds } from '../core/canvas';
import { RasterLayer } from '../core/layers';
import { EditorDocument } from '../core/document';
import { t } from '../i18n/i18n';

const row = (label: string, ...els: (HTMLElement | string)[]) => h('div', { class: 'form-row' }, h('label', {}, label), ...els);
const sel = (opts: [string, string][], v?: string) => { const s = h('select', {}, ...opts.map(([a, b]) => h('option', { value: a }, b))) as HTMLSelectElement; if (v) s.value = v; return s; };
const chk = (label: string, on = false) => { const i = h('input', { type: 'checkbox', checked: on }) as HTMLInputElement; return { i, el: h('label', { class: 'check' }, i, ' ' + label) }; };
async function pngBytes(c: HTMLCanvasElement, type = 'image/png', q?: number) { return new Uint8Array(await (await new Promise<Blob>(r => c.toBlob(b => r(b!), type, q))).arrayBuffer()); }
async function saveZip(files: { name: string; data: Uint8Array }[], name: string, msg: string) {
  const { makeZip } = await import('../io/zip'), io = await import('../io/files');
  try { await io.saveBlob(makeZip(files), name); app.toast(msg); } catch (e: any) { if (e?.name !== 'AbortError') app.toast(String(e?.message ?? e), 'warn'); }
}
const safe = (s: string) => s.replace(/[^\w-]+/g, '_');

// ---- pegatinas ------------------------------------------------------------------------------------
/** Contorno grueso alrededor de lo que tiene opacidad (dilatación por distancia, con borde suave). */
export function outlineAlpha(src: HTMLCanvasElement, r: number): HTMLCanvasElement {
  const W = src.width, H = src.height, a = ctx2d(src).getImageData(0, 0, W, H).data, INF = 1e9;
  // distancia euclídea exacta (Felzenszwalb) a los píxeles con opacidad
  const f = new Float64Array(Math.max(W, H)), d1 = new Float64Array(W * H), v = new Int32Array(Math.max(W, H)), z = new Float64Array(Math.max(W, H) + 1);
  const dt = (n: number, get: (i: number) => number, set: (i: number, x: number) => void) => {
    for (let i = 0; i < n; i++) f[i] = get(i);
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) { let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); } k++; v[k] = q; z[k] = s; z[k + 1] = INF; }
    k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; set(q, (q - v[k]) ** 2 + f[v[k]]); }
  };
  for (let i = 0; i < W * H; i++) d1[i] = a[i * 4 + 3] > 127 ? 0 : INF;
  for (let x = 0; x < W; x++) dt(H, y => d1[y * W + x], (y, val) => { d1[y * W + x] = val; });
  for (let y = 0; y < H; y++) dt(W, x => d1[y * W + x], (x, val) => { d1[y * W + x] = val; });
  const out = makeCanvas(W, H), o = ctx2d(out), img = o.createImageData(W, H), D = img.data;
  for (let i = 0; i < W * H; i++) { const dd = Math.sqrt(d1[i]); D[i * 4 + 3] = dd <= r - 0.5 ? 255 : dd >= r + 0.5 ? 0 : Math.round((r + 0.5 - dd) * 255); D[i * 4] = D[i * 4 + 1] = D[i * 4 + 2] = 255; }
  o.putImageData(img, 0, 0); return out;
}
export function makeSticker(src: HTMLCanvasElement, o: { size: number; border: number; color: string; shadow: boolean; pad: number }) {
  const b = contentBounds(src, 8); if (!b) return null;
  const S = o.size, pad = Math.round(S * o.pad), inner = S - 2 * pad, k = Math.min(inner / b.w, inner / b.h);
  const w = Math.max(1, Math.round(b.w * k)), hh = Math.max(1, Math.round(b.h * k));
  const art = makeCanvas(S, S), ax = ctx2d(art); ax.imageSmoothingQuality = 'high'; ax.drawImage(src, b.x, b.y, b.w, b.h, (S - w) / 2, (S - hh) / 2, w, hh);
  const out = makeCanvas(S, S), x = ctx2d(out);
  if (o.border > 0) {
    const ol = outlineAlpha(art, o.border), oc = makeCanvas(S, S), ox = ctx2d(oc); ox.drawImage(ol, 0, 0); ox.globalCompositeOperation = 'source-in'; ox.fillStyle = o.color; ox.fillRect(0, 0, S, S);
    if (o.shadow) { x.save(); x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = Math.max(2, S / 64); x.shadowOffsetY = Math.max(1, S / 128); x.drawImage(oc, 0, 0); x.restore(); } else x.drawImage(oc, 0, 0);
  } else if (o.shadow) { x.save(); x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = Math.max(2, S / 64); x.shadowOffsetY = Math.max(1, S / 128); x.drawImage(art, 0, 0); x.restore(); }
  x.drawImage(art, 0, 0);
  return out;
}
export function stickerDialog() {
  const d = app.doc, l = d?.activeRaster(); if (!d || !l) { app.toast('Elige la capa con el recorte', 'warn'); return; }
  const src = d.flatten();
  const opaque = (() => { const D = ctx2d(src).getImageData(0, 0, src.width, src.height).data; for (let i = 3; i < D.length; i += 4 * 97) if (D[i] < 250) return false; return true; })();
  let border = 14, pad = 6; const color = h('input', { type: 'color', value: '#ffffff', class: 'color-input' }) as HTMLInputElement;
  const shadow = chk('Sombra suave', true), size = sel([['512', '512 × 512 (WhatsApp, Telegram)'], ['1024', '1024 × 1024'], ['256', '256 × 256']], '512');
  const fmt = sel([['image/webp', 'WebP (WhatsApp)'], ['image/png', 'PNG']], 'image/webp');
  const pv = h('canvas', { class: 'gd-pv', width: 256, height: 256 }) as HTMLCanvasElement;
  const draw = () => { const s = makeSticker(src, { size: 256, border: border / 2, color: color.value, shadow: shadow.i.checked, pad: pad / 100 }); const x = ctx2d(pv); x.clearRect(0, 0, 256, 256); if (s) x.drawImage(s, 0, 0); };
  color.oninput = draw; shadow.i.onchange = draw; draw();
  const fix = h('button', { type: 'button', class: 'btn' }, 'Quitar el fondo primero'); fix.onclick = () => { document.querySelectorAll('.modal-overlay').forEach(e => e.remove()); import('./actions').then(m => m.actionById.get('removeBg')?.run()); };
  showDialog({
    title: 'Crear pegatina', okLabel: 'Guardar pegatina', width: 460,
    body: [h('div', { class: 'hint' }, opaque ? 'La imagen no tiene fondo transparente: quita antes el fondo para que la pegatina tenga la forma del recorte.' : 'Recorta lo que hay en la imagen, le pone un borde blanco como las pegatinas de verdad y la deja lista para WhatsApp o Telegram.'),
      ...(opaque ? [fix] : []), h('div', { class: 'gd-pv-wrap' }, pv),
      row('Borde', numberSlider({ min: 0, max: 40, value: border, unit: ' px', onInput: v => { border = v; draw(); } }).el), row('Color del borde', color),
      row('Margen', numberSlider({ min: 0, max: 20, value: pad, unit: '%', onInput: v => { pad = v; draw(); } }).el), shadow.el, row('Tamaño', size), row('Formato', fmt)],
    onOk: async () => {
      const S = +size.value, s = makeSticker(src, { size: S, border: border * S / 512, color: color.value, shadow: shadow.i.checked, pad: pad / 100 }); if (!s) { app.toast('La capa está vacía', 'warn'); return; }
      let type = fmt.value; const blob = await new Promise<Blob | null>(r => s.toBlob(r, type, 0.92));
      // si el navegador no sabe hacer WebP, sale PNG
      const ok = blob && blob.type === type; if (!ok) type = 'image/png';
      const final = ok ? blob! : await new Promise<Blob>(r => s.toBlob(b => r(b!), 'image/png'));
      const io = await import('../io/files');
      try { await io.saveBlob(final, `${safe(d.name)}-pegatina.${type === 'image/webp' ? 'webp' : 'png'}`); app.toast('Pegatina guardada'); } catch (e: any) { if (e?.name !== 'AbortError') app.toast(String(e?.message ?? e), 'warn'); }
    },
  });
}

// ---- tamaño para todas las redes ---------------------------------------------------------------
export const FORMATS: { id: string; name: string; w: number; h: number }[] = [
  { id: 'ig-post', name: 'Instagram publicación cuadrada', w: 1080, h: 1080 },
  { id: 'ig-portrait', name: 'Instagram vertical 4:5', w: 1080, h: 1350 },
  { id: 'story', name: 'Historia / Reels / TikTok 9:16', w: 1080, h: 1920 },
  { id: 'yt-thumb', name: 'Miniatura de YouTube', w: 1280, h: 720 },
  { id: 'yt-banner', name: 'Banner de YouTube', w: 2560, h: 1440 },
  { id: 'fb-post', name: 'Facebook publicación', w: 1200, h: 630 },
  { id: 'fb-cover', name: 'Facebook portada', w: 1640, h: 624 },
  { id: 'x-post', name: 'X (Twitter) publicación', w: 1600, h: 900 },
  { id: 'x-header', name: 'X (Twitter) cabecera', w: 1500, h: 500 },
  { id: 'li-post', name: 'LinkedIn publicación', w: 1200, h: 627 },
  { id: 'pin', name: 'Pinterest pin 2:3', w: 1000, h: 1500 },
  { id: 'wa-status', name: 'Estado de WhatsApp', w: 1080, h: 1920 },
  { id: 'avatar', name: 'Foto de perfil', w: 800, h: 800 },
  { id: 'wallpaper', name: 'Fondo de pantalla del móvil', w: 1440, h: 3200 },
  { id: 'hd', name: 'Pantalla Full HD 16:9', w: 1920, h: 1080 },
];
/** Adapta la imagen a otro tamaño: 'fill' recorta, 'blur' encaja con el fondo difuminado, 'color' encaja con un color. */
export function fitTo(src: HTMLCanvasElement, W: number, H: number, mode: string, color = '#ffffff', focus = { x: 0.5, y: 0.5 }) {
  const c = makeCanvas(W, H), x = ctx2d(c); x.imageSmoothingQuality = 'high';
  const cover = Math.max(W / src.width, H / src.height), contain = Math.min(W / src.width, H / src.height);
  const drawAt = (k: number, fx: number, fy: number) => { const w = src.width * k, hh = src.height * k; const dx = Math.min(0, Math.max(W - w, W / 2 - fx * w)), dy = Math.min(0, Math.max(H - hh, H / 2 - fy * hh)); x.drawImage(src, w > W ? dx : (W - w) / 2, hh > H ? dy : (H - hh) / 2, w, hh); };
  if (mode === 'fill') { drawAt(cover, focus.x, focus.y); return c; }
  if (mode === 'blur') { x.filter = `blur(${Math.round(Math.max(W, H) / 40)}px) brightness(0.85)`; drawAt(cover * 1.08, 0.5, 0.5); x.filter = 'none'; }
  else { x.fillStyle = color; x.fillRect(0, 0, W, H); }
  drawAt(contain, 0.5, 0.5); return c;
}
export function magicResizeDialog() {
  const d = app.doc; if (!d) return;
  const src = d.flatten();
  const chosen = new Set(['ig-post', 'ig-portrait', 'story', 'yt-thumb', 'fb-post', 'x-post']);
  const grid = h('div', { class: 'mr-grid' });
  for (const f of FORMATS) { const c = h('input', { type: 'checkbox', checked: chosen.has(f.id) }) as HTMLInputElement; c.onchange = () => { c.checked ? chosen.add(f.id) : chosen.delete(f.id); }; grid.append(h('label', { class: 'check' }, c, ` ${f.name} `, h('span', { class: 'mr-size' }, `${f.w}×${f.h}`))); }
  const mode = sel([['blur', 'Encajar entera con el fondo difuminado'], ['fill', 'Llenar (recorta lo que sobra)'], ['color', 'Encajar entera con un color de fondo']], 'blur');
  const col = h('input', { type: 'color', value: '#ffffff', class: 'color-input' }) as HTMLInputElement;
  const out = sel([['zip', 'Guardar todas en un ZIP'], ['docs', 'Abrir cada una como documento para retocarla']], 'zip');
  let fx = 50, fy = 50;
  showDialog({
    title: 'Tamaño para todas las redes', okLabel: 'Crear', width: 560,
    body: [h('div', { class: 'hint' }, 'Adapta la imagen de una vez a los tamaños de cada red social, sin estirarla.'), grid, row('Cómo adaptarla', mode), row('Color de fondo', col),
      row('Punto importante (horizontal)', numberSlider({ min: 0, max: 100, value: fx, unit: '%', onInput: v => { fx = v; } }).el), row('Punto importante (vertical)', numberSlider({ min: 0, max: 100, value: fy, unit: '%', onInput: v => { fy = v; } }).el),
      h('div', { class: 'hint' }, 'Al llenar, lo que esté en el punto importante se queda dentro del recorte (por ejemplo, una cara).'), row('Resultado', out)],
    onOk: async () => {
      const list = FORMATS.filter(f => chosen.has(f.id)); if (!list.length) { app.toast('Elige al menos un tamaño', 'warn'); return false; }
      if (out.value === 'docs') { for (const f of list) { const nd = new EditorDocument(`${d.name} ${f.w}x${f.h}`, f.w, f.h), l = new RasterLayer('Fondo', f.w, f.h); ctx2d(l.canvas).drawImage(fitTo(src, f.w, f.h, mode.value, col.value, { x: fx / 100, y: fy / 100 }), 0, 0); nd.root.add(l); app.addDocument(nd, 'Tamaño para redes'); } app.toast(`${list.length} documentos creados`); return; }
      const files = []; for (const f of list) files.push({ name: `${safe(d.name)}_${f.id}_${f.w}x${f.h}.jpg`, data: await pngBytes(fitTo(src, f.w, f.h, mode.value, col.value, { x: fx / 100, y: fy / 100 }), 'image/jpeg', 0.92) });
      await saveZip(files, `${safe(d.name)}-redes.zip`, `${files.length} imágenes creadas`);
    },
  });
}

// ---- carrusel panorámico ------------------------------------------------------------------------
export function splitCarousel(src: HTMLCanvasElement, n: number, W: number, H: number) {
  // la imagen entera se escala para que su alto llene el de las piezas y se reparte en n piezas seguidas
  const total = makeCanvas(W * n, H), tx = ctx2d(total); tx.imageSmoothingQuality = 'high';
  const k = Math.max(W * n / src.width, H / src.height), w = src.width * k, hh = src.height * k; tx.drawImage(src, (W * n - w) / 2, (H - hh) / 2, w, hh);
  const out: HTMLCanvasElement[] = []; for (let i = 0; i < n; i++) { const c = makeCanvas(W, H); ctx2d(c).drawImage(total, i * W, 0, W, H, 0, 0, W, H); out.push(c); }
  return out;
}
export function carouselDialog() {
  const d = app.doc; if (!d) return;
  const src = d.flatten(), auto = Math.max(2, Math.min(10, Math.round(src.width / src.height / (4 / 5))));
  let n = auto; const shape = sel([['1080x1350', 'Vertical 4:5 (1080 × 1350, se ve más grande)'], ['1080x1080', 'Cuadrado (1080 × 1080)']], '1080x1350');
  const pv = h('canvas', { class: 'gd-pv', width: 480, height: 120 }) as HTMLCanvasElement;
  const draw = () => { const [W, H] = shape.value.split('x').map(Number), parts = splitCarousel(src, n, W / 10, H / 10), x = ctx2d(pv); pv.width = parts.length * (W / 10 + 4); pv.height = H / 10; x.clearRect(0, 0, pv.width, pv.height); parts.forEach((p, i) => x.drawImage(p, i * (W / 10 + 4), 0)); };
  shape.onchange = draw; draw();
  showDialog({
    title: 'Carrusel panorámico', okLabel: 'Crear', width: 560,
    body: [h('div', { class: 'hint' }, 'Parte una foto ancha (una panorámica, un paisaje) en varias fotos seguidas: al pasarlas en el carrusel de Instagram se ve como una sola imagen continua.'),
      h('div', { class: 'gd-pv-wrap' }, pv), row('Fotos', numberSlider({ min: 2, max: 10, value: n, onInput: v => { n = v; draw(); } }).el), row('Forma', shape)],
    onOk: async () => { const [W, H] = shape.value.split('x').map(Number), parts = splitCarousel(src, n, W, H), files = []; for (let i = 0; i < parts.length; i++) files.push({ name: `${safe(d.name)}_carrusel_${i + 1}.jpg`, data: await pngBytes(parts[i], 'image/jpeg', 0.92) }); await saveZip(files, `${safe(d.name)}-carrusel.zip`, `${files.length} fotos para el carrusel`); },
  });
}

// ---- antes y después ------------------------------------------------------------------------------
/** Imagen del documento tal como estaba al abrirlo (primer paso del historial). */
export function beforeImage(d: EditorDocument): HTMLCanvasElement {
  const cur = d.history.index; if (cur <= 0) return d.flatten();
  d.gotoHistory(0); const before = d.flatten(); const c = makeCanvas(before.width, before.height); ctx2d(c).drawImage(before, 0, 0);
  d.gotoHistory(cur); return c;
}
function label(x: CanvasRenderingContext2D, t: string, px: number, py: number, s: number) { x.save(); x.font = `600 ${s}px system-ui, sans-serif`; const w = x.measureText(t).width; x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(px, py, w + s, s * 1.6); x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.fillText(t, px + s / 2, py + s * 0.8); x.restore(); }
export function beforeAfterImage(a: HTMLCanvasElement, b: HTMLCanvasElement, layout: string, labels: [string, string] | null) {
  const W = a.width, H = a.height, v = layout === 'v', c = makeCanvas(v ? W : W * 2, v ? H * 2 : H), x = ctx2d(c);
  if (layout === 'split') { const s = makeCanvas(W, H), sx = ctx2d(s); sx.drawImage(b, 0, 0); sx.drawImage(a, 0, 0, W / 2, H, 0, 0, W / 2, H); sx.fillStyle = '#fff'; sx.fillRect(W / 2 - Math.max(1, W / 400), 0, Math.max(2, W / 200), H); if (labels) { const fs = Math.round(Math.max(14, W / 40)); label(sx, labels[0], fs / 2, fs / 2, fs); label(sx, labels[1], W / 2 + fs / 2, fs / 2, fs); } return s; }
  x.drawImage(a, 0, 0); x.drawImage(b, v ? 0 : W, v ? H : 0);
  if (labels) { const fs = Math.round(Math.max(14, Math.min(W, H) / 22)); label(x, labels[0], fs / 2, fs / 2, fs); label(x, labels[1], (v ? 0 : W) + fs / 2, (v ? H : 0) + fs / 2, fs); }
  return c;
}
export function beforeAfterDialog() {
  const d = app.doc; if (!d) return;
  if (d.history.index <= 0) { app.toast('Aún no has cambiado nada: edita la foto y vuelve aquí', 'warn'); return; }
  const layout = sel([['h', 'Una al lado de la otra'], ['v', 'Una encima de la otra'], ['split', 'Partida por la mitad (antes a la izquierda)'], ['gif', 'Animación: cortinilla que pasa de antes a después (GIF)']], 'h');
  const lab = chk('Poner «Antes» y «Después»', true);
  showDialog({
    title: 'Antes y después', okLabel: 'Crear', width: 460,
    body: [h('div', { class: 'hint' }, 'Compara la foto original (como estaba al abrirla) con el resultado, para enseñar el retoque.'), row('Cómo', layout), lab.el],
    onOk: async () => {
      const a = beforeImage(d), b = d.flatten(), L: [string, string] | null = lab.i.checked ? [t('Antes'), t('Después')] : null;
      const io = await import('../io/files');
      // en grande se reduce para que el archivo no pese demasiado
      const k = Math.min(1, 1600 / Math.max(a.width, a.height)), sc = (c: HTMLCanvasElement) => { if (k === 1) return c; const n = makeCanvas(Math.round(c.width * k), Math.round(c.height * k)); const x = ctx2d(n); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, n.width, n.height); return n; };
      const A = sc(a), B = sc(b);
      try {
        if (layout.value === 'gif') {
          const fr: { canvas: HTMLCanvasElement; delay: number }[] = [], N = 16;
          for (let i = 0; i <= N; i++) { const t = i / N, e = t * t * (3 - 2 * t), c = makeCanvas(A.width, A.height), x = ctx2d(c), cut = Math.round(A.width * e); x.drawImage(A, 0, 0); x.drawImage(B, 0, 0, cut, B.height, 0, 0, cut, B.height); if (i > 0 && i < N) { x.fillStyle = '#fff'; x.fillRect(cut - 1, 0, 3, A.height); } fr.push({ canvas: c, delay: i === 0 || i === N ? 900 : 60 }); }
          const { encodeGif } = await import('../io/gif'); await io.saveBlob(encodeGif(fr), `${safe(d.name)}-antes-despues.gif`);
        } else await io.saveBlob(await new Promise<Blob>(r => beforeAfterImage(A, B, layout.value, L).toBlob(x => r(x!), 'image/jpeg', 0.92)), `${safe(d.name)}-antes-despues.jpg`);
        app.toast('Antes y después guardado');
      } catch (e: any) { if (e?.name !== 'AbortError') app.toast(String(e?.message ?? e), 'warn'); }
    },
  });
}

// ---- foto en movimiento ---------------------------------------------------------------------------
/** Un fotograma del bucle: la zona que se mueve se desplaza en la dirección elegida; dos copias desfasadas se mezclan
 *  para que el último fotograma enlace con el primero sin salto. */
export function flowFrame(src: HTMLCanvasElement, mask: HTMLCanvasElement | null, t: number, dx: number, dy: number) {
  const W = src.width, H = src.height, out = makeCanvas(W, H), x = ctx2d(out); x.drawImage(src, 0, 0);
  const mv = makeCanvas(W, H), m = ctx2d(mv);
  const draw = (ph: number, a: number) => {
    m.globalAlpha = a; const ox = dx * ph, oy = dy * ph;
    // repetido en mosaico para que no queden huecos al desplazar
    for (const kx of [-1, 0, 1]) for (const ky of [-1, 0, 1]) { if ((kx && !dx) || (ky && !dy)) continue; m.drawImage(src, ox + kx * W, oy + ky * H); }
  };
  const p1 = t % 1, p2 = (t + 0.5) % 1, w1 = 1 - Math.abs(2 * p1 - 1);
  draw(p1 - 0.5, 1); m.globalAlpha = 1; const tmp = makeCanvas(W, H), tx = ctx2d(tmp); tx.drawImage(mv, 0, 0); m.clearRect(0, 0, W, H);
  draw(p2 - 0.5, 1); m.globalAlpha = 1;
  // mezcla: la copia 1 pesa w1 y la copia 2 el resto
  m.globalAlpha = w1; m.drawImage(tmp, 0, 0); m.globalAlpha = 1;
  if (mask) { m.globalCompositeOperation = 'destination-in'; m.drawImage(mask, 0, 0); m.globalCompositeOperation = 'source-over'; }
  x.drawImage(mv, 0, 0); return out;
}
/** Selección a tamaño W×H con el borde suavizado; en los bordes de la foto no se difumina (se alarga la máscara hacia fuera). */
export function softMask(mask: HTMLCanvasElement, W: number, H: number, r: number) {
  const P = Math.ceil(r * 3) + 1, big = makeCanvas(W + 2 * P, H + 2 * P), b = ctx2d(big);
  const m = makeCanvas(W, H); ctx2d(m).drawImage(mask, 0, 0, W, H);
  b.drawImage(m, P, P);
  b.drawImage(m, 0, 0, 1, H, 0, P, P, H); b.drawImage(m, W - 1, 0, 1, H, P + W, P, P, H);
  b.drawImage(big, 0, P, W + 2 * P, 1, 0, 0, W + 2 * P, P); b.drawImage(big, 0, P + H - 1, W + 2 * P, 1, 0, P + H, W + 2 * P, P);
  const c = makeCanvas(W, H), x = ctx2d(c); x.filter = `blur(${r}px)`; x.drawImage(big, -P, -P); x.filter = 'none'; return c;
}
export function cinemagraphDialog() {
  const d = app.doc; if (!d) return;
  const hasSel = d.selection.active;
  let frames = 20, dist = 6, angle = 0, feather = 12, fps = 15;
  const pv = h('canvas', { class: 'gd-pv' }) as HTMLCanvasElement;
  const base = d.flatten(), k0 = Math.min(1, 320 / Math.max(base.width, base.height)), pw = Math.max(1, Math.round(base.width * k0)), ph = Math.max(1, Math.round(base.height * k0));
  pv.width = pw; pv.height = ph;
  const small = makeCanvas(pw, ph); ctx2d(small).drawImage(base, 0, 0, pw, ph);
  const maskFor = (W: number, H: number, k: number) => d.selection.mask ? softMask(d.selection.mask, W, H, Math.max(0.5, feather * k)) : null;
  let ph0 = 0, timer = 0; const smallMask = () => maskFor(pw, ph, k0);
  let sm = smallMask();
  const tick = () => { const W = pw, ddx = Math.cos(angle * Math.PI / 180) * dist / 100 * W, ddy = Math.sin(angle * Math.PI / 180) * dist / 100 * W; ctx2d(pv).drawImage(flowFrame(small, sm, ph0, ddx, ddy), 0, 0); ph0 = (ph0 + 1 / frames) % 1; timer = window.setTimeout(tick, 1000 / fps); };
  tick();
  const dir = sel([['0', 'Hacia la derecha'], ['180', 'Hacia la izquierda'], ['90', 'Hacia abajo (cascada)'], ['270', 'Hacia arriba (humo, vapor)'], ['45', 'En diagonal hacia abajo']], '0'); dir.onchange = () => { angle = +dir.value; };
  showDialog({
    title: 'Foto en movimiento', okLabel: 'Crear animación', width: 520,
    body: [h('div', { class: 'hint' }, hasSel ? 'Lo seleccionado (agua, nubes, humo…) fluye en bucle y el resto se queda quieto. Luego expórtalo con Juegos › Animación › Exportar animación (GIF o vídeo).' : 'Consejo: selecciona antes lo que quieres que se mueva (el agua, el cielo…) con el lazo o la selección rápida. Sin selección se mueve toda la foto.'),
      h('div', { class: 'gd-pv-wrap' }, pv), row('Dirección', dir),
      row('Recorrido', numberSlider({ min: 1, max: 30, value: dist, unit: '%', onInput: v => { dist = v; } }).el),
      row('Fotogramas', numberSlider({ min: 6, max: 48, value: frames, onInput: v => { frames = v; } }).el),
      row('Velocidad', numberSlider({ min: 4, max: 30, value: fps, unit: ' fps', onInput: v => { fps = v; } }).el),
      ...(hasSel ? [row('Borde suave', numberSlider({ min: 0, max: 60, value: feather, unit: ' px', onInput: v => { feather = v; sm = smallMask(); } }).el)] : [])],
    onCancel: () => clearTimeout(timer),
    onOk: () => {
      clearTimeout(timer);
      // las fotos grandes se reducen (cada fotograma es una imagen entera)
      const k = Math.min(1, 1280 / Math.max(base.width, base.height)), W = Math.round(base.width * k), H = Math.round(base.height * k);
      const src = makeCanvas(W, H); { const x = ctx2d(src); x.imageSmoothingQuality = 'high'; x.drawImage(base, 0, 0, W, H); }
      const mask = maskFor(W, H, k), ddx = Math.cos(angle * Math.PI / 180) * dist / 100 * W, ddy = Math.sin(angle * Math.PI / 180) * dist / 100 * W;
      const nd = new EditorDocument(`${d.name} en movimiento`, W, H), bg = new RasterLayer('Fondo', W, H); ctx2d(bg.canvas).drawImage(src, 0, 0); nd.root.add(bg);
      for (let i = 0; i < frames; i++) {
        const l = new RasterLayer(`Fotograma ${i + 1}`, W, H), f = flowFrame(src, mask, i / frames, ddx, ddy), x = ctx2d(l.canvas);
        // en cada fotograma solo se guarda la zona que se mueve (el fondo quieto es común a todos)
        x.drawImage(f, 0, 0); if (mask) { x.globalCompositeOperation = 'destination-in'; x.drawImage(mask, 0, 0); x.globalCompositeOperation = 'source-over'; }
        l.visible = i === 0; nd.root.add(l); nd.frames.push({ delay: Math.round(1000 / fps), visible: [bg.id, l.id], own: l.id });
      }
      nd.frameIndex = 0;
      app.addDocument(nd, 'Foto en movimiento');
      import('./anim').then(m => { if (!m.dockShown()) m.toggleAnimDock(); });
      app.toast(`${frames} fotogramas creados: pulsa reproducir para verlo`);
    },
  });
}

// ---- rotar pixel art -------------------------------------------------------------------------------
/** Rotación de pixel art al estilo RotSprite: se amplía ×8 con Scale2x (bordes limpios), se gira sin suavizar y se
 *  reduce eligiendo el color más repetido de cada bloque: no aparecen colores nuevos ni píxeles sueltos. */
export async function rotSprite(src: HTMLCanvasElement, deg: number): Promise<HTMLCanvasElement> {
  const { scale2x } = await import('./gamextra');
  let big = src; for (let i = 0; i < 3; i++) big = scale2x(big);
  const W = src.width, H = src.height, K = 8, rad = deg * Math.PI / 180;
  const rot = makeCanvas(W * K, H * K), rx = ctx2d(rot); rx.imageSmoothingEnabled = false;
  rx.translate(W * K / 2, H * K / 2); rx.rotate(rad); rx.drawImage(big, -W * K / 2, -H * K / 2);
  const D = rx.getImageData(0, 0, W * K, H * K).data, out = makeCanvas(W, H), o = ctx2d(out), img = o.createImageData(W, H), O = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const cnt = new Map<number, number>(); let empty = 0;
    // se mira el centro de cada bloque (los bordes del bloque suelen ser de los vecinos)
    for (let j = 2; j < 6; j++) for (let i = 2; i < 6; i++) { const p = ((y * K + j) * W * K + x * K + i) * 4; if (D[p + 3] < 128) { empty++; continue; } const key = (D[p] << 16) | (D[p + 1] << 8) | D[p + 2]; cnt.set(key, (cnt.get(key) ?? 0) + 1); }
    let best = -1, bn = 0; for (const [kk, n] of cnt) if (n > bn) { bn = n; best = kk; }
    if (best < 0 || empty > bn) continue;
    const q = (y * W + x) * 4; O[q] = best >> 16; O[q + 1] = (best >> 8) & 255; O[q + 2] = best & 255; O[q + 3] = 255;
  }
  o.putImageData(img, 0, 0); return out;
}
export function rotSpriteDialog() {
  const d = app.doc, l = d?.activeRaster(); if (!d || !l) { app.toast('Elige una capa de píxeles', 'warn'); return; }
  // solo se trabaja con lo dibujado (en un cuadrado donde cabe girado), no con la capa entera
  const b = contentBounds(l.canvas, 0); if (!b) { app.toast('La capa está vacía', 'warn'); return; }
  const S = Math.ceil(Math.hypot(b.w, b.h)) + 2;
  if (S > 384) { app.toast('Es demasiado grande para girarlo como pixel art: usa Edición › Transformar', 'warn'); return; }
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, ox = Math.round(cx - S / 2), oy = Math.round(cy - S / 2);
  const crop = makeCanvas(S, S); ctx2d(crop).drawImage(l.canvas, b.x, b.y, b.w, b.h, b.x - ox, b.y - oy, b.w, b.h);
  let deg = 45;
  const pv = h('canvas', { class: 'gd-pv' }) as HTMLCanvasElement, k = Math.max(1, Math.floor(240 / S));
  pv.width = S * k; pv.height = S * k;
  let busy = 0, timer = 0;
  const draw = () => { clearTimeout(timer); timer = window.setTimeout(async () => { const my = ++busy; const r = await rotSprite(crop, deg); if (my !== busy) return; const x = ctx2d(pv); x.imageSmoothingEnabled = false; x.clearRect(0, 0, pv.width, pv.height); x.drawImage(r, 0, 0, pv.width, pv.height); }, 40); };
  draw();
  showDialog({
    title: 'Rotar pixel art', okLabel: 'Girar', width: 440,
    body: [h('div', { class: 'hint' }, 'Gira la capa sin que el dibujo se llene de píxeles sueltos ni de colores nuevos (como RotSprite).'), h('div', { class: 'gd-pv-wrap' }, pv),
      row('Ángulo', numberSlider({ min: -180, max: 180, value: deg, unit: '°', onInput: v => { deg = v; draw(); } }).el)],
    onCancel: () => clearTimeout(timer),
    onOk: async () => {
      clearTimeout(timer); const r = await rotSprite(crop, deg), x = ctx2d(l.canvas);
      x.clearRect(b.x, b.y, b.w, b.h); x.drawImage(r, ox, oy);
      l.touch(); d.invalidate(); d.commit(`Rotar pixel art ${deg}°`);
    },
  });
}
