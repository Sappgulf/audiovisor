// @ts-check
import { analyzeTempo } from './tempo-analysis.js';

/**
 * Worker entry for offline tempo analysis. Receives mono samples (the
 * buffer is transferred, not shared) and posts back `{ bpm, confidence }`.
 */
self.onmessage = (e) => {
  const { samples, sampleRate } = e.data;
  self.postMessage(analyzeTempo(samples, sampleRate));
};
