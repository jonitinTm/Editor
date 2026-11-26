// Service worker: permite usar Editor sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-26T06:42:11.924Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-Q7wzSA_a.js", "./assets/artist-HpZMQlAK.js", "./assets/artistic-C2i0Yiog.js", "./assets/arw-BU8hY1QT.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-CIov4nf9.js", "./assets/create-BfYy86qr.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-BDyja5QI.js", "./assets/dng-imR3UGgu.js", "./assets/expand-DbjaUsi6.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-Vbkq2dag.js", "./assets/icc-BoBgzEP_.js", "./assets/index-5VQ2bqjL.css", "./assets/index-kwFIjXkc.js", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-Bxal-g-1.js", "./assets/more2-DpTWKD71.js", "./assets/nef-CgUwN1Ja.js", "./assets/panorama-Bt6ds7uT.js", "./assets/patheffects-CCQhEI_m.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-DtRgzYaR.js", "./assets/psd-C1w0blp8.js", "./assets/raster-B2CfsSd1.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-AwBWdUVJ.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-CFUi75Us.js", "./assets/sky-Cvbbqqr6.js", "./assets/subject-uOPrFmnS.js", "./assets/svgimport-Dh4Yr0fq.js", "./assets/swatches-DxKgC-tZ.js", "./assets/touchtour-Cw1BcvKL.js", "./assets/trace-Cj1-i2Cm.js", "./assets/unique-CgSOogfo.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-B1RDmARM.js", "./assets/wideangle-BRdbljnX.js", "./assets/worker-D7NTsZw0.js"]).catch(() => {}))); });
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
