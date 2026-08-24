import { clamp } from './utils.js';

/**
 * The single "beat energy" value every mode animates against.
 *
 * Modes only ever saw the onset pulse, so motion reacted to detected hits
 * and nothing else — beatPhase was computed, exposed, and then used by
 * almost nothing. Two consequences: a missed onset dropped a beat out of
 * the visuals entirely, and nothing moved *on* the grid between hits, so
 * the picture followed the music instead of keeping time with it.
 *
 * Energy is now the strongest of three sources:
 *
 *   pulse    the detected onset — impact, and always the loudest term
 *   grid     a tempo-locked envelope that peaks on the downbeat and decays
 *            across the beat, so the pulse keeps time through a missed hit
 *   decay    the tail of whatever came before
 *
 * The grid term is scaled by tracker confidence and capped below a real
 * onset, so on unlocked or arrhythmic audio this behaves exactly as it did
 * before and detected hits always dominate.
 */

/** Below this confidence the grid term stays off entirely. */
export const GRID_MIN_CONFIDENCE = 0.35;
/** Ceiling for the grid term, so a real onset always reads louder. */
export const GRID_MAX = 0.72;
/** Higher = tighter peak on the downbeat. */
const GRID_SHARPNESS = 2.4;

/**
 * @param {number} prev previous energy
 * @param {object|null} levels analysis frame
 * @param {number} dt seconds since the last frame
 * @param {number} decay per-60Hz-frame decay factor
 */
export function beatEnergy(prev, levels, dt, decay = 0.86) {
  const tail = (prev || 0) * Math.pow(decay, dt * 60);
  if (!levels) return tail;

  const pulse = levels.beatPulse != null ? levels.beatPulse : 0;

  let grid = 0;
  const bpm = levels.bpm || 0;
  const conf = clamp(levels.beatConfidence || 0, 0, 1);
  if (bpm > 0 && conf >= GRID_MIN_CONFIDENCE) {
    const phase = clamp(levels.beatPhase || 0, 0, 1);
    grid = Math.pow(1 - phase, GRID_SHARPNESS) * conf * GRID_MAX;
  }

  return Math.max(pulse, grid, tail);
}
