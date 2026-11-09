/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCommandPalette } from '../src/command-palette.js';

beforeEach(() => {
  document.body.innerHTML = '<div id="cmd-palette" class="cmd-palette is-hidden" aria-hidden="true"><input id="cmd-input"><div id="cmd-list"></div></div>';
});

function setup() {
  const bars = vi.fn();
  const brass = vi.fn();
  const palette = createCommandPalette({
    commands: [
      { label: 'Mode: Bars', action: bars, keys: 'bars mode' },
      { label: 'Theme: Brass', action: brass, keys: 'brass theme' },
    ],
  });
  return { palette, bars, brass };
}

describe('command palette', () => {
  it('opens, filters and runs the selected command', () => {
    const { palette, bars, brass } = setup();
    const input = document.getElementById('cmd-input');
    palette.open();
    expect(document.getElementById('cmd-palette').classList.contains('is-hidden')).toBe(false);
    expect(document.querySelectorAll('#cmd-list .cmd-item')).toHaveLength(2);
    input.value = 'brass';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(brass).toHaveBeenCalled();
    expect(bars).not.toHaveBeenCalled();
    expect(document.getElementById('cmd-palette').classList.contains('is-hidden')).toBe(true);
  });

  it('navigates with arrow keys and Home/End', () => {
    const { palette } = setup();
    const input = document.getElementById('cmd-input');
    palette.open();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    expect(document.getElementById('cmd-item-1').getAttribute('aria-selected')).toBe('true');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    expect(document.getElementById('cmd-item-0').getAttribute('aria-selected')).toBe('true');
  });

  it('puts aria-activedescendant on the focused combobox, not the listbox', () => {
    const { palette } = setup();
    const input = document.getElementById('cmd-input');
    palette.open();
    expect(input.getAttribute('aria-activedescendant')).toBe('cmd-item-0');
    expect(document.getElementById('cmd-list').hasAttribute('aria-activedescendant')).toBe(false);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(input.getAttribute('aria-activedescendant')).toBe('cmd-item-1');
  });

  it('shows an empty state and exposes the command count', () => {
    const { palette } = setup();
    const input = document.getElementById('cmd-input');
    palette.open();
    input.value = 'zzzz';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector('.cmd-empty')).toBeTruthy();
    expect(document.getElementById('cmd-status').textContent).toBe('No matches');
  });

  it('closes on Escape and restores focus', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const { palette } = setup();
    palette.open();
    document.getElementById('cmd-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.getElementById('cmd-palette').classList.contains('is-hidden')).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });
});
