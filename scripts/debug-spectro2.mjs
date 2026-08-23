import { createCanvas } from '@napi-rs/canvas';
import { Renderer } from '../src/visualizers.js';
import { writeFileSync } from 'node:fs';

const W = 640, H = 480;
const makeCanvas = () => {
  const c = createCanvas(1, 1);
  c.getBoundingClientRect = () => ({ width: W, height: H });
  return c;
};
globalThis.document = { createElement: (tag) => (tag === 'canvas' ? makeCanvas() : {}) };
globalThis.window = { devicePixelRatio: 1 };

function synthData(t) {
  const freq = new Uint8Array(1024);
  const wave = new Uint8Array(2048);
  for (let i = 0; i < 1024; i++) {
    const u = i / 1024;
    freq[i] = Math.max(0, 255 * (0.22 + 0.55 * Math.abs(Math.sin(u * 9 + t * 1.3)) * Math.pow(1 - u, 0.7))
      + 255 * 0.22 * Math.exp(-Math.pow((u - 0.06 - 0.04 * Math.sin(t)) * 14, 2)) * (0.5 + 0.5 * Math.sin(t * 2.1)));
  }
  for (let i = 0; i < 2048; i++) {
    wave[i] = Math.round(128 + 127 * (Math.sin(i * 0.017 + t * 2.2) * 0.4 + Math.sin(i * 0.0053 - t * 1.1) * 0.3));
  }
  const beat = (t % 0.55) < 0.12 ? 1 : 0;
  return { freq, wave, levels: { bass: 0.6, mid: 0.5, high: 0.35, level: 0.6, beatPulse: beat ? 0.85 : 0, beatPhase: 0.3, bpm: 109, beatConfidence: 0.9 } };
}

const renderer = new Renderer(makeCanvas());
renderer.dpr = 1;
renderer.quality = 'high';
renderer.setMode('spectro');
for (let f = 0; f < 120; f++) {
  const d = synthData(f * 0.016);
  renderer.render(false, d.freq, d.wave, d.levels, 16.7);
}
writeFileSync('/tmp/audiovisor-shots/debug-main2.png', Buffer.from(await renderer.canvas.encode('png')));
console.log('done');
