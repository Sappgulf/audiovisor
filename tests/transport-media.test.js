/**
 * @vitest-environment jsdom
 *
 * Lock-screen metadata and scrubber position, and the A-B region span on the
 * seek track. The span maths is tested as a pure function, then through the
 * CSS custom properties the transport writes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTransport, loopSpan } from '../src/transport.js';

const DOM = `
  <div id="shell">
    <footer class="transport" id="transport">
      <button id="play-pause-btn"></button>
      <button id="prev-btn"></button>
      <button id="next-btn"></button>
      <button id="loop-btn"></button>
      <div id="seek-track" role="slider" tabindex="0"></div>
      <div id="volume-track" role="slider" tabindex="0"><div id="volume-fill"></div></div>
      <button id="fullscreen-btn"></button>
      <button id="tap-tempo-btn"><span id="tap-tempo-label">Tap tempo</span></button>
      <button id="loop-ab-btn"><span id="loop-ab-label">A-B loop</span></button>
    </footer>
    <main class="stage" id="stage"></main>
  </div>`;

let session;

/** A mediaSession stand-in with the methods the transport calls. */
function installMediaSession(extra = {}) {
  session = { metadata: null, setActionHandler: vi.fn(), setPositionState: vi.fn(), ...extra };
  Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true, writable: true });
  globalThis.MediaMetadata = vi.fn(function MediaMetadata(init) { Object.assign(this, init); });
  return session;
}

function setup(engineExtra = {}) {
  document.body.innerHTML = DOM;
  const engine = {
    activeInput: 'local', playing: false, volume: 1, loop: null, repeat: false, speed: 1,
    time: 12, track: { name: 'Song' }, duration: 100,
    toggle: vi.fn(), skip: vi.fn(), seek: vi.fn(), setVolume: vi.fn(),
    prevTrack: vi.fn(), nextTrack: vi.fn(),
    getDuration: () => engine.duration,
    getTime: () => engine.time,
    on: vi.fn(),
    ...engineExtra,
  };
  const transport = createTransport({
    engine, getConnect: () => null, setToggle: vi.fn(), saveSettings: vi.fn(), toast: vi.fn(),
    openFilePicker: vi.fn(), doc: document,
  });
  return { engine, transport };
}

afterEach(() => {
  delete navigator.mediaSession;
  delete globalThis.MediaMetadata;
});

describe('loopSpan', () => {
  it('is an empty span with no region or no known length', () => {
    expect(loopSpan(null, 100)).toEqual({ left: '0%', width: '0%' });
    expect(loopSpan({ start: 10, end: 20 }, 0)).toEqual({ left: '0%', width: '0%' });
    expect(loopSpan({ start: 10, end: 20 }, NaN)).toEqual({ left: '0%', width: '0%' });
  });

  it('places the region as percentages of the length', () => {
    expect(loopSpan({ start: 10, end: 30 }, 200)).toEqual({ left: '5%', width: '10%' });
    expect(loopSpan({ start: 0, end: 50 }, 50)).toEqual({ left: '0%', width: '100%' });
  });

  it('clamps a region that runs past the end', () => {
    expect(loopSpan({ start: 90, end: 150 }, 100)).toEqual({ left: '90%', width: '10%' });
  });
});

describe('A-B span on the seek track', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('writes the span into the track custom properties from the engine region', () => {
    setup({ loop: { start: 10, end: 30 }, duration: 200 });
    const track = document.getElementById('seek-track');
    expect(track.style.getPropertyValue('--loop-l')).toBe('5%');
    expect(track.style.getPropertyValue('--loop-w')).toBe('10%');
  });

  it('is empty when the engine has no loop, or no loop method at all', () => {
    setup({ loop: undefined, getDuration: undefined, duration: undefined });
    const track = document.getElementById('seek-track');
    expect(track.style.getPropertyValue('--loop-w')).toBe('0%');
  });

  it('repaints from the engine state event', () => {
    const listeners = {};
    const { engine } = setup({ on: vi.fn((name, fn) => { listeners[name] = fn; }) });
    engine.loop = { start: 50, end: 100 };
    listeners.state();
    expect(document.getElementById('seek-track').style.getPropertyValue('--loop-l')).toBe('50%');
  });
});

describe('local track artwork', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('falls back to the app icon when the local file has no cover', async () => {
    installMediaSession();
    const { transport } = setup();
    await transport.updateMediaSession();
    const init = MediaMetadata.mock.calls[0][0];
    expect(init.title).toBe('Song');
    expect(init.artwork).toEqual([{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }]);
  });
});

describe('lock-screen position state', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('reports duration, rate and position when they are known', async () => {
    installMediaSession();
    const { transport } = setup({ time: 12, duration: 100, speed: 1.5 });
    await transport.updateMediaSession();
    expect(session.setPositionState).toHaveBeenCalledWith({ duration: 100, playbackRate: 1.5, position: 12 });
  });

  it('skips a duration that is not finite', async () => {
    installMediaSession();
    const { transport } = setup({ duration: Infinity });
    await transport.updateMediaSession();
    expect(session.setPositionState).not.toHaveBeenCalled();
  });

  it('skips a position past the end', async () => {
    installMediaSession();
    const { transport } = setup({ time: 120, duration: 100 });
    await transport.updateMediaSession();
    expect(session.setPositionState).not.toHaveBeenCalled();
  });

  it('does not throw when the browser refuses the call or lacks the method', async () => {
    installMediaSession({ setPositionState: vi.fn(() => { throw new Error('refused'); }) });
    const { transport } = setup();
    await expect(transport.updateMediaSession()).resolves.toBeUndefined();

    delete session.setPositionState;
    await expect(transport.updateMediaSession()).resolves.toBeUndefined();
  });
});
