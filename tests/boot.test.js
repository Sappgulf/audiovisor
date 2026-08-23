import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync, readdirSync } from 'node:fs';

function fakeCtx() {
  const grad = () => ({ addColorStop: () => {} });
  return {
    fillRect: () => {}, clearRect: () => {}, drawImage: () => {},
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
    quadraticCurveTo: () => {}, closePath: () => {}, fill: () => {},
    stroke: () => {}, save: () => {}, restore: () => {},
    translate: () => {}, scale: () => {}, rotate: () => {},
    setTransform: () => {}, clip: () => {}, rect: () => {},
    arc: () => {}, ellipse: () => {}, roundRect: () => {},
    createLinearGradient: grad, createRadialGradient: grad,
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    fillStyle: '', strokeStyle: '', globalAlpha: 1,
    globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
    lineWidth: 1, lineJoin: 'miter',
  };
}

describe('App boot smoke (jsdom)', () => {
  let dom;
  let errors = [];
  let frames = 0;

  beforeAll(async () => {
    errors = [];
    frames = 0;
    let html = readFileSync('dist/index.html', 'utf8');
    const asset = readdirSync('dist/assets').find((f) => f.startsWith('index-') && f.endsWith('.js'));
    const bundle = readFileSync('dist/assets/' + asset, 'utf8');
    // eslint-disable-next-line no-useless-escape
    const inline = '<script>' + bundle.replace(/<\/script>/g, '<\\/script>') + '<\/script>';
    html = html.replace(/<script type="module"[^>]*>\s*<\/script>/s, '');
    html = html.replace('</body>', () => inline + '</body>');
    dom = new JSDOM(html, {
      virtualConsole: new VirtualConsole().on('jsdomError', (e) => errors.push('JS ' + (e.error?.stack ? e.error.stack.split('\n').slice(0, 6).join(' | ') : (e.message || e)))),
      url: 'https://audiovisor-one.vercel.app/',
      pretendToBeVisual: true,
      runScripts: 'dangerously',
      beforeParse(window) {
        window.devicePixelRatio = 1;
        // canvas 2d ctx stub (jsdom returns null)
        window.HTMLCanvasElement.prototype.getContext = function () { return fakeCtx(); };
        window.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,'; };
        window.HTMLCanvasElement.prototype.getBoundingClientRect = function () {
          return { width: 800, height: 450, top: 0, left: 0, right: 800, bottom: 450 };
        };
        // missing browser APIs
        window.AudioContext = function () {
          this.currentTime = 0;
          this.state = 'running';
          this.sampleRate = 44100;
          this.destination = { connect() {}, disconnect() {} };
          this.resume = () => Promise.resolve();
          this.createAnalyser = () => node();
          this.createBiquadFilter = () => node();
          this.createDynamicsCompressor = () => node();
          this.createConvolver = () => { const n = node(); n.buffer = null; return n; };
          this.createGain = () => node();
          this.createDelay = () => node();
          this.createWaveShaper = () => { const n = node(); n.curve = null; return n; };
          this.createBufferSource = () => node();
          this.createBuffer = () => ({ getChannelData: () => new Float32Array(1024) });
          this.createMediaStreamDestination = () => ({ stream: { getAudioTracks: () => [] } });
          this.createMediaStreamSource = () => node();
          this.decodeAudioData = () => Promise.resolve({ duration: 10, sampleRate: 44100, numberOfChannels: 2, getChannelData: () => new Float32Array(1024) });
        };
        function node() {
          return {
            connect() {}, disconnect() {},
            frequency: p(), gain: p(), threshold: p(), Q: p(), delayTime: p(), playbackRate: p(),
            setTargetAtTime() {}, setValueAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {},
            curve: null, oversample: 'none', buffer: null, loop: false, onended: null,
            start() {}, stop() {},
            getByteFrequencyData: (a) => a.fill(0),
            getByteTimeDomainData: (a) => a.fill(128),
            getFloatTimeDomainData: (a) => a.fill(0),
          };
        }
        function p() { return { value: 0, setTargetAtTime(v) { this.value = v; }, setValueAtTime(v) { this.value = v; }, cancelScheduledValues() {}, linearRampToValueAtTime(v) { this.value = v; } }; }
        window.ResizeObserver = function () { this.observe = () => {}; };
        window.navigator.mediaSession = null;
        window.navigator.wakeLock = null;
        window.navigator.clipboard = { writeText: () => Promise.resolve() };
        window.BroadcastChannel = function () { this.postMessage = () => {}; this.onmessage = null; };
        window.MediaMetadata = function () {};
        window.indexedDB = undefined;
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
        window.scrollTo = () => {};
        // capture uncaught errors
        window.addEventListener('error', (e) => errors.push('W ' + (e.error?.stack ? e.error.stack.split('\n').slice(0, 8).join(' >> ') : (e.error?.message || e.message))));
        // run rAF frames
        const raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (cb) => raf((t) => { frames++; if (frames < 120) cb(t); });
      },
    });
    // let module + first frames run
    await new Promise((r) => setTimeout(r, 1200));
  });

  it('boots without uncaught errors', () => {
    expect(errors).toEqual([]);
  });

  it('renders frames without dying', () => {
    expect(frames).toBeGreaterThan(10);
  });

  it('canvas has content dimensions', () => {
    const c = dom.window.document.getElementById('viz-canvas');
    expect(Number(c.width)).toBeGreaterThan(0);
  });

  it('theme row populated (25 themes)', () => {
    const row = dom.window.document.getElementById('theme-row');
    expect(row.children.length).toBe(25);
  });
});
