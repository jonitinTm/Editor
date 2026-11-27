// Service worker: permite usar Photocap sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-27T14:44:47.360Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-BcfZoqOm.js", "./assets/artist-Dex8ihdw.js", "./assets/artistic-Bc4ktnVi.js", "./assets/arw-B2cK3-Xi.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-oJDE5jDk.js", "./assets/create-Cot5J_pG.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-D-N0JSBN.js", "./assets/dng-G0l1zR06.js", "./assets/expand-DPgG6Qln.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-BuK0b8MR.js", "./assets/gamedev-C-CTQoJE.js", "./assets/gameui-BBfdtnEr.js", "./assets/gamextra-DDc108LY.js", "./assets/icc-BoBgzEP_.js", "./assets/index-B4UtIOCS.js", "./assets/index-DISD3FkO.css", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-qtcxvXpc.js", "./assets/more2-0XEYfrHV.js", "./assets/nef-663tXqDC.js", "./assets/panorama-Bt6ds7uT.js", "./assets/patheffects-C0N4bVha.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-CzehiQqD.js", "./assets/premium-CqSnFS1J.js", "./assets/premium2-DHeU1Rt4.js", "./assets/psd-Lilbpa1s.js", "./assets/raster-C7gk0NN1.js", "./assets/rawdev-qmZF5ULr.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-Dn1NVY5M.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-BL7hvF45.js", "./assets/sky-DJUii5sH.js", "./assets/subject-BKD-aATT.js", "./assets/svgimport-D4yN5R5X.js", "./assets/swatches-DxKgC-tZ.js", "./assets/texdetails-BmKQF1qV.js", "./assets/textures-BHji33bV.js", "./assets/tilemap-BtAQkF-a.js", "./assets/touchtour-D1JGxC_D.js", "./assets/trace-CGb4ZliA.js", "./assets/tutorial-DXuV5Np2.js", "./assets/unique-DWQ-a3UO.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-DGS3bJs-.js", "./assets/wideangle-CCoRmqnL.js", "./assets/worker-C2TpEWxD.js"]).catch(() => {}))); });
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
