import { describe, it, expect } from 'vitest';
import {
  shouldEvaluate, nextTier, next2dQuality, estimateBaseline, baselineOr,
  TIERS, WINDOW, FAST_WINDOW, DEFAULT_BASELINE_MS, SEVERE,
} from '../src/adaptive.js';

const B = DEFAULT_BASELINE_MS;   // ~16.7ms, one frame at 60Hz

const fill = (n, ms) => Array.from({ length: n }, () => ms);

describe('shouldEvaluate', () => {
  it('waits for the full window at ordinary frame times', () => {
    expect(shouldEvaluate(fill(WINDOW - 1, 18))).toBe(false);
    expect(shouldEvaluate(fill(WINDOW, 18))).toBe(true);
  });

  it('acts early when every sample is severely over budget', () => {
    /* At ~98ms a frame the full window is nearly three seconds of stutter
       before the tier steps down. A short window is enough when the signal
       is this unambiguous. */
    expect(shouldEvaluate(fill(FAST_WINDOW, 98), B)).toBe(true);
    expect(shouldEvaluate(fill(FAST_WINDOW - 1, 98), B)).toBe(false);
  });

  it('ignores a single slow frame among healthy ones', () => {
    // one GC pause, or the cold first frame after a mode change
    const samples = [16, 16, 300, 16, 16, 16];
    expect(shouldEvaluate(samples, B)).toBe(false);
  });

  it('ignores a run that is slow but not severe', () => {
    expect(shouldEvaluate(fill(FAST_WINDOW, B * SEVERE - 1))).toBe(false);
  });

  it('still evaluates a long window of merely-slow frames', () => {
    expect(shouldEvaluate(fill(WINDOW, 30))).toBe(true);
  });

  it('handles an empty window', () => {
    expect(shouldEvaluate([])).toBe(false);
  });

  it('ignores the huge gap after a backgrounded tab', () => {
    // one 4-second gap among healthy frames must not downgrade anything
    expect(shouldEvaluate([16, 16, 4000, 16, 16, 16])).toBe(false);
  });
});

describe('estimateBaseline', () => {
  /* Judging against a hardcoded 60Hz would mark every frame on a 30Hz panel
     as over budget and downgrade it permanently for no reason. */
  it('learns 60Hz from healthy frames', () => {
    expect(estimateBaseline(fill(20, 16.7))).toBeCloseTo(16.7, 1);
  });

  it('is unknown until it has seen a usable sample', () => {
    expect(estimateBaseline([])).toBeNull();
    expect(baselineOr(estimateBaseline([]))).toBe(DEFAULT_BASELINE_MS);
  });

  it('learns a 30Hz display rather than calling it slow', () => {
    const b = estimateBaseline(fill(20, 33.3));
    expect(b).toBeCloseTo(33.3, 1);
    // and at that baseline, 33ms frames are healthy
    expect(nextTier('high', 33.3, 'high', b).tier).toBe('high');
  });

  it('takes the fastest interval seen, not the average', () => {
    expect(estimateBaseline([50, 60, 16.7, 55], 40)).toBeCloseTo(16.7, 1);
  });

  it('ignores implausible samples in both directions', () => {
    expect(estimateBaseline([0, 0.2, 1])).toBeNull();
    expect(estimateBaseline(fill(5, 5000))).toBeNull();
    expect(estimateBaseline([NaN, Infinity])).toBeNull();
  });

  it('keeps the estimate once learned', () => {
    const first = estimateBaseline(fill(5, 16.7));
    expect(estimateBaseline(fill(5, 90), first)).toBeCloseTo(16.7, 1);
  });

  it('never rises above the clamp, so a slow session cannot excuse itself', () => {
    expect(estimateBaseline(fill(10, 100), 100)).toBeLessThanOrEqual(40);
  });
});

describe('nextTier', () => {
  it('drops two tiers when badly over budget', () => {
    expect(nextTier('ultra', 98, 'ultra', B).tier).toBe('medium');
    expect(nextTier('high', 98, 'high', B).tier).toBe('low');
  });

  it('drops one tier when moderately over budget', () => {
    expect(nextTier('high', 30, 'high', B).tier).toBe('medium');
    expect(nextTier('medium', 30, 'high', B).tier).toBe('low');
  });

  it('never drops below the lowest tier', () => {
    expect(nextTier('low', 500, 'high', B).tier).toBe('low');
  });

  it('needs a run of healthy windows before climbing, not one', () => {
    /* vsync pins a comfortable frame to the refresh interval, so headroom
       cannot be measured directly — it is inferred from a clean streak. */
    let r = nextTier('low', 16.7, 'high', B, 0);
    expect(r.tier).toBe('low');
    expect(r.streak).toBe(1);
    r = nextTier('low', 16.7, 'high', B, r.streak);
    expect(r.tier).toBe('low');
    r = nextTier('low', 16.7, 'high', B, r.streak);
    expect(r.tier).toBe('medium');
    expect(r.streak).toBe(0);      // the next climb has to be earned again
  });

  it('resets the streak the moment a window is not healthy', () => {
    const r = nextTier('low', 40, 'high', B, 2);
    expect(r.streak).toBe(0);
  });

  it('does not climb past the ceiling however long the streak', () => {
    const r = nextTier('high', 16.7, 'high', B, 99);
    expect(r.tier).toBe('high');
  });

  it('never climbs past what the user asked for', () => {
    expect(nextTier('high', 5, 'high', B, 99).tier).toBe('high');
    expect(nextTier('medium', 5, 'medium', B, 99).tier).toBe('medium');
  });

  it('holds steady in the comfortable band', () => {
    for (const ms of [10, 16, 20, 25]) {
      expect(nextTier('high', ms, 'ultra', B, 0).tier, `${ms}ms`).toBe('high');
    }
  });

  it('returns the current tier for nonsense input', () => {
    expect(nextTier('high', NaN, 'high', B).tier).toBe('high');
    expect(nextTier('bogus', 100, 'high', B).tier).toBe('bogus');
  });

  it('settles rather than oscillating around a steady frame time', () => {
    // a machine holding ~20ms should reach a tier and stay there
    let tier = 'ultra';
    const seen = [];
    for (let i = 0; i < 8; i++) { tier = nextTier(tier, 20, 'ultra', B).tier; seen.push(tier); }
    expect(new Set(seen.slice(2)).size).toBe(1);
  });

  it('exposes tiers in ascending cost order', () => {
    expect(TIERS).toEqual(['low', 'medium', 'high', 'ultra']);
  });
});

describe('next2dQuality', () => {
  it('drops to low when frames run long', () => {
    expect(next2dQuality('high', 25, B)).toBe('low');
  });

  it('returns to high with headroom', () => {
    expect(next2dQuality('low', 8, B)).toBe('high');
  });

  it('holds in the middle band rather than flapping', () => {
    expect(next2dQuality('high', 17, B)).toBe('high');
    expect(next2dQuality('low', 17, B)).toBe('low');
  });

  it('returns the current quality for nonsense input', () => {
    expect(next2dQuality('high', NaN, B)).toBe('high');
  });
});
