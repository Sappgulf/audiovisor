/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSettingsUI } from '../src/settings-ui.js';
import { saveCustomTheme, CUSTOM_THEME_KEY } from '../src/custom-theme.js';
import { SETTINGS_KEY } from '../src/settings.js';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = `
    <button id="settings-reset"></button>
    <button id="settings-export"></button>
    <button id="settings-import"></button>
    <input id="settings-file" type="file" />
  `;
});

function setup() {
  const state = { modeId: 'bars', themeId: 'custom', autopilot: false, raytraceWanted: true, rayQuality: 'high', fx: { reverb: true } };
  const engine = {
    volume: 0.65,
    loop: true,
    eqFilters: [0, 1, 2, 3, 4].map((v) => ({ gain: { value: v } })),
  };
  const sliderEls = {
    sensitivity: { value: '1.4' },
    bloom: { value: '0.5' },
  };
  const download = vi.fn();
  const toast = vi.fn();
  const location = { reload: vi.fn() };
  const ui = createSettingsUI({
    state,
    engine,
    sliderEls,
    eqFreqs: [60, 250, 1000, 4000, 12000],
    getAutoDj: () => false,
    vocab: { modeIds: [], themeIds: [], sliderIds: [], fxNames: [], rayQualities: [], eqBands: 5 },
    applySettings: vi.fn(),
    saveSettings: vi.fn(),
    download,
    toast,
    location,
  });
  return { ui, download, toast, location, state, engine };
}

describe('settings export/reset UI', () => {
  it('includes the custom palette in the serialized settings', () => {
    saveCustomTheme(['#112233', '#224466', '#336699', '#44aacc', '#66ddff']);
    const { ui } = setup();
    const out = ui.currentSettings();
    expect(out.customTheme).toEqual(['#112233', '#224466', '#336699', '#44aacc', '#66ddff']);
    expect(out.eq).toEqual([0, 1, 2, 3, 4]);
    expect(out.volume).toBe(0.65);
  });

  it('downloads settings as JSON', async () => {
    const { download } = setup();
    document.getElementById('settings-export').click();
    expect(download).toHaveBeenCalledTimes(1);
    const blob = download.mock.calls[0][0];
    const json = JSON.parse(await blob.text());
    expect(json.theme).toBe('custom');
  });

  it('reset clears settings and custom palette then reloads', () => {
    localStorage.setItem(SETTINGS_KEY, '{"mode":"bars"}');
    localStorage.setItem(CUSTOM_THEME_KEY, '{"colors":["#112233"]}');
    const { location } = setup();
    document.getElementById('settings-reset').click();
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
    expect(localStorage.getItem(CUSTOM_THEME_KEY)).toBeNull();
    expect(location.reload).toHaveBeenCalled();
  });
});
