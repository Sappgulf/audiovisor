/**
 * Look presets — pure read / validate / write for the three look slots.
 *
 * Split out of main.js for the same reason settings.js was: the rules that
 * decide what counts as a legal stored preset should be testable without a
 * DOM, and every path that recalls a slot should obey them. A preset saved
 * by an older build, or by a build with a mode that has since been removed,
 * used to be applied verbatim — setMode() would then be handed an id that
 * does not exist and the stage would sit on whatever it was already drawing.
 */
import { readJSON, writeJSON } from './storage.js';

export const PRESET_KEY = 'audiovisor.presets.v1';

/** The slots the UI offers. Stored keys are strings; callers pass numbers. */
export const PRESET_SLOTS = [1, 2, 3];

/** @returns {boolean} whether `slot` is one this build knows about */
export function isSlot(slot) {
  return PRESET_SLOTS.includes(Number(slot));
}

/**
 * Narrow one stored entry to something safe to apply.
 * @param {unknown} raw
 * @param {{modeIds: string[], themeIds: string[], fxNames: string[]}} vocab
 * @returns {{mode: string, theme: string, fx: Record<string, boolean>}|null}
 */
export function validatePreset(raw, vocab) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const mode = vocab.modeIds.includes(raw.mode) ? raw.mode : null;
  const theme = vocab.themeIds.includes(raw.theme) ? raw.theme : null;
  // a preset with neither a usable mode nor a usable theme cannot do anything
  if (!mode && !theme) return null;
  const fx = {};
  if (raw.fx && typeof raw.fx === 'object' && !Array.isArray(raw.fx)) {
    for (const name of vocab.fxNames) {
      if (name in raw.fx) fx[name] = !!raw.fx[name];
    }
  }
  return { mode, theme, fx };
}

/**
 * Every stored slot, validated. Unknown or corrupt slots are dropped rather
 * than surfaced, so the caller can treat a present key as applicable.
 * @returns {Record<string, {mode, theme, fx}>}
 */
export function readPresets(vocab) {
  const raw = readJSON(PRESET_KEY, null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const slot of PRESET_SLOTS) {
    const p = validatePreset(raw[slot], vocab);
    if (p) out[slot] = p;
  }
  return out;
}

/**
 * Store one slot, leaving the others untouched.
 * @returns {boolean} whether the write actually landed
 */
export function writePreset(slot, preset, vocab) {
  if (!isSlot(slot)) return false;
  const valid = validatePreset(preset, vocab);
  if (!valid) return false;
  const all = readJSON(PRESET_KEY, null);
  const next = (all && typeof all === 'object' && !Array.isArray(all)) ? { ...all } : {};
  next[Number(slot)] = valid;
  return writeJSON(PRESET_KEY, next);
}
