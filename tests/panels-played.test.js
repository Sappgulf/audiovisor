/**
 * @vitest-environment jsdom
 *
 * Queue panel: the Clear played button is enabled only when something before
 * the current track exists, and pressing it removes those entries.
 */
import { describe, it, expect, vi } from 'vitest';
const { createPanels } = await import('../src/panels.js');

let engine;
let shell;

function mount(queueIndex, names = ['a', 'b', 'c']) {
  document.body.innerHTML = '<button id="queue-btn"></button><button id="library-btn"></button><div id="shell"></div>';
  shell = document.getElementById('shell');
  engine = {
    captureActive: false, micActive: false, mode: 'file', queueIndex,
    queue: names.map((name) => ({ meta: { name, duration: 60 } })),
    removeFromQueue: vi.fn((i) => {
      engine.queue.splice(i, 1);
      if (i < engine.queueIndex) engine.queueIndex--;
    }),
  };
  const panels = createPanels({
    shell, engine, toast: vi.fn(), setToggle: vi.fn(),
    triggerQueue: document.getElementById('queue-btn'),
    triggerLibrary: document.getElementById('library-btn'),
    saveLibraryBtn: null,
  });
  panels.renderQueue();
  return panels;
}

describe('Clear played button', () => {
  it('is disabled when the current track is the first', () => {
    mount(0);
    expect(shell.querySelector('#queue-played-btn').disabled).toBe(true);
  });

  it('is enabled once a track before the current one exists', () => {
    mount(2);
    expect(shell.querySelector('#queue-played-btn').disabled).toBe(false);
  });

  it('removes the played tracks and re-renders the queue', async () => {
    mount(2);
    shell.querySelector('#queue-played-btn').click();
    await vi.waitFor(() => expect(engine.removeFromQueue).toHaveBeenCalledTimes(2));
    expect(engine.queue.map((q) => q.meta.name)).toEqual(['c']);
    await vi.waitFor(() => expect(shell.querySelectorAll('.queue-row').length).toBe(1));
  });
});
