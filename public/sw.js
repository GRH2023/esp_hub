//mainly chatgpt:

const CACHE = "esp-hub-v2";
const ASSETS = ["/", "/styles.css", "/main.js", "/manifest.webmanifest", "/icon-192.png", "/icon-192-maskable.png", "/icon-512.png", "/icon-512-maskable.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// App shell cache-first, API network-first
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (ASSETS.includes(u.pathname)) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  } else if (u.pathname.startsWith("/api/")) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
  }
});
