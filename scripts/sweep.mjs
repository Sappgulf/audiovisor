#!/usr/bin/env node
/**
 * Per-mode raytraced frame-cost sweep.
 *
 * Drives the dev-only window.__av.pump() hook in a real headless Chromium on
 * the GPU (--use-angle=metal; the default headless stack is a SwiftShader
 * CPU rasterizer and reports numbers an order of magnitude worse), renders
 * 40 frames of every mode at the current default quality and prints the
 * average per-frame cost, worst first.
 *
 * Use it whenever a scene shader changes: the adaptive tiering in main.js
 * will hide regressions by dropping the whole stage a tier, so the only way
 * to see a mode got 30% heavier is to measure it directly.
 *
 *   npm run sweep
 */
import { chromium } from 'playwright';
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

const rows = await page.evaluate((tier) => {
  const av = window.__av;
  if (tier) av.ray.setQuality(tier);
  const out = [];
  for (let m = 0; m < 22; m++) {
    try {
      const t0 = performance.now();
      av.pump(m, 40, 3);
      out.push({ mode: m, ms: (performance.now() - t0) / 40 });
    } catch {
      out.push({ mode: m, ms: -1 });
    }
  }
  return out;
}, TIER);
rows.sort((a, b) => b.ms - a.ms);
console.log(`avg frame ms per mode (worst first)${TIER ? ` @ ${TIER}` : ''}:`);
for (const r of rows) {
  console.log(`  ${String(r.mode).padStart(2)}  ${r.ms < 0 ? 'ERROR' : r.ms.toFixed(2).padStart(7) + 'ms'}`);
}
await browser.close();
await server.close();
