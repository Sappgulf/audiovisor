#!/usr/bin/env node
/**
 * Front-to-back feature test in a real, visible browser.
 *
 * Drives the app the way a person does — real clicks (or taps with
 * --mobile), real keys, real file loads — through every feature: drawer tabs,
 * mode picker, themes, raytrace controls, playback, seek, volume, loop,
 * queue, library, the More menu (snapshot, shuffle, record), fullscreen,
 * every keyboard shortcut, the command palette, mic and tab capture, and all
 * 23 modes. Each step passes, fails with the reason (an element covered or
 * unreachable fails here, where a scripted .click() would not), or is
 * flagged if it logged an error. Two generated tracks are used, so no media
 * needs to be checked in.
 *
 *   npm run e2e               desktop, 1440x900
 *   npm run e2e -- --mobile   phone, 390x844 touch
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const MOBILE = process.argv.includes('--mobile');
const SP = mkdtempSync(join(tmpdir(), 'audiovisor-e2e-'));

/* a minute of kick, bass, hats and a pad — enough for beat, tempo and
   spectrum to all have something to do */
function writeTrack(path, root) {
  const sr = 22050, secs = 60, beat = 60 / 124, n = sr * secs;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sr, bt = t % beat;
    const k = Math.sin(2 * Math.PI * (150 * Math.exp(-bt * 25) + 40) * bt) * Math.exp(-bt * 8);
    const b = 0.3 * Math.sin(2 * Math.PI * root * t) * (1 - bt / beat);
    const h = (Math.random() * 2 - 1) * 0.15 * Math.exp(-((t + beat / 2) % beat) * 40);
    const p = 0.08 * (Math.sin(2 * Math.PI * 330 * t) + Math.sin(2 * Math.PI * 440 * t));
    const v = Math.round(Math.max(-1, Math.min(1, (k * 0.8 + b + h + p) * 0.7)) * 32767);
    buf.writeInt16LE(v, 44 + i * 4); buf.writeInt16LE(v, 46 + i * 4);
  }
  writeFileSync(path, buf);
}
writeTrack(join(SP, 'track-a.wav'), 55);
writeTrack(join(SP, 'track-b.wav'), 65);
const server = await createServer({ root: process.cwd(), server: { port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: false, args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--enable-usermedia-screen-capturing'] });
const ctx = await browser.newContext(MOBILE
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block', permissions: ['microphone', 'clipboard-read', 'clipboard-write'], acceptDownloads: true }
  : { viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', permissions: ['microphone', 'clipboard-read', 'clipboard-write'], acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(3500);
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console ' + m.text().slice(0, 200)); });
const results = [];
let shot = 0;
async function step(name, fn) {
  const before = errors.length;
  try { const note = await fn(); results.push(`${errors.length > before ? 'ERR ' : 'ok  '} ${name}${note ? ' — ' + note : ''}${errors.length > before ? ' :: ' + errors.slice(before).join(' | ') : ''}`); }
  catch (e) { results.push(`FAIL ${name} — ${String(e.message).split('\n').slice(0, 3).join(' ')}`); await page.screenshot({ path: `${SP}/e2e-fail-${++shot}.png` }).catch(() => {}); }
}
const tap = (sel) => MOBILE ? page.tap(sel) : page.click(sel);
const vis = (sel) => page.isVisible(sel);
const text = (sel) => page.textContent(sel);
const snap = (n) => page.screenshot({ path: `${SP}/e2e-${MOBILE ? 'm' : 'd'}-${n}.png` });

await page.goto(server.resolvedUrls.local[0]);
await page.waitForLoadState('networkidle');
await page.waitForFunction(() => window.__av?.ray);
await page.waitForTimeout(1500);
await step('first paint: stage blank until mode chosen', async () => (await page.evaluate(() => document.documentElement.classList.contains('mode-unchosen'))) ? '' : (() => { throw new Error('not blank'); })());
await snap('00-first');

// onboarding / tour
await step('dismiss onboarding if shown', async () => { const t = await page.$('.onboarding, .tour, [data-tour]'); if (t && await t.isVisible()) { await page.keyboard.press('Escape'); return 'tour shown, escaped'; } return 'none'; });

// drawer
await step('open settings drawer', async () => { const closed = await page.evaluate(() => document.getElementById('drawer').classList.contains('is-closed') || getComputedStyle(document.getElementById('drawer')).visibility === 'hidden'); if (closed || MOBILE) await tap('#drawer-toggle'); await page.waitForTimeout(500); return 'closed-before=' + closed; });
for (const tab of ['look', 'source', 'audio', 'studio', 'look']) await step('drawer tab ' + tab, async () => { await tap('#tab-' + tab); await page.waitForTimeout(250); if (!await vis('#panel-' + tab)) throw new Error('panel not visible'); });
await snap('01-drawer-look');
await step('mode filter "neon"', async () => { await page.fill('#mode-filter', 'neon'); await page.waitForTimeout(200); const n = await page.$$eval('#mode-list [data-mode-id]', (b) => b.filter((x) => x.offsetParent).length); await page.fill('#mode-filter', ''); return n + ' visible'; });
await step('pick mode by clicking card (Neon City)', async () => { await tap('[data-mode-id="city"]'); await page.waitForTimeout(800); const m = await page.evaluate(() => window.__av.state.modeId); if (m !== 'city') throw new Error('mode ' + m); if (await page.evaluate(() => document.documentElement.classList.contains('mode-unchosen'))) throw new Error('still blank'); });
await step('look presets row', async () => { const b = await page.$$('#preset-row button'); if (!b.length) return 'none'; await (MOBILE ? b[0].tap() : b[0].click()); await page.waitForTimeout(300); return b.length + ' presets, clicked first'; });
await step('theme swatches (click 4)', async () => { const b = await page.$$('#theme-row [data-theme]'); for (const i of [1, 5, 9, 0]) { await (MOBILE ? b[i].tap() : b[i].click()); await page.waitForTimeout(200); } return b.length + ' swatches, now ' + await page.evaluate(() => window.__av.state.themeId); });
await step('raytrace quality cycle', async () => { const q = []; for (let i = 0; i < 4; i++) { await tap('#rt-quality'); await page.waitForTimeout(150); q.push(await text('#rt-quality-label')); } return q.join('>'); });
await step('raytrace on/off chip', async () => { await tap('#rt-chip'); await page.waitForTimeout(400); const off = await page.evaluate(() => window.__av.state.raytraceWanted); await tap('#rt-chip'); await page.waitForTimeout(400); return 'toggled ' + off + '→' + await page.evaluate(() => window.__av.state.raytraceWanted); });
for (const chip of ['autopilot-chip', 'autodj-chip', 'sleep-chip']) await step(chip, async () => { await tap('#' + chip); await page.waitForTimeout(200); const t = (await text('#' + chip)).trim().replace(/\s+/g, ' '); await tap('#' + chip); return t; });

// audio
await step('load two tracks via file input', async () => { await page.setInputFiles('#file-input', [SP + '/track-a.wav', SP + '/track-b.wav']); await page.waitForFunction(() => window.__av.engine.playing, null, { timeout: 8000 }); return 'playing: ' + await text('#track-name'); });
await page.waitForTimeout(1500);
await snap('02-playing');
await step('audio tab sliders (drag sensitivity)', async () => { await tap('#tab-audio'); await page.waitForTimeout(300); const r = await page.$$('#sliders input[type=range]'); if (!r.length) return 'no range inputs'; await r[0].scrollIntoViewIfNeeded(); const box = await r[0].boundingBox(); await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2); return r.length + ' sliders, sens=' + await r[0].inputValue(); });
await step('EQ bands', async () => { const r = await page.$$('#eq-bands input[type=range]'); if (!r.length) return 'none'; await r[0].scrollIntoViewIfNeeded(); const box = await r[0].boundingBox(); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); return r.length + ' bands'; });
await step('FX toggles', async () => { const b = await page.$$('#fx-row button'); const names = []; for (const x of b) { await (MOBILE ? x.tap() : x.click()); await page.waitForTimeout(150); names.push((await x.textContent()).trim()); await (MOBILE ? x.tap() : x.click()); } return names.join(','); });
await step('studio tab: AI presets + share + party', async () => { await tap('#tab-studio'); await page.waitForTimeout(300); const b = await page.$$('#ai-presets button'); if (b.length) await (MOBILE ? b[0].tap() : b[0].click()); await page.waitForTimeout(200); await tap('#share-btn'); await page.waitForTimeout(600); await page.keyboard.press('Escape'); return b.length + ' ai presets'; });
await step('settings export (download)', async () => { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 4000 }), tap('#settings-export')]); return d.suggestedFilename(); });

