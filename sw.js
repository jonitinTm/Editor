// Service worker: permite usar Photocap sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-28T15:31:37.120Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-Dgek9lnn.js", "./assets/animaudio-BUD6DjFN.js", "./assets/artist-C_UYZRFG.js", "./assets/artistic-Cw4VFMbr.js", "./assets/arw-GVXYybQE.js", "./assets/audiostudio-COB5rvnY.js", "./assets/camera-j2X0kqF5.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-DEEeMQqK.js", "./assets/create-CAntid_S.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-C7VvPpi_.js", "./assets/dng-B9pdNIYt.js", "./assets/expand-5_QMcFVU.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-2ZEMU66U.js", "./assets/gamedev-ny0rRnIn.js", "./assets/gameui-CFqgNAK0.js", "./assets/gamextra-BFCLdfuS.js", "./assets/icc-BoBgzEP_.js", "./assets/index-BQvmPaXA.js", "./assets/index-KACSuNP0.css", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-CcqY8HPc.js", "./assets/more2-W1MhoAbr.js", "./assets/nef-CGfueTT-.js", "./assets/panorama-Bt6ds7uT.js", "./assets/particles-CnIFikAL.js", "./assets/patheffects-BVBhN8wI.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-BReAU6Zp.js", "./assets/premium-DkeXgCyu.js", "./assets/premium2-BuarNNm2.js", "./assets/psd-Ey71FnHJ.js", "./assets/raster-ByHvU6JA.js", "./assets/rawdev-DmjY1GsS.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-D-1VpyJX.js", "./assets/rig-Bqa2fL8r.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-CiyZMTdP.js", "./assets/sky-BFoHkFqj.js", "./assets/subject-DSURzRkd.js", "./assets/svgimport-BI1EL9T0.js", "./assets/swatches-DxKgC-tZ.js", "./assets/texdetails-CHS6RSV8.js", "./assets/textures-D0jhTDvb.js", "./assets/tilemap-CLw4uaTh.js", "./assets/touchtour-BlsUdEnk.js", "./assets/trace-CB3xuB1s.js", "./assets/tutorial-D84Bkv_i.js", "./assets/unique-C5BOmnLM.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-CsGBUPkA.js", "./assets/wideangle-yqoJl7jb.js", "./assets/worker-C2TpEWxD.js"]).catch(() => {}))); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k.startsWith('editor-')).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// «Compartir» de Android hacia el editor (fotos o proyectos enviados desde otro dispositivo): se guardan un momento y
// se abre el editor, que los recoge al arrancar
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method === 'POST' && u.origin === location.origin && u.searchParams.has('share-target')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData(), files = form.getAll('files').filter(f => f && typeof f !== 'string');
        const c = await caches.open('editor-shared');
        for (const k of await c.keys()) await c.delete(k);
        let i = 0; for (const f of files) await c.put(`./shared/${i++}`, new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream', 'x-name': encodeURIComponent(f.name || 'archivo') } }));
      } catch { /* sin archivos */ }
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./'))));
});
