// Service worker: permite usar Photocap sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-28T14:12:12.913Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-CrEMNGY8.js", "./assets/animaudio-B9xC_LLe.js", "./assets/artist-CsCrNfAS.js", "./assets/artistic-BaWvvFgS.js", "./assets/arw-By1YWlKY.js", "./assets/audiostudio-fMvPd6Rv.js", "./assets/camera-CYSXCe8c.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-Cj-fF1N-.js", "./assets/create-vXaEAjvB.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-C0FY3AZB.js", "./assets/dng-gfw7TYFt.js", "./assets/expand-C1Co8HXp.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-BUEVAnBP.js", "./assets/gamedev-D-Y8-Hhh.js", "./assets/gameui-CUjp5Xyg.js", "./assets/gamextra-DLvM1p1d.js", "./assets/icc-BoBgzEP_.js", "./assets/index-8fV0SBL9.js", "./assets/index-CqSobEEC.css", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-CVh56lau.js", "./assets/more2-CoTdzMKo.js", "./assets/nef-C5YoCP0m.js", "./assets/panorama-Bt6ds7uT.js", "./assets/particles-BN80rMt0.js", "./assets/patheffects-DJzlDkp1.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-BEamqlHA.js", "./assets/premium-CuNQW03V.js", "./assets/premium2-DKy8GWAh.js", "./assets/psd-CeaH-QaT.js", "./assets/raster-HkgNb04l.js", "./assets/rawdev-BrjWuxdT.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch--iQnxIb4.js", "./assets/rig-HiP5YR_E.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-Bfu30DkI.js", "./assets/sky-DkyccKHz.js", "./assets/subject-DK6NfpAi.js", "./assets/svgimport-0YUUSzY4.js", "./assets/swatches-DxKgC-tZ.js", "./assets/texdetails-IRhmKPmD.js", "./assets/textures-_PQcmuCo.js", "./assets/tilemap-BHYt_SzG.js", "./assets/touchtour-DlfuElIs.js", "./assets/trace-Cx4qoTty.js", "./assets/tutorial-CH5a0L_w.js", "./assets/unique-Yb9irdvJ.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-CEJKc_U6.js", "./assets/wideangle-DQg3B5yC.js", "./assets/worker-C2TpEWxD.js"]).catch(() => {}))); });
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
