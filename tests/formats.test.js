import { describe, it, expect } from 'vitest';
import * as formats from '../src/formats.js';
import { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS, PLAYLIST_EXTENSIONS, ACCEPT_ATTR, extOf, isPlaylistFile } from '../src/formats.js';

describe('format lists', () => {
  it('lists the audio, video and playlist extensions the app supports', () => {
    expect(AUDIO_EXTENSIONS).toEqual(['.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.aif', '.aiff', '.caf', '.weba']);
    expect(VIDEO_EXTENSIONS).toEqual(['.mp4', '.m4v', '.mov', '.webm', '.ogv']);
    expect(PLAYLIST_EXTENSIONS).toEqual(['.m3u', '.m3u8', '.pls']);
  });

  it('exports only the names the other modules rely on', () => {
    expect(Object.keys(formats).sort()).toEqual(
      ['ACCEPT_ATTR', 'AUDIO_EXTENSIONS', 'PLAYLIST_EXTENSIONS', 'VIDEO_EXTENSIONS', 'extOf', 'isPlaylistFile'],
    );
  });
});

describe('ACCEPT_ATTR', () => {
  const tokens = ACCEPT_ATTR.split(',');

  it('names every supported extension, so the picker never hides a format we decode', () => {
    for (const ext of [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS, ...PLAYLIST_EXTENSIONS]) {
      expect(tokens, ext).toContain(ext);
    }
  });

  it('keeps the audio and video MIME families the OS file dialogs match on', () => {
    expect(tokens).toContain('audio/*');
    expect(tokens).toContain('video/mp4');
    expect(tokens).toContain('video/webm');
    expect(tokens).toContain('video/quicktime');
  });

  it('has no duplicate tokens', () => {
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

describe('extOf', () => {
  it('returns the lower-cased extension with its dot', () => {
    expect(extOf('Song.MP3')).toBe('.mp3');
    expect(extOf('my.mix.v2.FLAC')).toBe('.flac');
    expect(extOf('/path/to/clip.m4v')).toBe('.m4v');
  });

  it('returns an empty string when there is no extension', () => {
    expect(extOf('README')).toBe('');
    expect(extOf('')).toBe('');
    expect(extOf(undefined)).toBe('');
    expect(extOf('folder.d/track')).toBe('');
  });
});

describe('isPlaylistFile', () => {
  it('recognises playlist names in any case', () => {
    expect(isPlaylistFile('favourites.M3U8')).toBe(true);
    expect(isPlaylistFile('list.pls')).toBe(true);
    expect(isPlaylistFile('list.m3u')).toBe(true);
  });

  it('refuses media files and names that only look like playlists', () => {
    expect(isPlaylistFile('song.mp3')).toBe(false);
    expect(isPlaylistFile('m3u')).toBe(false);
    expect(isPlaylistFile('notes.m3u.txt')).toBe(false);
  });
});
