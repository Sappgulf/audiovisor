import { describe, it, expect, beforeEach } from 'vitest';
import { MODES, THEMES } from '../src/themes.js';

function makeFakeCtx() {
  const grad = () => ({ addColorStop: () => {} });
  return {
    fillRect: () => {},
    clearRect: () => {},
    drawImage: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    quadraticCurveTo: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    setTransform: () => {},
    clip: () => {},
    rect: () => {},
    arc: () => {},
    ellipse: () => {},
    roundRect: () => {},
    createLinearGradient: grad,
    createRadialGradient: grad,
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    lineWidth: 1,
    lineJoin: 'miter',
  };
}

function makeFakeCanvas(w = 800, h = 600) {
  const ctx = makeFakeCtx();
  return {
    getContext: (type) => (type === '2d' ? ctx : null),
    getBoundingClientRect: () => ({ width: w, height: h }),
    width: w,
    height: h,
    _ctx: ctx,
    captureStream: undefined,
  };
}

function ensureGlobals() {
  if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
      createElement: (tag) => (tag === 'canvas' ? makeFakeCanvas(100, 100) : {}),
    };
  } else if (!globalThis.document.createElement) {
    globalThis.document.createElement = (tag) => (tag === 'canvas' ? makeFakeCanvas(100, 100) : {});
  } else {
    const orig = globalThis.document.createElement.bind(globalThis.document);
    globalThis.document.createElement = (tag) => {
      if (tag === 'canvas') return makeFakeCanvas(100, 100);
      try { return orig(tag); } catch { return {}; }
    };
  }
  if (typeof globalThis.window === 'undefined') globalThis.window = {};
  globalThis.window.devicePixelRatio = 1;
}

describe('themes', () => {
  it('has 19 stage modes including Pulse Orb', () => {
    expect(MODES.length).toBe(19);
    expect(MODES.map(m => m.id)).toContain('orb');
    expect(MODES.find(m => m.id === 'orb').name).toBe('Pulse Orb');
    expect(MODES.find(m => m.id === 'orb').icon).toBe('orb');
  });
  it('has 20 themes', () => {
    expect(THEMES.length).toBe(20);
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
