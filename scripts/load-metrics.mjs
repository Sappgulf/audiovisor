/**
 * Load-time probe — first paint, DCL/load, the resource wall, render-blocking
 * requests and chunks loaded after the document settles. Run it against a
 * deployed URL or a local build:
 *
 *   node scripts/load-metrics.mjs https://audiovisor-one.vercel.app/
 *   node scripts/load-metrics.mjs http://localhost:4173/
 *
 * The probe deliberately uses only Playwright + the Performance APIs so it
 * keeps working without a metrics service or build-time instrumentation.
 */
import { chromium } from 'playwright';

const url = process.argv[2] || 'https://audiovisor-one.vercel.app/';
const browser = await chromium.launch();
const page = await browser.newPage();

/* LCP/CLS/long tasks are emitted while the page loads, before the post-load
   evaluate runs. Collect them from the start with buffered observers. */
await page.addInitScript(() => {
  const out = { lcp: 0, lcpElement: '', cls: 0, longTasks: 0, longTaskMs: 0 };
  Object.defineProperty(window, '__loadMetrics', { value: out });
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        out.lcp = entry.startTime;
        out.lcpElement = entry.element?.tagName?.toLowerCase() || '';
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* unsupported: leave LCP at 0 */ }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) out.cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch { /* unsupported */ }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        out.longTasks++;
        out.longTaskMs += entry.duration;
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* unsupported */ }
});

await page.goto(url, { waitUntil: 'load', timeout: 30000 });
/* Give lazy chunks, fonts and the mode picker a chance to finish after load. */
await page.waitForTimeout(4000);

const metrics = await page.evaluate(() => {
  const round = (n) => Math.round(n || 0);
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const paint = {};
  for (const entry of performance.getEntriesByType('paint')) paint[entry.name] = round(entry.startTime);

  /* Script tags present in the served HTML are the eager path. A JS resource
     missing from this set was fetched later (a dynamic import/lazy chunk). */
  const initialScripts = new Set(
    [...document.querySelectorAll('script[src]')]
      .map((el) => new URL(el.src, location.href).pathname),
  );
  /* Fallback for browsers without Resource Timing's renderBlockingStatus. */
  const blockingUrls = new Set();
  for (const el of document.querySelectorAll('link[rel~="stylesheet"][href]')) {
    blockingUrls.add(new URL(el.href, location.href).href);
  }
  for (const el of document.querySelectorAll('script[src]')) {
    if (!el.async && !el.defer && el.type !== 'module') {
      blockingUrls.add(new URL(el.src, location.href).href);
    }
  }

  const res = performance.getEntriesByType('resource');
  const pending = [];
  const byType = {};
  const kbByType = {};
  const renderBlocking = [];
  const lateJs = [];
  const slowest = [];
  let transferred = 0;

  for (const r of res) {
    const path = new URL(r.name).pathname;
    const name = path.split('/').pop().slice(0, 48) || path;
    const type = r.initiatorType || 'other';
    byType[type] = (byType[type] || 0) + 1;
    kbByType[type] = (kbByType[type] || 0) + (r.transferSize || 0);
    transferred += r.transferSize || 0;

    if (!(r.responseEnd > 0)) {
      pending.push(name);
      continue;
    }

    const blocking = r.renderBlockingStatus === 'blocking' || blockingUrls.has(r.name);
    if (blocking) {
      renderBlocking.push({
        url: name,
        start: round(r.startTime),
        end: round(r.responseEnd),
        ms: round(r.duration),
      });
    }

    if (path.startsWith('/assets/') && path.endsWith('.js') && !initialScripts.has(path)) {
      lateJs.push({
        url: name,
        start: round(r.startTime),
        end: round(r.responseEnd),
        kb: Math.round((r.transferSize || 0) / 1024),
      });
    }

    slowest.push({ url: name, type, start: round(r.startTime), ms: round(r.duration), kb: Math.round((r.transferSize || 0) / 1024) });
  }

  for (const type of Object.keys(kbByType)) kbByType[type] = Math.round(kbByType[type] / 1024);
  slowest.sort((a, b) => b.ms - a.ms);
  lateJs.sort((a, b) => a.start - b.start);
  renderBlocking.sort((a, b) => a.start - b.start);

  const extras = window.__loadMetrics || {};
  return {
    url: location.href,
    ttfb: round(nav.responseStart),
    domInteractive: round(nav.domInteractive),
    dcl: round(nav.domContentLoadedEventEnd),
    load: round(nav.loadEventEnd),
    fp: paint['first-paint'],
    fcp: paint['first-contentful-paint'],
    lcp: round(extras.lcp),
    lcpElement: extras.lcpElement || null,
    cls: Number((extras.cls || 0).toFixed(3)),
    longTasks: extras.longTasks || 0,
    longTaskMs: round(extras.longTaskMs),
    resourceCount: res.length,
    transfersKB: Math.round(transferred / 1024),
    byType,
    kbByType,
    renderBlocking,
    lateJs,
    slowest: slowest.slice(0, 8),
    pending: pending.slice(0, 10),
  };
});

console.log(JSON.stringify(metrics, null, 2));
await browser.close();
