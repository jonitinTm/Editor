// Service worker: permite usar Editor sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-26T11:38:15.367Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-BlHOJwFD.js", "./assets/artist-DGMLIBSK.js", "./assets/artistic-DaK5WVyV.js", "./assets/arw-BU8hY1QT.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-CIov4nf9.js", "./assets/create-CMPturpc.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-D8b7E0me.js", "./assets/dng-imR3UGgu.js", "./assets/expand-XaERbHvy.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-DR1IfHad.js", "./assets/icc-BoBgzEP_.js", "./assets/index-CLpRTkmA.js", "./assets/index-NY4_tvtH.css", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-D5ZzMySN.js", "./assets/more2-C9bo_BDI.js", "./assets/nef-CgUwN1Ja.js", "./assets/panorama-Bt6ds7uT.js", "./assets/patheffects-DGPddYQu.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-BPPRB12u.js", "./assets/psd-D9qWuLAo.js", "./assets/raster-B2CfsSd1.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-Di5UT-m0.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-D-HYq5jO.js", "./assets/sky-C-dN_Oh7.js", "./assets/subject-JDrj5KqC.js", "./assets/svgimport-X5mDZafi.js", "./assets/swatches-DxKgC-tZ.js", "./assets/touchtour-2tXRIYpS.js", "./assets/trace-DXaPUYeI.js", "./assets/unique-C2dH8EpE.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-DkvyrVgN.js", "./assets/wideangle-DfJIEH8t.js", "./assets/worker-DDxukivi.js"]).catch(() => {}))); });
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
