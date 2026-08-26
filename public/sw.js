/* eslint-disable */
/* global self, caches, fetch, location, Response */

/* Bump on every release. The old name was pinned at v6.3 across many
   deploys, so returning visitors kept being served whatever assets their
   cache already held. */
const CACHE = 'audiovisor-v8.10.0';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // navigations: network-first so users always get fresh HTML
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match('/')))
    );
    return;
  }

  /* Hashed build assets are immutable, so cache-first is safe for them.
     Everything else (sw.js, manifest, og image, unhashed files) goes
     network-first so a deploy is never masked by a stale copy.

     This pattern used to expect `name.HASH.js` with a hex hash, but Vite
     emits `name-HASH.js` with a base64url hash — so it matched nothing at
     all and every build asset took the network path on every visit. The
     cache-first branch had never once run. tests/sw.test.js checks this
     against the filenames a real build produces. */
  const immutable = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(url.pathname);
  if (immutable) {
    e.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});
