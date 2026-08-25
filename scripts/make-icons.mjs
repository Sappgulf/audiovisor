#!/usr/bin/env node
/**
 * Generate the PWA / home-screen icons.
 *
 * The original mark was a dark diamond on a pale brass field. Fine at 512,
 * but it said nothing about what the app does — the new mark cuts a three-bar
 * equalizer into the diamond, so the tile reads "music" even at 16px in a
 * browser tab. The favicon data-URI in index.html, the runtime favicon in
 * main.js and the og.html lockup mark all mirror these proportions; change
 * them together.
 *
 * Run with `npm run icons` after changing the mark. Output is committed.
 */
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = 'public/icons';
mkdirSync(OUT, { recursive: true });

const FIELD = '#14110f';
const BRASS_HI = '#ecd2ae';
const BRASS_LO = '#c49a6e';

/**
 * @param {number} size
 * @param {boolean} maskable  Android maskable icons are cropped to a circle,
 *   so the mark shrinks into the 80% safe zone and the field bleeds edge to
 *   edge instead of sitting in a rounded square.
 */
function draw(size, { maskable = false } = {}) {
  const c = createCanvas(size, size);
  const x = c.getContext('2d');
  const s = size;
  const r = maskable ? 0 : s * 0.1875;

  // obsidian field
  x.fillStyle = FIELD;
  x.beginPath();
  x.roundRect(0, 0, s, s, r);
  x.fill();

  // faint brass bloom behind the mark
  const glow = x.createRadialGradient(s * 0.5, s * 0.38, 0, s * 0.5, s * 0.38, s * 0.75);
  glow.addColorStop(0, 'rgba(217,176,137,0.34)');
  glow.addColorStop(1, 'rgba(217,176,137,0)');
  x.fillStyle = glow;
  x.beginPath();
  x.roundRect(0, 0, s, s, r);
  x.fill();

  /* Proportions mirror the 32px favicon: a 9.2/32 square rotated 45 inside a
     9.8/32 ring. Maskable icons shrink to sit inside the 80% safe circle
     Android crops to. */
  const scale = maskable ? 0.72 : 1;
  x.save();
  x.translate(s / 2, s / 2);
  x.scale(scale, scale);

  // ring
  x.strokeStyle = 'rgba(245,230,211,0.30)';
  x.lineWidth = s * 0.04375;
  x.beginPath();
  x.arc(0, 0, s * 0.306, 0, Math.PI * 2);
  x.stroke();

  // brass diamond
  const half = s * 0.14375;
  x.save();
  x.rotate(Math.PI / 4);
  const dg = x.createLinearGradient(-half, -half, half, half);
  dg.addColorStop(0, BRASS_HI);
  dg.addColorStop(1, BRASS_LO);
  x.fillStyle = dg;
  x.fillRect(-half, -half, half * 2, half * 2);
  x.restore();

  // equalizer slots cut back through the diamond (centre bar tallest)
  x.fillStyle = FIELD;
  const bw = s * 0.046875;
  const bars = [
    [s * -0.0844, s * 0.08125],
    [0, s * 0.1375],
    [s * 0.0844, s * 0.10625],
  ];
  for (const [bx, bh] of bars) {
    x.beginPath();
    x.roundRect(bx - bw / 2, -bh, bw, bh * 2, bw / 2);
    x.fill();
  }

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
