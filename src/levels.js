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
  drop: 0, width: 0,
});

/**
 * @param {object|null|undefined} levels raw analysis frame
 * @param {object} [out] optional scratch object to write into — the render
 *   loop calls this 60+ times a second and per-caller reuse keeps that
 *   allocation-free; omit it (tests, one-off callers) to get a fresh object
 * @returns {object} every field finite and in range
 */
export function sanitizeLevels(levels, out) {
  if (!levels || typeof levels !== 'object') return SILENT_LEVELS;
  const o = out || {};
  o.bass = num(levels.bass);
  o.mid = num(levels.mid);
  o.high = num(levels.high);
  o.level = num(levels.level);
  o.beatPulse = num(levels.beatPulse);
  o.beatPhase = num(levels.beatPhase);
  // a tempo outside the tracker's own range is not a tempo
  o.bpm = num(levels.bpm, 400);
  o.beatConfidence = num(levels.beatConfidence);
  o.drop = num(levels.drop);
  o.width = num(levels.width);
  o.chop = !!levels.chop;
  return o;
}

/**
 * True when a spectrum can actually be sampled. Four modes indexed into an
 * empty array and produced NaN geometry from it.
 */
export function usableSpectrum(freq) {
  return !!freq && freq.length > 0;
}

/**
 * A canvas dimension that is safe to build a framebuffer from.
 *
 * Math.max propagates NaN, so `Math.max(1, Math.round(NaN))` is NaN, not 1.
 * That NaN reached canvas.width, which coerces to 0, and every later draw
 * targeted a zero-size framebuffer — on the raytraced stage that surfaced
 * as a persistent GL_INVALID_FRAMEBUFFER_OPERATION rather than anything
 * visible. Same trap as the beat accumulator.
 */
export function safeDimension(v, min = 1, max = 16384) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return min;
  const n = Math.round(v);
  return n < min ? min : n > max ? max : n;
}
