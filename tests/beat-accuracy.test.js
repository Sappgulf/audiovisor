/**
 * Beat-tracker accuracy against synthetic material with a known tempo.
 *
 * tests/beattracker.test.js covers the tracker's mechanics — this measures
 * whether it actually finds the right tempo and stays on the grid, which is
 * the property that decides whether the visuals look synced. The numbers in
 * the thresholds below were measured; they are deliberately a little looser
 * than the current results so ordinary tuning does not trip them, but tight
 * enough that a real regression does.
 */
import { describe, it, expect } from 'vitest';
import { BeatTracker } from '../src/beattracker.js';
import { BEAT_SMOOTHING } from '../src/audio.js';

const FPS = 60;
const DT = 1 / FPS;
const BINS = 1024;

/** One spectrum frame of a kick/snare/hat pattern at `bpm`. */
function spectrumAt(t, bpm) {
  const period = 60 / bpm;
  const beat = t / period;
  const inBeat = beat - Math.floor(beat);
  const beatNo = Math.floor(beat) % 4;
  const out = new Float32Array(BINS);
  let s = 9301 + Math.floor(t * 1000) * 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const env = (p, d) => (p < 0 ? 0 : Math.exp(-p / d));

  const kick = env(inBeat * period, 0.055);
  const snare = (beatNo === 1 || beatNo === 3) ? env(inBeat * period, 0.09) : 0;
  const hat = env(((beat * 2) % 1) * period / 2, 0.02) * 0.5;

  for (let i = 0; i < BINS; i++) {
    const u = i / BINS;
    let v = 0.04 + rnd() * 0.02;
    v += kick * 0.95 * Math.exp(-Math.pow(u / 0.03, 2));
    v += snare * 0.5 * Math.exp(-Math.pow((u - 0.12) / 0.09, 2));
    v += hat * 0.35 * Math.exp(-Math.pow((u - 0.55) / 0.3, 2));
    v += 0.10 * Math.exp(-Math.pow((u - 0.2) / 0.15, 2));
    out[i] = Math.min(1, v);
  }
  return out;
}

/**
 * Drive the tracker through `seconds` of material, applying the same
 * exponential smoothing an AnalyserNode would.
 */
function run(bpm, { smoothing = BEAT_SMOOTHING, seconds = 26, latency = 0 } = {}) {
  const tr = new BeatTracker();
  const sm = new Float32Array(BINS);
  const bytes = new Uint8Array(BINS);
  const period = 60 / bpm;
  let first = true;
  let lockSec = null;
  const phaseErrs = [];

  for (let f = 0; f < seconds * FPS; f++) {
    const t = f * DT;
    const raw = spectrumAt(t, bpm);
    for (let i = 0; i < BINS; i++) {
      sm[i] = first ? raw[i] : smoothing * sm[i] + (1 - smoothing) * raw[i];
      bytes[i] = Math.round(sm[i] * 255);
    }
    first = false;
    tr.process(bytes, t, latency);
    if (tr.bpm > 0 && lockSec === null) lockSec = t;
    if (t > 12 && tr.bpm > 0) {
      let d = (tr.phase % 1) - (((t - latency) / period) % 1);
      while (d > 0.5) d -= 1;
      while (d < -0.5) d += 1;
      phaseErrs.push(Math.abs(d) * period * 1000);
    }
  }
  return {
    bpm: tr.bpm,
    err: Math.abs(tr.bpm - bpm),
    lockSec,
    confidence: tr.confidence,
    phaseMs: phaseErrs.reduce((a, b) => a + b, 0) / Math.max(1, phaseErrs.length),
  };
}

const TEMPOS = [78, 82, 90, 96, 104, 110, 118, 124, 128, 132, 140, 146, 152, 160, 168, 174];

/* Each trial simulates 26s of audio at 60fps, so every tempo is run once
   and the results shared. Re-running per assertion tripled the suite time
   for no extra coverage. */
