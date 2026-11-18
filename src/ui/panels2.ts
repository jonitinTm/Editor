// Paneles Navegador, Histograma e Información.

import { app } from './app';
import { h } from './dom';
import { ctx2d, makeCanvas, cloneCanvas } from '../core/canvas';
import { composeStyled } from '../core/compositor';
import { STYLE_PRESETS, userStyles, saveUserStyles } from '../core/stylepresets';
import { hasStyles, type LayerStyles } from '../core/layers';
import * as ops from './ops';
import * as M from './macros';
import { icon } from './icons';
import { actionById } from './actions';
import { promptDialog, showDialog, row } from './dialog';

const visible = (el: HTMLElement) => el.offsetParent !== null;

export function buildNavigatorPanel(parent: HTMLElement) {
  const cv = h('canvas', { class: 'nav-canvas' }), ctx = cv.getContext('2d')!;
  const zoom = h('input', { type: 'range', min: '-460', max: '415', step: '1', class: 'nav-zoom', title: 'Zoom' });
  const pct = h('span', { class: 'nav-pct' });
  const body = h('div', { class: 'panel-body nav' }, cv, h('div', { class: 'nav-bar' }, h('button', { class: 'btn icon-btn', title: 'Alejar', onclick: () => app.viewport.zoomStep(-1) }, '−'), zoom, h('button', { class: 'btn icon-btn', title: 'Acercar', onclick: () => app.viewport.zoomStep(1) }, '+'), pct));
  parent.append(body);
  let thumb: HTMLCanvasElement | null = null, k = 1, ox = 0, oy = 0;
  const layout = () => {
    const d = app.doc; if (!d) return;
    const W = Math.max(60, body.clientWidth - 16), H = 150;
    k = Math.min(W / d.width, H / d.height); const tw = Math.round(d.width * k), th = Math.round(d.height * k);
    cv.width = W; cv.height = H; ox = Math.round((W - tw) / 2); oy = Math.round((H - th) / 2);
  };
  const renderThumb = () => {
    const d = app.doc; if (!d || !visible(body)) return;
    layout();
    thumb = document.createElement('canvas'); thumb.width = Math.max(1, Math.round(d.width * k)); thumb.height = Math.max(1, Math.round(d.height * k));
    const t = ctx2d(thumb); t.imageSmoothingQuality = 'high'; t.drawImage(d.getComposite(), 0, 0, thumb.width, thumb.height);
    renderView();
  };
  const renderView = () => {
    const d = app.doc;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!d || !thumb) return;
    ctx.fillStyle = '#fff'; ctx.fillRect(ox, oy, thumb.width, thumb.height); ctx.drawImage(thumb, ox, oy);
    const vp = app.viewport, q = [vp.toDoc(0, 0), vp.toDoc(vp.width, 0), vp.toDoc(vp.width, vp.height), vp.toDoc(0, vp.height)];
    ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 2; ctx.beginPath();
    q.forEach((p, i) => i ? ctx.lineTo(ox + p.x * k, oy + p.y * k) : ctx.moveTo(ox + p.x * k, oy + p.y * k)); ctx.closePath(); ctx.stroke();
    zoom.value = String(Math.round(Math.log2(d.view.zoom) * 100)); pct.textContent = Math.round(d.view.zoom * 1000) / 10 + ' %';
  };
  // Arrastrar en la miniatura mueve la vista
  const go = (e: PointerEvent) => {
    const d = app.doc; if (!d) return;
    const x = (e.offsetX - ox) / k, y = (e.offsetY - oy) / k, vp = app.viewport;
    vp.placeDocPoint(x, y, { x: vp.width / 2, y: vp.height / 2 });
    vp.requestRender(); app.emit('view');
  };
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); go(e); });
  cv.addEventListener('pointermove', e => { if (e.buttons) go(e); });
  zoom.addEventListener('input', () => app.viewport.setZoom(Math.pow(2, +zoom.value / 100), null));
  let t = 0;
  app.on('doc', () => { clearTimeout(t); t = window.setTimeout(renderThumb, 250); });
  app.on('docs', renderThumb);
  app.on('view', renderView);
  new MutationObserver(() => { if (visible(body)) renderThumb(); }).observe(parent, { attributes: true, attributeFilter: ['class'] });
}

