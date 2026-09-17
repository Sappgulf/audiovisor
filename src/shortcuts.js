// @ts-check
/**
 * Keyboard-shortcuts overlay.
 *
 * The shortcut list is data, not markup: it drives both the generated grid
 * and the help affordance. Opening is `?` or `?`/`/`, closing is Escape or a
 * click on the scrim; focus is returned to wherever it came from.
 */

/** @type {Array<[string, Array<[string, string]>]>} */
const SHORTCUTS = [
  ['Transport', [
    ['Play / pause', 'Space'],
    ['Seek ±10s', '← / →'],
    ['Fine seek ±3s', 'Shift + ← / →'],
    ['Volume', '↑ / ↓'],
    ['Volume (stage)', 'Scroll wheel'],
  ]],
  ['Look', [
    ['Next stage mode', 'M'],
    ['Next theme', 'T'],
    ['Random look', 'R'],
    ['Jump to mode 1–9', '1 … 9'],
    ['Chop N Screwed FX', 'C'],
  ]],
  ['Panels', [
    ['Command palette', '⌘ / Ctrl + K'],
    ['Keyboard shortcuts', '?'],
    ['Library', 'L'],
    ['Queue', 'Q'],
    ['Cinema fullscreen', 'F'],
    ['Share card (PNG)', 'P'],
    ['Close any panel', 'Esc'],
  ]],
];

/**
 * @param {object} opts
 * @param {(el: EventTarget | null) => boolean} opts.isTypingTarget
 * @param {Document} [opts.doc]
 */
export function createShortcutsOverlay({ isTypingTarget, doc = document }) {
  const overlay = doc.getElementById('shortcuts-overlay');
  const grid = doc.getElementById('shortcuts-grid');
  let returnFocus = null;

  if (grid) {
    grid.innerHTML = SHORTCUTS.map(([group, rows]) =>
      `<div class="shortcuts-group">${group}</div>` +
      rows.map(([label, key]) => `<div class="shortcut-row"><span>${label}</span><kbd>${key}</kbd></div>`).join('')
    ).join('');
  }

  function toggle(force) {
    if (!overlay) return;
    const hidden = overlay.classList.contains('is-hidden');
    const open = force === undefined ? hidden : force;
    if (open) returnFocus = doc.activeElement;
    else if (overlay.contains(doc.activeElement)) doc.activeElement.blur();
    overlay.classList.toggle('is-hidden', !open);
    overlay.setAttribute('aria-hidden', String(!open));
    if (open) doc.getElementById('shortcuts-close')?.focus();
    else {
      const restore = returnFocus;
      returnFocus = null;
      restore?.focus?.();
    }
  }

  doc.getElementById('help-btn')?.addEventListener('click', () => toggle());
  doc.getElementById('shortcuts-close')?.addEventListener('click', () => toggle(false));
  overlay?.addEventListener('click', (e) => { if (e.target === overlay) toggle(false); });

  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  win?.addEventListener('keydown', (e) => {
    if (!isTypingTarget(e.target) && (e.key === '?' || (e.key === '/' && !e.shiftKey))) {
      e.preventDefault();
      toggle();
    } else if (e.key === 'Escape') {
      toggle(false);
    }
  });

  return { toggle, overlay };
}
