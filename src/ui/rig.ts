// Animación por piezas con huesos (como Spine o el «recortable» de After Effects, sin mallas): cada capa es una pieza que
// cuelga de otra y gira alrededor de su articulación. Se ponen unas pocas posturas clave y se crean solos los fotogramas
// intermedios. Las piezas se giran arrastrándolas en la vista previa; con «Alcanzar» se arrastra la punta de un brazo o una
// pierna y se doblan solas las dos piezas (cinemática inversa de dos huesos). El original no se toca: el resultado es una
// animación nueva.
import { app } from './app';
import { h, numberSlider } from './dom';
import { showDialog } from './dialog';
import { ctx2d, makeCanvas, contentBounds } from '../core/canvas';
import { RasterLayer } from '../core/layers';
import { EditorDocument } from '../core/document';
import { t } from '../i18n/i18n';

export type Bone = { id: number; parent: number | null; px: number; py: number; tx: number; ty: number };
export type Pose = { frame: number; rot: Record<number, number>; dx: number; dy: number; /** curvatura de cada pieza (grados entre la base y la punta) */ bend?: Record<number, number> };
export type Rig = { bones: Bone[]; poses: Pose[]; frames: number; fps: number; loop: boolean };
type M = [number, number, number, number, number, number]; // a b c d e f (como DOMMatrix 2D)
const mul = (p: M, q: M): M => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
const rotAt = (deg: number, x: number, y: number): M => { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, x - c * x + s * y, y - s * x - c * y]; };
const apply = (m: M, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
const inv = (m: M): M => { const det = m[0] * m[3] - m[1] * m[2], a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det; return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]; };
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Postura en el fotograma f: se interpola entre las dos posturas clave de alrededor (con suavizado). */
export function poseAt(rig: Rig, f: number): Pose {
  const ps = [...rig.poses].sort((a, b) => a.frame - b.frame); if (!ps.length) return { frame: f, rot: {}, dx: 0, dy: 0 };
  if (rig.loop && ps.length > 1) ps.push({ ...ps[0], frame: rig.frames }); // al final vuelve a la primera
  if (f <= ps[0].frame) return ps[0];
  for (let i = 0; i < ps.length - 1; i++) {
    const a = ps[i], b = ps[i + 1]; if (f > b.frame) continue;
    const k = smooth((f - a.frame) / Math.max(1, b.frame - a.frame)), rot: Record<number, number> = {};
    const bend: Record<number, number> = {};
    for (const bn of rig.bones) { const ra = a.rot[bn.id] ?? 0, rb = b.rot[bn.id] ?? 0; rot[bn.id] = ra + (rb - ra) * k; const ba = a.bend?.[bn.id] ?? 0, bb = b.bend?.[bn.id] ?? 0; if (ba || bb) bend[bn.id] = ba + (bb - ba) * k; }
    return { frame: f, rot, dx: a.dx + (b.dx - a.dx) * k, dy: a.dy + (b.dy - a.dy) * k, bend };
  }
  return ps[ps.length - 1];
}
/** Matriz de cada pieza (encadenando las de sus padres). */
/** Doblado de una pieza: la parte que está a la distancia s de la articulación (a lo largo del hueso) se lleva a su sitio
 *  en el arco y se gira lo que toca. La curvatura es constante: entre la base y la punta gira `deg` grados en total. */
