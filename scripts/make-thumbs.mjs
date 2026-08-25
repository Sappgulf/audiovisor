#!/usr/bin/env node
/**
 * Mode thumbnails for the stage picker.
 *
 * The picker offered 22 tiles that were identical but for a small line icon,
 * two of which were duplicated across different modes. Choosing a visualiser
 * is a purely visual decision, so the tile should show the mode.
 *
 * These are deliberately monochrome. Colour in this app belongs to the theme,
 * and a thumbnail baked in one theme is wrong in the other twenty-four; what
 * actually distinguishes the modes is their form. Rendering the whole set in
 * the neutral Monolith palette keeps the grid calm and truthful, and means
 * one asset set stays correct whatever theme is selected.
 *
 * Usage: npm run thumbs   (writes public/modes/<id>.webp + <id>-anim.webp)
 *
 * The `-anim` files are 10-frame horizontal sprite strips: the picker swaps
 * one in on hover and walks it with a CSS steps() animation. They are baked
 * from the same warmup state as the still, so the loop starts mid-scene.
 */
import { createCanvas } from '@napi-rs/canvas';
import { Renderer, loadExtraModes, extraModesLoaded } from '../src/visualizers.js';
import { MODES, THEMES } from '../src/themes.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const W = 176;               // 2x the ~88px the tile occupies in the drawer
const H = 108;
/* Render at stage scale and downsample, rather than rendering straight to
   176x108. Several passes are resolution-dependent — the bloom buffers are
   a quarter of the canvas, so at 108px tall they work on a 27px image and
   smear the whole frame into one glowing slab. Lava Lamp came out as a
   white blob with no lumps in it while the same mode at stage size was
   perfectly legible. Rendering big and scaling down gives a thumbnail of
   what the mode actually looks like. */
const RW = W * 3;
const RH = H * 3;
const OUT = 'public/modes';
const WARMUP = 420;          // let waterfalls, trails and particle pools fill
/* Hover animation: 10 frames captured 4 sim-frames apart (~15.6fps, a 0.64s
   loop) baked into one horizontal strip per mode. The picker swaps the strip
   in on hover and animates it with a CSS steps() walk — no runtime renderer,
   no video codecs, and nothing loads until the user actually points at a
   tile. */
const STRIP_FRAMES = 10;
const STRIP_STEP = 4;

const makeCanvas = () => {
  const c = createCanvas(1, 1);
  c.getBoundingClientRect = () => ({ width: RW, height: RH });
  return c;
};
globalThis.document = { createElement: (t) => (t === 'canvas' ? makeCanvas() : {}) };
globalThis.window = { devicePixelRatio: 1 };

await loadExtraModes(Renderer);
if (!extraModesLoaded()) throw new Error('extra visualizer modes failed to install');

/** Deterministic PRNG, so re-running does not churn every file in git. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The same band-limited synth track the screenshot and test harnesses use. */
function synthData(t) {
  const freq = new Uint8Array(1024);
  const wave = new Uint8Array(2048);
  for (let i = 0; i < 1024; i++) {
    const u = i / 1024;
    let v = 0.06;
    v += 0.6 * Math.exp(-Math.pow((u - 0.02 - 0.015 * Math.sin(t * 1.7)) * 16, 2));
    v += 0.46 * Math.abs(Math.sin(u * 26 + t * 1.1)) * Math.exp(-u * 2.4);
    v += 0.26 * Math.exp(-Math.pow((u - 0.3) * 10, 2));
    v += 0.12 * Math.abs(Math.sin(u * 90 + t * 3.7)) * Math.exp(-u * 4.2) * (0.5 + 0.5 * Math.sin(t * 0.9));
    freq[i] = Math.max(0, Math.min(255, Math.round(255 * v)));
  }
  for (let i = 0; i < 2048; i++) {
    const v = Math.sin(i * 0.017 + t * 2.2) * 0.4 + Math.sin(i * 0.0053 - t * 1.1) * 0.3;
    wave[i] = Math.round(128 + 127 * v);
  }
  const beat = (t % 0.55) < 0.12 ? 1 : 0;
  return {
    freq,
    wave,
    levels: {
      bass: Math.min(1, 0.3 + 0.5 * Math.max(0, Math.sin(t * 2.1)) + beat * 0.4),
      mid: 0.4 + 0.2 * Math.abs(Math.sin(t * 1.3)),
      high: 0.22 + 0.16 * Math.abs(Math.sin(t * 0.8)),
      level: Math.min(1, 0.45 + 0.3 * Math.max(0, Math.sin(t * 1.8)) + beat * 0.25),
      beatPulse: beat ? 0.85 : 0,
      beatPhase: (t % 0.55) / 0.55,
      bpm: 109,
      beatConfidence: 0.93,
    },
  };
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const neutral = THEMES.find((t) => t.id === 'monolith');
let total = 0;

for (const m of MODES) {
  const realRandom = Math.random;
  Math.random = mulberry32(0x5EED);
  try {
    const renderer = new Renderer(makeCanvas());
    renderer.dpr = 1;
    renderer.quality = 'high';
    renderer.setTheme(neutral);
    renderer.setMode(m.id);
    for (let f = 0; f < WARMUP; f++) {
      const t = f * 0.016;
      const d = synthData(t);
      renderer.render(false, d.freq, d.wave, d.levels, 16.7);
    }
    const d = synthData(2.4);
    renderer.render(false, d.freq, d.wave, d.levels, 16.7);

    const out = createCanvas(W, H);
    const cx = out.getContext('2d');
    cx.fillStyle = '#0f0e0d';                 // matches .mode-preview's ground
    cx.fillRect(0, 0, W, H);
    cx.imageSmoothingEnabled = true;
    cx.drawImage(renderer.canvas, 0, 0, W, H);
    const buf = await out.encode('webp', 78);
    writeFileSync(`${OUT}/${m.id}.webp`, buf);
    total += buf.length;
    process.stdout.write(`${m.id} ${(buf.length / 1024).toFixed(1)}kB  `);

    /* sprite strip for the hover animation — the simulation keeps running
       from where the still left off, so the loop starts mid-performance */
    const strip = createCanvas(W * STRIP_FRAMES, H);
    const sx = strip.getContext('2d');
    sx.fillStyle = '#0f0e0d';
    sx.fillRect(0, 0, strip.width, H);
    sx.imageSmoothingEnabled = true;
    let t = WARMUP * 0.016;
    for (let k = 0; k < STRIP_FRAMES; k++) {
      for (let f = 0; f < STRIP_STEP; f++) {
        const d2 = synthData(t);
        renderer.render(false, d2.freq, d2.wave, d2.levels, 16.7);
        t += 0.016;
      }
      sx.drawImage(renderer.canvas, k * W, 0, W, H);
    }
    const sbuf = await strip.encode('webp', 72);
    writeFileSync(`${OUT}/${m.id}-anim.webp`, sbuf);
    total += sbuf.length;
    process.stdout.write(`+anim ${(sbuf.length / 1024).toFixed(1)}kB `);
  } finally {
    Math.random = realRandom;
  }
}

console.log(`\n${MODES.length} thumbnails, ${(total / 1024).toFixed(1)} kB total`);
