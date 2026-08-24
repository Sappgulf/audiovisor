/**
 * Reduced-motion preference, for the canvas.
 *
 * style.css already collapses CSS animations and transitions under
 * prefers-reduced-motion, but the stage is the largest moving thing in the
 * app and nothing consulted the preference on its way to the canvas. The
 * effects that matter for vestibular comfort are the whole-frame ones —
 * beat zoom, camera shake, chromatic aberration, the glitch slice — rather
 * than the visualisation itself, which is the point of the app and stays.
 *
 * The MediaQueryList is fetched once and then read live, so toggling the
 * system setting takes effect without a reload — but window.matchMedia
 * itself is only consulted once, since re-querying on every frame would put
 * query parsing in the render loop.
 */

const QUERY = '(prefers-reduced-motion: reduce)';

let mq = null;
function query() {
  if (mq === null && typeof window !== 'undefined' && window.matchMedia) {
    try { mq = window.matchMedia(QUERY); } catch { mq = false; }
  }
  return mq || null;
}

/** True when the user has asked for reduced motion. */
export function prefersReducedMotion() {
  return !!query()?.matches;
}

/**
 * Scale factor for whole-frame motion: 1 normally, 0 when reduced motion is
 * requested. Multiply camera-level effects by this rather than branching, so
 * the call sites stay readable.
 */
export function motionScale() {
  return prefersReducedMotion() ? 0 : 1;
}

/** Subscribe to changes; returns an unsubscribe function. */
export function onMotionPreferenceChange(fn) {
  const q = query();
  if (!q?.addEventListener) return () => {};
  const handler = () => fn(q.matches);
  q.addEventListener('change', handler);
  return () => q.removeEventListener('change', handler);
}
