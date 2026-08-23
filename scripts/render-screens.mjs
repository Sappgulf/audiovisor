import { createCanvas } from '@napi-rs/canvas';
import { Renderer } from '../src/visualizers.js';
import { MODES, THEMES } from '../src/themes.js';
import { mkdirSync, writeFileSync } from 'node:fs';

const W = 640, H = 480;
const OUT = '/tmp/audiovisor-shots';
mkdirSync(OUT, { recursive: true });

const makeCanvas = () => {
  const c = createCanvas(1, 1);
  c.getBoundingClientRect = () => ({ width: W, height: H });
  return c;
};
globalThis.document = { createElement: (tag) => (tag === 'canvas' ? makeCanvas() : {}) };
globalThis.window = { devicePixelRatio: 1 };

function synthData(t) {
  /* band-limited synth-music: kick + funky mids + sparse highs, beats at
     0.55s — closer to a real track than flat noise so per-mode dynamics
     show an honest contrast. */
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

for (const m of MODES) {
  const renderer = new Renderer(makeCanvas());
  renderer.dpr = 1;
  renderer.quality = 'high';
  renderer.setTheme(THEMES.find((th) => th.id === 'brass'));
  renderer.setMode(m.id);
  /* warm up ~13s of playback so waterfalls/pipelines/trails are mature
     (spectro needs ~10s to fill a 640px waterfall at 1 col / 16ms) */
  for (let f = 0; f < 800; f++) {
    const t = f * 0.016;
    const { freq, wave, levels } = synthData(t);
    renderer.render(false, freq, wave, levels, 16.7);
  }
  const frames = [];
  for (const t of [0.6, 2.4, 4.5]) {
    const { freq, wave, levels } = synthData(t);
    renderer.render(false, freq, wave, levels, 16.7);
    const cv = createCanvas(W, H);
    const cx = cv.getContext('2d');
    cx.drawImage(renderer.canvas, 0, 0, W, H);
    frames.push(cv);
  }
  /* composite over the same dark wash the page uses, so screenshots match
     what a viewer sees (canvas has theme-alpha bottom stop) */
  const out = createCanvas(W * frames.length, H);
  const octx = out.getContext('2d');
  octx.fillStyle = '#0b0a09';
  octx.fillRect(0, 0, out.width, out.height);
  frames.forEach((f, i) => octx.drawImage(f, i * W, 0));
  writeFileSync(`${OUT}/${m.id}.png`, Buffer.from(await out.encode('png')));
}

console.log('DONE');
