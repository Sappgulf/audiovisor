/**
 * The offline shell. These run the real worker source against a fake cache
 * and network, so the contract is checked by what it does rather than by how
 * it is spelled: an install on a first visit has to leave the page, the build
 * files it names and the static shell in the cache, and an offline return has
 * to be served from there.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const ORIGIN = 'https://app.test';
const PAGE = `<!doctype html><html><head>
  <link rel="stylesheet" href="/assets/index-Dln1DoSX.css">
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
</head><body><script type="module" src="/assets/index-DkTwABmM.js"></script></body></html>`;

let src, shell;
beforeAll(() => {
  src = readFileSync('public/sw.js', 'utf8');
  const m = src.match(/const SHELL = \[([\s\S]*?)\];/);
  expect(m, 'SHELL list missing from sw.js').toBeTruthy();
  shell = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
});

describe('shell entries sw.js must cache', () => {
  it('lists the page itself and the manifest', () => {
    expect(shell).toContain('/');
    expect(shell).toContain('/manifest.json');
  });

  it('lists the icons the page and the installer ask for', () => {
    expect(shell).toContain('/icons/apple-touch-icon.png');
    expect(shell).toContain('/icons/icon-192.png');
    expect(shell).toContain('/icons/icon-512.png');
  });

  it('only lists files that are actually published', () => {
    for (const p of shell) {
      if (p === '/') continue;
      expect(existsSync(`public${p}`), `${p} is not in public/`).toBe(true);
    }
  });
});

/** A worker wired to a fake cache and a fake network that can drop offline. */
function bootWorker({ failPaths = [] } = {}) {
  const listeners = {};
  const store = new Map();
  const state = { online: true };
  const abs = (u) => new URL(u, ORIGIN).href;
  const resp = (body, ok = true) => ({
    ok, status: ok ? 200 : 500, headers: { get: () => null },
    clone() { return resp(body, ok); },
    text: async () => body,
  });
  const network = async (input) => {
    if (!state.online) throw new TypeError('offline');
    const u = new URL(typeof input === 'string' ? input : input.url, ORIGIN);
    if (failPaths.includes(u.pathname)) return resp('', false);
    if (u.pathname === '/') return resp(PAGE);
    return resp(`body of ${u.pathname}`);
  };
  const cache = {
    async put(req, r) { store.set(abs(typeof req === 'string' ? req : req.url), r); },
    async match(req) { return store.get(abs(typeof req === 'string' ? req : req.url)); },
    async add(u) {
      const r = await network(u);
      if (!r.ok) throw new Error(`add failed ${u}`);
      store.set(abs(u), r);
    },
  };
  const caches = {
    open: async () => cache,
    keys: async () => [...new Set(['audiovisor-v8.17.0'])],
    delete: async () => true,
    async match(req) { return cache.match(req); },
  };
  const self = {
    addEventListener(type, fn) { listeners[type] = fn; },
    skipWaiting() {},
    clients: { claim: async () => {} },
  };
  const location = { origin: ORIGIN };
  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'location', 'Response', 'URL', src)(
    self, caches, network, location, globalThis.Response, URL,
  );

  /** Fire an event and wait for whatever the worker handed it. */
  const fire = async (type, init) => {
    const ev = { ...init, waitUntil(p) { this.waited = p; }, respondWith(p) { this.responded = p; } };
    listeners[type](ev);
    if (ev.waited) await ev.waited;
    return ev.responded;
  };
  return { fire, store, state };
}

describe('install on a first visit', () => {
  it('caches the page, the build files it names and the shell', async () => {
    const w = bootWorker();
    await w.fire('install');
    expect(w.store.has('https://app.test/')).toBe(true);
    expect(w.store.has('https://app.test/assets/index-DkTwABmM.js')).toBe(true);
    expect(w.store.has('https://app.test/assets/index-Dln1DoSX.css')).toBe(true);
    for (const p of shell) {
      expect(w.store.has(`https://app.test${p}`), `${p} not cached`).toBe(true);
    }
  });

  it('keeps caching the rest when one shell file cannot be fetched', async () => {
    const w = bootWorker({ failPaths: ['/icons/icon-192.png'] });
    await w.fire('install');
    expect(w.store.has('https://app.test/icons/icon-192.png')).toBe(false);
    expect(w.store.has('https://app.test/manifest.json')).toBe(true);
    expect(w.store.has('https://app.test/assets/index-DkTwABmM.js')).toBe(true);
  });
});

describe('an offline return', () => {
  let w;
  beforeEach(async () => {
    w = bootWorker();
    await w.fire('install');
    w.state.online = false;
  });

  it('gets the shell page for a plain visit', async () => {
    const res = await w.fire('fetch', {
      request: { method: 'GET', url: `${ORIGIN}/`, mode: 'navigate' },
    });
    expect(await res.text()).toBe(PAGE);
  });

  it('gets the shell page for a shortcut URL it never cached itself', async () => {
    for (const u of ['/?demo=1', '/?stage=1']) {
      const res = await w.fire('fetch', {
        request: { method: 'GET', url: `${ORIGIN}${u}`, mode: 'navigate' },
      });
      expect(await res.text(), u).toBe(PAGE);
    }
  });

  it('gets the cached build files the page names', async () => {
    const res = await w.fire('fetch', {
      request: { method: 'GET', url: `${ORIGIN}/assets/index-DkTwABmM.js`, mode: 'no-cors' },
    });
    expect(await res.text()).toBe('body of /assets/index-DkTwABmM.js');
  });
});
