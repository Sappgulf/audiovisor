import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  appleArtworkUrl, mapApplePlaylist, mapAppleTrack, developerToken, _resetTokenCache,
} from '../src/applemusic.js';

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

describe('developer token fetching', () => {
  /* Every Source-tab visit, sign-in attempt and playlist action calls
     through configure() into developerToken(). On a deployment with no
     Apple Music credentials the endpoint can never succeed, so repeating
     the request is a wasted round trip each time — over cellular on a
     phone. A permanent answer is remembered; a transient one is not. */
  const respond = (status, body) => {
    globalThis.fetch = async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  };
  let calls;
  const counting = (status, body) => {
    calls = 0;
    globalThis.fetch = async () => { calls++; return { ok: status < 300, status, json: async () => body }; };
  };

  let hadWindow;
  beforeEach(() => {
    _resetTokenCache();
    // developerToken() short-circuits without a window, as it would in SSR
    hadWindow = 'window' in globalThis;
    if (!hadWindow) globalThis.window = {};
  });
  afterEach(() => {
    delete globalThis.fetch;
    if (!hadWindow) delete globalThis.window;
    _resetTokenCache();
  });

  it('returns the token on success', async () => {
    respond(200, { token: 'abc.def.ghi' });
    await expect(developerToken()).resolves.toBe('abc.def.ghi');
  });

  it('stops asking after a 501, which describes the deployment', async () => {
    counting(501, { error: 'Apple Music server credentials are not configured', configured: false });
    await expect(developerToken()).rejects.toThrow(/not configured/);
    await expect(developerToken()).rejects.toThrow(/not configured/);
    await expect(developerToken()).rejects.toThrow(/not configured/);
    expect(calls, 'should have asked the server exactly once').toBe(1);
  });

  it('keeps retrying after a 503, which may pass', async () => {
    counting(503, { error: 'Apple Music token unavailable', configured: true });
    await expect(developerToken()).rejects.toThrow();
    await expect(developerToken()).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it('keeps retrying after a network failure', async () => {
    let n = 0;
    globalThis.fetch = async () => { n++; throw new TypeError('Failed to fetch'); };
    await expect(developerToken()).rejects.toThrow();
    await expect(developerToken()).rejects.toThrow();
    expect(n).toBe(2);
  });

  it('surfaces the server message rather than a generic one', async () => {
    respond(501, { error: 'Apple Music server credentials are not configured' });
    await expect(developerToken()).rejects.toThrow('Apple Music server credentials are not configured');
  });
});
