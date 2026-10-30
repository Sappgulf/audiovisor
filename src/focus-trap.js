// @ts-check
/**
 * Keep Tab inside a modal-ish surface.
 *
 * The command palette and keyboard-shortcut overlay both declare
 * aria-modal="true"; without a trap, Tab could walk into the page behind
 * them. Only focusable children are considered, so the palette's listbox
 * options (tabindex="-1") do not become extra tab stops.
 *
 * @param {HTMLElement} root
 * @param {Document} [doc]
 */
export function createFocusTrap(root, doc = document) {
  const SELECTOR = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  function focusable() {
    return [...root.querySelectorAll(SELECTOR)].filter((el) => {
      const node = /** @type {HTMLElement} */ (el);
      return node.tabIndex >= 0 && !node.hidden;
    });
  }

  function onKeydown(e) {
    if (e.key !== 'Tab') return;
    const nodes = focusable();
    if (!nodes.length) {
      e.preventDefault();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = doc.activeElement;
    if (!root.contains(active)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return {
    activate() { root.addEventListener('keydown', onKeydown); },
    deactivate() { root.removeEventListener('keydown', onKeydown); },
  };
}
