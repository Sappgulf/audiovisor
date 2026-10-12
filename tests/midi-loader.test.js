import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* The MIDI module counts as fetched when its factory runs. Each test gets a
   fresh registry and a fresh mock, so the count starts at zero. */
const loads = vi.hoisted(() => ({ count: 0, fail: false }));

const settle = () => new Promise((r) => setTimeout(r, 20));

function fakeChip() {
  let click = null;
  return {
    addEventListener: (_ev, fn) => { click = fn; },
    click: () => click?.(),
  };
}

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

describe('MIDI input is loaded on demand', () => {
  let mod;
  let midi;
  let chip;
  let setToggle;
  let toast;

  beforeEach(async () => {
    vi.resetModules();
    loads.count = 0;
    loads.fail = false;
    vi.doMock('../src/midi.js', async (importOriginal) => {
      loads.count++;
      if (loads.fail) throw new Error('offline');
      return importOriginal();
    });
    midi = stubMidi();
    mod = await import('../src/midi-loader.js');
    chip = fakeChip();
    setToggle = vi.fn();
    toast = vi.fn();
    mod.createMidiLoader({
      chip, fxNames: ['reverb'], modes: [{ id: 'bars' }],
      setSlider: vi.fn(), setFx: vi.fn(), setMode: vi.fn(), toast, setToggle,
    });
  });

  afterEach(() => {
    midi.restore();
    vi.doUnmock('../src/midi.js');
  });

  it('creating the loader does not request midi.js', async () => {
    await settle();
    expect(loads.count).toBe(0);
    expect(midi.request).not.toHaveBeenCalled();
  });

  it('the first chip click requests midi.js once and turns input on', async () => {
    chip.click();
    await settle();
    expect(loads.count).toBe(1);
    expect(midi.request).toHaveBeenCalledTimes(1);
    expect(typeof midi.input.onmidimessage).toBe('function');
    expect(setToggle).toHaveBeenLastCalledWith(chip, true, 'is-active');
  });

  it('a disable that lands before the module does leaves nothing bound', async () => {
    chip.click();   // on: the module is still in flight
    chip.click();   // off: arrives before the module lands
    await settle();
    expect(loads.count).toBe(1);
    expect(midi.request).not.toHaveBeenCalled();
    expect(midi.input.onmidimessage).toBeNull();
    expect(setToggle).toHaveBeenLastCalledWith(chip, false, 'is-active');
  });

  it('after the module is loaded, the next click disables through the module', async () => {
    chip.click();
    await settle();
    chip.click();
    await settle();
    expect(loads.count).toBe(1);
    expect(midi.input.onmidimessage).toBeNull();
    expect(midi.access.onstatechange).toBeNull();
    expect(setToggle).toHaveBeenLastCalledWith(chip, false, 'is-active');
  });

  it('a failed fetch toasts, leaves the chip off, and the next click retries', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      loads.fail = true;
      chip.click();
      await settle();
      expect(toast).toHaveBeenCalledWith(expect.stringContaining('MIDI unavailable'), expect.anything());
      expect(setToggle).toHaveBeenLastCalledWith(chip, false, 'is-active');

      loads.fail = false;
      chip.click();
      await settle();
      expect(midi.request).toHaveBeenCalledTimes(1);
      expect(typeof midi.input.onmidimessage).toBe('function');
    } finally { err.mockRestore(); }
  });
});
