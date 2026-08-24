import { describe, it, expect, beforeEach } from 'vitest';
import * as Social from '../src/social.js';

const KEY = 'audiovisor.social.feed';

const working = (init = {}) => {
  const map = { ...init };
  globalThis.localStorage = {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    removeItem: (k) => { delete map[k]; },
  };
  return map;
};

/** Reads work, writes reject — Safari private browsing, or quota reached. */
const hostile = (init = {}) => {
  globalThis.localStorage = {
    getItem: (k) => (k in init ? init[k] : null),
    setItem: () => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; },
    removeItem: () => { throw new Error('QuotaExceededError'); },
  };
};

describe('seeded entries', () => {
  beforeEach(() => working());

  it('carry an id, so their like button actually works', () => {
    /* The seeds were written without an id while every posted entry had
       one. The feed renders its like button as data-like="${e.id}", so all
       three seeded rows rendered data-like="undefined" and clicking them
       did nothing. */
    Social.seedFeed();
    const feed = Social.getFeed();
    expect(feed).toHaveLength(3);
    for (const e of feed) {
      expect(typeof e.id, JSON.stringify(e)).toBe('string');
      expect(e.id.length).toBeGreaterThan(0);
    }
    expect(new Set(feed.map((e) => e.id)).size).toBe(3);
  });

  it('can be liked, and the like persists', () => {
    Social.seedFeed();
    const target = Social.getFeed()[0];
    expect(Social.likeFeed(target.id)).toBe(true);
    const after = Social.getFeed().find((e) => e.id === target.id);
    expect(after.likes).toBe(target.likes + 1);
  });

  it('carry a timestamp like posted entries do', () => {
    Social.seedFeed();
    for (const e of Social.getFeed()) expect(Number.isFinite(e.at)).toBe(true);
  });

  it('does not re-seed over an existing feed', () => {
    Social.seedFeed();
    const first = Social.getFeed().map((e) => e.id);
    Social.seedFeed();
    expect(Social.getFeed().map((e) => e.id)).toEqual(first);
  });
});

describe('feed operations', () => {
  beforeEach(() => working());

  it('posts newest first and caps the feed at 50', () => {
    for (let i = 0; i < 60; i++) Social.postToFeed({ title: `t${i}`, mode: 'bars', theme: 'brass', fx: {} });
    const feed = Social.getFeed();
    expect(feed).toHaveLength(50);
    expect(feed[0].title).toBe('t59');
  });

  it('names an untitled post rather than leaving it blank', () => {
    expect(Social.postToFeed({}).title).toBe('Untitled Mix');
  });

  it('reports a like against an unknown id instead of rewriting the feed', () => {
    Social.seedFeed();
    expect(Social.likeFeed('no-such-id')).toBe(false);
    expect(Social.likeFeed(undefined)).toBe(false);
  });

  it('toggles a follow both ways', () => {
    expect(Social.toggleFollow('bob')).toBe(true);
    expect(Social.getFollows()).toEqual(['bob']);
    expect(Social.toggleFollow('bob')).toBe(false);
    expect(Social.getFollows()).toEqual([]);
  });

  it('tolerates corrupt stored data', () => {
    working({ [KEY]: '{not json' });
    expect(Social.getFeed()).toEqual([]);
    working({ [KEY]: '{"not":"an array"}' });
    expect(Social.getFeed()).toEqual([]);
  });
});

describe('when storage rejects writes', () => {
  /* seedFeed() runs at module scope during app boot. A throw there
     propagated out of the top level of main.js and stopped everything
     below it from wiring up — the settings tabs, the raytrace toggle and
     the help panel all went with it. */
  it('every operation degrades instead of throwing', () => {
    hostile();
    expect(() => Social.seedFeed()).not.toThrow();
    expect(() => Social.postToFeed({ title: 'x' })).not.toThrow();
    expect(() => Social.likeFeed('a')).not.toThrow();
    expect(() => Social.toggleFollow('bob')).not.toThrow();
    expect(() => Social.getFeed()).not.toThrow();
    expect(() => Social.getFollows()).not.toThrow();
  });

  it('still returns a usable value to the caller', () => {
    hostile();
    expect(Social.postToFeed({ title: 'x' }).title).toBe('x');
    expect(Social.getFeed()).toEqual([]);
    expect(Social.toggleFollow('bob')).toBe(true);
  });
});
