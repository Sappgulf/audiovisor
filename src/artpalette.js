/**
 * Album-art palette extraction — the "Auto" theme.
 *
 * A track's cover already carries its mood; this pulls a small set of
 * colours out of it and shapes them into something the stage can light
 * with. Kept free of the DOM (it takes raw pixel bytes) so the rules are
 * testable and reusable for any artwork source.
 *
 * The algorithm is deliberately boring: quantize into a 4-bit-per-channel
 * histogram, score each bucket by coverage weighted toward vividness, then
 * merge near-duplicates so a gradient cover yields distinct colours instead
 * of five steps of the same hue. Deterministic by construction — the same
 * cover always produces the same theme.
 */

import { hexToRgb, rgbToHex } from './chrome.js';

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** Euclidean distance between two rgb triples. */
export function colorDist(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Pull the dominant colours out of RGBA pixel bytes.
 *
 * @param {Uint8ClampedArray|Uint8Array} data RGBA bytes (any dimensions)
 * @param {number} [count] how many colours to return
 * @returns {string[]} hex colours, most significant first
 */
export function extractPalette(data, count = 5) {
  const px = Math.floor(data.length / 4);
  if (!px) return [];
  /* ~4k samples is plenty to characterise a cover and keeps this O(1)-ish
     no matter how large the source image was */
  const stride = Math.max(1, Math.floor(px / 4096));

  const bins = new Map();
  let sampled = 0;
  for (let i = 0; i < px; i += stride) {
    const o = i * 4;
    if (data[o + 3] < 128) continue;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key);
    if (bin) { bin.r += r; bin.g += g; bin.b += b; bin.n++; }
    else bins.set(key, { r, g, b, n: 1 });
    sampled++;
  }
  if (!sampled) return [];

  /* Coverage × vividness: a huge muted field still beats a tiny hot spot,
     but between comparable coverages the saturated hue leads. The 0.3 floor
     keeps near-black/near-white anchors in the race at all. */
  const scored = [];
  for (const bin of bins.values()) {
    const r = bin.r / bin.n, g = bin.g / bin.n, b = bin.b / bin.n;
    const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    scored.push({
      rgb: [Math.round(r), Math.round(g), Math.round(b)],
      score: (bin.n / sampled) * (0.3 + 0.7 * chroma),
    });
  }
  scored.sort((a, b) => b.score - a.score);

  /* Merge near-duplicates: gradient artwork quantises into neighbouring
     buckets that would otherwise spend all `count` slots on one hue. */
  const picked = [];
  for (const c of scored) {
    if (picked.length >= count) break;
    if (picked.every((p) => colorDist(p.rgb, c.rgb) > 52)) picked.push(c);
  }

  return picked.map((p) => rgbToHex(p.rgb));
}

/** Darken/lighten helpers used to pad short palettes. */
export function darken(hex, t) {
  return rgbToHex(mix(hexToRgb(hex), [0, 0, 0], t));
}
export function lighten(hex, t) {
  return rgbToHex(mix(hexToRgb(hex), [255, 255, 255], t));
}

/**
 * Pad a palette to at least `min` entries so the stage always has a deep
 * anchor and a bright top — the renderers index colours by slot, and a
 * two-colour cover would otherwise leave the third slot undefined.
 *
 * @param {string[]} colors
 * @param {number} [min]
 * @returns {string[]}
 */
export function ensureColors(colors, min = 3) {
  const out = colors.filter((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c));
  if (!out.length) return ensureColors(['#d9b089'], min);
  let i = 0;
  while (out.length < min) {
    out.push(i % 2 === 0 ? darken(out[0], 0.55) : lighten(out[out.length - 1], 0.4));
    i++;
  }
  return out;
}

/**
 * Shape extracted colours into a theme object the renderers accept.
 *
 * @param {string[]} colors hex colours from extractPalette()
 * @param {string} [name] label shown in the UI
 */
export function paletteToTheme(colors, name = 'Auto') {
  const cols = ensureColors(colors);
  return {
    id: 'auto',
    name,
    colors: cols,
    css: `linear-gradient(135deg, ${cols[0]}, ${cols[cols.length - 1]})`,
  };
}

/** FNV-1a, for the deterministic name-derived fallback palette. */
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
