/**
 * Mode thumbnails are generated artifacts committed to the repo, which makes
 * them the kind of thing that silently rots: add a mode and the picker shows
 * a tile with no preview, and nothing anywhere complains.
 *
 * This cannot detect a *stale* thumbnail — a mode whose visuals changed since
 * the last `npm run thumbs` — because that would mean re-rendering all 22 on
 * every test run. It does catch the two failures that actually happen: a mode
 * with no thumbnail at all, and a thumbnail left behind by a removed mode.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { MODES } from '../src/themes.js';

const DIR = 'public/modes';

describe('mode thumbnails', () => {
  it('the thumbnail directory exists', () => {
    expect(existsSync(DIR)).toBe(true);
  });

  it('every mode has one', () => {
    const missing = MODES.map((m) => m.id).filter((id) => !existsSync(`${DIR}/${id}.webp`));
    expect(missing).toEqual([]);
  });

  it('has no thumbnails for modes that no longer exist', () => {
    const ids = new Set(MODES.map((m) => m.id));
    const orphans = readdirSync(DIR)
      .filter((f) => f.endsWith('.webp'))
      .map((f) => f.replace(/\.webp$/, ''))
      .filter((id) => !ids.has(id));
    expect(orphans).toEqual([]);
  });

  it('none of them is empty or implausibly large', () => {
    // an encoder failure writes a 0-byte file; a stray full-size render would
    // be hundreds of kB and blow up the mobile sheet's first paint
    for (const m of MODES) {
      const { size } = statSync(`${DIR}/${m.id}.webp`);
      expect(size, `${m.id}.webp`).toBeGreaterThan(200);
      expect(size, `${m.id}.webp`).toBeLessThan(24 * 1024);
    }
  });

  it('the whole set stays small enough to ship', () => {
    const total = MODES.reduce((n, m) => n + statSync(`${DIR}/${m.id}.webp`).size, 0);
    expect(total).toBeLessThan(96 * 1024);
  });
});
