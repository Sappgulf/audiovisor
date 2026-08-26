#!/usr/bin/env node
/**
 * Per-mode raytraced frame-cost sweep.
 *
 * Drives the dev-only window.__av.pump() hook in a real headless Chromium on
 * the GPU (--use-angle=metal; the default headless stack is a SwiftShader
 * CPU rasterizer and reports numbers an order of magnitude worse) and prints
 * the per-frame cost of every mode, worst first.
 *
 * Use it whenever a scene shader changes: the adaptive tiering in main.js
 * will hide regressions by dropping the whole stage a tier, so the only way
 * to see a mode got 30% heavier is to measure it directly.
 *
 * Two things this has to do to report a real number, and for a long time did
 * neither:
 *
 *   1. Sync the GPU. pump() only submits work; the driver returns
 *      immediately. Timing it measures JavaScript, and the GPU cost then
 *      surfaces later as backpressure on whichever mode happens to run next
 *      — which is why the sweep put Aurora Terrain at 163ms against 65ms for
 *      the next worst when an honest measurement has them at 46 and 40. A
 *      one-pixel readPixels forces the pipeline to drain.
 *
 *   2. Pin the tier. The app's own rAF loop is still running, and it retiers
 *      the stage whenever frames run long — mid-measurement, changing the
 *      render resolution underneath the timer. Unpinned, the same build
 *      measured 18ms on one run and 45ms on the next. Every timed run
 *      re-pins, and a mode whose resolution moved anyway is flagged.
 *
 * Numbers are a median of repeats, and are comparable within one run of this
 * script. Comparing across runs — across machines, thermal states or driver
 * versions — is not meaningful; to compare two builds, measure them
 * interleaved in the same session.
 *
 *   npm run sweep
 */
import { chromium } from 'playwright';
import { MODES } from '../src/themes.js';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const tierFlag = args.indexOf('--tier');
const TIER = tierFlag >= 0 && args[tierFlag + 1] ? args[tierFlag + 1] : null;

const server = await createServer({ root: process.cwd(), server: { port: 0, strictPort: true }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(2500);

const FRAMES = 20;
const REPEATS = 3;

const rows = await page.evaluate(({ tier, count, frames, repeats }) => {
  const av = window.__av;
  const gl = av.ray.gl;
  const px = new Uint8Array(4);
  const drain = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const pin = () => av.ray.setQuality(tier || av.ray.quality);
  const out = [];
  for (let m = 0; m < count; m++) {
    try {
      pin();
      av.pump(m, frames, 3);
      drain();                                   // warm: shaders, textures, tier
      const runs = [];
      const res = new Set();
      for (let r = 0; r < repeats; r++) {
        pin();
        const t0 = performance.now();
        av.pump(m, frames, 3);
        drain();
        runs.push((performance.now() - t0) / frames);
        res.add(`${av.ray.rw}x${av.ray.rh}`);
      }
      runs.sort((a, b) => a - b);
      out.push({ mode: m, ms: runs[runs.length >> 1], res: [...res] });
    } catch {
      out.push({ mode: m, ms: -1, res: [] });
    }
  }
  return out;
}, { tier: TIER, count: MODES.length, frames: FRAMES, repeats: REPEATS });
rows.sort((a, b) => b.ms - a.ms);
const res = rows.find((r) => r.res.length)?.res[0] ?? '?';
console.log(`median frame ms per mode, worst first — ${res}${TIER ? ` @ ${TIER}` : ''}:`);
for (const r of rows) {
  const id = MODES[r.mode]?.id ?? String(r.mode);
  const drift = r.res.length > 1 ? `  ! tier moved: ${r.res.join(' ')}` : '';
  console.log(
    `  ${String(r.mode).padStart(2)}  ${id.padEnd(11)}` +
    `${r.ms < 0 ? '  ERROR' : r.ms.toFixed(2).padStart(7) + 'ms'}${drift}`,
  );
}
await browser.close();
await server.close();
