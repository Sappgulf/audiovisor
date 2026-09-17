// @ts-check
import { FFT } from './fft.js';
import { BeatTracker } from './beattracker.js';

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
  let best = { bpm: 0, confidence: 0 };

  for (let off = 0; off + fftSize <= samples.length; off += hop) {
    const mags = fft.magnitudes(samples.subarray(off, off + fftSize));
    for (let i = 0; i < bins; i++) {
      const amp = mags[i] / bins;
      const db = 20 * Math.log10(amp + 1e-9);
      const norm = (db - minDb) * scale;
      spectrum[i] = norm <= 0 ? 0 : norm >= 255 ? 255 : Math.round(norm);
    }
    tracker.process(spectrum, off / sampleRate);
    if (tracker.confidence > best.confidence) {
      best = { bpm: tracker.bpm, confidence: tracker.confidence };
    }
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
