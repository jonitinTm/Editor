// Service worker: permite usar Photocap sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-27T06:08:26.531Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-C04lNckw.js", "./assets/artist-CsynPJWX.js", "./assets/artistic-CiyNz7fX.js", "./assets/arw-BU8hY1QT.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-CIov4nf9.js", "./assets/create-DC7btEGd.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-C8nHj3yd.js", "./assets/dng-imR3UGgu.js", "./assets/expand-Dnf0cBYl.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-BFCKAEFR.js", "./assets/icc-BoBgzEP_.js", "./assets/index--s9BRjWj.js", "./assets/index-rXu0oHd3.css", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-C5rLyZ2_.js", "./assets/more2-CZHyipoI.js", "./assets/nef-CgUwN1Ja.js", "./assets/panorama-Bt6ds7uT.js", "./assets/patheffects-BQ-ecZQ7.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-C75cknAK.js", "./assets/psd-CkERR9qF.js", "./assets/raster-B2CfsSd1.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-DOHCSuo0.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-DjZ4Zw9j.js", "./assets/sky-BGnuRywE.js", "./assets/subject-DWoeWiEw.js", "./assets/svgimport-CkXh6O0y.js", "./assets/swatches-DxKgC-tZ.js", "./assets/touchtour-DQh0UdWw.js", "./assets/trace-DDLegmYy.js", "./assets/tutorial-dcacqUlt.js", "./assets/unique-CoY3EQI_.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-B0wWOTh7.js", "./assets/wideangle-BV3lVWrD.js", "./assets/worker-DDxukivi.js"]).catch(() => {}))); });
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
