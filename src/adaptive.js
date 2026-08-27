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

export const WINDOW = 20;
export const FAST_WINDOW = 4;

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

/**
 * The baseline to judge against, falling back while it is still unknown.
 */
export function baselineOr(estimate) {
  return Number.isFinite(estimate) ? estimate : DEFAULT_BASELINE_MS;
}

/**
 * Let a stale best-case estimate recover toward what the display currently
 * manages.
 *
 * `estimateBaseline` keeps the fastest interval the session has ever seen,
 * which is correct for identifying the refresh pace but has a failure mode:
 * one lucky frame — a moment of driver throttling in the app's favour, a
 * compositor coincidence — permanently pins the estimate below the display's
 * real pace. Every subsequent comfortable frame then reads as OVER_BUDGET
 * against a 6ms line it can never meet, and the tiers grind down for no
 * reason.
 *
 * This nudges the stored estimate 12% of the way toward the slowest recent
 * window's minimum each time it runs, so a genuinely-faster-than-display
 * number drifts up to reality within seconds while a real fast frame (which
 * `estimateBaseline` re-observes continuously) holds the floor down. Called
 * once per evaluated window, not per frame, so the rate is independent of
 * frame timing.
 *
 * @param {number} estimate current baseline estimate, or null
 * @param {number[]} samples the most recent window of frame intervals
 * @returns {number} the relaxed estimate
 */
export function relaxBaseline(estimate, samples) {
  if (!Number.isFinite(estimate)) return estimate;
  let recent = Infinity;
  for (const ms of samples) {
    if (Number.isFinite(ms) && ms > 4 && ms < 200 && ms < recent) recent = ms;
  }
  if (!Number.isFinite(recent)) return Math.min(estimate, 40);
  const moved = estimate + (recent - estimate) * 0.12;
  return Math.min(Math.max(moved, 6), 40);
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
 * Decide the next tier from an evaluated window.
 *
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

/**
 * The tier to begin at, before anything has been measured.
 *
 * Everything used to start at whatever the user had chosen, which on a
 * phone means the raytraced stage opens at `high`. Measured at a phone's
 * stage size (356x539) that is roughly ten times the march work of `low` —
 * 70.7M steps a frame against 6.9M — and on hardware three to eight times
 * slower than the desktop it was tuned on, that lands somewhere between 26
 * and 140ms a frame. The adaptive stepping does rescue it, but only after
 * the viewer has watched it stutter, and a saturated GPU makes the whole
 * interface feel unresponsive while it does.
 *
 * Starting low is not a quality sacrifice now that climbing back works: a
 * device with headroom earns a tier roughly every three clean windows, so a
 * capable tablet reaches its ceiling in a few seconds without ever dropping
 * a frame. A weak phone simply stays where it belongs.
 */
export const MOBILE_START_TIER = 'low';

/**
 * @param {string} ceiling the tier the user asked for
 * @param {object} env injectable for tests
 * @returns {string} the tier to start at, never above the ceiling
 */
export function initialTier(ceiling, env = {}) {
  const idx = TIERS.indexOf(ceiling);
  if (idx < 0) return TIERS[TIERS.length - 2] || 'high';
  if (!isLowPowerDevice(env)) return ceiling;
  const start = TIERS.indexOf(MOBILE_START_TIER);
  return TIERS[Math.min(start, idx)];
}

/**
 * Whether this looks like a device that will struggle at the desktop
 * default. Deliberately errs toward yes: guessing low costs a few seconds
 * of lower quality that the climb undoes, while guessing high costs a
 * visibly janky first impression.
 */
export function isLowPowerDevice(env = {}) {
  const nav = env.navigator ?? (typeof navigator !== 'undefined' ? navigator : undefined);
  const mm = env.matchMedia ?? (typeof window !== 'undefined' ? window.matchMedia : undefined);

  // deviceMemory is absent on iOS entirely, so a low value is a signal but a
  // missing one says nothing
  const mem = nav && typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;
  if (mem !== null && mem <= 4) return true;

  const cores = nav && typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null;
  if (cores !== null && cores <= 4) return true;

  // a touch-first device with a phone-sized screen
  let coarse;
  try { coarse = !!mm && mm('(pointer: coarse)').matches; } catch { coarse = false; }
  const w = env.screenWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1920);
  if (coarse && w <= 900) return true;

  return false;
}
