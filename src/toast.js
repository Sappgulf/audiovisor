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
const SAFE_TAGS = new Set(['B']);
const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META']);

/**
 * Toast markup is deliberately tiny: bold emphasis only. Callers still pass
 * provider names and browser error text, and one missed escape used to be a
 * script injection. Parse the message, strip every attribute, unwrap unknown
 * elements to text, and drop executable containers entirely.
 *
 * @param {unknown} msg
 * @param {Document} doc
 */
export function sanitizeToast(msg, doc = document) {
  const tpl = doc.createElement('template');
  tpl.innerHTML = String(msg ?? '');
  for (const el of [...tpl.content.querySelectorAll('*')]) {
    if (DROP_TAGS.has(el.tagName)) { el.remove(); continue; }
    if (!SAFE_TAGS.has(el.tagName)) {
      el.replaceWith(...el.childNodes);
      continue;
    }
    for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
  }
  return tpl.innerHTML;
}

/**
 * @param {HTMLElement} root  container the toasts are appended to
 * @returns {(msg: string, opts?: { duration?: number }) => void}
 */
export function createToasts(root) {
  const doc = root.ownerDocument || document;
  return function toast(msg, opts = {}) {
    const el = doc.createElement('div');
    el.className = 'toast';
    el.innerHTML = sanitizeToast(msg, doc);
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
