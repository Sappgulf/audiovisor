/**
 * Service worker caching contract.
 *
 * The interesting failures here are silent: a pattern that matches nothing
 * just means everything quietly takes the slow path, and a stale cache name
 * just means returning visitors keep an old build. Neither shows up as an
 * error, so both are asserted against a real build.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

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
  it('matches every hashed asset a real build emits', () => {
    const built = readdirSync('dist/assets');
    expect(built.length, 'run `npm run build` first').toBeGreaterThan(0);
    for (const f of built) {
      expect(immutable.test(`/assets/${f}`), `did not match /assets/${f}`).toBe(true);
    }
  });

  it('matches both the entry chunk and the lazy chunks', () => {
    const built = readdirSync('dist/assets').filter((f) => f.endsWith('.js'));
    expect(built.length).toBeGreaterThan(1);   // code splitting is in effect
    for (const f of built) expect(immutable.test(`/assets/${f}`)).toBe(true);
  });

  it('does not match anything that must stay network-first', () => {
    for (const p of [
      '/', '/index.html', '/sw.js', '/manifest.json',
      '/icons/icon-192.png', '/og.png',
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

describe('request handling', () => {
  it('leaves non-GET and cross-origin requests alone', () => {
    expect(sw).toMatch(/request\.method !== 'GET'/);
    expect(sw).toMatch(/url\.origin !== location\.origin/);
  });

  it('serves navigations network-first so HTML is never stale', () => {
    const nav = sw.slice(sw.indexOf("request.mode === 'navigate'"));
    expect(nav.slice(0, 200)).toMatch(/fetch\(request\)/);
  });
});
