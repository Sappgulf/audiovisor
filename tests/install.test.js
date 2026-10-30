/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '';
});

async function load() {
  return import('../src/install.js');
}

describe('install prompt', () => {
  it('has nothing to offer before the browser fires beforeinstallprompt', async () => {
    const install = await load();
    expect(install.canInstall()).toBe(false);
    await expect(install.promptInstall()).resolves.toBe('unavailable');
  });

  it('holds the deferred event and reports the accepted outcome', async () => {
    const install = await load();
    const event = new Event('beforeinstallprompt');
    event.prompt = vi.fn(() => Promise.resolve());
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(event);
    expect(install.canInstall()).toBe(true);
    await expect(install.promptInstall()).resolves.toBe('accepted');
    expect(event.prompt).toHaveBeenCalled();
    expect(install.canInstall()).toBe(false);
  });

  it('reports a dismissed choice and clears the one-shot prompt', async () => {
    const install = await load();
    const event = new Event('beforeinstallprompt');
    event.prompt = vi.fn(() => Promise.resolve());
    event.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(event);
    await expect(install.promptInstall()).resolves.toBe('dismissed');
    expect(install.canInstall()).toBe(false);
  });
});
