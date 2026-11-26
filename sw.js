// Service worker: permite usar Editor sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-26T06:14:52.407Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-BtEq_bTk.js", "./assets/artist-DsjMR-Ro.js", "./assets/artistic-B7ca0Da7.js", "./assets/arw-BU8hY1QT.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-CIov4nf9.js", "./assets/create-D3U6rmFy.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-woFLWff6.js", "./assets/dng-imR3UGgu.js", "./assets/expand-CIdQ0XR0.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-bfarUVcF.js", "./assets/icc-BoBgzEP_.js", "./assets/index-CvcIj4x5.css", "./assets/index-DNVw5SK5.js", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-CFcXqBlL.js", "./assets/more2-C6_eyEA7.js", "./assets/nef-CgUwN1Ja.js", "./assets/panorama-Bt6ds7uT.js", "./assets/patheffects-Df_j9udD.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-DCO2lzAH.js", "./assets/psd-C-VTlnEj.js", "./assets/raster-B2CfsSd1.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-BeWaDdnP.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-CLQJJhLU.js", "./assets/sky-CnhvqOlT.js", "./assets/subject-D239CzLz.js", "./assets/svgimport-Dq7lnbaE.js", "./assets/swatches-DxKgC-tZ.js", "./assets/touchtour-CEZGuQha.js", "./assets/trace-ByiACdig.js", "./assets/unique-27M--ncr.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-Cmuqn7Nq.js", "./assets/wideangle-CukCDUN-.js", "./assets/worker-DWLBElfm.js"]).catch(() => {}))); });
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
