import { describe, it, expect, vi } from 'vitest';
import { clamp, lerp, fmtTime, fmtStamp, logFreqIndex, logSample, median, hexRgba, pickRandom, computePeaks, safe, safeAsync, esc } from '../src/utils.js';

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
  /* The mapping deliberately spans the *useful* spectrum rather than every
     bin: it starts above DC and stops around 16kHz, since the top third of
     the bins carries nothing worth the screen width. */
  it('starts above DC and ends near the top of the audible range', () => {
    expect(logFreqIndex(0, 64, 1024)).toBeGreaterThanOrEqual(1);
    expect(logFreqIndex(0, 64, 1024)).toBeLessThan(4);
    const top = logFreqIndex(64, 64, 1024);
    expect(top).toBeGreaterThan(1024 * 0.6);
    expect(top).toBeLessThan(1024);
  });

  it('gives every octave equal width — the point of a log scale', () => {
    /* Equal steps across the display must multiply the bin by a constant.
       Measured in the upper half, where the integer rounding this function
       applies is a small fraction of the bin index; down at bin 5 rounding
       alone is worth several percent. */
    const at = (t) => logFreqIndex(t * 64, 64, 4096);
    const r1 = at(0.70) / at(0.50);
    const r2 = at(0.90) / at(0.70);
    expect(r1).toBeGreaterThan(1);
    expect(Math.abs(r1 - r2) / r1).toBeLessThan(0.02);
  });

  it('puts the musical midrange near the middle of the display', () => {
    // the old quadratic mapping put ~6kHz at centre and left half the
    // picture empty; centre should now land in the low hundreds of Hz
    const binHz = 24000 / 1024;
    const centreHz = logFreqIndex(32, 64, 1024) * binHz;
    expect(centreHz).toBeGreaterThan(200);
    expect(centreHz).toBeLessThan(1500);
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
  it('returns a normalized 0..1 amplitude', () => {
    const mid = logSample(new Uint8Array(1024).fill(128), 0.5);
    expect(mid).toBeCloseTo(128 / 255, 5);
    expect(logSample(new Uint8Array(1024).fill(255), 0.3)).toBeCloseTo(1, 5);
    expect(logSample(new Uint8Array(1024), 0.7)).toBe(0);
  });

  it('reads the low end at t=0 and the high end at t=1', () => {
    const freq = new Uint8Array(1024);
    freq.fill(0);
    freq[1] = 255; freq[2] = 255;
    expect(logSample(freq, 0)).toBeGreaterThan(0.9);
    const hi = new Uint8Array(1024);
    hi.fill(0);
    for (let i = 600; i < 700; i++) hi[i] = 255;
    expect(logSample(hi, 1)).toBeGreaterThan(0.9);
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
    const freq = new Uint8Array(64).fill(120);
    expect(logSample(freq, -0.5)).toBeCloseTo(logSample(freq, 0), 5);
    expect(logSample(freq, 1.5)).toBeCloseTo(logSample(freq, 1), 5);
    expect(Number.isFinite(logSample(freq, NaN))).toBe(true);
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


describe('service worker cache versioning', () => {
  it('cache name matches the app version', async () => {
    const { readFileSync } = await import('node:fs');
    const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const name = sw.match(/const CACHE = '([^']+)'/)[1];
    // a stale cache name silently serves returning visitors an old build
    expect(name).toBe(`audiovisor-v${pkg.version}`);
  });
});

describe('computePeaks', () => {
  const buf = (data) => ({ getChannelData: () => Float32Array.from(data) });

  it('returns exactly the requested bucket count', () => {
    expect(computePeaks(buf(new Array(10000).fill(0.1)), 240)).toHaveLength(240);
  });

  it('normalizes so the loudest bucket is 1', () => {
    const peaks = computePeaks(buf([0.1, 0.1, 0.5, 0.5]), 2);
    expect(Math.max(...peaks)).toBeCloseTo(1);
    expect(peaks[0]).toBeCloseTo(0.2);
  });

  it('uses absolute amplitude, so a negative-only signal is not flat zero', () => {
    const peaks = computePeaks(buf([-0.8, -0.8, -0.2, -0.2]), 2);
    expect(peaks[0]).toBeCloseTo(1);
    expect(peaks[1]).toBeCloseTo(0.25);
  });

  it('returns all-zero for digital silence instead of dividing by zero', () => {
    const peaks = computePeaks(buf(new Array(512).fill(0)), 8);
    expect([...peaks].every((v) => v === 0)).toBe(true);
  });

  it('handles a buffer shorter than the bucket count without NaN', () => {
    const peaks = computePeaks(buf([0.5, 0.25]), 16);
    expect([...peaks].every(Number.isFinite)).toBe(true);
  });

  it('does not blow the stack on a large bucket count', () => {
    // Math.max(...peaks) used to spread every bucket as an argument
    expect(() => computePeaks(buf(new Array(400000).fill(0.3)), 200000)).not.toThrow();
  });
});

describe('safe / safeAsync', () => {
  it('returns the value when nothing throws', () => {
    expect(safe('ok', () => 42)).toBe(42);
  });

  it('swallows a throw and returns undefined', () => {
    expect(safe('boom', () => { throw new Error('nope'); })).toBeUndefined();
  });

  it('names the failing site on the console in development', () => {
    // the whole point of safe() over a bare `catch {}`: the swallow is still
    // silent in production, but in dev the label makes the site findable
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = new Error('nope');
    safe('preset save', () => { throw err; });
    expect(warn).toHaveBeenCalledWith('[safe] preset save:', err);
    warn.mockRestore();
  });

  it('safeAsync resolves the value', async () => {
    await expect(safeAsync('ok', async () => 'v')).resolves.toBe('v');
  });

  it('safeAsync never rejects', async () => {
    await expect(safeAsync('boom', async () => { throw new Error('nope'); })).resolves.toBeUndefined();
  });

  it('safeAsync swallows a synchronous throw too', async () => {
    await expect(safeAsync('sync-boom', () => { throw new Error('nope'); })).resolves.toBeUndefined();
  });
});

describe('esc', () => {
  it('escapes every HTML-significant character', () => {
    expect(esc(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('defuses an injected tag', () => {
    // provider error text and track titles reach the DOM as innerHTML
    expect(esc('<img src=x onerror=alert(1)>')).not.toContain('<');
  });

  it('escapes the ampersand first so entities are not doubled wrong', () => {
    expect(esc('&lt;')).toBe('&amp;lt;');
  });

  it('leaves ordinary text alone', () => {
    expect(esc('Kind of Blue — Miles Davis')).toBe('Kind of Blue — Miles Davis');
  });

  it('renders null and undefined as empty, not as the word', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });

  it('stringifies non-strings', () => {
    expect(esc(42)).toBe('42');
    expect(esc(0)).toBe('0');
    expect(esc(false)).toBe('false');
  });
});
