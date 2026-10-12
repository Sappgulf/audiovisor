// @ts-check
import { analyzeTempo } from './tempo-analysis.js';

/**
 * Worker entry for offline tempo analysis. Receives mono samples (the
 * buffer is transferred, not shared) and posts back `{ bpm, confidence }`.
 */
self.onmessage = (e) => {
  let result = { bpm: 0, confidence: 0 };
  try {
    const { samples, sampleRate } = e.data || {};
    result = analyzeTempo(samples, sampleRate);
  } catch {
    // a malformed message answers with no tempo; the caller is never left waiting
  }
  self.postMessage(result);
};
