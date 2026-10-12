// @ts-check
/**
 * Audio tab extras: playback speed chips and the visual sync control.
 *
 * Built the first time the Audio tab opens (see drawer-sections.js), so this
 * module stays out of the entry chunk. It uses the drawer's existing chip and
 * slider classes and adds no CSS. The audio engine gains syncOffsetMs and
 * setSpeed at its own pace, so every engine call here is guarded: a missing
 * method or property leaves the control inert instead of throwing.
 */
import { SPEEDS, SYNC_LIMIT_MS } from './settings.js';

/** @param {number} ms */
const fmtSync = (ms) => `${ms > 0 ? '+' : ''}${ms} ms`;

/**
 * @param {object} deps
 * @param {any} deps.engine
 * @param {() => void} deps.saveSettings
 * @param {Document} [deps.doc]
 * @returns {{ el: HTMLElement } | null} null when the Audio tab markup is missing
 */
export function createAudioTab({ engine, saveSettings, doc = document }) {
  const title = doc.querySelector('#panel-audio section .section-title');
  if (!title) return null;

  const wrap = doc.createElement('div');
  wrap.id = 'audio-extras';
  // a flex column holds its own height, so the rows below never overlap it
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:12px;margin-bottom:12px';
  wrap.innerHTML = `
    <div class="fx-row" role="group" aria-label="Playback speed">
      ${SPEEDS.map((s) => `<button class="fx-chip" data-speed="${s}" aria-pressed="false"><span class="chip-txt">${s}x</span></button>`).join('')}
    </div>
    <div class="slider-group">
      <div class="slider-head">
        <label class="slider-label mono" for="sync-slider">Visual sync</label>
        <span class="slider-value" id="sync-val"></span>
      </div>
      <input type="range" class="ctrl-slider" id="sync-slider" min="${-SYNC_LIMIT_MS}" max="${SYNC_LIMIT_MS}" step="1" aria-describedby="sync-val">
    </div>
    <div class="fx-row">
      <button class="fx-chip" id="sync-reset" title="Set visual sync back to 0 ms"><span class="chip-txt">Reset sync</span></button>
    </div>`;
  title.after(wrap);

  const speedBtns = /** @type {HTMLButtonElement[]} */ ([...wrap.querySelectorAll('[data-speed]')]);
  const slider = /** @type {HTMLInputElement} */ (wrap.querySelector('#sync-slider'));
  const reset = /** @type {HTMLButtonElement} */ (wrap.querySelector('#sync-reset'));
  const syncVal = wrap.querySelector('#sync-val');
  const syncLive = typeof engine.syncOffsetMs === 'number';

  function paintSpeed() {
    for (const b of speedBtns) {
      const on = Number(b.dataset.speed) === engine.speed;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  /** @param {number} ms */
  function paintSync(ms) {
    slider.value = String(ms);
    if (syncVal) syncVal.textContent = fmtSync(ms);
  }

  /** @param {number} ms */
  function setSync(ms) {
    if (typeof engine.syncOffsetMs === 'number') engine.syncOffsetMs = ms;
    paintSync(ms);
    saveSettings();
  }

  for (const b of speedBtns) {
    b.addEventListener('click', () => {
      if (typeof engine.setSpeed === 'function') engine.setSpeed(Number(b.dataset.speed));
      paintSpeed();
      saveSettings();
    });
  }
  slider.addEventListener('input', () => setSync(Number(slider.value)));
  reset.addEventListener('click', () => setSync(0));

  slider.disabled = reset.disabled = !syncLive;
  paintSpeed();
  paintSync(syncLive ? engine.syncOffsetMs : 0);
  // repaint when the engine changes either value by any route: the FX chain's
  // speed, a settings import, or a control elsewhere. Engines without events
  // (older builds, test doubles) keep the paint-on-open behaviour.
  if (typeof engine.addEventListener === 'function') {
    engine.addEventListener('speedchange', paintSpeed);
    engine.addEventListener('syncchange', () => paintSync(engine.syncOffsetMs ?? 0));
  }
  return { el: wrap };
}
