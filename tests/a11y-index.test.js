/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

describe('index.html contracts', () => {
  it('sets the file input accept to the exact format list the formats engineer exports', () => {
    const m = html.match(/<input type="file" id="file-input"[^>]*accept="([^"]*)"/);
    expect(m?.[1]).toBe(
      'audio/*,video/mp4,video/webm,video/quicktime,video/ogg,.m4a,.aac,.aif,.aiff,.caf,.opus,.oga,.weba,.flac,.m4v,.ogv,.mov,.m3u,.m3u8,.pls,.mp3,.wav,.ogg,.mp4,.webm',
    );
  });

  it('does not load MusicKit eagerly (src/applemusic.js loads it on demand)', () => {
    expect(html).not.toContain('musickit.js');
  });

  it('gives the tempo and A-B loop controls their ids', () => {
    expect(html).toMatch(/id="tap-tempo-btn"/);
    expect(html).toMatch(/id="loop-ab-btn"/);
  });

  it('keeps the empty state naming the supported formats', () => {
    expect(html).toContain('MP3, WAV, FLAC, M4A, OGG, OPUS, AIFF and the audio of MP4 or WebM video');
  });
});
