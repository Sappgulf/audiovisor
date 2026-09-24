#!/usr/bin/env node
/**
 * End-to-end smoke of the built app in headless Chromium: loads a synthetic
 * track, then walks every mode (2D and raytraced), theme, drawer panel,
 * dialog and keyboard shortcut, failing on any page error, console error or
 * a mode that renders a blank frame.
 *
 *   npm run build && npm run e2e
 */
import { chromium } from 'playwright';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { preview } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { MODES, THEMES } from '../src/themes.js';

const OUT = process.env.E2E_OUT || 'e2e-out';
mkdirSync(OUT, { recursive: true });

// 6s stereo WAV: kick on the beat plus a chord, so bars, BPM and bass react.
function wav(seconds = 40, rate = 44100) {
  const n = seconds * rate, data = Buffer.alloc(44 + n * 4);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 4, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 4, 28); data.writeUInt16LE(4, 32);
  data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(n * 4, 40);
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let i = 0; i < n; i++) {
    const t = i / rate, bt = t % 0.5, beatNo = Math.floor(t / 0.5) % 4;
    const kick = Math.sin(2 * Math.PI * (55 + 120 * Math.exp(-bt * 40)) * bt) * Math.exp(-bt * 9) + noise() * 0.5 * Math.exp(-bt * 300);
    const snare = beatNo % 2 ? noise() * 0.5 * Math.exp(-bt * 25) : 0;
    const hat = noise() * 0.15 * Math.exp(-(t % 0.25) * 60);
    const pad = 0.06 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t) + Math.sin(2 * Math.PI * 330 * t));
    const v = Math.max(-1, Math.min(1, 0.5 * kick + snare + hat + pad)) * 30000;
    data.writeInt16LE(v | 0, 44 + i * 4); data.writeInt16LE(v | 0, 46 + i * 4);
  }
  return data;
}
const trackPath = `${OUT}/track.wav`;
writeFileSync(trackPath, wav());

const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: 'silent' });
const url = 'http://localhost:4179/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const problems = [];
const tag = (s) => (msg) => problems.push(`[${s}] ${msg}`);
page.on('pageerror', (e) => tag('pageerror')(e.stack || e.message));
// Third-party hosts (fonts, provider SDKs) are out of scope here and are
// often unreachable from CI sandboxes; only first-party failures count.
const local = (u) => !u || u.startsWith('http://localhost') || u.startsWith('blob:') || u.startsWith('data:');
page.on('console', (m) => {
  if (m.type() === 'error' && local(m.location()?.url)) tag('console')(m.text());
});
page.on('requestfailed', (r) => { if (local(r.url())) tag('requestfailed')(`${r.url()} ${r.failure()?.errorText}`); });

const step = async (name, fn) => {
  const before = problems.length;
  try { await fn(); } catch (e) { problems.push(`[step:${name}] ${e.message.split('\n')[0]}`); }
  const n = problems.length - before;
  console.log(`${n ? '✖' : '✓'} ${name}${n ? `  (${n} issue${n > 1 ? 's' : ''})` : ''}`);
};

// Fraction of the stage that is lit, read from a real screenshot: WebGL
// canvases clear their drawing buffer after compositing, so reading them
// back from script reports black even when the frame on screen is not.
const litFraction = async () => {
  const box = await page.locator('#stage').boundingBox();
  const img = await loadImage(await page.screenshot({ clip: box }));
  const c = createCanvas(64, 40); const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, 64, 40);
  const d = ctx.getImageData(0, 0, 64, 40).data; let lit = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
  return lit / (d.length / 4);
};

