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
const OUT = '/tmp/audiovisor-ray';
mkdirSync(OUT, { recursive: true });

const server = await createServer({ root: process.cwd(), server: { port: 0, strictPort: true }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(2500);

const shots = await page.evaluate(async ({ tier, ids }) => {
  const av = window.__av;
  if (tier) av.ray.setQuality(tier);
  const rc = document.getElementById('ray-canvas');
  const out = [];
  for (let m = 0; m < ids.length; m++) {
    av.pump(m, 60, 3);
    const cv = document.createElement('canvas');
    cv.width = 420; cv.height = 300;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#000'; cx.fillRect(0, 0, cv.width, cv.height);
    cx.drawImage(rc, 0, 0, cv.width, cv.height);
    out.push({ id: ids[m], png: cv.toDataURL('image/png') });
  }
  return out;
}, { tier: TIER, ids: MODES.map((m) => m.id) });

for (const s of shots) {
  writeFileSync(`${OUT}/${s.id}.png`, Buffer.from(s.png.split(',')[1], 'base64'));
}

/* one sheet so a whole pass is a single image */
const sheet = await page.evaluate(async (shots) => {
  const COLS = 5, CW = 300, CH = 230;
  const c = document.createElement('canvas');
  c.width = COLS * CW; c.height = Math.ceil(shots.length / COLS) * CH;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < shots.length; i++) {
    const img = new Image();
    img.src = shots[i].png;
    await img.decode();
    const px = (i % COLS) * CW, py = Math.floor(i / COLS) * CH;
    x.drawImage(img, px, py, CW, CH - 20);
    x.fillStyle = '#fff'; x.font = '14px monospace';
    x.fillText(shots[i].id, px + 6, py + CH - 6);
  }
  return c.toDataURL('image/png');
}, shots);
writeFileSync(`${OUT}/sheet.png`, Buffer.from(sheet.split(',')[1], 'base64'));

console.log(`${shots.length} modes -> ${OUT}/ (sheet.png)`);
await browser.close();
await server.close();
