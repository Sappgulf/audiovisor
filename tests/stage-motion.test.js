import { describe, it, expect, vi, afterEach } from 'vitest';
import { advanceSceneTime } from '../src/motion.js';
import { RayStage } from '../src/raystage.js';
import { Renderer, loadExtraModes } from '../src/visualizers.js';
import { makeFakeCanvas, ensureGlobals } from './helpers/canvas.js';
import { readFileSync } from 'node:fs';

afterEach(() => vi.useRealTimers());

describe('continuous audio-driven motion', () => {
  it('does not jump when a long-running quiet scene receives a loud frame', () => {
    const before = advanceSceneTime(600, 1 / 60, 0);
    const after = advanceSceneTime(before, 1 / 60, 1);
    expect(after - before).toBeCloseTo(1.9 / 60, 8);
    expect(after - before).toBeLessThan(0.04);
  });

  it('is independent of refresh rate and stays monotonic across changing levels', () => {
    const run = (fps) => {
      let time = 0;
      for (let second = 0; second < 12; second++) {
        for (let frame = 0; frame < fps; frame++) {
          const next = advanceSceneTime(time, 1 / fps, second % 2);
          expect(next).toBeGreaterThan(time);
          time = next;
        }
      }
      return time;
    };
    expect(run(60)).toBeCloseTo(run(144), 8);
  });

  it('balances the main canvas save stack on beat frames for every mode', async () => {
    ensureGlobals();
    await loadExtraModes(Renderer);
    const { MODES } = await import('../src/themes.js');
    const canvas = makeFakeCanvas();
    const renderer = new Renderer(canvas);
    const saves = vi.spyOn(canvas._ctx, 'save');
    const restores = vi.spyOn(canvas._ctx, 'restore');
    const freq = new Uint8Array(1024).fill(160);
    const wave = new Uint8Array(2048).fill(128);
    const levels = { bass: 0.8, mid: 0.6, high: 0.4, level: 0.7, beatPulse: 1 };
    for (const mode of MODES) {
      renderer.setMode(mode.id);
      for (let i = 0; i < 3; i++) renderer.render(false, freq, wave, levels, 16.7);
      expect(saves.mock.calls.length, `${mode.id} leaks a saved canvas state`).toBe(restores.mock.calls.length);
    }
  });
});

describe('shared stage layers', () => {
  it('does not draw the old horizontal horizon over every renderer', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).not.toMatch(/class="horizon"|id="horizon"/);
  });

  it('never samples the warmup framebuffer as a scene texture', () => {
    vi.useFakeTimers();
    const textures = new Map();
    const samplers = new Map();
    let active = 0;
    const warmTexture = {};
    const uniforms = { uSpec: 'spec', uWave: 'wave', uHist: 'hist', uNoise: 'noise' };
    const gl = {
      TEXTURE0: 0, TEXTURE1: 1, TEXTURE2: 2, TEXTURE3: 3,
      TEXTURE_2D: 10, FRAMEBUFFER: 11,
      bindFramebuffer() {}, viewport() {}, bindVertexArray() {}, useProgram() {},
      uniform2f() {},
      uniform1i(location, value) { if (location) samplers.set(location, value); },
      activeTexture(unit) { active = unit; },
      bindTexture(_target, texture) { textures.set(active, texture); },
    };
    const draw = vi.fn(() => {
      for (const name of Object.values(uniforms)) {
        expect(textures.get(samplers.get(name) ?? 0), `${name} samples the attached framebuffer`).not.toBe(warmTexture);
      }
    });
    const stage = {
      _parallel: {}, _prewarmTimer: 0, ok: true, lost: false, gl,
      specTex: {}, waveTex: {}, histTex: {}, noiseTex: {},
      _scenes: new Map([[0, { warm: false }]]),
      _sceneReady: () => true,
      _scene: () => ({ prog: {}, u: uniforms }),
      _target: () => {
        // Creation of a render target leaves its texture bound, exactly
        // like WebGL's _target(). Default samplers must not read it.
        textures.set(active, warmTexture);
        return { fbo: {}, tex: warmTexture };
      },
      _fullscreen: draw,
    };
    RayStage.prototype._prewarm.call(stage);
    vi.advanceTimersByTime(300);
    // _prewarm deliberately catches driver failures; inspect the mock's
    // recorded result as well so a swallowed assertion still fails here.
    expect(draw).toHaveBeenCalledOnce();
    expect(draw.mock.results[0].type).toBe('return');
  });
});
