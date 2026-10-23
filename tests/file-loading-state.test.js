/** @vitest-environment jsdom */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createFileLoader } from '../src/file-loader.js';

beforeEach(() => {
  document.open(); document.write(readFileSync('index.html', 'utf8')); document.close();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const engine = { captureActive: false, isExternal: () => false, stopStream: vi.fn(),
    addToQueue: vi.fn(), hasTrack: false, play: vi.fn() };
  const toast = vi.fn();
  const loader = createFileLoader({ engine, toast, updateTrackUI: vi.fn(),
    ensureAudible: vi.fn(), closeMore: vi.fn(), doc: document });
  return { engine, toast, ...loader };
}

describe('audio loading feedback', () => {
  it('announces pending decode and returns to a retryable state when all files fail', async () => {
    const { engine, loadFiles, dropzone } = setup();
    let resolve;
    engine.addToQueue.mockReturnValue(new Promise((done) => { resolve = done; }));
    const pending = loadFiles([new File(['invalid'], 'broken.wav', { type: 'audio/wav' })]);
    expect(dropzone.getAttribute('aria-busy')).toBe('true');
    expect(document.querySelector('.drop-title').textContent).toBe('Opening audio…');
    resolve(['broken.wav']);
    await pending;
    expect(dropzone.getAttribute('aria-busy')).toBe('false');
    expect(dropzone.classList.contains('is-hidden')).toBe(false);
    expect(document.querySelector('.drop-title').textContent).toBe('Choose an audio track');
    expect(document.getElementById('status-text').textContent).toBe('Decode failed');
    expect(engine.play).not.toHaveBeenCalled();
  });

  it('cleans up pending feedback after a rejected decode', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine, loadFiles, dropzone } = setup();
    engine.addToQueue.mockRejectedValue(new Error('Decoder unavailable'));
    await loadFiles([new File(['invalid'], 'broken.wav', { type: 'audio/wav' })]);
    expect(dropzone.getAttribute('aria-busy')).toBe('false');
    expect(document.querySelector('.drop-title').textContent).toBe('Choose an audio track');
    expect(document.getElementById('status-pill').title).toBe('Decode failed');
  });

  it('shows sample progress and restores every button after a network failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let resolve;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((done) => { resolve = done; })));
    const { toast } = setup();
    const button = document.querySelector('[data-sample="night-voltage"]');
    button.click();
    expect(button.textContent).toBe('Loading…');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect([...document.querySelectorAll('[data-sample]')].every((item) => item.disabled)).toBe(true);
    resolve({ ok: false, status: 503 });
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(button.textContent).toBe('Night Voltage');
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect([...document.querySelectorAll('[data-sample]')].every((item) => !item.disabled)).toBe(true);
    expect(toast).toHaveBeenLastCalledWith(expect.stringContaining("Couldn't load Night Voltage"), expect.any(Object));
  });
});
