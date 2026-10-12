import { esc, fmtTime } from './utils.js';

const DB_NAME = 'audiovisor.library';
const DB_VER = 1;
const STORE = 'tracks';

let dbPromise = null;

/* one connection per page: every call used to open a new one and never close it */
function openDB() {
  if (!dbPromise) {
    const opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('created', 'created');
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
    dbPromise = opening;
    /* a failed open must not stay cached. A synchronous throw (no
       indexedDB, a sandboxed frame) rejects before onerror can clear the
       cache, so the rejection would otherwise stick for the page's life. */
    opening.catch(() => { if (dbPromise === opening) dbPromise = null; });
  }
  return dbPromise;
}

const isArrayBuffer = (v) => Object.prototype.toString.call(v) === '[object ArrayBuffer]';

/* records come back as stored; repair what the UI reads so one damaged row
   cannot break the whole list, its sort, or the load path */
function readRecord(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string') return null;
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const duration = num(r.duration);
  return {
    ...r,
    name: typeof r.name === 'string' ? r.name : 'Untitled',
    ext: typeof r.ext === 'string' ? r.ext : 'WAV',
    kind: r.kind === 'video' ? 'video' : 'audio',
    fileName: typeof r.fileName === 'string' ? r.fileName : null,
    sampleRate: num(r.sampleRate),
    channels: num(r.channels),
    duration,
    // a resume point is seconds inside the track; anything else reads as none
    lastPosition: Number.isFinite(r.lastPosition) && r.lastPosition >= 0 && r.lastPosition <= duration ? r.lastPosition : null,
    updatedAt: Number.isFinite(r.updatedAt) && r.updatedAt >= 0 ? r.updatedAt : null,
    // a non-object edits value would reach Object.entries in the panel
    edits: r.edits && typeof r.edits === 'object' ? r.edits : null,
    // a string here would be wrapped into a Blob and decode as garbage
    arrayBuffer: isArrayBuffer(r.arrayBuffer) ? r.arrayBuffer : null,
    created: num(r.created),
  };
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const o = t.objectStore(store);
    const req = fn(o);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Library write aborted'));
    // for getAll etc, resolve on req success
    if (req && req.onsuccess) req.onsuccess = () => resolve(req.result);
    if (req && req.onerror) req.onerror = () => reject(req.error);
  }));
}

export function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

/* kind is 'audio' or 'video' (anything else is stored as audio); fileName is
   the original file name with its extension */
export async function addToLibrary({ name, ext, kind = 'audio', fileName = null, sampleRate, channels, duration, arrayBuffer, edits, sourceName }) {
  const id = uid();
  const rec = {
    id,
    name: name || 'Untitled',
    ext: ext || 'WAV',
    kind: kind === 'video' ? 'video' : 'audio',
    fileName: fileName || null,
    sampleRate,
    channels,
    duration,
    arrayBuffer,
    edits: edits || null,
    sourceName: sourceName || null,
    lastPosition: null,
    updatedAt: null,
    created: Date.now(),
  };
  await tx(STORE, 'readwrite', o => o.put(rec));
  return rec;
}

export async function listLibrary() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly');
    // read the store, not the 'created' index: an index leaves out any row
    // whose created value is missing or not a valid key, which made such a
    // row invisible (and so impossible to delete) in the list
    const req = t.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result.map(readRecord).filter(Boolean).sort((a,b)=>b.created-a.created));
    req.onerror = () => reject(req.error);
  });
}

export async function removeFromLibrary(id) {
  await tx(STORE, 'readwrite', o => o.delete(id));
}

