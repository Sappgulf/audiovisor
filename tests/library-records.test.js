/**
 * Library reads against damaged rows. A row written by an older build, a
 * half-finished write or a hand-edited store must cost only that row: the
 * list, its sort and the load path all keep working.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const DB_NAME = 'audiovisor.library';
const STORE = 'tracks';

/** Write rows straight into the store, bypassing addToLibrary's shape. */
async function putRaw(rows) {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' }).createIndex('created', 'created');
      }
      if (!req.result.objectStoreNames.contains('positions')) req.result.createObjectStore('positions', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    for (const r of rows) t.objectStore(STORE).put(r);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  db.close();
}

beforeEach(async () => {
  const { clearLibrary } = await import('../src/library.js');
  await clearLibrary();
});

describe('listLibrary with damaged rows', () => {
  it('drops a row whose id is not a string and keeps the rest', async () => {
    await putRaw([
      { id: 42, name: 'numeric id', created: 1 },
      { id: 'good', name: 'Good', created: 3 },
    ]);
    const { listLibrary } = await import('../src/library.js');
    const list = await listLibrary();
    expect(list.map((r) => r.id)).toEqual(['good']);
  });

  it('repairs wrong-typed fields instead of passing them to the UI', async () => {
    await putRaw([{ id: 'x', name: 7, ext: null, kind: 'podcast', fileName: 9, sampleRate: 'hi', edits: 'chop', created: 'soon' }]);
    const { listLibrary } = await import('../src/library.js');
    const [r] = await listLibrary();
    expect(r.name).toBe('Untitled');
    expect(r.ext).toBe('WAV');
    expect(r.kind).toBe('audio');
    expect(r.fileName).toBeNull();
    expect(r.sampleRate).toBe(0);
    expect(r.edits).toBeNull();
    expect(r.created).toBe(0);
  });

  it('sorts newest first even when one created value is damaged', async () => {
    await putRaw([
      { id: 'old', name: 'Old', created: 100 },
      { id: 'bad', name: 'Bad', created: NaN },
      { id: 'new', name: 'New', created: 300 },
    ]);
    const { listLibrary } = await import('../src/library.js');
    const list = await listLibrary();
    expect(list.map((r) => r.id)).toEqual(['new', 'old', 'bad']);
  });

  it('shows a half-written row so it can be deleted, but cannot load it', async () => {
    await putRaw([{ id: 'half', name: 'Half', created: 5, arrayBuffer: 'not-binary' }]);
    const { listLibrary, getLibraryEntry, removeFromLibrary } = await import('../src/library.js');
    const [r] = await listLibrary();
    expect(r.id).toBe('half');
    expect(r.arrayBuffer).toBeNull();
    expect(await getLibraryEntry('half')).toBeNull();
    await removeFromLibrary('half');
    expect(await listLibrary()).toEqual([]);
  });

  it('loads a good row next to a half-written one', async () => {
    const { addToLibrary, getLibraryEntry, listLibrary } = await import('../src/library.js');
    const rec = await addToLibrary({ name: 'Whole', ext: 'WAV', sampleRate: 44100, channels: 2, duration: 1, arrayBuffer: new ArrayBuffer(16) });
    await putRaw([{ id: 'half', name: 'Half', created: 1 }]);
    expect((await getLibraryEntry(rec.id)).name).toBe('Whole');
    expect(await getLibraryEntry('half')).toBeNull();
    expect((await listLibrary()).length).toBe(2);
  });
});