const cache = new Map();
const at = (bpm, opts = {}) => {
  const key = `${bpm}|${opts.smoothing ?? BEAT_SMOOTHING}|${opts.seconds ?? 26}|${opts.latency ?? 0}`;
  if (!cache.has(key)) cache.set(key, run(bpm, opts));
  return cache.get(key);
};

describe('tempo detection', () => {
  it.each(TEMPOS)('locks %i BPM within 2 BPM', (bpm) => {
    const r = at(bpm);
    expect(r.bpm, `detected ${r.bpm}`).toBeGreaterThan(0);
    expect(r.err, `detected ${r.bpm} for ${bpm}`).toBeLessThanOrEqual(2);
  });

  it('does not settle on a half- or double-time octave', () => {
    for (const bpm of TEMPOS) {
      const got = at(bpm).bpm;
      expect(Math.abs(got - bpm * 2), `${bpm} -> ${got}`).toBeGreaterThan(4);
      expect(Math.abs(got - bpm / 2), `${bpm} -> ${got}`).toBeGreaterThan(4);
    }
  });

  it('holds the predicted grid close to the real one', () => {
    const errs = TEMPOS.map((b) => at(b).phaseMs);
    const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
    // measured ~7ms; on the visual analyser's 0.82 it sat at ~38ms
    expect(mean).toBeLessThan(20);
  });

  it('locks within a few seconds', () => {
    for (const bpm of [96, 128, 160]) {
      expect(at(bpm).lockSec).toBeLessThan(6);
    }
  });

  it('reports real confidence once locked', () => {
    expect(at(128).confidence).toBeGreaterThan(0.5);
  });
});

describe('the smoothing the beat analyser is fixed at', () => {
  /* Beat detection used to read the visual analyser, so the Smoothing
     slider silently retuned it. This is the measurement that justified
     giving it one of its own. A subset of tempos keeps the runtime sane. */
  const SUBSET = [82, 96, 124, 132, 152, 168];

  it('beats the visual analyser default across the tempo range', () => {
    const score = (sm) =>
      SUBSET.filter((b) => at(b, { smoothing: sm, seconds: 22 }).err <= 2).length;
    expect(score(BEAT_SMOOTHING)).toBeGreaterThan(score(0.82));
  });

  it('is the value the engine actually configures', () => {
    expect(BEAT_SMOOTHING).toBe(0.9);
  });
});

describe('output latency compensation', () => {
  it('keeps the grid aligned to what is heard, not what the graph holds', () => {
    // uncompensated, 120ms of output latency puts every flash 120ms early
    const r = at(128, { latency: 0.12 });
    expect(r.err).toBeLessThanOrEqual(2);
    expect(r.phaseMs).toBeLessThan(25);
  });

  it('delays the pulse until the listener reaches the onset', () => {
    const tr = new BeatTracker();
    const loud = new Uint8Array(BINS).fill(200);
    const quiet = new Uint8Array(BINS).fill(10);
    tr.process(quiet, 0, 0.1);
    tr.process(quiet, 0.2, 0.1);
    tr.process(loud, 0.4, 0.1);        // onset at graph time 0.4
    expect(tr.pulse, 'fired before it was audible').toBe(0);
    tr.process(loud, 0.52, 0.1);       // heard time 0.42 >= 0.4
    expect(tr.pulse).toBe(1);
  });

  it('fires immediately when there is no latency to wait out', () => {
    const tr = new BeatTracker();
    const loud = new Uint8Array(BINS).fill(200);
    const quiet = new Uint8Array(BINS).fill(10);
    tr.process(quiet, 0, 0);
    tr.process(quiet, 0.2, 0);
    tr.process(loud, 0.4, 0);
    expect(tr.pulse).toBe(1);
  });

  it('ignores a nonsense latency rather than shifting the grid by it', () => {
    expect(at(128, { latency: 99 }).err).toBeLessThanOrEqual(2);
  });
});
