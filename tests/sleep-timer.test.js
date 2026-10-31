/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSleepTimer } from '../src/sleep-timer.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-30T20:00:00Z'));
  document.body.innerHTML = '<button id="sleep"></button><span id="label"></span><div id="fill"></div>';
});
afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const engine = { volume: 0.8, playing: false, micActive: false, captureActive: false, pause: vi.fn(), setVolume: vi.fn() };
  const toast = vi.fn();
  const refreshStatus = vi.fn();
  const saveSettings = vi.fn();
  const timer = createSleepTimer({
    engine,
    toast,
    refreshStatus,
    saveSettings,
    volumeFill: document.getElementById('fill'),
    chip: document.getElementById('sleep'),
    label: document.getElementById('label'),
  });
  return { engine, toast, refreshStatus, saveSettings, timer };
}

describe('sleep timer', () => {
  it('cycles off → 15 → 30 → 60 → off', () => {
    const { timer } = setup();
    const chip = document.getElementById('sleep');
    const label = document.getElementById('label');
    chip.click(); expect(label.textContent).toBe('Sleep 15m');
    chip.click(); expect(label.textContent).toBe('Sleep 30m');
    chip.click(); expect(label.textContent).toBe('Sleep 60m');
    chip.click(); expect(label.textContent).toBe('Sleep');
    expect(timer).toBeTruthy();
  });

  it('fades out, pauses and restores volume when fired', async () => {
    const { engine, refreshStatus, saveSettings, timer } = setup();
    await timer.fire();
    expect(engine.pause).toHaveBeenCalled();
    expect(engine.setVolume).toHaveBeenCalledWith(0.8);
    expect(refreshStatus).toHaveBeenCalled();
    expect(saveSettings).toHaveBeenCalled();
  });

  it('shows seconds inside the last minute', () => {
    const { timer } = setup();
    document.getElementById('sleep').click(); // 15m
    vi.advanceTimersByTime(14 * 60000 + 30000);
    expect(document.getElementById('label').textContent).toMatch(/^\d+s$/);
    expect(timer).toBeTruthy();
  });
});
