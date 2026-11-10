/** @vitest-environment jsdom */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createOverflowMenu } from '../src/overflow-menu.js';
import { createDrawerTabs } from '../src/drawer-tabs.js';
import { createModePicker } from '../src/mode-picker.js';
import { createDrawer } from '../src/drawer.js';
import { categoryOf } from '../src/mode-categories.js';
import { MODES, THEMES } from '../src/themes.js';

const innerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
beforeEach(() => {
  document.open(); document.write(readFileSync('index.html', 'utf8')); document.close();
  localStorage.clear();
  window.matchMedia = vi.fn(() => ({ matches: window.innerWidth <= 640 }));
});
afterEach(() => {
  vi.restoreAllMocks();
  /* tests that simulate a phone redefine this property; put the original
     descriptor back so later tests see jsdom's real viewport */
  if (innerWidthDescriptor) Object.defineProperty(window, 'innerWidth', innerWidthDescriptor);
  else delete window.innerWidth;
});
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

  it('survives the transient body focus of a pointer press on a later action', async () => {
    createOverflowMenu();
    document.getElementById('more-btn').click();
    const snapshot = document.getElementById('snapshot-btn');
    const record = document.getElementById('record-btn');
    snapshot.dispatchEvent(new FocusEvent('focusout', {
      bubbles: true,
      relatedTarget: record,
    }));
    document.body.focus();
    await Promise.resolve();
    expect(document.getElementById('more-menu').classList.contains('is-hidden')).toBe(false);
  });
});

describe('visual navigation', () => {
  function picker() {
    const p = createModePicker({ modes: MODES, themes: THEMES, getModeId: () => 'bars', getThemeId: () => 'iris',
      onPickMode: vi.fn(), onPickTheme: vi.fn(), setToggle: (el, on, cls) => el?.classList.toggle(cls || 'is-on', on) });
    p.ensureModes();
    return p;
  }
  it('builds the mode grid only when asked', () => {
    createModePicker({ modes: MODES, themes: THEMES, getModeId: () => 'bars', getThemeId: () => 'iris',
      onPickMode: vi.fn(), onPickTheme: vi.fn(), setToggle: vi.fn() });
    expect(document.querySelectorAll('[data-mode-id]')).toHaveLength(0);
  });

  it('clears the mode filter on Escape without dropping focus', () => {
    picker();
    const filter = document.getElementById('mode-filter');
    filter.value = 'bars';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    filter.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    filter.dispatchEvent(ev);
    expect(filter.value).toBe('');
    expect(document.activeElement).toBe(filter);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('lets Escape through when the mode filter is already empty', () => {
    picker();
    const filter = document.getElementById('mode-filter');
    filter.value = '';
    filter.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    filter.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('filters the mode grid by favorites and category', () => {
    let onlyFavorites = true;
    let category = null;
    const p = createModePicker({
      modes: MODES,
      themes: THEMES,
      getModeId: () => 'bars',
      getThemeId: () => 'iris',
      onPickMode: vi.fn(),
      onPickTheme: vi.fn(),
      setToggle: (el, on, cls) => el?.classList.toggle(cls || 'is-on', on),
      isFavorite: (id) => id === 'bars' || id === 'fractal',
      favoritesOnly: () => onlyFavorites,
      categoryFilter: () => category,
    });
    p.ensureModes();
    p.applyModeFilter();
    expect([...document.querySelectorAll('.mode-card:not(.is-filtered)')]
      .map((el) => el.dataset.modeId)).toEqual(['bars', 'fractal']);
    onlyFavorites = false;
    category = 'cosmic';
    p.applyModeFilter();
    expect([...document.querySelectorAll('.mode-card:not(.is-filtered)')]
      .map((el) => el.dataset.modeId))
      .toEqual(MODES.filter((m) => categoryOf(m.id) === 'cosmic').map((m) => m.id));
  });

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
  it('previews a mode on pointerdown and focus for touch and keyboard users', () => {
    const onPreviewMode = vi.fn();
    const p = createModePicker({ modes: MODES, themes: THEMES, getModeId: () => 'bars', getThemeId: () => 'iris',
      onPickMode: vi.fn(), onPickTheme: vi.fn(), setToggle: vi.fn(), onPreviewMode });
    p.ensureModes();
    const card = document.querySelector('[data-mode-id="city"]');
    card.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(onPreviewMode).toHaveBeenCalledWith('city');
    card.focus();
    expect(onPreviewMode).toHaveBeenCalledTimes(2);
  });

  it('keeps still previews for reduced motion instead of downloading animation strips', () => {
    window.matchMedia = vi.fn(() => ({ matches: true })); picker();
    const card = document.querySelector('.mode-card'); card.dispatchEvent(new Event('pointerenter'));
    expect(card.dataset.animLoaded).toBeUndefined();
    expect(card.classList.contains('is-anim')).toBe(false);
  });
});

describe('drawer layering and focus', () => {
  it('makes the page behind a phone sheet inert', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const state = { drawerOpen: true };
    const drawer = createDrawer({ state });
    expect(document.querySelector('.topbar').inert).toBe(true);
    expect(document.querySelector('.stage').inert).toBe(true);
    expect(document.querySelector('.transport').inert).toBe(true);
    expect(document.querySelector('.skip-link').inert).toBe(true);
    expect(document.getElementById('drawer').inert).toBe(false);
    document.getElementById('drawer').inert = false;
    drawer.setDrawerOpen(false);
    expect(document.querySelector('.topbar').inert).toBe(false);
    expect(document.querySelector('.stage').inert).toBe(false);
    expect(document.querySelector('.transport').inert).toBe(false);
  });

  it('does not close when an inner surface already consumed Escape', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    const state = { drawerOpen: true };
    createDrawer({ state });
    document.body.addEventListener('keydown', (e) => e.preventDefault(), { once: true });
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.getElementById('drawer').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(state.drawerOpen).toBe(true);
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
