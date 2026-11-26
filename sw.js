// Service worker: permite usar Editor sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-26T06:38:00.680Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-CmWsZeiW.js", "./assets/artist-YxQE81Is.js", "./assets/artistic-CHAXJ4o-.js", "./assets/arw-BU8hY1QT.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-CIov4nf9.js", "./assets/create-DCa7M0OV.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-BLhJlgv4.js", "./assets/dng-imR3UGgu.js", "./assets/expand-DcItEb30.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-D7h0we1r.js", "./assets/icc-BoBgzEP_.js", "./assets/index-5VQ2bqjL.css", "./assets/index-DSFBVS2j.js", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-KpoRCDUn.js", "./assets/more2-MVGtH9Ol.js", "./assets/nef-CgUwN1Ja.js", "./assets/panorama-Bt6ds7uT.js", "./assets/patheffects-B230KpAx.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-C01BvsIU.js", "./assets/psd-DWAbDRJW.js", "./assets/raster-B2CfsSd1.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-ef0MMZyW.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-D5rmrjyz.js", "./assets/sky-DeYZ-aj1.js", "./assets/subject-DL2FyJlM.js", "./assets/svgimport-slopjyvU.js", "./assets/swatches-DxKgC-tZ.js", "./assets/touchtour-DAFa5qa2.js", "./assets/trace-BjIzYBfn.js", "./assets/unique-Cuptyc4l.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-g_GBUOgj.js", "./assets/wideangle-B6d5oXug.js", "./assets/worker-DWLBElfm.js"]).catch(() => {}))); });
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
