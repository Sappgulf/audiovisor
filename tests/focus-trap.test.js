/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { createFocusTrap } from '../src/focus-trap.js';

const tab = (shiftKey = false) => new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });

describe('focus trap', () => {
  let root;
  let trap;

  beforeEach(() => {
    document.body.innerHTML = '<button id="before">before</button><div id="dialog"><button id="one">one</button><button id="two">two</button><button id="off" tabindex="-1">off</button><button id="disabled" disabled>disabled</button></div>';
    root = document.getElementById('dialog');
    trap = createFocusTrap(root);
    trap.activate();
  });

  it('wraps forward from the last control to the first', () => {
    document.getElementById('two').focus();
    root.dispatchEvent(tab());
    expect(document.activeElement.id).toBe('one');
  });

  it('wraps backward from the first control to the last', () => {
    document.getElementById('one').focus();
    root.dispatchEvent(tab(true));
    expect(document.activeElement.id).toBe('two');
  });

  it('pulls focus back in when it is outside the trap', () => {
    document.getElementById('before').focus();
    root.dispatchEvent(tab());
    expect(document.activeElement.id).toBe('one');
  });

  it('stops intercepting Tab after deactivate', () => {
    trap.deactivate();
    document.getElementById('two').focus();
    const e = tab();
    root.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(document.activeElement.id).toBe('two');
  });
});