// close drawer on mobile so transport is reachable
if (MOBILE) await step('close drawer', async () => { await tap('#drawer-close'); await page.waitForTimeout(500); });

// transport
await step('play/pause', async () => { await tap('#play-pause-btn'); await page.waitForTimeout(300); const p1 = await page.evaluate(() => window.__av.engine.playing); await tap('#play-pause-btn'); await page.waitForTimeout(300); const p2 = await page.evaluate(() => window.__av.engine.playing); if (p1 === p2) throw new Error('did not toggle'); return `${p1}→${p2}`; });
await step('seek by clicking track at 60%', async () => { const b = await page.$('#seek-track').then((e) => e.boundingBox()); if (b.width < 40) throw new Error('seek track only ' + Math.round(b.width) + 'px wide'); await page.mouse.click(b.x + b.width * 0.6, b.y + b.height / 2); await page.waitForTimeout(300); return 't=' + (await page.evaluate(() => window.__av.engine.getTime())).toFixed(1) + 's width ' + Math.round(b.width); });
await step('next / prev track', async () => { await tap('#next-btn'); await page.waitForTimeout(600); const a = await text('#track-name'); await tap('#prev-btn'); await page.waitForTimeout(600); return a + ' / ' + await text('#track-name'); });
await step('volume click 30%', async () => { if (!await vis('#volume-track')) return 'volume hidden on this layout'; const b = await page.$('#volume-track').then((e) => e.boundingBox()); await page.mouse.click(b.x + b.width * 0.3, b.y + b.height / 2); return 'vol ' + await page.getAttribute('#volume-track', 'aria-valuenow'); });
await step('loop toggle', async () => { await tap('#loop-btn'); const a = await page.getAttribute('#loop-btn', 'aria-pressed'); await tap('#loop-btn'); return 'pressed=' + a; });
await step('queue panel open/close', async () => { await tap('#queue-btn'); await page.waitForTimeout(400); await snap('03-queue'); await page.keyboard.press('Escape'); await page.waitForTimeout(300); });
await step('save to library + library panel', async () => { await tap('#save-library-btn'); await page.waitForTimeout(500); await tap('#library-btn'); await page.waitForTimeout(500); await snap('04-library'); await page.keyboard.press('Escape'); await page.waitForTimeout(300); });
await step('more menu: snapshot', async () => { await tap('#more-btn'); await page.waitForTimeout(300); if (!await vis('#snapshot-btn')) throw new Error('menu item hidden'); const [d] = await Promise.all([page.waitForEvent('download', { timeout: 4000 }).catch(() => null), tap('#snapshot-btn')]); return d ? d.suggestedFilename() : 'no download event'; });
await step('more menu: shuffle', async () => { await tap('#more-btn'); await page.waitForTimeout(300); await tap('#shuffle-btn'); await page.waitForTimeout(300); });
await step('more menu: record 2s', async () => { await tap('#more-btn'); await page.waitForTimeout(300); await tap('#record-btn'); await page.waitForTimeout(2000); const [d] = await Promise.all([page.waitForEvent('download', { timeout: 6000 }).catch(() => null), (async () => { await tap('#more-btn'); await page.waitForTimeout(300); await tap('#record-btn'); })()]); return d ? d.suggestedFilename() : 'no download'; });

