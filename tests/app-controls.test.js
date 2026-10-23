/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createControls } from '../src/controls.js';
import { createTransport } from '../src/transport.js';
import { createDrawerTabs } from '../src/drawer-tabs.js';
import { createModePicker } from '../src/mode-picker.js';
import { createKeyboardShortcuts } from '../src/keyboard.js';
import { MODES, THEMES } from '../src/themes.js';

const html = readFileSync('index.html', 'utf8');
const setToggle = (el, on, cls = 'is-on') => {
  el?.classList.toggle(cls, !!on);
  el?.setAttribute('aria-pressed', String(!!on));
};
beforeEach(() => {
  document.open(); document.write(html); document.close();
  localStorage.clear();
});

describe('audio controls', () => {
  function setup() {
    const engine = {
      setEq: vi.fn(), setFx: vi.fn(), setSmoothing: vi.fn(),
      volume: 0.65, playing: false, activeInput: 'none',
      setVolume: vi.fn((value) => { engine.volume = value; }),
      on: vi.fn(), getDuration: () => 0,
    };
    const renderer = {
      setSensitivity: vi.fn(), setBassFocus: vi.fn(), setColorPop: vi.fn(), setBloom: vi.fn(),
    };
    const saveSettings = vi.fn();
    const controls = createControls({ engine, renderer, getRay: () => renderer, state: { fx: {} },
      toast: vi.fn(), setToggle, saveSettings, doc: document });
    const transport = createTransport({ engine, getConnect: () => null, setToggle,
      saveSettings, toast: vi.fn(), openFilePicker: vi.fn(), doc: document });
    return { engine, renderer, controls, transport, saveSettings };
  }

  it('resets each visual slider through the live engine/renderer path', () => {
    const { controls, renderer, saveSettings } = setup();
    const input = controls.sliderEls.sensitivity;
    input.value = '2.4'; input.dispatchEvent(new Event('input'));
    expect(renderer.setSensitivity).toHaveBeenLastCalledWith(2.4);
    document.getElementById('sl-val-sensitivity').click();
    expect(input.value).toBe('1.4');
    expect(input.getAttribute('aria-valuetext')).toBe('x1.40');
    expect(renderer.setSensitivity).toHaveBeenLastCalledWith(1.4);
    expect(saveSettings).toHaveBeenCalledTimes(2);
  });

  it('flattens the real EQ values and updates every displayed band', () => {
    const { engine } = setup();
    const input = document.getElementById('eq-60');
    input.value = '6'; input.dispatchEvent(new Event('input'));
    expect(engine.setEq).toHaveBeenLastCalledWith(0, 6);
    document.getElementById('eq-reset').click();
    for (let index = 0; index < 5; index++) expect(engine.setEq).toHaveBeenCalledWith(index, 0);
    expect(input.value).toBe('0');
    expect(input.getAttribute('aria-valuetext')).toBe('0 dB');
    expect(document.getElementById('eq-60-value').textContent).toBe('0');
  });

  it('mutes and restores the last volume, including after keyboard adjustments', () => {
    const { engine, transport } = setup();
    const button = document.getElementById('mute-btn');
    button.click();
    expect(engine.volume).toBe(0);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    button.click();
    expect(engine.volume).toBe(0.65);
    transport.setVolumeUI(0.3);
    button.click(); button.click();
    expect(engine.volume).toBe(0.3);
    expect(button.getAttribute('aria-label')).toBe('Mute');
    expect(document.getElementById('volume-track').getAttribute('aria-valuetext')).toBe('30 percent');
  });

  it('does not let stage button interactions enter cinema mode', () => {
    setup();
    const fullscreen = vi.spyOn(document.getElementById('fullscreen-btn'), 'click');
    document.getElementById('stage-context').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(fullscreen).not.toHaveBeenCalled();
    document.getElementById('stage').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(fullscreen).toHaveBeenCalledOnce();
  });
});

describe('settings orientation', () => {
  it('keeps the drawer title paired with its selected tab', () => {
    const { setDrawerTab } = createDrawerTabs({ doc: document });
    setDrawerTab('audio');
    expect(document.getElementById('drawer-title').textContent).toBe('Tune the sound');
    expect(document.getElementById('tab-audio').getAttribute('aria-selected')).toBe('true');
    setDrawerTab('look');
    expect(document.getElementById('drawer-title').textContent).toBe('Shape the scene');
  });

  it('reports filter results and the selected theme alongside real previews', () => {
    const picker = createModePicker({ modes: MODES, themes: THEMES, getModeId: () => 'bars',
      getThemeId: () => 'iris', onPickMode: vi.fn(), onPickTheme: vi.fn(), setToggle, doc: document });
    const input = document.getElementById('mode-filter');
    input.value = 'neon'; input.dispatchEvent(new Event('input'));
    expect(document.getElementById('mode-count').textContent).toBe('1 / 24');
    expect(picker.getModeFilterCards()[0].dataset.modeId).toBe('city');
    picker.setActiveTheme('aurora');
    expect(document.getElementById('theme-current').textContent).toBe('Aurora');
    expect(document.querySelector('.mode-name').classList.contains('sr-only')).toBe(false);
  });

  it('leaves Space activation to a focused button instead of playing audio', () => {
    const toggle = vi.fn();
    createKeyboardShortcuts({ engine: {}, setVolumeUI: vi.fn(), transportToggle: toggle,
      setMode: vi.fn(), setTheme: vi.fn(), randomizeLook: vi.fn(), toast: vi.fn(), snapshot: vi.fn(),
      panels: {}, about: {}, getFxEl: vi.fn(), setFx: vi.fn(), getModeId: () => 'bars',
      getThemeId: () => 'iris', isTypingTarget: () => false, doc: document });
    const event = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true });
    document.getElementById('mute-btn').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(toggle).not.toHaveBeenCalled();
  });
});
