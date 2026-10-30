#!/usr/bin/env node
/**
 * First-install offline check.
 *
 * Serves the real dist/ build, waits for the service worker to precache the
 * build manifest, then reloads with the network disabled. The app must still
 * boot, which is the part a manifest-only PWA got wrong.
 *
 *   npm run offline
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const ROOT = 'dist';
if (!existsSync(join(ROOT, 'precache-manifest.json'))) {
  console.error('✗ dist/precache-manifest.json missing — run `npm run build` first');
  process.exit(1);
}
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const SECURITY = Object.fromEntries((vercel.headers.find((h) => h.source === '/(.*)')?.headers || []).map((h) => [h.key, h.value]));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 1200, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|CSP/i.test(m.text())) errors.push(m.text()); });
await page.goto(base, { waitUntil: 'load', timeout: 30000 });
await page.evaluate(async () => {
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      setTimeout(resolve, 5000);
    });
  }
});
await page.waitForTimeout(800);
const cached = await page.evaluate(async () => {
  const names = await caches.keys();
  const entries = [];
  for (const name of names) {
    const cache = await caches.open(name);
    entries.push(...(await cache.keys()).map((r) => new URL(r.url).pathname));
  }
  return entries;
});
const hasEntry = cached.some((p) => /\/assets\/index-.*\.js$/.test(p));
const hasFont = cached.some((p) => p.endsWith('.woff2'));
if (!hasEntry || !hasFont) {
  console.error('✗ precache incomplete:', { hasEntry, hasFont, cached: cached.slice(0, 10) });
  await browser.close(); server.close(); process.exit(1);
}
await ctx.setOffline(true);
await page.reload({ waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => !!window.__av, null, { timeout: 15000 });
const ready = await page.evaluate(() => ({ av: !!window.__av, title: document.title, stage: !!document.getElementById('stage'), toasts: document.querySelectorAll('.toast').length }));
await ctx.setOffline(false);
await browser.close();
server.close();
if (!ready.av || !ready.stage || errors.length) {
  console.error('✗ offline boot failed:', { ready, errors });
  process.exit(1);
}
console.log(`✓ offline boot works — ${cached.length} precached entries, ${ready.title}`);
