/**
 * Chrome accent — derive the interface accent from the selected stage theme.
 *
 * The app shipped 25 stage themes and an interface locked to one of them:
 * --accent was hardcoded to the brass palette, so choosing Neon Cyber
 * recoloured the visualiser and left every chip, tab, slider and button warm
 * brown. The chrome now follows the theme.
 *
 * Kept free of the DOM so the rules are testable on their own; applyAccent()
 * is the only part that touches document.
 */

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** @returns {[number, number, number]} */
export function hexToRgb(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(rgb) {
  return `#${rgb.map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`;
}

const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

/** Relative luminance, 0..1. */
export function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two RGB triples, 1..21. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/**
 * The composite the drawer resolves to over the page background —
 * rgba(30,28,26,0.88) on #0f0e0d. This is the ground the accent sits on as
 * text, so it is the one contrast has to be measured against.
 */
export const CHROME_GROUND = [28, 26, 24];

/** Small uppercase mono is nearly every label the accent touches. */
const AA_SMALL = 4.5;

/** Colourfulness, 0..1. Cheap proxy for chroma; good enough to rank a palette. */
export function chroma(rgb) {
  return (Math.max(...rgb) - Math.min(...rgb)) / 255;
}

/* How much brightness counts against colourfulness when ranking a palette.
   Tuned against all 25 themes: high enough that Monolith picks white rather
   than its dimmest grey, low enough that Warm Brass picks #d9b089 rather than
   the pale cream above it. */
const LUM_WEIGHT = 0.35;

/**
 * Pick the palette entry to use as the interface accent.
 *
 * Two failure modes bracket this. Taking colors[0] is unusable: several
 * themes lead with a near-black — Chop N Screwed opens on #2a0a2a, Ocean
 * Depth ends on #001a33 — which would make every label in the app
 * unreadable. Taking the brightest is safe but washed out: it hands Warm
 * Brass the pale cream #f5e6d3 instead of the brass itself, and Matrix a
 * faint mint instead of its signature green, so the accent stops looking
 * like the theme it came from.
 *
 * So: consider only entries that already clear AA against the chrome ground,
 * then rank those by colourfulness with a thumb on the scale for brightness.
 * If nothing clears AA, rank the whole palette the same way and let
 * ensureReadable() lift the winner.
 */
export function pickAccent(colors) {
  const readable = colors.filter((c) => contrast(hexToRgb(c), CHROME_GROUND) >= AA_SMALL);
  const pool = readable.length ? readable : colors;
  const score = (c) => {
    const rgb = hexToRgb(c);
    return chroma(rgb) + LUM_WEIGHT * luminance(rgb);
  };
  let best = pool[0];
  let bestScore = -Infinity;
  for (const c of pool) {
    const sc = score(c);
    if (sc > bestScore) { bestScore = sc; best = c; }
  }
  return best;
}

/**
 * Lift a colour toward white until it clears the small-text threshold.
 *
 * Measured across all 25 themes the brightest-entry rule already clears AA
 * everywhere — the worst case is Sunset at 6.12:1 — so this never fires
 * today. It is here because the theme list is data: someone adding a moody
 * palette of three mid-tones would otherwise ship an unreadable interface
 * with nothing to catch it.
 */
export function ensureReadable(rgb, ground = CHROME_GROUND, target = AA_SMALL + 0.1) {
  let out = rgb;
  for (let i = 0; i < 24 && contrast(out, ground) < target; i++) {
    out = mix(out, [255, 255, 255], 0.05);
  }
  return out.map(clamp255);
}

/**
 * The six --accent-* custom properties, derived from a theme's palette.
 * @param {string[]} colors a theme's `colors` array
 * @returns {Record<string, string>} property name -> value
 */
export function accentTokens(colors) {
  const base = ensureReadable(hexToRgb(pickAccent(colors)));
  return {
    '--accent-rgb': base.join(', '),
    '--accent': rgbToHex(base),
    '--accent-hover': rgbToHex(mix(base, [255, 255, 255], 0.28)),
    '--accent-strong': rgbToHex(mix(base, [0, 0, 0], 0.18)),
    '--accent-dim': `rgba(${base.join(', ')}, 0.16)`,
    '--accent-glow': `rgba(${base.join(', ')}, 0.32)`,
    '--accent-line': `rgba(${base.join(', ')}, 0.22)`,
  };
}

/**
 * Write the derived tokens onto the document.
 * @param {{colors: string[]}} theme
 * @param {HTMLElement} [root]
 */
export function applyAccent(theme, root = document.documentElement) {
  if (!theme?.colors?.length || !root) return null;
  const tokens = accentTokens(theme.colors);
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
  return tokens;
}
