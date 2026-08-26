import { describe, it, expect, beforeEach } from 'vitest';
import { MODES, THEMES } from '../src/themes.js';
import { makeFakeCanvas, ensureGlobals } from './helpers/canvas.js';

describe('themes', () => {
  it('has 23 stage modes including Pulse Orb', () => {
    expect(MODES.length).toBe(23);
    expect(MODES.map(m => m.id)).toContain('orb');
    expect(MODES.find(m => m.id === 'orb').name).toBe('Pulse Orb');
    expect(MODES.find(m => m.id === 'orb').icon).toBe('orb');
  });
  it('has 25 themes', () => {
    expect(THEMES.length).toBe(25);
  });
  it('all modes have id, name, icon', () => {
    for (const m of MODES) {
      expect(m.id).toBeTruthy();
      expect(m.name).toBeTruthy();
      expect(m.icon).toBeTruthy();
    }
  });
});

describe('Renderer', () => {
  let Renderer;
  let canvas;
  let renderer;

  beforeEach(async () => {
    ensureGlobals();
    // fresh import to avoid state leakage
    const mod = await import('../src/visualizers.js');
    Renderer = mod.Renderer;
    await mod.loadExtraModes(Renderer);
    canvas = makeFakeCanvas(800, 600);
    renderer = new Renderer(canvas);
  });

  it('initializes with defaults', () => {
    expect(renderer.mode).toBe('bars');
    expect(renderer.theme.id).toBe('lime');
    expect(renderer.quality).toBe('high');
    expect(renderer.beat).toBe(0);
  });

  it('setMode switches and resets per-mode state', () => {
    renderer.history = [1, 2, 3];
    renderer.orbSat = [{ life: 1 }];
    renderer.setMode('orb');
    expect(renderer.mode).toBe('orb');
    expect(renderer.history).toEqual([]);
    expect(renderer.orbSat).toEqual([]);
    renderer.setMode('bars');
    expect(renderer.mode).toBe('bars');
  });

  it('setTheme updates theme and cache sig', () => {
    const t = THEMES.find(th => th.id === 'cyber');
    renderer.setTheme(t);
    expect(renderer.theme.id).toBe('cyber');
  });

  it('setQuality and resize update dimensions', () => {
    renderer.setQuality('low');
    expect(renderer.quality).toBe('low');
    renderer.setQuality('high');
    expect(renderer.quality).toBe('high');
  });

  it('sensitivity and bassFocus setters', () => {
    renderer.setSensitivity(2.0);
    expect(renderer.sensitivity).toBe(2.0);
    renderer.setBassFocus(0.9);
    expect(renderer.bassFocus).toBe(0.9);
  });

  it('idle render does not throw', () => {
    expect(() => renderer.render(true, null, null, null, 16)).not.toThrow();
  });

  it('all 13 modes render without throwing (smoke test)', () => {
    const freq = new Uint8Array(1024); freq.fill(40); for (let i=0;i<80;i++) freq[i]=120+Math.random()*80;
    const wave = new Uint8Array(2048); wave.fill(128);
    const levels = { bass: 0.5, mid: 0.3, high: 0.2, level: 0.4, beatPulse: 0.8, beatPhase: 0.2, bpm: 120, beatConfidence: 0.9 };
    for (const m of MODES) {
      renderer.setMode(m.id);
      expect(() => renderer.render(false, freq, wave, levels, 16)).not.toThrow();
    }
  });

  it('beat pulse drives punch without error', () => {
    const freq = new Uint8Array(1024); freq.fill(80);
    const wave = new Uint8Array(2048); wave.fill(128);
    const low = { bass: 0.1, mid: 0.1, high: 0.1, level: 0.1, beatPulse: 0, bpm: 0, beatConfidence: 0 };
    const high = { bass: 0.9, mid: 0.8, high: 0.7, level: 0.9, beatPulse: 1, bpm: 128, beatConfidence: 1 };
    renderer.setMode('bars');
    expect(() => renderer.render(false, freq, wave, low, 16)).not.toThrow();
    expect(() => renderer.render(false, freq, wave, high, 16)).not.toThrow();
    expect(renderer.beat).toBeGreaterThan(0);
  });

  it('bars gravity peaks decay over time without freq', () => {
    const freq = new Uint8Array(1024); freq.fill(10);
    const wave = new Uint8Array(2048); wave.fill(128);
    renderer.setMode('bars');
    renderer.render(false, freq, wave, { bass: 0, mid: 0, high: 0, level: 0, beatPulse: 0 }, 16);
    const loud = new Uint8Array(1024); loud.fill(200);
    renderer.render(false, loud, wave, { bass: 1, mid: 1, high: 1, level: 1, beatPulse: 1 }, 16);
    const peakAfterLoud = [...renderer.peaks];
    const quiet = new Uint8Array(1024); quiet.fill(10);
    for (let i=0;i<10;i++) renderer.render(false, quiet, wave, { bass: 0, mid: 0, high: 0, level: 0, beatPulse: 0 }, 16);
    expect(renderer.peaks.length).toBe(peakAfterLoud.length);
    expect(Math.max(...renderer.peaks)).toBeLessThan(Math.max(...peakAfterLoud));
  });
});

describe('band envelope shape', () => {
  let Renderer;
  beforeEach(async () => {
    ensureGlobals();
    const mod = await import('../src/visualizers.js');
    ({ Renderer } = mod);
    await mod.loadExtraModes(Renderer);
  });

  /* A transient should arrive fast and leave slowly. The old symmetric
     lerp rose as sluggishly as it fell (133ms either way), so a kick's
     peak was already gone by the time the bar got there. */
  const settle = (renderer, target, frames) => {
    for (let i = 0; i < frames; i++) {
      renderer.updateAnalysis({ bass: target, mid: target, high: target, level: target }, 16.7);
    }
    return renderer.sm.level;
  };

  const fresh = () => {
    const r = new Renderer(makeFakeCanvas(800, 600));
    r.bassFocus = 0;
    return r;
  };

  it('reaches 90% of a step within ~50ms, not ~133ms', () => {
    const r = fresh();
    let frames = 0;
    while (r.sm.level < 0.9 && frames < 120) {
      r.updateAnalysis({ bass: 1, mid: 1, high: 1, level: 1 }, 16.7);
      frames++;
    }
    expect(frames).toBeLessThanOrEqual(4);      // <= ~67ms at 60fps
    expect(frames).toBeGreaterThan(1);          // not an instant snap
  });

  it('decays slower than it attacks, so peaks leave a tail', () => {
    const r = fresh();
    settle(r, 1, 40);
    let frames = 0;
    while (r.sm.level > 0.1 && frames < 200) {
      r.updateAnalysis({ bass: 0, mid: 0, high: 0, level: 0 }, 16.7);
      frames++;
    }
    expect(frames).toBeGreaterThan(8);          // > ~133ms, the old constant
  });

  it('keeps the same shape at 144Hz as at 60Hz', () => {
    const a = fresh();
    const b = fresh();
    // 100ms of signal, delivered at two different refresh rates
    for (let i = 0; i < 6; i++) a.updateAnalysis({ bass: 1, mid: 1, high: 1, level: 1 }, 16.7);
    for (let i = 0; i < 14; i++) b.updateAnalysis({ bass: 1, mid: 1, high: 1, level: 1 }, 6.94);
    expect(Math.abs(a.sm.level - b.sm.level)).toBeLessThan(0.05);
  });

  it('never overshoots the target', () => {
    const r = fresh();
    expect(settle(r, 0.5, 60)).toBeLessThanOrEqual(0.5 + 1e-6);
  });
});
