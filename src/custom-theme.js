// @ts-check
import { readJSON, writeJSON } from './storage.js';

/** The single user-editable palette slot. */
export const CUSTOM_THEME_ID = 'custom';
const KEY = 'audiovisor.customTheme.v1';

/** @param {unknown} value */
export function normalizeColors(value) {
  if (!Array.isArray(value)) return null;
  const out = value
    .filter((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))
    .map((c) => c.toLowerCase())
    .slice(0, 5);
  return out.length === 5 ? out : null;
}

/**
 * @param {string[]} colors five hex colours
 * @returns {{id:string,name:string,colors:string[],css:string}}
 */
export function makeCustomTheme(colors) {
  const safe = normalizeColors(colors) || ['#ff2bd6', '#ff8a00', '#ccff00', '#00f0ff', '#7b2bff'];
  return {
    id: CUSTOM_THEME_ID,
    name: 'Custom',
    colors: safe,
    css: `linear-gradient(135deg, ${safe.join(', ')})`,
  };
}

export function loadCustomTheme() {
  const data = readJSON(KEY, null);
  const colors = normalizeColors(data?.colors);
  return colors ? makeCustomTheme(colors) : null;
}

/** @param {string[]} colors */
export function saveCustomTheme(colors) {
  const theme = makeCustomTheme(colors);
  writeJSON(KEY, { colors: theme.colors });
  return theme;
}
