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
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 1200, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|CSP/i.test(m.text())) errors.push(m.text()); });
console.log('· loading build and waiting for service worker');
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
console.log('· service worker active; checking precache');
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
/* PWA share_target: POST a tiny WAV, then reload into ?shared=1 and let
   file-loader take it out of the cache. This exercises the SW branch the
   manifest advertises, not just the manifest JSON. */
const shared = await page.evaluate(async () => {
  const sr = 8000, n = Math.floor(sr * 0.5);
  const ab = new ArrayBuffer(44 + n * 2);
  const v = new DataView(ab);
  const write = (o, text) => [...text].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  write(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); write(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); write(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / sr * Math.PI * 2 * 440) * 0.18 * 32767, true);
  const form = new FormData();
  form.append('audio', new File([ab], 'shared-test.wav', { type: 'audio/wav' }));
  await fetch('/share-target', { method: 'POST', body: form, redirect: 'manual' }).catch(() => {});
  const hit = await caches.match('/__shared_audio__');
  return { cached: !!hit, header: hit?.headers.get('X-File-Name') || '' };
});
if (!shared.cached) {
  console.error('✗ share_target did not park the file in the cache:', shared);
  await browser.close(); server.close(); process.exit(1);
}
console.log('· loading shared file into the app');
await page.goto(base + '?shared=1', { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window.__av?.engine?.playing, null, { timeout: 30000 });
const sharedInfo = await page.evaluate(() => ({ name: window.__av.engine.track?.name, query: location.search }));
if (!/shared-test/.test(sharedInfo.name || '') || sharedInfo.query.includes('shared')) {
  console.error('✗ shared file was not loaded:', sharedInfo);
  await browser.close(); server.close(); process.exit(1);
}
console.log(`✓ share_target loaded ${sharedInfo.name}`);

console.log('· going offline and reloading');
await ctx.setOffline(true);
await page.reload({ waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => !!window.__av, null, { timeout: 30000 });
const ready = await page.evaluate(() => ({ av: !!window.__av, title: document.title, stage: !!document.getElementById('stage'), toasts: document.querySelectorAll('.toast').length }));
await ctx.setOffline(false);
await browser.close();
server.close();
if (!ready.av || !ready.stage || errors.length) {
  console.error('✗ offline boot failed:', { ready, errors });
  process.exit(1);
}
console.log(`✓ offline boot works — ${cached.length} precached entries, ${ready.title}`);
