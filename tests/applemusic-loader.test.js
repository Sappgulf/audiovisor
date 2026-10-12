/**
 * @vitest-environment jsdom
 *
 * The MusicKit loader. Each attempt listens for musickitloaded; every way an
 * attempt can end must take its own listener back off the window.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadMusicKit } from '../src/applemusic.js';

let added, removed;
beforeEach(() => {
  delete window.MusicKit;
  added = 0;
  removed = 0;
  const add = window.addEventListener.bind(window);
  const rm = window.removeEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, fn, opts) => {
    if (type === 'musickitloaded') added++;
    return add(type, fn, opts);
  });
  vi.spyOn(window, 'removeEventListener').mockImplementation((type, fn, opts) => {
    if (type === 'musickitloaded') removed++;
    return rm(type, fn, opts);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.head.querySelectorAll('script[src*="musickit"]').forEach((s) => s.remove());
});

describe('loadMusicKit listeners', () => {
  it('removes its listener when the attempt times out', async () => {
    vi.useFakeTimers();
    const p = loadMusicKit();
    const failed = expect(p).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15000);
    await failed;
    expect(added).toBe(1);
    expect(removed).toBe(1);
  });

  it('does not accumulate listeners across repeated timeouts', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) {
      const p = loadMusicKit();
      const failed = expect(p).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(15000);
      await failed;
    }
    expect(added).toBe(3);
    expect(removed).toBe(3);
  });

  it('resolves with MusicKit and removes its listener when it loads', async () => {
    const p = loadMusicKit();
    window.MusicKit = { configure: () => {} };
    window.dispatchEvent(new Event('musickitloaded'));
    await expect(p).resolves.toBe(window.MusicKit);
    expect(removed).toBe(added);
  });

  it('removes its listener when the script fails to load', async () => {
    const p = loadMusicKit();
    const failed = expect(p).rejects.toThrow('Failed to load Apple MusicKit');
    document.head.querySelector('script[src*="musickit"]').dispatchEvent(new Event('error'));
    await failed;
    expect(removed).toBe(added);
  });
});
