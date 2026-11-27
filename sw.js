// Service worker: permite usar Photocap sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-27T07:51:45.352Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-Bj7XWdBA.js", "./assets/anim-IkzFkx7x.js", "./assets/artist-7jDKNQ3E.js", "./assets/artistic-Cqr1C5tt.js", "./assets/arw-CIiogTSv.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-Bvd77K-a.js", "./assets/create-C9HVOmYM.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-vlVdKGny.js", "./assets/dng-Chkue09E.js", "./assets/expand-Clo3w9ZF.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-43cDZ6AH.js", "./assets/icc-BoBgzEP_.js", "./assets/index-1yPbdzaB.js", "./assets/index-DqhPBDKQ.css", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-Bvzn4IXA.js", "./assets/more2-DqVyfdVu.js", "./assets/nef-CUzRBbWi.js", "./assets/panorama-Bt6ds7uT.js", "./assets/patheffects-Dx1vqICh.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-DPxqRQjl.js", "./assets/pixelart-D6WNdy03.js", "./assets/psd-VbQuzU65.js", "./assets/raster-BOSyYYRX.js", "./assets/rawdev-rL3bKpdc.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-D5nNQFtB.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-10wg3Wb8.js", "./assets/sky-sdAanTip.js", "./assets/subject-ytwD4MNN.js", "./assets/svgimport-CBm7ZLzn.js", "./assets/swatches-DxKgC-tZ.js", "./assets/textures-owkMERw3.js", "./assets/touchtour-CAXh_XKp.js", "./assets/trace-aVyjw6ZF.js", "./assets/tutorial-C-2VzyJ4.js", "./assets/unique-aPWj7stU.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-PdwaK7zp.js", "./assets/wideangle-CTaAT2N8.js", "./assets/worker-DDxukivi.js"]).catch(() => {}))); });
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