export async function getLibraryEntry(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly');
    const req = t.objectStore(STORE).get(id);
    req.onsuccess = () => {
      const rec = readRecord(req.result);
      resolve(rec?.arrayBuffer ? rec : null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearLibrary() {
  await tx(STORE, 'readwrite', o => o.clear());
}

export async function renderRemixToWav(buffer, edits = {}) {
  const rate = edits.speed ? 1.5 : (edits.chop ? 0.66 : 1);
  const len = Math.max(1, Math.ceil(buffer.length / rate));
  const offline = new OfflineAudioContext(buffer.numberOfChannels, len, buffer.sampleRate);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  let node = src;

  // lowpass
  if (edits.lowpass || edits.chop) {
    const lp = offline.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = edits.chop ? 900 : 400;
    node.connect(lp);
    node = lp;
  }
  // autotune peaking
  if (edits.autotune) {
    const pk = offline.createBiquadFilter();
    pk.type = 'peaking';
    pk.frequency.value = 1100;
    pk.Q.value = 1.2;
    pk.gain.value = 10;
    node.connect(pk);
    node = pk;
  }
  // crush
  if (edits.crush) {
    const ws = offline.createWaveShaper();
    const k = 20, n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = (3 + k) * x * 20 * (Math.PI / 180) / (Math.PI + k * Math.abs(x));
    }
    ws.curve = curve;
    ws.oversample = '2x';
    node.connect(ws);
    node = ws;
  }
  // reverb (simple)
  if (edits.reverb) {
    const conv = offline.createConvolver();
    const rate = offline.sampleRate;
    const l = Math.floor(rate * 0.9);
    const b = offline.createBuffer(2, l, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < l; i++) d[i] = (Math.random()*2-1)*Math.pow(1-i/l, 2.2);
    }
    conv.buffer = b;
    const g = offline.createGain();
    g.gain.value = 0.22;
    node.connect(conv);
    conv.connect(g);
    g.connect(offline.destination);
  }
  node.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return audioBufferToWavBlob(rendered);
}

function audioBufferToWavBlob(buffer) {
  const numCh = buffer.numberOfChannels;
  const len = buffer.length * numCh * 2;
  const view = new DataView(new ArrayBuffer(44 + len));
  let pos = 0;
  const writeStr = s => { for (let i = 0; i < s.length; i++) view.setUint8(pos++, s.charCodeAt(i)); };
  const write16 = v => { view.setUint16(pos, v, true); pos += 2; };
  const write32 = v => { view.setUint32(pos, v, true); pos += 4; };
  writeStr('RIFF'); write32(36 + len); writeStr('WAVE');
  writeStr('fmt '); write32(16); write16(1); write16(numCh); write32(buffer.sampleRate); write32(buffer.sampleRate * numCh * 2); write16(numCh * 2); write16(16);
  writeStr('data'); write32(len);
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      let s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7FFF, true); pos += 2;
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}

// Light metadata list for UI without arrayBuffer (to keep memory low) — we still fetch all but UI can ignore buffer
export async function listLibraryMeta() {
  const all = await listLibrary();
  return all.map(({ arrayBuffer: _ab, ...m }) => m);
}

/* ---------- resume points ---------- */

/** Seconds between saved positions while a saved track plays. */
export const RESUME_EVERY_MS = 5000;
/* a point this near the start is not worth resuming; one this near the end
   means the track is effectively done */
const RESUME_MIN_S = 5;
const RESUME_TAIL_S = 10;
/* within this many seconds of the end, a stop counts as the track finishing */
const END_MARGIN_S = 2;

/** Where a saved track should start: its resume point, or 0 for the top. */
export function resumePoint(rec) {
  const pos = rec?.lastPosition;
  if (!(pos > RESUME_MIN_S) || !(rec.duration - pos > RESUME_TAIL_S)) return 0;
  return pos;
}

/** Store a resume point (seconds) on a saved track, or clear it with null. */
export function setResumePoint(id, seconds, now = Date.now()) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const o = t.objectStore(STORE);
    const get = o.get(id);
    get.onsuccess = () => {
      const rec = get.result;
      // the track may have been deleted since it was last playing
      if (!rec || typeof rec !== 'object') return;
      rec.lastPosition = seconds;
      rec.updatedAt = seconds === null ? null : now;
      o.put(rec);
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Library write aborted'));
  }));
}

/**
 * Keeps the resume point of the saved track loaded last. It follows that
 * track through the engine's state events, a one-second clock and the page
 * hiding, so no caller has to remember to save. A track that is not current
 * is left alone; its point is written when it stops, ends or is left.
 *
 * The clock, time and save are injectable so the throttle can be tested.
 */
