const DB_NAME = 'audiovisor.library';
const DB_VER = 1;
const STORE = 'tracks';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('created', 'created');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const o = t.objectStore(store);
    const req = fn(o);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    // for getAll etc, resolve on req success
    if (req && req.onsuccess) req.onsuccess = () => resolve(req.result);
    if (req && req.onerror) req.onerror = () => reject(req.error);
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
  await tx(STORE, 'readwrite', o => o.put(rec));
  return rec;
}

export async function listLibrary() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly');
    const o = t.objectStore(STORE);
    const idx = o.index('created');
    const req = idx.getAll();
    req.onsuccess = () => resolve(req.result.sort((a,b)=>b.created-a.created));
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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function clearLibrary() {
  await tx(STORE, 'readwrite', o => o.clear());
}

export async function renderRemixToWav(buffer, edits = {}) {
  const len = buffer.length;
  const offline = new OfflineAudioContext(buffer.numberOfChannels, len, buffer.sampleRate);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = edits.speed ? 1.5 : (edits.chop ? 0.66 : 1);
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
