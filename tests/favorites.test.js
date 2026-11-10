/**
 * Favorites. The list is small but it lives in localStorage, which can be
 * absent or hostile; every read is untrusted and every write must be a
 * no-op instead of an exception.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  FAVORITES_KEY, MAX_FAVORITES,
  getFavorites, isFavorite, toggleFavorite, setFavorites, clearFavorites,
  getCuratedAutopilot,
} from '../src/favorites.js';

/** In-memory localStorage; `failing` reproduces Safari private browsing. */
function installStorage({ init = {}, failing = false, readFails = false } = {}) {
  const map = new Map(Object.entries(init));
  globalThis.localStorage = {
    getItem: (k) => {
      if (readFails) throw new Error('SecurityError');
      return map.has(k) ? map.get(k) : null;
    },
    setItem: (k, v) => {
      if (failing) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      map.set(k, String(v));
    },
    removeItem: (k) => {
      if (failing) throw new Error('QuotaExceededError');
      map.delete(k);
    },
  };
  return map;
}

const stored = (value) => ({ [FAVORITES_KEY]: JSON.stringify(value) });

beforeEach(() => { installStorage(); });

describe('toggleFavorite', () => {
  it('starts empty', () => {
    expect(getFavorites()).toEqual([]);
    expect(isFavorite('bars')).toBe(false);
  });

  it('adds on the first toggle and removes on the second', () => {
    expect(toggleFavorite('bars')).toEqual(['bars']);
    expect(isFavorite('bars')).toBe(true);
    expect(toggleFavorite('bars')).toEqual([]);
    expect(isFavorite('bars')).toBe(false);
  });

  it('keeps insertion order across several modes', () => {
    toggleFavorite('bars');
    toggleFavorite('gpu');
    toggleFavorite('waves');
    expect(getFavorites()).toEqual(['bars', 'gpu', 'waves']);
  });

  it('persists under the versioned key', () => {
    toggleFavorite('  tunnel  ');
    expect(JSON.parse(globalThis.localStorage.getItem(FAVORITES_KEY))).toEqual(['tunnel']);
  });

  it('ignores ids that are not usable strings', () => {
    expect(toggleFavorite(null)).toEqual([]);
    expect(toggleFavorite(42)).toEqual([]);
    expect(toggleFavorite('   ')).toEqual([]);
    expect(getFavorites()).toEqual([]);
  });
});

describe('setFavorites', () => {
  it('replaces the existing list', () => {
    setFavorites(['bars', 'waves']);
    setFavorites(['gpu']);
    expect(getFavorites()).toEqual(['gpu']);
  });

  it('trims, drops non-strings and dedupes', () => {
    setFavorites([' bars ', 7, null, 'bars', 'waves', '', { id: 'gpu' }]);
    expect(getFavorites()).toEqual(['bars', 'waves']);
  });

  it('caps the list', () => {
    const many = Array.from({ length: MAX_FAVORITES + 8 }, (_, i) => `mode-${i}`);
    setFavorites(many);
    expect(getFavorites()).toHaveLength(MAX_FAVORITES);
    expect(getFavorites()[0]).toBe('mode-0');
    expect(isFavorite(`mode-${MAX_FAVORITES}`)).toBe(false);
  });

  it('clears the list when handed a non-array', () => {
    toggleFavorite('bars');
    setFavorites('nope');
    expect(getFavorites()).toEqual([]);
  });
});

describe('clearFavorites', () => {
  it('removes the stored key and the list', () => {
    toggleFavorite('bars');
    expect(globalThis.localStorage.getItem(FAVORITES_KEY)).not.toBeNull();
    expect(clearFavorites()).toEqual([]);
    expect(globalThis.localStorage.getItem(FAVORITES_KEY)).toBeNull();
    expect(getFavorites()).toEqual([]);
  });
});

describe('untrusted storage', () => {
  it('returns an empty list for corrupt JSON', () => {
    installStorage({ init: { [FAVORITES_KEY]: '{not json' } });
    expect(getFavorites()).toEqual([]);
  });

  it('returns an empty list for non-array JSON', () => {
    for (const raw of ['{"mode":"bars"}', '"bars"', '42', 'true', 'null']) {
      installStorage({ init: { [FAVORITES_KEY]: raw } });
      expect(getFavorites()).toEqual([]);
    }
  });

  it('sanitizes mixed arrays instead of surfacing junk', () => {
    installStorage({ init: stored(['bars', 42, null, 'bars', '  waves  ', '', { id: 'gpu' }, ['scope']]) });
    expect(getFavorites()).toEqual(['bars', 'waves']);
  });

  it('caps a huge stored list on read', () => {
    const many = Array.from({ length: 500 }, (_, i) => `mode-${i}`);
    installStorage({ init: stored(many) });
    expect(getFavorites()).toHaveLength(MAX_FAVORITES);
  });
});

describe('hostile storage', () => {
  it('does not throw when writes reject', () => {
    installStorage({ failing: true });
    expect(() => toggleFavorite('bars')).not.toThrow();
    expect(() => setFavorites(['bars', 'waves'])).not.toThrow();
    expect(() => clearFavorites()).not.toThrow();
    expect(getFavorites()).toEqual([]);
  });

  it('does not throw when reads reject', () => {
    installStorage({ readFails: true });
    expect(getFavorites()).toEqual([]);
    expect(isFavorite('bars')).toBe(false);
    expect(getCuratedAutopilot(['bars', 'waves'])).toEqual(['bars', 'waves']);
  });

  it('survives localStorage being absent entirely', () => {
    delete globalThis.localStorage;
    expect(getFavorites()).toEqual([]);
    expect(() => toggleFavorite('bars')).not.toThrow();
    expect(() => setFavorites(['bars'])).not.toThrow();
    expect(() => clearFavorites()).not.toThrow();
  });
});

describe('getCuratedAutopilot', () => {
  it('falls back to the supplied list when nothing is favorited', () => {
    expect(getCuratedAutopilot(['bars', 'waves', 'gpu'])).toEqual(['bars', 'waves', 'gpu']);
  });

  it('accepts MODES entries as well as ids', () => {
    const modes = [{ id: 'bars' }, { id: 'gpu' }, { id: 'waves' }, { id: 'bars' }];
    expect(getCuratedAutopilot(modes)).toEqual(['bars', 'gpu', 'waves']);
  });

  it('returns favorites in favorite order, restricted to the current list', () => {
    setFavorites(['vinyl', 'bars', 'missing']);
    expect(getCuratedAutopilot(['bars', 'waves', 'vinyl'])).toEqual(['vinyl', 'bars']);
  });

  it('ignores stale favorites and falls back when none match', () => {
    setFavorites(['holodeck', 'gone']);
    expect(getCuratedAutopilot(['bars', 'waves'])).toEqual(['bars', 'waves']);
  });

  it('returns an empty list for a non-list', () => {
    expect(getCuratedAutopilot(null)).toEqual([]);
    expect(getCuratedAutopilot('bars')).toEqual([]);
  });
});
