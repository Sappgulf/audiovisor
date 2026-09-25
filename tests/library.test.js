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

describe('renderRemixToWav encoding', () => {
  it('writes interleaved 16-bit PCM that round-trips the samples', async () => {
    const L = Float32Array.from([0, 0.5, -0.5, 1, -1, 2]);
    const R = Float32Array.from([0.25, -0.25, 0, -1, 1, -2]);
    const buf = { numberOfChannels: 2, length: 6, sampleRate: 8000, getChannelData: (c) => (c ? R : L) };
    const saved = globalThis.OfflineAudioContext;
    globalThis.OfflineAudioContext = class {
      constructor() { this.destination = {}; }
      createBufferSource() { return { playbackRate: {}, connect() {}, start() {} }; }
      startRendering() { return Promise.resolve(buf); }
    };
    try {
      const { renderRemixToWav } = await import('../src/library.js');
      const bytes = new Uint8Array(await (await renderRemixToWav(buf, {})).arrayBuffer());
      expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
      const pcm = new Int16Array(bytes.buffer, 44, 12);
      expect(Array.from(pcm)).toEqual([
        0, 8191, 16383, -8192, -16384, 0, 32767, -32768, -32768, 32767, 32767, -32768,
      ]);
    } finally {
      globalThis.OfflineAudioContext = saved;
    }
  });
});
