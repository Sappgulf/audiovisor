/**
 * First-run sample tracks.
 *
 * The buttons are worthless if a file is renamed, dropped from the build, or
 * replaced by a placeholder — and none of that fails a unit test elsewhere.
 * Assert the HTML references and the shipped files agree.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const ids = [...html.matchAll(/data-sample="([^"]+)"/g)].map((m) => m[1]);
const DIR = 'public/samples';

describe('first-run sample tracks', () => {
  it('offers a small set with unique, path-safe ids', () => {
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('ships a playable MP3 for every button', () => {
    for (const id of ids) {
      const path = `${DIR}/${id}.mp3`;
      expect(existsSync(path), `missing ${path}`).toBe(true);
      const head = readFileSync(path).subarray(0, 2);
      expect(head[0], `${id} has no MPEG frame sync`).toBe(0xff);
      expect(head[1] & 0xe0, `${id} has no MPEG frame sync`).toBe(0xe0);
      const size = statSync(path).size / 1024;
      expect(size, `${id} is too small to be a track`).toBeGreaterThan(1024);
      expect(size, `${id} is too large for a first-run sample`).toBeLessThan(8 * 1024);
    }
  });

  it('leaves no orphaned sample files', () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.mp3'))
      .map((f) => f.slice(0, -4))
      .sort();
    expect(files).toEqual([...ids].sort());
  });
});
