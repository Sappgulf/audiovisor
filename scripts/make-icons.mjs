#!/usr/bin/env node
/**
 * Generate the PWA / home-screen icons.
 *
 * The manifest shipped a single inline SVG icon, which iOS ignores outright
 * — an installed home-screen app got a blank or screenshotted tile. These
 * are real PNGs at the sizes Android and iOS actually ask for, drawn from
 * the same mark as the favicon so everything matches.
 *
 * Run with `npm run icons` after changing the mark. Output is committed.
 */
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = 'public/icons';
mkdirSync(OUT, { recursive: true });

const BG = '#1a1816';
const ACCENT = '#d9b089';
const HIGHLIGHT = '#f5e6d3';

/**
 * @param {number} size
 * @param {boolean} maskable  Android maskable icons are cropped to a circle,
 *   so the mark shrinks into the 80% safe zone and the field bleeds edge to
 *   edge instead of sitting in a rounded square.
 */
function draw(size, { maskable = false } = {}) {
  const c = createCanvas(size, size);
  const x = c.getContext('2d');
  const r = maskable ? 0 : size * 0.22;

  // rounded field
  x.fillStyle = BG;
  x.beginPath();
  x.roundRect(0, 0, size, size, r);
  x.fill();

  // warm radial wash, same as the favicon
  const g = x.createRadialGradient(size * 0.5, size * 0.42, 0, size * 0.5, size * 0.42, size * 0.62);
  g.addColorStop(0, HIGHLIGHT);
  g.addColorStop(1, ACCENT);
  x.fillStyle = g;
  x.beginPath();
  x.roundRect(0, 0, size, size, r);
  x.fill();

  /* Proportions come from the favicon: a 9.2/32 square rotated 45 inside a
     9.6/32 ring. Maskable icons shrink to sit inside the 80% safe circle
     Android crops to. */
  const scale = maskable ? 0.72 : 1;
  x.save();
  x.translate(size / 2, size / 2);

  // ring
  x.strokeStyle = 'rgba(26,24,22,0.25)';
  x.lineWidth = Math.max(1, size * 0.0175);
  x.beginPath();
  x.arc(0, 0, size * 0.3 * scale, 0, Math.PI * 2);
  x.stroke();

  // diamond
  const half = size * (9.2 / 32) * 0.5 * scale;
  x.rotate(Math.PI / 4);
  x.fillStyle = BG;
  x.fillRect(-half, -half, half * 2, half * 2);
  x.restore();


  return c.toBuffer('image/png');
}

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, {}],
];

for (const [name, size, opts] of targets) {
  writeFileSync(`${OUT}/${name}`, draw(size, opts));
  console.log(`${OUT}/${name}  ${size}x${size}`);
}
console.log('DONE');
