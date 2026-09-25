#!/usr/bin/env node
/**
 * Live per-mode benchmark, with sound.
 *
 * sweep.mjs times the raytraced scenes in isolation through the dev pump.
 * This drives the whole app the way a listener does: it synthesises a
 * two-minute track (kick, hats, bass, pad), loads it through the real file
 * input so the full audio + analysis path runs, then clicks every mode in
 * the picker and records the frame rate, the worst frame and the tier the
 * adaptive loop settled on. Headless Chromium on the GPU (--use-angle=metal)
 * at a Retina-sized viewport, because that is where frame cost lives.
 *
 * Numbers vary with the machine's thermal state: compare runs made back to
 * back, and let the machine cool between long runs.
 *
 *   npm run bench              raytraced stage
 *   npm run bench -- --2d      Canvas2D stage (raytrace toggled off)
 *   ONLY="Bloom Field,Nebula" npm run bench
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

const TWO_D = process.argv.includes('--2d');
const MS_PER_MODE = 2500;

/* runs in the page */
const HARNESS = `// In-page harness: synth a track, load it, then time every mode.
window.__bench = async function (msPerMode = 2000, skipLoad = false) {
  if (!skipLoad) {
  const sr = 44100, secs = 120;
  const oc = new OfflineAudioContext(2, sr * secs, sr);
  const out = oc.createGain(); out.gain.value = 0.8; out.connect(oc.destination);
  const bpm = 124, beat = 60 / bpm;
  for (let t = 0; t < secs; t += beat) {
    const o = oc.createOscillator(), g = oc.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.3);
    const noise = oc.createBuffer(1, sr * 0.05, sr), d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const hs = oc.createBufferSource(); hs.buffer = noise;
    const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const hg = oc.createGain(); hg.gain.value = 0.3;
    hs.connect(hp).connect(hg).connect(out); hs.start(t + beat / 2);
    const b = oc.createOscillator(), bg = oc.createGain(); b.type = 'sawtooth';
    b.frequency.value = [55, 55, 65.4, 49][Math.floor(t / beat / 4) % 4];
    bg.gain.setValueAtTime(0.25, t); bg.gain.linearRampToValueAtTime(0, t + beat * 0.9);
    b.connect(bg).connect(out); b.start(t); b.stop(t + beat);
  }
  for (const f of [220, 277, 330, 440, 554]) {
    const o = oc.createOscillator(), g = oc.createGain(); o.type = 'triangle'; o.frequency.value = f;
    g.gain.value = 0.04; o.connect(g).connect(out); o.start(0);
  }
  const buf = await oc.startRendering();
  // encode WAV
  const n = buf.length, ab = new ArrayBuffer(44 + n * 4), v = new DataView(ab);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true);
  v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 4, true);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  const file = new File([ab], 'bench.wav', { type: 'audio/wav' });
  const input = document.getElementById('file-input');
  const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
  input.dispatchEvent(new Event('change'));
  await new Promise(r => setTimeout(r, 2500));
  }

  const av = window.__av, R2 = av.renderer, ray = av.ray;
  const time = (obj, key, acc) => {
    const orig = obj[key];
    obj[key] = function (...a) { const t0 = performance.now(); const r = orig.apply(this, a); acc[key] += performance.now() - t0; return r; };
    return () => { obj[key] = orig; };
  };
  if (msPerMode === 0) return;
  let btns = [...document.querySelectorAll('button[aria-label$=" mode"]')]; if (window.__only) btns = btns.filter(b => window.__only.some(o => b.getAttribute('aria-label').startsWith(o)));
  const rows = [];
  for (const b of btns) {
    b.click();
    await new Promise(r => setTimeout(r, 600));
    const acc = { render: 0 };
    const accR = { render: 0 };
    const u1 = time(R2, 'render', acc), u2 = ray ? time(ray, 'render', accR) : () => {};
    let frames = 0, worst = 0, last = performance.now(); const t0 = last;
    await new Promise(res => {
      const f = (now) => { frames++; worst = Math.max(worst, now - last); last = now;
        if (now - t0 < msPerMode) requestAnimationFrame(f); else res(); };
      requestAnimationFrame(f);
    });
    u1(); u2();
    const el = performance.now() - t0;
    rows.push({
      mode: b.getAttribute('aria-label').replace(' mode', ''),
      fps: +(frames / el * 1000).toFixed(1),
      worstMs: +worst.toFixed(1),
      cpu2d: +(acc.render / frames).toFixed(2),
      cpuRay: +(accR.render / frames).toFixed(2),
      tier: ray?.quality,
    });
  }
  return { playing: av.engine.playing, gpu: av.gpuBackend, rows };
};
`;

const server = await createServer({ root: process.cwd(), server: { port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(server.resolvedUrls.local[0]);
await page.waitForFunction(() => window.__av?.ray);
await page.addScriptTag({ content: HARNESS });
await page.evaluate(() => window.__bench(0));          // synthesise + load the track
if (TWO_D) {
  await page.evaluate(() => {
    document.documentElement.classList.remove('mode-unchosen');
    document.getElementById('rt-chip').click();
  });
}
if (process.env.ONLY) await page.evaluate((o) => { window.__only = o.split(','); }, process.env.ONLY);
await page.waitForTimeout(5000);                        // let background shader prewarm finish
const res = await page.evaluate((ms) => window.__bench(ms, true), MS_PER_MODE);
console.log(`${TWO_D ? 'Canvas2D' : 'raytraced'} stage, 1440x900 @2x, audio ${res.playing ? 'playing' : 'NOT playing'}`);
for (const r of res.rows) {
  console.log(
    `  ${r.mode.padEnd(16)}${String(r.fps).padStart(6)} fps   worst ${String(r.worstMs).padStart(6)} ms` +
    (TWO_D ? `   cpu ${r.cpu2d} ms` : `   tier ${r.tier}`),
  );
}
if (errors.length) console.log('errors:', errors);
await browser.close();
await server.close();
if (errors.length || !res.playing) process.exit(1);
