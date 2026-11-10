// @ts-check
/**
 * Mode categories — the picker's coarse grouping.
 *
 * The ids mirror MODES in themes.js; the test suite fails when the two
 * drift apart. No DOM and no renderer here, so the grouping can be reused
 * by the picker, autopilot and search without pulling in the stage.
 */

export const MODE_CATEGORIES = [
  { id: 'spectral', label: 'Spectral' },
  { id: 'geometric', label: 'Geometric' },
  { id: 'organic', label: 'Organic' },
  { id: 'cosmic', label: 'Cosmic' },
  { id: 'instrument', label: 'Instrument' },
];

const MODES_BY_CATEGORY = {
  spectral: ['bars', 'waves', 'scope', 'spectro'],
  geometric: ['kaleido', 'tunnel', 'tensor', 'prism', 'chladni'],
  organic: ['particles', 'fluid', 'bloomfield', 'fractal', 'lava'],
  cosmic: ['terrain', 'city', 'nebula', 'spiral', 'orb', 'void', 'radar'],
  instrument: ['gpu', 'vinyl', 'plasma'],
};

const FALLBACK_CATEGORY = MODE_CATEGORIES[0].id;

/** @type {Record<string, string>} */
const CATEGORY_BY_MODE = Object.create(null);
for (const [category, ids] of Object.entries(MODES_BY_CATEGORY)) {
  for (const id of ids) CATEGORY_BY_MODE[id] = category;
}

/**
 * The category for a mode id. Unknown ids land in the first category so a
 * caller always gets something it can render.
 * @param {unknown} modeId
 * @returns {string}
 */
export function categoryOf(modeId) {
  if (typeof modeId !== 'string') return FALLBACK_CATEGORY;
  return CATEGORY_BY_MODE[modeId.trim()] || FALLBACK_CATEGORY;
}

/**
 * Filter a mode list down to one category, preserving its order and shape.
 * Strings come back as strings and MODES entries come back as entries.
 * @param {string} categoryId
 * @param {Array<string | {id: string}>} modes
 * @returns {Array<string | {id: string}>}
 */
export function modesInCategory(categoryId, modes) {
  if (!Array.isArray(modes)) return [];
  return modes.filter((mode) => {
    const id = typeof mode === 'string'
      ? mode
      : mode && typeof (/** @type {any} */ (mode).id) === 'string'
        ? /** @type {any} */ (mode).id
        : null;
    return id !== null && categoryOf(id) === categoryId;
  });
}
