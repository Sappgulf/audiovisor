/* eslint-disable */
/* global self, caches, fetch, location, Response */

/* Bump on every release. The old name was pinned at v6.3 across many
   deploys, so returning visitors kept being served whatever assets their
   cache already held. */
const CACHE = 'audiovisor-v8.42.0';

/* The shell plus the optional static assets. Hashed build output is appended
   from the build-time manifest below. */
const PRECACHE = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/sprites/bead.png'];
/* Precache is ~30 entries; leave room for lazily viewed mode art and samples
   without letting one-off URLs grow the cache forever. */
const MAX_CACHE_ENTRIES = 80;
/* Filled during install. Runtime trimming must never evict the shell or a
   hashed chunk that offline boot depends on. This set is memory-only, and a
   service worker is routinely restarted after idle — so trimCache() also
   protects these paths structurally instead of trusting the set alone. */
let precached = new Set();

/* Paths that offline boot depends on. Kept as a function, not a captured
   set, so a restarted worker still protects the shell. */
function isProtectedPath(pathname) {
  return pathname === '/'
    || pathname === '/manifest.json'
    || pathname === '/precache-manifest.json'
    || pathname.startsWith('/assets/')
    || pathname.startsWith('/fonts/')
    || pathname.startsWith('/icons/')
    || pathname.startsWith('/sprites/');
}

/* The share_target is a POST any site can send to this origin. Accept only
   real audio with a bounded body: taking file.type verbatim let a crafted
   share park text/html (or a multi-GB blob) in the app cache and serve it
   back from the trusted origin. */
const SHARE_MAX_BYTES = 100 * 1024 * 1024;
const SHARE_AUDIO_TYPES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
  'audio/vnd.wave', 'audio/flac', 'audio/x-flac', 'audio/ogg', 'audio/oga',
  'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/opus', 'audio/webm',
  'audio/aiff', 'audio/x-aiff', 'audio/x-caf',
]);
const SHARE_AUDIO_EXT = /\.(mp3|wav|flac|ogg|oga|m4a|mp4|aac|opus|webm|aiff?|caf)$/i;

function isSharedAudio(file) {
  if (!file || typeof file === 'string' || !file.size) return false;
  if (file.size > SHARE_MAX_BYTES) return false;
  const type = String(file.type || '').toLowerCase();
  if (type) return SHARE_AUDIO_TYPES.has(type);
  return SHARE_AUDIO_EXT.test(String(file.name || ''));
}

/* If one of these cannot be cached, keeping the previous worker is safer than
   activating with a shell that cannot boot offline. */
const isEssential = (url) => url === '/' || url.startsWith('/assets/');

