/**
 * Analysis-frame sanitising.
 *
 * A single non-finite value used to be fatal and permanent. NaN entering a
 * smoothed band means `lerp(sm.x, NaN, k)` is NaN, and stays NaN for every
 * frame afterwards — so one bad analysis frame killed the visualiser until
 * reload, with the failure surfacing far away as
 * "createRadialGradient: The provided double value is non-finite" or a
 * colour string of `rgba(138, 43, 226, NaN)`. Eight of the 22 modes threw
 * on a NaN frame, and the poisoning made the other fourteen follow.
 *
 * This is the one boundary every mode reads through, so clamping here fixes
 * all of them at once rather than guarding hundreds of call sites.
 *
 * Values are clamped, not just made finite: a level of 1e9 or -5 produces
 * geometry that is technically drawable but wildly out of range, which is
 * how Kaleidoscope managed to throw on a finite input.
 */

const num = (v, max = 1) => {
  // Infinity is treated as no signal, not as full scale: an infinite level
  // means the arithmetic upstream broke, not that the music got loud.
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > max ? max : v;
};

/** Zeroed frame, returned for a missing or unusable input. */
export const SILENT_LEVELS = Object.freeze({
  bass: 0, mid: 0, high: 0, level: 0,
  beatPulse: 0, beatPhase: 0, bpm: 0, beatConfidence: 0,
});

/**
 * @param {object|null|undefined} levels raw analysis frame
 * @returns {object} every field finite and in range
 */
export function sanitizeLevels(levels) {
  if (!levels || typeof levels !== 'object') return SILENT_LEVELS;
  return {
    bass: num(levels.bass),
    mid: num(levels.mid),
    high: num(levels.high),
    level: num(levels.level),
    beatPulse: num(levels.beatPulse),
    beatPhase: num(levels.beatPhase),
    // a tempo outside the tracker's own range is not a tempo
    bpm: num(levels.bpm, 400),
    beatConfidence: num(levels.beatConfidence),
    chop: !!levels.chop,
  };
}

/**
 * True when a spectrum can actually be sampled. Four modes indexed into an
 * empty array and produced NaN geometry from it.
 */
export function usableSpectrum(freq) {
  return !!freq && freq.length > 0;
}
