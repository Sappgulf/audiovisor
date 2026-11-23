import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { installNativeBridge } from '../src/native.js';

describe('native studio integration', () => {
  let doc, win, engine, messages, loadFiles, setMode;
  beforeEach(() => {
    doc = new JSDOM('<div class="brand"></div><button id="tab-look"></button><button id="play-demo"></button><input id="file-input"><label for="file-input">Import</label>', { url: 'audiovisor-local://app/index.html' }).window.document;
    win = doc.defaultView;
    messages = [];
    win.webkit = { messageHandlers: { studio: { postMessage: (message) => messages.push(message) } } };
    engine = { on: vi.fn(), playing: false, hasTrack: false, clearQueue: vi.fn(), pause: vi.fn(), toggle: vi.fn() };
    loadFiles = vi.fn(async () => { engine.hasTrack = true; });
    setMode = vi.fn();
  });

  it('never installs privileged commands on the website', () => {
    const remote = new JSDOM('', { url: 'https://audiovisor-one.vercel.app/' }).window;
    remote.webkit = win.webkit;
    installNativeBridge({ engine, loadFiles, setMode, doc: remote.document });
    expect(remote.AudioVisorNative).toBeUndefined();
    expect(messages).toEqual([]);
  });

  it('signals readiness and routes home and imports to native UI', () => {
    installNativeBridge({ engine, loadFiles, setMode, doc });
    expect(messages.at(-1)).toEqual({ type: 'ready' });
    doc.querySelector('.native-home').click();
    doc.querySelector('label').click();
    expect(messages.slice(-2)).toEqual([{ type: 'home' }, { type: 'import' }]);
  });

  it('rejects external and traversing import URLs before touching playback', async () => {
    installNativeBridge({ engine, loadFiles, setMode, doc });
    for (const url of ['https://evil.example/audio.mp3', 'audiovisor-local://app/imports/../index.html', 'audiovisor-local://other/imports/123.mp3']) {
      await expect(win.AudioVisorNative.open([{ url, name: 'song' }])).rejects.toThrow('Invalid import URL');
    }
    expect(engine.clearQueue).not.toHaveBeenCalled();
  });

  it('leaves playback intact on read failure and loads an authorized file through the real loader contract', async () => {
    installNativeBridge({ engine, loadFiles, setMode, doc });
    const track = { url: 'audiovisor-local://app/imports/16ecb436-7791-497f-9032-4b49d92f6dcd.mp3', name: 'My song' };
    win.fetch = vi.fn().mockResolvedValueOnce({ ok: false });
    await expect(win.AudioVisorNative.open([track])).rejects.toThrow('unavailable');
    expect(engine.clearQueue).not.toHaveBeenCalled();
    win.fetch.mockResolvedValue({ ok: true, headers: new Headers({ 'Content-Type': 'audio/mpeg' }), blob: async () => new win.Blob(['audio']) });
    await win.AudioVisorNative.open([track]);
    expect(loadFiles.mock.calls[0][0][0].name).toBe('My song');
    expect(engine.clearQueue).toHaveBeenCalledOnce();
  });
});
