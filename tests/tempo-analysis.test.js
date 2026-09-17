import { describe, it, expect } from 'vitest';
import { analyzeTempo } from '../src/tempo-analysis.js';

const SR = 44100;

/** A kick-like decaying 90Hz burst every `beatSec` seconds. */
function clickTrack(bpm, seconds, { amp = 0.9 } = {}) {
  const n = Math.floor(seconds * SR);
  const out = new Float32Array(n);
  const period = Math.floor((60 / bpm) * SR);
  for (let start = 0; start < n; start += period) {
    for (let i = 0; i < SR * 0.06 && start + i < n; i++) {
      const env = Math.exp(-i / (SR * 0.012));
      out[start + i] += amp * env * Math.sin((2 * Math.PI * 90 * i) / SR);
    }
  }
  return out;
}

describe('analyzeTempo', () => {
  it('locks a steady 120 BPM click track', () => {
    const { bpm, confidence } = analyzeTempo(clickTrack(120, 16), SR);
    expect(confidence).toBeGreaterThan(0.2);
    expect(Math.abs(bpm - 120)).toBeLessThan(3);
  });

  it('locks a steady 90 BPM click track', () => {
    const { bpm, confidence } = analyzeTempo(clickTrack(90, 20), SR);
    expect(confidence).toBeGreaterThan(0.2);
    expect(Math.abs(bpm - 90)).toBeLessThan(3);
  });

  it('reports nothing for silence', () => {
    const { bpm } = analyzeTempo(new Float32Array(SR * 5), SR);
    expect(bpm).toBe(0);
  });

  it('returns no lock for a signal shorter than one FFT window', () => {
    expect(analyzeTempo(new Float32Array(100), SR)).toEqual({ bpm: 0, confidence: 0 });
  });
});
