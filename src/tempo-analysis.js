// @ts-check
import { FFT } from './fft.js';
import { BeatTracker } from './beattracker.js';

/**
 * Strong, repeated bass transients give an independent tempo estimate when
 * spectral-flux onsets are confused by a sustained note. The search runs on
 * the already-computed FFT frames, so it adds little work to the offline pass.
 *
 * @param {Float32Array} energy
 * @param {number} sampleRate
 * @param {number} hop
 * @param {number} minBpm
 * @param {number} maxBpm
 */
function bassPulseTempo(energy, sampleRate, hop, minBpm, maxBpm) {
  const flux = new Float32Array(energy.length);
  for (let i = 1; i < energy.length; i++) {
    flux[i] = Math.max(0, energy[i] - energy[i - 1]);
  }

  let best = { bpm: 0, confidence: 0 };
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.5) {
    const lag = 60 * sampleRate / (bpm * hop);
    const whole = Math.floor(lag);
    const fraction = lag - whole;
    let dot = 0;
    let normNow = 0;
    let normEarlier = 0;
    for (let i = whole + 1; i < flux.length; i++) {
      const now = flux[i];
      const earlier = flux[i - whole] * (1 - fraction)
        + flux[i - whole - 1] * fraction;
      dot += now * earlier;
      normNow += now * now;
      normEarlier += earlier * earlier;
    }
    const confidence = dot / Math.sqrt(normNow * normEarlier || 1);
    if (confidence > best.confidence) best = { bpm, confidence };
  }
  return best;
}

/**
 * Offline tempo analysis.
 *
 * The live beat tracker converges over the first few seconds of playback.
 * This analyses a whole decoded track ahead of time — in a Web Worker via
 * `analyzeTempoAsync` — so the BPM readout can be primed immediately and
 * the heavy FFT work never touches the main thread.
 *
 * The spectra are normalized the same way the engine's AnalyserNode is
 * configured (minDecibels -95, maxDecibels -15), so the existing
 * BeatTracker sees the kind of input it was tuned on.
 */

/**
 * Analyse a mono signal and return the best tempo lock it found.
 *
 * @param {Float32Array | Float64Array} samples mono samples
 * @param {number} sampleRate
 * @param {{ fftSize?: number, hop?: number, minDb?: number, maxDb?: number }} [opts]
 * @returns {{ bpm: number, confidence: number }}
 */
export function analyzeTempo(samples, sampleRate, opts = {}) {
  const { fftSize = 2048, hop = 1024, minDb = -95, maxDb = -15 } = opts;
  if (!samples || !sampleRate || samples.length < fftSize) return { bpm: 0, confidence: 0 };

  const fft = new FFT(fftSize);
  const tracker = new BeatTracker();
  const bins = fftSize >> 1;
  const spectrum = new Uint8Array(bins);
  const scale = 255 / (maxDb - minDb);
  const frames = Math.floor((samples.length - fftSize) / hop) + 1;
  const bassEnergy = new Float32Array(frames);
  const bassStart = Math.max(1, Math.ceil(40 * fftSize / sampleRate));
  const bassEnd = Math.min(bins - 1, Math.floor(190 * fftSize / sampleRate));
  let levelSum = 0;
  let levelSqSum = 0;
  let bassPower = 0;
  let totalPower = 0;
  let best = { bpm: 0, confidence: 0 };

  for (let off = 0, frame = 0; off + fftSize <= samples.length; off += hop, frame++) {
    const window = samples.subarray(off, off + fftSize);
    let level = 0;
    for (let i = 0; i < fftSize; i++) level += window[i] * window[i];
    level /= fftSize;
    levelSum += level;
    levelSqSum += level * level;

    const mags = fft.magnitudes(window);
    let frameBass = 0;
    for (let i = 0; i < bins; i++) {
      const power = mags[i] * mags[i];
      if (i > 0) totalPower += power;
      if (i >= bassStart && i <= bassEnd) frameBass += power;
      const amp = mags[i] / bins;
      const db = 20 * Math.log10(amp + 1e-9);
      const norm = (db - minDb) * scale;
      spectrum[i] = norm <= 0 ? 0 : norm >= 255 ? 255 : Math.round(norm);
    }
    bassEnergy[frame] = frameBass;
    bassPower += frameBass;
    tracker.process(spectrum, off / sampleRate);
    if (tracker.confidence > best.confidence) {
      best = { bpm: tracker.bpm, confidence: tracker.confidence };
    }
  }

  /* A steady note has no beat, yet its FFT-bin leakage changes with window
     phase and can give the flux tracker a confident false tempo. Require real
     changes in short-window signal energy before reporting any offline BPM. */
  const mean = levelSum / frames;
  const variation = mean > 0
    ? Math.sqrt(Math.max(0, levelSqSum / frames - mean * mean)) / mean
    : 0;
  if (variation < 0.05) return { bpm: 0, confidence: 0 };

  /* Prefer the bass pulse only when it has enough musical energy and a
     strong periodic match. Otherwise retain the broad-spectrum tracker for
     songs driven by snares, hats, or vocals. */
  if (frames * hop / sampleRate >= 6 && bassPower / totalPower >= 0.05) {
    const bass = bassPulseTempo(bassEnergy, sampleRate, hop, tracker.minBpm, tracker.maxBpm);
    if (bass.confidence >= 0.7) return bass;
  }
  return best;
}

/**
 * Analyse in a worker, falling back to a synchronous pass when workers are
 * unavailable (Node tests, exotic embeds) or fail to start.
 *
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @returns {Promise<{ bpm: number, confidence: number }>}
 */
export function analyzeTempoAsync(samples, sampleRate) {
  const sync = () => analyzeTempo(samples, sampleRate);
  if (typeof Worker === 'undefined') return Promise.resolve(sync());
  try {
    const worker = new Worker(new URL('./dsp-worker.js', import.meta.url), { type: 'module' });
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (settled) return; settled = true; worker.terminate(); resolve(v); };
      worker.onmessage = (e) => done(e.data);
      worker.onerror = () => done(sync());
      // copy so the engine's buffer is never transferred away
      const copy = samples.slice();
      worker.postMessage({ samples: copy, sampleRate }, [copy.buffer]);
    });
  } catch {
    return Promise.resolve(sync());
  }
}
