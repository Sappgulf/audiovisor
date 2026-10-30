/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  CUSTOM_THEME_ID, normalizeColors, makeCustomTheme, saveCustomTheme, loadCustomTheme,
} from '../src/custom-theme.js';

const COLORS = ['#ff2bd6', '#ff8a00', '#ccff00', '#00f0ff', '#7b2bff'];

beforeEach(() => localStorage.clear());

describe('custom theme', () => {
  it('accepts exactly five six-digit hex colours', () => {
    expect(normalizeColors(COLORS)).toEqual(COLORS);
    expect(normalizeColors(['#fff', ...COLORS.slice(1)])).toBeNull();
    expect(normalizeColors(COLORS.slice(0, 4))).toBeNull();
    expect(normalizeColors('nope')).toBeNull();
  });

  it('builds a usable theme with the stable custom id', () => {
    const theme = makeCustomTheme(COLORS);
    expect(theme.id).toBe(CUSTOM_THEME_ID);
    expect(theme.colors).toEqual(COLORS);
    expect(theme.css).toContain(COLORS[0]);
    expect(theme.css).toContain(COLORS[4]);
  });

  it('round-trips through storage', () => {
    saveCustomTheme(COLORS);
    expect(loadCustomTheme()?.colors).toEqual(COLORS);
  });

  it('falls back to a valid palette when given bad input', () => {
    const theme = makeCustomTheme(['bad']);
    expect(theme.colors).toHaveLength(5);
    expect(theme.colors.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
  });
});
