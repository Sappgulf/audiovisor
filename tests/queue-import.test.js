import { describe, it, expect, vi } from 'vitest';
import { queueEntries, playStreamItem } from '../src/queue-import.js';

const entries = (n) => Array.from({ length: n }, (_, i) => ({ name: `Track ${i}`, url: `https://x.test/${i}.mp3` }));

function engineStub(overrides = {}) {
  return {
    addUrlItems: vi.fn(),
    playUrl: vi.fn(() => Promise.resolve()),
    captureActive: false,
    micActive: false,
    ...overrides,
  };
}

describe('queueEntries with a long playlist', () => {
  it('queues at most 500 and says how many were left out', () => {
    const engine = engineStub();
    const toast = vi.fn();
    const onQueued = vi.fn();
    queueEntries(entries(600), { engine, toast, onQueued }, 'big.m3u', 100);
    expect(engine.addUrlItems.mock.calls[0][0]).toHaveLength(500);
    expect(onQueued).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls.at(-1)[0]).toContain('100');
    expect(toast.mock.calls.at(-1)[0]).toContain('past the 500 limit');
  });

  it('keeps the plain message when nothing was left out', () => {
    const engine = engineStub();
    const toast = vi.fn();
    queueEntries(entries(3), { engine, toast, onQueued: () => {} });
    expect(toast.mock.calls.at(-1)[0]).toBe('Imported <b>3</b> tracks from playlist');
  });

  it('drops anything that is not a web link before queueing', () => {
    const engine = engineStub();
    queueEntries([{ url: 'file:///etc/passwd' }, { url: 'https://ok.test/a.mp3' }], { engine, toast: () => {}, onQueued: () => {} });
    expect(engine.addUrlItems.mock.calls[0][0].map((i) => i.url)).toEqual(['https://ok.test/a.mp3']);
  });
});

describe('playStreamItem', () => {
  it('reports a refused capture toggle instead of rejecting', async () => {
    const engine = engineStub({ captureActive: true, toggleCapture: vi.fn(() => Promise.reject(new Error('permission denied'))) });
    const toast = vi.fn();
    await expect(playStreamItem(engine, { url: 'https://x.test/a.mp3', meta: { name: 'a' } }, toast)).resolves.toBeUndefined();
    expect(toast.mock.calls.at(-1)[0]).toContain('Stream failed');
    expect(engine.playUrl).not.toHaveBeenCalled();
  });

  it('plays the stream when nothing needs stopping', async () => {
    const engine = engineStub();
    const toast = vi.fn();
    await playStreamItem(engine, { url: 'https://x.test/a.mp3', meta: { name: 'Song' } }, toast);
    expect(engine.playUrl).toHaveBeenCalledWith('https://x.test/a.mp3', { name: 'Song' });
    expect(toast.mock.calls.at(-1)[0]).toContain('Streaming');
  });

  it('escapes the error text it shows', async () => {
    const engine = engineStub({ playUrl: vi.fn(() => Promise.reject(new Error('<img src=x onerror=alert(1)>'))) });
    const toast = vi.fn();
    await playStreamItem(engine, { url: 'https://x.test/a.mp3', meta: {} }, toast);
    expect(toast.mock.calls.at(-1)[0]).not.toContain('<img');
    expect(toast.mock.calls.at(-1)[0]).toContain('&lt;img');
  });
});
