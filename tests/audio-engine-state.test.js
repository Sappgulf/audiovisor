import { describe, it, expect } from 'vitest';
import { AudioEngine } from '../src/audio.js';

describe('engine state across source changes and bad input', () => {
  it('seek ignores a non-finite target, so the playhead stays finite', () => {
    const engine = new AudioEngine();
    engine.mode = 'file';
    engine.buffer = { duration: 100 };
    engine.offset = 5;
    engine.seek(NaN);
    expect(engine.offset).toBe(5);
    expect(engine.getTime()).toBe(5);
  });

  it('removing the last track drops the tempo of the track it played', () => {
    const engine = new AudioEngine();
    engine.queue = [{ buffer: null, file: null, meta: { name: 'a' } }];
    engine.queueIndex = 0;
    engine.beat.nudgeTo(0, 120, 0.9);
    expect(engine.displayBpm).toBe(120);
    engine.removeFromQueue(0);
    expect(engine.displayBpm).toBeNull();
    expect(engine.beatInBar).toBe(0);
  });

  it('stopping a stream drops its tempo before the file comes back', () => {
    const engine = new AudioEngine();
    engine.mode = 'stream';
    engine.beat.nudgeTo(0, 128, 0.9);
    engine.stopStream();
    expect(engine.displayBpm).toBeNull();
  });

  it('switching to an external source does not inherit the previous tempo', () => {
    const engine = new AudioEngine();
    engine.beat.nudgeTo(0, 100, 0.9);
    engine.setExternal({ kind: 'apple', isPlaying: () => false, getTime: () => 0 });
    expect(engine.displayBpm).toBeNull();
    expect(engine.beatPhase).toBe(0);
  });
});
