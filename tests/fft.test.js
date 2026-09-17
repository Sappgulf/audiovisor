import { describe, it, expect } from 'vitest';
import { FFT } from '../src/fft.js';

describe('FFT', () => {
  it('rejects non-power-of-two sizes', () => {
    expect(() => new FFT(100)).toThrow();
    expect(() => new FFT(0)).toThrow();
  });

  it('puts a pure sine in its own bin', () => {
    const n = 256;
    const bin = 20;
    const samples = new Float64Array(n);
    for (let i = 0; i < n; i++) samples[i] = Math.sin((2 * Math.PI * bin * i) / n);
    const mags = new FFT(n).magnitudes(samples);
    let peak = 0;
    for (let i = 1; i < mags.length; i++) if (mags[i] > mags[peak]) peak = i;
    expect(peak).toBe(bin);
    // the peak should dominate every other bin
    const other = Math.max(...mags.filter((_, i) => i !== peak));
    expect(mags[peak]).toBeGreaterThan(other * 10);
  });

  it('concentrates a DC signal at bin zero', () => {
    const n = 128;
    const mags = new FFT(n).magnitudes(new Float64Array(n).fill(0.5));
    expect(mags[0]).toBeCloseTo(n * 0.5, 3);
    expect(mags[1]).toBeLessThan(1e-6);
  });

  it('returns size/2 magnitudes', () => {
    expect(new FFT(512).magnitudes(new Float64Array(512))).toHaveLength(256);
  });
});
