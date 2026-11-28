// Service worker: permite usar Photocap sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-28T04:02:43.025Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-eFjxzWqu.js", "./assets/animaudio-DjYAyCe9.js", "./assets/artist-DdSCla4V.js", "./assets/artistic-BJ1MBxvh.js", "./assets/arw-DwX_5H_-.js", "./assets/audiostudio-B4z6TEdy.js", "./assets/camera-DIYeFqdK.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-CLcmOPm0.js", "./assets/create-COKsFcYc.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-LbasCqNC.js", "./assets/dng-Dm-N6ao2.js", "./assets/expand-BLlZkOdt.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-Dwu8i0kH.js", "./assets/gamedev-DunCCbsE.js", "./assets/gameui-Duhuyw2g.js", "./assets/gamextra-C8fb12cg.js", "./assets/icc-BoBgzEP_.js", "./assets/index-2Ld3IEjQ.js", "./assets/index-CqSobEEC.css", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-BQz04ROr.js", "./assets/more2-CnX3qnt-.js", "./assets/nef-Dqt-3sfy.js", "./assets/panorama-Bt6ds7uT.js", "./assets/particles-zTCRu58t.js", "./assets/patheffects-BKTypKsF.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-CrZh3auh.js", "./assets/premium-BgjfC6Nv.js", "./assets/premium2-6tIeD24L.js", "./assets/psd-CUMsccrK.js", "./assets/raster-VlOyj7Hy.js", "./assets/rawdev-DhSHBZB1.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-ChKUDvNV.js", "./assets/rig-BoFtlLTp.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-D_JZrN3u.js", "./assets/sky-5a_chWMg.js", "./assets/subject-B4RZ_u9r.js", "./assets/svgimport-Cvh-C_qV.js", "./assets/swatches-DxKgC-tZ.js", "./assets/texdetails-CbUDN1xX.js", "./assets/textures-De7ZC2cG.js", "./assets/tilemap-CeIlGH-P.js", "./assets/touchtour-tza1WDLl.js", "./assets/trace-C10_6nZd.js", "./assets/tutorial-BYslJvuZ.js", "./assets/unique-CTuoRjcr.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-CKHHCQaS.js", "./assets/wideangle-CnQRYWX4.js", "./assets/worker-C2TpEWxD.js"]).catch(() => {}))); });
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
