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

describe('MIDI enable/disable serialization', () => {
  const settle = () => new Promise((r) => setTimeout(r, 20));

  function stubMidi() {
    const input = { onmidimessage: null };
    const access = { inputs: new Map([['in', input]]), onstatechange: null };
    const request = vi.fn(() => new Promise((r) => setTimeout(() => r(access), 5)));
    const prev = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { requestMIDIAccess: request } });
    return {
      input, access, request,
      restore: () => {
        if (prev) Object.defineProperty(globalThis, 'navigator', prev);
        else delete globalThis.navigator;
      },
    };
  }

  function make(chip = null) {
    return createMidiInput({
      chip, fxNames: ['reverb'], modes: [{ id: 'bars' }],
      setSlider: vi.fn(), setFx: vi.fn(), setMode: vi.fn(), toast: vi.fn(), setToggle: vi.fn(),
    });
  }

  it('a disable during the permission prompt wins and leaves nothing bound', async () => {
    const m = stubMidi();
    try {
      const midi = make();
      const on = midi.enable();
      midi.disable();
      await on;
      await settle();
      expect(midi.isEnabled()).toBe(false);
      expect(m.input.onmidimessage).toBeNull();
      expect(m.access.onstatechange).toBeNull();
    } finally { m.restore(); }
  });

  it('two enables during the prompt ask once and bind once', async () => {
    const m = stubMidi();
    try {
      const midi = make();
      await Promise.all([midi.enable(), midi.enable()]);
      expect(m.request).toHaveBeenCalledTimes(1);
      expect(midi.isEnabled()).toBe(true);
      expect(typeof m.input.onmidimessage).toBe('function');
      await midi.disable();
      expect(m.input.onmidimessage).toBeNull();
    } finally { m.restore(); }
  });

  it('a second chip click during the prompt cancels the first', async () => {
    const m = stubMidi();
    try {
      let click = null;
      const chip = { addEventListener: (_ev, fn) => { click = fn; } };
      const midi = make(chip);
      click();                 // on: prompt opens
      click();                 // off: arrives before the prompt resolves
      await settle();
      expect(midi.isEnabled()).toBe(false);
      expect(m.input.onmidimessage).toBeNull();
    } finally { m.restore(); }
  });
});
