import { describe, it, expect } from 'vitest';
import { BeatTracker } from '../src/beattracker.js';

function restSpectrum(bins = 64) {
  const a = new Uint8Array(bins);
  a.fill(40);
  return a;
}

function makeOnsetSpectrum(bins = 64) {
  const a = new Uint8Array(bins);
  a.fill(40);
  for (let i = 0; i < 16; i++) a[i] = 220;
  return a;
}

/**
 * Feed a tracker with regularly spaced onsets at `spacing` seconds.
 * Between onsets the spectrum is flat at 40; at onset it spikes.
 */
function runSpaced(bt, { spacing, beats = 16, step = 1 / 60 }) {
  const onset = makeOnsetSpectrum();
  const rest = restSpectrum();
  let t = 0;
  const end = beats * spacing + 0.001;
  let nextOnset = spacing;
  bt.process(rest, t);
  t += step;
  while (t <= end) {
    const isOnset = Math.abs(t - nextOnset) < step * 0.6;
    if (isOnset) {
      bt.process(onset, t);
      nextOnset += spacing;
    } else {
      bt.process(rest, t);
    }
    t += step;
  }
}

describe('BeatTracker', () => {
  it('detects ~120 BPM from steady 500ms pulses', () => {
    const bt = new BeatTracker();
    runSpaced(bt, { spacing: 0.5, beats: 20 });
    expect(bt.bpm).toBeGreaterThan(118);
    expect(bt.bpm).toBeLessThan(122);
  });

  it('ignores flat energy (no spectral flux) -> bpm stays 0', () => {
    const bt = new BeatTracker();
    const flat = restSpectrum();
    // same spectrum every frame => flux 0
    for (let i = 0; i < 200; i++) {
      bt.process(flat, i * 0.016);
    }
    expect(bt.bpm).toBe(0);
    expect(bt.confidence).toBe(0);
  });

  it('folds double-time (250ms) into ~120 BPM', () => {
    const bt = new BeatTracker();
    runSpaced(bt, { spacing: 0.25, beats: 32 });
    expect(bt.bpm).toBeGreaterThan(118);
    expect(bt.bpm).toBeLessThan(122);
  });

  it('decays BPM after silence', () => {
    const bt = new BeatTracker({ decaySec: 3.2 });
    runSpaced(bt, { spacing: 0.5, beats: 16 });
    expect(bt.bpm).toBeGreaterThan(0);
    let t = 16 * 0.5;
    const rest = restSpectrum();
    // advance 4s with silence
    for (let i = 0; i < 240; i++) {
      t += 1 / 60;
      bt.process(rest, t);
    }
    expect(bt.bpm).toBe(0);
  });

  it('computes fast BPM for 428ms spacing (~140 BPM)', () => {
    const bt = new BeatTracker();
    runSpaced(bt, { spacing: 0.428, beats: 22 });
    expect(bt.bpm).toBeGreaterThan(130);
    expect(bt.bpm).toBeLessThan(150);
  });

  it('phase advances monotonically and wraps 0..1', () => {
    const bt = new BeatTracker();
    runSpaced(bt, { spacing: 0.5, beats: 20 });
    expect(bt.bpm).toBeGreaterThan(0);
    const rest = restSpectrum();
    let t = 20 * 0.5;
    const phases = [];
    for (let i = 0; i < 40; i++) {
      t += 1 / 60;
      bt.process(rest, t);
      phases.push(bt.phase);
      expect(bt.phase).toBeGreaterThanOrEqual(0);
      expect(bt.phase).toBeLessThan(1.0001);
    }
    const wrapped = phases.some((v, i) => i > 0 && v + 0.02 < phases[i - 1]);
    expect(wrapped).toBe(true);
  });

  it('pulse is 1 right after onset then decays', () => {
    const bt = new BeatTracker();
    const onset = makeOnsetSpectrum();
    const rest = restSpectrum();
    bt.process(rest, 0);
    bt.process(onset, 0.016);
    expect(bt.pulse).toBe(1);
    // advance 300ms with rest
    for (let i = 1; i <= 18; i++) {
      bt.process(rest, 0.016 + i * 0.016);
    }
    expect(bt.pulse).toBeLessThan(0.3);
    expect(bt.pulse).toBeGreaterThanOrEqual(0);
  });

  it('reset clears state', () => {
    const bt = new BeatTracker();
    runSpaced(bt, { spacing: 0.5, beats: 16 });
    expect(bt.bpm).not.toBe(0);
    bt.reset();
    expect(bt.bpm).toBe(0);
    expect(bt.phase).toBe(0);
    expect(bt.confidence).toBe(0);
  });

  it('handles jittered intervals (±15ms) and still locks ~120', () => {
    const bt = new BeatTracker();
    const onset = makeOnsetSpectrum();
    const rest = restSpectrum();
    let t = 0;
    bt.process(rest, t);
    t += 1 / 60;
    let next = 0.5;
    // add ±12ms jitter per beat
    const jitters = [0.012, -0.008, 0.005, -0.011, 0.009, -0.004, 0.010, -0.006];
    for (let b = 0; b < 20; b++) {
      const spacing = 0.5 + jitters[b % jitters.length];
      next += spacing;
      while (t < next - 1e-9) {
        bt.process(rest, t);
        t += 1 / 60;
      }
      bt.process(onset, t);
      t += 1 / 60;
      // immediate rest after onset to create flux
      bt.process(rest, t);
      t += 1 / 60;
    }
    expect(bt.bpm).toBeGreaterThan(115);
    expect(bt.bpm).toBeLessThan(125);
  });

  it('folds half-time (1.0s spacing = 60 BPM raw) up to ~120', () => {
    const bt = new BeatTracker();
    runSpaced(bt, { spacing: 1.0, beats: 16 });
    expect(bt.bpm).toBeGreaterThan(115);
    expect(bt.bpm).toBeLessThan(125);
  });

  it('ignores invalid inputs gracefully', () => {
    const bt = new BeatTracker();
    expect(() => bt.process(null, 0)).not.toThrow();
    expect(() => bt.process(new Uint8Array(64), NaN)).not.toThrow();
    expect(() => bt.process(new Uint8Array(64), Infinity)).not.toThrow();
    expect(bt.bpm).toBe(0);
  });
});
