import { describe, it, expect, beforeEach } from 'vitest';
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
      const req = indexedDB.open('audiovisor.library', 1);
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
