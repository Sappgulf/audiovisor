// @ts-check
import { hexRgba } from './utils.js';

/**
 * Theme-reactive favicon.
 *
 * Draws the same mark as public/icons — obsidian field, theme-lit ring,
 * theme diamond with the equalizer slots cut back through it — and swaps it
 * into a <link rel="icon">. The colours are supplied by a getter so this
 * module has no opinion about where the active theme lives.
 */

const DEFAULT_COLORS = ['#d9b089', '#8a6a4a'];

/**
 * @param {() => string[] | undefined} getColors  active theme colours, hex
 * @param {Document} [doc]
 * @returns {() => void} repaint the favicon from the current colours
 */
export function createFavicon(getColors, doc = document) {
  let linkEl = null;
  return function updateFavicon() {
    const colors = getColors() || DEFAULT_COLORS;
    const cv = doc.createElement('canvas');
    cv.width = cv.height = 64;
    const c2 = cv.getContext('2d');
    if (!c2) return;
    c2.fillStyle = '#14110f';
    c2.beginPath();
    if (c2.roundRect) c2.roundRect(0, 0, 64, 64, 14);
    else c2.rect(0, 0, 64, 64);
    c2.fill();
    c2.strokeStyle = hexRgba(colors[colors.length - 1] || colors[0], 0.4);
    c2.lineWidth = 2.8;
    c2.beginPath();
    c2.arc(32, 32, 19.6, 0, Math.PI * 2);
    c2.stroke();
    c2.save();
    c2.translate(32, 32);
    c2.rotate(Math.PI / 4);
    c2.fillStyle = colors[0];
    c2.fillRect(-9.2, -9.2, 18.4, 18.4);
    c2.restore();
    c2.fillStyle = '#14110f';
    for (const [bx, bh] of [[-4.8, 5.2], [0, 8.8], [4.8, 6.8]]) {
      c2.beginPath();
      if (c2.roundRect) c2.roundRect(32 + bx - 1.5, 32 - bh, 3, bh * 2, 1.5);
      else c2.rect(32 + bx - 1.5, 32 - bh, 3, bh * 2);
      c2.fill();
    }
    if (!linkEl) {
      linkEl = doc.createElement('link');
      linkEl.rel = 'icon';
      linkEl.type = 'image/png';
      doc.head.appendChild(linkEl);
    }
    try {
      linkEl.href = cv.toDataURL('image/png');
    } catch { /* non-browser env (tests) without toDataURL */ }
  };
}
