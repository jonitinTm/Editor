// Service worker: permite usar Photocap sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-27T07:30:27.147Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-B-gYeL82.js", "./assets/artist-CfB6c1EE.js", "./assets/artistic-Qe8AXFyu.js", "./assets/arw-BsSpMXdg.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-Ct6WgJwY.js", "./assets/create-DciPj-Mu.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-CzDMA2-K.js", "./assets/dng-PWgl1HUf.js", "./assets/expand-Cl1VF1KD.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-D3ay3oy0.js", "./assets/icc-BoBgzEP_.js", "./assets/index-DlwALlPZ.js", "./assets/index-YdG4xHOt.css", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-ZF4fsyCB.js", "./assets/more2-CYHxmZNP.js", "./assets/nef-CrRWVgIM.js", "./assets/panorama-Bt6ds7uT.js", "./assets/patheffects-ONTuY5La.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-CqV1XFF2.js", "./assets/pixelart-C5BVKCXu.js", "./assets/psd-BC5y3tZO.js", "./assets/raster-CYMaCw3P.js", "./assets/rawdev-CqidOaA3.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-DlGk1hNL.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-andncYrh.js", "./assets/sky-CMDiCm4p.js", "./assets/subject-ZCMGBzmY.js", "./assets/svgimport-Dvqjyc-V.js", "./assets/swatches-DxKgC-tZ.js", "./assets/touchtour-BfkG6WxU.js", "./assets/trace-DBho2PCk.js", "./assets/tutorial-XCxJCYvr.js", "./assets/unique-DlFuZOXI.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-Gxo4fJfq.js", "./assets/wideangle-Dls4JjiF.js", "./assets/worker-DDxukivi.js"]).catch(() => {}))); });
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
