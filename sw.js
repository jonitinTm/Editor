// Service worker: permite usar Photocap sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-27T13:28:40.411Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-BEtCXiG5.js", "./assets/artist-BBE_nD6k.js", "./assets/artistic-RJRAWifG.js", "./assets/arw-DWIOsj8D.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-DSb7cjiv.js", "./assets/create-DH1GKoFu.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-CccvYH4z.js", "./assets/dng-Bu_gRQoF.js", "./assets/expand-CIDvt7rL.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-DmRAgdzZ.js", "./assets/gamedev-DjdnTiMI.js", "./assets/gamextra-Ee4BLWRj.js", "./assets/icc-BoBgzEP_.js", "./assets/index-Cu_8qVot.js", "./assets/index-DdpVCSE0.css", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-FUkQpBvD.js", "./assets/more2-D8dI4tJ9.js", "./assets/nef-Dj2TU2Zx.js", "./assets/panorama-Bt6ds7uT.js", "./assets/patheffects-Cys_7hvj.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-DGZIUz4J.js", "./assets/premium-DE-5uPdn.js", "./assets/premium2-D9FKcjr2.js", "./assets/psd-ByxNusC2.js", "./assets/raster-CNP25j5C.js", "./assets/rawdev-CpwR7aJr.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-DC7dEi5_.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-CWhNCeAA.js", "./assets/sky-DHyaxDjO.js", "./assets/subject-tafDxhs7.js", "./assets/svgimport-PVsosZzo.js", "./assets/swatches-DxKgC-tZ.js", "./assets/texdetails-BhWQlNxJ.js", "./assets/textures-DJjZYnkj.js", "./assets/tilemap-C_TINYQx.js", "./assets/touchtour-B3nkp7yu.js", "./assets/trace-BYfMRC6y.js", "./assets/tutorial-CJxYqfmP.js", "./assets/unique-C8YS1fag.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-C6KDZOaf.js", "./assets/wideangle-wtbVopay.js", "./assets/worker-C2TpEWxD.js"]).catch(() => {}))); });
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