export function createResumeTracker({
  engine, toast, every = RESUME_EVERY_MS, now = Date.now, save = setResumePoint,
  doc = globalThis.document, win = globalThis.window,
}) {
  /** @type {null | { id: string, item: object, dur: number, live: boolean, lastTime: number, savedAt: number, saved: number | null, seekTo: number }} */
  let a = null;
  const isCurrent = () => !!a && engine.queue[engine.queueIndex] === a.item;

  /** Write a position, or null to clear it. A value already stored is not written again. */
  function write(pos, at) {
    if (pos === a.saved) return;
    a.saved = pos;
    a.savedAt = at;
    try { Promise.resolve(save(a.id, pos, at)).catch(() => {}); } catch { /* storage may refuse */ }
  }

  /** Playback left the track at `t`. Within END_MARGIN_S of its end, that is a finish. */
  function stopAt(t, at) {
    const finished = a.dur > 0 && a.lastTime >= a.dur - END_MARGIN_S;
    write(finished ? null : t, at);
  }

  function onState(playing) {
    if (!a) return;
    if (!isCurrent()) {
      // the engine moved on: a skip keeps its place, a finished track ends near its end
      if (a.live) { a.live = false; stopAt(a.lastTime, now()); }
      return;
    }
    if (playing) {
      a.live = true;
      a.lastTime = engine.getTime();
      a.savedAt = now();
      if (a.seekTo) {
        const at = a.seekTo;
        a.seekTo = 0;
        // the engine announces play before its source is running, so the seek waits a tick
        queueMicrotask(() => {
          if (!isCurrent()) return;
          engine.seek(at);
          toast(`Resumed at ${fmtTime(at)}`, { duration: 2400 });
        });
      }
    } else if (a.live) {
      a.live = false;
      stopAt(engine.getTime(), now());
    }
  }

  /** Called once a second; writes at most once per `every` ms while playing. */
  function tick() {
    if (!a || !a.live || !engine.playing || !isCurrent()) return;
    const at = now();
    a.lastTime = engine.getTime();
    if (at - a.savedAt >= every) write(a.lastTime, at);
  }

  /** Save where playback is now, without the throttle. Used when the page hides. */
  function flush() {
    if (a?.live && isCurrent()) write(engine.getTime(), now());
  }

  /** Follow a saved record that was just queued as `item`. */
  function arm(rec, item) {
    if (a?.live) { a.live = false; stopAt(a.lastTime, now()); }
    a = {
      id: rec.id,
      item,
      dur: item.meta?.duration || rec.duration || 0,
      live: false,
      lastTime: 0,
      savedAt: 0,
      saved: rec.lastPosition ?? null,
      seekTo: resumePoint(rec),
    };
  }

  engine.on('state', onState);
  const timer = setInterval(tick, 1000);
  doc?.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') flush(); });
  win?.addEventListener('pagehide', flush);
  return { engine, arm, tick, flush, onState, stop: () => clearInterval(timer) };
}

let tracker = null;

/**
 * Queue a saved track for playback and arm its resume point. Capture, mic and
 * stream playback stop first, as the library panel always did.
 * @returns {Promise<boolean>} false when the record is gone
 */
export async function loadLibraryRecord(engine, id, toast) {
  const rec = await getLibraryEntry(id);
  if (!rec) return false;
  if (engine.captureActive) await engine.toggleCapture();
  if (engine.micActive) await engine.toggleMic();
  if (engine.isExternal()) engine.pause();
  engine.stopStream();
  const blob = new Blob([rec.arrayBuffer]);
  const file = new File([blob], rec.name + '.' + rec.ext.toLowerCase());
  const before = engine.queue.length;
  await engine.addToQueue([file]);
  if (tracker?.engine !== engine) { tracker?.stop(); tracker = createResumeTracker({ engine, toast }); }
  if (engine.queue.length > before) tracker.arm(rec, engine.queue[engine.queue.length - 1]);
  if (rec.edits) {
    for (const [k, v] of Object.entries(rec.edits)) {
      if (v) engine.setFx(k, true);
    }
  }
  toast(`Loaded <b>${esc(rec.name)}</b> from library`);
  return true;
}

/** Render the playing track to WAV and store it, with the active FX as its edits. */
export async function saveCurrentTrack(engine, toast) {
  if (!engine.buffer || !engine.track) { toast('<b>No track</b> to save', { duration: 1600 }); return; }
  try {
    const ch = engine.buffer.numberOfChannels;
    const tmp = new OfflineAudioContext(ch, engine.buffer.length, engine.buffer.sampleRate);
    const src = tmp.createBufferSource(); src.buffer = engine.buffer; src.connect(tmp.destination); src.start(0);
    const rendered = await tmp.startRendering();
    const blob = await renderRemixToWav(rendered, {});
    const ab = await blob.arrayBuffer();
    const edits = { ...engine.fx };
    const rec = await addToLibrary({
      name: engine.track.name + (Object.values(edits).some(Boolean) ? ' (remix)' : ''),
      ext: 'WAV',
      sampleRate: engine.buffer.sampleRate,
      channels: ch,
      duration: engine.buffer.duration,
      arrayBuffer: ab,
      edits,
      sourceName: engine.track.name,
    });
    toast(`Saved <b>${esc(rec.name)}</b> to library`, { duration: 2000 });
  } catch (e) { console.error(e); toast('<b>Save failed</b>', { duration: 2000 }); }
}

/** Download a saved track as a WAV with its edits rendered in. */
export async function exportLibraryRecord(engine, id, toast) {
  const rec = await getLibraryEntry(id);
  if (!rec || !rec.arrayBuffer) return;
  toast('Rendering <b>remix</b>…', { duration: 1600 });
  try {
    const buf = await engine.ctx.decodeAudioData(rec.arrayBuffer.slice(0));
    const blob = await renderRemixToWav(buf, rec.edits || engine.fx);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rec.name}-remix.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Remix <b>exported</b> as WAV', { duration: 2200 });
  } catch { toast('<b>Export failed</b>', { duration: 2000 }); }
}
