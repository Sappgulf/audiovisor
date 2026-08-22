import { describe, it, expect } from 'vitest';
import { SynthFeed } from '../src/synthfeed.js';

describe('SynthFeed', () => {
  it('produces full-range byte frames within bounds', () => {
    const f = new SynthFeed('seed-a');
    f.tick(1.5);
    const { freq, wave } = f.getData();
    expect(freq.length).toBe(1024);
    expect(wave.length).toBe(2048);
    for (const v of freq) expect(v).toBeLessThanOrEqual(255);
    for (const v of wave) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it('is deterministic for the same seed and time', () => {
    const a = new SynthFeed('track-123');
    const b = new SynthFeed('track-123');
    a.tick(10.25);
    b.tick(10.25);
    expect([...a.getData().freq]).toEqual([...b.getData().freq]);
    expect(a.bpm).toBe(b.bpm);
  });

  it('differs between seeds', () => {
    const a = new SynthFeed('alpha');
    const b = new SynthFeed('beta');
    a.tick(3);
    b.tick(3);
    expect([...a.getData().freq]).not.toEqual([...b.getData().freq]);
  });

  it('evolves over time (not static)', () => {
    const f = new SynthFeed('evolve');
    f.tick(2);
    const early = [...f.getData().freq];
    f.tick(9);
    const late = [...f.getData().freq];
    expect(early).not.toEqual(late);
  });

  it('ignores repeated ticks at the same time position', () => {
    const f = new SynthFeed('repeat');
    f.tick(5);
    const once = [...f.getData().freq];
    f.tick(5);
    expect([...f.getData().freq]).toEqual(once);
  });

  it('clear zeroes freq and centers the waveform', () => {
    const f = new SynthFeed('clear-me');
    f.tick(4);
    f.clear();
    const { freq, wave } = f.getData();
    expect(freq.every((v) => v === 0)).toBe(true);
    expect(wave.every((v) => v === 128)).toBe(true);
  });

  it('keeps bass dominant during kick phase at low bins', () => {
    const f = new SynthFeed('bass-check');
    // sample many times; low bins should on average exceed high bins
    let lowSum = 0;
    let highSum = 0;
    for (let s = 0; s < 40; s++) {
      f.tick(s * 0.37 + 0.01);
      const { freq } = f.getData();
      lowSum += freq[2];
      highSum += freq[900];
    }
    expect(lowSum / 40).toBeGreaterThan(highSum / 40);
  });

});
