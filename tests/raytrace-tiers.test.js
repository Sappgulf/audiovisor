import { describe, it, expect } from 'vitest';
import {
  TIERS, CLIMB_STREAK, FAST_WINDOW, OVER_BUDGET, HEALTHY, SEVERE,
  MOBILE_START_TIER, DESKTOP_START_TIER, initialTier, climbCeiling, nextTier, shouldEvaluate,
} from '../src/adaptive.js';

/* Environments a touch device can report. A phone without deviceMemory (iOS),
   a phone with more cores, a tablet at its full width, and a touch laptop. */
const TOUCH_ENVS = [
  { name: 'iPhone, no memory or core hints', env: { navigator: {}, matchMedia: () => ({ matches: true }), screenWidth: 390 } },
  { name: 'phone with 8 cores', env: { navigator: { hardwareConcurrency: 8 }, matchMedia: () => ({ matches: true }), screenWidth: 412 } },
  { name: 'tablet at 1024px, 8GB', env: { navigator: { deviceMemory: 8, hardwareConcurrency: 8 }, matchMedia: () => ({ matches: true }), screenWidth: 1024 } },
  { name: 'touch laptop at 1440px', env: { navigator: { deviceMemory: 8, hardwareConcurrency: 8 }, matchMedia: () => ({ matches: true }), screenWidth: 1440 } },
];

const BASE = 16.7;
const idx = (t) => TIERS.indexOf(t);

describe('rule 1: touch devices never start at the highest tier', () => {
  it('the automatic start tier sits below the top tier', () => {
    expect(idx(MOBILE_START_TIER)).toBeLessThan(TIERS.length - 1);
    expect(idx(DESKTOP_START_TIER)).toBeLessThan(TIERS.length - 1);
  });

  for (const { name, env } of TOUCH_ENVS) {
    it(`${name}: no ceiling starts at the top tier`, () => {
      for (const ceiling of TIERS) {
        const start = initialTier(ceiling, env);
        expect(start, `ceiling ${ceiling}`).not.toBe(TIERS[TIERS.length - 1]);
        expect(idx(start)).toBeLessThanOrEqual(idx(ceiling));
      }
    });

    it(`${name}: the automatic climb never reaches the top tier unless chosen by hand`, () => {
      for (const ceiling of TIERS) {
        expect(idx(climbCeiling(ceiling, false))).toBeLessThan(TIERS.length - 1);
      }
    });
  }

  it('a phone-sized touch screen starts at the low tier', () => {
    expect(initialTier('ultra', TOUCH_ENVS[0].env)).toBe(MOBILE_START_TIER);
  });
});

describe('rule 2: the tier steps down quickly and climbs back slowly', () => {
  it('one window over budget steps down one tier at once', () => {
    const r = nextTier('high', BASE * (OVER_BUDGET + 0.05), 'ultra', BASE, 0);
    expect(r.tier).toBe('medium');
  });

  it('a window at severe cost steps down two tiers at once', () => {
    const r = nextTier('ultra', BASE * (SEVERE + 0.5), 'ultra', BASE, 0);
    expect(r.tier).toBe('medium');
  });

  it('a severe run of frames is judged after FAST_WINDOW samples, not a full window', () => {
    const severe = Array(FAST_WINDOW).fill(BASE * (SEVERE + 1));
    expect(shouldEvaluate(severe, BASE)).toBe(true);
    expect(shouldEvaluate([...severe.slice(1), BASE], BASE)).toBe(false);
  });

  it('a climb needs CLIMB_STREAK healthy windows in a row', () => {
    let tier = 'low', streak = 0;
    for (let i = 1; i < CLIMB_STREAK; i++) {
      ({ tier, streak } = nextTier(tier, BASE, 'ultra', BASE, streak));
      expect(tier, `window ${i}`).toBe('low');
    }
    ({ tier, streak } = nextTier(tier, BASE, 'ultra', BASE, streak));
    expect(tier).toBe('medium');
    expect(streak).toBe(0);
  });

  it('a window between healthy and over budget holds the tier and does not count toward a climb', () => {
    const mid = BASE * ((HEALTHY + OVER_BUDGET) / 2);
    const r = nextTier('medium', mid, 'ultra', BASE, 3);
    expect(r.tier).toBe('medium');
    expect(r.streak).toBe(0);
  });

  it('after a step down the climb back takes twice the usual run of healthy windows', () => {
    let { tier, streak } = nextTier('high', BASE * (OVER_BUDGET + 0.05), 'ultra', BASE, 0);
    expect(tier).toBe('medium');
    let windows = 0;
    while (tier === 'medium' && windows < 100) {
      ({ tier, streak } = nextTier(tier, BASE, 'ultra', BASE, streak));
      windows++;
    }
    expect(tier).toBe('high');
    expect(windows).toBe(2 * CLIMB_STREAK);
  });

  it('a climb never passes the ceiling the user chose', () => {
    let tier = 'medium', streak = 0;
    for (let i = 0; i < 50; i++) ({ tier, streak } = nextTier(tier, BASE, 'medium', BASE, streak));
    expect(tier).toBe('medium');
  });
});
