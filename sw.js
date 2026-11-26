// Service worker: permite usar Editor sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-26T06:22:13.959Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-CC5A6nCo.js", "./assets/artist-Bry3MTih.js", "./assets/artistic-D963NAvp.js", "./assets/arw-BU8hY1QT.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-CIov4nf9.js", "./assets/create-CH6Gb6Pi.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-CWyVXPsv.js", "./assets/dng-imR3UGgu.js", "./assets/expand-CF8F0h29.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-D4nh0m0b.js", "./assets/icc-BoBgzEP_.js", "./assets/index-5VQ2bqjL.css", "./assets/index-Bch2Uxym.js", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-BmUhbtHh.js", "./assets/more2-BEra2KRp.js", "./assets/nef-CgUwN1Ja.js", "./assets/panorama-Bt6ds7uT.js", "./assets/patheffects-CvMzlo5a.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-DgCmpthy.js", "./assets/psd-BhGtnFU_.js", "./assets/raster-B2CfsSd1.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-bnxaofjk.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-CvbwA_9y.js", "./assets/sky-D4Yxrca8.js", "./assets/subject-6GPHAlD9.js", "./assets/svgimport-xeML9jwV.js", "./assets/swatches-DxKgC-tZ.js", "./assets/touchtour-D9Y8LOzB.js", "./assets/trace-BEIyFISq.js", "./assets/unique-nptLSqAC.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-D3IB4RVP.js", "./assets/wideangle-BFeNIJN0.js", "./assets/worker-DWLBElfm.js"]).catch(() => {}))); });
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
