import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { THEMES } from '../src/themes.js';
import { makeFakeCtx, ensureGlobals } from './helpers/canvas.js';

/* Golden trace for the Particle Field. The inputs are fixed (seeded PRNG,
   scripted levels), so every canvas call and property write the mode makes
   over a run is deterministic. The digest pins the exact drawing: any change
   to the particle physics, the spawn order, the line pass or the sprite
   choice shows up here. */
const EXPECTED_DIGEST = 'baf33aa54e4f60b038e4e93425eabbaf8f7585377582a30862b803dac7f633ba';

function recordingCanvas(log) {
  const ctx = new Proxy(makeFakeCtx(), {
    get(t, k) {
      const v = t[k];
      if (typeof v !== 'function') return v;
      return (...args) => { log.push([k, ...args]); return v(...args); };
    },
    set(t, k, v) { log.push(['set', k, v]); t[k] = v; return true; },
  });
  return { getContext: () => ctx, getBoundingClientRect: () => ({ width: 800, height: 600 }), width: 800, height: 600 };
}

function runParticles(frames) {
  ensureGlobals();
  return import('../src/visualizers.js').then(({ Renderer }) => {
    const log = [];
    const r = new Renderer(recordingCanvas(log));
    r.mode = 'particles';
    r.quality = 'high';
    r.setTheme(THEMES[0]);
    r._buildCache();
    /* sprites are logged by index, not by identity, so the digest pins which
       colour sprite each particle draws with */
    const sprites = [...r._dotSprites.values()];
    for (let f = 0; f < frames; f++) {
      r.sm = {
        bass: 0.2 + 0.2 * Math.sin(f / 9),
        mid: 0.3,
        high: 0.1 + 0.1 * Math.cos(f / 7),
        level: 0.3 + 0.25 * Math.sin(f / 11) ** 2,
      };
      r.beat = f % 40 < 3 ? 0.9 : 0.1;
      r._particles(1 / 60, 1);
      log.push(['frame', f, r.particles.length]);
    }
    return log.map((entry) => entry.map((v) => {
      if (typeof v === 'object' && v !== null && sprites.includes(v)) return `sprite${sprites.indexOf(v)}`;
      return v;
    }));
  });
}

describe('particle field golden trace', () => {
  it('draws the same calls for the same inputs', async () => {
    const trace = await runParticles(240);
    const digest = createHash('sha256').update(JSON.stringify(trace)).digest('hex');
    /* the run must actually exercise the line pass, or the digest pins less than it claims */
    const strokes = trace.filter((e) => e[0] === 'stroke').length;
    expect(strokes).toBeGreaterThan(200);
    expect(digest).toBe(EXPECTED_DIGEST);
  });
});
