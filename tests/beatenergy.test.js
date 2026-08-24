import { describe, it, expect } from 'vitest';
import { beatEnergy, GRID_MIN_CONFIDENCE, GRID_MAX } from '../src/beatenergy.js';

const DT = 1 / 60;
const locked = (phase, over = {}) => ({
  beatPulse: 0, bpm: 128, beatConfidence: 0.9, beatPhase: phase, ...over,
});

describe('beatEnergy', () => {
  it('decays toward zero with no signal', () => {
    let v = 1;
    for (let i = 0; i < 60; i++) v = beatEnergy(v, null, DT);
    expect(v).toBeLessThan(0.05);
    expect(v).toBeGreaterThanOrEqual(0);
  });

  it('takes a detected onset at full strength', () => {
    expect(beatEnergy(0, locked(0.5, { beatPulse: 1 }), DT)).toBe(1);
  });

  it('lets a real onset outrank the grid term', () => {
    // an onset on the downbeat, where the grid term is at its strongest
    expect(beatEnergy(0, locked(0, { beatPulse: 1 }), DT)).toBe(1);
    expect(GRID_MAX).toBeLessThan(1);
  });

  it('keeps time through a missed onset once tempo is locked', () => {
    // no pulse at all, but the grid is on the downbeat
    const v = beatEnergy(0, locked(0), DT);
    expect(v).toBeGreaterThan(0.5);
  });

  it('peaks on the downbeat and falls across the beat', () => {
    const at = (p) => beatEnergy(0, locked(p), DT);
    expect(at(0)).toBeGreaterThan(at(0.25));
    expect(at(0.25)).toBeGreaterThan(at(0.5));
    expect(at(0.5)).toBeGreaterThan(at(0.9));
  });

  it('stays off below the confidence floor, so unlocked audio is unchanged', () => {
    const below = beatEnergy(0, locked(0, { beatConfidence: GRID_MIN_CONFIDENCE - 0.01 }), DT);
    expect(below).toBe(0);
    const above = beatEnergy(0, locked(0, { beatConfidence: GRID_MIN_CONFIDENCE + 0.01 }), DT);
    expect(above).toBeGreaterThan(0);
  });

  it('stays off when there is no tempo', () => {
    expect(beatEnergy(0, locked(0, { bpm: 0 }), DT)).toBe(0);
  });

  it('scales the grid term with confidence', () => {
    const lo = beatEnergy(0, locked(0, { beatConfidence: 0.4 }), DT);
    const hi = beatEnergy(0, locked(0, { beatConfidence: 1 }), DT);
    expect(hi).toBeGreaterThan(lo);
  });

  it('never returns less than the decaying tail', () => {
    const prev = 0.8;
    const v = beatEnergy(prev, locked(0.99), DT);
    expect(v).toBeGreaterThanOrEqual(prev * Math.pow(0.86, 1) - 1e-9);
  });

  it('is frame-rate shaped — same decay per unit time at 60 and 144Hz', () => {
    let a = 1, b = 1;
    for (let i = 0; i < 30; i++) a = beatEnergy(a, null, 1 / 60);
    for (let i = 0; i < 72; i++) b = beatEnergy(b, null, 1 / 144);
    expect(Math.abs(a - b)).toBeLessThan(0.02);
  });

  it('clamps a phase outside 0..1 rather than producing garbage', () => {
    for (const p of [-3, 1.5, NaN]) {
      const v = beatEnergy(0, locked(p), DT);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('produces one peak per beat when driven around the grid', () => {
    let v = 0;
    const seen = [];
    // three full beats of phase at 60 frames each, no onsets at all
    for (let i = 0; i < 180; i++) {
      v = beatEnergy(v, locked((i / 60) % 1), DT);
      seen.push(v);
    }
    let peaks = 0;
    for (let i = 1; i < seen.length - 1; i++) {
      if (seen[i] > seen[i - 1] && seen[i] >= seen[i + 1] && seen[i] > 0.3) peaks++;
    }
    // the downbeat at frame 0 has no predecessor to be a peak against, so
    // three beats of phase yield two countable peaks
    expect(peaks).toBe(2);
  });
});

describe('beatEnergy cannot latch a bad value', () => {
  it('recovers from a NaN accumulator', () => {
    // Math.max propagates NaN, so without a guard this stays NaN forever
    let v = beatEnergy(NaN, locked(0.5), DT);
    expect(Number.isFinite(v)).toBe(true);
    for (let i = 0; i < 5; i++) v = beatEnergy(v, locked(0.5), DT);
    expect(Number.isFinite(v)).toBe(true);
  });

  it('tolerates a non-finite dt', () => {
    for (const bad of [NaN, Infinity, undefined]) {
      expect(Number.isFinite(beatEnergy(0.5, locked(0.2), bad))).toBe(true);
    }
  });

  it('never returns NaN for any level field being NaN', () => {
    const nan = { beatPulse: NaN, bpm: NaN, beatConfidence: NaN, beatPhase: NaN };
    expect(Number.isFinite(beatEnergy(0.4, nan, DT))).toBe(true);
  });
});
