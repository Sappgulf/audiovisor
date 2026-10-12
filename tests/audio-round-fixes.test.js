/**
 * Regressions from the bug review: a live repeat flag, trimming that keeps the
 * entry being loaded, and a file that replaces a playing stream.
 */
import { describe, it, expect, vi } from 'vitest';
const { AudioEngine } = await import('../src/audio.js');

const entry = (duration) => ({ url: null, buffer: { duration }, file: {}, meta: { duration, name: 'x' } });

describe('repeat', () => {
  it('reaches a source that is already playing', () => {
    const engine = new AudioEngine();
    const source = { loop: false };
    engine.source = source;
    engine.repeat = true;
    expect(source.loop).toBe(true);
    engine.repeat = false;
    expect(source.loop).toBe(false);
  });

  it('keeps the demo cycling whatever the flag says', () => {
    const engine = new AudioEngine();
    engine.track = { demo: true };
    const source = { loop: false };
    engine.source = source;
    engine.repeat = false;
    expect(source.loop).toBe(true);
  });
});

describe('queue trimming', () => {
  it('never releases the entry it is told to keep', () => {
    const engine = new AudioEngine();
    engine.queue = [entry(1000), entry(1000)]; // 2000 s, over the 1500 s budget
    engine.queueIndex = -1;
    engine._trimQueue([1]);
    expect(engine.queue[1].buffer).not.toBeNull();
    expect(engine.queue[0].buffer).toBeNull();
  });

  it('never releases the current track', () => {
    const engine = new AudioEngine();
    engine.queue = [entry(1000), entry(1000)];
    engine.queueIndex = 0;
    engine._trimQueue();
    expect(engine.queue[0].buffer).not.toBeNull();
    expect(engine.queue[1].buffer).toBeNull();
  });
});

describe('switching from a stream to a file', () => {
  it('stops the stream element, so the file does not play underneath it', () => {
    const engine = new AudioEngine();
    const mediaEl = { pause: vi.fn() };
    engine.mediaEl = mediaEl;
    engine.mode = 'stream';
    engine.queue = [entry(10)];
    engine.streamTrack = { name: 'radio', url: 'https://example.test/live', ext: 'STREAM' };
    engine._applyQueueItem(0);
    expect(mediaEl.pause).toHaveBeenCalled();
    expect(engine.mode).toBe('file');
  });
});
