import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

describe('Library (IndexedDB)', () => {
  beforeEach(async () => {
    // clear DB between tests
    const { clearLibrary } = await import('../src/library.js');
    await clearLibrary();
  });

  it('add and list', async () => {
    const { addToLibrary, listLibraryMeta } = await import('../src/library.js');
    const ab = new ArrayBuffer(8);
    await addToLibrary({ name: 'Test', ext: 'WAV', sampleRate: 44100, channels: 1, duration: 1, arrayBuffer: ab, edits: { chop: true } });
    const list = await listLibraryMeta();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('Test');
    expect(list[0].edits.chop).toBe(true);
    expect(list[0].arrayBuffer).toBeUndefined(); // meta strips buffer
  });

  it('remove', async () => {
    const { addToLibrary, listLibraryMeta, removeFromLibrary } = await import('../src/library.js');
    const ab = new ArrayBuffer(4);
    const rec = await addToLibrary({ name: 'A', ext: 'MP3', sampleRate: 44100, channels: 2, duration: 2, arrayBuffer: ab });
    let list = await listLibraryMeta();
    expect(list.length).toBe(1);
    await removeFromLibrary(rec.id);
    list = await listLibraryMeta();
    expect(list.length).toBe(0);
  });

  it('renderRemixToWav produces wav blob', async () => {
    if (typeof OfflineAudioContext === 'undefined') {
      // jsdom/node doesn't have OfflineAudioContext — just verify the function exists
      const { renderRemixToWav } = await import('../src/library.js');
      expect(typeof renderRemixToWav).toBe('function');
      return;
    }
    const { renderRemixToWav } = await import('../src/library.js');
    const ctx = new OfflineAudioContext(1, 44100, 44100);
    const buf = ctx.createBuffer(1, 1024, 44100);
    buf.getChannelData(0).fill(0.2);
    const blob = await renderRemixToWav(buf, { reverb: true, crush: true });
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBeGreaterThan(44);
  });
});

describe('Library read validation', () => {
  it('lists a damaged row with safe defaults instead of breaking the list', async () => {
    const { addToLibrary, listLibraryMeta } = await import('../src/library.js');
    await addToLibrary({ name: 'Good', ext: 'WAV', sampleRate: 1, channels: 1, duration: 1, arrayBuffer: new ArrayBuffer(4) });
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('audiovisor.library', 2);
      req.onsuccess = () => {
        const db = req.result;
        const t = db.transaction('tracks', 'readwrite');
        t.objectStore('tracks').put({ id: 'damaged', name: 42, created: 'yesterday' });
        t.oncomplete = () => { db.close(); resolve(); };
        t.onerror = () => reject(t.error);
      };
      req.onerror = () => reject(req.error);
    });
    const list = await listLibraryMeta();
    const damaged = list.find((r) => r.id === 'damaged');
    expect(damaged.name).toBe('Untitled');
    expect(damaged.created).toBe(0);
    expect(list[list.length - 1].id).toBe('damaged');
  });
});

/* writes a raw row, bypassing addToLibrary, to simulate a damaged or older record */
function putRaw(row) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('audiovisor.library', 2);
    req.onsuccess = () => {
      const db = req.result;
      const t = db.transaction('tracks', 'readwrite');
      t.objectStore('tracks').put(row);
      t.oncomplete = () => { db.close(); resolve(); };
      t.onerror = () => reject(t.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe('Library records carry their source', () => {
  it('stores the original file name and the media kind', async () => {
    const { addToLibrary, listLibraryMeta } = await import('../src/library.js');
    await addToLibrary({ name: 'Concert', kind: 'video', fileName: 'Concert.MP4', ext: 'MP4', sampleRate: 48000, channels: 2, duration: 3, arrayBuffer: new ArrayBuffer(4) });
    const list = await listLibraryMeta();
    const row = list.find((r) => r.name === 'Concert');
    expect(row.kind).toBe('video');
    expect(row.fileName).toBe('Concert.MP4');
  });

  it('defaults a record without a kind to audio, as every existing caller produces', async () => {
    const { addToLibrary, listLibraryMeta } = await import('../src/library.js');
    await addToLibrary({ name: 'Plain', ext: 'WAV', sampleRate: 44100, channels: 2, duration: 1, arrayBuffer: new ArrayBuffer(4) });
    const row = (await listLibraryMeta()).find((r) => r.name === 'Plain');
    expect(row.kind).toBe('audio');
    expect(row.fileName).toBeNull();
  });
});

describe('Library rows that are damaged on disk', () => {
  it('still lists a row with no created value, instead of hiding it', async () => {
    // an index on `created` leaves such a row out, so it could never be seen or deleted
    const { listLibraryMeta } = await import('../src/library.js');
    await putRaw({ id: 'no-created', name: 'Orphan' });
    const row = (await listLibraryMeta()).find((r) => r.id === 'no-created');
    expect(row).toBeDefined();
    expect(row.name).toBe('Orphan');
    expect(row.created).toBe(0);
  });

  it('does not hand a non-buffer arrayBuffer to the load path', async () => {
    const { getLibraryEntry } = await import('../src/library.js');
    await putRaw({ id: 'bad-buffer', name: 'Text', arrayBuffer: 'not bytes', created: 5 });
    expect(await getLibraryEntry('bad-buffer')).toBeNull();
  });

  it('replaces a non-object edits value, which the panel would otherwise walk with Object.entries', async () => {
    const { listLibraryMeta } = await import('../src/library.js');
    await putRaw({ id: 'bad-edits', name: 'Edits', edits: 'chop', created: 6 });
    const row = (await listLibraryMeta()).find((r) => r.id === 'bad-edits');
    expect(row.edits).toBeNull();
  });

  it('repairs numeric fields the UI formats', async () => {
    const { listLibraryMeta } = await import('../src/library.js');
    await putRaw({ id: 'bad-numbers', name: 'Nums', sampleRate: 'fast', duration: NaN, channels: null, created: 7 });
    const row = (await listLibraryMeta()).find((r) => r.id === 'bad-numbers');
    expect(row.sampleRate).toBe(0);
    expect(row.duration).toBe(0);
    expect(row.channels).toBe(0);
  });
});

describe('Library connection', () => {
  it('retries after a synchronous open failure instead of caching the rejection', async () => {
    // a fresh module instance, so no connection from earlier tests is cached
    vi.resetModules();
    const lib = await import('../src/library.js');
    const spy = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => { throw new Error('no storage'); });
    try {
      await expect(lib.listLibraryMeta()).rejects.toThrow('no storage');
      await expect(lib.listLibraryMeta()).resolves.toEqual(expect.any(Array));
    } finally {
      spy.mockRestore();
    }
  });
});
