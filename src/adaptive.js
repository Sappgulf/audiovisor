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

/**
 * Human-facing description of each tier. The raytrace stage owns the real
 * numbers (src/raystage.js QUALITY); this is the copy the settings panel
 * shows, kept next to TIERS so the list cannot drift from the cycle order.
 */
export const TIER_INFO = {
  low: { label: 'Low', blurb: 'Half-resolution, no reflections — phones and integrated GPUs.' },
  medium: { label: 'Medium', blurb: '0.7x resolution with reflections — a safe desktop default.' },
  high: { label: 'High', blurb: '0.8x resolution, 2 samples per pixel — balanced quality.' },
  ultra: { label: 'Ultra', blurb: 'Full resolution, 4 samples per pixel — discrete GPUs.' },
};

export const WINDOW = 20;
export const FAST_WINDOW = 4;

/** Frame interval treated as the display's natural pace when unknown. */
export const DEFAULT_BASELINE_MS = 16.7;
/**
 * Over this multiple of baseline, step down.
 * Was 1.6 — but a stage alternating 16.7ms and 33ms frames averages ~22ms
 * (1.3x), which is a visible 45fps judder that sat under the line forever.
 * 1.2 catches it; HEALTHY below stays under this so the bands never overlap.
 */
export const OVER_BUDGET = 1.2;
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
export const HEALTHY = 1.1;
/** Consecutive healthy windows required before stepping up. */
/* Was 3 (one second at 60Hz). Each climb that fails costs about half a
   second of judder, and the step up is often 2-3x the frame cost, so ask for
   a longer clean run before trying. */
export const CLIMB_STREAK = 6;

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
  /* The window's 25th percentile, not its minimum. A frame that lands early
     to catch up after a stall (8ms on a 60Hz panel) is not the display's
     pace, and taking the minimum let one such frame pin the baseline to
     120Hz: every on-time frame then read 2x over budget and a real M1 at a
     steady 60fps was stepped down to low on every mode. */
  const valid = [];
  for (const ms of samples) {
    // discard sub-millisecond noise and absurd gaps like a tab restore
    if (Number.isFinite(ms) && ms > 4 && ms < 200) valid.push(ms);
  }
  const prev = Number.isFinite(previous) ? previous : null;
  if (valid.length < 8) return prev;
  valid.sort((x, y) => x - y);
  const p25 = valid[Math.floor(valid.length * 0.25)];
  const est = prev == null ? p25 : Math.min(prev, p25);
  return Math.min(Math.max(est, 6), 40);
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
/**
 * The figure a window is judged on: its average, unless it is judder.
 * The mean excludes the single worst frame. A mode running just over budget renders most frames on time and drops
 * every seventh or eighth — measured on Particle Field at medium, one 33ms
 * frame in eight. That averages ~1.15x, under OVER_BUDGET, yet reads as a
 * steady stutter. A window where at least a tenth of the frames missed a
 * whole refresh is treated as over budget whatever its mean.
 * @param {number[]} samples frame intervals in ms
 * @param {number} baseline the display's natural interval
 */
export function windowCost(samples, baseline = DEFAULT_BASELINE_MS) {
  if (!samples.length) return NaN;
  let sum = 0, dropped = 0, worst = 0;
  for (const ms of samples) {
    sum += ms;
    if (ms > worst) worst = ms;
    if (ms > baseline * 1.5) dropped++;
  }
  /* the single worst frame is left out of the mean: one isolated hitch (a
     GC pause, a decode, a compositor stall) in a window of on-time frames
     pushed a steady 60fps stage to 25ms and cost it a tier. Repeated drops
     are what the judder rule below is for. */
  const avg = samples.length > 4 ? (sum - worst) / (samples.length - 1) : sum / samples.length;
  return dropped / samples.length >= 0.1 ? Math.max(avg, baseline * OVER_BUDGET * 1.01) : avg;
}

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
 * Desktops start one step under the default ceiling too. At Retina sizes
 * 'high' (2 spp, 1.1M px) measured ~3x the frame cost of 'medium' on an M1,
 * putting the heavy scenes at 20-50ms — a stutter for the seconds it took
 * the sampler to step down. Starting here and climbing when frames are
 * clean gets the same ceiling without the janky first impression.
 */
export const DESKTOP_START_TIER = 'medium';

/**
 * The highest tier the adaptive loop will climb to on its own. vsync hides
 * spare capacity, so a climb is a guess — and medium to high is a 2-3x cost
 * step on Retina. Measured on an M1, the guess failed on most modes and each
 * failure cost ~0.5s of 30fps judder plus a 100ms+ frame while the GPU
 * drained the heavier tier. A tier chosen by hand is still applied directly.
 */
export const AUTO_CLIMB_MAX = 'medium';

/**
 * The ceiling the adaptive loop may climb to.
 * @param {string} chosen the user's quality setting
 * @param {boolean} explicit whether it was picked by hand this session
 */
export function climbCeiling(chosen, explicit) {
  if (explicit) return chosen;
  return TIERS.indexOf(chosen) < TIERS.indexOf(AUTO_CLIMB_MAX) ? chosen : AUTO_CLIMB_MAX;
}

/**
 * @param {string} ceiling the tier the user asked for
 * @param {object} env injectable for tests
 * @returns {string} the tier to start at, never above the ceiling
 */
export function initialTier(ceiling, env = {}) {
  const idx = TIERS.indexOf(ceiling);
  if (idx < 0) return TIERS[TIERS.length - 2] || 'high';
  const start = TIERS.indexOf(isLowPowerDevice(env) ? MOBILE_START_TIER : DESKTOP_START_TIER);
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