export function buildHistogramPanel(parent: HTMLElement) {
  const cv = h('canvas', { class: 'hist-canvas', width: 256, height: 110 }), ctx = cv.getContext('2d')!;
  const chSel = h('select', {}, h('option', { value: 'colors' }, 'Colores'), h('option', { value: 'lum' }, 'Luminosidad'), h('option', { value: 'r' }, 'Rojo'), h('option', { value: 'g' }, 'Verde'), h('option', { value: 'b' }, 'Azul'));
  const stats = h('div', { class: 'hist-stats' });
  const body = h('div', { class: 'panel-body histo' }, h('div', { class: 'prop-row' }, h('span', {}, 'Canal'), chSel), cv, stats);
  parent.append(body);
  const render = () => {
    const d = app.doc; if (!d || !visible(body)) return;
    const data = d.getComposite().getContext('2d')!.getImageData(0, 0, d.width, d.height).data;
    const H = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    const step = Math.max(1, Math.floor(data.length / 4 / 500000)) * 4; let n = 0;
    for (let i = 0; i < data.length; i += step) { if (data[i + 3] === 0) continue; H[0][data[i]]++; H[1][data[i + 1]]++; H[2][data[i + 2]]++; H[3][Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])]++; n++; }
    ctx.fillStyle = '#1b1c1f'; ctx.fillRect(0, 0, 256, 110);
    const ch = chSel.value;
    const list = ch === 'colors' ? [[0, 'rgba(255,60,60,.7)'], [1, 'rgba(60,220,60,.7)'], [2, 'rgba(70,120,255,.7)']] : [[{ lum: 3, r: 0, g: 1, b: 2 }[ch]!, ch === 'lum' ? '#ddd' : ch === 'r' ? '#ff5a5a' : ch === 'g' ? '#4cd964' : '#4ea1ff']];
    let max = 1; for (const [c] of list) for (let i = 1; i < 255; i++) max = Math.max(max, H[c as number][i]);
    ctx.globalCompositeOperation = ch === 'colors' ? 'lighter' : 'source-over';
    for (const [c, col] of list) { ctx.fillStyle = col as string; for (let i = 0; i < 256; i++) { const v = Math.min(110, H[c as number][i] / max * 105); ctx.fillRect(i, 110 - v, 1, v); } }
    ctx.globalCompositeOperation = 'source-over';
    const L = H[ch === 'r' ? 0 : ch === 'g' ? 1 : ch === 'b' ? 2 : 3];
    let sum = 0, sq = 0, med = 0, acc = 0; for (let i = 0; i < 256; i++) { sum += i * L[i]; sq += i * i * L[i]; }
    for (let i = 0; i < 256; i++) { acc += L[i]; if (acc >= n / 2) { med = i; break; } }
    const mean = n ? sum / n : 0, dev = n ? Math.sqrt(Math.max(0, sq / n - mean * mean)) : 0;
    stats.innerHTML = '';
    stats.append(...[['Media', mean.toFixed(2)], ['Desv. típica', dev.toFixed(2)], ['Mediana', String(med)], ['Píxeles', (d.width * d.height).toLocaleString('es')]].map(([a, b]) => h('div', {}, h('span', {}, a), h('b', {}, b))));
  };
  chSel.onchange = render;
  let t = 0;
  app.on('doc', () => { clearTimeout(t); t = window.setTimeout(render, 400); });
  app.on('docs', render);
  new MutationObserver(() => { if (visible(body)) render(); }).observe(parent, { attributes: true, attributeFilter: ['class'] });
}

