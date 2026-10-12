import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createFileLoader } from '../src/file-loader.js';

function setup(addToQueue) {
  const dom = new JSDOM(`<!doctype html><body>
    <input id="file-input" type="file">
    <div id="dropzone"><div class="dropzone"></div></div>
    <span id="status-text"></span><div id="status-pill"></div>
    <main id="stage"></main>
  </body>`);
  const doc = dom.window.document;
  const engine = {
    captureActive: false, hasTrack: false, track: null, evicted: 0,
    isExternal: () => false, stopStream() {}, pause() {}, play() {},
    addToQueue,
  };
  const toast = vi.fn();
  const loader = createFileLoader({
    engine, toast, updateTrackUI() {}, ensureAudible() {}, closeMore() {}, doc,
  });
  return { doc, engine, toast, loader };
}

describe('file loading', () => {
  it('a batch that decodes to nothing leaves the status line on a failure, not "Decoding"', async () => {
    const { doc, loader, toast } = setup(async () => []);
    await loader.loadFiles([{ name: 'bad.mp3', type: 'audio/mpeg' }]);
    expect(doc.getElementById('status-text').textContent).toBe('Decode failed');
    expect(toast).toHaveBeenCalled();
  });
});
