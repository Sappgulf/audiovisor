/**
 * Playback speed and visual sync in the settings schema: what is kept, what is
 * dropped on read, and that both survive a round trip through the serializer.
 */
import { describe, it, expect } from 'vitest';
import {
  SETTINGS_VERSION, SPEEDS, SYNC_LIMIT_MS, serializeSettings, validateSettings,
} from '../src/settings.js';

const VOCAB = {
  modeIds: ['bars'], themeIds: ['brass'], sliderIds: [], fxNames: [],
  rayQualities: ['low'], eqBands: 5,
};

describe('speed', () => {
  it('lists the four speeds the Audio tab offers', () => {
    expect(SPEEDS).toEqual([0.75, 1, 1.25, 1.5]);
  });

  it('keeps each offered speed', () => {
    for (const speed of SPEEDS) {
      expect(validateSettings({ speed }, VOCAB).speed).toBe(speed);
    }
  });

  it('drops any other speed, including numeric strings', () => {
    for (const speed of [0.5, 2, 1.1, '1.25', null, true, NaN, Infinity]) {
      expect(validateSettings({ speed }, VOCAB)).toEqual({});
    }
  });
});

describe('syncOffsetMs', () => {
  it('keeps finite values from -300 to +300 inclusive', () => {
    expect(SYNC_LIMIT_MS).toBe(300);
    for (const syncOffsetMs of [-300, -1, 0, 45, 300]) {
      expect(validateSettings({ syncOffsetMs }, VOCAB).syncOffsetMs).toBe(syncOffsetMs);
    }
  });

  it('drops values outside the range, non-numbers and non-finite numbers', () => {
    for (const syncOffsetMs of [-301, 301, 1e6, '40', null, NaN, Infinity, -Infinity]) {
      expect(validateSettings({ syncOffsetMs }, VOCAB)).toEqual({});
    }
  });
});

describe('persisting the two settings', () => {
  it('serializes speed and syncOffsetMs and reads them back', () => {
    const json = JSON.parse(JSON.stringify(serializeSettings({ speed: 1.5, syncOffsetMs: -80 })));
    expect(json.speed).toBe(1.5);
    expect(json.syncOffsetMs).toBe(-80);
    expect(validateSettings(json, VOCAB)).toMatchObject({ speed: 1.5, syncOffsetMs: -80 });
  });

  it('omits both when the engine has not supplied them', () => {
    const out = serializeSettings({});
    expect('speed' in JSON.parse(JSON.stringify(out))).toBe(false);
    expect('syncOffsetMs' in JSON.parse(JSON.stringify(out))).toBe(false);
  });

  it('leaves the settings version where it was', () => {
    expect(SETTINGS_VERSION).toBe(2);
  });
});
