// Caching strategy. Getting this wrong ships stale apps: an earlier version
// answered EVERY request cache-first (pages, bundles and /api data), so each
// visit booted the previous visit's build and showed old numbers until a hard
// refresh. Now:
//   • pages (navigations)      → network first; cache only as an offline fallback
//   • /api/*                    → never touched by the worker
//   • /_next/static/* (hashed)  → cache first; the filename changes when content does
//   • icons and other static    → stale-while-revalidate
// Bump CACHE whenever this strategy changes; activation purges every other cache.
const CACHE = "gooddrops-v22";
const OFFLINE_PAGES = ["/"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(OFFLINE_PAGES))
      .catch(() => {}) // offline fallback is a nicety; never block install on it
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function putInCache(req, res) {
  if (!res || !res.ok || res.type === "opaque") return;
  const clone = res.clone();
  caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;           // live data: always network
  if (url.pathname === "/sw.js") return;

  // Pages: always try the network so a deploy is visible on the next visit.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => { if (url.pathname === "/") putInCache("/", res); return res; })
        .catch(() => caches.match(req).then((c) => c || caches.match("/")))
    );
    return;
  }

  // Content-hashed build output never changes under the same URL.
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => { putInCache(req, res); return res; }))
    );
    return;
  }

  // Everything else (icons, images, fonts): fast from cache, refreshed behind.
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => { putInCache(req, res); return res; }).catch(() => cached);
      return cached || network;
    })
  );
});

// ── Push notifications ────────────────────────────────────────────────────────

self.addEventListener("push", (e) => {
  let data = { title: "GoodDrops", body: "", url: "/", tag: "gooddrops" };
  try {
    data = { ...data, ...e.data?.json() };
  } catch {}

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:   data.body,
      icon:   "/icons/192",
      badge:  "/icons/192",
      tag:    data.tag,
      data:   { url: data.url },
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url ?? "/";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
