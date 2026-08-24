import { describe, it, expect } from 'vitest';
import { sanitizeLevels, usableSpectrum, SILENT_LEVELS } from '../src/levels.js';

describe('sanitizeLevels', () => {
  it('passes a normal frame through unchanged', () => {
    const raw = {
      bass: 0.6, mid: 0.4, high: 0.2, level: 0.5,
      beatPulse: 1, beatPhase: 0.25, bpm: 128, beatConfidence: 0.9,
    };
    expect(sanitizeLevels(raw)).toMatchObject(raw);
  });

  it('replaces every non-finite value with zero', () => {
    const out = sanitizeLevels({
      bass: NaN, mid: Infinity, high: -Infinity, level: NaN,
      beatPulse: NaN, beatPhase: NaN, bpm: NaN, beatConfidence: NaN,
    });
    for (const [k, v] of Object.entries(out)) {
      if (k === 'chop') continue;
      expect(Number.isFinite(v), `${k} = ${v}`).toBe(true);
    }
    // an infinite level means a broken computation upstream, not a loud
    // signal, so it is treated as no signal rather than as full scale
    expect(out.bass).toBe(0);
    expect(out.mid).toBe(0);
    expect(out.high).toBe(0);
  });

  it('clamps out-of-range numbers rather than trusting them', () => {
    const out = sanitizeLevels({ bass: -5, mid: 1e9, high: -1e9, level: 50, beatPhase: 99 });
    expect(out.bass).toBe(0);
    expect(out.mid).toBe(1);
    expect(out.high).toBe(0);
    expect(out.level).toBe(1);
    expect(out.beatPhase).toBe(1);
  });

  it('allows bpm above 1 but not an absurd tempo', () => {
    expect(sanitizeLevels({ bpm: 174 }).bpm).toBe(174);
    expect(sanitizeLevels({ bpm: 99999 }).bpm).toBe(400);
    expect(sanitizeLevels({ bpm: -30 }).bpm).toBe(0);
  });

  it('rejects non-numeric values that would poison arithmetic', () => {
    const out = sanitizeLevels({ bass: '0.5', mid: null, high: undefined, level: {} });
    expect(out.bass).toBe(0);
    expect(out.mid).toBe(0);
    expect(out.high).toBe(0);
    expect(out.level).toBe(0);
  });

  it('returns silence for a missing or non-object frame', () => {
    for (const bad of [null, undefined, 42, 'x', true]) {
      expect(sanitizeLevels(bad)).toBe(SILENT_LEVELS);
    }
  });

  it('always returns every field the renderer reads', () => {
    const keys = ['bass', 'mid', 'high', 'level', 'beatPulse', 'beatPhase', 'bpm', 'beatConfidence'];
    for (const k of keys) expect(sanitizeLevels({}), k).toHaveProperty(k);
  });

  it('preserves the chop flag as a boolean', () => {
    expect(sanitizeLevels({ chop: 1 }).chop).toBe(true);
    expect(sanitizeLevels({}).chop).toBe(false);
  });

  it('does not mutate the caller frame', () => {
    const raw = { bass: NaN };
    sanitizeLevels(raw);
    expect(Number.isNaN(raw.bass)).toBe(true);
  });
});

describe('usableSpectrum', () => {
  it('accepts a populated spectrum', () => {
    expect(usableSpectrum(new Uint8Array(1024))).toBe(true);
  });

  it('rejects an empty or missing one', () => {
    expect(usableSpectrum(new Uint8Array(0))).toBe(false);
    expect(usableSpectrum(null)).toBe(false);
    expect(usableSpectrum(undefined)).toBe(false);
  });
});
