// Service worker: permite usar Photocap sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-28T03:55:58.267Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-iKxnrs4x.js", "./assets/animaudio-BzUNobY7.js", "./assets/artist-DX3Hjv8m.js", "./assets/artistic-BCb1cJ6s.js", "./assets/arw-BLauEHtR.js", "./assets/camera-W77kdJPd.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-D4o_k1HC.js", "./assets/create-BrDXf3eP.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-CXp7ihfu.js", "./assets/dng-Dhd_jApp.js", "./assets/expand-Cfn55MRt.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-Bv-PDOPX.js", "./assets/gamedev-CsHuouL1.js", "./assets/gameui-BLpexMBA.js", "./assets/gamextra-DgQNWrs7.js", "./assets/icc-BoBgzEP_.js", "./assets/index-C2WDhbuM.css", "./assets/index-WpySx7ev.js", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-CSZcu90R.js", "./assets/more2-DqVUc0wP.js", "./assets/nef-DJ9iOpyT.js", "./assets/panorama-Bt6ds7uT.js", "./assets/particles-CZSU_EpC.js", "./assets/patheffects-o2Um-3bl.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-CKXoPv5w.js", "./assets/premium-CM7SBLPN.js", "./assets/premium2-Cn90Qs1A.js", "./assets/psd-DjxtIB6a.js", "./assets/raster-DV6bMJtJ.js", "./assets/rawdev-2B-LCr9h.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-VZcvzXLE.js", "./assets/rig-CYTTH1Yq.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-DjJ9qo7K.js", "./assets/sky-CDrDd9MS.js", "./assets/subject-CKpMRE0z.js", "./assets/svgimport-D7HU1Ug4.js", "./assets/swatches-DxKgC-tZ.js", "./assets/texdetails-Dd4vpwuk.js", "./assets/textures-dywNcf0U.js", "./assets/tilemap-CatEAjjY.js", "./assets/touchtour-BLrDCzyz.js", "./assets/trace-CIjBV_U8.js", "./assets/tutorial-mycKNxhY.js", "./assets/unique-BFelYiXv.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-D4pBi0ts.js", "./assets/wideangle-Dj5mqtkj.js", "./assets/worker-C2TpEWxD.js"]).catch(() => {}))); });
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
