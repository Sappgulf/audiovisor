// @vitest-environment jsdom
/**
 * File loading intent: a file dropped on the stage should start playing,
 * while the Add buttons (the file picker) only queue behind the current
 * track. Dropping onto a playing stage used to queue silently, so nothing
 * appeared to happen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFileLoader } from '../src/file-loader.js';

function fakeEngine() {
  const engine = {
    queue: [], queueIndex: -1, captureActive: false, evicted: 0,
    get hasTrack() { return this.queueIndex >= 0; },
    get track() { return this.queue[this.queueIndex]; },
    isExternal: () => false,
    stopStream: vi.fn(), pause: vi.fn(), toggleCapture: vi.fn(),
    play: vi.fn(),
    playTrack: vi.fn((i) => { engine.queueIndex = i; }),
    addToQueue: vi.fn(async (files) => {
      for (const f of files) engine.queue.push({ name: f.name });
      if (engine.queueIndex < 0) engine.queueIndex = 0;
      return [];
    }),
  };
  return engine;
}

const wav = (name) => new File([new Uint8Array(4)], name, { type: 'audio/wav' });

describe('createFileLoader', () => {
  let engine, loader;
  beforeEach(() => {
    document.body.innerHTML = `
      <span id="status-text"></span><div id="status-pill"></div><main id="stage"></main>
      <div id="dropzone"><div class="dropzone"></div></div><input type="file" id="file-input" />`;
    engine = fakeEngine();
    loader = createFileLoader({ engine, toast: vi.fn(), updateTrackUI: vi.fn(), ensureAudible: vi.fn(), closeMore: vi.fn() });
  });

  it('plays the first dropped track when something is already playing', async () => {
    await loader.loadFiles([wav('a.wav')]);
    await loader.loadFiles([wav('b.wav'), wav('c.wav')], { playNew: true });
    expect(engine.playTrack).toHaveBeenCalledWith(1);
    expect(engine.track.name).toBe('b.wav');
  });

  it('only queues files added through the picker', async () => {
    await loader.loadFiles([wav('a.wav')]);
    await loader.loadFiles([wav('b.wav')]);
    expect(engine.playTrack).not.toHaveBeenCalled();
    expect(engine.track.name).toBe('a.wav');
  });

  it('a drop on an empty stage just starts the queue', async () => {
    await loader.loadFiles([wav('a.wav')], { playNew: true });
    expect(engine.playTrack).not.toHaveBeenCalled();
    expect(engine.play).toHaveBeenCalled();
  });

  it('routes window drops through playNew', async () => {
    const dt = { files: [wav('a.wav')] };
    const ev = new Event('drop', { cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    await loader.loadFiles([wav('first.wav')]);
    window.dispatchEvent(ev);
    await vi.waitFor(() => expect(engine.playTrack).toHaveBeenCalledWith(1));
  });
});