export function buildInfoPanel(parent: HTMLElement) {
  const body = h('div', { class: 'panel-body info' });
  parent.append(body);
  const row = (a: string, b: string, color?: string) => h('div', { class: 'info-row' }, h('span', {}, a), color ? h('i', { class: 'info-sw', style: { background: color } }) : null, h('b', {}, b));
  const render = () => {
    const d = app.doc; if (!visible(body)) return;
    body.innerHTML = '';
    if (!d) { body.append(h('div', { class: 'hint' }, 'Sin documento')); return; }
    const m = app.viewport.mouse;
    if (m && m.x >= 0 && m.y >= 0 && m.x < d.width && m.y < d.height) {
      const c = d.getComposite().getContext('2d')!.getImageData(Math.floor(m.x), Math.floor(m.y), 1, 1).data;
      const hex = '#' + [c[0], c[1], c[2]].map(v => v.toString(16).padStart(2, '0')).join('');
      const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
      let hue = 0; if (mx !== mn) hue = mx === c[0] ? ((c[1] - c[2]) / (mx - mn) + 6) % 6 : mx === c[1] ? (c[2] - c[0]) / (mx - mn) + 2 : (c[0] - c[1]) / (mx - mn) + 4;
      body.append(row('R G B', `${c[0]}  ${c[1]}  ${c[2]}`, hex), row('Hex', hex), row('H S B', `${Math.round(hue * 60)}°  ${mx ? Math.round((mx - mn) / mx * 100) : 0}%  ${Math.round(mx / 2.55)}%`), row('Opacidad', Math.round(c[3] / 2.55) + ' %'));
      body.append(row('X', Math.floor(m.x) + ' px'), row('Y', Math.floor(m.y) + ' px'));
    } else body.append(h('div', { class: 'hint' }, 'Pasa el ratón por la imagen para ver el color y la posición.'));
    const smp = (d as any).samplers as { x: number; y: number }[] | undefined;
    if (smp?.length) {
      body.append(h('div', { class: 'info-sep' }));
      const comp = d.getComposite().getContext('2d')!;
      smp.forEach((q, i) => { const c = comp.getImageData(Math.max(0, Math.min(d.width - 1, q.x)), Math.max(0, Math.min(d.height - 1, q.y)), 1, 1).data; const hex = '#' + [c[0], c[1], c[2]].map(v => v.toString(16).padStart(2, '0')).join(''); body.append(row(`Muestra ${i + 1}`, `${c[0]}  ${c[1]}  ${c[2]}  ${hex}`, hex)); });
    }
    const b = d.selection.bounds;
    body.append(h('div', { class: 'info-sep' }), row('Documento', `${d.width} × ${d.height} px`), row('Selección', b ? `${b.w} × ${b.h} px en (${b.x}, ${b.y})` : '—'), row('Capa', d.active?.name ?? '—'));
  };
  app.on('view', render); app.on('doc', render); app.on('docs', render);
  new MutationObserver(() => render()).observe(parent, { attributes: true, attributeFilter: ['class'] });
}

// ---- Canales ----------------------------------------------------------------------------

export function buildChannelsPanel(parent: HTMLElement) {
  const list = h('div', { class: 'layer-list' });
  const btn = (title: string, label: string, fn: () => void) => h('button', { class: 'btn icon-btn', title, onclick: fn }, label);
  const foot = h('div', { class: 'panel-foot' },
    btn('Cargar el canal seleccionado como selección', '◌', () => { if (selId) ops.loadChannel(selId); }),
    btn('Guardar la selección como canal nuevo', '＋', () => ops.saveSelectionAsChannel()),
    btn('Eliminar el canal seleccionado', '🗑', () => { if (selId) { ops.deleteChannel(selId); selId = 0; } }));
  const body = h('div', { class: 'panel-body layers' }, list, foot);
  parent.append(body);
  let selId = 0;
  const thumb = (draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) => {
    const d = app.doc!, k = Math.min(36 / d.width, 36 / d.height);
    const c = h('canvas', { class: 'thumb', width: Math.max(1, Math.round(d.width * k)), height: Math.max(1, Math.round(d.height * k)) });
    draw(c.getContext('2d')!, c.width, c.height); return c;
  };
  const render = () => {
    const d = app.doc; list.innerHTML = ''; if (!d || !visible(body)) return;
    const comp = d.getComposite();
    const chan = (name: string, idx: number) => h('div', { class: 'layer-row ch-row' }, h('span', { class: 'eye' }), thumb((c, w, hh) => {
      c.drawImage(comp, 0, 0, w, hh);
      if (idx < 0) return;
      const img = c.getImageData(0, 0, w, hh), dd = img.data;
      for (let i = 0; i < dd.length; i += 4) { const v = dd[i + idx]; dd[i] = dd[i + 1] = dd[i + 2] = v; dd[i + 3] = 255; }
      c.putImageData(img, 0, 0);
    }), h('span', { class: 'lname' }, name));
    list.append(chan('RGB', -1), chan('Rojo', 0), chan('Verde', 1), chan('Azul', 2));
    for (const c of d.channels) {
      const row = h('div', { class: 'layer-row' + (c.id === selId ? ' active' : ''), title: 'Clic: seleccionar · Ctrl+clic o doble clic en la miniatura: cargar como selección · Doble clic en el nombre: renombrar' },
        h('span', { class: 'eye' }), thumb((x, w, hh) => { x.fillStyle = '#000'; x.fillRect(0, 0, w, hh); x.drawImage(c.canvas, 0, 0, w, hh); }), h('span', { class: 'lname' }, c.name));
      row.onclick = e => { selId = c.id; if (e.ctrlKey || e.metaKey) ops.loadChannel(c.id); else render(); };
      row.querySelector('canvas')!.addEventListener('dblclick', () => ops.loadChannel(c.id));
      row.querySelector('.lname')!.addEventListener('dblclick', async () => { const n = await promptDialog('Cambiar nombre de canal', 'Nombre', c.name); if (n !== null) ops.renameChannel(c.id, n); });
      list.append(row);
    }
    if (!d.channels.length) list.append(h('div', { class: 'hint ch-empty' }, 'Guarda una selección (Selección › Guardar selección) para crear un canal alfa.'));
  };
  let t = 0;
  app.on('doc', () => { clearTimeout(t); t = window.setTimeout(render, 200); }); app.on('docs', render);
  new MutationObserver(() => render()).observe(parent, { attributes: true, attributeFilter: ['class'] });
}

