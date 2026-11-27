// Service worker: permite usar Photocap sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-27T07:20:24.964Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-H8QhKGx5.js", "./assets/artist-EJFa887W.js", "./assets/artistic-e1_fB2bo.js", "./assets/arw-BXVzyrup.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-BTAJcdni.js", "./assets/create-DQSrvwBX.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-xNNUwZqH.js", "./assets/dng-CyLyZsqd.js", "./assets/expand-DLOoN1lf.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-Wux5n5QG.js", "./assets/icc-BoBgzEP_.js", "./assets/index-BMM0I3Kr.js", "./assets/index-YdG4xHOt.css", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-CltDOS-y.js", "./assets/more2-BJV8yjRF.js", "./assets/nef-BpnuYa6N.js", "./assets/panorama-Bt6ds7uT.js", "./assets/patheffects-nXi1qQOi.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-DdBUll-G.js", "./assets/pixelart-GY9quKYK.js", "./assets/psd-B1DH98Io.js", "./assets/raster-DyP2TXGI.js", "./assets/rawdev-CQOpnyXT.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-CRYqdNnL.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-BL7dibsy.js", "./assets/sky-BECNe4q-.js", "./assets/subject-DZSTUQCO.js", "./assets/svgimport-D-pUVSyk.js", "./assets/swatches-DxKgC-tZ.js", "./assets/touchtour-De2nXn6K.js", "./assets/trace-Cn9B1jEX.js", "./assets/tutorial-DUvdhB16.js", "./assets/unique-BHqbp1uJ.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-9TyxcNhu.js", "./assets/wideangle-DOIV4pmd.js", "./assets/worker-DDxukivi.js"]).catch(() => {}))); });
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
