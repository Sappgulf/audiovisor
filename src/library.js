const DB_NAME = 'audiovisor.library';
const DB_VER = 2;
const STORE = 'tracks';
const META = 'meta';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      const t = req.transaction;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('created', 'created');
      }
      /* metadata lives in its own store: listLibraryMeta used to getAll() the
         full tracks store and throw the multi-megabyte audio away on every
         search keystroke */
      if (!db.objectStoreNames.contains(META)) {
        const m = db.createObjectStore(META, { keyPath: 'id' });
        m.createIndex('created', 'created');
        if (db.objectStoreNames.contains(STORE)) {
          const src = t.objectStore(STORE);
          src.openCursor().onsuccess = (ev) => {
            const c = ev.target.result;
            if (!c) return;
            const meta = { ...c.value };
            delete meta.arrayBuffer;
            m.put(meta);
            c.continue();
          };
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function writeBoth(rec) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction([STORE, META], 'readwrite');
    t.objectStore(STORE).put(rec);
    const meta = { ...rec };
    delete meta.arrayBuffer;
    t.objectStore(META).put(meta);
    const finish = (fn) => () => { try { db.close(); } catch { /* already closed */ } fn(); };
    t.oncomplete = finish(resolve);
    t.onabort = finish(() => reject(t.error || new Error('transaction aborted')));
    t.onerror = finish(() => reject(t.error));
  }));
}

export function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

export async function addToLibrary({ name, ext, sampleRate, channels, duration, arrayBuffer, edits, sourceName }) {
  const id = uid();
  const rec = {
    id,
    name: name || 'Untitled',
    ext: ext || 'WAV',
    sampleRate,
    channels,
    duration,
    arrayBuffer,
    edits: edits || null,
    sourceName: sourceName || null,
    created: Date.now(),
  };
  await writeBoth(rec);
  return rec;
}

export async function listLibrary() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly');
    const o = t.objectStore(STORE);
    const idx = o.index('created');
    const req = idx.getAll();
    req.onsuccess = () => { const all = req.result.sort((a,b)=>b.created-a.created); db.close(); resolve(all); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function removeFromLibrary(id) {
  await openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction([STORE, META], 'readwrite');
    t.objectStore(STORE).delete(id);
    t.objectStore(META).delete(id);
    const finish = (fn) => () => { try { db.close(); } catch { /* already closed */ } fn(); };
    t.oncomplete = finish(resolve);
    t.onabort = finish(() => reject(t.error || new Error('transaction aborted')));
    t.onerror = finish(() => reject(t.error));
  }));
}

export async function getLibraryEntry(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly');
    const req = t.objectStore(STORE).get(id);
    req.onsuccess = () => { const r = req.result; db.close(); resolve(r); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function clearLibrary() {
  await openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction([STORE, META], 'readwrite');
    t.objectStore(STORE).clear();
    t.objectStore(META).clear();
    const finish = (fn) => () => { try { db.close(); } catch { /* already closed */ } fn(); };
    t.oncomplete = finish(resolve);
    t.onabort = finish(() => reject(t.error || new Error('transaction aborted')));
    t.onerror = finish(() => reject(t.error));
  }));
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
  /* cache the channel views: calling getChannelData inside the per-sample
     loop made long exports take seconds of main-thread work */
  const channels = Array.from({ length: numCh }, (_, ch) => buffer.getChannelData(ch));
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      let s = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7FFF, true); pos += 2;
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}

// Metadata-only list for the UI; never touches the audio payloads.
export async function listLibraryMeta() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(META, 'readonly');
    const req = t.objectStore(META).index('created').getAll();
    req.onsuccess = () => { const all = req.result.sort((a, b) => b.created - a.created); db.close(); resolve(all); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}
