/**
 * The Auto theme turns album artwork into a stage palette. These tests pin
 * the extraction rules on synthetic pixels — solid fields, two-hue covers,
 * gradients — because a regression here is invisible until someone's cover
 * art lights the stage in the wrong colours.
 */
import { describe, it, expect } from 'vitest';
import {
  extractPalette, ensureColors, paletteToTheme, colorDist, hashStr, darken, lighten,
} from '../src/artpalette.js';

/** Solid RGBA buffer of one colour. */
function solid(r, g, b, px = 4096) {
  const d = new Uint8ClampedArray(px * 4);
  for (let i = 0; i < px; i++) {
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
  }
  return d;
}

/** Left half one hue, right half another. */
function twoHue([r1, g1, b1], [r2, g2, b2], w = 128, h = 32) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const [r, g, b] = x < w / 2 ? [r1, g1, b1] : [r2, g2, b2];
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  return d;
}

const isHex = (c) => /^#[0-9a-f]{6}$/i.test(c);

describe('extractPalette', () => {
  it('returns the colour of a solid field', () => {
    const [hex] = extractPalette(solid(220, 40, 60), 1);
    expect(hex.toLowerCase()).toBe('#dc283c');
  });

  it('keeps two distinct hues from a split cover', () => {
    const cols = extractPalette(twoHue([230, 30, 90], [20, 160, 230]), 5).map((c) => c.toLowerCase());
    expect(cols.length).toBeGreaterThanOrEqual(2);
    // one pick near each half — near-duplicate merging must not eat a hue
    expect(cols.some((c) => colorDist([parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)], [230, 30, 90]) < 60)).toBe(true);
    expect(cols.some((c) => colorDist([parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)], [20, 160, 230]) < 60)).toBe(true);
  });

  it('is deterministic', () => {
    const a = extractPalette(twoHue([200, 120, 10], [40, 90, 200]));
    const b = extractPalette(twoHue([200, 120, 10], [40, 90, 200]));
    expect(a).toEqual(b);
  });

  it('never returns more than asked', () => {
    expect(extractPalette(twoHue([200, 120, 10], [40, 90, 200]), 2).length).toBeLessThanOrEqual(2);
  });

  it('handles empty input without throwing', () => {
    expect(extractPalette(new Uint8ClampedArray(0))).toEqual([]);
  });

  it('skips transparent pixels', () => {
    const d = new Uint8ClampedArray(4096 * 4); // all alpha 0
    expect(extractPalette(d)).toEqual([]);
  });

  it('keeps the vivid minority alive on a muted cover', () => {
    // 90% near-grey, 10% hot magenta — the lead is truthfully the dominant
    // field, but the accent must not swallow the one saturated hue
    const w = 256, h = 64;
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const hot = x > w * 0.9;
        d[o] = hot ? 255 : 120;
        d[o + 1] = hot ? 20 : 118;
        d[o + 2] = hot ? 160 : 116;
        d[o + 3] = 255;
      }
    }
    const cols = extractPalette(d, 3);
    const rgbs = cols.map((c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);
    expect(rgbs.some((rgb) => rgb[0] > 200 && rgb[1] < 80)).toBe(true); // magenta survives
  });
});

describe('ensureColors', () => {
  it('pads a two-colour cover to three', () => {
    const out = ensureColors(['#ff0044', '#0044ff']);
    expect(out.length).toBe(3);
    out.forEach((c) => expect(isHex(c)).toBe(true));
  });

  it('drops malformed entries', () => {
    const out = ensureColors(['#ff0044', 'red', null, '#0044ff']);
    expect(out).toContain('#ff0044');
    expect(out).toContain('#0044ff');
    expect(out.length).toBe(3);
  });

  it('falls back to brass for garbage input', () => {
    const out = ensureColors(['nope']);
    expect(out[0]).toBe('#d9b089');
    expect(out.length).toBe(3);
    out.forEach((c) => expect(isHex(c)).toBe(true));
  });
});

describe('paletteToTheme', () => {
  it('shapes a renderer-ready theme object', () => {
    const t = paletteToTheme(['#ff0044', '#0044ff']);
    expect(t.id).toBe('auto');
    expect(t.colors.length).toBeGreaterThanOrEqual(3);
    expect(t.css).toContain(t.colors[0]);
    expect(t.css).toContain(t.colors[t.colors.length - 1]);
  });
});

describe('hashStr', () => {
  it('is stable and spreads names across the palette range', () => {
    expect(hashStr('song')).toBe(hashStr('song'));
    const seen = new Set([...Array(40)].map((_, i) => hashStr(`track ${i}`) % 25));
    expect(seen.size).toBeGreaterThan(10); // not all landing on one bucket
  });
});

describe('darken/lighten', () => {
  it('move toward black and white respectively', () => {
    expect(colorDist(hexToRgbSafe(darken('#808080', 0.5)), [64, 64, 64])).toBeLessThan(2);
    expect(colorDist(hexToRgbSafe(lighten('#808080', 0.5)), [191, 191, 191])).toBeLessThan(2);
  });
});

function hexToRgbSafe(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
