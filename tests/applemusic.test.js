import { describe, expect, it } from 'vitest';
import { appleArtworkUrl, mapApplePlaylist, mapAppleTrack } from '../src/applemusic.js';

describe('Apple Music mapping', () => {
  it('normalizes a library track for the shared transport UI', () => {
    const track = mapAppleTrack({
      id: 'i.am.track',
      attributes: {
        name: 'Night Drive',
        artistName: 'AUDIOVISOR',
        durationInMillis: 215000,
        artwork: { url: 'https://example.test/{w}x{h}bb.jpg' },
        playParams: { id: 'i.am.track' },
      },
    });

    expect(track).toEqual({
      id: 'i.am.track',
      uri: 'i.am.track',
      name: 'Night Drive',
      artists: 'AUDIOVISOR',
      durationMs: 215000,
      artwork: 'https://example.test/240x240bb.jpg',
    });
  });

  it('keeps playlist identity and count without requiring track expansion', () => {
    expect(mapApplePlaylist({
      id: 'p.mix',
      attributes: {
        name: 'Late Night Mix',
        description: { standard: 'A focused after-hours set.' },
        trackCount: 18,
      },
    })).toEqual({
      id: 'p.mix',
      name: 'Late Night Mix',
      description: 'A focused after-hours set.',
      trackCount: 18,
    });
  });

  it('renders artwork templates at a bounded UI size', () => {
    expect(appleArtworkUrl({ url: 'https://example.test/{w}x{h}.jpg' }, 96))
      .toBe('https://example.test/96x96.jpg');
    expect(appleArtworkUrl(null)).toBe(null);
  });
});
