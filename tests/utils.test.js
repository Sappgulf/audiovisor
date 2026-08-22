import { describe, it, expect } from 'vitest';
import { clamp, lerp, fmtTime, fmtStamp, logFreqIndex, median, hexRgba, pickRandom } from '../src/utils.js';

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
