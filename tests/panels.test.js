/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createPanels } from '../src/panels.js';

beforeEach(() => {
  document.open(); document.write(readFileSync('index.html', 'utf8')); document.close();
  localStorage.clear();
  window.matchMedia = vi.fn(() => ({ matches: false }));
});

const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

function setup(queue = [{ meta: { name: 'one', duration: 12 }, buffer: {} }]) {
  const shell = document.getElementById('shell');
  const triggerQueue = document.createElement('button');
  const triggerLibrary = document.createElement('button');
  document.body.append(triggerQueue, triggerLibrary);
  const engine = { queue, queueIndex: 0 };
  const panels = createPanels({
    shell,
    engine,
    toast: vi.fn(),
    setToggle: (el, on, cls) => el?.classList.toggle(cls || 'is-on', on),
    setFx: vi.fn(),
    triggerQueue,
    triggerLibrary,
    saveLibraryBtn: null,
  });
  return { panels, engine, triggerQueue, triggerLibrary };
}

describe('queue and library panels', () => {
  it('are mutually exclusive, including their aria-hidden state', async () => {
    const { panels } = setup();
    panels.toggleQueue(true);
    expect(panels.isQueueOpen()).toBe(true);
    expect(panels.queuePanel.getAttribute('aria-hidden')).toBe('false');

    panels.toggleLibrary(true);
    await frame();
    expect(panels.isLibraryOpen()).toBe(true);
    expect(panels.isQueueOpen()).toBe(false);
    expect(panels.queuePanel.getAttribute('aria-hidden')).toBe('true');
    expect(panels.libraryPanel.getAttribute('aria-hidden')).toBe('false');

    panels.toggleQueue(true);
    await frame();
    expect(panels.isQueueOpen()).toBe(true);
    expect(panels.isLibraryOpen()).toBe(false);
    expect(panels.libraryPanel.getAttribute('aria-hidden')).toBe('true');
  });

  it('hands focus to the newly opened panel when switching', async () => {
    const { panels, triggerQueue, triggerLibrary } = setup();
    triggerQueue.focus();
    panels.toggleQueue(true);
    await frame();
    panels.toggleLibrary(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await frame();
    expect(panels.libraryPanel.contains(document.activeElement)).toBe(true);
    panels.toggleLibrary(false);
    await frame();
    expect(document.activeElement).toBe(triggerLibrary);
  });

  it('restores focus to the trigger when the queue closes', async () => {
    const { panels, triggerQueue } = setup();
    triggerQueue.focus();
    panels.toggleQueue(true);
    await frame();
    expect(panels.queuePanel.contains(document.activeElement)).toBe(true);
    panels.toggleQueue(false);
    await frame();
    expect(document.activeElement).toBe(triggerQueue);
  });

  it('focuses the close button when an empty queue opens', async () => {
    const { panels } = setup([]);
    panels.toggleQueue(true);
    await frame();
    expect(document.activeElement.id).toBe('queue-close-btn');
  });

  it('closes on Escape and consumes the event', async () => {
    const { panels } = setup();
    panels.toggleQueue(true);
    await frame();
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(panels.isQueueOpen()).toBe(false);
  });
});
