// Service worker: permite usar Photocap sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-28T03:46:16.744Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-9UlFDWtR.js", "./assets/animaudio-D9k6Orfo.js", "./assets/artist-D3gmuVEH.js", "./assets/artistic-CmK7diwo.js", "./assets/arw-CLhrGE0E.js", "./assets/camera-BvzHuO-d.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-Cb0KUmwW.js", "./assets/create-CHUQ7-3M.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-0dl3z-O_.js", "./assets/dng-Ci8lrqih.js", "./assets/expand-VISRHfvp.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-DAuUb0wo.js", "./assets/gamedev-BncLZ8Hx.js", "./assets/gameui-B7ZWPpT8.js", "./assets/gamextra-q3rzzHxy.js", "./assets/icc-BoBgzEP_.js", "./assets/index-C6e1547v.css", "./assets/index-DEehDgBG.js", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-D5ZFajiB.js", "./assets/more2-DRouUu7v.js", "./assets/nef-Dr6RVC3o.js", "./assets/panorama-Bt6ds7uT.js", "./assets/particles-DFgRR0JS.js", "./assets/patheffects-IAgpEzuW.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-m5G2YM30.js", "./assets/premium-DivwLVao.js", "./assets/premium2-BEq7B0aA.js", "./assets/psd-CgK7Xrqg.js", "./assets/raster-DWaF4ZJ5.js", "./assets/rawdev-CyNZ6cHw.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-DUhde--B.js", "./assets/rig-C60CEq_h.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-DcrxPKFv.js", "./assets/sky-DsYFSrxh.js", "./assets/subject-JoV_VuxI.js", "./assets/svgimport-B0JVDqK3.js", "./assets/swatches-DxKgC-tZ.js", "./assets/texdetails-hYgphLk-.js", "./assets/textures-BfVBlX7Y.js", "./assets/tilemap-CkzPi0Y8.js", "./assets/touchtour-QObyFjt9.js", "./assets/trace-DWLqSLsz.js", "./assets/tutorial-VV788cQx.js", "./assets/unique-DDtG8LdL.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-CZXObPKk.js", "./assets/wideangle-DwJvjDvK.js", "./assets/worker-C2TpEWxD.js"]).catch(() => {}))); });
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
