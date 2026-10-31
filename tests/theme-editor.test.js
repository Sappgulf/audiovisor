/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createThemeEditor } from '../src/theme-editor.js';
import { makeCustomTheme, loadCustomTheme } from '../src/custom-theme.js';

beforeEach(() => {
  document.body.innerHTML = '<div id="custom-theme"></div>';
  localStorage.clear();
});

function setup() {
  const picker = { addTheme: vi.fn(), setActiveTheme: vi.fn() };
  const setCustomTheme = vi.fn((colors) => {
    const theme = makeCustomTheme(colors);
    localStorage.setItem('audiovisor.customTheme.v1', JSON.stringify({ colors: theme.colors }));
    return theme;
  });
  const editor = createThemeEditor({
    root: document.getElementById('custom-theme'),
    picker,
    getTheme: () => ({ colors: ['#112233', '#223344', '#334455', '#445566', '#556677'] }),
    setCustomTheme,
    toast: vi.fn(),
  });
  return { editor, picker, setCustomTheme };
}

describe('custom theme editor', () => {
  it('renders five labelled colour inputs and a preview', () => {
    setup();
    const inputs = document.querySelectorAll('#custom-theme .custom-color');
    expect(inputs).toHaveLength(5);
    expect(inputs[0].getAttribute('aria-label')).toContain('colour 1');
    expect(document.querySelector('.custom-preview')).toBeTruthy();
  });

  it('applies the five stops through the picker and remembers them', () => {
    const { picker, setCustomTheme } = setup();
    const inputs = [...document.querySelectorAll('#custom-theme .custom-color')];
    const colors = ['#0a0b0c', '#1a1b1c', '#2a2b2c', '#3a3b3c', '#4a4b4c'];
    inputs.forEach((input, i) => {
      input.value = colors[i];
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    document.querySelector('#custom-theme .lime-btn-sm').click();
    expect(setCustomTheme).toHaveBeenCalledWith(colors);
    expect(picker.addTheme).toHaveBeenCalled();
    expect(picker.setActiveTheme).toHaveBeenCalledWith('custom');
    expect(loadCustomTheme().colors).toEqual(colors);
  });

  it('copies the active theme with Use current', () => {
    setup();
    const inputs = [...document.querySelectorAll('#custom-theme .custom-color')];
    document.querySelector('#custom-theme .mini-btn').click();
    expect(inputs.map((i) => i.value)).toEqual(['#112233', '#223344', '#334455', '#445566', '#556677']);
  });

  it('resyncs inputs when another path applies a palette', () => {
    setup();
    window.dispatchEvent(new CustomEvent('audiovisor:custom-theme', { detail: { colors: ['#abcdef', '#bcdefa', '#cdefab', '#defabc', '#efabcd'] } }));
    const inputs = [...document.querySelectorAll('#custom-theme .custom-color')];
    expect(inputs[0].value).toBe('#abcdef');
    expect(inputs[4].value).toBe('#efabcd');
  });
});
