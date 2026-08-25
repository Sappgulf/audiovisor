#!/usr/bin/env node
/**
 * Regenerate public/og.png — the social-share card.
 *
 * The old card was a flat diamond on a dotted grid; it looked nothing like
 * the product. This renders the REAL WebGL2 raytraced stage: og.html mounts
 * a RayStage at 1200x630, pumps a synthetic track through it until the
 * temporal accumulator converges, overlays the brand lockup, and Playwright
 * screenshots the result once the page signals OG READY.
 *
 *   npm run og                                     # lava / cyber -> public/og.png
 *   node scripts/make-og.mjs --mode fluid --theme cyber --out /tmp/alt.png
 *
 * Output is committed (like the icons) so deploys don't need a GPU.
 */
import { chromium } from 'playwright';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadImage, createCanvas } from '@napi-rs/canvas';

/* ---------- args ---------- */

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const MODE = flag('mode', 'city');
const THEME = flag('theme', 'cyber');
const OUT = flag('out', 'public/og.png');

/* ---------- serve ---------- */

const { createServer } = await import('vite');
const server = await createServer({
  root: process.cwd(),
  server: { port: 0, strictPort: true },
  logLevel: 'error',
});
await server.listen();
const base = server.resolvedUrls?.local?.[0];
if (!base) {
  console.error('vite dev server did not report a URL');
  await server.close();
  process.exit(1);
}
/* t0=20/f=60: the flythrough camera is mid-canyon — a magenta tower slices
   through blue bokeh and the bottom-left stays dark enough for the lockup.
   Later windows drift inside geometry and wash to fog. */
const url = `${base}og.html?mode=${encodeURIComponent(MODE)}&theme=${encodeURIComponent(THEME)}&frames=60&t0=20`;

/* ---------- shoot ---------- */

/* --use-angle=metal is the difference between the M1 GPU and a SwiftShader
   software rasterizer; 150 ultra-quality raytraced frames on CPU is minutes,
   on the GPU it is seconds. */
const LAUNCH_CONFIGS = [
  { args: ['--use-angle=metal'] },
  {}, // fallback: default headless (SwiftShader) — slow but works
];

console.log(`rendering ${MODE} / ${THEME} -> ${OUT}`);
let browser = null;
for (const cfg of LAUNCH_CONFIGS) {
  browser = await chromium.launch(cfg).catch(() => null);
  if (browser) break;
}
if (!browser) {
  console.error('could not launch any Chromium (npx playwright install chromium)');
  await server.close();
  process.exit(1);
}
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(url, { waitUntil: 'commit', timeout: 60_000 });

  /* og.html pumps ~150 raytraced frames synchronously on load, then flips
     its title; wait for that rather than guessing with a time budget */
  await page.waitForFunction(
    () => ['OG READY', 'OG ERROR'].includes(document.title),
    null,
    { timeout: 180_000, polling: 250 },
  );
  if ((await page.title()) === 'OG ERROR') {
    console.error('og.html reported a render failure:');
    console.error(await page.textContent('#og-error'));
    process.exit(1);
  }
  await page.evaluate(() => document.fonts.ready);
  /* headless sits idle after the pump with nothing animating, and the
     compositor may not have a fresh frame queued — kick one, or the
     screenshot blocks until its own timeout */
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const tmp = mkdtempSync(join(tmpdir(), 'og-shot-'));
  const shot = join(tmp, 'og.png');
  await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: 1200, height: 630 } });

  /* A failed stage renders red error text on black instead of the scene.
     The real stage at exposure 1.3 never measures this dark, so a near-black
     capture means something broke — refuse to write it. */
  const img = await loadImage(shot);
  if (img.width !== 1200 || img.height !== 630) {
    console.error(`unexpected capture size ${img.width}x${img.height}, wanted 1200x630`);
    process.exit(1);
  }
  const canvas = createCanvas(1200, 630);
  const x2d = canvas.getContext('2d');
  x2d.drawImage(img, 0, 0);
  const data = x2d.getImageData(0, 0, 1200, 630).data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4 * 7) {
    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    n++;
  }
  const mean = sum / n;
  if (mean < 6) {
    console.error(`capture is near-black (mean ${mean.toFixed(1)}) — the stage probably failed to render`);
    process.exit(1);
  }

  copyFileSync(shot, OUT);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`wrote ${OUT} (${MODE} / ${THEME}, mean luminance ${mean.toFixed(1)})`);
} finally {
  await browser.close();
  await server.close();
}
