#!/usr/bin/env node
/**
 * End-to-end visual/audio smoke test with a real track.
 *
 * Loads an actual audio file through the app's real file input, waits for the
 * analyser to produce live levels, then clicks every mode card in the Look
 * drawer while the track plays. For each mode it checks that the mode became
 * active and actually drew, measures the rendered frame rate and worst frame,
 * reads the adaptive raytrace tier, checks that the analyser did not go dead,
 * and saves a screenshot. Any page error, console error, silent analyser,
 * stuck mode or renderer fault fails the run.
 *
 *   node scripts/audio-modes.mjs
 *   node scripts/audio-modes.mjs --track public/samples/last-seen.mp3 --out /tmp/shots
 *   node scripts/audio-modes.mjs --headed --mobile
 *   node scripts/audio-modes.mjs --2d            Canvas2D stage (raytrace off)
 */
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const flagValue = (flag, fallback) => {
  const i = args.indexOf(flag);
  if (i < 0) return fallback;
  const value = args[i + 1];
  return value && !value.startsWith('--') ? value : fallback;
};

const HEADED = args.includes('--headed');
const MOBILE = args.includes('--mobile');
const TWO_D = args.includes('--2d');
const TRACK = resolve(flagValue('--track', 'public/samples/night-voltage.mp3'));
const OUT = resolve(flagValue('--out', '/tmp/audiovisor-audio-modes'));
const SAMPLE_MS = 1200;
const WARM_MS = 350;
const DEAD_RUN = 5;

