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

  /* Click tracks are too clean to catch an analyser that skips the
     AnalyserNode's window and smoothing — a pitched kick with a snare and
     8th-note hats is what exposed 120 reading as 130. */
  it.each([100, 120, 140, 174])('locks a %i BPM kick/snare/hat pattern', (target) => {
    const { bpm } = analyzeTempo(drumLoop(target, 20), SR);
    expect(Math.abs(bpm - target) / target).toBeLessThan(0.03);
  });
});

function drumLoop(bpm, seconds) {
  const period = 60 / bpm;
  const out = new Float32Array(SR * seconds);
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const bt = t % period;
    const beatNo = Math.floor(t / period) % 4;
    const kick = Math.sin(2 * Math.PI * (55 + 120 * Math.exp(-bt * 40)) * bt) * Math.exp(-bt * 9)
      + noise() * 0.5 * Math.exp(-bt * 300);
    const snare = beatNo === 1 || beatNo === 3 ? noise() * 0.5 * Math.exp(-bt * 25) : 0;
    const hat = noise() * 0.15 * Math.exp(-(t % (period / 2)) * 60);
    out[i] = 0.5 * kick + snare + hat + 0.08 * Math.sin(2 * Math.PI * 220 * t);
  }
  return out;
}
