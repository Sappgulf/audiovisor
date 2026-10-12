import { describe, it, expect } from 'vitest';
import { nextCap, CAP_RETRY_WINDOWS } from '../src/render-loop.js';
import { nextTier, TIERS, OVER_BUDGET, CLIMB_STREAK } from '../src/adaptive.js';

const BASE = 16.7;


describe('nextCap', () => {
  it('leaves a mode with no cap alone', () => {
    expect(nextCap(null, 'low', 'ultra', true, 0)).toEqual({ cap: null, capStreak: 0 });
  });

  it('counts healthy windows only while the stage sits at the cap', () => {
    const r = nextCap('medium', 'low', 'ultra', true, 5);
    expect(r).toEqual({ cap: 'medium', capStreak: 0 });
  });

  it('keeps the cap until a long healthy run has been held', () => {
    let s = 0;
    for (let i = 1; i < CAP_RETRY_WINDOWS; i++) {
      s = nextCap('medium', 'medium', 'ultra', true, s).capStreak;
      expect(s).toBe(i);
    }
    expect(nextCap('medium', 'medium', 'ultra', true, s).cap).toBe('high');
  });

  it('a window that is not healthy restarts the count', () => {
    const r = nextCap('medium', 'medium', 'ultra', false, CAP_RETRY_WINDOWS - 1);
    expect(r).toEqual({ cap: 'medium', capStreak: 0 });
  });

  it('clears the cap when the next tier is already the ceiling', () => {
    const r = nextCap('medium', 'medium', 'high', true, CAP_RETRY_WINDOWS - 1);
    expect(r).toEqual({ cap: null, capStreak: 0 });
  });

  it('never lifts past the top tier', () => {
    const r = nextCap(TIERS[TIERS.length - 1], TIERS[TIERS.length - 1], 'ultra', true, CAP_RETRY_WINDOWS - 1);
    expect(r.cap).toBeNull();
  });
});

describe('a fall and its recovery across windows', () => {
  it('a single bad window no longer pins the mode below its ceiling for good', () => {
    // at high, one window well over budget steps down to medium and caps there
    let tier = 'high', streak = 0, capStreak = 0;
    const bad = BASE * (OVER_BUDGET + 0.1);
    ({ tier, streak } = nextTier(tier, bad, 'high', BASE, streak));
    let cap = tier;
    expect(tier).toBe('medium');

    // then the stage runs clean: it must eventually return to the ceiling
    let windows = 0;
    while (tier !== 'high' && windows < 500) {
      const allowed = 'high';
      const ceiling = cap && TIERS.indexOf(cap) < TIERS.indexOf(allowed) ? cap : allowed;
      const next = nextTier(tier, BASE, ceiling, BASE, streak);
      const capped = nextCap(cap, tier, allowed, true, capStreak);
      cap = capped.cap;
      capStreak = capped.capStreak;
      tier = next.tier;
      streak = next.streak;
      windows++;
    }
    expect(tier).toBe('high');
    /* the wait is the cap retry plus the normal climb, not a permanent stop */
    expect(windows).toBeLessThanOrEqual(CAP_RETRY_WINDOWS + 2 * CLIMB_STREAK + 2);
  });
});
