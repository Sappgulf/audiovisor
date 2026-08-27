/**
 * The stage caption layer is a manually paired pair: one MODE_ART entry per
 * mode and the mode itself. Add a mode without its story and setModeStory()
 * quietly falls back to the bars copy while the caption narrates the wrong
 * scene — exactly the kind of rot cheap tests exist to catch.
 *
 * There used to be a generated key-art frame paired with each entry too;
 * the backdrop layer was cut (the stage reads better on plain black with
 * nothing behind the renderer) but the captions stayed.
 */
import { describe, it, expect } from 'vitest';
import { MODES } from '../src/themes.js';
import { MODE_ART } from '../src/mode-art.js';

describe('mode stories', () => {
  it('every mode has an entry', () => {
    const missing = MODES.map((m) => m.id).filter((id) => !MODE_ART[id]);
    expect(missing).toEqual([]);
  });

  it('has no entries for modes that no longer exist', () => {
    const ids = new Set(MODES.map((m) => m.id));
    const orphans = Object.keys(MODE_ART).filter((id) => !ids.has(id));
    expect(orphans).toEqual([]);
  });

  it('every story has chapter, title and copy', () => {
    for (const [id, art] of Object.entries(MODE_ART)) {
      expect(art.chapter, id).toMatch(/^\d{2} \/ .+/);
      expect(art.title, id).toBeTruthy();
      expect(art.story, id).toBeTruthy();
      expect(art.title.length, id).toBeLessThan(60);
      expect(art.story.length, id).toBeLessThan(120);
    }
  });

  it('chapters run 01..NN in mode order with no gaps or repeats', () => {
    const seen = new Set();
    let n = 0;
    for (const m of MODES) {
      const num = Number(MODE_ART[m.id].chapter.slice(0, 2));
      expect(num, m.id).toBe(++n);
      seen.add(num);
    }
    expect(seen.size).toBe(MODES.length);
  });
});
