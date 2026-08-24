/**
 * Command palette matching.
 *
 * Lives outside main.js because the filter used to be written twice — once
 * to render the list and once again inside the Enter handler. Any drift
 * between the two copies meant Enter fired a different command than the one
 * highlighted. One function, one result.
 */

export const PALETTE_DEFAULT_LIMIT = 12;

/**
 * @param {{label:string, keys:string}[]} cmds
 * @param {string} query empty query shows the first `limit` commands
 * @returns {object[]} the exact list the UI should render and index into
 */
export function filterCommands(cmds, query, limit = PALETTE_DEFAULT_LIMIT) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return cmds.slice(0, limit);
  return cmds.filter(
    (c) => c.label.toLowerCase().includes(q) || String(c.keys ?? '').toLowerCase().includes(q),
  );
}

/** Keep a highlighted index inside a list that just changed length. */
export function clampActive(index, length) {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}
