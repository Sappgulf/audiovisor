/* eslint-disable */
/* global self, caches, fetch, location, Response */

/* Bump on every release. The old name was pinned at v6.3 across many
   deploys, so returning visitors kept being served whatever assets their
   cache already held. */
const CACHE = 'audiovisor-v8.29.0';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  /* Cache the shell and the build-time precache manifest. The old version
     stored only '/', so a first offline launch had HTML but no JS, CSS or
     fonts; now every hashed chunk and the local fonts are fetched once,
     individually, so one missing optional asset cannot reject the batch. */
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    let assets = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];
    try {
      const res = await fetch('/precache-manifest.json', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.assets)) assets = [...new Set([...assets, ...data.assets])];
      }
    } catch { /* dev server or an old build without the manifest */ }
    await Promise.allSettled(assets.map((url) => c.add(url)));
  })());
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
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  /* PWA share_target: park the shared audio in the cache, then redirect into
     the app. The page takes it out of the cache in src/file-loader.js. */
  if (request.method === 'POST' && url.pathname === '/share-target') {
    e.respondWith((async () => {
      try {
        const form = await request.formData();
        const file = form.get('audio');
        if (file && typeof file !== 'string' && file.size) {
          const cache = await caches.open(CACHE);
          await cache.put(
            new Request(new URL('/__shared_audio__', self.location.origin)),
            new Response(file, {
              headers: {
                'Content-Type': file.type || 'audio/mpeg',
                'X-File-Name': encodeURIComponent(file.name || 'shared-audio'),
                'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name || 'shared-audio')}`,
              },
            }),
          );
        }
      } catch { /* bad payload: still return the app */ }
      return Response.redirect(new URL('/?shared=1', self.location.origin).toString(), 303);
    })());
    return;
  }

  if (request.method !== 'GET') return;
  if (url.pathname === '/__shared_audio__') {
    e.respondWith(caches.match('/__shared_audio__').then((r) => r || new Response('No shared file', { status: 404 })));
    return;
  }
  /* never touch the token API, and never cache a partial (Range/206) audio
     response under the full URL — it breaks offline playback */
  if (url.pathname.startsWith('/api/')) return;
  if (request.headers.has('range')) return;

  // navigations: network-first so users always get fresh HTML
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          /* OAuth callbacks carry a one-use code/state in the query; caching
             that URL retains it and grows the cache without bound */
          const oauth = url.search.includes('code=') || url.search.includes('state=') || url.searchParams.has('shared');
          if (res.status === 200 && !oauth) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
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
            if (res.status === 200) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
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
        if (res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});
