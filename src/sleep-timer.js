// @ts-check
/**
 * Sleep timer.
 *
 * Cycles OFF → 15 → 30 → 60 minutes; when it fires it fades the engine out
 * over ~7s, pauses, then restores the volume. The countdown label ticks once
 * per second under a minute and once per minute above it.
 *
 * @param {object} deps
 * @param {any} deps.engine
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {() => void} deps.refreshStatus
 * @param {() => void} deps.saveSettings
 * @param {HTMLElement | null} deps.volumeFill
 * @param {HTMLElement | null} deps.chip
 * @param {HTMLElement | null} deps.label
 */
export function createSleepTimer({ engine, toast, refreshStatus, saveSettings, volumeFill, chip, label }) {
  const SLEEP_STEPS = [0, 15, 30, 60];
  let step = 0;
  let end = 0;
  let tick = null;

  function stopTick() {
    if (tick) { clearInterval(tick); tick = null; }
  }

  async function fire() {
    stopTick();
    end = 0;
    const baseVol = engine.volume;
    for (let i = 10; i > 0; i--) {
      if (!engine.playing && !engine.micActive && !engine.captureActive) break;
      engine.setVolume(baseVol * (i / 10));
      if (volumeFill) volumeFill.style.width = `${engine.volume * 100}%`;
      await new Promise((r) => setTimeout(r, 700));
    }
    engine.pause();
    engine.setVolume(baseVol);
    if (volumeFill) volumeFill.style.width = `${baseVol * 100}%`;
    step = 0;
    if (label) label.textContent = 'Sleep';
    refreshStatus();
    saveSettings();
    toast('SLEEP — <b>goodnight</b>', { duration: 2600 });
  }

  chip?.addEventListener('click', () => {
    step = (step + 1) % SLEEP_STEPS.length;
    const mins = SLEEP_STEPS[step];
    if (!mins) {
      stopTick();
      end = 0;
      if (label) label.textContent = 'Sleep';
      toast('SLEEP timer <b>OFF</b>', { duration: 1400 });
      return;
    }
    end = Date.now() + mins * 60000;
    if (label) label.textContent = `Sleep ${mins}m`;
    toast(`SLEEP <b>${mins} min</b> — fade out &amp; pause`, { duration: 1800 });
    stopTick();
    tick = setInterval(() => {
      const rem = end - Date.now();
      if (rem <= 0) { fire(); return; }
      if (label) {
        if (rem <= 60000) label.textContent = `${Math.ceil(rem / 1000)}s`;
        else label.textContent = `Sleep ${Math.ceil(rem / 60000)}m`;
      }
    }, 500);
  });

  return { fire };
}
