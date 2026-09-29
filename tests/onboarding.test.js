/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOnboarding } from '../src/onboarding.js';

describe('first-run onboarding', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<button id="tour-replay">Replay tour</button>';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps keyboard hints off a touch first-run screen and gives touch help on replay', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const toast = vi.fn();
    createOnboarding({ toast, modeCount: 23, themeCount: 32 });
    vi.runAllTimers();
    expect(toast).not.toHaveBeenCalled();
    expect(localStorage.getItem('audiovisor.tour')).toBeNull();

    document.getElementById('tour-replay').click();
    vi.runAllTimers();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toContain('Browse files');
    expect(toast.mock.calls[0][0]).not.toContain('Space');
  });

  it('still introduces shortcuts on a desktop first run', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const toast = vi.fn();
    createOnboarding({ toast, modeCount: 23, themeCount: 32 });
    vi.advanceTimersByTime(800);
    expect(toast.mock.calls[0][0]).toContain('Space');
    expect(localStorage.getItem('audiovisor.tour')).toBe('1');
  });
});
