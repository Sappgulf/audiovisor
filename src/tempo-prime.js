// @ts-check
import { analyzeTempoAsync } from './tempo-analysis.js';

/**
 * Prime the BPM readout from an offline analysis of the decoded track.
 *
 * The live beat tracker converges over the first few seconds; this runs the
 * same tracker over the whole file in a worker as soon as a local track is
 * loaded, so the readout is populated immediately. The live lock always
 * wins once it has confidence — this is only a head start.
 *
 * @param {object} deps
 * @param {any} deps.engine
 * @param {any} deps.state
 */
export function createTempoPrime({ engine, state }) {
  let lastKey = null;

  engine.on('source', () => {
    if (engine.mode !== 'file' || !engine.buffer || !engine.track) return;
    const buffer = engine.buffer;
    const key = `${engine.track.name}:${buffer.length}`;
    if (key === lastKey) return;
    lastKey = key;
    state.analyzedBpm = 0;
    analyzeTempoAsync(buffer.getChannelData(0), buffer.sampleRate)
      .then(({ bpm, confidence }) => {
        // only apply if the same track is still loaded
        const stillCurrent = engine.buffer === buffer && engine.track
          && `${engine.track.name}:${engine.buffer.length}` === key;
        if (stillCurrent && bpm > 0 && confidence > 0.2) state.analyzedBpm = bpm;
      })
      .catch(() => {});
  });

  return { reset: () => { lastKey = null; state.analyzedBpm = 0; } };
}
