/**
 * Look presets. These are the three chips that recall a saved mode/theme/fx
 * combination; the rules here decide what a stored slot is allowed to do to
 * the running app, so they get the same scrutiny as settings.js.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  PRESET_KEY, PRESET_SLOTS, isSlot, validatePreset, readPresets, writePreset,
} from '../src/presets.js';

const VOCAB = {
  modeIds: ['bars', 'tunnel', 'gpu'],
  themeIds: ['brass', 'ice'],
  fxNames: ['reverb', 'limiter', 'chop'],
};

/** In-memory localStorage; `failing` reproduces Safari private browsing. */
function installStorage({ init = {}, failing = false } = {}) {
  const map = new Map(Object.entries(init));
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (failing) throw new DOMException('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
  };
  return map;
}

const stored = (obj) => ({ [PRESET_KEY]: JSON.stringify(obj) });

beforeEach(() => { installStorage(); });

describe('slot identity', () => {
  it('offers exactly three slots', () => {
    expect(PRESET_SLOTS).toEqual([1, 2, 3]);
  });

  it('accepts known slots as numbers or strings', () => {
    expect(isSlot(1)).toBe(true);
    expect(isSlot('3')).toBe(true);
  });

  it('rejects unknown slots', () => {
    expect(isSlot(0)).toBe(false);
    expect(isSlot(4)).toBe(false);
    expect(isSlot('p1')).toBe(false);
    expect(isSlot(undefined)).toBe(false);
  });
});

describe('validatePreset', () => {
  it('passes a well-formed preset through', () => {
    const p = validatePreset({ mode: 'tunnel', theme: 'ice', fx: { reverb: true } }, VOCAB);
    expect(p).toEqual({ mode: 'tunnel', theme: 'ice', fx: { reverb: true } });
  });

  it('drops a mode this build no longer has', () => {
    // the bug this guards: setMode() was handed a removed id and the stage
    // silently kept drawing whatever was already on screen
    const p = validatePreset({ mode: 'holodeck', theme: 'ice' }, VOCAB);
    expect(p.mode).toBeNull();
    expect(p.theme).toBe('ice');
  });

  it('drops an unknown theme', () => {
    const p = validatePreset({ mode: 'bars', theme: 'chartreuse' }, VOCAB);
    expect(p.theme).toBeNull();
    expect(p.mode).toBe('bars');
  });

  it('rejects a preset with neither a usable mode nor theme', () => {
    expect(validatePreset({ mode: 'holodeck', theme: 'chartreuse' }, VOCAB)).toBeNull();
  });

  it('drops fx names outside the vocabulary', () => {
    const p = validatePreset({ mode: 'bars', fx: { reverb: true, wormhole: true } }, VOCAB);
    expect(p.fx).toEqual({ reverb: true });
  });

  it('coerces fx values to booleans', () => {
    const p = validatePreset({ mode: 'bars', fx: { reverb: 1, limiter: 0, chop: 'yes' } }, VOCAB);
    expect(p.fx).toEqual({ reverb: true, limiter: false, chop: true });
  });

  it('tolerates a missing or non-object fx bag', () => {
    expect(validatePreset({ mode: 'bars' }, VOCAB).fx).toEqual({});
    expect(validatePreset({ mode: 'bars', fx: 'nope' }, VOCAB).fx).toEqual({});
    expect(validatePreset({ mode: 'bars', fx: ['reverb'] }, VOCAB).fx).toEqual({});
  });

  it('rejects non-objects outright', () => {
    for (const junk of [null, undefined, 3, 'bars', [], true]) {
      expect(validatePreset(junk, VOCAB)).toBeNull();
    }
  });
});

describe('readPresets', () => {
  it('returns an empty map when nothing is stored', () => {
    expect(readPresets(VOCAB)).toEqual({});
  });

  it('returns an empty map for corrupt JSON', () => {
    installStorage({ init: { [PRESET_KEY]: '{not json' } });
    expect(readPresets(VOCAB)).toEqual({});
  });

  it('returns an empty map when the stored value is an array', () => {
    installStorage({ init: stored([]) });
    expect(readPresets(VOCAB)).toEqual({});
  });

  it('reads back the slots that are valid', () => {
    installStorage({ init: stored({ 1: { mode: 'bars', theme: 'ice', fx: {} }, 2: { mode: 'gpu', theme: 'brass', fx: {} } }) });
    const p = readPresets(VOCAB);
    expect(Object.keys(p)).toEqual(['1', '2']);
    expect(p[1].mode).toBe('bars');
  });

  it('drops a slot that no longer validates instead of surfacing it', () => {
    installStorage({ init: stored({ 1: { mode: 'holodeck', theme: 'chartreuse' }, 2: { mode: 'bars', theme: 'ice' } }) });
    const p = readPresets(VOCAB);
    expect(p[1]).toBeUndefined();
    expect(p[2]).toBeDefined();
  });

  it('ignores keys outside the three slots', () => {
    installStorage({ init: stored({ 1: { mode: 'bars' }, 9: { mode: 'gpu' }, junk: { mode: 'bars' } }) });
    expect(Object.keys(readPresets(VOCAB))).toEqual(['1']);
  });
});

describe('writePreset', () => {
  it('stores a slot and reads it back', () => {
    expect(writePreset(2, { mode: 'gpu', theme: 'ice', fx: { chop: true } }, VOCAB)).toBe(true);
    expect(readPresets(VOCAB)[2]).toEqual({ mode: 'gpu', theme: 'ice', fx: { chop: true } });
  });

  it('leaves the other slots alone', () => {
    writePreset(1, { mode: 'bars', theme: 'ice' }, VOCAB);
    writePreset(3, { mode: 'gpu', theme: 'brass' }, VOCAB);
    const p = readPresets(VOCAB);
    expect(p[1].mode).toBe('bars');
    expect(p[3].mode).toBe('gpu');
  });

  it('overwrites an existing slot', () => {
    writePreset(1, { mode: 'bars', theme: 'ice' }, VOCAB);
    writePreset(1, { mode: 'tunnel', theme: 'brass' }, VOCAB);
    expect(readPresets(VOCAB)[1].mode).toBe('tunnel');
  });

  it('refuses an unknown slot', () => {
    expect(writePreset(7, { mode: 'bars' }, VOCAB)).toBe(false);
    expect(readPresets(VOCAB)).toEqual({});
  });

  it('refuses a preset that does not validate', () => {
    expect(writePreset(1, { mode: 'holodeck' }, VOCAB)).toBe(false);
  });

  it('reports false rather than throwing when storage is full', () => {
    // the chip must not light up for a save that never landed
    installStorage({ failing: true });
    expect(writePreset(1, { mode: 'bars', theme: 'ice' }, VOCAB)).toBe(false);
  });

  it('does not lose good slots when the stored blob is corrupt', () => {
    installStorage({ init: { [PRESET_KEY]: 'garbage' } });
    expect(writePreset(1, { mode: 'bars', theme: 'ice' }, VOCAB)).toBe(true);
    expect(readPresets(VOCAB)[1].mode).toBe('bars');
  });
});
