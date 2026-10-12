import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAutopilot } from '../src/autopilot.js';

afterEach(() => vi.useRealTimers());

describe('autopilot', () => {
  it('turning it on while already on keeps a single cycling timer', () => {
    vi.useFakeTimers();
    const state = {};
    const randomizeLook = vi.fn();
    const ap = createAutopilot({
      state, chip: null, shuffleBtn: null,
      toast: () => {}, setToggle: () => {}, saveSettings: () => {}, randomizeLook,
    });
    ap.setAutopilot(true);
    ap.setAutopilot(true);
    randomizeLook.mockClear();
    vi.advanceTimersByTime(12000);
    expect(randomizeLook).toHaveBeenCalledTimes(1);
    ap.setAutopilot(false);
    expect(state.autopilotTimer).toBeNull();
  });
});
