/**
 * Drop detection on synthetic arrangements. The failure modes worth pinning:
 * never fires on constant loudness, fires once (not per bar) after a real
 * breakdown, resets on seeks, and the envelope actually decays.
 */
import { describe, it, expect } from 'vitest';
import { DropDetector } from '../src/drop.js';

/** Feed a bass level at 60fps starting from t=1 (after leading silence). */
function run(det, steps, bassAt) {
  let out = 0;
  for (let i = 0; i < steps; i++) {
    const t = 1 + i / 60;
    /* the engine's broadband level always carries the bass band, so the
       test level tracks the bass steps the way real frames do — a flat
       level would read as zero rise-rate and never confirm a slam */
    out = det.process(bassAt(t), 0.12 + bassAt(t) * 0.75, t);
  }
  return out;
}

describe('DropDetector', () => {
  it('stays silent on constant loudness', () => {
    const det = new DropDetector();
    expect(run(det, 60 * 20, () => 0.6)).toBe(0);
  });

  it('fires after a breakdown → slam and decays afterwards', () => {
    const det = new DropDetector();
    /* 4s loud, 2s breakdown, loud again */
    const bass = (t) => (t < 5 ? 0.6 : t < 7 ? 0.1 : 0.7);
    const level = (t) => 0.12 + bass(t) * 0.75;
    let peak = 0;
    let tFire = -1;
    for (let i = 0; i < 60 * 12; i++) {
      const t = 1 + i / 60;
      const d = det.process(bass(t), level(t), t);
      if (d > peak) { peak = d; tFire = t; }
    }
    expect(peak).toBe(1);
    expect(tFire).toBeGreaterThanOrEqual(7);  // fires when the slam lands
    expect(tFire).toBeLessThan(7.5);
    /* envelope decays: ~1s later it is well under half */
    const after = det.process(bass(8.6), level(8.6), 8.6);
    expect(after).toBeLessThan(0.5);
  });

  it('does not re-fire every bar of the same breakdown', () => {
    const det = new DropDetector({ cooldownSec: 10 });
    const bass = (t) => (t < 5 ? 0.6 : t < 7 ? 0.1 : t < 20 ? 0.7 : 0.1);
    let fires = 0;
    let wasZero = true;
    for (let i = 0; i < 60 * 25; i++) {
      const t = 1 + i / 60;
      const d = det.process(bass(t), 0.12 + bass(t) * 0.75, t);
      if (d > 0.9 && wasZero) { fires++; wasZero = false; }
      if (d === 0) wasZero = true;
    }
    expect(fires).toBe(1);
  });

  it('ignores a surge with no breakdown before it', () => {
    const det = new DropDetector();
    const bass = (t) => (t < 5 ? 0.25 : 0.9);   // jump, but never quiet
    let peak = 0;
    for (let i = 0; i < 60 * 10; i++) {
      const t = 1 + i / 60;
      peak = Math.max(peak, det.process(bass(t), 0.12 + bass(t) * 0.75, t));
    }
    expect(peak).toBe(0);
  });

  it('resets on a backwards seek', () => {
    const det = new DropDetector();
    const bass = (t) => (t < 5 ? 0.6 : t < 7 ? 0.1 : 0.7);
    run(det, 60 * 8, bass);            // through the first drop
    det.process(0.1, 0.5, 5.5);        // seek back into the breakdown
    expect(det._t).toBe(5.5);
    expect(det._quiet).toBe(0);        // armed state was wiped
  });

  it('survives NaN frames without poisoning the envelope', () => {
    const det = new DropDetector();
    det.process(0.5, 0.5, 1);
    expect(det.process(NaN, 0.5, 1.02)).toBe(0);
    expect(det.process(0.5, 0.5, 1.04)).toBe(0);
  });

  it('fires on a realistic smoothed slam, not just instant steps', () => {
    /* The old gate read only the single frame bass climbed back past the
       baseline, so a slam smeared over several frames by analyser smoothing
       disarmed the detector on its first rising frame and never fired. The
       arming now latches through the rise: an exponential return (tau 80ms,
       as a smoothed kick reads) must still fire. */
    const det = new DropDetector();
    const bass = (t) => {
      if (t < 5) return 0.6;
      if (t < 7) return 0.1;
      return 0.1 + (0.7 - 0.1) * (1 - Math.exp(-(t - 7) / 0.08));
    };
    let peak = 0;
    let tFire = -1;
    for (let i = 0; i < 60 * 12; i++) {
      const t = 1 + i / 60;
      const d = det.process(bass(t), 0.12 + bass(t) * 0.75, t);
      if (d > peak) { peak = d; tFire = t; }
    }
    expect(peak).toBe(1);
    expect(tFire).toBeGreaterThanOrEqual(7);
    expect(tFire).toBeLessThan(8);
  });

  it('does not fire on a slow swell back after a breakdown', () => {
    /* Same shape as a drop but with a 5-second linear fade instead of a
       slam: the return crosses the baseline inside the grace window, but
       the rise rate never reads as an impact, so the choreography stays
       off. A fade-in is not a drop. */
    const det = new DropDetector();
    const bass = (t) => {
      if (t < 5) return 0.6;
      if (t < 7) return 0.1;
      if (t < 12) return 0.1 + (0.7 - 0.1) * ((t - 7) / 5);
      return 0.7;
    };
    let peak = 0;
    for (let i = 0; i < 60 * 15; i++) {
      const t = 1 + i / 60;
      peak = Math.max(peak, det.process(bass(t), 0.12 + bass(t) * 0.75, t));
    }
    expect(peak).toBe(0);
  });
});
