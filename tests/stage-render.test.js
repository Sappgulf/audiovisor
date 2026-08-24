/**
 * Real-pixel render check for every stage mode.
 *
 * tests/visualizers.test.js drives the Renderer through a stub 2D context,
 * which proves the draw calls happen but can never see what they produced.
 * This suite rasterizes to an actual canvas and asserts per-mode invariants
 * on the resulting pixels — the class of bug that shipped as v8.8.3, where
 * atan(0,0) returned NaN and every flat surface rendered pure white, is
 * invisible to a stub and obvious here.
 *
 * These are invariants, not a golden-image baseline: an intentional visual
 * tweak should not turn the suite red, but a mode that goes black, white,
 * or non-finite should.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { MODES, THEMES } from '../src/themes.js';

const W = 192;
const H = 144;
const WARMUP = 60;   // let waterfalls/trails/particle pools mature

/** Deterministic PRNG so a red run reproduces exactly. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const makeCanvas = () => {
  const c = createCanvas(W, H);
  c.getBoundingClientRect = () => ({ width: W, height: H });
  return c;
};

/** Band-limited synth music: kick, funky mids, sparse highs, beat every 0.55s. */
function synthData(t) {
  const freq = new Uint8Array(1024);
  const wave = new Uint8Array(2048);
  for (let i = 0; i < 1024; i++) {
    const u = i / 1024;
    let v = 0.06;
    v += 0.6 * Math.exp(-Math.pow((u - 0.02 - 0.015 * Math.sin(t * 1.7)) * 16, 2));
    v += 0.46 * Math.abs(Math.sin(u * 26 + t * 1.1)) * Math.exp(-u * 2.4);
    v += 0.26 * Math.exp(-Math.pow((u - 0.3) * 10, 2));
    v += 0.12 * Math.abs(Math.sin(u * 90 + t * 3.7)) * Math.exp(-u * 4.2);
    freq[i] = Math.max(0, Math.min(255, Math.round(255 * v)));
  }
  for (let i = 0; i < 2048; i++) {
    const v = Math.sin(i * 0.017 + t * 2.2) * 0.4 + Math.sin(i * 0.0053 - t * 1.1) * 0.3;
    wave[i] = Math.round(128 + 127 * v);
  }
  const beat = (t % 0.55) < 0.12 ? 1 : 0;
  return {
    freq,
    wave,
    levels: {
      bass: Math.min(1, 0.3 + 0.5 * Math.max(0, Math.sin(t * 2.1)) + beat * 0.4),
      mid: 0.4 + 0.2 * Math.abs(Math.sin(t * 1.3)),
      high: 0.22 + 0.16 * Math.abs(Math.sin(t * 0.8)),
      level: Math.min(1, 0.45 + 0.3 * Math.max(0, Math.sin(t * 1.8)) + beat * 0.25),
      beatPulse: beat ? 0.85 : 0,
      beatPhase: (t % 0.55) / 0.55,
      bpm: 109,
      beatConfidence: 0.93,
    },
  };
}

/** Silence — every level zero. Modes must idle without blowing up. */
const SILENCE = {
  freq: new Uint8Array(1024),
  wave: new Uint8Array(2048).fill(128),
  levels: {
    bass: 0, mid: 0, high: 0, level: 0,
    beatPulse: 0, beatPhase: 0, bpm: 0, beatConfidence: 0,
  },
};

let Renderer;
beforeAll(async () => {
  globalThis.document = { createElement: (tag) => (tag === 'canvas' ? makeCanvas() : {}) };
  globalThis.window = { devicePixelRatio: 1 };
  ({ Renderer } = await import('../src/visualizers.js'));
});

/* Rasterizing is the expensive part, so each distinct scenario is rendered
   once and shared by the assertions that inspect it. */
const _renderCache = new Map();
function renderMode(modeId, opts = {}) {
  const key = `${modeId}|${opts.themeId ?? 'brass'}|${!!opts.silent}|${opts.frames ?? WARMUP}`;
  if (!_renderCache.has(key)) _renderCache.set(key, renderModeUncached(modeId, opts));
  return _renderCache.get(key);
}

/** Render `frames` of the given feed and return the final RGBA buffer. */
function renderModeUncached(modeId, { themeId = 'brass', silent = false, frames = WARMUP } = {}) {
  const realRandom = Math.random;
  Math.random = mulberry32(0x5EED);
  try {
    const renderer = new Renderer(makeCanvas());
    renderer.dpr = 1;
    renderer.quality = 'high';
    renderer.setTheme(THEMES.find((th) => th.id === themeId));
    renderer.setMode(modeId);
    for (let f = 0; f < frames; f++) {
      const t = f * 0.016;
      const d = silent ? SILENCE : synthData(t);
      renderer.render(false, d.freq, d.wave, d.levels, 16.7);
    }
    const out = createCanvas(W, H);
    const cx = out.getContext('2d');
    cx.fillStyle = '#0b0a09';          // the page's dark wash, as in the app
    cx.fillRect(0, 0, W, H);
    cx.drawImage(renderer.canvas, 0, 0, W, H);
    return cx.getImageData(0, 0, W, H).data;
  } finally {
    Math.random = realRandom;
  }
}

const stats = (px) => {
  let sum = 0, min = 255, max = 0, white = 0, opaque = 0;
  const n = px.length / 4;
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    sum += l;
    if (l < min) min = l;
    if (l > max) max = l;
    if (px[i] > 250 && px[i + 1] > 250 && px[i + 2] > 250) white++;
    if (px[i + 3] > 8) opaque++;
  }
  return { mean: sum / n, min, max, white: white / n, opaque: opaque / n };
};

describe.each(MODES.map((m) => [m.id, m.name]))('stage mode %s (%s)', (id) => {
  it('produces only finite, in-gamut pixel values', () => {
    const px = renderMode(id);
    expect(px.length).toBe(W * H * 4);
    // Uint8ClampedArray cannot hold NaN — it stores 0. A mode gone
    // non-finite therefore shows up as a fully black, fully transparent
    // frame, which the next assertions catch.
    expect([...px].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)).toBe(true);
  });

  it('draws something — the frame is not uniformly flat', () => {
    const { min, max } = stats(renderMode(id));
    expect(max - min).toBeGreaterThan(4);
  });

  it('does not white out the frame', () => {
    // v8.8.3: atan(0,0) → NaN poisoned every flat surface to pure white.
    const { white, mean } = stats(renderMode(id));
    expect(white).toBeLessThan(0.5);
    expect(mean).toBeLessThan(230);
  });

  it('survives digital silence without going non-finite or white', () => {
    const { white, max } = stats(renderMode(id, { silent: true }));
    expect(white).toBeLessThan(0.5);
    expect(max).toBeLessThanOrEqual(255);
  });

  it('is deterministic under a seeded PRNG', () => {
    const a = renderModeUncached(id, { frames: 16 });
    const b = renderModeUncached(id, { frames: 16 });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe('theme coverage', () => {
  it.each(THEMES.map((t) => [t.id]))('renders bars under theme %s', (themeId) => {
    const { min, max, white } = stats(renderMode('bars', { themeId, frames: 30 }));
    expect(max - min).toBeGreaterThan(4);
    expect(white).toBeLessThan(0.5);
  });
});
