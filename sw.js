// Service worker: permite usar Photocap sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-28T14:30:18.171Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-3HvOGoxU.js", "./assets/animaudio-DELfktfj.js", "./assets/artist-DUf50ylO.js", "./assets/artistic-D8qiSwcg.js", "./assets/arw-R-B31E_J.js", "./assets/audiostudio-DpG94YvV.js", "./assets/camera-D1CPDnSI.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-CHrvVMgS.js", "./assets/create-Cx7qrBqO.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-CpH_wCFM.js", "./assets/dng-BzPUyIQB.js", "./assets/expand-BmswzRP3.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-COyMjrxy.js", "./assets/gamedev-CturzgWC.js", "./assets/gameui-CrvFrOk-.js", "./assets/gamextra-DPT030sK.js", "./assets/icc-BoBgzEP_.js", "./assets/index-Bl72ln3M.js", "./assets/index-CqSobEEC.css", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-BE_T7pzR.js", "./assets/more2-BV5gr3wj.js", "./assets/nef-CoQDCOiH.js", "./assets/panorama-Bt6ds7uT.js", "./assets/particles-BZQbMVxw.js", "./assets/patheffects-BX2wjYpo.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-betQHX4-.js", "./assets/premium-DIoDpVrh.js", "./assets/premium2-DppG5UHk.js", "./assets/psd-DJxBXLrd.js", "./assets/raster-DaVNgn6S.js", "./assets/rawdev-CXvOUOqR.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-BP5AwRDM.js", "./assets/rig-Bhn58EJI.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-Cpgq9kxI.js", "./assets/sky-qzYThROH.js", "./assets/subject-6Nliww88.js", "./assets/svgimport-akPY5VUl.js", "./assets/swatches-DxKgC-tZ.js", "./assets/texdetails-DH5gz2xw.js", "./assets/textures-DkAECPVh.js", "./assets/tilemap-JR0dg3LI.js", "./assets/touchtour-CUXzreYA.js", "./assets/trace-XrdLHs4c.js", "./assets/tutorial-B2DLcC8c.js", "./assets/unique-CvDus1L7.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-BTKBTEqX.js", "./assets/wideangle-ms3B5cux.js", "./assets/worker-C2TpEWxD.js"]).catch(() => {}))); });
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