await step('boot', async () => {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__av?.renderer, null, { timeout: 15000 });
});
await step('dismiss onboarding', async () => {
  await page.keyboard.press('Escape');
});
await step('load track via file input', async () => {
  await page.setInputFiles('#file-input', trackPath);
  await page.waitForFunction(() => document.getElementById('stage')?.classList.contains('is-empty') === false, null, { timeout: 10000 });
  await page.waitForTimeout(1500);
});
await step('offline tempo primes ~120 BPM', async () => {
  await page.waitForFunction(() => window.__av.state.analyzedBpm > 0, null, { timeout: 15000 });
  const bpm = await page.evaluate(() => window.__av.state.analyzedBpm);
  if (Math.abs(bpm - 120) > 3) throw new Error(`analyzed ${bpm} BPM, expected 120`);
});
await step('audio is playing', async () => {
  await page.evaluate(() => { const a = window.__av.engine?.audio; if (a) a.loop = true; });
  const playing = await page.evaluate(() => window.__av.engine?.isPlaying ?? !window.__av.engine?.audio?.paused);
  if (!playing) throw new Error('engine not playing after load');
});

const blank = [];
for (const [i, m] of MODES.entries()) {
  await step(`mode ${m.id}`, async () => {
    await page.evaluate((id) => window.__av.renderer.setMode(id), m.id);
    await page.waitForTimeout(450);
    const lit = await litFraction();
    if (lit < 0.01) blank.push(m.id);
    if (i % 4 === 0) await page.screenshot({ path: `${OUT}/mode-${m.id}.png` });
  });
}
await step('raytrace on', async () => { await page.keyboard.press('KeyR'); await page.waitForTimeout(800); });
const rayBlank = [];
for (const m of MODES) {
  await step(`ray ${m.id}`, async () => {
    await page.evaluate((id) => (window.__av.ray?.setMode?.(id), window.__av.renderer.setMode(id)), m.id);
    await page.waitForTimeout(350);
    if ((await litFraction()) < 0.01) rayBlank.push(m.id);
  });
}
await step('raytrace off', async () => { await page.keyboard.press('KeyR'); await page.waitForTimeout(300); });

await step('drawer + tabs', async () => {
  await page.click('#drawer-toggle');
  for (const t of ['source', 'look', 'audio', 'studio']) { await page.click(`#tab-${t}`); await page.waitForTimeout(250); }
});
await step('themes', async () => {
  await page.click('#tab-look');
  const n = await page.locator('#theme-row button').count();
  if (n < THEMES.length) throw new Error(`theme buttons ${n} < ${THEMES.length}`);
  for (let i = 0; i < n; i++) await page.locator('#theme-row button').nth(i).click();
});
await step('mode filter', async () => {
  await page.fill('#mode-filter', 'zzzz'); await page.waitForTimeout(100);
  if (!(await page.isVisible('#mode-empty'))) throw new Error('empty state not shown');
  await page.fill('#mode-filter', '');
});
await step('fx chips', async () => {
  await page.click('#tab-audio');
  const chips = page.locator('#fx-row button');
  for (let i = 0; i < await chips.count(); i++) { await chips.nth(i).click(); await chips.nth(i).click(); }
});
await step('drawer close', async () => { await page.click('#drawer-close'); });
await step('transport', async () => {
  await page.click('#play-pause-btn'); await page.waitForTimeout(200); await page.click('#play-pause-btn');
});
await step('keyboard shortcuts', async () => {
  for (const k of ['KeyM', 'KeyT', 'Digit3', 'ArrowUp', 'ArrowDown', 'ArrowRight', 'ArrowLeft', 'KeyL', 'KeyC', 'Escape', 'KeyQ', 'Escape']) {
    await page.keyboard.press(k); await page.waitForTimeout(80);
  }
});
await step('shortcuts overlay', async () => { await page.click('#help-btn'); await page.waitForTimeout(200); await page.keyboard.press('Escape'); });
await step('about dialog', async () => { await page.click('#nav-about'); await page.waitForTimeout(200); await page.keyboard.press('Escape'); });
await step('mobile viewport', async () => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  if (overflow) throw new Error('horizontal overflow at 390px');
  await page.screenshot({ path: `${OUT}/mobile.png` });
});

if (blank.length) problems.push(`[blank] 2D modes rendered blank: ${blank.join(', ')}`);
if (rayBlank.length) problems.push(`[blank] raytraced modes rendered blank: ${rayBlank.join(', ')}`);

await browser.close();
await server.close();
const uniq = [...new Set(problems)];
console.log(`\n${uniq.length ? uniq.join('\n') : 'no problems'}`);
process.exit(uniq.length ? 1 : 0);
