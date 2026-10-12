// @ts-check
/**
 * Tab focus for the queue and library dialogs. Loaded on the first open
 * (panels.js imports it), so the trap stays out of the entry bundle.
 *
 * Tab wraps inside whichever dialog is open, and a Tab pressed while focus
 * sits outside it (after a click on the page) pulls focus back in first.
 */

const TABBABLE = 'button:not([disabled]), input, [tabindex="0"]';

/** @type {HTMLElement[]} */
let dialogs = [];
let armed = false;

/**
 * @param {HTMLElement[]} panels the dialogs; the open one is the one not hidden
 */
export function setDialogs(panels) {
  dialogs = panels;
  if (armed) return;
  armed = true;
  document.addEventListener('keydown', (e) => {
    const panel = dialogs.find((p) => !p.classList.contains('is-hidden'));
    if (!panel || e.key !== 'Tab') return;
    const items = panel.querySelectorAll(TABBABLE);
    if (!items.length) return;
    const first = /** @type {HTMLElement} */ (items[0]);
    const last = /** @type {HTMLElement} */ (items[items.length - 1]);
    const active = document.activeElement;
    if (!(active instanceof Node) || !panel.contains(active)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });
}
