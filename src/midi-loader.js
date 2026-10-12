// @ts-check
/**
 * Lazy loader for MIDI input.
 *
 * The Web MIDI plumbing and the CC/pad mapping are only needed by someone who
 * has a controller, so src/midi.js is fetched the first time the MIDI chip is
 * clicked. Until then this loader owns the chip. Turning it off before the
 * module lands is a plain state change, so a quick off-then-on never leaves a
 * stale enable running after the module arrives.
 *
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
export function createMidiLoader({ chip, fxNames, modes, setSlider, setFx, setMode, toast, setToggle }) {
  /* the user's intent while the module is still in flight; once it is loaded
     the module's own flag is the one that counts */
  let wanted = false;
  /** @type {null | { enable: () => Promise<boolean>, disable: () => Promise<void>, isWanted: () => boolean }} */
  let midi = null;
  /** @type {Promise<typeof midi> | null} */
  let load = null;

  function ensureMidi() {
    if (load) return load;
    load = import('./midi.js')
      .then(({ createMidiInput }) => {
        /* chip is passed as null so the module does not attach its own click
           handler next to this one; the module's toggles still reach the chip
           through the setToggle wrapper below */
        midi = createMidiInput({
          chip: null,
          fxNames,
          modes,
          setSlider,
          setFx,
          setMode,
          toast,
          setToggle: (_el, on, cls) => setToggle(chip, on, cls),
        });
        return midi;
      })
      .catch((err) => {
        console.error('MIDI input failed to load:', err);
        // allow a retry on the next click
        load = null;
        wanted = false;
        setToggle(chip, false, 'is-active');
        toast('<b>MIDI unavailable</b> — could not load the input module', { duration: 3600 });
        return null;
      });
    return load;
  }

  function turnOn() {
    wanted = true;
    void ensureMidi().then((m) => {
      // a click that turned it back off during the fetch has already won
      if (m && wanted) m.enable();
    });
  }

  function turnOff() {
    wanted = false;
    if (midi) midi.disable();
    else setToggle(chip, false, 'is-active');
  }

  chip?.addEventListener('click', () => {
    const on = midi ? midi.isWanted() : wanted;
    if (on) turnOff(); else turnOn();
  });
}
