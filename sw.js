// Service worker: permite usar Photocap sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-27T07:46:20.188Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-tbA6Z68h.js", "./assets/artist-DUZMaaAM.js", "./assets/artistic-DjiPvrtG.js", "./assets/arw-COQExL5G.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-C4EKQS3d.js", "./assets/create-dHt_Om_P.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-BeT8anNV.js", "./assets/dng-Bt1mmOJJ.js", "./assets/expand-DdeN3fgq.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-wq9A-W2E.js", "./assets/icc-BoBgzEP_.js", "./assets/index-B-TK7k6C.js", "./assets/index-D4Ixmttb.css", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-BOUxzqpX.js", "./assets/more2-bvDJuSr8.js", "./assets/nef-x0pFaVqb.js", "./assets/panorama-Bt6ds7uT.js", "./assets/patheffects-DStVQGgu.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-ByE3WmTm.js", "./assets/pixelart-BgV_tpss.js", "./assets/psd-BxWimt7J.js", "./assets/raster-0IA_Bc3N.js", "./assets/rawdev-CXOGBK5k.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-BWNeWIG4.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-CKJXgfOM.js", "./assets/sky-B2wETEb4.js", "./assets/subject--1lh8-zP.js", "./assets/svgimport-Iz2XCzU9.js", "./assets/swatches-DxKgC-tZ.js", "./assets/textures-Bfp5djCU.js", "./assets/touchtour-Dv6lpsuf.js", "./assets/trace-DTEjIKu_.js", "./assets/tutorial-DzLQx8gU.js", "./assets/unique-BvL4hNIO.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-DlyILVQb.js", "./assets/wideangle-Bx_DtQoD.js", "./assets/worker-DDxukivi.js"]).catch(() => {}))); });
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
