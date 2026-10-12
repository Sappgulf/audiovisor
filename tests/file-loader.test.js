import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createFileLoader, MAX_FILE_BYTES } from '../src/file-loader.js';
import { ACCEPT_ATTR } from '../src/formats.js';

/* The loader only needs a handful of engine methods. addToQueue is supplied by
   each test; tests reach the engine through `s.engine` after setup. */
function setup(addToQueue = async () => [], extra = {}) {
  const dom = new JSDOM(`<!doctype html><body>
    <input id="file-input" type="file">
    <div id="dropzone"><div class="dropzone"></div></div>
    <span id="status-text"></span><div id="status-pill"></div>
    <main id="stage"></main>
  </body>`);
  const doc = dom.window.document;
  const engine = {
    captureActive: false, hasTrack: false, track: null, evicted: 0,
    isExternal: () => false,
    toggleCapture: vi.fn(), stopStream: vi.fn(), pause: vi.fn(), play: vi.fn(),
    addToQueue: vi.fn(addToQueue),
  };
  const toast = vi.fn();
  const updateTrackUI = vi.fn();
  const ensureAudible = vi.fn();
  const loader = createFileLoader({
    engine, toast, updateTrackUI, ensureAudible, closeMore() {}, doc, ...extra,
  });
  return { doc, win: doc.defaultView, engine, toast, loader, updateTrackUI, ensureAudible };
}

/* a File-like stand-in: the loader reads name, size and type, and the engine
   (stubbed here) is the only thing that would call arrayBuffer() */