export function bendMatrix(b: Bone, deg: number, s: number): M {
  const L = Math.hypot(b.tx - b.px, b.ty - b.py); if (!deg || L < 1) return [1, 0, 0, 1, 0, 0];
  const k = deg * Math.PI / 180 / L, th = Math.atan2(b.ty - b.py, b.tx - b.px), cx = Math.sin(k * s) / k, cy = (1 - Math.cos(k * s)) / k;
  // en el sistema del hueso (eje x a lo largo): punto (s+du, v) → C(s) + R(k·s)·(du, v)
  const local: M = mul([1, 0, 0, 1, cx, cy], mul(rotAt(k * s * 180 / Math.PI, 0, 0), [1, 0, 0, 1, -s, 0]));
  const toBone: M = mul(rotAt(-th * 180 / Math.PI, 0, 0), [1, 0, 0, 1, -b.px, -b.py]), fromBone: M = mul([1, 0, 0, 1, b.px, b.py], rotAt(th * 180 / Math.PI, 0, 0));
  return mul(fromBone, mul(local, toBone));
}
/** Distancia a lo largo del hueso del punto (x, y) (de 0 a su largo). */
const along = (b: Bone, x: number, y: number) => { const L = Math.hypot(b.tx - b.px, b.ty - b.py) || 1; return Math.max(0, Math.min(L, ((x - b.px) * (b.tx - b.px) + (y - b.py) * (b.ty - b.py)) / L)); };
/** Matriz de cada pieza (encadenando las de sus padres; si el padre está doblado, la hija sigue la curva). */
export function worldMatrices(rig: Rig, pose: Pose): Map<number, M> {
  const out = new Map<number, M>(), byId = new Map(rig.bones.map(b => [b.id, b]));
  const get = (id: number, depth = 0): M => {
    const c = out.get(id); if (c) return c;
    const b = byId.get(id)!; let m = rotAt(pose.rot[id] ?? 0, b.px, b.py);
    if (b.parent != null && byId.has(b.parent) && depth < 32) {
      const P = byId.get(b.parent)!, pb = pose.bend?.[P.id] ?? 0;
      m = mul(get(b.parent, depth + 1), pb ? mul(bendMatrix(P, pb, along(P, b.px, b.py)), m) : m);
    } else m = mul([1, 0, 0, 1, pose.dx, pose.dy], m);
    out.set(id, m); return m;
  };
  for (const b of rig.bones) get(b.id);
  return out;
}
/** Dibuja la postura: las piezas en el orden de las capas (las de arriba encima), sobre lo que no es del esqueleto. */
export function renderPose(d: EditorDocument, rig: Rig, pose: Pose, W = d.width, H = d.height, withRest = true): HTMLCanvasElement {
  const c = makeCanvas(W, H), x = ctx2d(c), k = W / d.width, ids = new Set(rig.bones.map(b => b.id)), mats = worldMatrices(rig, pose);
  x.scale(k, H / d.height); x.imageSmoothingEnabled = !d.meta.pixelArt;
  for (const l of d.allLayers()) {
    if (!(l instanceof RasterLayer) || !l.visible && !ids.has(l.id)) continue;
    if (!ids.has(l.id)) { if (withRest) { x.globalAlpha = l.opacity; x.drawImage(l.canvas, 0, 0); x.globalAlpha = 1; } continue; }
    const m = mats.get(l.id)!, b = rig.bones.find(q => q.id === l.id)!, deg = pose.bend?.[l.id] ?? 0;
    if (!deg) { x.save(); x.transform(...m); x.globalAlpha = l.opacity; x.drawImage(l.canvas, 0, 0); x.restore(); continue; }
    drawBent(x, l.canvas, b, deg, m, l.opacity);
  }
  return c;
}
/** Pieza doblada: se corta en tiras perpendiculares al hueso y cada tira se coloca en su punto del arco (un poco solapadas
 *  para que no queden rendijas). Lo que queda antes de la articulación o después de la punta va con la primera o la última. */
