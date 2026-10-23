#!/usr/bin/env node
/**
 * Raytraced-stage contact sheet.
 *
 * `npm run shots` renders the Canvas2D fallback; this renders the scene each
 * mode actually shows, on the GPU, by driving the dev-only window.__av.pump()
 * hook in headless Chromium (--use-angle=metal, same as the sweep). Writes one
 * PNG per mode plus a labelled contact sheet, so "does this mode read as its
 * own scene?" is answerable by looking rather than by guessing.
 *
 *   npm run rayshots [--tier ultra]
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { MODES } from '../src/themes.js';

const args = process.argv.slice(2);
const tf = args.indexOf('--tier');
const TIER = tf >= 0 && args[tf + 1] ? args[tf + 1] : null;
const MOBILE = args.includes('--mobile');
const OUT = MOBILE ? '/tmp/audiovisor-ray-mobile' : '/tmp/audiovisor-ray';
mkdirSync(OUT, { recursive: true });

const server = await createServer({ root: process.cwd(), server: { port: 0, strictPort: true }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
/* The app's PWA registration intentionally reloads once when a new worker
   takes control. This sweep is about renderer output, so block service
   workers in its isolated context to keep that lifecycle event from racing
   the screenshot evaluate call. */
const context = await browser.newContext({
  serviceWorkers: 'block',
  viewport: MOBILE ? { width: 390, height: 844 } : { width: 1280, height: 800 },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
await page.goto(base, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window.__av?.ray?.ok, null, { timeout: 30000 });
await page.waitForTimeout(2500);

const shots = await page.evaluate(async ({ tier, ids }) => {
  const av = window.__av;
  if (tier) av.ray.setQuality(tier);
  const rc = document.getElementById('ray-canvas');
  const out = [];
  for (let m = 0; m < ids.length; m++) {
    // Resolve the requested program explicitly: a synchronous pump can
    // otherwise keep drawing the previous scene while parallel linking runs.
    av.ray._scene(m);
    const result = av.pump(m, 60, 3);
    if (result.glError || av.ray._drawnMode !== m) throw new Error(`${ids[m]} did not render: ${JSON.stringify(result)}`);
    const cv = document.createElement('canvas');
    cv.width = 420;
    cv.height = Math.round(cv.width * rc.height / rc.width);
    const cx = cv.getContext('2d');
    cx.fillStyle = '#000'; cx.fillRect(0, 0, cv.width, cv.height);
    cx.drawImage(rc, 0, 0, cv.width, cv.height);
    const pixels = cx.getImageData(0, 0, cv.width, cv.height).data;
    let min = 255, max = 0, white = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const luminance = pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
      min = Math.min(min, luminance); max = Math.max(max, luminance);
      if (pixels[i] > 245 && pixels[i + 1] > 245 && pixels[i + 2] > 245) white++;
    }
    const clipped = white / (pixels.length / 4);
    if (max - min < 8 || clipped > 0.1) throw new Error(`${ids[m]} is flat or overexposed: ${min}..${max}, clipped ${clipped}`);
    out.push({ id: ids[m], aspect: cv.width / cv.height, clipped, png: cv.toDataURL('image/png') });
  }
  return out;
}, { tier: TIER, ids: MODES.map((m) => m.id) });

for (const s of shots) {
  writeFileSync(`${OUT}/${s.id}.png`, Buffer.from(s.png.split(',')[1], 'base64'));
}

/* one sheet so a whole pass is a single image */
const sheet = await page.evaluate(async ({ shots, mobile }) => {
  const COLS = mobile ? 6 : 5, CW = mobile ? 150 : 300, LABEL_H = 20;
  const IMAGE_H = Math.round(CW / shots[0].aspect);
  const CH = IMAGE_H + LABEL_H;
  const c = document.createElement('canvas');
  c.width = COLS * CW; c.height = Math.ceil(shots.length / COLS) * CH;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < shots.length; i++) {
    const img = new Image();
    img.src = shots[i].png;
    await img.decode();
    const px = (i % COLS) * CW, py = Math.floor(i / COLS) * CH;
    x.drawImage(img, px, py, CW, IMAGE_H);
    x.fillStyle = '#fff'; x.font = '14px monospace';
    x.fillText(shots[i].id, px + 6, py + CH - 6);
  }
  return c.toDataURL('image/png');
}, { shots, mobile: MOBILE });
writeFileSync(`${OUT}/sheet.png`, Buffer.from(sheet.split(',')[1], 'base64'));

console.log(`${shots.length} modes -> ${OUT}/ (sheet.png)`);
console.log(`All requested programs rendered; worst white clipping ${(Math.max(...shots.map((s) => s.clipped)) * 100).toFixed(2)}%.`);
await context.close();
await browser.close();
await server.close();
if (errors.length) throw new Error(errors.join('\n'));
