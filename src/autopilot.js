// @ts-check
/**
 * Autopilot — cycles the look every 12s until switched off.
 *
 * @param {object} deps
 * @param {any} deps.state
 * @param {HTMLElement | null} deps.chip
 * @param {HTMLElement | null} deps.shuffleBtn
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {(el: HTMLElement | null, on: boolean, cls?: string) => void} deps.setToggle
 * @param {() => void} deps.saveSettings
 * @param {() => void} deps.randomizeLook
 */
export function createAutopilot({ state, chip, shuffleBtn, toast, setToggle, saveSettings, randomizeLook }) {
  function setAutopilot(on, opts = {}) {
    state.autopilot = on;
    setToggle(chip, on, 'is-active');
    setToggle(shuffleBtn, on);
    if (on) {
      state.autopilotTimer = setInterval(randomizeLook, 12000);
      randomizeLook();
      if (!opts.silent) toast('AUTOPILOT <b>ON</b> — cycling modes &amp; themes', { duration: 1800 });
    } else if (state.autopilotTimer) {
      clearInterval(state.autopilotTimer);
      state.autopilotTimer = null;
      if (!opts.silent) toast('AUTOPILOT <b>OFF</b>', { duration: 1400 });
    }
    saveSettings();
  }

  chip?.addEventListener('click', () => setAutopilot(!state.autopilot));
  shuffleBtn?.addEventListener('click', () => setAutopilot(!state.autopilot));

  return { setAutopilot };
}
