// @ts-check
import { FFT } from './fft.js';
import { BeatTracker, BEAT_SMOOTHING } from './beattracker.js';

/**
 * Offline tempo analysis.
 *
 * The live beat tracker converges over the first few seconds of playback.
 * This analyses a whole decoded track ahead of time — in a Web Worker via
 * `analyzeTempoAsync` — so the BPM readout can be primed immediately and
 * the heavy FFT work never touches the main thread.
 *
 * The spectra are produced the way the engine's beat AnalyserNode produces
 * them — Blackman window, magnitude / fftSize, BEAT_SMOOTHING temporal
 * smoothing, -95..-15 dB range, ~60 frames per second — so the BeatTracker
 * sees the input it was tuned on. Skipping the window and the smoothing
 * (as this once did) leaks every kick across the whole spectrum and fires
 * onsets off the grid: a 120 BPM loop read as 130, an 80 BPM one as 143.
 */

/**
 * Analyse a mono signal and return the tempo the tracker settles on.
 *
 * @param {Float32Array | Float64Array} samples mono samples
 * @param {number} sampleRate
 * @param {{ fftSize?: number, hop?: number, minDb?: number, maxDb?: number, smoothing?: number }} [opts]
 * @returns {{ bpm: number, confidence: number }}
 */
export function analyzeTempo(samples, sampleRate, opts = {}) {
  const {
    fftSize = 2048,
    hop = Math.max(256, Math.round(sampleRate / 60)),
    minDb = -95,
    maxDb = -15,
    smoothing = BEAT_SMOOTHING,
  } = opts;
  if (!samples || !sampleRate || samples.length < fftSize) return { bpm: 0, confidence: 0 };

  const fft = new FFT(fftSize);
  const tracker = new BeatTracker();
  const bins = fftSize >> 1;
  const spectrum = new Uint8Array(bins);
  const smoothed = new Float64Array(bins);
  const frame = new Float64Array(fftSize);
  const window = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    const x = (2 * Math.PI * i) / fftSize;
    window[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
  }
  const scale = 255 / (maxDb - minDb);
  /** @type {number[]} */
  const locks = [];
  let bestConfidence = 0;

  for (let off = 0; off + fftSize <= samples.length; off += hop) {
    for (let i = 0; i < fftSize; i++) frame[i] = samples[off + i] * window[i];
    const mags = fft.magnitudes(frame);
    for (let i = 0; i < bins; i++) {
      smoothed[i] = smoothing * smoothed[i] + (1 - smoothing) * (mags[i] / fftSize);
      const db = 20 * Math.log10(smoothed[i] + 1e-12);
      const norm = (db - minDb) * scale;
      spectrum[i] = norm <= 0 ? 0 : norm >= 255 ? 255 : Math.floor(norm);
    }
    tracker.process(spectrum, (off + fftSize) / sampleRate);
    if (tracker.bpm > 0 && tracker.confidence >= 0.7) locks.push(tracker.bpm);
    bestConfidence = Math.max(bestConfidence, tracker.confidence);
  }
  if (!locks.length) return { bpm: tracker.bpm, confidence: tracker.confidence };
  /* The first lock is formed from a handful of intervals and can sit a
     cluster off; the median over the whole track is what the tracker
     spends the song on. */
  locks.sort((a, b) => a - b);
  return { bpm: locks[locks.length >> 1], confidence: bestConfidence };
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
