/**
 * @vitest-environment jsdom
 *
 * Queue panel: importing a playlist file as stream items, and playing a stream
 * row. The real parser (src/playlist.js) runs here; the engine is a stand-in.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { createPanels } = await import('../src/panels.js');

let shell, engine, toast, panels;

const PLAYLIST = [
  '#EXTM3U',
  '#EXTINF:-1,Alpha',
  'https://cdn.example.test/a.mp3',
  '#EXTINF:-1,Local',
  'file:///etc/passwd',
  '#EXTINF:-1,Beta',
  'http://radio.example.test/b.m3u8',
].join('\n');

function makeEngine({ withAddUrl = true } = {}) {
  const e = {
    captureActive: false,
    micActive: false,
    mode: 'file',
    queue: [],
    queueIndex: -1,
    playUrl: vi.fn(async () => {}),
    toggleCapture: vi.fn(async () => false),
    toggleMic: vi.fn(async () => false),
  };
  if (withAddUrl) e.addUrlItems = vi.fn((items) => { e.queue.push(...items); });
  return e;
}

function mount({ withAddUrl = true } = {}) {
  document.body.innerHTML = '<button id="queue-btn"></button><button id="library-btn"></button><div id="shell"></div>';
  shell = document.getElementById('shell');
  engine = makeEngine({ withAddUrl });
  toast = vi.fn();
  panels = createPanels({
    shell, engine, toast, setToggle: vi.fn(),
    triggerQueue: document.getElementById('queue-btn'),
    triggerLibrary: document.getElementById('library-btn'),
    saveLibraryBtn: null,
  });
  panels.renderQueue();
}

/** Press Import and wait for the lazily loaded picker to appear. */
async function openPicker() {
  shell.querySelector('#queue-import-btn').click();
  await vi.waitFor(() => expect(shell.querySelector('#playlist-file')).not.toBeNull());
  return shell.querySelector('#playlist-file');
}

/** Pick a file the way the browser does: set `files` and fire change. */
async function pick(file) {
  const input = await openPicker();
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(toast).toHaveBeenCalled());
}

const playlistFile = (text, name = 'mix.m3u') => new File([text], name, { type: 'audio/x-mpegurl' });

beforeEach(() => {
  mount();
});

describe('queue import action', () => {
  it('offers an Import button in the queue header', () => {
    expect(shell.querySelector('#queue-import-btn')).not.toBeNull();
  });

  it('opens a picker that takes only .m3u, .m3u8 and .pls', async () => {
    const input = await openPicker();
    expect(input.type).toBe('file');
    expect(input.accept).toBe('.m3u,.m3u8,.pls');
    expect(input.hidden).toBe(true);
  });

  it('clicks the picker when Import is pressed', async () => {
    const input = await openPicker();
    const spy = vi.spyOn(input, 'click').mockImplementation(() => {});
    shell.querySelector('#queue-import-btn').click();
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
  });
});

describe('importing a playlist', () => {
  it('queues each web URL as a stream item and drops non-web targets', async () => {
    await pick(playlistFile(PLAYLIST));
    expect(engine.addUrlItems).toHaveBeenCalledTimes(1);
    const items = engine.addUrlItems.mock.calls[0][0];
    expect(items.map((i) => i.url)).toEqual([
      'https://cdn.example.test/a.mp3',
      'http://radio.example.test/b.m3u8',
    ]);
    expect(items[0].meta).toMatchObject({ name: 'Alpha', ext: 'STREAM' });
  });

  it('reports the count in a toast', async () => {
    await pick(playlistFile(PLAYLIST));
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Imported <b>2</b> tracks'), expect.anything());
  });

  it('shows the new entries in the queue', async () => {
    await pick(playlistFile(PLAYLIST));
    expect(shell.querySelectorAll('.queue-row')).toHaveLength(2);
  });

  it('says clearly when nothing usable was found', async () => {
    await pick(playlistFile('#EXTM3U\nfile:///etc/passwd\njavascript:alert(1)'));
    expect(engine.addUrlItems).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('No playable links'), expect.anything());
  });

  it('refuses a file over 256 KB before reading it', async () => {
    const big = new File([new Uint8Array(256 * 1024 + 1)], 'huge.m3u');
    await pick(big);
    expect(engine.addUrlItems).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('too large'), expect.anything());
  });

  it('caps a very long playlist at 500 entries', async () => {
    const lines = ['#EXTM3U', ...Array.from({ length: 800 }, (_, i) => `https://x.test/${i}.mp3`)].join('\n');
    await pick(playlistFile(lines));
    expect(engine.addUrlItems.mock.calls[0][0]).toHaveLength(500);
  });

  it('says so when the engine cannot queue stream items', async () => {
    mount({ withAddUrl: false });
    await pick(playlistFile(PLAYLIST));
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('not available'), expect.anything());
  });
});

describe('playlists handed over by the file loader', () => {
  it('queues parsed entries with the source name in the message', async () => {
    const { queueEntries } = await import('../src/queue-import.js');
    const onQueued = vi.fn();
    queueEntries([{ name: 'A', url: 'https://x.test/a.mp3' }, { name: 'B', url: 'file:///nope' }], { engine, toast, onQueued }, 'set.m3u');
    expect(engine.addUrlItems.mock.calls[0][0].map((i) => i.url)).toEqual(['https://x.test/a.mp3']);
    expect(onQueued).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Imported <b>1</b>'), expect.anything());
  });

  it('names the file when it has nothing usable', async () => {
    const { queueEntries } = await import('../src/queue-import.js');
    queueEntries([], { engine, toast, onQueued: vi.fn() }, 'set.m3u');
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('set.m3u'), expect.anything());
  });

  it('parses a picked local file with no base, so relative entries are dropped', async () => {
    const { importPlaylistFile } = await import('../src/queue-import.js');
    const text = '#EXTM3U\nrelative/track.mp3\nhttps://cdn.example.test/ok.mp3';
    await importPlaylistFile(playlistFile(text), { engine, toast, onQueued: vi.fn() });
    expect(engine.addUrlItems.mock.calls[0][0].map((i) => i.url)).toEqual(['https://cdn.example.test/ok.mp3']);
  });
});

describe('stream rows in the queue', () => {
  beforeEach(() => {
    engine.queue.push({ url: 'https://cdn.example.test/a.mp3', buffer: null, file: null, meta: { name: 'Alpha', ext: 'STREAM', duration: 0 } });
    panels.renderQueue();
  });

  it('shows STREAM instead of a duration', () => {
    expect(shell.querySelector('.queue-dur').textContent).toBe('STREAM');
  });

  it('plays a stream row through the engine URL path', async () => {
    shell.querySelector('.queue-row').click();
    await vi.waitFor(() => expect(engine.playUrl).toHaveBeenCalledWith(
      'https://cdn.example.test/a.mp3', expect.objectContaining({ name: 'Alpha' })));
  });

  it('reports a stream that fails to start', async () => {
    engine.playUrl.mockRejectedValueOnce(new Error('<i>nope</i>'));
    shell.querySelector('.queue-row').click();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('Stream failed'), expect.anything()));
    expect(toast.mock.calls.at(-1)[0]).toContain('&lt;i&gt;nope');
  });
});
