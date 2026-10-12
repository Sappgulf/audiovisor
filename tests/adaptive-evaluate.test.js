import { describe, it, expect } from 'vitest';
import { shouldEvaluate, WINDOW, FAST_WINDOW, SEVERE, DEFAULT_BASELINE_MS } from '../src/adaptive.js';

/* the every()-based rule shouldEvaluate used before its loop */
function reference(samples, baseline) {
  if (samples.length >= WINDOW) return true;
  if (samples.length < FAST_WINDOW) return false;
  return samples.every((ms) => ms > baseline * SEVERE);
}

describe('shouldEvaluate', () => {
  it('gives the same answer as the every() rule for every window length, including NaN and the edges', () => {
    const values = [0, 5, 16.7, 49.9, 50.1, 80, NaN, Infinity, 1000];
    for (const baseline of [DEFAULT_BASELINE_MS, 8]) {
      for (let len = 0; len <= WINDOW + 2; len++) {
        for (let k = 0; k < 40; k++) {
          const samples = Array.from({ length: len }, (_, i) => values[(k * 7 + i * 3) % values.length]);
          expect(shouldEvaluate(samples, baseline)).toBe(reference(samples, baseline));
        }
      }
    }
  });
});
