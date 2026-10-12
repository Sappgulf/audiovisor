import { describe, it, expect, vi, afterEach } from 'vitest';
import { RayStage } from '../src/raystage.js';
import { CALM_BEAT_CAP } from '../src/visualizers.js';

/* A WebGL2 stand-in that accepts every call; unknown calls are no-ops. The
   uniform calls are spied separately so a test can read what the shader got. */
function fakeGl() {
  const base = {
    getExtension: () => null,
    createProgram: () => ({}),
    createShader: () => ({}),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: (p, name) => ({ name }),
    createTexture: () => ({}),
    createFramebuffer: () => ({}),
    createVertexArray: () => ({}),
    isContextLost: () => false,
    uniform1f: vi.fn(),
  };
  return new Proxy(base, { get: (t, k) => (k in t ? t[k] : () => {}) });
}

function fakeCanvas(gl) {
  const listeners = {};
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => gl),
    getBoundingClientRect: () => ({ width: 800, height: 400 }),
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    listeners,
  };
}

const uniform = (gl, name) => gl.uniform1f.mock.calls.filter(([loc]) => loc.name === name).map(([, v]) => v);

describe('RayStage lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('asks for a context that does not preserve its drawing buffer', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const canvas = fakeCanvas(fakeGl());
    const s = new RayStage(canvas);
    const options = canvas.getContext.mock.calls[0][1];
    expect(options.preserveDrawingBuffer).toBeFalsy();
    s.dispose();
  });

  it('dispose stops the watchdog and releases the context listeners', () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const canvas = fakeCanvas(fakeGl());
    const s = new RayStage(canvas);
    const recover = vi.spyOn(s, '_recover');
    s.lost = true;   // the watchdog would rebuild on its next tick if it still ran
    s.dispose();
    vi.advanceTimersByTime(10000);
    expect(recover).not.toHaveBeenCalled();
    expect(canvas.listeners.webglcontextlost).toEqual([]);
    expect(canvas.listeners.webglcontextrestored).toEqual([]);
    expect(s.ok).toBe(false);
  });

  it('dispose is safe to call twice', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const s = new RayStage(fakeCanvas(fakeGl()));
    s.dispose();
    expect(() => s.dispose()).not.toThrow();
  });

  it('rebuilds once for one context restore, however many events report it', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const gl = fakeGl();
    const s = new RayStage(fakeCanvas(gl));
    const init = vi.spyOn(s, '_init');
    s.lost = true;
    s._recover();
    s._recover();
    expect(init).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it('does not rebuild a stage that never lost its context', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const s = new RayStage(fakeCanvas(fakeGl()));
    const init = vi.spyOn(s, '_init');
    s._recover();
    expect(init).not.toHaveBeenCalled();
    s.dispose();
  });

  it('calm caps the beat the shader sees and the chrome reads the same swell', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const gl = fakeGl();
    const s = new RayStage(fakeCanvas(gl));
    s.resize(800, 400);
    const levels = { bass: 0.3, mid: 0.2, high: 0.1, level: 0.4, beatPulse: 1, bpm: 0, beatConfidence: 0 };
    s.render(false, null, null, levels, 16.7);
    expect(Math.max(...uniform(gl, 'uBeat'))).toBeCloseTo(1, 5);

    s.calm = true;
    gl.uniform1f.mockClear();
    for (let i = 0; i < 120; i++) s.render(false, null, null, levels, 16.7);
    expect(Math.max(...uniform(gl, 'uBeat'))).toBeLessThanOrEqual(CALM_BEAT_CAP + 1e-9);
    expect(s.chromeBeat).toBeLessThanOrEqual(CALM_BEAT_CAP + 1e-9);
    expect(s.beat).toBeCloseTo(1, 5);
    s.dispose();
  });

  it('calm also scales the drop camera term down', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const gl = fakeGl();
    const s = new RayStage(fakeCanvas(gl));
    s.resize(800, 400);
    const levels = { level: 0.4, drop: 1 };
    s.render(false, null, null, levels, 16.7);
    const open = Math.max(...uniform(gl, 'uDrop'));
    gl.uniform1f.mockClear();
    s.calm = true;
    s.render(false, null, null, levels, 16.7);
    const calm = Math.max(...uniform(gl, 'uDrop'));
    expect(calm).toBeLessThan(open);
    s.dispose();
  });
});
