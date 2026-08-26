/**
 * Load-time probe — first paint, DCL, the resource wall, and anything still
 * pending after 4s. Run it against a deployed URL or a local build to see
 * what a cold visit waits on (it is how the font-defer fix was found).
 *
 *   node scripts/load-metrics.mjs https://audiovisor-one.vercel.app/
 */
import { chromium } from 'playwright';
const url = process.argv[2] || 'https://audiovisor-one.vercel.app/';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(4000);
const metrics = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const paint = {};
  for (const e of performance.getEntriesByType('paint')) paint[e.name] = Math.round(e.startTime);
  const res = performance.getEntriesByType('resource');
  let pending = [];
  const byType = {};
  let renderBlocking = [];
  for (const r of res) {
    const name = r.name.split('/').slice(-1)[0].slice(0, 40);
    if (!byType[r.initiatorType]) byType[r.initiatorType] = 0;
    byType[r.initiatorType]++;
    const done = r.responseEnd > 0;
    if (!done) pending.push(name);
    else if (r.initiatorType === 'link' && /css|font/.test(name)) renderBlocking.push(`${Math.round(r.startTime + r.duration)}ms  ${name}`);
  }
  return {
    dcl: Math.round(nav.domContentLoadedEventEnd),
    fp: paint['first-paint'],
    fcp: paint['first-contentful-paint'],
    resourceCount: res.length,
    transfers: Math.round(res.reduce((n, r) => n + (r.transferSize || 0), 0) / 1024),
    pending: pending.slice(0, 10),
    renderBlocking: renderBlocking.slice(0, 6),
    fmt: byType,
  };
});
console.log(JSON.stringify(metrics, null, 2));
await browser.close();
