import { describe, it, expect } from 'vitest';
import {
  SETTINGS_KEY, LEGACY_SETTINGS_KEY, SETTINGS_VERSION,
  serializeSettings, validateSettings, readSettings,
} from '../src/settings.js';

const VOCAB = {
  modeIds: ['bars', 'tunnel', 'gpu'],
  themeIds: ['brass', 'ice'],
  sliderIds: ['sensitivity', 'bass-focus', 'smoothing', 'color-pop', 'bloom'],
  fxNames: ['reverb', 'limiter', 'chop'],
  rayQualities: ['low', 'medium', 'high', 'ultra'],
  eqBands: 5,
};

const memStore = (init = {}) => {
  const map = new Map(Object.entries(init));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
  };
};

describe('serializeSettings', () => {
  it('stamps the schema version and normalizes flags to booleans', () => {
    const out = serializeSettings({
      mode: 'bars', theme: 'ice', autopilot: 1, raytrace: 0,
      rayQuality: 'high', fx: { reverb: true }, sliders: { bloom: 0.4 },
      volume: 0.5, loop: undefined, autoDj: 'yes',
    });
    expect(out.version).toBe(SETTINGS_VERSION);
    expect(out.autopilot).toBe(true);
    expect(out.raytrace).toBe(false);
    expect(out.loop).toBe(false);
    expect(out.autoDj).toBe(true);
  });

  it('copies fx and sliders instead of aliasing live state', () => {
    const fx = { reverb: true };
    const out = serializeSettings({ fx, sliders: {} });
    fx.reverb = false;
    expect(out.fx.reverb).toBe(true);
  });

  it('round-trips through validateSettings', () => {
    const src = {
      mode: 'tunnel', theme: 'brass', autopilot: true, raytrace: true,
      rayQuality: 'ultra', fx: { reverb: true, limiter: false, chop: true },
      sliders: { sensitivity: 1.4, bloom: 0.5 },
      eq: [0, 3, -2, 0, 1], volume: 0.75, loop: true, autoDj: false,
    };
    const back = validateSettings(serializeSettings(src), VOCAB);
    expect(back).toMatchObject({
      mode: 'tunnel', theme: 'brass', rayQuality: 'ultra',
      volume: 0.75, loop: true, autopilot: true, raytrace: true,
    });
    expect(back.fx).toEqual({ reverb: true, limiter: false, chop: true });
    expect(back.eq).toEqual([0, 3, -2, 0, 1]);
  });
});

describe('validateSettings', () => {
  it('returns an empty object for non-objects', () => {
    for (const bad of [null, undefined, 'x', 42, true]) {
      expect(validateSettings(bad, VOCAB)).toEqual({});
    }
  });

  it('drops mode and theme ids this build does not have', () => {
    const out = validateSettings({ mode: 'no-such-mode', theme: 'chartreuse' }, VOCAB);
    expect(out.mode).toBeUndefined();
    expect(out.theme).toBeUndefined();
  });

  it('drops unknown fx names and non-boolean fx values', () => {
    const out = validateSettings(
      { fx: { reverb: true, bogus: true, limiter: 'on' } }, VOCAB,
    );
    expect(out.fx).toEqual({ reverb: true });
  });

  it('drops unknown slider ids and coerces numeric strings', () => {
    const out = validateSettings(
      { sliders: { sensitivity: '1.8', nope: 3, bloom: NaN } }, VOCAB,
    );
    expect(out.sliders).toEqual({ sensitivity: 1.8 });
  });

  it('clamps volume into 0..1 and rejects non-finite', () => {
    expect(validateSettings({ volume: 4 }, VOCAB).volume).toBe(1);
    expect(validateSettings({ volume: -2 }, VOCAB).volume).toBe(0);
    expect(validateSettings({ volume: NaN }, VOCAB).volume).toBeUndefined();
    expect(validateSettings({ volume: '0.5' }, VOCAB).volume).toBeUndefined();
  });

  it('clamps eq gains to the UI range and truncates extra bands', () => {
    const out = validateSettings({ eq: [99, -99, 'x', 0, 2, 7, 7] }, VOCAB);
    expect(out.eq).toEqual([12, -12, 0, 0, 2]);
  });

  it('rejects an unknown raytrace quality', () => {
    expect(validateSettings({ rayQuality: 'insane' }, VOCAB).rayQuality).toBeUndefined();
    expect(validateSettings({ rayQuality: 'low' }, VOCAB).rayQuality).toBe('low');
  });

  it('omits keys that are absent rather than filling defaults', () => {
    expect(validateSettings({ mode: 'bars' }, VOCAB)).toEqual({ mode: 'bars' });
  });
});

describe('readSettings', () => {
  it('returns {} when storage is empty', () => {
    expect(readSettings(memStore(), VOCAB)).toEqual({});
  });

  it('returns {} on corrupt JSON instead of throwing', () => {
    expect(readSettings(memStore({ [SETTINGS_KEY]: '{not json' }), VOCAB)).toEqual({});
  });

  it('falls back to the v1 key when v2 is missing', () => {
    const store = memStore({ [LEGACY_SETTINGS_KEY]: JSON.stringify({ mode: 'gpu' }) });
    expect(readSettings(store, VOCAB).mode).toBe('gpu');
  });

  it('prefers v2 over the legacy key', () => {
    const store = memStore({
      [SETTINGS_KEY]: JSON.stringify({ mode: 'bars' }),
      [LEGACY_SETTINGS_KEY]: JSON.stringify({ mode: 'gpu' }),
    });
    expect(readSettings(store, VOCAB).mode).toBe('bars');
  });

  it('survives storage that throws (Safari private mode)', () => {
    const hostile = { getItem() { throw new Error('SecurityError'); } };
    expect(readSettings(hostile, VOCAB)).toEqual({});
  });
});
