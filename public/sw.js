/* RGS OneSite field service worker: keeps the field app usable without signal.
   Static assets: cache-first. Field pages: network-first, falling back to the last cached copy. API calls are never cached. */
const CACHE = "rgs-field-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/field", "/brand/rgs-logo.png", "/manifest.webmanifest"]).catch(() => {}))); });
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/")) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })));
    return;
  }
  if (url.pathname.startsWith("/field")) {
    e.respondWith(fetch(e.request).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return res; })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("/field"))));
  }
});