// ---- Acciones ----------------------------------------------------------------------------

export function buildActionsPanel(parent: HTMLElement) {
  const list = h('div', { class: 'layer-list act-list' });
  let sel = 0;
  const open = new Set<string>();
  const recBtn = h('button', { class: 'btn icon-btn rec', title: 'Grabar una acción nueva' }, '●');
  const stopBtn = h('button', { class: 'btn icon-btn', title: 'Detener la grabación' }, '■');
  const playBtn = h('button', { class: 'btn icon-btn', title: 'Reproducir la acción seleccionada' }, '▶');
  const delBtn = h('button', { class: 'btn icon-btn', title: 'Eliminar la acción seleccionada' }, '🗑');
  const batchBtn = h('button', { class: 'btn', title: 'Aplicar a muchas imágenes' }, 'Lote…');
  recBtn.onclick = async () => { const n = await promptDialog('Nueva acción', 'Nombre', 'Acción ' + (M.macros().filter(m => !m.builtin).length + 1)); if (n !== null) { M.startRecording(n || 'Acción'); sel = 0; app.toast('Grabando: lo que hagas ahora (filtros, ajustes, tamaño, giros, capas…) se añadirá a la acción'); } };
  stopBtn.onclick = () => M.stopRecording();
  playBtn.onclick = () => { const m = M.macros()[sel]; if (m) M.play(m); };
  delBtn.onclick = () => { const m = M.macros()[sel]; if (m && !m.builtin) { M.deleteMacro(m); sel = 0; } else app.toast('Las acciones incluidas no se pueden eliminar', 'warn'); };
  batchBtn.onclick = () => actionById.get('batch')!.run();
  const foot = h('div', { class: 'panel-foot' }, batchBtn, h('span', { style: { flex: '1' } }), stopBtn, recBtn, playBtn, delBtn);
  const body = h('div', { class: 'panel-body layers' }, list, foot);
  parent.append(body);
  const render = () => {
    if (!visible(body)) return;
    list.innerHTML = '';
    M.macros().forEach((m, i) => {
      const isRec = M.recording === m;
      const arrow = h('button', { class: 'arrow', html: icon(open.has(m.name) ? 'chevronDown' : 'chevronRight') });
      arrow.onclick = e => { e.stopPropagation(); open.has(m.name) ? open.delete(m.name) : open.add(m.name); render(); };
      const row = h('div', { class: 'layer-row act-row' + (i === sel ? ' active' : '') }, arrow, h('span', { class: 'lname' }, m.name), isRec ? h('span', { class: 'rec-dot', title: 'Grabando' }, '●') : null, m.builtin ? h('span', { class: 'hint' }, 'incluida') : null);
      row.onclick = () => { sel = i; render(); };
      row.ondblclick = () => M.play(m);
      list.append(row);
      if (open.has(m.name) || isRec) for (const s of m.steps) list.append(h('div', { class: 'act-step' }, s.label));
    });
    recBtn.classList.toggle('on', !!M.recording); stopBtn.disabled = !M.recording;
  };
  app.on('doc', render); app.on('docs', render);
  new MutationObserver(() => render()).observe(parent, { attributes: true, attributeFilter: ['class'] });
}

// ---- Trazados ------------------------------------------------------------------------------

