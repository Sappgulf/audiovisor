#!/usr/bin/env node
/* Capture the default WebGL stage for the mode picker. The Canvas generator
   remains available for fallback artwork; these previews show the scene a
   visitor actually sees, including its full-stage resonance field. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { MODES, THEMES } from '../src/themes.js';

const W = 176, H = 108, FRAMES = 10;
const OUT = 'public/modes';
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 0 }, logLevel: 'error' });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ args: ['--use-angle=metal'] });
  const context = await browser.newContext({ viewport: { width: 704, height: 600 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForFunction(() => window.__av?.ray?.ok);
  await page.evaluate((theme) => {
    const ray = window.__av.ray;
    ray.setQuality('high');
    ray.setTheme(theme);
    ray.resize(704, 432);
  }, THEMES.find((theme) => theme.id === 'monolith'));
  let bytes = 0;
  for (const [index, mode] of MODES.entries()) {
    const captures = await page.evaluate(({ index, count, w, h }) => {
      const av = window.__av;
      av.ray._scene(index);
      av.pump(index, 32, 3);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      const images = [];
      for (let frame = 0; frame < count; frame++) {
        const result = av.pump(index, 4, 4.056 + frame * 0.132);
        if (result.glError || av.ray._drawnMode !== index) throw new Error(`Invalid thumbnail frame: ${JSON.stringify(result)}`);
        ctx.drawImage(av.ray.canvas, 0, 0, w, h);
        images.push(canvas.toDataURL('image/png'));
      }
      return images;
    }, { index, count: FRAMES, w: W, h: H });
    const still = createCanvas(W, H);
    const strip = createCanvas(W * FRAMES, H);
    const sx = strip.getContext('2d');
    for (const [frame, capture] of captures.entries()) {
      const image = await loadImage(Buffer.from(capture.split(',')[1], 'base64'));
      sx.drawImage(image, frame * W, 0);
      if (frame === 0) still.getContext('2d').drawImage(image, 0, 0);
    }
    // These render at ~72px in the desktop picker. Spend more detail on
    // the still; a restrained hover-strip quality keeps all 24 animations
    // under the existing 600kB budget instead of shipping subpixel grain.
    const image = await still.encode('webp', 68);
    const animation = await strip.encode('webp', 40);
    writeFileSync(`${OUT}/${mode.id}.webp`, image);
    writeFileSync(`${OUT}/${mode.id}-anim.webp`, animation);
    bytes += image.length + animation.length;
    console.log(`${mode.id}: still + ${FRAMES}-frame preview`);
  }
  console.log(`${MODES.length} modes, ${(bytes / 1024).toFixed(1)} kB total`);
} finally {
  await browser?.close();
  await server.close();
}
