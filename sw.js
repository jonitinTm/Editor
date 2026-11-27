// Service worker: permite usar Photocap sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-27T11:33:52.732Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-C7oKrlU2.js", "./assets/artist-CYGosNHU.js", "./assets/artistic-C9rlHenx.js", "./assets/arw-DysNezKy.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-uX3sGmg5.js", "./assets/create-CNXWYfMC.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-BnQoCAWX.js", "./assets/dng-BIKYxnQb.js", "./assets/expand-D6vI3rrp.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-Bv58UeRQ.js", "./assets/gamedev-Cp3y_l7K.js", "./assets/icc-BoBgzEP_.js", "./assets/index-CtvfinX1.js", "./assets/index-_a5g-5QN.css", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-dUxpyL7l.js", "./assets/more2-Bj9cc_Sl.js", "./assets/nef-wyjF51vc.js", "./assets/panorama-Bt6ds7uT.js", "./assets/patheffects-C7zsDLso.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-EsJ8DwG8.js", "./assets/premium-DuUym7iL.js", "./assets/psd-Nuqzham6.js", "./assets/raster-Cgghv_-D.js", "./assets/rawdev-BLnLHUVt.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-D5uVFTjN.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-BFdSG9gp.js", "./assets/sky-BYc9_ZmL.js", "./assets/subject-9Nz4DxWf.js", "./assets/svgimport-CFq6ifEB.js", "./assets/swatches-DxKgC-tZ.js", "./assets/textures-BmALCPCv.js", "./assets/touchtour-COTUxSAW.js", "./assets/trace-DzriUGL0.js", "./assets/tutorial-CC41S-3L.js", "./assets/unique-Vs9kzC8i.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-D1z-CBwR.js", "./assets/wideangle-Dt4dIlEk.js", "./assets/worker-C2TpEWxD.js"]).catch(() => {}))); });
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
