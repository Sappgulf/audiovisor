/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLookPresets } from '../src/look-presets.js';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="presets"></div>';
});

function setup() {
  const state = { modeId: 'bars', themeId: 'iris', fx: { reverb: true, echo: false } };
  const setMode = vi.fn();
  const setTheme = vi.fn();
  const setFx = vi.fn();
  const saveSettings = vi.fn();
  const toast = vi.fn();
  const presets = createLookPresets({
    state,
    fxNames: ['reverb', 'echo'],
    toast,
    setMode,
    setTheme,
    setFx,
    saveSettings,
    row: document.getElementById('presets'),
  });
  return { state, setMode, setTheme, setFx, saveSettings, toast, presets };
}

describe('look presets', () => {
  it('saves the current look and recalls every field', () => {
    const { presets, setMode, setTheme, setFx, saveSettings } = setup();
    expect(presets.savePreset(1)).toBe(true);
    presets.loadPreset(1);
    expect(setMode).toHaveBeenCalledWith('bars');
    expect(setTheme).toHaveBeenCalledWith('iris');
    expect(setFx).toHaveBeenCalledWith('reverb', true);
    expect(setFx).toHaveBeenCalledWith('echo', false);
    expect(saveSettings).toHaveBeenCalled();
  });

  it('does nothing for an empty slot', () => {
    const { presets, setMode, toast } = setup();
    presets.loadPreset(2);
    expect(setMode).not.toHaveBeenCalled();
    expect(toast.mock.calls[0][0]).toContain('empty');
  });

  it('builds the row, saves on right-click and repaints the slot', () => {
    const { presets } = setup();
    const slot = document.querySelector('[data-slot="1"]');
    expect(slot).toBeTruthy();
    slot.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(slot.classList.contains('is-active')).toBe(true);
    expect(slot.title).toContain('Recall');
    slot.click();
    expect(presets).toBeTruthy();
  });
});
