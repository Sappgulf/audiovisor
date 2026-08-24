/**
 * Adaptive quality decisions.
 *
 * Two things were wrong with the loop this replaces.
 *
 * It sampled `performance.now() - t0` around the frame body — CPU time
 * inside the animation callback. WebGL commands are queued, not executed,
 * so that figure is ~0.1ms however heavy the scene is. Measured on an M1
 * with Aurora Terrain at the default tier: 0.1ms sampled against a 117.7ms
 * real frame interval. The tier never stepped down, because as far as the
 * sampler could tell nothing was ever slow. GPU-bound cost is the only kind
 * a ray marcher has, so adaptive quality was effectively inert on the
 * raytraced stage.
 *
 * It also waited for a fixed 30 samples, a window whose wall-clock length
 * grows with how slow things are — at 117ms a frame that is 3.5 seconds of
 * stutter before anything happens.
 *
 * So: sample the interval between frames, which is what a viewer actually
 * experiences, and judge it against the fastest interval the session has
 * managed rather than a hardcoded 60Hz assumption — otherwise a 30Hz panel
 * looks permanently over budget and gets downgraded for no reason.
 */

export const TIERS = ['low', 'medium', 'high', 'ultra'];

export const WINDOW = 30;
export const FAST_WINDOW = 6;

/** Frame interval treated as the display's natural pace when unknown. */
export const DEFAULT_BASELINE_MS = 16.7;
/** Over this multiple of baseline, step down. */
export const OVER_BUDGET = 1.6;
/** Over this multiple, step down two tiers and act on the short window. */
export const SEVERE = 3.0;
/**
 * Climbing back up cannot use the same signal.
 *
 * vsync pins a comfortable frame to exactly the refresh interval, so a mode
 * with ten times the headroom measures identically to one that is only just
 * keeping up — the interval can detect slowness but never spare capacity.
 * Instead, a window every sample of which is close to baseline counts as
 * healthy, and a run of them is treated as evidence there is room to try
 * one tier higher. If that turns out to be wrong the step-down path takes
 * it back within about a second.
 */
export const HEALTHY = 1.25;
/** Consecutive healthy windows required before stepping up. */
export const CLIMB_STREAK = 3;

/**
 * The display's natural frame interval, estimated as the fastest interval
 * the session has managed.
 *
 * `previous` starts as null meaning "not yet known" rather than as the 60Hz
 * default. Seeding it with the default would be a floor the estimate could
 * only fall below, so a 30Hz panel would keep the 16.7ms assumption, look
 * permanently 2x over budget, and get downgraded for no reason.
 *
 * Returns null while still unknown; callers substitute the default.
 */
export function estimateBaseline(samples, previous = null) {
  let min = Number.isFinite(previous) ? previous : Infinity;
  for (const ms of samples) {
    // discard sub-millisecond noise and absurd gaps like a tab restore
    if (Number.isFinite(ms) && ms > 4 && ms < 200 && ms < min) min = ms;
  }
  if (!Number.isFinite(min)) return null;
  return Math.min(Math.max(min, 6), 40);
}

/** The baseline to judge against, falling back while it is still unknown. */
export function baselineOr(estimate) {
  return Number.isFinite(estimate) ? estimate : DEFAULT_BASELINE_MS;
}

/** Should this window be judged yet? */
export function shouldEvaluate(samples, baseline = DEFAULT_BASELINE_MS) {
  if (samples.length >= WINDOW) return true;
  if (samples.length < FAST_WINDOW) return false;
  // every sample must be severe, so one GC pause, a cold first frame after
  // a mode change, or the huge gap after a backgrounded tab cannot trigger
  return samples.every((ms) => ms > baseline * SEVERE);
}

/**
 * @param {string} current tier in use
 * @param {number} avgMs mean frame interval over the window
 * @param {string} ceiling the tier the user asked for
 * @param {number} baseline the display's natural interval
 */
/**
 * @param {string} current tier in use
 * @param {number} avgMs mean frame interval over the window
 * @param {string} ceiling the tier the user asked for
 * @param {number} baseline the display's natural interval
 * @param {number} healthyStreak consecutive healthy windows so far
 * @returns {{tier: string, streak: number}} the tier to use and the streak
 *   to carry forward
 */
export function nextTier(current, avgMs, ceiling, baseline = DEFAULT_BASELINE_MS, healthyStreak = 0) {
  const i = TIERS.indexOf(current);
  if (i < 0 || !Number.isFinite(avgMs)) return { tier: current, streak: 0 };
  const max = TIERS.indexOf(ceiling);

  if (avgMs > baseline * SEVERE) return { tier: TIERS[Math.max(0, i - 2)], streak: 0 };
  if (avgMs > baseline * OVER_BUDGET) return { tier: TIERS[Math.max(0, i - 1)], streak: 0 };

  if (avgMs <= baseline * HEALTHY) {
    const streak = healthyStreak + 1;
    if (streak >= CLIMB_STREAK && max >= 0 && i < max) {
      return { tier: TIERS[i + 1], streak: 0 };   // reset, so a climb is earned again
    }
    return { tier: current, streak };
  }
  return { tier: current, streak: 0 };
}

/** Canvas2D has one step rather than four tiers. */
export function next2dQuality(current, avgMs, baseline = DEFAULT_BASELINE_MS) {
  if (!Number.isFinite(avgMs)) return current;
  if (avgMs > baseline * 1.3) return 'low';
  if (avgMs < baseline * 0.85) return 'high';
  return current;
}
