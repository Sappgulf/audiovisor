/**
 * Default songs: the manifest is data from the server, so every field is
 * checked before a file name reaches a URL. The service worker must leave the
 * audio out of Cache Storage.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSongManifest, fetchSongList, fetchSongFile } from '../src/default-songs.js';

describe('parseSongManifest', () => {
  it('keeps well-formed entries and gives each a MIME type from its extension', () => {
    const songs = parseSongManifest([
      { title: 'Velvet Ash', file: 'velvet-ash.m4a' },
      { title: 'Still Yours', file: 'Still_Yours.wav' },
    ]);
    expect(songs).toEqual([
      { title: 'Velvet Ash', file: 'velvet-ash.m4a', type: 'audio/mp4' },
      { title: 'Still Yours', file: 'Still_Yours.wav', type: 'audio/wav' },
    ]);
  });

  it('refuses a path, a traversal, an unknown extension or a missing field', () => {
    const songs = parseSongManifest([
      { title: 'Path', file: '../secrets.wav' },
      { title: 'Absolute', file: '/etc/passwd.wav' },
      { title: 'Nested', file: 'a/b.wav' },
      { title: 'Script', file: 'x.html' },
      { title: 'NoFile' },
      { file: 'untitled.wav' },
      null,
    ]);
    expect(songs).toEqual([]);
  });

  it('returns nothing for a manifest that is not a list', () => {
    expect(parseSongManifest({ songs: [] })).toEqual([]);
    expect(parseSongManifest('songs')).toEqual([]);
    expect(parseSongManifest(null)).toEqual([]);
  });

  it('trims and caps long titles', () => {
    const [song] = parseSongManifest([{ title: `  ${'x'.repeat(200)}  `, file: 'a.mp3' }]);
    expect(song.title.length).toBe(60);
  });
});

describe('fetchSongList', () => {
  it('returns the parsed list when the manifest is served', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify([{ title: 'A', file: 'a.ogg' }])));
    const songs = await fetchSongList('/', fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('/songs/manifest.json', expect.anything());
    expect(songs).toEqual([{ title: 'A', file: 'a.ogg', type: 'audio/ogg' }]);
  });

  it('returns an empty list when the manifest is missing, so no picks show', async () => {
    const fetchFn = vi.fn(async () => new Response('not found', { status: 404 }));
    expect(await fetchSongList('/', fetchFn)).toEqual([]);
  });

  it('returns an empty list when the manifest is not JSON', async () => {
    const fetchFn = vi.fn(async () => new Response('<html>'));
    expect(await fetchSongList('/', fetchFn)).toEqual([]);
  });
});

describe('fetchSongFile', () => {
  it('returns the song as a File named after its title', async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    const file = await fetchSongFile('/', { title: 'Night/Voltage', file: 'night.m4a', type: 'audio/mp4' }, fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('/songs/night.m4a');
    expect(file.name).toBe('Night-Voltage.m4a');
    expect(file.type).toBe('audio/mp4');
  });

  it('throws when the file is not there', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 404 }));
    await expect(fetchSongFile('/', { title: 'A', file: 'a.wav', type: 'audio/wav' }, fetchFn)).rejects.toThrow('404');
  });
});

describe('service worker and songs', () => {
  it('does not copy /songs/ responses into Cache Storage', () => {
    const sw = readFileSync('public/sw.js', 'utf8');
    expect(sw).toMatch(/!url\.pathname\.startsWith\('\/songs\/'\)/);
  });
});
