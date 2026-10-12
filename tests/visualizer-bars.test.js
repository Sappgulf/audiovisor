import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { THEMES } from '../src/themes.js';
import { makeFakeCtx, ensureGlobals } from './helpers/canvas.js';

/* Golden trace for Spectrum Bars. Inputs are fixed (a scripted spectrum, a
   fixed beat and a fixed clock), so every canvas call, property write and
   gradient colour stop the mode makes over a run is deterministic. Gradients
   are recorded with their stops: the glass slab's colour ramp is what this
   pins, and the particle helper's gradient stub would not have shown it. */
const EXPECTED_DIGEST = 'a9998f3995b59351c0a8b08a616aaaadc870feaf7858fc12a4544570e05d0444';

function recordingCanvas(log) {
  let nextGradient = 0;
  const base = makeFakeCtx();
  const makeGradient = (kind) => (...args) => {
    const gid = nextGradient++;
    log.push([kind, gid, ...args]);
    return { gid, addColorStop: (offset, color) => log.push(['stop', gid, offset, color]) };
  };
  base.createLinearGradient = makeGradient('linear');
  base.createRadialGradient = makeGradient('radial');
  const ctx = new Proxy(base, {
    get(t, k) {
      const v = t[k];
      if (typeof v !== 'function') return v;
      return (...args) => { log.push([k, ...args]); return v(...args); };
    },
    set(t, k, v) {
      log.push(['set', k, v && typeof v === 'object' && 'gid' in v ? { gradient: v.gid } : v]);
      t[k] = v;
      return true;
    },
  });
  return { getContext: () => ctx, getBoundingClientRect: () => ({ width: 800, height: 600 }), width: 800, height: 600 };
}

/* A spectrum with a bass hump, a mid ripple and a treble tail, moving over
   time so the peaks rise, fall and reset on different columns. */
function spectrum(f) {
  const freq = new Uint8Array(1024);
  for (let k = 0; k < freq.length; k++) {
    const bass = 150 * Math.exp(-k / 40) * (0.6 + 0.4 * Math.sin(f / 13));
    const mid = 60 * Math.max(0, Math.sin(k / 23 + f / 9));
    const air = 25 * Math.max(0, Math.cos(k / 7 - f / 5));
    freq[k] = Math.max(0, Math.min(255, Math.round(bass + mid + air)));
  }
  return freq;
}

function runBars(frames) {
  ensureGlobals();
  return import('../src/visualizers.js').then(({ Renderer }) => {
    const log = [];
    const r = new Renderer(recordingCanvas(log));
    r.mode = 'bars';
    r.quality = 'high';
    r.setTheme(THEMES[0]);
    r._buildCache();
    r.w = 800;
    r.h = 600;
    const dt = 1 / 60;
    for (let f = 0; f < frames; f++) {
      r.t = f * dt;
      r.beat = f % 30 < 4 ? 0.8 : 0.15;
      r.bassFocus = 0.4;
      r._bars(spectrum(f), dt * 60, dt);
      log.push(['frame', f, r.peaks.length]);
    }
    /* sprites are logged by index, not identity, so the digest pins which
       colour sprite each halo draws with */
    const sprites = [...r._dotSprites.values()];
    return log.map((entry) => entry.map((v) => {
      if (typeof v === 'object' && v !== null && sprites.includes(v)) return `sprite${sprites.indexOf(v)}`;
      return v;
    }));
  });
}

describe('spectrum bars golden trace', () => {
  it('draws the same calls and gradient stops for the same inputs', async () => {
    const trace = await runBars(180);
    const digest = createHash('sha256').update(JSON.stringify(trace)).digest('hex');
    /* the run must exercise the glass body and the reflections, or the digest pins less than it claims */
    const stops = trace.filter((e) => e[0] === 'stop').length;
    const fills = trace.filter((e) => e[0] === 'fill').length;
    expect(stops).toBeGreaterThan(500);
    expect(fills).toBeGreaterThan(300);
    expect(digest).toBe(EXPECTED_DIGEST);
  });
});
