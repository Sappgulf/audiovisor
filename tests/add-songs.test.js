/**
 * The songs script turns masters into the compressed files and manifest the
 * app reads. The file names and titles must come out the way the app expects.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { songTitle, songSlug, addSongs } from '../scripts/add-songs.mjs';

const hasFfmpeg = (() => {
  try { execFileSync('which', ['ffmpeg']); return true; } catch { return false; }
})();

describe('song titles and slugs', () => {
  it('drops the _master suffix and turns underscores into spaces', () => {
    expect(songTitle('Last_Seen_master.wav')).toBe('Last Seen');
    expect(songTitle('Night_Voltage_master.wav')).toBe('Night Voltage');
    expect(songTitle('Still-Yours.wav')).toBe('Still Yours');
  });

  it('makes a URL-safe file name from the title', () => {
    expect(songSlug('Velvet Ash')).toBe('velvet-ash');
    expect(songSlug('  Dr. Who?! ')).toBe('dr-who');
    expect(songSlug('!!!')).toBe('');
  });
});

describe.skipIf(!hasFfmpeg)('addSongs', () => {
  it('writes an m4a per master and a manifest the app can read', async () => {
    const src = mkdtempSync(join(tmpdir(), 'songs-src-'));
    const out = mkdtempSync(join(tmpdir(), 'songs-out-'));
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-y', join(src, 'Velvet_Ash_master.wav')]);
    const songs = await addSongs(src, out, 'ffmpeg');
    expect(songs).toEqual([{ title: 'Velvet Ash', file: 'velvet-ash.m4a' }]);
    expect(existsSync(join(out, 'velvet-ash.m4a'))).toBe(true);
    expect(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))).toEqual(songs);
  });
});
