// @ts-check

/**
 * MIDI input.
 *
 * Maps a MIDI device onto the look: continuous controllers drive the sliders
 * (sensitivity, bass focus, smoothing, bloom, colour pop), the first ten
 * drum pads toggle the FX chain, and the next twelve pads jump between
 * modes. The message decoding is a pure function so the mapping is testable
 * without a device; `createMidiInput` owns the Web MIDI plumbing and the
 * opt-in chip.
 */

/** CC number → slider id. */
export const CC_MAP = {
  1: 'sensitivity',
  74: 'bass-focus',
  71: 'smoothing',
  76: 'bloom',
  77: 'color-pop',
};

/** Drum-pad note range that toggles FX, in order. */
export const FX_NOTE_BASE = 36;
/** Pad note range that selects modes, in order. */
export const MODE_NOTE_BASE = 48;

/**
 * Decode one MIDI message into an intent.
 *
 * @param {Uint8Array | number[]} data
 * @returns {{ type: 'slider', id: string, value: number }
 *   | { type: 'fx', index: number }
 *   | { type: 'mode', index: number }
 *   | null}
 */
export function decodeMidi(data) {
  if (!data || data.length < 3) return null;
  const status = data[0] & 0xf0;
  const d1 = data[1];
  const d2 = data[2];

  if (status === 0xb0) {                     // control change
    const id = CC_MAP[d1];
    if (!id) return null;
    return { type: 'slider', id, value: d2 / 127 };
  }
  if (status === 0x90 && d2 > 0) {           // note on (velocity > 0)
    if (d1 >= FX_NOTE_BASE && d1 < FX_NOTE_BASE + 10) return { type: 'fx', index: d1 - FX_NOTE_BASE };
    if (d1 >= MODE_NOTE_BASE && d1 < MODE_NOTE_BASE + 12) return { type: 'mode', index: d1 - MODE_NOTE_BASE };
  }
  return null;
}

/**
 * @param {object} deps
 * @param {HTMLElement | null} deps.chip
 * @param {string[]} deps.fxNames
 * @param {Array<{ id: string, name: string }>} deps.modes
 * @param {(id: string, value: number) => void} deps.setSlider
 * @param {(name: string, on: boolean) => void} deps.setFx
 * @param {(id: string) => void} deps.setMode
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {(el: HTMLElement | null, on: boolean, cls?: string) => void} deps.setToggle
 */
export function createMidiInput({ chip, fxNames, modes, setSlider, setFx, setMode, toast, setToggle }) {
  let access = null;
  let enabled = false;
  /** @type {boolean[]} */
  const fxState = fxNames.map(() => false);

  function onMessage(e) {
    const intent = decodeMidi(e.data);
    if (!intent) return;
    if (intent.type === 'slider') {
      setSlider(intent.id, intent.value);
    } else if (intent.type === 'fx') {
      const name = fxNames[intent.index];
      if (!name) return;
      fxState[intent.index] = !fxState[intent.index];
      setFx(name, fxState[intent.index]);
    } else if (intent.type === 'mode') {
      const m = modes[intent.index];
      if (m) setMode(m.id);
    }
  }

  function bindInputs() {
    if (!access) return;
    for (const input of access.inputs.values()) input.onmidimessage = onMessage;
  }

  async function enable() {
    if (enabled) return true;
    if (!navigator.requestMIDIAccess) {
      toast('<b>MIDI unavailable</b> — this browser has no Web MIDI', { duration: 3000 });
      return false;
    }
    try {
      access = await navigator.requestMIDIAccess();
      enabled = true;
      bindInputs();
      access.onstatechange = bindInputs;
      setToggle(chip, true, 'is-active');
      const count = access.inputs.size;
      toast(count ? `MIDI <b>on</b> — ${count} device${count > 1 ? 's' : ''}` : 'MIDI <b>on</b> — waiting for a device', { duration: 2200 });
      return true;
    } catch {
      toast('<b>MIDI blocked</b> — permission denied', { duration: 3000 });
      return false;
    }
  }

  function disable() {
    if (access) {
      for (const input of access.inputs.values()) input.onmidimessage = null;
      access.onstatechange = null;
    }
    access = null;
    enabled = false;
    setToggle(chip, false, 'is-active');
    toast('MIDI <b>off</b>', { duration: 1400 });
  }

  chip?.addEventListener('click', () => { if (enabled) disable(); else enable(); });

  return { enable, disable, isEnabled: () => enabled, handleMessage: onMessage };
}
