/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createAboutPanel } from '../src/about.js';

describe('createAboutPanel', () => {
  let shell;
  let trigger;
  let about;

  beforeEach(() => {
    document.body.innerHTML = '<div id="shell"></div><button id="nav-about"></button>';
    shell = document.getElementById('shell');
    trigger = document.getElementById('nav-about');
    about = createAboutPanel({ shell, trigger, modeCount: 22, themeCount: 25 });
  });

  it('appends the dialog to the shell, hidden and inert', () => {
    expect(shell.contains(about.panel)).toBe(true);
    expect(about.panel.id).toBe('about-panel');
    expect(about.panel.hidden).toBe(true);
    expect(about.panel.inert).toBe(true);
    expect(about.isOpen()).toBe(false);
  });

  it('reflects the live mode and theme counts in the copy', () => {
    expect(about.panel.textContent).toContain('22 stage modes');
    expect(about.panel.textContent).toContain('25 theme moods');
  });

  it('opens from the nav trigger and reports it', () => {
    trigger.click();
    expect(about.isOpen()).toBe(true);
    expect(about.panel.hidden).toBe(false);
    expect(about.panel.inert).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('toggles closed on the second trigger click', () => {
    trigger.click();
    trigger.click();
    expect(about.isOpen()).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape', () => {
    trigger.click();
    about.panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(about.isOpen()).toBe(false);
  });

  it('closes on a scrim click', () => {
    trigger.click();
    about.panel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(about.isOpen()).toBe(false);
  });

  it('closes from the close button', () => {
    trigger.click();
    about.panel.querySelector('.about-close').click();
    expect(about.isOpen()).toBe(false);
  });
});
