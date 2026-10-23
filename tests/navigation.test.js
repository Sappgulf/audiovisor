/** @vitest-environment jsdom */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createOverflowMenu } from '../src/overflow-menu.js';
import { createDrawerTabs } from '../src/drawer-tabs.js';
import { createModePicker } from '../src/mode-picker.js';
import { createDrawer } from '../src/drawer.js';
import { MODES, THEMES } from '../src/themes.js';

beforeEach(() => {
  document.open(); document.write(readFileSync('index.html', 'utf8')); document.close();
  localStorage.clear();
  window.matchMedia = vi.fn(() => ({ matches: window.innerWidth <= 640 }));
});
afterEach(() => vi.restoreAllMocks());
const key = (el, value) => el.dispatchEvent(new KeyboardEvent('keydown', { key: value, code: value, bubbles: true, cancelable: true }));

describe('More menu', () => {
  it('opens into its actions and navigates enabled tools with arrows, Home and End', () => {
    createOverflowMenu();
    const button = document.getElementById('more-btn');
    button.focus(); key(button, 'ArrowDown');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement.id).toBe('snapshot-btn');
    key(document.activeElement, 'End');
    expect(document.activeElement.id).toBe('add-more-btn');
    key(document.activeElement, 'ArrowDown');
    expect(document.activeElement.id).toBe('snapshot-btn');
    document.getElementById('record-btn').disabled = true;
    key(document.activeElement, 'ArrowDown');
    expect(document.activeElement.id).toBe('export-remix-btn');
    key(document.activeElement, 'Home');
    expect(document.activeElement.id).toBe('snapshot-btn');
    key(document.activeElement, 'Escape');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
    key(button, 'ArrowDown');
    key(document.activeElement, 'Tab');
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes when focus leaves without stealing the new focus', async () => {
    createOverflowMenu();
    document.getElementById('more-btn').click();
    document.getElementById('fullscreen-btn').focus();
    await Promise.resolve();
    expect(document.getElementById('more-menu').classList.contains('is-hidden')).toBe(true);
    expect(document.activeElement.id).toBe('fullscreen-btn');
  });
});

describe('visual navigation', () => {
  function picker() {
    return createModePicker({ modes: MODES, themes: THEMES, getModeId: () => 'bars', getThemeId: () => 'iris',
      onPickMode: vi.fn(), onPickTheme: vi.fn(), setToggle: (el, on, cls) => el?.classList.toggle(cls || 'is-on', on) });
  }
  it('scrolls the focused mode into view and moves the tab stop with it', () => {
    picker();
    const first = document.querySelector('[data-mode-id="bars"]');
    const last = document.querySelector('[data-mode-id="chladni"]');
    last.scrollIntoView = vi.fn();
    first.focus(); key(first, 'End');
    expect(document.activeElement).toBe(last);
    expect(last.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(last.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
    key(last, 'ArrowLeft');
    expect(document.activeElement.dataset.modeId).toBe('vinyl');
  });
  it('offers one theme tab stop and keyboard navigation across the palette', () => {
    const p = picker(); p.setActiveTheme('aurora');
    const dots = [...document.querySelectorAll('.theme-dot')];
    expect(dots.filter(el => el.tabIndex === 0)).toHaveLength(1);
    const selected = document.querySelector('[data-theme="aurora"]'); selected.focus();
    key(selected, 'End'); expect(document.activeElement).toBe(dots.at(-1));
    key(document.activeElement, 'Home'); expect(document.activeElement).toBe(dots[0]);
    expect(dots[0].tabIndex).toBe(0);
  });
  it('keeps still previews for reduced motion instead of downloading animation strips', () => {
    window.matchMedia = vi.fn(() => ({ matches: true })); picker();
    const card = document.querySelector('.mode-card'); card.dispatchEvent(new Event('pointerenter'));
    expect(card.dataset.animLoaded).toBeUndefined();
    expect(card.classList.contains('is-anim')).toBe(false);
  });
});

describe('drawer continuity', () => {
  it('remembers each tab scroll position and supports Home/End tab navigation', () => {
    const tabs = createDrawerTabs();const scroll = document.querySelector('.drawer-scroll');
    tabs.setDrawerTab('look'); scroll.scrollTop = 420;
    tabs.setDrawerTab('audio'); expect(scroll.scrollTop).toBe(0); scroll.scrollTop = 180;
    tabs.setDrawerTab('look'); expect(scroll.scrollTop).toBe(420);
    tabs.setDrawerTab('audio'); expect(scroll.scrollTop).toBe(180);
    key(document.getElementById('tab-audio'), 'Home'); expect(document.activeElement.id).toBe('tab-source');
    key(document.activeElement, 'End'); expect(document.activeElement.id).toBe('tab-studio');
  });
  it('releases the covered transport when an open phone sheet becomes a desktop panel', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    createDrawer({ state: { drawerOpen: true } });
    expect(document.querySelector('.transport').inert).toBe(true);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    window.dispatchEvent(new Event('resize'));
    expect(document.querySelector('.transport').inert).toBe(false);
    expect(document.getElementById('sheet-scrim').hidden).toBe(true);
  });
});
