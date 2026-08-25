/**
 * @vitest-environment jsdom
 *
 * The Connect drawer. 542 lines that had no tests at all, and the file most
 * exposed to things outside the app's control: two OAuth providers, the tab
 * capture permission prompt, and arbitrary user-typed stream URLs. The
 * provider clients are stubbed here — this suite is about the panel's own
 * behaviour, not Spotify's.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const spotifyInstances = [];
const appleInstances = [];

vi.mock('../src/spotify.js', () => ({
  storedClientId: () => 'test-client-id',
  redirectUri: () => 'http://localhost/callback',
  SpotifyClient: class {
    constructor() {
      this.authed = false;
      this.premium = false;
      this.track = null;
      this.paused = true;
      this.handleRedirect = vi.fn(async () => {});
      this.loadProfile = vi.fn(async () => {});
      this.connectPlayer = vi.fn(async () => {});
      this.artworkFor = vi.fn(async () => 'art.png');
      this.profile = { display_name: 'Tester' };
      this.playlists = vi.fn(async () => [{ uri: 'spotify:playlist:1', name: 'Mix' }]);
      this.topTracks = vi.fn(async () => []);
      this.searchTracks = vi.fn(async () => []);
      this.mapTrack = vi.fn((t) => t);
      this.play = vi.fn(async () => {});
      this.transferHere = vi.fn(async () => {});
      this.login = vi.fn(); this.logout = vi.fn();
      this.getPositionMs = vi.fn(() => 12000);
      this.resume = vi.fn(); this.pause = vi.fn(); this.seek = vi.fn();
      this.next = vi.fn(); this.prev = vi.fn(); this.setVolume = vi.fn();
      spotifyInstances.push(this);
    }
  },
}));

vi.mock('../src/applemusic.js', () => ({
  AppleMusicClient: class {
    constructor() {
      this.authed = false;
      this.configured = true;
      this.track = null;
      this.boot = vi.fn(async () => {});
      this.playlists = vi.fn(async () => []);
      this.playPlaylist = vi.fn(async () => {});
      this.login = vi.fn(); this.logout = vi.fn();
      this.isPlaying = vi.fn(() => false);
      this.getPositionMs = vi.fn(() => 3000);
      this.getDurationMs = vi.fn(() => 200000);
      this.play = vi.fn(); this.pause = vi.fn(); this.seek = vi.fn();
      this.next = vi.fn(); this.prev = vi.fn(); this.setVolume = vi.fn();
      appleInstances.push(this);
    }
  },
}));

const { ConnectPanel } = await import('../src/connect.js');

function makeEngine() {
  const listeners = {};
  return {
    captureActive: false,
    on: (name, fn) => { (listeners[name] ||= []).push(fn); },
    fire: (name, payload) => (listeners[name] || []).forEach((f) => f(payload)),
    setExternal: vi.fn(),
    toggleCapture: vi.fn(async () => true),
    playUrl: vi.fn(async () => {}),
    _listeners: listeners,
  };
}

let root, engine, toast, onExternalTrack, panel;

function mount() {
  root = document.createElement('div');
  document.body.appendChild(root);
  engine = makeEngine();
  toast = vi.fn();
  onExternalTrack = vi.fn();
  panel = new ConnectPanel(root, { engine, toast, onExternalTrack });
  return panel;
}

beforeEach(() => {
  document.body.innerHTML = '';
  spotifyInstances.length = 0;
  appleInstances.length = 0;
  vi.clearAllMocks();
  mount();
});

describe('construction', () => {
  it('renders a panel without throwing', () => {
    expect(root.children.length).toBeGreaterThan(0);
  });

  it('starts with no external track', () => {
    expect(panel.currentTrack).toBeNull();
  });

  it('subscribes to the engine events it needs', () => {
    expect(Object.keys(engine._listeners).sort()).toEqual(['error', 'source', 'state']);
  });

  it('accepts the legacy onSpotifyTrack alias', () => {
    const legacy = vi.fn();
    const p = new ConnectPanel(document.createElement('div'), {
      engine: makeEngine(), toast: vi.fn(), onSpotifyTrack: legacy,
    });
    p.setCurrentTrack({ name: 'x' });
    expect(legacy).toHaveBeenCalled();
  });

  it('survives having neither track callback', () => {
    const p = new ConnectPanel(document.createElement('div'), { engine: makeEngine(), toast: vi.fn() });
    expect(() => p.setCurrentTrack({ name: 'x' })).not.toThrow();
  });
});

describe('setCurrentTrack', () => {
  it('defaults the provider to spotify', () => {
    panel.setCurrentTrack({ name: 'Song', artists: 'Band' });
    expect(panel.currentTrack.provider).toBe('spotify');
    expect(onExternalTrack).toHaveBeenCalledWith(panel.currentTrack);
  });

  it('keeps an explicit provider', () => {
    panel.setCurrentTrack({ provider: 'apple', name: 'Song' });
    expect(panel.currentTrack.provider).toBe('apple');
  });

  it('clears to null and tells the host', () => {
    panel.setCurrentTrack({ name: 'Song' });
    panel.setCurrentTrack(null);
    expect(panel.currentTrack).toBeNull();
    expect(onExternalTrack).toHaveBeenLastCalledWith(null);
  });
});

describe('provider controllers', () => {
  it('exposes a spotify controller in seconds, not milliseconds', () => {
    const sp = spotifyInstances[0];
    sp.track = { id: 't1', name: 'Song', durationMs: 210000 };
    sp.paused = false;
    const c = panel.makeController();
    expect(c.kind).toBe('spotify');
    expect(c.seed).toBe('t1');
    expect(c.getTime()).toBeCloseTo(12);
    expect(c.getDuration()).toBeCloseTo(210);
    expect(c.isPlaying()).toBe(true);
  });

  it('reports not-playing when spotify has no track', () => {
    expect(panel.makeController().isPlaying()).toBe(false);
  });

  it('clamps a negative spotify seek to zero', () => {
    panel.makeController().seek(-5);
    expect(spotifyInstances[0].seek).toHaveBeenCalledWith(0);
  });

  it('converts a spotify seek to milliseconds', () => {
    panel.makeController().seek(30);
    expect(spotifyInstances[0].seek).toHaveBeenCalledWith(30000);
  });

  it('exposes an apple controller with the same shape', () => {
    const c = panel.makeAppleController();
    expect(c.kind).toBe('apple');
    expect(c.getTime()).toBeCloseTo(3);
    expect(c.getDuration()).toBeCloseTo(200);
  });

  it('clamps a negative apple seek to zero', () => {
    panel.makeAppleController().seek(-1);
    expect(appleInstances[0].seek).toHaveBeenCalledWith(0);
  });

  it('falls back to a stable seed when no track is loaded', () => {
    expect(panel.makeController().seed).toBe('spotify');
    expect(panel.makeAppleController().seed).toBe('apple-music');
  });
});

describe('provider track callbacks', () => {
  it('publishes a spotify track as seconds with artwork', async () => {
    const sp = spotifyInstances[0];
    await sp.onTrackChange({ name: 'Song', artists: 'Band', durationMs: 180000 });
    expect(engine.setExternal).toHaveBeenCalled();
    expect(panel.currentTrack).toMatchObject({
      provider: 'spotify', name: 'Song', duration: 180, artwork: 'art.png', kind: 'SPOTIFY',
    });
  });

  it('publishes an apple track tagged as apple', () => {
    appleInstances[0].onTrackChange({ name: 'Tune', artists: 'A', durationMs: 90000, artwork: 'a.png' });
    expect(panel.currentTrack).toMatchObject({ provider: 'apple', duration: 90, kind: 'APPLE MUSIC' });
  });

  it('a null apple track only clears an apple track', () => {
    panel.setCurrentTrack({ provider: 'spotify', name: 'Song' });
    appleInstances[0].onTrackChange(null);
    expect(panel.currentTrack).not.toBeNull();
    expect(panel.currentTrack.provider).toBe('spotify');
  });

  it('a null apple track clears an apple track', () => {
    panel.setCurrentTrack({ provider: 'apple', name: 'Tune' });
    appleInstances[0].onTrackChange(null);
    expect(panel.currentTrack).toBeNull();
  });

  it('re-renders when spotify auth changes', () => {
    const spy = vi.spyOn(panel, 'render');
    spotifyInstances[0].onAuthChange();
    expect(spy).toHaveBeenCalled();
  });
});

describe('boot', () => {
  it('completes the OAuth redirect even when signed out', async () => {
    await panel.boot();
    expect(spotifyInstances[0].handleRedirect).toHaveBeenCalled();
    expect(spotifyInstances[0].loadProfile).not.toHaveBeenCalled();
  });

  it('restores a premium session and marks the device ready', async () => {
    const sp = spotifyInstances[0];
    sp.authed = true; sp.premium = true;
    await panel.boot();
    expect(sp.connectPlayer).toHaveBeenCalled();
    expect(panel.deviceReady).toBe(true);
  });

  it('does not try to connect a player on a free account', async () => {
    const sp = spotifyInstances[0];
    sp.authed = true; sp.premium = false;
    await panel.boot();
    expect(sp.loadProfile).toHaveBeenCalled();
    expect(sp.connectPlayer).not.toHaveBeenCalled();
    expect(panel.deviceReady).toBe(false);
  });

  it('a failing Spotify profile does not stop Apple boot', async () => {
    const sp = spotifyInstances[0];
    sp.authed = true;
    sp.loadProfile.mockRejectedValueOnce(new Error('429'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(panel.boot()).resolves.toBeUndefined();
    expect(appleInstances[0].boot).toHaveBeenCalled();
  });

  it('a failing Apple boot does not reject the whole panel', async () => {
    appleInstances[0].boot.mockRejectedValueOnce(new Error('no MusicKit'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(panel.boot()).resolves.toBeUndefined();
  });
});

describe('engine events', () => {
  it('toasts when a tab capture ends on its own', () => {
    engine.fire('source', 'capture-ended');
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('stopped'), expect.anything());
  });

  it('does not toast for an ordinary source change', () => {
    engine.fire('source', 'file');
    expect(toast).not.toHaveBeenCalled();
  });

  it('escapes engine error text before putting it in a toast', () => {
    engine.fire('error', '<img src=x onerror=alert(1)>');
    const msg = toast.mock.calls.at(-1)[0];
    expect(msg).not.toContain('<img');
    expect(msg).toContain('&lt;img');
  });

  it('reflects capture state on the capture chip', () => {
    engine.captureActive = true;
    engine.fire('state');
    expect(root.querySelector('#chip-capture').classList.contains('is-active')).toBe(true);
  });
});

describe('url streaming', () => {
  const play = () => root.querySelector('#url-play').click();
  const setUrl = (v) => { root.querySelector('#url-input').value = v; };

  it('rejects a URL without an http scheme', () => {
    setUrl('javascript:alert(1)');
    play();
    expect(engine.playUrl).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Invalid URL'), expect.anything());
  });

  it('rejects an empty URL', () => {
    setUrl('   ');
    play();
    expect(engine.playUrl).not.toHaveBeenCalled();
  });

  it('streams an http(s) URL and names it from the path', async () => {
    setUrl('https://cdn.example.com/music/My%20Track.mp3');
    play();
    expect(engine.playUrl).toHaveBeenCalledWith(
      'https://cdn.example.com/music/My%20Track.mp3',
      { name: 'My Track.mp3' },
    );
  });

  it('falls back to the hostname when the path is empty', () => {
    setUrl('https://stream.example.com/');
    play();
    expect(engine.playUrl.mock.calls[0][1].name).toBe('stream.example.com');
  });

  it('clears any external provider track when a URL takes over', async () => {
    panel.setCurrentTrack({ name: 'Song' });
    setUrl('https://cdn.example.com/a.mp3');
    play();
    await vi.waitFor(() => expect(panel.currentTrack).toBeNull());
  });

  it('toggles the URL row from the chip', () => {
    const row = root.querySelector('#url-input').closest('.url-row') || root.querySelector('#url-input').parentElement;
    const before = row.classList.contains('is-hidden');
    root.querySelector('#chip-url').click();
    expect(row.classList.contains('is-hidden')).toBe(!before);
  });
});

describe('tab capture', () => {
  it('toasts on a successful capture', async () => {
    root.querySelector('#chip-capture').click();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('LIVE'), expect.anything()));
  });

  it('reports a blocked capture instead of throwing', async () => {
    engine.toggleCapture.mockRejectedValueOnce(new Error('Permission denied'));
    root.querySelector('#chip-capture').click();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith(
      expect.stringContaining('Permission denied'), expect.anything()));
  });

  it('escapes the browser error text', async () => {
    engine.toggleCapture.mockRejectedValueOnce(new Error('<b>nope</b>'));
    root.querySelector('#chip-capture').click();
    await vi.waitFor(() => {
      const msg = toast.mock.calls.at(-1)[0];
      expect(msg).toContain('&lt;b&gt;nope');
    });
  });
});
