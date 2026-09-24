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
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
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
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--auto-accept-this-tab-capture', '--auto-select-desktop-capture-source=Entire screen', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
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
// The software GL stack occasionally refuses a capture while a frame is in
// flight; one retry after a frame is enough to get past it.
const shot = async (opts) => {
  try { return await page.screenshot(opts); } catch { await page.waitForTimeout(250); return page.screenshot(opts); }
};
const litFraction = async () => {
  const box = await page.locator('#stage').boundingBox();
  const img = await loadImage(await shot({ clip: box }));
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
    if (i % 4 === 0) await shot({ path: `${OUT}/mode-${m.id}.png` });
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

/* ---------- every remaining control, one at a time ---------- */
const click = async (sel) => { await page.locator(sel).first().click({ timeout: 3000 }); await page.waitForTimeout(150); };
const clickAll = async (sel) => {
  const loc = page.locator(sel);
  for (let i = 0; i < await loc.count(); i++) if (await loc.nth(i).isVisible()) { await loc.nth(i).click({ timeout: 3000 }); await page.waitForTimeout(120); }
};
const openTab = async (t) => {
  if (await page.locator('#drawer').evaluate((d) => d.classList.contains('is-closed'))) await click('#drawer-toggle');
  await click(`#tab-${t}`);
};
await step('seek bar click', async () => {
  const box = await page.locator('#seek-track').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
});
await step('seek keyboard', async () => { await page.focus('#seek-track'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Home'); });
await step('volume drag + keys', async () => {
  const box = await page.locator('#volume-track').boundingBox();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2);
  await page.focus('#volume-track'); await page.keyboard.press('ArrowUp');
});
await step('prev/next ±10s', async () => { await click('#next-btn'); await click('#prev-btn'); });
await step('loop toggle', async () => { await click('#loop-btn'); await click('#loop-btn'); });
await step('save to library', async () => { await click('#save-library-btn'); await page.waitForTimeout(400); });
await step('library panel opens and Escape closes it', async () => {
  await click('#library-btn'); await page.waitForTimeout(400);
  await page.keyboard.type('zz'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  if (await page.isVisible('.library-panel:not(.is-hidden)')) throw new Error('library still open after Escape');
});
await step('queue panel opens and Escape closes it', async () => {
  await click('#queue-btn'); await page.waitForTimeout(200); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  if (await page.isVisible('.queue-panel:not(.is-hidden)')) throw new Error('queue still open after Escape');
});
await step('more tools menu', async () => { await click('#more-btn'); await page.keyboard.press('Escape'); });
await step('snapshot', async () => {
  await click('#more-btn');
  const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await click('#snapshot-btn');
  if (!(await dl)) throw new Error('snapshot produced no download');
});
await step('record 1.5s', async () => {
  await click('#more-btn'); await click('#record-btn');
  await page.waitForTimeout(1500);
  const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await click('#more-btn'); await click('#record-btn');
  if (!(await dl)) throw new Error('recording produced no download');
});
await step('shuffle', async () => { await click('#more-btn'); await click('#shuffle-btn'); await page.keyboard.press('Escape'); });
await step('command palette', async () => {
  await page.keyboard.press('Control+k'); await page.waitForTimeout(150);
  await page.fill('#cmd-input', 'tunnel'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  const mode = await page.evaluate(() => window.__av.renderer.mode);
  if (mode !== 'tunnel') throw new Error(`palette did not switch mode (got ${mode})`);
});
await step('mode list click', async () => {
  await openTab('look'); await clickAll('#mode-list button:nth-child(-n+3)');
});
await step('look presets', async () => { await openTab('look'); await clickAll('#preset-row button'); });
await step('raytrace quality cycle', async () => { await openTab('look'); for (let i = 0; i < 4; i++) await click('#rt-quality'); });
await step('autopilot / auto DJ / sleep', async () => {
  await openTab('look');
  for (const id of ['#autopilot-chip', '#autodj-chip', '#sleep-chip']) { await click(id); await click(id); }
});
await step('audio sliders + EQ', async () => {
  await openTab('audio');
  const ranges = page.locator('#panel-audio input[type=range]');
  for (let i = 0; i < await ranges.count(); i++) { const r = ranges.nth(i); if (await r.isVisible()) { await r.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowLeft'); } }
});
await step('AI studio', async () => { await openTab('studio'); await clickAll('#ai-stems button'); await clickAll('#ai-presets button'); await click('#ai-suggest'); });
await step('share card', async () => { await openTab('studio'); await click('#share-btn'); await page.waitForTimeout(400); await page.keyboard.press('Escape'); });
await step('party + comments', async () => {
  await openTab('studio'); await click('#party-btn'); await page.waitForTimeout(300);
  if (await page.isVisible('#comment-input')) { await page.fill('#comment-input', 'e2e hello'); await click('#comment-send'); }
  await click('#party-btn');
});
await step('social post', async () => {
  await openTab('source');
  if (await page.isVisible('#social-input')) { await page.fill('#social-input', 'e2e mix'); await click('#social-post'); }
});
await step('settings export + import', async () => {
  await openTab('studio');
  const dl = page.waitForEvent('download', { timeout: 5000 });
  await click('#settings-export');
  const file = await (await dl).path();
  await page.setInputFiles('#settings-file', file); await page.waitForTimeout(300);
});
await step('tour replay', async () => { await openTab('studio'); await click('#tour-replay'); await page.waitForTimeout(300); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); });
await step('mic input', async () => {
  await page.keyboard.press('Escape');
  await click('#mic-btn'); await page.waitForTimeout(1200);
  const live = await page.evaluate(() => window.__av.engine.micActive);
  if (!live) throw new Error('mic did not go live');
  await click('#mic-btn');
});
await step('voice AI', async () => { await click('#voice-btn'); await page.waitForTimeout(1000); await click('#voice-btn'); });
await step('drag and drop file', async () => {
  const buf = readFileSync(trackPath).toString('base64');
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bytes], 'dropped.wav', { type: 'audio/wav' }));
    const stage = document.getElementById('stage');
    for (const type of ['dragenter', 'dragover', 'drop']) stage.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, buf);
  await page.waitForTimeout(1500);
  const name = await page.textContent('#track-name');
  if (!/dropped/i.test(name || '')) throw new Error(`dropped track not loaded (track-name "${name}")`);
});
await step('settings reset', async () => {
  page.once('dialog', (d) => d.accept());
  await openTab('studio'); await click('#settings-reset'); await page.waitForTimeout(400);
});
await step('reload keeps working', async () => {
  // navigation aborts in-flight lazy chunks; that is the browser, not a bug
  const n = problems.length;
  await page.reload();
  problems.splice(n, Infinity, ...problems.slice(n).filter((p) => !p.includes('ERR_ABORTED'))); await page.waitForFunction(() => window.__av?.renderer, null, { timeout: 15000 });
});

await step('mobile viewport', async () => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  if (overflow) throw new Error('horizontal overflow at 390px');
  await shot({ path: `${OUT}/mobile.png` });
});

if (blank.length) problems.push(`[blank] 2D modes rendered blank: ${blank.join(', ')}`);
if (rayBlank.length) problems.push(`[blank] raytraced modes rendered blank: ${rayBlank.join(', ')}`);

await browser.close();
await server.close();
const uniq = [...new Set(problems)];
console.log(`\n${uniq.length ? uniq.join('\n') : 'no problems'}`);
process.exit(uniq.length ? 1 : 0);
