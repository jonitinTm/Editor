// Service worker: permite usar Photocap sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-28T03:40:47.809Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-BBJqasfm.js", "./assets/animaudio-Bh1D4uRW.js", "./assets/artist-1H9aK6ef.js", "./assets/artistic-CFU-_tWI.js", "./assets/arw-B0Iy8ayc.js", "./assets/camera-oBZQpPh3.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-rjSROgrT.js", "./assets/create-CvkRdyhJ.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-D_AZH3mG.js", "./assets/dng-DKpgQmcH.js", "./assets/expand-CS3kzUtY.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-NBNBYEYR.js", "./assets/gamedev-DFf3uCSi.js", "./assets/gameui-4ZAAWXgM.js", "./assets/gamextra-2F3UxEr0.js", "./assets/icc-BoBgzEP_.js", "./assets/index-BHe7l7rY.js", "./assets/index-C6e1547v.css", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-Cl9xZGbL.js", "./assets/more2-BXx-4Q7m.js", "./assets/nef-QNNUsHrv.js", "./assets/panorama-Bt6ds7uT.js", "./assets/particles-DmfGbDMz.js", "./assets/patheffects-DNYHfc9d.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-qfFoWl_d.js", "./assets/premium-DuP72xmq.js", "./assets/premium2-XYPJnJ9E.js", "./assets/psd-BAly_Kxw.js", "./assets/raster-CG0cRBqF.js", "./assets/rawdev-WHHJOTAk.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-Bummio5A.js", "./assets/rig-mEE3LPg-.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-CvtqJ4s2.js", "./assets/sky-DLfRoGop.js", "./assets/subject-C6nc78Z6.js", "./assets/svgimport-Dfbl4Tcj.js", "./assets/swatches-DxKgC-tZ.js", "./assets/texdetails-ff_1O_2Y.js", "./assets/textures-id5skyY0.js", "./assets/tilemap-COWJmT5_.js", "./assets/touchtour-T6JMvBJR.js", "./assets/trace-CbufnHHh.js", "./assets/tutorial-CUviMgnP.js", "./assets/unique-2Xz4IyjY.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-B6eSo6K9.js", "./assets/wideangle-WVFc3AwJ.js", "./assets/worker-C2TpEWxD.js"]).catch(() => {}))); });
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
