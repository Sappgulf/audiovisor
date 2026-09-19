import { describe, it, expect } from 'vitest';
import { MODES } from '../src/themes.js';
import { modeAssetPath } from '../src/mode-picker.js';

describe('mode picker assets', () => {
  it('resolves a still and hover strip for every built-in mode', () => {
    for (const mode of MODES) {
      expect(modeAssetPath(mode.id)).toBe(`/modes/${mode.id}.webp`);
      expect(modeAssetPath(mode.id, true)).toBe(`/modes/${mode.id}-anim.webp`);
      expect(modeAssetPath(mode.id)).not.toContain('undefined');
    }
  });
});
