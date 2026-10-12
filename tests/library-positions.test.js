/**
 * Resume positions live in their own small store. These tests cover the
 * version 1 to 2 upgrade, that a save writes only that store, reading the
 * position back, and clearing it when a track finishes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

const DB_NAME = 'audiovisor.library';
const lib = () => import('../src/library.js');

/** Open the database at a version, optionally running an upgrade first. */
function openAt(version, upgrade) {
  return new Promise((resolve, reject) => {
    const req = version === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
    if (upgrade) req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function putRows(db, store, rows) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    for (const r of rows) t.objectStore(store).put(r);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

function getRow(db, store, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function deleteDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Stand-in for the audio engine: what the tracker touches. */
function fakeEngine() {
  const listeners = [];
  return {
    queue: [], queueIndex: -1, playing: false, time: 0,
    seek: vi.fn(),
    getTime() { return this.time; },
    on(name, fn) { if (name === 'state') listeners.push(fn); },
    emit(playing) { this.playing = playing; for (const fn of listeners) fn(playing); },
  };
}

describe('upgrading from version 1', () => {
  it('keeps existing track rows, arrayBuffers included, and adds the positions store', async () => {
    await deleteDb();
    // a database as the previous build wrote it
    const old = await openAt(1, (db) => {
      db.createObjectStore('tracks', { keyPath: 'id' }).createIndex('created', 'created');
    });
    await putRows(old, 'tracks', [{ id: 'old', name: 'Old', ext: 'WAV', duration: 50, created: 7, arrayBuffer: new ArrayBuffer(16) }]);
    old.close();

    vi.resetModules();
    const { listLibrary, getLibraryEntry } = await lib();
    const [rec] = await listLibrary();
    expect(rec).toMatchObject({ id: 'old', name: 'Old', duration: 50, created: 7 });
    expect(rec.arrayBuffer.byteLength).toBe(16);
    expect((await getLibraryEntry('old')).arrayBuffer.byteLength).toBe(16);

    const db = await openAt(undefined);
    expect(db.version).toBe(2);
    expect([...db.objectStoreNames].sort()).toEqual(['positions', 'tracks']);
    db.close();
  });
});

describe('resume positions', () => {
  let trackId;

  beforeEach(async () => {
    const { clearLibrary, addToLibrary } = await lib();
    await clearLibrary();
    trackId = (await addToLibrary({ name: 'Song', ext: 'WAV', duration: 200, arrayBuffer: new ArrayBuffer(4096) })).id;
  });

  afterEach(() => vi.restoreAllMocks());

  it('a save writes only the positions store, never the track row or its arrayBuffer', async () => {
    const { setResumePoint } = await lib();
    const writes = [];
    const put = IDBObjectStore.prototype.put;
    const del = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      writes.push({ store: this.name, value });
      return put.call(this, value, key);
    });
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (key) {
      writes.push({ store: this.name, deleted: key });
      return del.call(this, key);
    });

    await setResumePoint(trackId, 75, 9000);
    await setResumePoint(trackId, null);

    expect(writes.map((w) => w.store)).toEqual(['positions', 'positions']);
    expect(writes[0].value).toEqual({ id: trackId, lastPosition: 75, updatedAt: 9000 });
    expect(writes.some((w) => w.value && 'arrayBuffer' in w.value)).toBe(false);
  });

  it('reads the saved position back on the track and the list', async () => {
    const { setResumePoint, listLibrary, getLibraryEntry } = await lib();
    await setResumePoint(trackId, 75, 9000);
    expect((await getLibraryEntry(trackId)).lastPosition).toBe(75);
    expect((await getLibraryEntry(trackId)).updatedAt).toBe(9000);
    const [rec] = await listLibrary();
    expect(rec.lastPosition).toBe(75);
    expect(rec.arrayBuffer.byteLength).toBe(4096);
  });

  it('clears the position when the track finishes, and keeps the track', async () => {
    const { setResumePoint, getLibraryEntry, createResumeTracker } = await lib();
    await setResumePoint(trackId, 40, 1000);
    const rec = await getLibraryEntry(trackId);

    const engine = fakeEngine();
    engine.queue.push({ buffer: {}, meta: { name: 'Song', duration: 200 } });
    engine.queueIndex = 0;
    let clock = 1000;
    const tracker = createResumeTracker({ engine, toast: vi.fn(), now: () => clock, doc: null, win: null });
    tracker.arm(rec, engine.queue[0]);
    engine.emit(true);
    clock = 2000;
    engine.time = 199;
    tracker.tick();
    // the engine resets its offset to 0 as it reports the end of the track
    engine.time = 0;
    engine.emit(false);
    tracker.stop();

    const db = await openAt(undefined);
    expect(await getRow(db, 'positions', trackId)).toBeUndefined();
    db.close();

    const kept = await getLibraryEntry(trackId);
    expect(kept.lastPosition).toBeNull();
    expect(kept.arrayBuffer.byteLength).toBe(4096);
  });

  it('removing a track removes its position too', async () => {
    const { setResumePoint, removeFromLibrary, listLibrary } = await lib();
    await setResumePoint(trackId, 60);
    await removeFromLibrary(trackId);
    expect(await listLibrary()).toEqual([]);
    const db = await openAt(undefined);
    expect(await getRow(db, 'positions', trackId)).toBeUndefined();
    db.close();
  });
});