function file(name, { size = 1000, type = '', text } = {}) {
  return { name, size, type, arrayBuffer: vi.fn(async () => new ArrayBuffer(8)), text: text === undefined ? undefined : async () => text };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const toastText = (toast) => toast.mock.calls.map((c) => c[0]).join('\n');

describe('file loading', () => {
  it('a batch that decodes to nothing leaves the status line on a failure, not "Decoding"', async () => {
    const s = setup(async () => []);
    await s.loader.loadFiles([{ name: 'bad.mp3', type: 'audio/mpeg' }]);
    expect(s.doc.getElementById('status-text').textContent).toBe('Decode failed');
    expect(s.toast).toHaveBeenCalled();
  });

  it('points the picker at the shared accept list', () => {
    const s = setup();
    expect(s.doc.getElementById('file-input').accept).toBe(ACCEPT_ATTR);
  });

  it('hands video files to the engine, whose decode takes their audio track', async () => {
    const s = setup(async () => { s.engine.hasTrack = true; return []; });
    const mp4 = file('concert.mp4', { type: 'video/mp4' });
    await s.loader.loadFiles([mp4]);
    expect(s.engine.addToQueue).toHaveBeenCalledWith([mp4]);
    expect(s.engine.play).toHaveBeenCalled();
  });

  it('refuses a file that is neither media nor a playlist, without touching the engine', async () => {
    const s = setup();
    await s.loader.loadFiles([file('notes.txt', { type: 'text/plain' })]);
    expect(s.engine.addToQueue).not.toHaveBeenCalled();
    expect(toastText(s.toast)).toMatch(/Unsupported/);
  });

  it('rejects an oversized file before the engine reads it, naming the limit and the size', async () => {
    const limit = 1048576;
    const s = setup(async () => [], { maxFileBytes: limit });
    const big = file('huge.mp3', { size: 3 * limit });
    await s.loader.loadFiles([big]);
    expect(big.arrayBuffer).not.toHaveBeenCalled();
    expect(s.engine.addToQueue).not.toHaveBeenCalled();
    expect(toastText(s.toast)).toMatch(/3\.0 MB/);
    expect(toastText(s.toast)).toMatch(/limit is 1\.0 MB/);
  });

  it('still loads a file exactly at the limit, and the default limit is 250 MB', async () => {
    expect(MAX_FILE_BYTES).toBe(250 * 1024 * 1024);
    const limit = 1048576;
    const s = setup(async () => { s.engine.hasTrack = true; return []; }, { maxFileBytes: limit });
    await s.loader.loadFiles([file('edge.mp3', { size: limit })]);
    expect(s.engine.addToQueue).toHaveBeenCalledTimes(1);
  });

  it('says a zero-byte file is empty instead of reporting a decode failure', async () => {
    const s = setup();
    await s.loader.loadFiles([file('blank.wav', { size: 0 })]);
    expect(s.engine.addToQueue).not.toHaveBeenCalled();
    expect(toastText(s.toast)).toMatch(/is empty/);
  });

  it('does not leave the status on "Decoding" after a successful load', async () => {
    // the engine here never emits a status update, so the loader must not leave its own placeholder behind
    const s = setup(async () => { s.engine.hasTrack = true; s.engine.track = { name: 'song' }; return []; });
    s.doc.getElementById('status-text').textContent = 'Ready · Add audio';
    await s.loader.loadFiles([file('song.mp3')]);
    expect(s.doc.getElementById('status-text').textContent).toBe('Ready · Add audio');
    expect(toastText(s.toast)).toMatch(/Loaded <b>song<\/b>/);
  });

  it('runs loads one after another, so a second drop cannot interleave with the first', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const order = [];
    const s = setup(async (files) => {
      const name = files[0].name;
      order.push(`start:${name}`);
      if (name === 'a.mp3') await gate;
      order.push(`end:${name}`);
      s.engine.hasTrack = true;
      return [];
    });
    const first = s.loader.loadFiles([file('a.mp3')]);
    const second = s.loader.loadFiles([file('b.mp3')]);
    await flush();
    expect(order).toEqual(['start:a.mp3']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['start:a.mp3', 'end:a.mp3', 'start:b.mp3', 'end:b.mp3']);
  });

  it('keeps the playing track when every new file fails', async () => {
    const s = setup(async () => [{ name: 'bad.mp3', error: { name: 'EncodingError' } }]);
    s.engine.hasTrack = true;
    s.engine.track = { name: 'Current' };
    await s.loader.loadFiles([file('bad.mp3')]);
    expect(s.engine.play).not.toHaveBeenCalled();
    expect(s.doc.querySelector('#dropzone').classList.contains('is-hidden')).toBe(false);
    expect(toastText(s.toast)).toMatch(/Decode failed/);
    expect(toastText(s.toast)).not.toMatch(/Loaded/);
  });

  it('explains an EncodingError on audio as a browser that cannot decode it', async () => {
    const s = setup(async () => [{ name: 'odd.flac', error: { name: 'EncodingError' } }]);
    await s.loader.loadFiles([file('odd.flac')]);
    expect(toastText(s.toast)).toMatch(/can't decode/);
  });

  it('explains an EncodingError on video as a file with no decodable audio track', async () => {
    const s = setup(async () => [{ name: 'clip.mp4', error: { name: 'EncodingError' } }]);
    await s.loader.loadFiles([file('clip.mp4')]);
    expect(toastText(s.toast)).toMatch(/no audio track/);
  });

  it('reports a failure without an error object as corrupt, not as unsupported', async () => {
    const s = setup(async () => ['broken.ogg']);
    await s.loader.loadFiles([file('broken.ogg')]);
    expect(toastText(s.toast)).toMatch(/may be corrupt/);
  });

  it('escapes file names in toasts, so a crafted name cannot inject markup', async () => {
    const evil = '<img src=x onerror=alert(1)>.mp3';
    const s = setup(async () => [{ name: evil, error: { name: 'EncodingError' } }]);
    await s.loader.loadFiles([file(evil)]);
    expect(toastText(s.toast)).not.toMatch(/<img/);
    expect(toastText(s.toast)).toMatch(/&lt;img/);
  });

  it('reads a playlist and hands its links to onPlaylist, without touching the engine', async () => {
    const onPlaylist = vi.fn();
    const s = setup(undefined, { onPlaylist });
    const m3u = file('list.m3u', { text: '#EXTM3U\n#EXTINF:-1,Night\nhttps://example.test/night.mp3\n' });
    await s.loader.loadFiles([m3u]);
    expect(onPlaylist).toHaveBeenCalledWith([{ name: 'Night', url: 'https://example.test/night.mp3' }], 'list.m3u', 0);
    expect(s.engine.addToQueue).not.toHaveBeenCalled();
  });

  it('says so when a playlist has no web links, instead of staying silent', async () => {
    const s = setup();
    await s.loader.loadFiles([file('local.pls', { text: '[playlist]\nFile1=/Users/me/song.mp3\n' })]);
    expect(toastText(s.toast)).toMatch(/no web links/);
  });
});

describe('drag and drop', () => {
  const fire = (target, type, extra = {}) => {
    const ev = new target.ownerDocument.defaultView.Event(type, { bubbles: true, cancelable: true });
    Object.assign(ev, extra);
    target.dispatchEvent(ev);
    return ev;
  };

  it('accepts a drag over the page by calling preventDefault on dragover', () => {
    const s = setup();
    const ev = fire(s.doc.body, 'dragover', { dataTransfer: { dropEffect: 'none' } });
    expect(ev.defaultPrevented).toBe(true);
  });

  it('keeps the overlay while the pointer moves between child elements', () => {
    const s = setup();
    const card = s.doc.querySelector('.dropzone');
    const child = s.doc.createElement('span');
    card.appendChild(child);
    fire(card, 'dragenter');   // pointer enters the card
    fire(child, 'dragenter');  // then a child element
    fire(card, 'dragleave');   // and leaves the card for that child
    expect(card.classList.contains('drag-over')).toBe(true);
    fire(child, 'dragleave');  // finally leaves the card entirely
    expect(card.classList.contains('drag-over')).toBe(false);
  });

  it('clears the overlay on drop, and loads the dropped files', async () => {
    const s = setup(async () => { s.engine.hasTrack = true; return []; });
    const card = s.doc.querySelector('.dropzone');
    fire(card, 'dragenter');
    const mp3 = file('dropped.mp3');
    fire(card, 'drop', { dataTransfer: { files: [mp3], items: [] } });
    expect(card.classList.contains('drag-over')).toBe(false);
    await flush();
    expect(s.engine.addToQueue).toHaveBeenCalledWith([mp3]);
  });
});
