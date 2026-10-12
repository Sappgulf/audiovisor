/**
 * Boot-level checks for the platform wiring in main.js: the ?demo=1 start,
 * the autoplay fallback, the Media Session handlers and the playback state.
 *
 * The app is built once into a single IIFE and booted in jsdom, the same way
 * tests/boot.test.js does it, so these run against the code that ships.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { build } from 'vite';

let bundle;
beforeAll(async () => {
  const [{ output }] = [await build({
    logLevel: 'silent',
    configFile: false,
    build: {
      write: false,
      target: 'es2020',
      minify: false,
      rollupOptions: { input: 'src/main.js', output: { format: 'iife' } },
    },
  })].flat();
  bundle = output.find((c) => c.type === 'chunk').code;
}, 120000);

function fakeCtx() {
  const grad = () => ({ addColorStop: () => {} });
  return new Proxy({
    fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1, lineJoin: 'miter',
    globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    createLinearGradient: grad, createRadialGradient: grad,
  }, { get: (t, k) => (k in t ? t[k] : () => {}) });
}

/**
 * Boot the app at `url`. `ctxState` is what the AudioContext reports on
 * creation: 'suspended' is how a browser starts a context with no gesture.
 */
async function boot(url, { ctxState = 'running', mediaSession = null } = {}) {
  const errors = [];
  let html = readFileSync('index.html', 'utf8');
  html = html.replace(/<script type="module"[^>]*>\s*<\/script>/s, '');
  html = html.replace('</body>', () => `<script>${bundle.replace(/<\/script>/g, '<\\/script>')}</script></body>`);
  const dom = new JSDOM(html, {
    url,
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    virtualConsole: new VirtualConsole().on('jsdomError', (e) => errors.push(e.message || String(e))),
    beforeParse(window) {
      window.devicePixelRatio = 1;
      window.HTMLCanvasElement.prototype.getContext = () => fakeCtx();
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ width: 800, height: 450, top: 0, left: 0, right: 800, bottom: 450 });
      /* Any node or method the engine asks for exists; only the values it
         reads back are modelled. Unknown params read as a plain param object. */
      const param = () => ({ value: 0, setTargetAtTime() {}, setValueAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {} });
      const node = () => new Proxy({
        connect() {}, disconnect() {}, curve: null, oversample: 'none', buffer: null, loop: false, onended: null,
        start() {}, stop() {}, getByteFrequencyData: (a) => a.fill(0), getByteTimeDomainData: (a) => a.fill(128),
        getFloatTimeDomainData: (a) => a.fill(0),
      }, { get: (t, k) => (k in t || typeof k !== 'string' || k === 'then' ? t[k] : param()) });
      window.AudioContext = function () {
        this.currentTime = 0; this.state = ctxState; this.sampleRate = 44100;
        this.destination = { connect() {}, disconnect() {} };
        // without a user gesture a browser refuses to resume the context
        this.resume = () => (this.state === 'suspended'
          ? Promise.reject(new Error('needs a user gesture'))
          : Promise.resolve());
        this.createBuffer = (ch, len) => ({ length: len, numberOfChannels: ch, sampleRate: 44100, getChannelData: () => new Float32Array(len) });
        this.createMediaStreamDestination = () => ({ stream: { getAudioTracks: () => [] } });
        this.decodeAudioData = () => Promise.resolve({ duration: 10, sampleRate: 44100, numberOfChannels: 2, getChannelData: () => new Float32Array(1024) });
        return new Proxy(this, { get: (t, k) => (k in t ? t[k] : (String(k).startsWith('create') ? node : undefined)) });
      };
      window.ResizeObserver = function () { this.observe = () => {}; };
      if (mediaSession) window.navigator.mediaSession = mediaSession;
      window.navigator.wakeLock = null;
      window.BroadcastChannel = function () { this.postMessage = () => {}; this.onmessage = null; };
      window.MediaMetadata = function () {};
      window.indexedDB = undefined;
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      window.scrollTo = () => {};
      window.addEventListener('error', (e) => errors.push(e.error?.message || e.message));
    },
  });
  await new Promise((r) => setTimeout(r, 1200));
  return { dom, errors, av: dom.window.__av };
}

/** A Media Session stand-in that records what the app registers. */
function fakeMediaSession() {
  const handlers = {};
  return {
    handlers,
    metadata: null,
    playbackState: 'none',
    setActionHandler(name, fn) { handlers[name] = fn; },
  };
}

describe('?demo=1 at boot', () => {
  it('starts the built-in demo once, without a gesture', async () => {
    const { dom, av } = await boot('https://app.test/?demo=1');
    expect(av.engine.track?.name).toBe('Night Circuit');
    expect(av.engine.queue.filter((q) => q.meta?.name === 'Night Circuit')).toHaveLength(1);
    expect(dom.window.location.search).toBe('');
  }, 30000);

  it('leaves the app alone when the param is absent', async () => {
    const { dom, av } = await boot('https://app.test/?stage=1');
    expect(av.engine.track).toBeFalsy();
    expect(dom.window.location.search).toBe('?stage=1');
  }, 30000);

  it('shows the tap-to-start prompt instead of failing when the browser blocks audio', async () => {
    const { dom, errors } = await boot('https://app.test/?demo=1', { ctxState: 'suspended' });
    expect(dom.window.document.getElementById('toasts').textContent).toMatch(/start audio/);
    expect(errors.filter((m) => /demo/i.test(m))).toEqual([]);
  }, 30000);
});

describe('Media Session wiring', () => {
  it('registers the transport handlers when the API exists', async () => {
    const ms = fakeMediaSession();
    await boot('https://app.test/', { mediaSession: ms });
    for (const name of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto', 'seekbackward', 'seekforward']) {
      expect(typeof ms.handlers[name], `no ${name} handler`).toBe('function');
    }
  }, 30000);

  it('reports playing and paused to the lock screen', async () => {
    const ms = fakeMediaSession();
    const { av } = await boot('https://app.test/?demo=1', { mediaSession: ms });
    expect(av.engine.playing).toBe(true);
    expect(ms.playbackState).toBe('playing');
    av.engine.pause();
    expect(ms.playbackState).toBe('paused');
  }, 30000);

  it('boots without throwing when the API is missing', async () => {
    const { errors, av } = await boot('https://app.test/?demo=1', { mediaSession: null });
    expect(errors).toEqual([]);
    expect(av.engine.track?.name).toBe('Night Circuit');
  }, 30000);
});
