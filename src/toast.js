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
 * Put a message into an element. Callers write emphasis as <b>…</b>, and
 * some interpolate names taken from files or remote errors. So the message is
 * parsed inertly (a template runs no script and loads no image), only <b>
 * survives, and every other tag is reduced to its text.
 *
 * @param {HTMLElement} el
 * @param {string} msg
 */
export function renderToastText(el, msg) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(msg);
  for (const node of tpl.content.childNodes) {
    if (node.nodeName === 'B') {
      const b = document.createElement('b');
      b.textContent = node.textContent;
      el.append(b);
    } else {
      el.append(node.textContent || '');
    }
  }
}

/**
 * @param {HTMLElement} root  container the toasts are appended to
 * @returns {(msg: string, opts?: { duration?: number }) => void}
 */
export function createToasts(root) {
  return function toast(msg, opts = {}) {
    const el = document.createElement('div');
    el.className = 'toast';
    renderToastText(el, msg);
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));
    setTimeout(() => {
      el.classList.remove('is-visible');
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), LEAVE_MS);
    }, opts.duration || 2400);
    while (root.children.length > MAX_VISIBLE) root.firstElementChild?.remove();
  };
}
