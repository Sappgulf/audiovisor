#!/usr/bin/env node
/**
 * Real-browser accessibility audit.
 *
 * The jsdom suite checks the static shell but cannot evaluate contrast,
 * focus traps or the panels that only exist after interaction. This drives
 * the app like a person, opens every major surface (drawer tabs, queue,
 * library, about, shortcuts, command palette) at desktop and phone sizes,
 * and runs axe against the live DOM.
 *
 *   npm run a11y
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import axe from 'axe-core';

const server = await createServer({ root: process.cwd(), server: { port: 0 }, logLevel: 'error' });
await server.listen();
const GL = process.platform === 'darwin' ? ['--use-angle=metal'] : [];
const browser = await chromium.launch({ headless: true, args: GL });
const url = server.resolvedUrls.local[0];
const results = [];

async function audit(page, label) {
  await page.addScriptTag({ content: axe.source }).catch(() => {});
  const out = await page.evaluate(async () => {
    const r = await window.axe.run(document, {
      resultTypes: ['violations'],
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
  });
  results.push({ label, violations: out });
  return out;
}

async function drive(viewport, label, mobile) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__av, null, { timeout: 30000 });
  await page.waitForTimeout(700);

  await audit(page, `${label} stage`);

  const tap = (sel) => mobile ? page.tap(sel) : page.click(sel);
  await tap('#drawer-toggle');
  await page.waitForTimeout(350);
  for (const tab of ['look', 'source', 'audio', 'studio']) {
    await tap('#tab-' + tab);
    await page.waitForTimeout(250);
    await audit(page, `${label} ${tab} tab`);
    if (tab === 'studio') {
      await tap('#party-btn');
      await page.waitForTimeout(650);
      await audit(page, `${label} party QR`);
      await tap('#party-btn');
      await page.waitForTimeout(200);
    }
  }
  await tap('#tab-look');
  await page.waitForTimeout(200);
  await page.waitForSelector('#custom-theme .custom-color', { timeout: 6000 });
  await audit(page, `${label} custom palette`);
  const theme = page.locator('[data-theme="monolith"]');
  if (await theme.count()) { await theme.first().click(); await page.waitForTimeout(250); await audit(page, `${label} monolith`); }
  await tap('#drawer-close').catch(() => page.keyboard.press('Escape'));
  await page.waitForTimeout(300);

  await tap('#more-btn');
  await page.waitForTimeout(300);
  await audit(page, `${label} more menu`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  for (const [sel, name] of [['#queue-btn', 'queue'], ['#library-btn', 'library'], ['#nav-about', 'about']]) {
    if (await page.isVisible(sel)) {
      await tap(sel);
      await page.waitForTimeout(350);
      await audit(page, `${label} ${name}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
    }
  }

  if (!mobile) {
    await page.click('#help-btn');
    await page.waitForTimeout(300);
    await audit(page, `${label} shortcuts`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.keyboard.press('Meta+KeyK');
    await page.waitForTimeout(350);
    await audit(page, `${label} palette`);
    await page.keyboard.press('Escape');
  }

  await ctx.close();
}

await drive({ width: 1440, height: 900 }, 'desktop', false);
await drive({ width: 390, height: 844 }, 'mobile', true);
await browser.close();
await server.close();

const serious = [];
for (const r of results) {
  const bad = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  if (bad.length) serious.push({ ...r, violations: bad });
  if (bad.length) {
    console.log(`✗ ${r.label}`);
    for (const v of bad) console.log(`   ${v.impact} ${v.id}: ${v.help} (${v.nodes.join(', ')})`);
  }
}
const total = results.reduce((n, r) => n + r.violations.length, 0);
console.log(`\n${results.length} surfaces checked, ${total} violation types, ${serious.length} with serious/critical issues`);
if (serious.length) process.exit(1);
