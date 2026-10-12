import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSleepTimer } from '../src/sleep-timer.js';

/* The engine's side of the contract: `volume` is the listener's choice,
   `setOutputScale` is the fade, and `pause` stops playback. */
function fakeEngine(volume = 0.8) {
  return {
    volume,
    playing: true,
    micActive: false,
    captureActive: false,
    scale: 1,
    scaleLog: [],
    setVolume(v) { this.volume = v; },
    setOutputScale(k) { this.scale = k; this.scaleLog.push(k); },
    pause() { this.playing = false; },
  };
}

function setup(engine) {
  const toast = vi.fn();
  const timer = createSleepTimer({
    engine, toast, refreshStatus: vi.fn(), saveSettings: vi.fn(),
    volumeFill: null, chip: null, label: null,
  });
  return { timer, toast };
}

describe('sleep timer fade', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('fades the output down, pauses, and restores full output', async () => {
    const e = fakeEngine(0.8);
    const { timer, toast } = setup(e);
    const done = timer.fire();
    await vi.advanceTimersByTimeAsync(8000);
    await done;
    expect(e.playing).toBe(false);
    expect(e.scale).toBe(1);
    expect(e.volume).toBe(0.8);
    const fade = e.scaleLog.slice(0, 10).map((k) => Math.round(k * 10) / 10);
    expect(fade).toEqual([1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1]);
    expect(toast).toHaveBeenCalled();
  });

  it('keeps a volume change made during the fade', async () => {
    const e = fakeEngine(0.8);
    const { timer } = setup(e);
    const done = timer.fire();
    await vi.advanceTimersByTimeAsync(2000);   // a few steps in
    e.setVolume(0.4);                          // the listener moves the slider
    await vi.advanceTimersByTimeAsync(8000);
    await done;
    expect(e.volume).toBe(0.4);
    expect(e.scale).toBe(1);
  });

  it('never writes the faded level into the user volume', async () => {
    const e = fakeEngine(0.8);
    const { timer } = setup(e);
    const seenVolume = [];
    const scale = e.setOutputScale.bind(e);
    e.setOutputScale = (k) => { seenVolume.push(e.volume); scale(k); };
    const done = timer.fire();
    await vi.advanceTimersByTimeAsync(3000);
    // a page closed here would save the volume it has now
    expect(e.volume).toBe(0.8);
    await vi.advanceTimersByTimeAsync(8000);
    await done;
    expect(seenVolume.every((v) => v === 0.8)).toBe(true);
  });

  it('a chip press during the fade cancels it: playback keeps going at full output', async () => {
    const e = fakeEngine(0.8);
    let press = null;
    const chip = { addEventListener: (_ev, fn) => { press = fn; } };
    const timer = createSleepTimer({
      engine: e, toast: vi.fn(), refreshStatus: vi.fn(), saveSettings: vi.fn(),
      volumeFill: null, chip, label: null,
    });
    const done = timer.fire();
    await vi.advanceTimersByTimeAsync(2000);
    press();                                   // the user turns the timer off
    await vi.advanceTimersByTimeAsync(9000);
    await done;
    expect(e.playing).toBe(true);
    expect(e.scale).toBe(1);
  });

  it('restores full output even when playback stopped before the fade', async () => {
    const e = fakeEngine(0.6);
    e.playing = false;
    e.scale = 0.5;
    const { timer } = setup(e);
    await timer.fire();
    expect(e.scale).toBe(1);
    expect(e.volume).toBe(0.6);
  });
});
