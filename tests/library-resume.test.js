/**
 * Resume points for saved library tracks: the rule that decides where a track
 * starts, the validation of stored values, the save throttle and finish
 * handling, and the seek when a saved track plays.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

const DB_NAME = 'audiovisor.library';
const STORE = 'tracks';
const lib = () => import('../src/library.js');

/** Write rows straight into the store, bypassing the shape addToLibrary writes. */
async function putRaw(rows) {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' }).createIndex('created', 'created');
      }
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

/** Stand-in for the audio engine: the parts the tracker and loader touch. */
function fakeEngine() {
  const listeners = [];
  return {
    queue: [], queueIndex: -1, playing: false, time: 0,
    captureActive: false, micActive: false,
    seek: vi.fn(), setFx: vi.fn(), stopStream: vi.fn(), isExternal: () => false,
    getTime() { return this.time; },
    on(name, fn) { if (name === 'state') listeners.push(fn); },
    /** Fire the 'state' event the way the engine does. */
    emit(playing) { this.playing = playing; for (const fn of listeners) fn(playing); },
    async addToQueue(files) {
      for (const f of files) this.queue.push({ buffer: {}, file: f, meta: { name: f.name, duration: 200 } });
      if (this.queueIndex === -1 && this.queue.length) this.queueIndex = 0;
      return [];
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  const { clearLibrary } = await lib();
  await clearLibrary();
});

describe('resumePoint', () => {
  const rec = (lastPosition, duration = 200) => ({ lastPosition, duration });

  it('resumes a track that is more than 5 s in and more than 10 s from the end', () => {
    return lib().then(({ resumePoint }) => {
      expect(resumePoint(rec(90))).toBe(90);
      expect(resumePoint(rec(189))).toBe(189);
    });
  });

  it('starts from the top when the point is too early, too late or missing', async () => {
    const { resumePoint } = await lib();
    expect(resumePoint(rec(5))).toBe(0);
    expect(resumePoint(rec(3))).toBe(0);
    expect(resumePoint(rec(190))).toBe(0);
    expect(resumePoint(rec(null))).toBe(0);
    expect(resumePoint(null)).toBe(0);
  });
});

describe('resume fields on read', () => {
  it('keeps a valid position and update time', async () => {
    await putRaw([{ id: 'ok', name: 'A', duration: 100, created: 1, lastPosition: 42, updatedAt: 1700 }]);
    const [rec] = await (await lib()).listLibrary();
    expect(rec.lastPosition).toBe(42);
    expect(rec.updatedAt).toBe(1700);
  });

  it('reads damaged position values as no position', async () => {
    await putRaw([
      { id: 'str', name: 'A', duration: 100, created: 1, lastPosition: '42', updatedAt: 'now' },
      { id: 'neg', name: 'B', duration: 100, created: 2, lastPosition: -4, updatedAt: -1 },
      { id: 'inf', name: 'C', duration: 100, created: 3, lastPosition: Infinity, updatedAt: Infinity },
      { id: 'past', name: 'D', duration: 100, created: 4, lastPosition: 120, updatedAt: 5 },
      { id: 'nan', name: 'E', duration: 100, created: 5, lastPosition: NaN },
    ]);
    const byId = Object.fromEntries((await (await lib()).listLibrary()).map((r) => [r.id, r]));
    for (const id of ['str', 'neg', 'inf', 'past', 'nan']) {
      expect(byId[id].lastPosition).toBeNull();
    }
    expect(byId.str.updatedAt).toBeNull();
    expect(byId.neg.updatedAt).toBeNull();
    expect(byId.inf.updatedAt).toBeNull();
  });

  it('a row with no resume fields reads as none', async () => {
    await putRaw([{ id: 'bare', name: 'A', duration: 100, created: 1 }]);
    const [rec] = await (await lib()).listLibrary();
    expect(rec.lastPosition).toBeNull();
    expect(rec.updatedAt).toBeNull();
  });
});

describe('setResumePoint', () => {
  it('stores a position and its time, then clears both', async () => {
    const { addToLibrary, listLibrary, setResumePoint } = await lib();
    const rec = await addToLibrary({ name: 'Song', ext: 'WAV', duration: 200, arrayBuffer: new ArrayBuffer(8) });
    await setResumePoint(rec.id, 33, 5000);
    let [saved] = await listLibrary();
    expect(saved.lastPosition).toBe(33);
    expect(saved.updatedAt).toBe(5000);

    await setResumePoint(rec.id, null);
    [saved] = await listLibrary();
    expect(saved.lastPosition).toBeNull();
    expect(saved.updatedAt).toBeNull();
  });

  it('does nothing for a track that was deleted', async () => {
    const { setResumePoint } = await lib();
    await expect(setResumePoint('gone', 10)).resolves.toBeUndefined();
  });
});

describe('save throttle', () => {
  let tracker;
  let engine;
  let clock;
  let save;

  beforeEach(async () => {
    const { createResumeTracker } = await lib();
    engine = fakeEngine();
    engine.queue.push({ buffer: {}, meta: { name: 'Song', duration: 200 } });
    engine.queueIndex = 0;
    clock = 1000;
    save = vi.fn();
    tracker = createResumeTracker({ engine, toast: vi.fn(), now: () => clock, save, doc: null, win: null });
    tracker.arm({ id: 'a', duration: 200, lastPosition: 40 }, engine.queue[0]);
  });

  afterEach(() => tracker.stop());

  it('writes at most once per 5 s while playing', () => {
    engine.emit(true);
    for (let s = 1; s <= 12; s++) {
      clock = 1000 + s * 1000;
      engine.time = s;
      tracker.tick();
    }
    expect(save.mock.calls.map((c) => [c[0], c[1]])).toEqual([['a', 5], ['a', 10]]);
  });

  it('writes the point at once when playback pauses, outside the throttle', () => {
    engine.emit(true);
    clock = 2000;
    engine.time = 7.25;
    tracker.tick();
    engine.time = 7.25;
    engine.emit(false);
    expect(save).toHaveBeenLastCalledWith('a', 7.25, 2000);
  });

  it('writes the time it has reached when the page is hidden', async () => {
    const { createResumeTracker } = await lib();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const win = new EventTarget();
    tracker.stop();
    tracker = createResumeTracker({ engine, toast: vi.fn(), now: () => clock, save, doc, win });
    tracker.arm({ id: 'a', duration: 200, lastPosition: null }, engine.queue[0]);
    engine.emit(true);
    engine.time = 33;
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(save).toHaveBeenLastCalledWith('a', 33, clock);

    engine.time = 40;
    win.dispatchEvent(new Event('pagehide'));
    expect(save).toHaveBeenLastCalledWith('a', 40, clock);
  });

  it('clears the point when the track finishes', () => {
    engine.emit(true);
    clock = 2000;
    engine.time = 199;
    tracker.tick();
    // the engine resets its offset to 0 as it reports the end
    engine.time = 0;
    engine.emit(false);
    expect(save).toHaveBeenLastCalledWith('a', null, 2000);
  });

  it('clears the point when the track ends and the queue moves on', () => {
    engine.queue.push({ buffer: {}, meta: { name: 'Next', duration: 180 } });
    engine.emit(true);
    clock = 2000;
    engine.time = 199.5;
    tracker.tick();
    engine.queueIndex = 1;
    engine.emit(true);
    expect(save).toHaveBeenLastCalledWith('a', null, expect.any(Number));
  });

  it('keeps the place when the queue moves on before the end', () => {
    engine.queue.push({ buffer: {}, meta: { name: 'Next', duration: 180 } });
    engine.emit(true);
    clock = 2000;
    engine.time = 60;
    tracker.tick();
    engine.queueIndex = 1;
    engine.emit(true);
    expect(save).toHaveBeenLastCalledWith('a', 60, expect.any(Number));
  });
});

describe('seek on play', () => {
  it('seeks to the saved point the first time the track plays, and says so', async () => {
    const { addToLibrary, setResumePoint, loadLibraryRecord } = await lib();
    const rec = await addToLibrary({ name: 'Song', ext: 'WAV', duration: 200, arrayBuffer: new ArrayBuffer(8) });
    await setResumePoint(rec.id, 90);
    const engine = fakeEngine();
    const toast = vi.fn();

    expect(await loadLibraryRecord(engine, rec.id, toast)).toBe(true);
    expect(engine.seek).not.toHaveBeenCalled();

    engine.emit(true);
    await settle();
    expect(engine.seek).toHaveBeenCalledWith(90);
    expect(toast).toHaveBeenCalledWith('Resumed at 1:30', expect.anything());

    // a pause and a second play do not seek again
    engine.emit(false);
    engine.emit(true);
    await settle();
    expect(engine.seek).toHaveBeenCalledTimes(1);
  });

  it('plays from the top when the point is too close to the start or the end', async () => {
    const { addToLibrary, setResumePoint, loadLibraryRecord } = await lib();
    for (const pos of [3, 195]) {
      const rec = await addToLibrary({ name: `Song ${pos}`, ext: 'WAV', duration: 200, arrayBuffer: new ArrayBuffer(8) });
      await setResumePoint(rec.id, pos);
      const engine = fakeEngine();
      const toast = vi.fn();
      await loadLibraryRecord(engine, rec.id, toast);
      engine.emit(true);
      await settle();
      expect(engine.seek).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalledWith(expect.stringContaining('Resumed'), expect.anything());
      engine.emit(false);
    }
  });

  it('returns false for a record that is gone', async () => {
    const { loadLibraryRecord } = await lib();
    expect(await loadLibraryRecord(fakeEngine(), 'missing', vi.fn())).toBe(false);
  });
});
