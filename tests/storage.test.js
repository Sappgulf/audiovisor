import { describe, it, expect, beforeEach } from 'vitest';
import { readJSON, writeJSON, readText, writeText, remove } from '../src/storage.js';

/** A store whose writes reject, as in Safari private browsing or at quota. */
const hostile = (init = {}) => ({
  getItem: (k) => (k in init ? init[k] : null),
  setItem: () => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; },
  removeItem: () => { throw new Error('QuotaExceededError'); },
});

const working = (init = {}) => {
  const map = { ...init };
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: (k) => { delete map[k]; },
    _map: map,
  };
};

describe('writes never throw', () => {
  beforeEach(() => { delete globalThis.localStorage; });

  it('reports failure instead of throwing when storage rejects', () => {
    globalThis.localStorage = hostile();
    expect(() => writeJSON('k', { a: 1 })).not.toThrow();
    expect(writeJSON('k', { a: 1 })).toBe(false);
    expect(writeText('k', 'v')).toBe(false);
    expect(remove('k')).toBe(false);
  });

  it('reports success when storage works', () => {
    const s = working();
    globalThis.localStorage = s;
    expect(writeJSON('k', { a: 1 })).toBe(true);
    expect(s._map.k).toBe('{"a":1}');
    expect(writeText('t', 'hi')).toBe(true);
    expect(remove('k')).toBe(true);
    expect(s._map.k).toBeUndefined();
  });

  it('survives localStorage being absent entirely', () => {
    expect(writeJSON('k', 1)).toBe(false);
    expect(readJSON('k', 'fb')).toBe('fb');
    expect(readText('k', 'fb')).toBe('fb');
    expect(remove('k')).toBe(false);
  });
});

describe('reads fall back rather than throw', () => {
  beforeEach(() => { delete globalThis.localStorage; });

  it('returns the fallback for a missing key', () => {
    globalThis.localStorage = working();
    expect(readJSON('nope', [])).toEqual([]);
    expect(readText('nope', 'x')).toBe('x');
  });

  it('returns the fallback for corrupt JSON', () => {
    globalThis.localStorage = working({ k: '{not json' });
    expect(readJSON('k', 'fb')).toBe('fb');
  });

  it('returns the fallback when the stored value is literally null', () => {
    globalThis.localStorage = working({ k: 'null' });
    expect(readJSON('k', 'fb')).toBe('fb');
  });

  it('returns the fallback when getItem itself throws', () => {
    globalThis.localStorage = { getItem() { throw new Error('SecurityError'); } };
    expect(readJSON('k', 'fb')).toBe('fb');
    expect(readText('k', 'fb')).toBe('fb');
  });

  it('round-trips real values', () => {
    globalThis.localStorage = working();
    writeJSON('k', { a: [1, 2], b: 'x' });
    expect(readJSON('k')).toEqual({ a: [1, 2], b: 'x' });
    expect(readJSON('missing')).toBeNull();
  });

  it('preserves falsy values that are not null', () => {
    globalThis.localStorage = working();
    writeJSON('zero', 0);
    writeJSON('false', false);
    writeJSON('empty', '');
    expect(readJSON('zero', 'fb')).toBe(0);
    expect(readJSON('false', 'fb')).toBe(false);
    expect(readJSON('empty', 'fb')).toBe('');
  });
});
