/**
 * @vitest-environment jsdom
 *
 * Queue and library are modal dialogs: Tab stays inside the open one, focus
 * that wanders out is brought back, Escape closes, and focus returns to the
 * button that opened the panel.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/library.js', () => ({
  listLibraryMeta: async () => [{ id: 'a1', name: 'Alpha', ext: 'WAV', duration: 3 }],
  getLibraryEntry: async () => null,
  removeFromLibrary: async () => {},
  renderRemixToWav: async () => new Blob(),
}));
const { createPanels } = await import('../src/panels.js');

let engine, panels, queueBtn, libraryBtn;

function mount(queue = [{ meta: { name: 'One', duration: 5 } }, { meta: { name: 'Two', duration: 6 } }]) {
  document.body.innerHTML = '<button id="queue-btn">Q</button><button id="library-btn">L</button><div id="shell"></div>';
  engine = {
    captureActive: false, micActive: false, mode: 'file', queue, queueIndex: 0,
    removeFromQueue: vi.fn(), shuffleQueue: vi.fn(), clearQueue: vi.fn(), playTrack: vi.fn(),
  };
  queueBtn = document.getElementById('queue-btn');
  libraryBtn = document.getElementById('library-btn');
  panels = createPanels({
    shell: document.getElementById('shell'), engine, toast: vi.fn(), setToggle: vi.fn(),
    triggerQueue: queueBtn, triggerLibrary: libraryBtn, saveLibraryBtn: null,
  });
  panels.renderQueue();
}

/** Let the rAF focus call and the library's async render settle. */
const settle = () => new Promise((r) => setTimeout(r, 20));

function press(target, key, opts = {}) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  target.dispatchEvent(e);
  return e;
}

describe('queue dialog focus', () => {
  beforeEach(() => { mount(); });

  it('moves focus into the dialog on open', async () => {
    panels.toggleQueue(true);
    await settle();
    expect(panels.queuePanel.contains(document.activeElement)).toBe(true);
  });

  it('wraps Tab from the last control to the first', async () => {
    panels.toggleQueue(true);
    await settle();
    const items = panels.queuePanel.querySelectorAll('button:not([disabled]), input, [tabindex="0"]');
    items[items.length - 1].focus();
    const e = press(items[items.length - 1], 'Tab');
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[0]);
  });

  it('wraps Shift+Tab from the first control to the last', async () => {
    panels.toggleQueue(true);
    await settle();
    const items = panels.queuePanel.querySelectorAll('button:not([disabled]), input, [tabindex="0"]');
    items[0].focus();
    press(items[0], 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('pulls focus back in when it lands outside the open dialog', async () => {
    panels.toggleQueue(true);
    await settle();
    queueBtn.focus();
    expect(panels.queuePanel.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape and returns focus to the queue button', async () => {
    panels.toggleQueue(true);
    await settle();
    press(document.activeElement, 'Escape');
    expect(panels.isQueueOpen()).toBe(false);
    expect(document.activeElement).toBe(queueBtn);
  });

  it('returns focus to the trigger when closed by its toggle', async () => {
    panels.toggleQueue(true);
    await settle();
    panels.toggleQueue(false);
    expect(document.activeElement).toBe(queueBtn);
  });

  it('still takes focus on open when the queue is empty', async () => {
    mount([]);
    panels.toggleQueue(true);
    await settle();
    expect(panels.queuePanel.contains(document.activeElement)).toBe(true);
  });
});

describe('library dialog focus', () => {
  beforeEach(() => { mount(); });

  it('opens on the search field and wraps Tab inside the dialog', async () => {
    panels.toggleLibrary(true);
    await settle();
    const search = panels.libraryPanel.querySelector('#lib-search');
    expect(document.activeElement).toBe(search);
    const last = panels.libraryPanel.querySelector('.library-row .lib-del');
    last.focus();
    press(last, 'Tab');
    expect(panels.libraryPanel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(last);
  });

  it('closes on Escape from a row and returns focus to the library button', async () => {
    panels.toggleLibrary(true);
    await settle();
    const row = panels.libraryPanel.querySelector('.library-row');
    row.focus();
    press(row, 'Escape');
    expect(panels.isLibraryOpen()).toBe(false);
    expect(document.activeElement).toBe(libraryBtn);
  });

  it('closes on Escape from the search field and returns focus to the library button', async () => {
    panels.toggleLibrary(true);
    await settle();
    const search = panels.libraryPanel.querySelector('#lib-search');
    expect(document.activeElement).toBe(search);
    press(search, 'Escape');
    expect(panels.isLibraryOpen()).toBe(false);
    expect(document.activeElement).toBe(libraryBtn);
  });
});
