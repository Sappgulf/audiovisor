#!/usr/bin/env node
/**
 * Per-mode music-reactivity score.
 *
 * audio-modes.mjs proves every mode draws while a track plays; this measures
 * how much each one actually *answers* the track. It plays a real file, and
 * for every mode samples the visible stage ~30 times a second into a tiny
 * offscreen canvas, recording frame brightness and frame-to-frame motion
 * next to the analyser's levels and beat pulse. It then reports:
 *
 *   bassL   correlation of frame brightness with the bass envelope
 *   beatL   correlation of brightness with the beat pulse (punch on hits)
 *   flowM   correlation of motion with spectral activity (moves with music)
 *   swing   brightness range (p95-p05) relative to its mean — a mode that
 *           correlates perfectly but only moves 1% still reads as static
 *   score   0..100 blend of the above
 *
 *   node scripts/reactivity.mjs
 *   node scripts/reactivity.mjs --track public/samples/last-seen.mp3 --only tunnel,bars
 *   node scripts/reactivity.mjs --2d          Canvas2D stage (raytrace off)
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const flag = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const TRACK = resolve(flag('--track', 'public/samples/night-voltage.mp3'));
const ONLY = flag('--only', '').split(',').filter(Boolean);
const TWO_D = args.includes('--2d');
const SAMPLE_MS = Number(flag('--ms', 6000));
const SEEK_S = Number(flag('--seek', 40));
if (!existsSync(TRACK)) { console.error(`reactivity: no track ${TRACK}`); process.exit(1); }

const server = await createServer({ root: process.cwd(), server: { port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  args: [...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--autoplay-policy=no-user-gesture-required'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'load', timeout: 30000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForFunction(() => window.__av, null, { timeout: 30000 });
  await page.setInputFiles('#file-input', TRACK);
  await page.waitForFunction(() => window.__av?.engine?.playing === true, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__av?.ray?.loaded || window.__av?.ray?.error, null, { timeout: 25000 }).catch(() => {});
  if (TWO_D) await page.evaluate(() => { window.__av.state.raytraceWanted = false; });

  const open = async (want) => {
    const closed = await page.evaluate(() => document.getElementById('drawer').classList.contains('is-closed'));
    if (closed === !want) return;
    await page.click(want ? '#drawer-toggle' : '#drawer-close');
    await page.waitForTimeout(250);
  };
  await open(true);
  await page.click('#tab-look');
  await page.evaluate(() => window.__av.ensureModes());
  await page.waitForSelector('#mode-list button[data-mode-id]');
  let ids = await page.$$eval('#mode-list button[data-mode-id]', (b) => b.map((x) => x.dataset.modeId));
  if (ONLY.length) ids = ids.filter((id) => ONLY.includes(id));

  const rows = [];
  for (const id of ids) {
    await open(true);
    await page.click(`#mode-list button[data-mode-id="${id}"]`);
    await open(false);
    /* every mode hears the same stretch of the track: without this the
       last modes in the list ran after the track ended and scored silence */
    await page.evaluate((t) => { window.__av.engine.seek(t); if (!window.__av.engine.playing) window.__av.engine.play?.(); }, SEEK_S);
    await page.waitForTimeout(900);
    const r = await page.evaluate(async (ms) => {
      const av = window.__av;
      const W = 48, H = 30;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d', { willReadFrequently: true });
      const live = () => ['ray-canvas', 'viz-canvas', 'webgpu-canvas']
        .map((i) => document.getElementById(i))
        .filter((el) => el && getComputedStyle(el).display !== 'none' && !el.classList.contains('is-off')
          && (el.id !== 'ray-canvas' || el.classList.contains('is-live')));
      const L = [], M = [], B = [], P = [], S = [];
      let prev = null;
      const t0 = performance.now();
      let lastT = 0;
      await new Promise((done) => {
        const tick = (now) => {
          if (now - t0 > ms) return done();
          if (now - lastT >= 33) {
            lastT = now;
            g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
            for (const el of live()) g.drawImage(el, 0, 0, W, H);
            const d = g.getImageData(0, 0, W, H).data;
            let lum = 0, mot = 0;
            const cur = new Float32Array(W * H);
            for (let i = 0, j = 0; i < d.length; i += 4, j++) {
              cur[j] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
              lum += cur[j];
              if (prev) mot += Math.abs(cur[j] - prev[j]);
            }
            prev = cur;
            const lv = av.engine.getLevels?.() || {};
            L.push(lum / (W * H)); M.push(mot / (W * H));
            B.push(lv.bass || 0); P.push(lv.beatPulse || lv.beat || 0);
            S.push((lv.mid || 0) + (lv.high || 0) + (lv.bass || 0));
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return { L, M, B, P, S };
    }, SAMPLE_MS);
    rows.push({ id, ...score(r) });
  }

  console.log(`reactivity — ${TRACK.split('/').pop()} — ${TWO_D ? 'Canvas2D' : 'raytraced'} stage, ${SAMPLE_MS}ms/mode`);
  console.log('  mode          bassL  beatL  flowM  swing  mean  score');
  for (const r of rows.sort((a, b) => a.score - b.score)) {
    console.log(`  ${r.id.padEnd(12)} ${f(r.bassL)}  ${f(r.beatL)}  ${f(r.flowM)}  ${f(r.swing)}  ${r.mean.toFixed(0).padStart(4)}  ${String(r.score).padStart(5)}`);
  }
  if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);
} finally {
  await browser?.close();
  await server?.close();
}

function f(v) { return (v >= 0 ? ' ' : '') + v.toFixed(2); }
function corr(a, b) {
  const n = Math.min(a.length, b.length); if (n < 4) return 0;
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}
/* the picture answers a moment after the analyser does; take the best lag 0..3 samples */
function lagCorr(vis, aud) {
  let best = -1;
  for (let k = 0; k <= 3; k++) best = Math.max(best, corr(vis.slice(k), aud.slice(0, aud.length - k)));
  return best;
}
function score({ L, M, B, P, S }) {
  const s = [...L].sort((a, b) => a - b);
  const mean = L.reduce((a, b) => a + b, 0) / Math.max(L.length, 1);
  const q = (p) => s[Math.floor(p * (s.length - 1))] || 0;
  const swing = mean > 0 ? (q(0.95) - q(0.05)) / mean : 0;
  const dS = S.map((v, i) => (i ? Math.max(0, v - S[i - 1]) : 0));
  const bassL = lagCorr(L, B), beatL = lagCorr(L, P), flowM = Math.max(lagCorr(M, S), lagCorr(M, dS));
  const r = Math.max(bassL, beatL);
  const sc = Math.round(100 * (0.45 * Math.max(0, r) + 0.25 * Math.max(0, flowM) + 0.30 * Math.min(1, swing / 0.5)));
  return { bassL, beatL, flowM, swing, mean, score: sc };
}
