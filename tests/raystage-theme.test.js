import { describe, it, expect } from 'vitest';
import { RayStage } from '../src/raystage.js';
import { THEMES } from '../src/themes.js';

function fakeCanvas() {
  return { width: 0, height: 0, getContext: () => null, getBoundingClientRect: () => ({ width: 800, height: 400 }) };
}

describe('RayStage palette change', () => {
  it('keeps the temporal history so the old palette blends out instead of cutting', () => {
    const s = new RayStage(fakeCanvas());
    s.frames = 17;
    s.setTheme(THEMES[0]);
    expect(s.frames).toBe(17);
  });

  it('still uploads the new palette', () => {
    const s = new RayStage(fakeCanvas());
    const before = JSON.stringify(s.pal);
    s.setTheme(THEMES[1]);
    expect(JSON.stringify(s.pal)).not.toBe(before);
    expect(s.pal.length).toBe(Math.min(5, THEMES[1].colors.length));
  });
});
