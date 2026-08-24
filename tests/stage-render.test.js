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

  it('keeps highlights off the clipping ceiling', () => {
    /* Distinct from the white-out check above: this catches a mode that
       renders correctly but drives its highlights past white, which throws
       away colour and detail exactly where the signal is loudest. Bloom
       Field summed ~20 overlapping additive sprites per point and clipped
       half the frame before this was bounded. */
    const { white } = stats(renderMode(id));
    expect(white).toBeLessThan(0.25);
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

describe('hostile analysis frames', () => {
  /* A single non-finite value used to be fatal and permanent: NaN entering
     a smoothed band stayed NaN forever, so one bad frame killed the stage
     until reload. Eight modes threw outright on a NaN frame and four more
     on an empty spectrum, surfacing as
     "createRadialGradient: non-finite" or `rgba(..., NaN)`. */
  const wave = new Uint8Array(2048).fill(128);
  const spectrum = (fill) => new Uint8Array(1024).fill(fill);

  const FRAMES = {
    'silence': [spectrum(0), { bass: 0, mid: 0, high: 0, level: 0, beatPulse: 0, beatPhase: 0, bpm: 0, beatConfidence: 0 }],
    'full scale': [spectrum(255), { bass: 1, mid: 1, high: 1, level: 1, beatPulse: 1, beatPhase: 0, bpm: 200, beatConfidence: 1 }],
    'NaN levels': [spectrum(120), { bass: NaN, mid: NaN, high: NaN, level: NaN, beatPulse: NaN, beatPhase: NaN, bpm: NaN, beatConfidence: NaN }],
    'out-of-range levels': [spectrum(120), { bass: -5, mid: 1e9, high: -1e9, level: 50, beatPulse: -2, beatPhase: 99, bpm: -30, beatConfidence: 7 }],
    'null levels': [spectrum(120), null],
    'empty spectrum': [new Uint8Array(0), { bass: 0.5, mid: 0.5, high: 0.5, level: 0.5, beatPulse: 0, beatPhase: 0, bpm: 120, beatConfidence: 0.5 }],
    'missing spectrum': [null, { bass: 0.5, mid: 0.5, high: 0.5, level: 0.5, beatPulse: 0, beatPhase: 0, bpm: 120, beatConfidence: 0.5 }],
  };

  const fresh = (modeId) => {
    const r = new Renderer(makeCanvas());
    r.dpr = 1;
    r.setTheme(THEMES.find((t) => t.id === 'brass'));
    r.setMode(modeId);
    return r;
  };

  for (const [label, [freq, levels]] of Object.entries(FRAMES)) {
    it(`survives ${label} in every mode`, () => {
      const broke = [];
      for (const m of MODES) {
        try {
          const r = fresh(m.id);
          for (let i = 0; i < 3; i++) r.render(false, freq, wave, levels, 16.7);
        } catch (err) {
          broke.push(`${m.id}: ${err.message}`);
        }
      }
      expect(broke).toEqual([]);
    });
  }

  it('recovers after a NaN frame instead of staying poisoned', () => {
    const good = { bass: 0.6, mid: 0.4, high: 0.3, level: 0.5, beatPulse: 0, beatPhase: 0.2, bpm: 120, beatConfidence: 0.8 };
    for (const m of MODES) {
      const r = fresh(m.id);
      r.render(false, spectrum(120), wave, FRAMES['NaN levels'][1], 16.7);
      expect(() => {
        for (let i = 0; i < 4; i++) r.render(false, spectrum(200), wave, good, 16.7);
      }, `${m.id} stayed poisoned`).not.toThrow();
      // and the smoothed bands must be real numbers again
      for (const k of ['bass', 'mid', 'high', 'level']) {
        expect(Number.isFinite(r.sm[k]), `${m.id}.sm.${k}`).toBe(true);
      }
    }
  });
});

describe('reduced motion', () => {
  /* style.css collapses CSS animation under prefers-reduced-motion, but the
     stage is the largest moving thing in the app and nothing consulted the
     preference on the way to the canvas. Whole-frame effects — the beat
     zoom and the glitch slice — are what matter for vestibular comfort;
     the visualisation itself is the point of the app and stays.

     Toggling the preference is covered in tests/motion.test.js, which can
     reset the module between cases. motion.js caches the MediaQueryList
     rather than re-querying every frame, so a swap of window.matchMedia
     part-way through this file would not be observed — these cases assert
     what is true for a single fixed preference. */
  const wave = new Uint8Array(2048).fill(128);
  const spectrum = new Uint8Array(1024).fill(180);
  const hitting = { bass: 1, mid: 0.8, high: 0.6, level: 1, beatPulse: 1, beatPhase: 0, bpm: 128, beatConfidence: 1 };

  const renderReduced = (modeId) => {
    const prev = globalThis.window.matchMedia;
    const realRandom = Math.random;
    globalThis.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    Math.random = mulberry32(0x5EED);
    try {
      const r = new Renderer(makeCanvas());
      r.dpr = 1;
      r.setTheme(THEMES.find((t) => t.id === 'brass'));
      r.setMode(modeId);
      for (let i = 0; i < 10; i++) r.render(false, spectrum, wave, hitting, 16.7);
      const out = createCanvas(W, H);
      const cx = out.getContext('2d');
      cx.fillStyle = '#0b0a09';
      cx.fillRect(0, 0, W, H);
      cx.drawImage(r.canvas, 0, 0, W, H);
      return cx.getImageData(0, 0, W, H).data;
    } finally {
      globalThis.window.matchMedia = prev;
      Math.random = realRandom;
    }
  };

  it('still draws the visualisation — it is calmed, not disabled', () => {
    const stat = stats(renderReduced('bars'));
    expect(stat.max - stat.min).toBeGreaterThan(4);
  });

  it('renders every mode on a hard beat without throwing', () => {
    const broke = [];
    for (const m of MODES) {
      try { renderReduced(m.id); } catch (e) { broke.push(`${m.id}: ${e.message}`); }
    }
    expect(broke).toEqual([]);
  });

  it('keeps highlights in range with motion suppressed', () => {
    for (const id of ['bars', 'tunnel', 'orb']) {
      expect(stats(renderReduced(id)).white, id).toBeLessThan(0.25);
    }
  });
});

describe('theme coverage', () => {
  it.each(THEMES.map((t) => [t.id]))('renders bars under theme %s', (themeId) => {
    const { min, max, white } = stats(renderMode('bars', { themeId, frames: 30 }));
    expect(max - min).toBeGreaterThan(4);
    expect(white).toBeLessThan(0.5);
  });
});