export function buildPathsPanel(parent: HTMLElement) {
  const list = h('div', { class: 'layer-list' });
  const act = (fn: (i: number) => void) => () => { const d = app.doc; if (d && d.activePath >= 0) fn(d.activePath); else app.toast('Selecciona un trazado', 'warn'); };
  const btn = (title: string, label: string, fn: () => void) => h('button', { class: 'btn icon-btn', title, onclick: fn }, label);
  const foot = h('div', { class: 'panel-foot' },
    btn('Rellenar el trazado con el color frontal', '●', act(ops.fillDocPath)),
    btn('Contornear el trazado con el pincel (color frontal y tamaño del pincel)', '○', act(ops.strokeDocPath)),
    btn('Cargar el trazado como selección', '◌', act(ops.docPathToSelection)),
    btn('Crear un trazado a partir de la selección', '⬚', () => ops.selectionToPath()),
    btn('Eliminar el trazado', '🗑', act(ops.deleteDocPath)));
  const body = h('div', { class: 'panel-body layers' }, list, foot);
  parent.append(body);
  const render = () => {
    const d = app.doc; list.innerHTML = ''; if (!d || !visible(body)) return;
    d.paths.forEach((p, i) => {
      const k = Math.min(36 / d.width, 36 / d.height);
      const c = h('canvas', { class: 'thumb', width: Math.max(1, Math.round(d.width * k)), height: Math.max(1, Math.round(d.height * k)) });
      const x = c.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.scale(k, k); x.fillStyle = '#555'; ops.tracePathDoc(x, p); x.fill('evenodd');
      const row = h('div', { class: 'layer-row' + (i === d.activePath ? ' active' : ''), title: 'Clic: seleccionar (clic otra vez: ocultar) · Ctrl+clic: cargar como selección · Doble clic en el nombre: renombrar' },
        h('span', { class: 'eye' }), c, h('span', { class: 'lname' }, p.name));
      row.onclick = e => {
        if (e.ctrlKey || e.metaKey) { ops.docPathToSelection(i); return; }
        d.activePath = d.activePath === i ? -1 : i; app.viewport.requestRender(); render();
      };
      row.querySelector('.lname')!.addEventListener('dblclick', async ev => { ev.stopPropagation(); const n = await promptDialog('Cambiar nombre de trazado', 'Nombre', p.name); if (n) { p.name = n; d.commit('Cambiar nombre de trazado'); } });
      list.append(row);
    });
    if (!d.paths.length) list.append(h('div', { class: 'hint ch-empty' }, 'Dibuja con la Pluma en modo «Trazado», o crea uno desde una selección (botón ⬚).'));
  };
  let t = 0;
  app.on('doc', () => { clearTimeout(t); t = window.setTimeout(render, 150); }); app.on('docs', render);
  new MutationObserver(() => render()).observe(parent, { attributes: true, attributeFilter: ['class'] });
}

// ---- Composiciones de capas ------------------------------------------------------------------

export function buildCompsPanel(parent: HTMLElement) {
  const list = h('div', { class: 'layer-list' });
  let sel = -1;
  const btn = (title: string, label: string, fn: () => void) => h('button', { class: 'btn icon-btn', title, onclick: fn }, label);
  const newComp = async () => {
    const d = app.doc; if (!d) return;
    const name = h('input', { type: 'text', class: 'wide', value: `Composición ${d.layerComps.length + 1}` });
    const cb = (label: string, on = true) => { const c = h('input', { type: 'checkbox', checked: on }); return [c, h('label', { class: 'check' }, c, ' ' + label)] as const; };
    const [vis, visL] = cb('Visibilidad'), [pos, posL] = cb('Posición'), [app2, appL] = cb('Aspecto (opacidad, modo y estilos)');
    showDialog({ title: 'Nueva composición de capas', body: [row('Nombre', name), row('Guardar', h('div', {}, visL, posL, appL))],
      onOk: () => { ops.captureLayerComp(name.value.trim() || 'Composición', { visibility: vis.checked, position: pos.checked, appearance: app2.checked }); sel = d.layerComps.length - 1; render(); } });
  };
  const foot = h('div', { class: 'panel-foot' },
    btn('Actualizar la composición seleccionada con el estado actual', '⟳', () => { const d = app.doc; const c = d?.layerComps[sel]; if (c) { ops.captureLayerComp(c.name, c, sel); app.toast('Composición actualizada'); } else app.toast('Selecciona una composición', 'warn'); }),
    btn('Nueva composición a partir del estado actual', '＋', newComp),
    btn('Eliminar la composición seleccionada', '🗑', () => { if (sel >= 0) { ops.deleteLayerComp(sel); sel = -1; render(); } }));
  const body = h('div', { class: 'panel-body layers' }, list, foot);
  parent.append(body);
  const render = () => {
    const d = app.doc; list.innerHTML = ''; if (!d || !visible(body)) return;
    d.layerComps.forEach((c, i) => {
      const what = [c.visibility && 'visibilidad', c.position && 'posición', c.appearance && 'aspecto'].filter(Boolean).join(', ');
      const row2 = h('div', { class: 'layer-row' + (i === sel ? ' active' : ''), title: `Clic: aplicar · Guarda: ${what} · Doble clic en el nombre: renombrar` }, h('span', { class: 'eye' }, i === sel ? '▸' : ''), h('span', { class: 'lname' }, c.name), h('span', { class: 'hint' }, what));
      row2.onclick = () => { sel = i; ops.applyLayerComp(i); render(); };
      row2.querySelector('.lname')!.addEventListener('dblclick', async ev => { ev.stopPropagation(); const n = await promptDialog('Cambiar nombre', 'Nombre', c.name); if (n) { c.name = n; d.changed(); render(); } });
      list.append(row2);
    });
    if (!d.layerComps.length) list.append(h('div', { class: 'hint ch-empty' }, 'Guarda variantes del diseño (qué capas se ven, dónde están y su aspecto) y cambia entre ellas con un clic. Pulsa ＋ para crear la primera.'));
  };
  app.on('doc', () => setTimeout(render, 0)); app.on('docs', () => { sel = -1; render(); });
  new MutationObserver(() => render()).observe(parent, { attributes: true, attributeFilter: ['class'] });
}

