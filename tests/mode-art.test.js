/**
 * The stage key-art layer is a manually paired triple: one image in
 * public/modes/art/, one MODE_ART entry with its chapter/title/copy, and the
 * mode itself. Add a mode without its art and setModeArt() quietly falls back
 * to the bars artwork while the story block keeps narrating the wrong scene —
 * exactly the kind of rot the thumbnail suite exists to catch, so this runs
 * the same checks over the second, larger set.
 *
 * The art frames are fetched on first reference per session (never all at
 * once), so the size bounds here guard decode memory and repo weight rather
 * than page load.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { MODES } from '../src/themes.js';
import { MODE_ART } from '../src/mode-art.js';

const DIR = 'public/modes/art';

describe('mode key art', () => {
  it('every mode has an entry', () => {
    const missing = MODES.map((m) => m.id).filter((id) => !MODE_ART[id]);
    expect(missing).toEqual([]);
  });

  it('has no entries for modes that no longer exist', () => {
    const ids = new Set(MODES.map((m) => m.id));
    const orphans = Object.keys(MODE_ART).filter((id) => !ids.has(id));
    expect(orphans).toEqual([]);
  });

  it('every entry points at its own file that exists', () => {
    const missing = MODES.map((m) => m.id)
      .filter((id) => MODE_ART[id])
      .filter((id) => {
        const expected = `/modes/art/${id}.webp`; // web-served path as declared
        return !existsSync(`public${expected}`) || MODE_ART[id].image !== expected;
      });
    expect(missing).toEqual([]);
  });

  it('the directory holds nothing but the declared set', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.webp'));
    const expected = MODES.map((m) => `${m.id}.webp`).sort();
    expect(files.sort()).toEqual(expected);
  });

  it('frames are bounded so a stray export cannot land', () => {
    // these are full-bleed 1280px renders decoded one at a time — a 5MB
    // frame would spike memory and stall the art swap on phones
    for (const m of MODES) {
      const { size } = statSync(`${DIR}/${m.id}.webp`);
      expect(size, `${m.id}.webp`).toBeGreaterThan(20 * 1024);
      expect(size, `${m.id}.webp`).toBeLessThan(400 * 1024);
    }
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
