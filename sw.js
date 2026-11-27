// Service worker: permite usar Photocap sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-27T07:56:56.428Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-DkRYJb7-.js", "./assets/anim-kTPQQVYq.js", "./assets/artist-HZm4fOl7.js", "./assets/artistic-B7WIPjsF.js", "./assets/arw-DxrJs23z.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-HYbFQkOf.js", "./assets/create-ZMBt6eLO.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-DtvxCd9v.js", "./assets/dng-DZ6K3o35.js", "./assets/expand-FIfVOtCU.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-D8l07HWX.js", "./assets/gamedev-CYE7m9O6.js", "./assets/icc-BoBgzEP_.js", "./assets/index-CAaGUT1M.js", "./assets/index-_a5g-5QN.css", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-JS897uzr.js", "./assets/more2-CgmxfVLE.js", "./assets/nef-MsoM2zlR.js", "./assets/panorama-Bt6ds7uT.js", "./assets/patheffects-B1TV9NdZ.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-D2CvdPIp.js", "./assets/pixelart-O_OBWZJS.js", "./assets/psd-Dpx9uva0.js", "./assets/raster-ClD8_vxo.js", "./assets/rawdev-C64VQvFu.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-Ck9tGq-z.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-DKADgFAa.js", "./assets/sky-a0_iEl-C.js", "./assets/subject-BDJRxbNg.js", "./assets/svgimport-C0H6ldeK.js", "./assets/swatches-DxKgC-tZ.js", "./assets/textures-BC78vEr8.js", "./assets/touchtour-CuDw3Owu.js", "./assets/trace-BS2GCZc_.js", "./assets/tutorial-DZ6xOM57.js", "./assets/unique-BvPbSiuJ.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-DIupZ85F.js", "./assets/wideangle-kq5PsxiJ.js", "./assets/worker-DDxukivi.js"]).catch(() => {}))); });
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
