// Service worker: permite usar Photocap sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-28T00:40:53.209Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-DlIJnxP-.js", "./assets/animaudio-Cy7TfFkP.js", "./assets/artist-CYFj17qB.js", "./assets/artistic-DIUQ1a3g.js", "./assets/arw-DrVtHsmS.js", "./assets/camera-jKxFe5xk.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-DWmiFkZT.js", "./assets/create-BhnbQ0NM.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-DXyzJAGQ.js", "./assets/dng-CxUpOJq7.js", "./assets/expand-HWaVM3Jh.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-QXJN6b1L.js", "./assets/gamedev-Dkt5xrpp.js", "./assets/gameui-BewO4CyY.js", "./assets/gamextra-CVb_vq-D.js", "./assets/icc-BoBgzEP_.js", "./assets/index-Csz_peDX.js", "./assets/index-DXCkb02H.css", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-Dngwflkl.js", "./assets/more2-DYevMMDS.js", "./assets/nef-BxiixGWu.js", "./assets/panorama-Bt6ds7uT.js", "./assets/patheffects-BVZ4kT-f.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-DDTWlzCr.js", "./assets/premium-645-zPL8.js", "./assets/premium2-BFyG4EMG.js", "./assets/psd-7DaA_K4g.js", "./assets/raster-Bmz_ggHw.js", "./assets/rawdev-DhXMskmG.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-xsTWgsoq.js", "./assets/rig-C8Aj9TYY.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-ASgOqOgK.js", "./assets/sky-f0H1YPA_.js", "./assets/subject-DGG9Ud6s.js", "./assets/svgimport-BFY1Jl4E.js", "./assets/swatches-DxKgC-tZ.js", "./assets/texdetails-Zwflmi7s.js", "./assets/textures-CHjbwgm4.js", "./assets/tilemap-DWf7Sx71.js", "./assets/touchtour-DtywH6PP.js", "./assets/trace-B3HM5i82.js", "./assets/tutorial-Dr3cxJSI.js", "./assets/unique-C3ZnETXr.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-B_GMc4d9.js", "./assets/wideangle-DK07j_LR.js", "./assets/worker-C2TpEWxD.js"]).catch(() => {}))); });
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
