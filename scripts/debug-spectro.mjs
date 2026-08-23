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

const renderer = new Renderer(makeCanvas());
renderer.dpr = 1;
renderer.quality = 'high';
renderer.setMode('spectro');

const freq = new Uint8Array(1024);
const wave = new Uint8Array(2048);
for (let i = 0; i < 1024; i++) freq[i] = 120 + (i < 200 ? 100 : 0);
wave.fill(128);

for (let f = 0; f < 10; f++) {
  renderer.render(false, freq, wave, { bass: 0.4, mid: 0.4, high: 0.3, level: 0.4, beatPulse: 0, bpm: 0, beatConfidence: 0 }, 16.7);
}

console.log('specCv size:', renderer.specCv.width, 'x', renderer.specCv.height);
const sctx = renderer.specCv.getContext('2d');
const probe = sctx.getImageData(0, H / 2 | 0, 20, 1).data;
console.log('specCv mid-row first 20 px RGB:', Array.from(probe.slice(0, 60)));

writeFileSync('/tmp/audiovisor-shots/debug-specCv.png', Buffer.from(await renderer.specCv.encode('png')));
writeFileSync('/tmp/audiovisor-shots/debug-main.png', Buffer.from(await renderer.canvas.encode('png')));
console.log('wrote debug pngs');
