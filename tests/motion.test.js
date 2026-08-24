/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Install a matchMedia stub that reports the given reduced-motion state. */
function stubMatchMedia(matches, { withListeners = true } = {}) {
  const listeners = new Set();
  const mq = {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: withListeners ? (_, fn) => listeners.add(fn) : undefined,
    removeEventListener: withListeners ? (_, fn) => listeners.delete(fn) : undefined,
  };
  window.matchMedia = () => mq;
  return {
    mq,
    fire(next) { mq.matches = next; listeners.forEach((fn) => fn({ matches: next })); },
    count: () => listeners.size,
  };
}

const fresh = async () => {
  vi.resetModules();
  return import('../src/motion.js');
};

describe('prefersReducedMotion', () => {
  beforeEach(() => { delete window.matchMedia; });

  it('is false when the user has expressed no preference', async () => {
    stubMatchMedia(false);
    const { prefersReducedMotion } = await fresh();
    expect(prefersReducedMotion()).toBe(false);
  });

  it('is true when reduced motion is requested', async () => {
    stubMatchMedia(true);
    const { prefersReducedMotion } = await fresh();
    expect(prefersReducedMotion()).toBe(true);
  });

  it('reads the preference live, so a system change needs no reload', async () => {
    const h = stubMatchMedia(false);
    const { prefersReducedMotion } = await fresh();
    expect(prefersReducedMotion()).toBe(false);
    h.mq.matches = true;
    expect(prefersReducedMotion()).toBe(true);
  });

  it('defaults to full motion where matchMedia is missing', async () => {
    delete window.matchMedia;
    const { prefersReducedMotion, motionScale } = await fresh();
    expect(prefersReducedMotion()).toBe(false);
    expect(motionScale()).toBe(1);
  });

  it('survives a matchMedia that throws', async () => {
    window.matchMedia = () => { throw new Error('nope'); };
    const { motionScale } = await fresh();
    expect(motionScale()).toBe(1);
  });
});

describe('motionScale', () => {
  beforeEach(() => { delete window.matchMedia; });

  it('is 1 normally and 0 under reduced motion', async () => {
    stubMatchMedia(false);
    expect((await fresh()).motionScale()).toBe(1);
    stubMatchMedia(true);
    expect((await fresh()).motionScale()).toBe(0);
  });

  it('multiplies camera effects cleanly to nothing', async () => {
    stubMatchMedia(true);
    const { motionScale } = await fresh();
    const beat = 0.9;
    expect(1 + beat * 0.012 * motionScale()).toBe(1);   // zoom collapses to identity
    expect(beat * motionScale()).toBe(0);               // aberration term vanishes
  });
});

describe('onMotionPreferenceChange', () => {
  beforeEach(() => { delete window.matchMedia; });

  it('notifies on change and unsubscribes cleanly', async () => {
    const h = stubMatchMedia(false);
    const { onMotionPreferenceChange } = await fresh();
    const seen = [];
    const off = onMotionPreferenceChange((v) => seen.push(v));
    h.fire(true);
    h.fire(false);
    expect(seen).toEqual([true, false]);
    off();
    expect(h.count()).toBe(0);
    h.fire(true);
    expect(seen).toEqual([true, false]);
  });

  it('returns a no-op unsubscribe where listeners are unsupported', async () => {
    stubMatchMedia(false, { withListeners: false });
    const { onMotionPreferenceChange } = await fresh();
    expect(() => onMotionPreferenceChange(() => {})()).not.toThrow();
  });
});
