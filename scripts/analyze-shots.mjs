#!/usr/bin/env node
/**
 * Exposure report for the stage-mode screenshots.
 *
 * `npm run shots` renders every mode; this measures them, because "does
 * this look blown out?" is much easier to answer with numbers than by
 * squinting at 22 images. Reports, per mode:
 *
 *   mean   average luminance 0-255
 *   clip%  share of pixels at pure white — detail and colour thrown away
 *   sat    mean saturation over non-black pixels; clipping drags it down
 *
 * The modes use Math.random for jitter and the render is not seeded, so
 * repeated runs vary by roughly 0.1 percentage points on the average. Treat
 * anything smaller than that as noise rather than as a result.
 *
 * Usage: npm run shots && npm run analyze [dir]
 */
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { MODES } from '../src/themes.js';

const DIR = process.argv[2] || '/tmp/audiovisor-shots';

const rows = [];
for (const m of MODES) {
  let img;
  try {
    img = await loadImage(`${DIR}/${m.id}.png`);
  } catch {
    console.error(`missing ${m.id}.png — run \`npm run shots\` first`);
    process.exit(1);
  }
  const c = createCanvas(img.width, img.height);
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, img.width, img.height).data;

  let sum = 0, clip = 0, satSum = 0, lit = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (r > 245 && g > 245 && b > 245) clip++;
    const mx = Math.max(r, g, b);
    if (mx > 24) { satSum += (mx - Math.min(r, g, b)) / mx; lit++; }
  }
  const px = d.length / 4;
  rows.push({
    id: m.id,
    mean: sum / px,
    clip: (clip / px) * 100,
    sat: satSum / Math.max(1, lit),
  });
}

rows.sort((a, b) => b.clip - a.clip);
console.log('mode          mean   clip%    sat');
for (const r of rows) {
  const flag = r.clip > 2 ? '  <- clipping' : '';
  console.log(
    `${r.id.padEnd(12)} ${r.mean.toFixed(1).padStart(5)} ${r.clip.toFixed(1).padStart(6)} ` +
    `${r.sat.toFixed(3).padStart(6)}${flag}`,
  );
}
const worst = rows[0];
console.log(`\nworst: ${worst.id} at ${worst.clip.toFixed(1)}% clipped`);
