import { describe, it, expect, beforeEach } from 'vitest';
import { makeFakeCanvas, ensureGlobals } from './helpers/canvas.js';
import { calmEnvelope, lockedBeat, CALM_BEAT_CAP, LOCK_MODES } from '../src/visualizers.js';

describe('calmEnvelope', () => {
  it('never exceeds the calm cap, however hard the beat hits', () => {
    let v = 0;
    for (let i = 0; i < 600; i++) v = calmEnvelope(v, 1, 1 / 60);
    expect(v).toBeLessThanOrEqual(CALM_BEAT_CAP + 1e-12);
    expect(v).toBeGreaterThan(CALM_BEAT_CAP * 0.95);
  });

  it('cannot follow a 3Hz beat train: the ripple is a small fraction of the swing', () => {
    let v = 0;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 600; i++) {
      // a full on/off beat every 1/3 second at 60Hz
      const target = (Math.floor(i / 10) % 2) === 0 ? 1 : 0;
      v = calmEnvelope(v, target, 1 / 60);
      if (i > 300) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    expect(hi - lo).toBeLessThan(CALM_BEAT_CAP * 0.5);
  });

  it('falls back to a zero step for a non-positive dt', () => {
    expect(calmEnvelope(0.2, 1, 0)).toBeCloseTo(0.2, 12);
  });
});

describe('lockedBeat', () => {
  const locked = { bpm: 120, beatConfidence: 0.9, beatPhase: 0 };

  it('uses the onset envelope when the raw frame had no beatPhase', () => {
    expect(lockedBeat(locked, false, 0.7)).toBe(0.7);
  });

  it('uses the onset envelope when the tracker is not confident or has no tempo', () => {
    expect(lockedBeat({ ...locked, beatConfidence: 0.2 }, true, 0.7)).toBe(0.7);
    expect(lockedBeat({ ...locked, bpm: 0 }, true, 0.7)).toBe(0.7);
  });

  it('peaks on the downbeat with the grid ceiling and decays across the beat', () => {
    const atBeat = lockedBeat(locked, true, 0);
    expect(atBeat).toBeCloseTo(0.72 * 0.9, 10);
    expect(lockedBeat({ ...locked, beatPhase: 0.5 }, true, 0)).toBeLessThan(atBeat);
    expect(lockedBeat({ ...locked, beatPhase: 1 }, true, 0)).toBe(0);
  });

  it('is only applied in the locked modes', () => {
    expect(LOCK_MODES.has('bars')).toBe(true);
    expect(LOCK_MODES.has('tunnel')).toBe(false);
  });
});

describe('Renderer calm and transitions', () => {
  let Renderer;
  const freq = new Uint8Array(1024).fill(128);
  const wave = new Uint8Array(2048).fill(128);

  beforeEach(async () => {
    ensureGlobals();
    ({ Renderer } = await import('../src/visualizers.js'));
  });

  const make = () => new Renderer(makeFakeCanvas(800, 600));
  const pulse = (beatPulse, extra = {}) => ({ bass: 0.4, mid: 0.3, high: 0.2, level: 0.4, beatPulse, ...extra });

  it('calm is a plain boolean that defaults to off', () => {
    const r = make();
    expect(r.calm).toBe(false);
    r.calm = 1;
    expect(r.calm).toBe(true);
    r.calm = 0;
    expect(r.calm).toBe(false);
  });

  it('calm caps the beat the chrome reads, while the raw beat still hits 1', () => {
    const r = make();
    r.calm = true;
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      r.render(false, freq, wave, pulse(1), 16.7);
      peak = Math.max(peak, r.chromeBeat);
    }
    expect(peak).toBeLessThanOrEqual(CALM_BEAT_CAP + 1e-9);
    expect(r.beat).toBeCloseTo(1, 5);
  });

  it('without calm the chrome reads the raw beat', () => {
    const r = make();
    r.render(false, freq, wave, pulse(1), 16.7);
    expect(r.chromeBeat).toBe(r.beat);
  });

  it('beat-lock swaps the onset pulse for the phase grid in a locked mode only', () => {
    const phased = { bpm: 120, beatConfidence: 0.9, beatPhase: 0, beatPulse: 1 };
    const bars = make();
    bars.setMode('bars');
    bars.updateAnalysis(phased, 16.7);
    expect(bars._effectBeat(1 / 60)).toBeCloseTo(0.72 * 0.9, 10);

    const waves = make();
    waves.setMode('waves');
    waves.updateAnalysis(phased, 16.7);
    expect(waves._effectBeat(1 / 60)).toBeCloseTo(1, 10);
  });

  it('keeps the onset envelope when the frame carries no beatPhase', () => {
    const r = make();
    r.setMode('bars');
    r.updateAnalysis({ bpm: 120, beatConfidence: 0.9, beatPulse: 1 }, 16.7);
    expect(r._effectBeat(1 / 60)).toBeCloseTo(1, 10);
  });

  it('dissolves the outgoing frame over the new mode, then stops', () => {
    const r = make();
    r.render(false, freq, wave, pulse(0), 16.7);
    r.setMode('waves');
    expect(r._xfadeLeft).toBeGreaterThan(0);
    const before = r._xfadeLeft;
    r.render(false, freq, wave, pulse(0), 16.7);
    expect(r._xfadeLeft).toBeLessThan(before);
    for (let i = 0; i < 40; i++) r.render(false, freq, wave, pulse(0), 16.7);
    expect(r._xfadeLeft).toBeLessThanOrEqual(0);
  });

  it('does not dissolve from a frame it did not draw', () => {
    const r = make();
    r.render(false, freq, wave, pulse(0), 16.7);
    r.updateAnalysis(pulse(0), 16.7);   // a raytraced frame: the 2D canvas went unused
    r.setMode('waves');
    expect(r._xfadeLeft).toBe(0);
  });

  it('clears particles and peaks left by the previous mode', () => {
    const r = make();
    r.particles.push({ x: 1, y: 1 });
    r.peaks = [0.5];
    r.setMode('scope');
    expect(r.particles).toEqual([]);
    expect(r.peaks).toEqual([]);
  });

  it('draws the same random sequence from a fixed seed', () => {
    const a = make();
    const b = make();
    const seqA = Array.from({ length: 5 }, () => a._rnd());
    const seqB = Array.from({ length: 5 }, () => b._rnd());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of seqA) expect(v).toBeLessThan(1);
  });
});
