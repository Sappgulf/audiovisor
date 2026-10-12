/**
 * @vitest-environment jsdom
 *
 * The Connect drawer. The file most exposed to things outside the app's
 * control: the Apple Music account, the tab capture permission prompt, and
 * arbitrary user-typed stream URLs. The Apple Music client is stubbed here —
 * this suite is about the panel's own behaviour, not MusicKit's.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const appleInstances = [];

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

  it('offers no Spotify account, copy or controls', () => {
    expect(root.textContent).not.toMatch(/spotify/i);
    expect(root.innerHTML).not.toMatch(/spotify/i);
  });

  it('survives having no track callback', () => {
    const p = new ConnectPanel(document.createElement('div'), { engine: makeEngine(), toast: vi.fn() });
    expect(() => p.setCurrentTrack({ name: 'x' })).not.toThrow();
  });
});

describe('setCurrentTrack', () => {
  it('does not invent a provider for a track that has none', () => {
    panel.setCurrentTrack({ name: 'Song', artists: 'Band' });
    expect(panel.currentTrack.provider).toBeUndefined();
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

  it('stores a copy, so later edits to the caller object do not leak in', () => {
    const info = { name: 'Song' };
    panel.setCurrentTrack(info);
    info.name = 'Changed';
    expect(panel.currentTrack.name).toBe('Song');
  });
});

describe('apple controller', () => {
  it('exposes an apple controller in seconds, not milliseconds', () => {
    const c = panel.makeAppleController();
    expect(c.kind).toBe('apple');
    expect(c.getTime()).toBeCloseTo(3);
    expect(c.getDuration()).toBeCloseTo(200);
  });

  it('clamps a negative apple seek to zero', () => {
    panel.makeAppleController().seek(-1);
    expect(appleInstances[0].seek).toHaveBeenCalledWith(0);
  });

  it('converts an apple seek to milliseconds', () => {
    panel.makeAppleController().seek(30);
    expect(appleInstances[0].seek).toHaveBeenCalledWith(30000);
  });

  it('falls back to a stable seed when no track is loaded', () => {
    expect(panel.makeAppleController().seed).toBe('apple-music');
  });
});

describe('provider track callbacks', () => {
  it('publishes an apple track tagged as apple', () => {
    appleInstances[0].onTrackChange({ name: 'Tune', artists: 'A', durationMs: 90000, artwork: 'a.png' });
    expect(engine.setExternal).toHaveBeenCalled();
    expect(panel.currentTrack).toMatchObject({ provider: 'apple', duration: 90, kind: 'APPLE MUSIC' });
  });

  it('a null apple track only clears an apple track', () => {
    panel.setCurrentTrack({ name: 'Local file' });
    appleInstances[0].onTrackChange(null);
    expect(panel.currentTrack).not.toBeNull();
    expect(panel.currentTrack.name).toBe('Local file');
  });

  it('a null apple track clears an apple track', () => {
    panel.setCurrentTrack({ provider: 'apple', name: 'Tune' });
    appleInstances[0].onTrackChange(null);
    expect(panel.currentTrack).toBeNull();
  });

  it('re-renders when apple auth changes', () => {
    const spy = vi.spyOn(panel, 'render');
    appleInstances[0].onAuthChange();
    expect(spy).toHaveBeenCalled();
  });
});

describe('boot', () => {
  it('restores the apple session and re-renders', async () => {
    const spy = vi.spyOn(panel, 'render');
    await panel.boot();
    expect(appleInstances[0].boot).toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
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
    panel.setCurrentTrack({ provider: 'apple', name: 'Song' });
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

  it('reports a failed stream instead of an unhandled rejection', async () => {
    engine.playUrl.mockRejectedValueOnce(new Error('<i>decode failed</i>'));
    setUrl('https://cdn.example.com/broken.mp3');
    play();
    await vi.waitFor(() => {
      const msg = toast.mock.calls.at(-1)[0];
      expect(msg).toContain('Stream failed');
      expect(msg).toContain('&lt;i&gt;decode failed');
    });
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