// ---- Estilos (estilos de capa predefinidos y guardados) ------------------------------------------

export function buildStylesPanel(parent: HTMLElement) {
  const grid = h('div', { class: 'style-grid' });
  const thumbs = new Map<string, HTMLCanvasElement>();
  const thumb = (st: LayerStyles) => {
    const key = JSON.stringify(st); const c0 = thumbs.get(key); if (c0) return cloneCanvas(c0);
    const S = 56, src = makeCanvas(S, S), x = ctx2d(src);
    x.fillStyle = '#9aa4b4'; x.beginPath(); x.roundRect(12, 12, S - 24, S - 24, 7); x.fill();
    const out = makeCanvas(S, S); composeStyled(ctx2d(out), src, st, 0, 0, S, S);
    thumbs.set(key, out); return cloneCanvas(out);
  };
  const apply = (st: LayerStyles, name: string) => {
    const d = app.doc, l = d?.active; if (!d || !l) { app.toast('Selecciona una capa', 'warn'); return; }
    if (l.kind === 'group' || l.kind === 'adjust') { app.toast('Los estilos se aplican a capas de píxeles, texto o forma', 'warn'); return; }
    l.styles = JSON.parse(JSON.stringify(st)); d.invalidate(); d.commit(`Estilo: ${name}`);
  };
  const foot = h('div', { class: 'panel-foot' },
    h('button', { class: 'btn icon-btn', title: 'Quitar el estilo de la capa', onclick: () => { const l = app.doc?.active; if (l?.styles) ops.setLayerStyles(l, null, true); } }, '⊘'),
    h('button', { class: 'btn icon-btn', title: 'Guardar el estilo de la capa activa como estilo nuevo', onclick: async () => {
      const l = app.doc?.active; if (!l?.styles || !hasStyles(l.styles)) { app.toast('La capa activa no tiene estilo que guardar', 'warn'); return; }
      const n = await promptDialog('Nuevo estilo', 'Nombre', 'Mi estilo'); if (!n) return;
      saveUserStyles([...userStyles(), { name: n, styles: JSON.parse(JSON.stringify(l.styles)) }]); render();
    } }, '＋'));
  const body = h('div', { class: 'brush-panel' }, grid, foot);
  parent.append(body);
  const render = () => {
    if (!visible(body)) return;
    grid.innerHTML = '';
    const mine = userStyles();
    const item = (p: { name: string; styles: LayerStyles }, user: number) => {
      const el = h('button', { class: 'style-item', title: p.name + (user >= 0 ? ' · clic derecho: eliminar' : '') }, thumb(p.styles), h('span', {}, p.name));
      el.onclick = () => apply(p.styles, p.name);
      if (user >= 0) el.oncontextmenu = ev => { ev.preventDefault(); const l = userStyles(); l.splice(user, 1); saveUserStyles(l); render(); };
      return el;
    };
    mine.forEach((p, i) => grid.append(item(p, i)));
    STYLE_PRESETS.forEach(p => grid.append(item(p, -1)));
  };
  render();
  new MutationObserver(() => render()).observe(parent, { attributes: true, attributeFilter: ['class'] });
}
