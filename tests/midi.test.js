import { describe, it, expect, vi } from 'vitest';
import { decodeMidi, createMidiInput, FX_NOTE_BASE, MODE_NOTE_BASE } from '../src/midi.js';

describe('decodeMidi', () => {
  it('maps a control change to a normalized slider value', () => {
    expect(decodeMidi([0xb0, 1, 127])).toEqual({ type: 'slider', id: 'sensitivity', value: 1 });
    expect(decodeMidi([0xb0, 74, 0])).toEqual({ type: 'slider', id: 'bass-focus', value: 0 });
    expect(decodeMidi([0xb0, 76, 64]).value).toBeCloseTo(64 / 127, 5);
  });

  it('ignores an unmapped CC', () => {
    expect(decodeMidi([0xb0, 55, 64])).toBeNull();
  });

  it('maps the first ten pads to FX', () => {
    expect(decodeMidi([0x90, FX_NOTE_BASE, 100])).toEqual({ type: 'fx', index: 0 });
    expect(decodeMidi([0x90, FX_NOTE_BASE + 9, 100])).toEqual({ type: 'fx', index: 9 });
  });

  it('maps the next twelve pads to modes', () => {
    expect(decodeMidi([0x90, MODE_NOTE_BASE, 100])).toEqual({ type: 'mode', index: 0 });
    expect(decodeMidi([0x90, MODE_NOTE_BASE + 11, 100])).toEqual({ type: 'mode', index: 11 });
  });

  it('ignores note-off and out-of-range notes', () => {
    expect(decodeMidi([0x90, FX_NOTE_BASE, 0])).toBeNull();
    expect(decodeMidi([0x90, 20, 100])).toBeNull();
    expect(decodeMidi([0x90, 90, 100])).toBeNull();
  });

  it('ignores malformed messages', () => {
    expect(decodeMidi(null)).toBeNull();
    expect(decodeMidi([0xb0, 1])).toBeNull();
  });
});

describe('createMidiInput dispatch', () => {
  function makeInput() {
    const setSlider = vi.fn();
    const setFx = vi.fn();
    const setMode = vi.fn();
    const toast = vi.fn();
    const setToggle = vi.fn();
    const input = createMidiInput({
      chip: null,
      fxNames: ['reverb', 'limiter'],
      modes: [{ id: 'bars' }, { id: 'waves' }],
      setSlider, setFx, setMode, toast, setToggle,
    });
    return { input, setSlider, setFx, setMode };
  }

  it('routes a CC to the slider', () => {
    const { input, setSlider } = makeInput();
    input.handleMessage({ data: [0xb0, 1, 127] });
    expect(setSlider).toHaveBeenCalledWith('sensitivity', 1);
  });

  it('toggles an FX on each pad hit', () => {
    const { input, setFx } = makeInput();
    input.handleMessage({ data: [0x90, FX_NOTE_BASE, 100] });
    input.handleMessage({ data: [0x90, FX_NOTE_BASE, 100] });
    expect(setFx).toHaveBeenNthCalledWith(1, 'reverb', true);
    expect(setFx).toHaveBeenNthCalledWith(2, 'reverb', false);
  });

  it('selects a mode by pad', () => {
    const { input, setMode } = makeInput();
    input.handleMessage({ data: [0x90, MODE_NOTE_BASE + 1, 100] });
    expect(setMode).toHaveBeenCalledWith('waves');
  });
});
