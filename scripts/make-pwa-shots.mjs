#!/usr/bin/env node
/**
 * Regenerate the install-prompt screenshots in public/screenshots.
 * They show the product with real audio and a rendered stage, not a mockup.
 *
 *   npm run shots:pwa
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd(), server: { port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, args: process.platform === 'darwin' ? ['--use-angle=metal'] : [] });
mkdirSync('public/screenshots', { recursive: true });

for (const [name, viewport, mobile] of [
  ['desktop', { width: 1280, height: 720 }, false],
  ['mobile', { width: 390, height: 844 }, true],
]) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__av, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.click('#play-demo');
  await page.waitForTimeout(2400);
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await page.screenshot({ path: `public/screenshots/${name}.jpg`, type: 'jpeg', quality: 90 });
  await ctx.close();
  console.log(`public/screenshots/${name}.jpg`);
}
await browser.close();
await server.close();
