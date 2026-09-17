/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createShortcutsOverlay } from '../src/shortcuts.js';

const isTypingTarget = (el) => Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'));

function press(key, opts = {}) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  (opts.target || window).dispatchEvent(e);
  return e;
}

describe('createShortcutsOverlay', () => {
  let overlay;
  let grid;
  let controls;

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="help-btn"></button>
      <div id="shortcuts-overlay" class="is-hidden" aria-hidden="true">
        <div id="shortcuts-grid"></div>
        <button id="shortcuts-close"></button>
      </div>`;
    overlay = document.getElementById('shortcuts-overlay');
    grid = document.getElementById('shortcuts-grid');
    controls = createShortcutsOverlay({ isTypingTarget });
  });

  it('renders the shortcut groups into the grid', () => {
    expect(grid.querySelectorAll('.shortcuts-group')).toHaveLength(3);
    expect(grid.textContent).toContain('Transport');
    expect(grid.textContent).toContain('Panels');
  });

  it('opens from the help button and closes from the close button', () => {
    document.getElementById('help-btn').click();
    expect(controls.overlay.classList.contains('is-hidden')).toBe(false);
    document.getElementById('shortcuts-close').click();
    expect(controls.overlay.classList.contains('is-hidden')).toBe(true);
  });

  it('opens on ? and closes on Escape', () => {
    press('?');
    expect(controls.overlay.classList.contains('is-hidden')).toBe(false);
    expect(overlay.getAttribute('aria-hidden')).toBe('false');
    press('Escape');
    expect(controls.overlay.classList.contains('is-hidden')).toBe(true);
  });

  it('opens on / without shift but not with it', () => {
    press('/', { shiftKey: true });
    expect(controls.overlay.classList.contains('is-hidden')).toBe(true);
    press('/');
    expect(controls.overlay.classList.contains('is-hidden')).toBe(false);
  });

  it('ignores the shortcut while typing', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('?', { target: input });
    expect(controls.overlay.classList.contains('is-hidden')).toBe(true);
  });

  it('closes from the scrim', () => {
    controls.toggle(true);
    controls.overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(controls.overlay.classList.contains('is-hidden')).toBe(true);
  });
});
