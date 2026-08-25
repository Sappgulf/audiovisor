/**
 * Chrome accent derivation.
 *
 * The interface used to be locked to the brass palette while the stage
 * offered 25 themes. Now it follows the theme, which means a data file that
 * anyone can extend is deciding what colour the app's labels are — so the
 * rules that turn a palette into an accent are worth pinning down.
 */
import { describe, it, expect } from 'vitest';
import {
  hexToRgb, rgbToHex, luminance, contrast, pickAccent, chroma,
  ensureReadable, accentTokens, applyAccent, CHROME_GROUND,
} from '../src/chrome.js';
import { THEMES } from '../src/themes.js';

describe('colour helpers', () => {
  it('round-trips a hex through rgb', () => {
    expect(rgbToHex(hexToRgb('#d9b089'))).toBe('#d9b089');
  });

  it('pads single-digit channels', () => {
    expect(rgbToHex([0, 5, 16])).toBe('#000510');
  });

  it('clamps out-of-range channels rather than wrapping', () => {
    expect(rgbToHex([300, -20, 128])).toBe('#ff0080');
  });

  it('puts black and white at the ends of the luminance scale', () => {
    expect(luminance([0, 0, 0])).toBe(0);
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 5);
  });

  it('matches the known contrast of black on white', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 2);
  });

  it('is order-independent', () => {
    const a = [217, 176, 137], b = CHROME_GROUND;
    expect(contrast(a, b)).toBeCloseTo(contrast(b, a), 10);
  });
});

describe('pickAccent', () => {
  it('never returns a near-black, however early it sits in the palette', () => {
    // Chop N Screwed opens on #2a0a2a; colors[0] would black out every label
    expect(pickAccent(['#2a0a2a', '#7a2a5a', '#d9b089'])).toBe('#d9b089');
  });

  it('prefers the colourful entry over a paler one that also passes', () => {
    // brightest-only handed Warm Brass the cream above it, so the accent
    // stopped resembling the theme it came from
    expect(pickAccent(['#d9b089', '#c49a6e', '#f5e6d3'])).toBe('#d9b089');
    expect(pickAccent(['#00ff41', '#00c22e', '#aaffcc'])).toBe('#00ff41');
  });

  it('still takes the brightest when the palette has no colour in it', () => {
    // pure max-chroma would pick #8a94a6 here, the dimmest of the three
    expect(pickAccent(['#ffffff', '#c9d2dd', '#8a94a6'])).toBe('#ffffff');
  });

  it('handles a single-colour palette', () => {
    expect(pickAccent(['#00f0ff'])).toBe('#00f0ff');
  });

  it('falls back to ranking the whole palette when nothing clears AA', () => {
    const out = pickAccent(['#101010', '#1a0a1a', '#201020']);
    expect(['#101010', '#1a0a1a', '#201020']).toContain(out);
  });

  it('picks a readable colour whenever the palette contains one', () => {
    for (const t of THEMES) {
      const readable = t.colors.filter((c) => contrast(hexToRgb(c), CHROME_GROUND) >= 4.5);
      if (!readable.length) continue;
      expect(readable, `${t.id}`).toContain(pickAccent(t.colors));
    }
  });
});

describe('chroma', () => {
  it('is zero for greys and one for a pure primary', () => {
    expect(chroma([128, 128, 128])).toBe(0);
    expect(chroma([255, 0, 0])).toBe(1);
  });
});

describe('ensureReadable', () => {
  it('leaves a colour that already clears the threshold alone', () => {
    const bright = [255, 255, 255];
    expect(ensureReadable(bright)).toEqual(bright);
  });

  it('lifts a colour that is too dark until it clears AA', () => {
    const dark = [40, 40, 44];
    expect(contrast(dark, CHROME_GROUND)).toBeLessThan(4.5);
    expect(contrast(ensureReadable(dark), CHROME_GROUND)).toBeGreaterThanOrEqual(4.5);
  });

  it('terminates on pure black rather than looping', () => {
    const out = ensureReadable([0, 0, 0]);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('returns integer channels', () => {
    for (const v of ensureReadable([40, 41, 42])) expect(Number.isInteger(v)).toBe(true);
  });
});

describe('accentTokens', () => {
  const tokens = accentTokens(['#00f0ff', '#7b2bff', '#ff2bd6']);

  it('emits every property the stylesheet reads', () => {
    expect(Object.keys(tokens).sort()).toEqual([
      '--accent', '--accent-dim', '--accent-glow',
      '--accent-hover', '--accent-line', '--accent-rgb', '--accent-strong',
    ]);
  });

  it('derives from the palette entry pickAccent chose', () => {
    expect(tokens['--accent']).toBe('#00f0ff');
  });

  it('exposes bare channels for the rgba() call sites', () => {
    // 20 rules build their own alpha from these; a hex there would not work
    expect(tokens['--accent-rgb']).toBe('0, 240, 255');
    expect(tokens['--accent-dim']).toBe('rgba(0, 240, 255, 0.16)');
  });

  it('makes hover lighter and strong darker than the base', () => {
    const base = luminance(hexToRgb(tokens['--accent']));
    expect(luminance(hexToRgb(tokens['--accent-hover']))).toBeGreaterThan(base);
    expect(luminance(hexToRgb(tokens['--accent-strong']))).toBeLessThan(base);
  });
});

describe('every shipped theme', () => {
  /* Small uppercase mono is nearly every label the accent touches, so the
     4.5:1 small-text threshold is the one that applies — the 3:1 large-text
     allowance covers none of it. */
  it.each(THEMES.map((t) => [t.id, t]))('%s clears AA as text', (_id, theme) => {
    const rgb = hexToRgb(accentTokens(theme.colors)['--accent']);
    expect(contrast(rgb, CHROME_GROUND)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES.map((t) => [t.id, t]))('%s clears AA as a solid fill', (_id, theme) => {
    // the accent is also a background with #1a1816 text on it (nav pill, buttons)
    const rgb = hexToRgb(accentTokens(theme.colors)['--accent']);
    expect(contrast(rgb, [26, 24, 22])).toBeGreaterThanOrEqual(4.5);
  });

  it('produces a distinct accent for most themes', () => {
    const seen = new Set(THEMES.map((t) => accentTokens(t.colors)['--accent']));
    // a handful legitimately share a brightest colour; a collapse to one or
    // two would mean the derivation had stopped tracking the theme at all
    expect(seen.size).toBeGreaterThan(15);
  });
});

describe('applyAccent', () => {
  const fakeRoot = () => {
    const props = {};
    return { props, style: { setProperty: (k, v) => { props[k] = v; } } };
  };

  it('writes every token onto the element', () => {
    const root = fakeRoot();
    applyAccent({ colors: ['#00f0ff'] }, root);
    expect(root.props['--accent']).toBe('#00f0ff');
    expect(Object.keys(root.props)).toHaveLength(7);
  });

  it('ignores a theme with no colours instead of throwing', () => {
    const root = fakeRoot();
    expect(applyAccent({ colors: [] }, root)).toBeNull();
    expect(applyAccent(null, root)).toBeNull();
    expect(applyAccent(undefined, root)).toBeNull();
    expect(Object.keys(root.props)).toHaveLength(0);
  });

  it('ignores a missing root instead of throwing', () => {
    expect(applyAccent({ colors: ['#fff'] }, null)).toBeNull();
  });
});
