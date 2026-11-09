/**
 * Service worker caching contract.
 *
 * The interesting failures here are silent: a pattern that matches nothing
 * just means everything quietly takes the slow path, and a stale cache name
 * just means returning visitors keep an old build. Neither shows up as an
 * error, so both are asserted against a real build.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

/* The two filename checks below validate a real build. CI builds first; a
   local `npm test` on a clean checkout skips them rather than failing. */
const hasBuild = existsSync('dist/assets');

let sw, immutable, pkg;

beforeAll(() => {
  sw = readFileSync('public/sw.js', 'utf8');
  pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  // pull the live pattern out of the worker rather than duplicating it
  const m = sw.match(/const immutable = (\/.+\/)[a-z]*\.test\(url\.pathname\)/);
  expect(m, 'could not find the immutable test in sw.js').toBeTruthy();
  immutable = new RegExp(m[1].slice(1, m[1].lastIndexOf('/')));
});

describe('immutable asset matching', () => {
  it.skipIf(!hasBuild)('matches every hashed asset a real build emits', () => {
    const built = readdirSync('dist/assets');
    expect(built.length, 'run `npm run build` first').toBeGreaterThan(0);
    for (const f of built) {
      expect(immutable.test(`/assets/${f}`), `did not match /assets/${f}`).toBe(true);
    }
  });

  it.skipIf(!hasBuild)('matches both the entry chunk and the lazy chunks', () => {
    const built = readdirSync('dist/assets').filter((f) => f.endsWith('.js'));
    expect(built.length).toBeGreaterThan(1);   // code splitting is in effect
    for (const f of built) expect(immutable.test(`/assets/${f}`)).toBe(true);
  });

  it('does not match anything that must stay network-first', () => {
    for (const p of [
      '/', '/index.html', '/sw.js', '/manifest.json',
      '/icons/icon-192.png', '/og.jpg',
      '/assets/unhashed.js',          // no hash: could change without a new name
      '/assets/short-abc.js',         // hash too short to be a build hash
    ]) {
      expect(immutable.test(p), `wrongly matched ${p}`).toBe(false);
    }
  });

  it('accepts the base64url alphabet Vite actually uses', () => {
    // Vite hashes are base64url, so they include letters, digits, - and _
    for (const name of ['index-Dqwyvtjq.js', 'a-_A0zZ9__x.css', 'raystage-BE5kLTmu.js']) {
      expect(immutable.test(`/assets/${name}`), name).toBe(true);
    }
  });

  it('is anchored to /assets/, so a lookalike path elsewhere is not cached', () => {
    expect(immutable.test('/user/assets-fake/index-Dqwyvtjq.js')).toBe(false);
  });
});

describe('cache versioning', () => {
  it('tracks the app version', () => {
    const name = sw.match(/const CACHE = '([^']+)'/)[1];
    expect(name).toBe(`audiovisor-v${pkg.version}`);
  });

  it('drops caches that are not the current one on activate', () => {
    expect(sw).toMatch(/keys\.filter\(\(k\) => k !== CACHE\)/);
  });
});

