// Service worker: permite usar Photocap sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-27T15:04:00.510Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-76zhZXUd.js", "./assets/artist-_UzRyxfu.js", "./assets/artistic-DC05XVbW.js", "./assets/arw-jomyFu4B.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-BQTJ2MH3.js", "./assets/create-C7b1FNhT.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-CyfWq-bL.js", "./assets/dng-CQhoIbXV.js", "./assets/expand-BsooK0C4.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-BolAFYsj.js", "./assets/gamedev-B5CoDrJg.js", "./assets/gameui-By09dNPj.js", "./assets/gamextra-Xq5wPavX.js", "./assets/icc-BoBgzEP_.js", "./assets/index-CtZh5Dq3.js", "./assets/index-XsZ6n0t3.css", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-Df6-kOSx.js", "./assets/more2-xDL_qsof.js", "./assets/nef-CLlEzQxK.js", "./assets/panorama-Bt6ds7uT.js", "./assets/patheffects-GUYN668I.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-N_w3DKnz.js", "./assets/premium-suqUVu9_.js", "./assets/premium2-DqlIkghx.js", "./assets/psd-DlAKuh8k.js", "./assets/raster-Dg_a1fi8.js", "./assets/rawdev-F5PJGHTc.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-fl8ItPOU.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-BkxBJnKn.js", "./assets/sky-BV7lb06U.js", "./assets/subject-BSlApVCX.js", "./assets/svgimport-rxpbFFHu.js", "./assets/swatches-DxKgC-tZ.js", "./assets/texdetails-B1tm5Dxw.js", "./assets/textures-C2yJesxr.js", "./assets/tilemap-BkXFSHrt.js", "./assets/touchtour-BVVML9EM.js", "./assets/trace-DMY882A0.js", "./assets/tutorial-BsWvUsQH.js", "./assets/unique-BtSgdQZJ.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-C3PowHwG.js", "./assets/wideangle-D-SFMp6M.js", "./assets/worker-C2TpEWxD.js"]).catch(() => {}))); });
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