if (!existsSync(TRACK)) {
  console.error(`audio-modes: track not found: ${TRACK}`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const rows = [];
const errors = [];
let fatal = null;
let browser;
let server;

try {
  server = await createServer({ root: process.cwd(), server: { port: 0 }, logLevel: 'error' });
  await server.listen();
  const gl = process.platform === 'darwin' ? ['--use-angle=metal'] : [];
  browser = await chromium.launch({
    headless: !HEADED,
    args: [...gl, '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext(MOBILE
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text().slice(0, 300)}`);
  });

  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'load', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => window.__av, null, { timeout: 30000 });

  await page.setInputFiles('#file-input', TRACK);
  await page.waitForFunction(() => {
    const av = window.__av;
    const levels = av?.engine?.getLevels?.();
    return !!levels
      && av.engine.playing === true
      && Number.isFinite(levels.bass)
      && Number.isFinite(levels.mid)
      && Number.isFinite(levels.high)
      && Math.max(levels.bass, levels.mid, levels.high) > 0.001;
  }, null, { timeout: 20000 });

  /* The raytrace chunk loads lazily once playback starts. Give it a chance,
     but let a browser without WebGL2 continue on the Canvas2D fallback. */
  await page.waitForFunction(
    () => window.__av?.ray?.loaded || window.__av?.ray?.error,
    null,
    { timeout: 25000 },
  ).catch(() => {});

  if (TWO_D) await page.evaluate(() => { window.__av.state.raytraceWanted = false; });

  const drawerOpen = () => page.evaluate(() => !document.getElementById('drawer').classList.contains('is-closed'));
  const setDrawer = async (open) => {
    if ((await drawerOpen()) === open) return;
    await page.click(open ? '#drawer-toggle' : '#drawer-close');
    await page.waitForFunction((want) => {
      const closed = document.getElementById('drawer').classList.contains('is-closed');
      return want ? !closed : closed;
    }, open, { timeout: 5000 });
  };

  await setDrawer(true);
  await page.click('#tab-look');
  await page.evaluate(() => window.__av.ensureModes());
  await page.waitForSelector('#mode-list button[data-mode-id]', { timeout: 10000 });
  const modeIds = await page.$$eval(
    '#mode-list button[data-mode-id]',
    (cards) => cards.map((card) => card.dataset.modeId),
  );
  if (!modeIds.length) throw new Error('no mode cards found');

  for (const id of modeIds) {
    const row = { id, fps: null, worstMs: null, tier: null, ok: false, error: null };
    const errorBase = errors.length;
    try {
      await setDrawer(true);
      await page.click(`#mode-list button[data-mode-id="${id}"]`);
      /* Close the drawer before measuring/screenshotting so the stage is the
         thing in the picture, not the picker that launched it. */
      await setDrawer(false);
      await page.waitForTimeout(WARM_MS);

      const active = await page.evaluate(() => window.__av.state.modeId);
      if (active !== id) throw new Error(`state.modeId is ${active}, expected ${id}`);

      const drew = await page.waitForFunction((want) => {
        const av = window.__av;
        if (av.state.raytraceWanted && av.ray?.ok) return av.ray._drawnMode === av.ray.mode;
        if (want === 'gpu') return true;
        return av.renderer?.mode === want;
      }, id, { timeout: 8000 }).then(() => true).catch(() => false);
      if (!drew) throw new Error('renderer never drew this mode');

      const perf = await page.evaluate(async (duration) => {
        const av = window.__av;
        let frames = 0;
        let worst = 0;
        let start = 0;
        let last = 0;
        let lastSample = 0;
        let deadRun = 0;
        let maxDeadRun = 0;
        let samples = 0;
        await new Promise((done) => {
          function tick(now) {
            if (!start) {
              start = now;
              last = now;
              lastSample = now;
            } else {
              frames++;
              if (now - last > worst) worst = now - last;
              last = now;
            }
            if (now - lastSample >= 100) {
              lastSample = now;
              const levels = av.engine.getLevels?.();
              samples++;
              const dead = !levels
                || !Number.isFinite(levels.bass)
                || !Number.isFinite(levels.mid)
                || !Number.isFinite(levels.high)
                || Math.max(levels.bass, levels.mid, levels.high) <= 0;
              deadRun = dead ? deadRun + 1 : 0;
              if (deadRun > maxDeadRun) maxDeadRun = deadRun;
            }
            if (now - start < duration) requestAnimationFrame(tick);
            else done();
          }
          requestAnimationFrame(tick);
        });
        return {
          fps: frames / Math.max(1, last - start) * 1000,
          worstMs: worst,
          samples,
          maxDeadRun,
        };
      }, SAMPLE_MS);

      const probe = await page.evaluate(() => {
        const av = window.__av;
        const ray = av.ray || {};
        return {
          modeId: av.state.modeId,
          rendererMode: av.renderer?.mode,
          rendererLost: !!av.renderer?.ctx?.isContextLost?.(),
          rayOk: !!ray.ok,
          rayError: ray.error ? String(ray.error) : null,
          rayLost: !!ray.lost,
          glLost: !!ray.gl?.isContextLost?.(),
          quality: ray.quality || av.renderer?.quality || 'unknown',
        };
      });

      row.fps = perf.fps;
      row.worstMs = perf.worstMs;
      row.tier = probe.quality;
      if (probe.modeId !== id) throw new Error(`mode changed during measurement: ${probe.modeId}`);
      if (probe.rayError) throw new Error(`ray stage: ${probe.rayError}`);
      if (probe.rayLost) throw new Error('ray stage context lost');
      if (probe.rendererLost || probe.glLost) throw new Error('renderer context lost');
      if (id !== 'gpu' && probe.rendererMode !== id) {
        throw new Error(`renderer.mode is ${probe.rendererMode}, expected ${id}`);
      }
      if (perf.maxDeadRun >= DEAD_RUN) {
        throw new Error(`audio levels zero/non-finite for ${perf.maxDeadRun} consecutive samples`);
      }
      if (errors.length > errorBase) {
        throw new Error(`page/console error: ${errors.slice(errorBase).join(' | ')}`);
      }
      row.ok = true;
    } catch (error) {
      row.error = String(error?.message || error).split('\n')[0];
    }
    await page.screenshot({ path: join(OUT, `${id}.png`), timeout: 20000 }).catch((error) => {
      row.ok = false;
      row.error = `${row.error ? `${row.error}; ` : ''}screenshot failed: ${String(error.message || error).split('\n')[0]}`;
    });
    rows.push(row);
  }
} catch (error) {
  fatal = error;
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
}

const idWidth = Math.max(4, ...rows.map((row) => row.id.length));
console.log(`\naudio modes — ${basename(TRACK)} — screenshots in ${OUT}`);
console.log(`  ${'mode'.padEnd(idWidth)}${'fps'.padStart(8)}${'worst'.padStart(12)}  ${'tier'.padEnd(8)}result`);
for (const row of rows) {
  const fps = Number.isFinite(row.fps) ? row.fps.toFixed(1) : '—';
  const worst = Number.isFinite(row.worstMs) ? `${row.worstMs.toFixed(1)} ms` : '—';
  const tier = row.tier || '—';
  console.log(
    `  ${row.id.padEnd(idWidth)}${fps.padStart(8)}${worst.padStart(12)}  ${tier.padEnd(8)}` +
    `${row.ok ? 'ok' : `FAIL — ${row.error || 'unknown error'}`}`,
  );
}
if (errors.length) {
  console.log(`\npage/console errors (${errors.length}):`);
  for (const error of errors.slice(0, 10)) console.log(`  ${error}`);
  if (errors.length > 10) console.log(`  … ${errors.length - 10} more`);
}
if (fatal) console.log(`\nfatal: ${String(fatal.stack || fatal.message || fatal)}`);
const passed = rows.filter((row) => row.ok).length;
const ok = !fatal && rows.length > 0 && passed === rows.length && errors.length === 0;
console.log(`\n${ok ? 'PASS' : 'FAIL'} — ${passed}/${rows.length} modes, ${errors.length} page/console error(s)`);
process.exitCode = ok ? 0 : 1;
