// @ts-check
/**
 * Toast notifications.
 *
 * Pulled out of main.js so the stack's lifecycle — append, animate in,
 * animate out, cap the pile — lives in one place that can be exercised
 * without booting the whole app. The caller owns the root element, which
 * keeps this free of any assumption about the page's markup.
 */

const LEAVE_MS = 350;
const MAX_VISIBLE = 3;

/**
 * @param {HTMLElement} root  container the toasts are appended to
 * @returns {(msg: string, opts?: { duration?: number }) => void}
 */
export function createToasts(root) {
  return function toast(msg, opts = {}) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = msg;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));
    setTimeout(() => {
      el.classList.remove('is-visible');
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), LEAVE_MS);
    }, opts.duration || 2400);
    while (root.children.length > MAX_VISIBLE) root.firstChild.remove();
  };
}
