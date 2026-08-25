/**
 * Stream element lifecycle.
 *
 * playUrl() builds a fresh <audio> for every stream, and _onStreamError()
 * builds another one on the CORS fallback path. Dropping the reference does
 * not retire the old element: a media element with a live network fetch stays
 * alive, keeps downloading, and on the fallback path keeps playing to the
 * speakers underneath its replacement — two copies of the same stream, one
 * of them invisible to every transport control.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const created = [];

class FakeAudio {
  constructor() {
    this.preload = '';
    this.crossOrigin = null;
    this.src = '';
    this.paused = true;
    this.loadCalls = 0;
    this.removedAttrs = [];
    this.listeners = [];
    this.aborted = [];
    created.push(this);
  }
  addEventListener(type, fn, opts) {
    this.listeners.push({ type, fn, opts });
    opts?.signal?.addEventListener?.('abort', () => this.aborted.push(type));
  }
  removeEventListener(type) { this.listeners = this.listeners.filter((l) => l.type !== type); }
  removeAttribute(name) { this.removedAttrs.push(name); if (name === 'src') this.src = ''; }
  load() { this.loadCalls++; }
  pause() { this.paused = true; }
  play() { this.paused = false; return Promise.resolve(); }
  /** listeners registered with a live AbortSignal are still attached */
  get liveListeners() {
    return this.listeners.filter((l) => !l.opts?.signal?.aborted);
  }
}

let AudioEngine;

beforeEach(async () => {
  created.length = 0;
  globalThis.Audio = FakeAudio;
  if (typeof globalThis.AbortController === 'undefined') throw new Error('AbortController required');
  ({ AudioEngine } = await import('../src/audio.js'));
});

/** An engine with just enough wired up to exercise _resetStreamElement. */
function makeEngine() {
  const e = Object.create(AudioEngine.prototype);
  e.mode = 'stream';
  e.playing = false;
  e.offset = 0;
  e.mediaNode = null;
  e.mediaEl = null;
  e._streamAbort = null;
  e.streamTrack = null;
  e._emit = vi.fn();
  e._fire = vi.fn();
  return e;
}

describe('_resetStreamElement', () => {
  it('creates a fresh element with CORS on by default', () => {
    const e = makeEngine();
    e._resetStreamElement();
    expect(created).toHaveLength(1);
    expect(created[0].crossOrigin).toBe('anonymous');
    expect(e.streamNoTap).toBe(false);
  });

  it('drops crossOrigin on the no-CORS fallback', () => {
    const e = makeEngine();
    e._resetStreamElement(true);
    expect(created[0].crossOrigin).toBeNull();
    expect(e.streamNoTap).toBe(true);
  });

  it('pauses the previous element instead of leaving it playing', () => {
    const e = makeEngine();
    e._resetStreamElement();
    const first = created[0];
    first.paused = false;               // as if a stream were running
    e._resetStreamElement(true);
    expect(first.paused).toBe(true);
  });

  it('cancels the previous element network fetch', () => {
    const e = makeEngine();
    e._resetStreamElement();
    const first = created[0];
    first.src = 'https://cdn.example.com/a.mp3';
    e._resetStreamElement(true);
    // removeAttribute('src') + load() is the spec-blessed way to stop a fetch
    expect(first.removedAttrs).toContain('src');
    expect(first.loadCalls).toBe(1);
  });

  it('detaches the previous element listeners', () => {
    const e = makeEngine();
    e._resetStreamElement();
    const first = created[0];
    expect(first.liveListeners.length).toBeGreaterThan(0);
    e._resetStreamElement(true);
    expect(first.liveListeners).toHaveLength(0);
  });

  it('leaves the new element listeners attached', () => {
    const e = makeEngine();
    e._resetStreamElement();
    e._resetStreamElement(true);
    expect(created[1].liveListeners.map((l) => l.type).sort())
      .toEqual(['ended', 'error', 'pause', 'play']);
  });

  it('disconnects the previous media source node', () => {
    const e = makeEngine();
    const disconnect = vi.fn();
    e.mediaNode = { disconnect };
    e._resetStreamElement();
    expect(disconnect).toHaveBeenCalled();
    expect(e.mediaNode).toBeNull();
  });

  it('survives a media node that throws on disconnect', () => {
    const e = makeEngine();
    e.mediaNode = { disconnect() { throw new Error('already gone'); } };
    expect(() => e._resetStreamElement()).not.toThrow();
    expect(e.mediaNode).toBeNull();
  });

  it('survives an element that throws while being retired', () => {
    const e = makeEngine();
    e._resetStreamElement();
    created[0].pause = () => { throw new Error('detached'); };
    expect(() => e._resetStreamElement(true)).not.toThrow();
    expect(created).toHaveLength(2);
  });

  it('repeated resets do not accumulate live elements', () => {
    const e = makeEngine();
    for (let i = 0; i < 5; i++) e._resetStreamElement(i % 2 === 1);
    const stillLive = created.filter((a) => a.liveListeners.length > 0);
    expect(stillLive).toEqual([e.mediaEl]);
  });
});

describe('_onStreamError', () => {
  it('retries once without CORS, retiring the tainted element', () => {
    const e = makeEngine();
    e.streamTrack = { url: 'https://cdn.example.com/a.mp3' };
    e._resetStreamElement();
    const first = created[0];
    first.paused = false;
    e._onStreamError();
    expect(e.streamNoTap).toBe(true);
    expect(first.paused).toBe(true);
    expect(first.liveListeners).toHaveLength(0);
  });

  it('gives up after the second failure rather than looping', () => {
    const e = makeEngine();
    e.streamTrack = { url: 'https://cdn.example.com/a.mp3' };
    e._resetStreamElement();
    e._onStreamError();
    const countAfterRetry = created.length;
    e._onStreamError();
    expect(created.length).toBe(countAfterRetry);
    expect(e.playing).toBe(false);
    expect(e._fire).toHaveBeenCalledWith('error', expect.stringContaining('Stream failed'));
  });

  it('reports failure immediately when there is no url to retry', () => {
    const e = makeEngine();
    e._resetStreamElement();
    e._onStreamError();
    expect(e._fire).toHaveBeenCalledWith('error', expect.stringContaining('Stream failed'));
  });
});
