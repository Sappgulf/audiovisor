/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createKeyboardShortcuts } from '../src/keyboard.js';

const isTypingTarget = (el) => Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'));

function setup() {
  document.body.innerHTML = `
    <button id="chip">CHIP</button>
    <div id="seek" role="slider" tabindex="0"></div>
    <input id="field" />`;
  const deps = {
    engine: { skip: vi.fn(), volume: 0.5 },
    setVolumeUI: vi.fn(),
    transportToggle: vi.fn(),
    setMode: vi.fn(),
    setTheme: vi.fn(),
    randomizeLook: vi.fn(),
    toast: vi.fn(),
    snapshot: vi.fn(),
    panels: { isQueueOpen: () => false, isLibraryOpen: () => false, toggleQueue: vi.fn(), toggleLibrary: vi.fn() },
    about: { isOpen: () => false, setOpen: vi.fn() },
    getFxEl: () => undefined,
    setFx: vi.fn(),
    getModeId: () => 'bars',
    getThemeId: () => 'iris',
    isTypingTarget,
  };
  createKeyboardShortcuts(deps);
  return deps;
}

function press(target, key, code, opts = {}) {
  const e = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...opts });
  target.dispatchEvent(e);
  return e;
}

describe('global keyboard shortcuts', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('plays or pauses on Space from the page', () => {
    const deps = setup();
    press(document.body, ' ', 'Space');
    expect(deps.transportToggle).toHaveBeenCalledTimes(1);
  });

  it('leaves Space to a focused button instead of also toggling playback', () => {
    const deps = setup();
    press(document.getElementById('chip'), ' ', 'Space');
    expect(deps.transportToggle).not.toHaveBeenCalled();
  });

  it('leaves every key to the open shortcuts sheet except Escape', () => {
    const deps = setup();
    const sheet = document.createElement('div');
    sheet.id = 'shortcuts-overlay';
    document.body.appendChild(sheet);
    sheet.classList.remove('is-hidden');
    // non-cancelable, so a listener left on window by an earlier test cannot
    // mark the key as handled and hide this check
    press(document.body, ' ', 'Space', { cancelable: false });
    press(document.body, 'r', 'KeyR', { cancelable: false });
    expect(deps.transportToggle).not.toHaveBeenCalled();
    expect(deps.randomizeLook).not.toHaveBeenCalled();
    sheet.classList.add('is-hidden');
    press(document.body, ' ', 'Space', { cancelable: false });
    expect(deps.transportToggle).toHaveBeenCalledTimes(1);
  });

  it('ignores browser and OS chords such as Cmd+R and Ctrl+F', () => {
    const deps = setup();
    press(document.body, 'r', 'KeyR', { metaKey: true });
    press(document.body, 'f', 'KeyF', { ctrlKey: true });
    expect(deps.randomizeLook).not.toHaveBeenCalled();
    expect(deps.engine.skip).not.toHaveBeenCalled();
  });

  it('does not run a second time for an arrow a control already handled', () => {
    const deps = setup();
    // stands in for the seek bar's own keydown, which calls preventDefault
    document.getElementById('seek').addEventListener('keydown', (e) => e.preventDefault());
    press(document.getElementById('seek'), 'ArrowRight', 'ArrowRight');
    expect(deps.engine.skip).not.toHaveBeenCalled();
  });

  it('still seeks on a bare arrow from the page', () => {
    const deps = setup();
    press(document.body, 'ArrowRight', 'ArrowRight');
    expect(deps.engine.skip).toHaveBeenCalledWith(10);
  });
  it('leaves arrows to a focused range input instead of seeking the track', () => {
    const deps = setup();
    const eq = document.createElement('input');
    eq.type = 'range';
    document.body.appendChild(eq);
    eq.focus();
    press(eq, 'ArrowLeft', 'ArrowLeft');
    press(eq, 'ArrowRight', 'ArrowRight', { shiftKey: true });
    expect(deps.engine.skip).not.toHaveBeenCalled();
  });

  it('leaves arrows to a focused slider role instead of seeking the track', () => {
    const deps = setup();
    press(document.getElementById('seek'), 'ArrowRight', 'ArrowRight');
    expect(deps.engine.skip).not.toHaveBeenCalled();
  });

  it('still seeks on arrows when focus is on plain page content', () => {
    const deps = setup();
    press(document.getElementById('chip'), 'ArrowRight', 'ArrowRight');
    expect(deps.engine.skip).toHaveBeenCalledWith(10);
  });
});