// fullscreen + cinema
await step('fullscreen button', async () => { await tap('#fullscreen-btn'); await page.waitForTimeout(1200); const fs = await page.evaluate(() => !!document.fullscreenElement || document.getElementById('shell').classList.contains('is-cinema')); await snap('05-fullscreen'); const r = await page.evaluate(() => { const c = document.getElementById('ray-canvas').getBoundingClientRect(); return [Math.round(c.width), Math.round(c.height), innerWidth, innerHeight]; }); if (await page.evaluate(() => !!document.fullscreenElement)) await tap('#fullscreen-btn').catch(() => page.evaluate(() => document.exitFullscreen())); else await page.keyboard.press('Escape'); await page.waitForTimeout(800); return 'entered=' + fs + ' canvas ' + r.join('x'); });

// keyboard shortcuts
if (!MOBILE) {
  await page.mouse.click(700, 300);
  for (const k of ['Space', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'KeyM', 'KeyT', 'KeyR', 'Digit3', 'KeyL', 'KeyQ', 'KeyP', 'KeyC']) {
    await step('key ' + k, async () => { const before = await page.evaluate(() => [window.__av.state.modeId, window.__av.state.themeId, window.__av.engine.playing].join('/')); await page.keyboard.press(k); await page.waitForTimeout(350); const after = await page.evaluate(() => [window.__av.state.modeId, window.__av.state.themeId, window.__av.engine.playing].join('/')); if (['KeyL', 'KeyQ', 'KeyP'].includes(k)) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); } if (k === 'KeyC') await page.keyboard.press('KeyC'); return before === after ? '(no state change) ' + after : before + ' → ' + after; });
  }
  await step('? shortcuts overlay', async () => { await page.keyboard.press('Shift+Slash'); await page.waitForTimeout(400); const v = await vis('#shortcuts-overlay'); await page.keyboard.press('Escape'); return 'visible=' + v; });
  await step('command palette (Cmd+K)', async () => { await page.keyboard.press('Meta+KeyK'); await page.waitForTimeout(400); const v = await vis('#cmd-palette'); if (v) { await page.keyboard.type('vinyl'); await page.waitForTimeout(200); await page.keyboard.press('Enter'); await page.waitForTimeout(500); } return 'visible=' + v + ' mode=' + await page.evaluate(() => window.__av.state.modeId); });
  await step('key F fullscreen', async () => { await page.keyboard.press('KeyF'); await page.waitForTimeout(1000); const fs = await page.evaluate(() => !!document.fullscreenElement || document.getElementById('shell').classList.contains('is-cinema')); await page.keyboard.press('KeyF'); await page.waitForTimeout(800); const out = await page.evaluate(() => !document.fullscreenElement && !document.getElementById('shell').classList.contains('is-cinema')); return 'entered=' + fs + ' exited=' + out; });
}
await step('help button', async () => { if (MOBILE) return 'hidden on phones by design'; await tap('#help-btn'); await page.waitForTimeout(400); await snap('06-help'); await page.keyboard.press('Escape'); });
await step('mic button (fake device)', async () => { await tap('#mic-btn'); await page.waitForTimeout(1500); const s = await page.evaluate(() => window.__av.engine.micActive); await tap('#mic-btn'); await page.waitForTimeout(500); return 'micActive=' + s; });
await step('tab capture button', async () => { await tap('#capture-btn'); await page.waitForTimeout(2000); const s = await page.evaluate(() => window.__av.engine.captureActive); if (s) { await tap('#capture-btn'); await page.waitForTimeout(500); } return 'captureActive=' + s; });
await step('voice AI button', async () => { await tap('#voice-btn'); await page.waitForTimeout(800); await tap('#voice-btn').catch(() => {}); });
await step('nav tabs (stage/settings/about)', async () => { const out = []; for (const n of ['nav-about', 'nav-settings', 'nav-stage']) { if (await vis('#' + n)) { await tap('#' + n); await page.waitForTimeout(400); out.push(n); if (n === 'nav-about') { await page.keyboard.press('Escape'); await page.waitForTimeout(300); } } } await page.keyboard.press('Escape'); return out.join(','); });
await step('all 23 modes via cards, still error-free', async () => { if (await page.evaluate(() => document.getElementById('drawer').classList.contains('is-closed'))) { await tap('#drawer-toggle'); await page.waitForTimeout(500); } await tap('#tab-look'); const ids = await page.$$eval('#mode-list [data-mode-id]', (b) => b.map((x) => x.dataset.modeId)); for (const id of ids) { await page.click(`[data-mode-id="${id}"]`, { force: false }); await page.waitForTimeout(250); } return ids.length + ' modes'; });
await snap('07-end');
console.log(results.join('\n'));
const failed = results.filter((r) => !r.startsWith('ok')).length;
console.log(`\n${results.length - failed}/${results.length} steps passed — screenshots in ${SP}`);
console.log('\nuncaught errors total:', errors.length, errors.slice(0, 8));
await browser.close(); await server.close();
if (failed || errors.length) process.exit(1);
