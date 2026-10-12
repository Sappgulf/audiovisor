/**
 * @vitest-environment jsdom
 *
 * Settings drawer: the Reduce flashing toggle and the import path. Import is
 * the one place untrusted files reach the app, so its bounds are checked here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSettingsUI } from '../src/settings-ui.js';

const VOCAB = {
  modeIds: ['bars', 'tunnel'],
  themeIds: ['brass', 'ice'],
  sliderIds: ['sensitivity'],
  fxNames: ['reverb'],
  rayQualities: ['low', 'high'],
  eqBands: 5,
};

let state, applySettings, saveSettings, toast, setReduceFlashing, input, ui;

function mount() {
  document.body.innerHTML = `
    <div class="fx-row">
      <button id="settings-export"></button>
      <button id="settings-import"></button>
      <button id="settings-reset"></button>
      <input type="file" id="settings-file" hidden />
    </div>`;
  input = document.getElementById('settings-file');
  ui = createSettingsUI({
    state,
    engine: { volume: 0.5, loop: false, eqFilters: [] },
    sliderEls: {},
    eqFreqs: [],
    getAutoDj: () => false,
    vocab: VOCAB,
    applySettings,
    saveSettings,
    download: vi.fn(),
    toast,
    setReduceFlashing,
    location: { reload: vi.fn() },
  });
}

/** Pick a file the way the browser does, then let the reader settle. */
async function pick(file) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
  await new Promise((r) => setTimeout(r, 0));
  await vi.waitFor(() => expect(toast.mock.calls.length + applySettings.mock.calls.length).toBeGreaterThan(0));
}

beforeEach(() => {
  state = { modeId: 'bars', themeId: 'brass', autopilot: false, raytraceWanted: true, rayQuality: 'high', fx: {}, reduceFlashing: false };
  applySettings = vi.fn();
  saveSettings = vi.fn();
  toast = vi.fn();
  setReduceFlashing = vi.fn((on) => { state.reduceFlashing = on; });
  mount();
});

describe('Reduce flashing toggle', () => {
  it('sits in the settings tools row, ahead of Export', () => {
    const chip = document.getElementById('reduce-flashing-chip');
    expect(chip).not.toBeNull();
    expect(chip.parentElement.firstElementChild).toBe(chip);
    expect(chip.textContent).toContain('Reduce flashing');
  });

  it('reports its state to assistive tech', () => {
    expect(document.getElementById('reduce-flashing-chip').getAttribute('aria-pressed')).toBe('false');
  });

  it('asks for the opposite of the current choice when pressed', () => {
    document.getElementById('reduce-flashing-chip').click();
    expect(setReduceFlashing).toHaveBeenCalledWith(true);
    const chip = document.getElementById('reduce-flashing-chip');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(chip.classList.contains('is-on')).toBe(true);
  });

  it('starts pressed when the stored choice is on', () => {
    document.body.innerHTML = '';
    state.reduceFlashing = true;
    mount();
    expect(document.getElementById('reduce-flashing-chip').getAttribute('aria-pressed')).toBe('true');
  });

  it('is included in an export', () => {
    state.reduceFlashing = true;
    expect(ui.currentSettings().reduceFlashing).toBe(true);
  });
});

describe('settings import', () => {
  it('refuses a file over 64 KB without reading it', async () => {
    const big = new File([new Uint8Array(64 * 1024 + 1)], 'big.json');
    const text = vi.spyOn(big, 'text');
    await pick(big);
    expect(text).not.toHaveBeenCalled();
    expect(toast.mock.calls.at(-1)[0]).toContain('larger than 64 KB');
    expect(applySettings).not.toHaveBeenCalled();
  });

  it('rejects JSON that is not an object', async () => {
    await pick(new File(['[1, 2, 3]'], 's.json'));
    expect(toast.mock.calls.at(-1)[0]).toContain('not a settings file');
    expect(applySettings).not.toHaveBeenCalled();
  });

  it('rejects text that is not JSON', async () => {
    await pick(new File(['{not json'], 's.json'));
    expect(toast.mock.calls.at(-1)[0]).toContain('not a valid JSON');
  });

  it('drops unknown keys rather than handing them on', async () => {
    await pick(new File([JSON.stringify({ mode: 'tunnel', evilKey: 'x', __proto__: { polluted: true } })], 's.json'));
    expect(applySettings).toHaveBeenCalledTimes(1);
    const applied = applySettings.mock.calls[0][0];
    expect(applied).toEqual({ mode: 'tunnel' });
    expect(applied.evilKey).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
  });

  it('passes a stored Reduce flashing choice through validation', async () => {
    await pick(new File([JSON.stringify({ reduceFlashing: true, mode: 'bars' })], 's.json'));
    expect(applySettings.mock.calls[0][0].reduceFlashing).toBe(true);
  });

  it('reports a file with nothing usable in it', async () => {
    await pick(new File([JSON.stringify({ unknown: 1 })], 's.json'));
    expect(toast.mock.calls.at(-1)[0]).toContain('nothing usable');
  });
});
