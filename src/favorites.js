// @ts-check
/**
 * Favorites — the modes a listener stars, plus the autopilot playlist built
 * from them.
 *
 * localStorage is untrusted here: it can be absent, blocked in private
 * browsing, full, or hand-edited into any JSON shape. Reads and writes go
 * through storage.js and every value is narrowed before it leaves this
 * module, so a broken key costs the list and nothing else.
 */
import { readJSON, writeJSON, remove } from './storage.js';

export const FAVORITES_KEY = 'audiovisor.favorite.modes.v1';
export const MAX_FAVORITES = 64;

const MAX_ID_LENGTH = 64;

/**
 * Narrow untrusted storage to unique, non-empty mode ids.
 * @param {unknown} raw
 * @returns {string[]}
 */
function sanitizeFavorites(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const id = entry.trim();
    if (!id || id.length > MAX_ID_LENGTH || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_FAVORITES) break;
  }
  return out;
}

/** @param {unknown} mode @returns {string | null} */
function modeIdOf(mode) {
  const raw = typeof mode === 'string'
    ? mode
    : mode && typeof (/** @type {any} */ (mode).id) === 'string'
      ? /** @type {any} */ (mode).id
      : null;
  if (raw === null) return null;
  const id = raw.trim();
  return id || null;
}

/** @returns {string[]} the stored favorites, always a clean string list */
export function getFavorites() {
  return sanitizeFavorites(readJSON(FAVORITES_KEY, []));
}

/** @param {unknown} id @returns {boolean} */
export function isFavorite(id) {
  if (typeof id !== 'string') return false;
  const clean = id.trim();
  return !!clean && getFavorites().includes(clean);
}

/**
 * Replace the whole list. Invalid entries are dropped and the write is
 * allowed to fail without throwing.
 * @param {unknown} ids
 * @returns {string[]} the sanitized list that was offered to storage
 */
export function setFavorites(ids) {
  const clean = sanitizeFavorites(ids);
  writeJSON(FAVORITES_KEY, clean);
  return clean;
}

/**
 * Add an id if absent, remove it if present.
 * @param {unknown} id
 * @returns {string[]} the resulting list
 */
export function toggleFavorite(id) {
  if (typeof id !== 'string') return getFavorites();
  const clean = id.trim();
  if (!clean) return getFavorites();
  const current = getFavorites();
  const next = current.includes(clean)
    ? current.filter((favorite) => favorite !== clean)
    : [...current, clean];
  return setFavorites(next);
}

/** Forget every favorite. @returns {string[]} */
export function clearFavorites() {
  remove(FAVORITES_KEY);
  return [];
}

/**
 * The list autopilot should cycle.
 *
 * A listener with favorites hears only those; a listener without any hears
 * the full list their caller supplied. Stale ids from an older build are
 * ignored, and if every favorite is stale the supplied list wins again.
 *
 * @param {Array<string | {id: string}>} modes full mode list, ids or MODES entries
 * @returns {string[]} mode ids in play
 */
export function getCuratedAutopilot(modes) {
  if (!Array.isArray(modes)) return [];
  const available = [];
  const allowed = new Set();
  for (const mode of modes) {
    const id = modeIdOf(mode);
    if (!id || allowed.has(id)) continue;
    allowed.add(id);
    available.push(id);
  }
  const favorites = getFavorites().filter((id) => allowed.has(id));
  return favorites.length ? favorites : available;
}
