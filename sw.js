// offline cache for the app; Google Sheet requests always go to the network
const CACHE = 'omr-2.1.0';
const ASSETS = ["./", "index.html", "app.js", "omr.js", "layout.js", "gscode.js", "manifest.webmanifest", "vendor/pdf.min.js", "vendor/pdf.worker.min.js", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "fonts/sarabun-latin-400.woff2", "fonts/sarabun-latin-600.woff2", "fonts/sarabun-latin-700.woff2", "fonts/sarabun-thai-400.woff2", "fonts/sarabun-thai-600.woff2", "fonts/sarabun-thai-700.woff2"];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const key = req.mode === 'navigate' ? 'index.html' : req;
    const hit = await c.match(key, {ignoreSearch: true});
    const net = fetch(req).then(res => { if (res && res.ok) c.put(key, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || new Response('ออฟไลน์', {status: 503});
  }));
});
