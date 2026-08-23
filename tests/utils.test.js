import { describe, it, expect } from 'vitest';
import { clamp, lerp, fmtTime, fmtStamp, logFreqIndex, logSample, median, hexRgba, pickRandom } from '../src/utils.js';

describe('clamp', () => {
  it('clamps into range', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-2, 0, 3)).toBe(0);
    expect(clamp(1, 0, 3)).toBe(1);
  });
});

describe('lerp', () => {
  it('interpolates', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(4, 8, 0)).toBe(4);
    expect(lerp(4, 8, 1)).toBe(8);
  });
});

describe('fmtTime', () => {
  it('formats mm:ss', () => {
    expect(fmtTime(0)).toBe('0:00');
    expect(fmtTime(65)).toBe('1:05');
    expect(fmtTime(754)).toBe('12:34');
  });
  it('handles invalid input', () => {
    expect(fmtTime(NaN)).toBe('0:00');
    expect(fmtTime(-5)).toBe('0:00');
  });
});

describe('logFreqIndex', () => {
  it('starts at 0 and ends at bins-1', () => {
    expect(logFreqIndex(0, 64, 1024)).toBe(0);
    expect(logFreqIndex(64, 64, 1024)).toBe(1023);
  });
  it('is monotonic and within bounds', () => {
    let prev = -1;
    for (let i = 0; i <= 64; i++) {
      const v = logFreqIndex(i, 64, 1024);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThan(1024);
      prev = v;
    }
  });
  it('concentrates low bins (log scale)', () => {
    expect(logFreqIndex(16, 64, 1024)).toBeLessThan(256);
  });
});

describe('logSample', () => {
  it('samples within 0..1 and matches endpoints', () => {
    const freq = new Uint8Array(1024);
    freq[0] = 255;
    freq[1023] = 255;
    expect(logSample(freq, 0)).toBeCloseTo(1, 5);
    expect(logSample(freq, 1)).toBeCloseTo(1, 5);
    const mid = logSample(new Uint8Array(1024).fill(128), 0.5);
    expect(mid).toBeCloseTo(128 / 255, 5);
  });
  it('is monotonic for ramp spectrum and interpolates smoothly', () => {
    const freq = new Uint8Array(256);
    for (let i = 0; i < 256; i++) freq[i] = i;
    let prev = -1;
    for (let t = 0; t <= 1; t += 0.05) {
      const v = logSample(freq, t);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
    // interpolation check: fractional t between bins should blend
    const a = new Uint8Array([0, 255, 0, 0]);
    // need longer array to see interpolation; craft 4 bins
    const f = logSample(a, 0.5);
    // not zero because interpolates between 255 and neighbors
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(1);
  });
  it('handles t01 outside 0..1 via clamp', () => {
    const freq = new Uint8Array([100, 200, 50]);
    expect(logSample(freq, -0.5)).toBeCloseTo(freq[0] / 255, 5);
    expect(logSample(freq, 1.5)).toBeCloseTo(freq[2] / 255, 5);
  });
});

describe('median', () => {
  it('returns middle value', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([5, 1, 9, 3])).toBe(5);
  });
  it('returns 0 for empty', () => {
    expect(median([])).toBe(0);
  });
});

describe('hexRgba', () => {
  it('converts hex to rgba', () => {
    expect(hexRgba('#ccff00', 0.5)).toBe('rgba(204, 255, 0, 0.5)');
    expect(hexRgba('#ffffff', 1)).toBe('rgba(255, 255, 255, 1)');
  });
});

describe('pickRandom', () => {
  it('always returns a member', () => {
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i++) {
      expect(arr).toContain(pickRandom(arr));
    }
  });
});

describe('fmtStamp', () => {
  it('formats YYYYMMDD-HHMMSS', () => {
    expect(fmtStamp(new Date(2026, 7, 22, 14, 3, 5))).toBe('20260822-140305');
  });
  it('pads single digits and defaults to now', () => {
    const s = fmtStamp();
    expect(s).toMatch(/^\d{8}-\d{6}$/);
  });
});
