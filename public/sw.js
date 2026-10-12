/* eslint-disable */
/* global self, caches, fetch, location, Response */

/* Bump on every release. The old name was pinned at v6.3 across many
   deploys, so returning visitors kept being served whatever assets their
   cache already held. */
const CACHE = 'audiovisor-v8.17.0';

/* The app shell a visitor needs to open with no network. The build's hashed
   JS and CSS are not listed here, because their names change with every build;
   install reads them out of the page instead (see precache). */
const SHELL = [
  '/',
  '/manifest.json',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

/* Hashed build files referenced by a page: the entry script, its stylesheet
   and any preloads. Matches the same attributes the HTML uses for them. */
const ASSET_REF = /(?:src|href)="(\/assets\/[^"]+)"/g;

/* Cache the current page, the build files it names and the static shell.
   A first visit installs the worker before it controls the page, so without
   this its JS and CSS were never stored, and an offline return showed HTML with
   nothing to run. A failed entry is skipped so one missing file cannot stop
   the rest. */
async function precache() {
  const c = await caches.open(CACHE);
  const page = await fetch('/', { cache: 'no-cache' });
  if (page.ok) {
    await c.put('/', page.clone());
    const html = await page.text();
    const assets = [...html.matchAll(ASSET_REF)].map((m) => m[1]);
    await Promise.all([...new Set(assets)].map((u) => c.add(u).catch(() => {})));
  }
  await Promise.all(SHELL.filter((u) => u !== '/').map((u) => c.add(u).catch(() => {})));
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache().catch(() => {}));
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
          // an error page cached here would be served offline in its place
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        // offline, a shortcut such as /?demo=1 has no copy of its own: serve the shell
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

  /* API responses are never copied into Cache Storage. /api/apple-music-token
     returns a signed developer credential marked no-store, and the offline
     fallback in the catch would otherwise hand that copy back long after it
     was issued. The same goes for any response that asks not to be stored. */
  e.respondWith(
    fetch(request)
      .then((res) => {
        const cacheable = res.ok && !url.pathname.startsWith('/api/')
          && !/no-store/i.test(res.headers.get('Cache-Control') || '');
        if (cacheable) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});
