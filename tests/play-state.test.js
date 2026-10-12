import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { createPlayState } from '../src/play-state.js';

function setup() {
  const dom = new JSDOM(`<!doctype html><html class="mode-unchosen"><body>
    <span id="play-pause-icon"></span><div id="track-info"></div>
    <button id="capture-btn"></button><button id="mic-btn"></button>
    <span id="status-text"></span><div id="status-pill"><span class="status-dot"></span></div>
    <main id="stage" class="is-empty"></main><div id="dropzone"></div>
  </body></html>`);
  const listeners = new Map();
  const engine = {
    playing: false,
    activeInput: 'none',
    captureActive: false,
    micActive: false,
    on(event, listener) { listeners.set(event, listener); },
  };
  const { document } = dom.window;
  const playState = createPlayState({
    engine,
    panels: { renderQueueIfOpen() {} },
    setIcon() {},
    setToggle() {},
    getDropzone: () => document.getElementById('dropzone'),
    onTrackChange() {},
    doc: document,
  });
  return { document, engine, listeners, playState };
}

describe('first-run stage', () => {
  it('keeps the renderer waiting while the audio entry point is available', () => {
    const { document, playState } = setup();
    playState.refreshStatus();
    expect(document.documentElement.classList.contains('mode-unchosen')).toBe(true);
    expect(document.getElementById('dropzone').classList.contains('is-hidden')).toBe(false);
  });

  it.each(['track', 'mic', 'capture', 'stream', 'apple'])(
    'reveals the default visual when %s becomes the source', (source) => {
      const { document, engine, listeners } = setup();
      engine.activeInput = source;
      listeners.get('source')();
      expect(document.documentElement.classList.contains('mode-unchosen')).toBe(false);
      expect(document.getElementById('dropzone').classList.contains('is-hidden')).toBe(true);
      expect(document.getElementById('stage').classList.contains('is-empty')).toBe(false);

      engine.activeInput = 'none';
      listeners.get('state')();
      expect(document.documentElement.classList.contains('mode-unchosen')).toBe(false);
      expect(document.getElementById('dropzone').classList.contains('is-hidden')).toBe(false);
    },
  );
});

describe('screen wake lock', () => {
  it('asks for one lock even when status refreshes arrive back to back', async () => {
    const { engine, listeners } = setup();
    let requests = 0;
    const prev = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        wakeLock: {
          request: async () => {
            requests++;
            return { addEventListener() {}, release: async () => {} };
          },
        },
      },
    });
    try {
      engine.playing = true;
      listeners.get('state')();
      listeners.get('state')();
      await new Promise((r) => setTimeout(r, 0));
      expect(requests).toBe(1);
    } finally {
      if (prev) Object.defineProperty(globalThis, 'navigator', prev);
      else delete globalThis.navigator;
    }
  });
});
