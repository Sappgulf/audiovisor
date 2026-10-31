/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAutopilot } from '../src/autopilot.js';

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<button id="auto"></button><button id="shuffle"><span class="tool-note"></span></button>';
});
afterEach(() => vi.useRealTimers());

function setup() {
  const state = { autopilot: false, autopilotTimer: null };
  const randomizeLook = vi.fn();
  const toast = vi.fn();
  const saveSettings = vi.fn();
  const setToggle = vi.fn();
  const autopilot = createAutopilot({
    state,
    chip: document.getElementById('auto'),
    shuffleBtn: document.getElementById('shuffle'),
    toast,
    setToggle,
    saveSettings,
    randomizeLook,
  });
  return { state, randomizeLook, toast, saveSettings, setToggle, autopilot };
}

describe('autopilot', () => {
  it('turns on, randomises immediately and again every 12s', () => {
    const { state, randomizeLook, autopilot } = setup();
    autopilot.setAutopilot(true);
    expect(state.autopilot).toBe(true);
    expect(randomizeLook).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(12000);
    expect(randomizeLook).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(12000);
    expect(randomizeLook).toHaveBeenCalledTimes(3);
  });

  it('turns off, clears the timer and updates the menu note', () => {
    const { state, autopilot } = setup();
    autopilot.setAutopilot(true);
    autopilot.setAutopilot(false);
    expect(state.autopilot).toBe(false);
    expect(state.autopilotTimer).toBeNull();
    expect(document.querySelector('.tool-note').textContent).toBe('Cycle modes and themes');
    vi.advanceTimersByTime(36000);
    expect(state.autopilotTimer).toBeNull();
  });

  it('silent restore does not toast', () => {
    const { autopilot, toast } = setup();
    autopilot.setAutopilot(true, { silent: true });
    autopilot.setAutopilot(false, { silent: true });
    expect(toast).not.toHaveBeenCalled();
  });
});