describe('offline precache', () => {
  it('loads the build manifest and caches every asset individually', () => {
    expect(sw).toContain('/precache-manifest.json');
    expect(sw).toMatch(/Promise\.allSettled\(assets\.map/);
  });

  it('does not skip waiting until the core precache has succeeded', () => {
    const install = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('activate'"));
    const settled = install.indexOf('Promise.allSettled');
    const skip = install.indexOf('self.skipWaiting');
    expect(settled).toBeGreaterThan(-1);
    expect(skip).toBeGreaterThan(settled);
    expect(install).toMatch(/failed\.some\(isEssential\)/);
    expect(install).toMatch(/throw new Error\(`precache failed/);
  });

  it('never deletes the previous cache before the current one exists', () => {
    expect(sw).toMatch(/caches\.has\(CACHE\)/);
  });

  it('handles the PWA share target before the GET-only gate', () => {
    const share = sw.indexOf("url.pathname === '/share-target'");
    const getGate = sw.indexOf("request.method !== 'GET'");
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(getGate);
    expect(sw).toContain("caches.match('/__shared_audio__')");
  });

  it('only accepts bounded audio through the share target', () => {
    /* any site can POST to this origin; taking file.type verbatim let a
       crafted share park text/html in the app cache */
    expect(sw).toMatch(/const SHARE_MAX_BYTES = 100 \* 1024 \* 1024/);
    expect(sw).toMatch(/SHARE_AUDIO_TYPES\.has\(type\)/);
    expect(sw).toMatch(/isSharedAudio\(file\)/);
    expect(sw).toMatch(/'X-Content-Type-Options': 'nosniff'/);
  });

  it('treats a missing precache manifest as an install failure in production', () => {
    expect(sw).toMatch(/if \(!manifestOk && !local\) throw new Error\('precache manifest unavailable'\)/);
  });
});

describe('share target behaviour', () => {
  function loadWorker() {
    const listeners = {};
    const puts = [];
    const cache = {
      put: async (request, response) => { puts.push({ url: String(request.url || request), response }); },
      match: async () => undefined,
      keys: async () => [],
      delete: async () => true,
    };
    const caches = {
      open: async () => cache,
      has: async () => true,
      keys: async () => [],
      match: async () => undefined,
      delete: async () => true,
    };
    const self = {
      addEventListener: (name, fn) => { listeners[name] = fn; },
      location: { origin: 'https://app.test', hostname: 'app.test' },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    };
    const fetchMock = async () => ({ ok: true, status: 200, json: async () => ({ assets: [] }) });
    const code = readFileSync('public/sw.js', 'utf8');
    new Function('self', 'caches', 'location', 'fetch', 'Response', 'Request', 'URL', code)(
      self, caches, self.location, fetchMock, Response, Request, URL,
    );
    return { listeners, puts };
  }

  function runShare(listeners, request) {
    let response;
    listeners.fetch({ request, respondWith: (p) => { response = p; }, waitUntil: () => {} });
    return response;
  }

  it('caches a valid audio upload with nosniff', async () => {
    const { listeners, puts } = loadWorker();
    const form = new FormData();
    form.append('audio', new File([new Uint8Array(64)], 'song.mp3', { type: 'audio/mpeg' }));
    const res = await runShare(listeners, new Request('https://app.test/share-target', { method: 'POST', body: form }));
    expect(res.status).toBe(303);
    expect(puts).toHaveLength(1);
    expect(puts[0].response.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(puts[0].response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('refuses HTML and oversized uploads', async () => {
    const { listeners, puts } = loadWorker();
    const html = new FormData();
    html.append('audio', new File(['<script>'], 'x.html', { type: 'text/html' }));
    await runShare(listeners, new Request('https://app.test/share-target', { method: 'POST', body: html }));
    expect(puts).toHaveLength(0);

    const huge = {
      method: 'POST',
      url: 'https://app.test/share-target',
      headers: new Headers(),
      formData: async () => {
        const f = new FormData();
        f.append('audio', { size: 200 * 1024 * 1024, type: 'audio/mpeg', name: 'x.mp3' });
        return f;
      },
    };
    await runShare(listeners, huge);
    expect(puts).toHaveLength(0);
  });

  it('rejects a declared oversized body before parsing it', async () => {
    const { listeners, puts } = loadWorker();
    let parsed = false;
    const request = {
      method: 'POST',
      url: 'https://app.test/share-target',
      headers: new Headers({ 'content-length': String(200 * 1024 * 1024) }),
      formData: async () => { parsed = true; return new FormData(); },
    };
    const res = await runShare(listeners, request);
    expect(res.status).toBe(303);
    expect(parsed).toBe(false);
    expect(puts).toHaveLength(0);
  });
});

describe('request handling', () => {
  it('leaves non-GET and cross-origin requests alone', () => {
    expect(sw).toMatch(/request\.method !== 'GET'/);
    expect(sw).toMatch(/url\.origin !== location\.origin/);
  });

  it('serves navigations network-first so HTML is never stale', () => {
    const nav = sw.slice(sw.indexOf("request.mode === 'navigate'"));
    expect(nav.slice(0, 200)).toMatch(/fetch\(request\)/);
  });

  it('falls back to the cached shell, then a real offline response', () => {
    expect(sw).toMatch(/caches\.match\('\/'\)\) \|\| offline\(\)/);
    expect(sw).toContain('status: 503');
  });

  it('does not cache one-off navigation query strings', () => {
    expect(sw).toMatch(/res\.status === 200 && !url\.search/);
  });

  it('keeps Range requests and the API out of the cache', () => {
    expect(sw).toMatch(/request\.headers\.has\('range'\)/);
    expect(sw).toMatch(/url\.pathname === '\/api' \|\| url\.pathname\.startsWith\('\/api\/'\)/);
  });

  it('bounds cache growth without evicting the precached shell', () => {
    expect(sw).toMatch(/!precached\.has\(pathname\) && !isProtectedPath\(pathname\)/);
    expect(sw).toMatch(/pathname\.startsWith\('\/assets\/'\)/);
    expect(sw).toMatch(/removable\.slice\(0, excess\)/);
    expect(sw).toMatch(/const write = cachePut\(request, response\)/);
    expect(sw).toMatch(/event\.waitUntil\(write\)/);
  });
});
