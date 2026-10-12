/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* The About module counts as fetched when its factory runs. Each test gets a
   fresh registry and a fresh mock, so the count starts at zero. */
const loads = vi.hoisted(() => ({ count: 0, fail: false }));

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('About dialog is loaded on demand', () => {
  let mod;
  let shell;
  let trigger;
  let toast;

  beforeEach(async () => {
    vi.resetModules();
    loads.count = 0;
    loads.fail = false;
    vi.doMock('../src/about.js', async (importOriginal) => {
      loads.count++;
      if (loads.fail) throw new Error('offline');
      return importOriginal();
    });
    document.body.innerHTML = '<div id="shell"></div><button id="nav-about" aria-expanded="false"></button>';
    shell = document.getElementById('shell');
    trigger = document.getElementById('nav-about');
    toast = vi.fn();
    mod = await import('../src/about-loader.js');
  });

  afterEach(() => {
    vi.doUnmock('../src/about.js');
  });

  function make() {
    return mod.createAboutLoader({ shell, trigger, modeCount: 22, themeCount: 25, toast });
  }

  it('creating the loader does not request about.js or build the panel', async () => {
    make();
    await settle();
    expect(loads.count).toBe(0);
    expect(shell.querySelector('#about-panel')).toBeNull();
  });

  it('the first click requests about.js once and opens the dialog', async () => {
    const about = make();
    trigger.click();
    await settle();
    expect(loads.count).toBe(1);
    expect(shell.querySelector('#about-panel')).not.toBeNull();
    expect(about.isOpen()).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('after the first open, the dialog toggles once per click', async () => {
    const about = make();
    trigger.click();
    await settle();
    trigger.click();
    await settle();
    expect(loads.count).toBe(1);
    expect(about.isOpen()).toBe(false);
    trigger.click();
    await settle();
    expect(about.isOpen()).toBe(true);
  });

  it('a second click before the module lands cancels the first', async () => {
    const about = make();
    trigger.click();
    trigger.click();
    await settle();
    expect(loads.count).toBe(1);
    expect(about.isOpen()).toBe(false);
  });

  it('the keyboard path reads and closes the dialog through the forwarding object', async () => {
    const about = make();
    expect(about.isOpen()).toBe(false);
    trigger.click();
    await settle();
    expect(about.isOpen()).toBe(true);
    about.setOpen(false);
    expect(about.isOpen()).toBe(false);
  });

  it('a failed fetch toasts and the next click retries', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      make();
      loads.fail = true;
      trigger.click();
      await settle();
      expect(toast).toHaveBeenCalledWith(expect.stringContaining('About unavailable'), expect.anything());
      expect(shell.querySelector('#about-panel')).toBeNull();

      loads.fail = false;
      trigger.click();
      await settle();
      expect(shell.querySelector('#about-panel')).not.toBeNull();
    } finally { err.mockRestore(); }
  });
});
