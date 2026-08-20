import { describe, it, expect } from 'vitest';
import { BeatTracker } from '../src/beattracker.js';

function fakeClock() {
  let t = 0;
  const now = () => t;
  return {
    now,
    advance(ms) {
      t += ms;
    },
  };
}

describe('BeatTracker', () => {
  it('detects BPM from steady 500ms beats', () => {
    const clock = fakeClock();
    const bt = new BeatTracker({ now: clock.now });
    for (let i = 0; i < 20; i++) {
      bt.tick(0.8);
      clock.advance(500);
    }
    expect(bt.bpm).toBe(120);
  });

  it('ignores energy below threshold', () => {
    const clock = fakeClock();
    const bt = new BeatTracker({ now: clock.now });
    for (let i = 0; i < 10; i++) {
      bt.tick(0.2);
      clock.advance(500);
    }
    expect(bt.bpm).toBe(0);
  });

  it('ignores beats faster than minInterval', () => {
    const clock = fakeClock();
    const bt = new BeatTracker({ now: clock.now, minInterval: 250 });
    bt.tick(0.9);
    clock.advance(100);
    bt.tick(0.9);
    clock.advance(100);
    bt.tick(0.9);
    clock.advance(100);
    bt.tick(0.9);
    clock.advance(500);
    bt.tick(0.9);
    clock.advance(500);
    bt.tick(0.9);
    clock.advance(500);
    bt.tick(0.9);
    clock.advance(500);
    bt.tick(0.9);
    clock.advance(500);
    bt.tick(0.9);
    clock.advance(500);
    bt.tick(0.9);
    expect(bt.bpm).toBe(120);
  });

  it('decays BPM after silence', () => {
    const clock = fakeClock();
    const bt = new BeatTracker({ now: clock.now, decayMs: 3200 });
    for (let i = 0; i < 20; i++) {
      bt.tick(0.8);
      clock.advance(500);
    }
    expect(bt.bpm).toBe(120);
    clock.advance(4000);
    bt.tick(0.1);
    expect(bt.bpm).toBe(0);
  });

  it('computes fast BPM for fast music', () => {
    const clock = fakeClock();
    const bt = new BeatTracker({ now: clock.now });
    for (let i = 0; i < 25; i++) {
      bt.tick(0.75);
      clock.advance(428);
    }
    expect(bt.bpm).toBeGreaterThan(130);
    expect(bt.bpm).toBeLessThan(150);
  });

  it('reset clears state', () => {
    const clock = fakeClock();
    const bt = new BeatTracker({ now: clock.now });
    for (let i = 0; i < 20; i++) {
      bt.tick(0.8);
      clock.advance(500);
    }
    bt.reset();
    expect(bt.bpm).toBe(0);
  });
});