function drawBent(x: CanvasRenderingContext2D, img: HTMLCanvasElement, b: Bone, deg: number, m: M, alpha: number) {
  const L = Math.hypot(b.tx - b.px, b.ty - b.py), th = Math.atan2(b.ty - b.py, b.tx - b.px), N = Math.max(8, Math.min(64, Math.round(L / 3))), R = Math.hypot(img.width, img.height);
  for (let i = 0; i < N; i++) {
    const s0 = i === 0 ? -R : i * L / N, s1 = i === N - 1 ? L + R : (i + 1) * L / N + 0.8, sm = Math.max(0, Math.min(L, (i + 0.5) * L / N));
    x.save(); x.transform(...m); x.transform(...bendMatrix(b, deg, sm));
    // tira en el sistema del hueso
    x.translate(b.px, b.py); x.rotate(th); x.beginPath(); x.rect(s0, -R, s1 - s0, 2 * R); x.rotate(-th); x.translate(-b.px, -b.py); x.clip();
    x.globalAlpha = alpha; x.drawImage(img, 0, 0); x.restore();
  }
}
/** Cinemática inversa de dos huesos: gira `upper` y `lower` para que la punta (tx, ty) de `lower` llegue a (gx, gy). */
export function solveTwoBone(rig: Rig, pose: Pose, upper: number, lower: number, gx: number, gy: number) {
  const U = rig.bones.find(b => b.id === upper)!, L = rig.bones.find(b => b.id === lower)!;
  const mats = worldMatrices(rig, pose), mu = mats.get(upper)!, ml = mats.get(lower)!;
  const s = apply(mu, U.px, U.py), e = apply(ml, L.px, L.py), tip = apply(ml, L.tx, L.ty);
  const l1 = Math.hypot(e.x - s.x, e.y - s.y), l2 = Math.hypot(tip.x - e.x, tip.y - e.y); if (l1 < 1 || l2 < 1) return;
  const dist = Math.max(Math.abs(l1 - l2) + 0.01, Math.min(l1 + l2 - 0.01, Math.hypot(gx - s.x, gy - s.y)));
  const toGoal = Math.atan2(gy - s.y, gx - s.x);
  // se mantiene el sentido en que estaba doblado (codo o rodilla hacia el mismo lado)
  const cur1 = Math.atan2(e.y - s.y, e.x - s.x), cur2 = Math.atan2(tip.y - e.y, tip.x - e.x), bendSign = Math.sign(Math.sin(cur2 - cur1)) || 1;
  const a1 = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist))));
  const want1 = toGoal - bendSign * a1;
  const ex = s.x + Math.cos(want1) * l1, ey = s.y + Math.sin(want1) * l1, want2 = Math.atan2(gy - ey, gx - ex);
  const deg = (r: number) => r * 180 / Math.PI;
  pose.rot[upper] = (pose.rot[upper] ?? 0) + deg(want1 - cur1);
  const mats2 = worldMatrices(rig, pose), e2 = apply(mats2.get(lower)!, L.px, L.py), tip2 = apply(mats2.get(lower)!, L.tx, L.ty);
  pose.rot[lower] = (pose.rot[lower] ?? 0) + deg(want2 - Math.atan2(tip2.y - e2.y, tip2.x - e2.x));
}
/** Esqueleto inicial: una pieza por capa visible (menos el fondo), articulación arriba en el centro y punta abajo. */
export function autoRig(d: EditorDocument): Rig {
  const bones: Bone[] = [], boxes = new Map<number, { x: number; y: number; w: number; h: number }>();
  const layers = d.allLayers().filter(l => l instanceof RasterLayer && l.visible) as RasterLayer[];
  for (const l of layers) {
    if (layers.length > 1 && l === layers[0] && /fondo|background/i.test(l.name)) continue;
    const b = contentBounds(l.canvas, 8); if (!b) continue;
    boxes.set(l.id, b);
    bones.push({ id: l.id, parent: null, px: Math.round(b.x + b.w / 2), py: b.y, tx: Math.round(b.x + b.w / 2), ty: b.y + b.h });
  }
  // el tronco es la pieza más grande; lo que está por encima (la cabeza) se articula por abajo (el cuello)
  const root = bones.reduce<Bone | null>((a, b) => !a || boxes.get(b.id)!.w * boxes.get(b.id)!.h > boxes.get(a.id)!.w * boxes.get(a.id)!.h ? b : a, null);
  if (root && bones.length > 1) {
    const R = boxes.get(root.id)!;
    for (const b of bones) { if (b === root) continue; const B = boxes.get(b.id)!; if (B.y + B.h / 2 < R.y) { b.py = B.y + B.h; b.ty = B.y; } }
    // cada pieza cuelga de la que contiene su articulación (la más pequeña), o del tronco si toca con él
    const inside = (B: { x: number; y: number; w: number; h: number }, x: number, y: number, tol = 3) => x >= B.x - tol && x <= B.x + B.w + tol && y >= B.y - tol && y <= B.y + B.h + tol;
    for (const b of bones) {
      if (b === root) continue;
      const cands = bones.filter(o => o !== b && inside(boxes.get(o.id)!, b.px, b.py)).sort((a, c) => boxes.get(a.id)!.w * boxes.get(a.id)!.h - boxes.get(c.id)!.w * boxes.get(c.id)!.h);
      const pick = cands.find(o => { let c: number | null = o.id; while (c != null) { if (c === b.id) return false; c = bones.find(q => q.id === c)?.parent ?? null; } return true; });
      b.parent = pick ? pick.id : null;
    }
  }
  return { bones, poses: [{ frame: 0, rot: {}, dx: 0, dy: 0 }], frames: 24, fps: 12, loop: true };
}
// ---- editor ----------------------------------------------------------------------------------------------
export function rigDialog() {
  const d = app.doc; if (!d) return;
  const saved = (d.meta as any).rig as Rig | undefined;
  const rig: Rig = saved ? JSON.parse(JSON.stringify(saved)) : autoRig(d);
  // piezas que ya no existen fuera
  rig.bones = rig.bones.filter(b => d.findLayer(b.id) instanceof RasterLayer);
  if (rig.bones.length < 1) { app.toast('Pon cada pieza del personaje (cabeza, brazos, piernas…) en su propia capa', 'warn'); return; }
  const name = (id: number | null) => id == null ? t('Ninguna') : d.findLayer(id)?.name ?? '?';
  let sel = rig.bones[0].id, poseI = 0, mode = 'rotate', drag: { start: number; ang: number; tip?: boolean } | null = null, playT = 0;
  const PVW = 380, k = Math.min(PVW / d.width, 320 / d.height), pw = Math.round(d.width * k), ph = Math.round(d.height * k);
  const pv = h('canvas', { class: 'gd-pv rig-pv', width: pw, height: ph }) as HTMLCanvasElement;
  const pose = () => rig.poses[poseI];
  const draw = () => {
    const x = ctx2d(pv); x.clearRect(0, 0, pw, ph); x.drawImage(renderPose(d, rig, pose(), pw, ph), 0, 0);
    const mats = worldMatrices(rig, pose());
    for (const b of rig.bones) {
      const m = mats.get(b.id)!, bd = pose().bend?.[b.id] ?? 0, p = apply(m, b.px, b.py), q = apply(bd ? mul(m, bendMatrix(b, bd, Math.hypot(b.tx - b.px, b.ty - b.py))) : m, b.tx, b.ty), on = b.id === sel;
      x.strokeStyle = on ? '#ffb020' : 'rgba(255,255,255,.75)'; x.lineWidth = on ? 3 : 1.5; x.beginPath(); x.moveTo(p.x * k, p.y * k); x.lineTo(q.x * k, q.y * k); x.stroke();
      x.fillStyle = on ? '#ffb020' : '#3d8bfd'; x.beginPath(); x.arc(p.x * k, p.y * k, on ? 5 : 4, 0, 7); x.fill(); x.strokeStyle = '#000'; x.lineWidth = 1; x.stroke();
      x.fillStyle = '#ff4fd8'; x.beginPath(); x.arc(q.x * k, q.y * k, 3, 0, 7); x.fill();
    }
  };
  const pt = (e: PointerEvent) => { const r = pv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * d.width, y: (e.clientY - r.top) / r.height * d.height }; };
  /** Pieza bajo el dedo: la de más arriba con pintura en ese punto. */
  const hit = (x: number, y: number) => {
    const mats = worldMatrices(rig, pose()), order = d.allLayers().map(l => l.id).reverse();
    for (const id of order) { const b = rig.bones.find(q => q.id === id); if (!b) continue; const l = d.findLayer(id) as RasterLayer, p = apply(inv(mats.get(id)!), x, y); if (p.x < 0 || p.y < 0 || p.x >= d.width || p.y >= d.height) continue; if (ctx2d(l.canvas).getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data[3] > 20) return id; }
    return null;
  };
  pv.onpointerdown = e => {
    pv.setPointerCapture(e.pointerId); const p = pt(e);
    if (mode === 'pivot' || mode === 'tip') { const b = rig.bones.find(q => q.id === sel)!, ip = apply(inv(worldMatrices(rig, pose()).get(sel)!), p.x, p.y); if (mode === 'pivot') { b.px = Math.round(ip.x); b.py = Math.round(ip.y); } else { b.tx = Math.round(ip.x); b.ty = Math.round(ip.y); } draw(); return; }
    const id = hit(p.x, p.y); if (id == null) return; sel = id; renderList();
    const b = rig.bones.find(q => q.id === id)!, w = apply(worldMatrices(rig, pose()).get(id)!, b.px, b.py);
    drag = { start: pose().rot[id] ?? 0, ang: Math.atan2(p.y - w.y, p.x - w.x) }; draw();
  };
  pv.onpointermove = e => {
    if (!drag) return; const p = pt(e), b = rig.bones.find(q => q.id === sel)!;
    if (mode === 'ik' && b.parent != null) { solveTwoBone(rig, pose(), b.parent, b.id, p.x, p.y); renderList(); draw(); return; }
    const w = apply(worldMatrices(rig, pose()).get(sel)!, b.px, b.py), a = Math.atan2(p.y - w.y, p.x - w.x);
    if (mode === 'move' && b.parent == null) { pose().dx += e.movementX / k; pose().dy += e.movementY / k; draw(); return; }
    pose().rot[sel] = drag.start + (a - drag.ang) * 180 / Math.PI; renderList(); draw();
  };
  pv.onpointerup = () => { drag = null; };
  // lista de piezas: padre y giro en la postura actual
  // doblar la pieza elegida (cola, brazo, pelo…): curvatura en esta postura
  const bendSl = numberSlider({ min: -180, max: 180, value: 0, unit: '°', onInput: v => { const p = pose(); (p.bend ??= {})[sel] = v; draw(); } });
  const list = h('div', { class: 'rig-list' });
  const renderList = () => {
    bendSl.set(Math.round(pose().bend?.[sel] ?? 0));
    list.replaceChildren(...rig.bones.map(b => {
      const par = h('select', { title: 'De qué pieza cuelga' }, h('option', { value: '' }, t('Ninguna')), ...rig.bones.filter(o => o.id !== b.id).map(o => h('option', { value: String(o.id) }, name(o.id)))) as HTMLSelectElement;
      par.value = b.parent == null ? '' : String(b.parent);
      par.onchange = () => { const v = par.value ? +par.value : null; // no se permiten ciclos
        let c = v, ok = true; while (c != null) { if (c === b.id) { ok = false; break; } c = rig.bones.find(o => o.id === c)?.parent ?? null; }
        if (!ok) { app.toast('Una pieza no puede colgar de sí misma ni de sus hijas', 'warn'); par.value = b.parent == null ? '' : String(b.parent); return; } b.parent = v; draw(); };
      const r = Math.round(pose().rot[b.id] ?? 0);
      const it = h('div', { class: 'rig-item' + (b.id === sel ? ' on' : '') }, h('span', { class: 'rig-name no-i18n' }, name(b.id)), h('span', { class: 'rig-deg' }, `${r}°`), par);
      it.onclick = e => { if ((e.target as HTMLElement).closest('select')) return; sel = b.id; renderList(); draw(); };
      return it;
    }));
  };
  // posturas clave
  const poses = h('div', { class: 'rig-poses' });
  const renderPoses = () => {
    rig.poses.sort((a, b) => a.frame - b.frame); poseI = Math.min(poseI, rig.poses.length - 1);
    poses.replaceChildren(...rig.poses.map((p, i) => { const b = h('button', { type: 'button', class: 'btn' + (i === poseI ? ' primary' : '') }, `${i + 1} · ${t('fotograma')} ${p.frame + 1}`); b.onclick = () => { poseI = i; renderPoses(); renderList(); draw(); }; return b; }),
      (() => { const b = h('button', { type: 'button', class: 'btn', title: 'Copia la postura actual unos fotogramas más adelante' }, '+'); b.onclick = () => { const last = rig.poses[rig.poses.length - 1], f = Math.min(rig.frames - 1, last.frame + Math.max(2, Math.round(rig.frames / 4))); if (rig.poses.some(p => p.frame === f)) { app.toast('Ya hay una postura en ese fotograma: alarga la animación', 'warn'); return; } rig.poses.push({ ...JSON.parse(JSON.stringify(pose())), frame: f }); poseI = rig.poses.findIndex(p => p.frame === f); renderPoses(); renderList(); draw(); }; return b; })(),
      (() => { const b = h('button', { type: 'button', class: 'btn', title: 'Quitar esta postura' }, '−'); b.onclick = () => { if (rig.poses.length < 2) return; rig.poses.splice(poseI, 1); poseI = Math.max(0, poseI - 1); renderPoses(); renderList(); draw(); }; return b; })());
  };
  const frameOf = numberSlider({ min: 1, max: 240, value: 1, onInput: v => { if (rig.poses.some((p, i) => i !== poseI && p.frame === v - 1)) return; pose().frame = Math.min(rig.frames - 1, v - 1); renderPoses(); } });
  const modeSel = h('select', {}, h('option', { value: 'rotate' }, 'Girar la pieza que arrastres'), h('option', { value: 'ik' }, 'Alcanzar: arrastra la punta y se doblan dos piezas'), h('option', { value: 'move' }, 'Mover todo el personaje'), h('option', { value: 'pivot' }, 'Colocar la articulación de la pieza elegida'), h('option', { value: 'tip' }, 'Colocar la punta de la pieza elegida')) as HTMLSelectElement;
  modeSel.onchange = () => { mode = modeSel.value; };
  const loop = h('input', { type: 'checkbox', checked: rig.loop }) as HTMLInputElement; loop.onchange = () => { rig.loop = loop.checked; };
  // reproducir en la vista previa
  let timer = 0;
  const playBtn = h('button', { type: 'button', class: 'btn' }, 'Reproducir');
  playBtn.onclick = () => { if (timer) { clearTimeout(timer); timer = 0; playBtn.textContent = t('Reproducir'); draw(); return; } playBtn.textContent = t('Detener'); const tick = () => { const x = ctx2d(pv); x.clearRect(0, 0, pw, ph); x.drawImage(renderPose(d, rig, poseAt(rig, playT % rig.frames), pw, ph), 0, 0); playT++; timer = window.setTimeout(tick, 1000 / rig.fps); }; tick(); };
  const row = (l: string, ...e: HTMLElement[]) => h('div', { class: 'form-row' }, h('label', {}, l), ...e);
  renderList(); renderPoses(); draw();
  const stop = () => { clearTimeout(timer); timer = 0; };
  showDialog({
    title: 'Animar con huesos', okLabel: 'Crear animación', width: 720,
    body: [h('div', { class: 'hint' }, 'Cada capa es una pieza. Elige de qué pieza cuelga cada una (el antebrazo del brazo, la mano del antebrazo…), arrastra las piezas en la vista para ponerlas en postura y añade más posturas con «+»: los fotogramas de en medio se crean solos.'),
      h('div', { class: 'rig-wrap' }, h('div', {}, h('div', { class: 'gd-pv-wrap' }, pv), row('Al arrastrar', modeSel), h('div', { class: 'pv-nav' }, playBtn)),
        h('div', { class: 'rig-side' }, h('div', { class: 'tm-sub' }, t('Posturas clave')), poses, row('Esta postura en el fotograma', frameOf.el),
          row('Fotogramas', numberSlider({ min: 2, max: 240, value: rig.frames, onInput: v => { rig.frames = v; } }).el), row('Velocidad', numberSlider({ min: 2, max: 30, value: rig.fps, unit: ' fps', onInput: v => { rig.fps = v; } }).el),
          h('label', { class: 'check' }, loop, ' En bucle (al final vuelve a la primera postura)'),
          h('div', { class: 'tm-sub' }, t('Piezas')), list, h('div', { class: 'form-row' }, h('label', {}, 'Doblar la pieza elegida'), bendSl.el)))],
    onCancel: stop,
    onOk: () => {
      stop();
      (d.meta as any).rig = JSON.parse(JSON.stringify(rig)); d.modified = true;
      if (d.width * d.height * rig.frames > 80e6) { app.toast(`${t('Demasiado grande')}. ${t('Usa menos fotogramas o un tamaño menor')}`, 'warn'); return false; }
      const nd = new EditorDocument(`${d.name} ${t('animado')}`, d.width, d.height);
      // lo que no es del esqueleto (fondo, decorado) va en una capa común a todos los fotogramas
      const ids = new Set(rig.bones.map(b => b.id)), restLayers = d.allLayers().filter(l => l instanceof RasterLayer && l.visible && !ids.has(l.id)) as RasterLayer[], hasRest = restLayers.length > 0;
      const bg = new RasterLayer('Fondo', d.width, d.height), bx = ctx2d(bg.canvas); for (const l of restLayers) { bx.globalAlpha = l.opacity; bx.drawImage(l.canvas, 0, 0); } bx.globalAlpha = 1;
      if (hasRest) nd.root.add(bg);
      for (let f = 0; f < rig.frames; f++) {
        const l = new RasterLayer(`Fotograma ${f + 1}`, d.width, d.height); ctx2d(l.canvas).drawImage(renderPose(d, rig, poseAt(rig, f), d.width, d.height, false), 0, 0);
        l.visible = f === 0; nd.root.add(l); nd.frames.push({ delay: Math.round(1000 / rig.fps), visible: hasRest ? [bg.id, l.id] : [l.id], own: l.id });
      }
      nd.frameIndex = 0; if (d.meta.pixelArt) nd.meta.pixelArt = true;
      app.addDocument(nd, 'Animar con huesos');
      import('./anim').then(m => { if (!nd.meta.pixelArt && !m.dockShown()) m.toggleAnimDock(); });
      app.toast(`${rig.frames} fotogramas creados: pulsa reproducir para verlo`);
    },
  });
  // la postura elegida se refleja en el número de fotograma
  const syncFrame = () => frameOf.set(pose().frame + 1); syncFrame();
  poses.addEventListener('click', () => requestAnimationFrame(syncFrame));
}
