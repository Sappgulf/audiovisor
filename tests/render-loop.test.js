/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRenderLoop, requestFrameCopy } from '../src/render-loop.js';

/* a 2D context that only records what the loop asks of it */
function fakeCtx() {
  return { drawImage: vi.fn() };
}

describe('frame copies', () => {
  let ctx;
  let queue;
  let getContextSpy;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="stage"></div><canvas id="viz-canvas"></canvas><canvas id="ray-canvas"></canvas>
      <div id="shell"></div><div id="seek-fill"></div><span id="time-current"></span>
      <span id="bpm-value"></span><span id="bass-chip"></span><span id="mood-chip"></span>
      <span id="mood-value"></span>`;
    ctx = fakeCtx();
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx);
    queue = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => { queue.push(cb); return queue.length; });
    vi.stubGlobal('ResizeObserver', undefined);
  });

  afterEach(() => {
    getContextSpy.mockRestore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /* A loop with an idle engine and a 2D renderer: each frame goes through the
     plain Canvas2D path, which is enough to exercise the copy service. */
  function makeLoop({ calm = false } = {}) {
    const viz = document.getElementById('viz-canvas');
    const renderer = {
      w: 800, h: 600, dpr: 1, _scale: 1, t: 0, beat: 0, chromeBeat: 0,
      calm, sm: { bass: 0 }, quality: 'high', canvas: viz,
      render: vi.fn(), updateAnalysis: vi.fn(), setMode: vi.fn(),
      setQuality: vi.fn(), resize: vi.fn(),
    };
    const ray = { ok: false, lost: false, loading: false, beat: 0, w: 0, h: 0, canvas: document.getElementById('ray-canvas'), resize() {}, render() {}, setQuality() {}, quality: 'high' };
    const engine = {
      activeInput: 'none', playing: false, micActive: false, captureActive: false,
      syncExternal() {}, getTime: () => 0, getData: () => null, getDuration: () => 0,
      queue: [], beatInfo: {},
    };
    const loop = createRenderLoop({
      engine, renderer, getRay: () => ray,
      state: { modeId: 'bars', raytraceWanted: false },
      toast: vi.fn(),
      getGpu: () => ({ webgpuState: null, webgl2State: null, webgpuCanvas: null }),
      drawVu: vi.fn(), drawWaveform: vi.fn(),
      seekTrack: { setAttribute() {} },
      getAutoDj: () => false, isDjFiring: () => false, setDjFiring: vi.fn(),
      doc: document,
    });
    return { loop, renderer, ray };
  }

  /* run every queued animation frame once */
  function flush(now = 16) {
    const cbs = queue;
    queue = [];
    for (const cb of cbs) cb(now);
  }

  it('hands back a copy of the frame drawn in the next loop tick', async () => {
    const { loop, renderer } = makeLoop();
    loop.start();
    flush(16);   // first frame starts the clock
    const pending = requestFrameCopy();
    flush(32);
    const copy = await pending;
    expect(copy).toBeTruthy();
    expect(copy).not.toBe(renderer.canvas);
    expect(ctx.drawImage).toHaveBeenCalledWith(renderer.canvas, 0, 0);
  });

  it('resolves null when no frame is drawn in time', async () => {
    vi.useFakeTimers();
    const pending = requestFrameCopy();
    vi.advanceTimersByTime(1600);
    await expect(pending).resolves.toBeNull();
  });

  it('a loop that never started resolves null rather than hanging', async () => {
    vi.useFakeTimers();
    const pending = requestFrameCopy();
    vi.advanceTimersByTime(2000);
    expect(await pending).toBeNull();
  });

  it('mirrors calm onto the document and the ray stage', () => {
    const { loop, renderer, ray } = makeLoop({ calm: true });
    loop.start();
    flush(16);
    flush(32);
    expect(document.documentElement.classList.contains('calm')).toBe(true);
    expect(ray.calm).toBe(true);
    renderer.calm = false;
    flush(48);
    expect(document.documentElement.classList.contains('calm')).toBe(false);
    expect(ray.calm).toBe(false);
  });
});
