/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createToasts } from '../src/toast.js';

describe('createToasts', () => {
  let root;
  let toast;

  beforeEach(() => {
    document.body.innerHTML = '<div id="toasts"></div>';
    root = document.getElementById('toasts');
    // only the timers — fake rAF would queue the reveal instead of running it
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('requestAnimationFrame', (cb) => { cb(0); return 0; });
    toast = createToasts(root);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('appends a toast carrying the given markup', () => {
    toast('Hello <b>world</b>');
    expect(root.children).toHaveLength(1);
    expect(root.firstChild.classList.contains('toast')).toBe(true);
    expect(root.firstChild.innerHTML).toBe('Hello <b>world</b>');
  });

  it('reveals the toast on the next frame', () => {
    toast('x');
    expect(root.firstChild.classList.contains('is-visible')).toBe(true);
  });

  it('removes the toast once its duration elapses', () => {
    toast('bye', { duration: 1000 });
    vi.advanceTimersByTime(1000);
    expect(root.firstChild.classList.contains('is-leaving')).toBe(true);
    vi.advanceTimersByTime(350);
    expect(root.children).toHaveLength(0);
  });

  it('defaults the duration to 2.4s', () => {
    toast('default');
    vi.advanceTimersByTime(2399);
    expect(root.children).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(root.firstChild.classList.contains('is-leaving')).toBe(true);
  });

  it('never stacks more than three at once', () => {
    for (let i = 0; i < 5; i++) toast(`t${i}`);
    expect(root.children).toHaveLength(3);
    expect([...root.children].map((el) => el.textContent)).toEqual(['t2', 't3', 't4']);
  });
});
