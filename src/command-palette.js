// @ts-check
import { filterCommands, clampActive } from './palette.js';
import { esc } from './utils.js';

/**
 * Command palette (⌘/Ctrl + K).
 *
 * The command list is built by main.js because every entry is a closure over
 * app state; this module owns only the listbox, filtering, roving selection
 * and focus return.
 *
 * @param {object} deps
 * @param {Array<{label: string, action: Function, keys?: string}>} deps.commands
 * @param {Document} [deps.doc]
 */
export function createCommandPalette({ commands, doc = document }) {
  const palette = doc.getElementById('cmd-palette');
  const input = doc.getElementById('cmd-input');
  const list = doc.getElementById('cmd-list');
  const status = doc.createElement('div');
  status.className = 'cmd-status';
  status.id = 'cmd-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  list?.insertAdjacentElement('afterend', status);
  input?.setAttribute('role', 'combobox');
  input?.setAttribute('aria-controls', 'cmd-list');
  input?.setAttribute('aria-autocomplete', 'list');
  input?.setAttribute('aria-expanded', 'false');
  input?.setAttribute('aria-describedby', 'cmd-status');

  let active = 0;
  let returnFocus = null;
  /** The list currently on screen — what Enter must index into. */
  let visible = [];

  function render(filter = '') {
    visible = filterCommands(commands, filter);
    active = clampActive(active, visible.length);
    const count = visible.length;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Commands');
    list.innerHTML = count
      ? visible
        .map((c, i) => `<div class="cmd-item ${i === active ? 'is-active' : ''}" id="cmd-item-${i}" role="option" aria-selected="${i === active}" tabindex="-1" data-i="${i}"><span>${esc(c.label)}</span><kbd>↵</kbd></div>`)
        .join('')
      : '<div class="cmd-empty">No matches</div>';
    if (count) list.setAttribute('aria-activedescendant', `cmd-item-${active}`);
    else list.removeAttribute('aria-activedescendant');
    status.textContent = count ? `${count} commands available` : 'No matches';
    input?.setAttribute('aria-expanded', String(Boolean(count)));
  }

  function open() {
    returnFocus = doc.activeElement;
    palette.classList.remove('is-hidden');
    palette.setAttribute('aria-hidden', 'false');
    input.value = '';
    active = 0;
    render('');
    input.focus();
  }

  function close() {
    if (palette.contains(doc.activeElement)) doc.activeElement.blur();
    palette.classList.add('is-hidden');
    palette.setAttribute('aria-hidden', 'true');
    input?.setAttribute('aria-expanded', 'false');
    const restore = returnFocus;
    returnFocus = null;
    restore?.focus?.();
  }

  function toggle() {
    if (palette.classList.contains('is-hidden')) open();
    else close();
  }

  list?.addEventListener('click', (e) => {
    const item = e.target.closest('.cmd-item');
    if (!item) return;
    const c = visible[Number(item.dataset.i)];
    if (c) { c.action(); close(); }
  });
  palette?.addEventListener('click', (e) => { if (e.target === palette) close(); });
  input?.addEventListener('input', () => { active = 0; render(input.value); });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = clampActive(active + 1, visible.length); render(input.value); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = clampActive(active - 1, visible.length); render(input.value); }
    else if (e.key === 'Home') { e.preventDefault(); active = 0; render(input.value); }
    else if (e.key === 'End') { e.preventDefault(); active = Math.max(visible.length - 1, 0); render(input.value); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = visible[active]; if (c) { c.action(); close(); } }
    else if (e.key === 'Escape') close();
  });
  doc.defaultView?.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); toggle(); }
    if (e.key === 'Escape' && !palette.classList.contains('is-hidden')) close();
  });

  return { open, close, toggle };
}
