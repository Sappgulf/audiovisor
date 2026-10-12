import { describe, it, expect, vi, afterEach } from 'vitest';
import { AudioEngine } from '../src/audio.js';
import { BeatTracker } from '../src/beattracker.js';

/* the four-pass mean the band code used before it shared one walk */
function bandAvg(freq, a, b) {
  let s = 0;
  for (let i = a; i < b; i++) s += freq[i];
  return s / Math.max(1, b - a) / 255;
}

/* deterministic bytes, so a failure reproduces */
function bins(n, seed) {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x % 256;
  }
  return out;
}

describe('band levels from one walk of the bins', () => {
  it('match four separate bandAvg passes bit for bit, across sizes and frames', () => {
    for (const n of [1024, 512, 64, 16, 4]) {
      const engine = new AudioEngine();
      // beat input is a separate buffer, so only the band walk reads `freq`
      engine.beatAnalyser = { getByteFrequencyData: () => {} };
      engine.beatFreq = new Uint8Array(n);
      for (let f = 0; f < 20; f++) {
        const freq = bins(n, n * 31 + f);
        const binHz = 44100 / 2 / n;
        const iBass = Math.floor(120 / binHz);
        const iMid = Math.floor(2000 / binHz);
        const iTOP = Math.min(n, Math.ceil(16000 / binHz));
        const lv = engine.getLevels({ freq, wave: null, stereoL: null, stereoR: null }, 0);
        expect(lv.bass).toBe(bandAvg(freq, 2, iBass));
        expect(lv.mid).toBe(bandAvg(freq, iBass, iMid));
        expect(lv.high).toBe(bandAvg(freq, iMid, iTOP));
        expect(lv.level).toBe(bandAvg(freq, 2, iTOP));
      }
    }
  });

  it('reads each analyser bin at most once per frame', () => {
    const n = 1024;
    const engine = new AudioEngine();
    engine.beatAnalyser = { getByteFrequencyData: () => {} };
    engine.beatFreq = new Uint8Array(n);
    const base = bins(n, 7);
    let reads = 0;
    const freq = new Proxy(base, {
      get(target, prop) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) reads++;
        return Reflect.get(target, prop);
      },
    });
    engine.getLevels({ freq, wave: null, stereoL: null, stereoR: null }, 0);
    const binHz = 44100 / 2 / n;
    expect(reads).toBeLessThanOrEqual(Math.ceil(16000 / binHz));
  });
});

describe('frame-path allocations', () => {
  afterEach(() => vi.restoreAllMocks());

  it('engine.loop hands back the same frozen region until it changes', () => {
    const engine = new AudioEngine();
    engine.mode = 'file';
    engine.buffer = { duration: 100 };
    engine.setLoop(10, 20);
    const first = engine.loop;
    expect(engine.loop).toBe(first);
    expect(first).toEqual({ start: 10, end: 20 });
    expect(Object.isFrozen(first)).toBe(true);
    expect(engine.setLoop(30, 40)).toEqual({ start: 30, end: 40 });
    expect(engine.loop).toEqual({ start: 30, end: 40 });
    engine.clearLoop();
    expect(engine.loop).toBeNull();
  });

  it('onset tempo estimates build no typed-array views', () => {
    const bt = new BeatTracker();
    const hit = new Uint8Array(64).fill(40);
    const rest = new Uint8Array(64).fill(40);
    for (let i = 0; i < 16; i++) hit[i] = 220;
    const spy = vi.spyOn(Float32Array.prototype, 'subarray');
    for (let t = 0; t < 12; t += 1 / 60) {
      const n = Math.round(t / 0.5);
      bt.process(Math.abs(t - n * 0.5) < 0.01 ? hit : rest, t);
    }
    expect(bt.bpm).toBeGreaterThan(0);          // the estimate really ran
    expect(spy).not.toHaveBeenCalled();
  });
});