function offline() {
  return new Response('Offline', {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_CACHE_ENTRIES) return;
  const excess = keys.length - MAX_CACHE_ENTRIES;
  const removable = keys.filter((key) => {
    const pathname = new URL(key.url).pathname;
    return !precached.has(pathname) && !isProtectedPath(pathname);
  });
  await Promise.all(removable.slice(0, excess).map((key) => cache.delete(key)));
}

async function cachePut(request, response) {
  const cache = await caches.open(CACHE);
  await cache.put(request, response);
  await trimCache(cache);
}

/* Put after a fetch has already been handed back. waitUntil keeps the worker
   alive for the write; in the rare case the event has already finished, the
   origin request must not fail just because the cache write cannot be waited
   on — so fall back to a best-effort write. */
function cacheInBackground(event, request, response) {
  const write = cachePut(request, response);
  try {
    event.waitUntil(write);
  } catch {
    /* already started; keep its rejection from surfacing as unhandled */
    void write.catch(() => {});
  }
}

self.addEventListener('install', (e) => {
  /* Cache the shell and the build-time precache manifest. The old version
     stored only '/', so a first offline launch had HTML but no JS, CSS or
     fonts; now every hashed chunk and the local fonts are fetched once,
     individually, so one missing optional asset cannot reject the batch. */
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    let assets = [...PRECACHE];
    let manifestOk = false;
    try {
      const res = await fetch('/precache-manifest.json', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.assets)) {
          assets = [...new Set([...assets, ...data.assets])];
          manifestOk = true;
        }
      }
    } catch { /* dev server or an old build without the manifest */ }
    /* In production a missing manifest means the shell would install with
       no hashed JS/CSS, and activate would then delete the previous good
       cache. Failing install keeps the old worker in control. Localhost
       keeps the shell-only fallback for development. */
    const local = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';
    if (!manifestOk && !local) throw new Error('precache manifest unavailable');
    precached = new Set(assets);
    /* reload bypasses the HTTP cache so a new SW never seeds itself from a
       stale copy of a shell that the server has already replaced. */
    const results = await Promise.allSettled(assets.map((url) =>
      c.add(new Request(new URL(url, self.location.origin), { cache: 'reload' }))));
    const failed = assets.filter((_, i) => results[i].status === 'rejected');
    if (failed.some(isEssential)) {
      /* Do not activate with a partial shell and then delete the previous
         cache on activate: offline would go from working to empty. Failing
         the install leaves the old worker in control. */
      throw new Error(`precache failed: ${failed.join(', ')}`);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    /* An interrupted install must never let activate delete the only usable
       cache. The install handler normally guarantees this cache exists. */
    if (!(await caches.has(CACHE))) return;
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  /* PWA share_target: park the shared audio in the cache, then redirect into
     the app. The page takes it out of the cache in src/file-loader.js. */
  if (request.method === 'POST' && url.pathname === '/share-target') {
    e.respondWith((async () => {
      const toApp = () => Response.redirect(new URL('/?shared=1', self.location.origin).toString(), 303);
      /* Reject an oversized upload before formData() buffers it in memory.
         SHARE_MAX_BYTES bounds what is cached; this bounds what is parsed. */
      const declared = Number(request.headers?.get?.('content-length'));
      if (Number.isFinite(declared) && declared > SHARE_MAX_BYTES + 1024 * 1024) {
        return toApp();
      }
      try {
        const form = await request.formData();
        const file = form.get('audio');
        if (isSharedAudio(file)) {
          const shared = new Request(new URL('/__shared_audio__', self.location.origin));
          const name = encodeURIComponent(String(file.name || 'shared-audio'));
          await cachePut(shared, new Response(file, {
            headers: {
              'Content-Type': file.type || 'audio/mpeg',
              'X-Content-Type-Options': 'nosniff',
              'X-File-Name': name,
              'Content-Disposition': `attachment; filename*=UTF-8''${name}`,
            },
          }));
        }
      } catch { /* bad payload: still return the app */ }
      return toApp();
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
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  if (request.headers.has('range')) return;

  // navigations: network-first so users always get fresh HTML
  if (request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(request);
        if (res.status >= 500) {
          /* A deploy in a bad state should not replace a usable offline shell
             with an error page. */
          return (await caches.match('/')) || res;
        }
        /* Cache only a queryless 200. OAuth callbacks carry a one-use
           code/state and the manifest shortcuts (?open=..., ?shared=1) are
           one-off entries; caching each variant grows the cache without
           bound and can retain credentials. */
        if (res.status === 200 && !url.search) {
          cacheInBackground(e, request, res.clone());
        }
        return res;
      } catch {
        return (await caches.match(request)) || (await caches.match('/')) || offline();
      }
    })());
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
            if (res.status === 200) cacheInBackground(e, request, res.clone());
            return res;
          })
      )
    );
    return;
  }

  e.respondWith((async () => {
    try {
      const res = await fetch(request);
      /* 206/redirected/error responses are not a complete body for this URL;
         the status check keeps them out of the cache. */
      if (res.status === 200) cacheInBackground(e, request, res.clone());
      return res;
    } catch {
      return (await caches.match(request)) || offline();
    }
  })());
});
