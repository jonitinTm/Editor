// Service worker: permite usar Photocap sin conexión una vez abierto.
// Siempre intenta primero la red (para tener la última versión) y, si falla, usa la copia guardada.
const CACHE = 'editor-2026-11-28T03:50:45.421Z';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './privacidad.html', "./assets/abr-tSRbQMpZ.js", "./assets/aicore-0ZCt0LQJ.js", "./assets/aitools2-QMwy5wMJ.js", "./assets/animaudio-_9ziKOpy.js", "./assets/artist-BIgL-Py_.js", "./assets/artistic-BoSnjahz.js", "./assets/arw-ONWW8v3G.js", "./assets/camera-DD0wB_nd.js", "./assets/contour-BVoPIrf3.js", "./assets/cr2-dbI3Qfg-.js", "./assets/create-DgylfOpK.js", "./assets/cropscan-VA4xhty7.js", "./assets/dialogs-BVvMKAqR.js", "./assets/dng-r5ybhWLj.js", "./assets/expand-Dtgbpa2s.js", "./assets/expfusion-cmIp5zHO.js", "./assets/gallery-21UYsXLv.js", "./assets/gamedev-C0wIyHmZ.js", "./assets/gameui-Bxq7-4_V.js", "./assets/gamextra-OFk2wGVI.js", "./assets/icc-BoBgzEP_.js", "./assets/index-BaV7-geL.css", "./assets/index-C7e5QFpx.js", "./assets/inpaint-C9XrkcfX.js", "./assets/mobilemenu-CAivY0eC.js", "./assets/more2-BnQ6Cuxl.js", "./assets/nef-DPh3HAS0.js", "./assets/panorama-Bt6ds7uT.js", "./assets/particles-BdMhGfGa.js", "./assets/patheffects-BD00bBiw.js", "./assets/pdf-Brfj7UaP.js", "./assets/perf-DUkGbTKQ.js", "./assets/premium-CxVa5Jy9.js", "./assets/premium2-CnlAaoDt.js", "./assets/psd-CgwRn_nh.js", "./assets/raster-D-Tu5-mU.js", "./assets/rawdev-Ba5jR7De.js", "./assets/recent-BlVXv7CM.js", "./assets/render2-CJdxrGhm.js", "./assets/retouch-DgQDHD0R.js", "./assets/rig-MyBnNwqR.js", "./assets/seamcarve-Bhdg6kjs.js", "./assets/shadow3d-DjW6oDnG.js", "./assets/sky-m_X_DKJC.js", "./assets/subject-DiEevYuE.js", "./assets/svgimport-CHieMw2e.js", "./assets/swatches-DxKgC-tZ.js", "./assets/texdetails-CKniOuKb.js", "./assets/textures-C9ay2clr.js", "./assets/tilemap-BAOJ0I3Y.js", "./assets/touchtour-d46E2c3U.js", "./assets/trace-D784glQT.js", "./assets/tutorial-C1wfWPtm.js", "./assets/unique-G5FTsqjn.js", "./assets/vectorcraft-MIT-C8832Oap.js", "./assets/watermark-chVf497R.js", "./assets/wideangle-NSM3VA8t.js", "./assets/worker-C2TpEWxD.js"]).catch(() => {}))); });
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
