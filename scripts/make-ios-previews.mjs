#!/usr/bin/env node
// Larger native artwork, rendered by the same scene programs as the stage.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { MODES, THEMES } from '../src/themes.js';
const out = 'ios/AudioVisor/VisualPreviews';
mkdirSync(out, { recursive: true });
const server = await createServer({ server: { port: 0 }, logLevel: 'error' });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ args: ['--use-angle=metal'] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(() => window.__av.ensureStage());
  await page.waitForFunction(() => window.__av?.ray?.ok, null, { timeout: 60000 });
  await page.evaluate((theme) => {
    const ray = window.__av.ray;
    ray.setQuality('high');
    ray.setTheme(theme);
    ray.resize(1000, 700);
  }, THEMES.find(t => t.id === 'iris'));
  for (const [index, mode] of MODES.entries()) {
    const png = await page.evaluate((index) => {
      const av = window.__av;
      av.ray._scene(index);
      const result = av.pump(index, 32, 4);
      if (result.glError || av.ray._drawnMode !== index) throw new Error(`Scene ${index} did not render`);
      const canvas = document.createElement('canvas');
      canvas.width = 1000; canvas.height = 700;
      canvas.getContext('2d').drawImage(av.ray.canvas, 0, 0, 1000, 700);
      return canvas.toDataURL('image/png');
    }, index);
    const canvas = createCanvas(1000, 700);
    canvas.getContext('2d').drawImage(await loadImage(Buffer.from(png.split(',')[1], 'base64')), 0, 0);
    writeFileSync(`${out}/${mode.id}.jpg`, await canvas.encode('jpeg', 88));
    console.log(`Captured ${mode.name}`);
  }
} finally {
  await browser?.close();
  await server.close();
}
