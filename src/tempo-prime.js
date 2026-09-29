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
  let lastBuffer = null;
  let lastBpm = 0;

  function sync() {
    if (engine.activeInput !== 'track' || engine.mode !== 'file' || !engine.buffer || !engine.track) {
      state.analyzedBpm = 0;
      return;
    }
    const buffer = engine.buffer;
    if (buffer === lastBuffer) {
      state.analyzedBpm = lastBpm;
      return;
    }
    lastBuffer = buffer;
    lastBpm = 0;
    state.analyzedBpm = 0;
    analyzeTempoAsync(buffer.getChannelData(0), buffer.sampleRate)
      .then(({ bpm, confidence }) => {
        // A queue change can keep the source type at "file"; an older
        // analysis must never overwrite the currently selected track.
        if (lastBuffer !== buffer) return;
        if (bpm > 0 && confidence > 0.2) lastBpm = bpm;
        if (engine.activeInput === 'track' && engine.mode === 'file' && engine.buffer === buffer) {
          state.analyzedBpm = lastBpm;
        }
      })
      .catch(() => {});
  }

  engine.on('source', sync);
  engine.on('state', sync);

  return { reset: () => { lastBuffer = null; lastBpm = state.analyzedBpm = 0; } };
}
