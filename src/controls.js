// @ts-check
/**
 * Drawer controls: the look sliders, the FX chip row and the EQ bands.
 *
 * These all share the same shape — build a control, push its value into the
 * engine/renderer, persist — so they live together and expose a single
 * `setFx` used by presets, AI and the import/share paths, which keeps the
 * chip's class, the engine and `state.fx` from drifting apart.
 *
 * @param {object} deps
 * @param {any} deps.engine
 * @param {any} deps.renderer
 * @param {() => any} deps.getRay
 * @param {any} deps.state
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {(el: HTMLElement | null, on: boolean, cls?: string) => void} deps.setToggle
 * @param {() => void} deps.saveSettings
 * @param {Document} [deps.doc]
 */
export function createControls({ engine, renderer, getRay, state, toast, setToggle, saveSettings, doc = document }) {
  const SLIDERS = [
    { id: 'sensitivity', label: 'Sensitivity', min: 0.4, max: 2.4, step: 0.05, value: 1.4, fmt: (v) => `x${v.toFixed(2)}` },
    { id: 'bass-focus', label: 'Bass Focus', min: 0, max: 1, step: 0.05, value: 0.5, fmt: (v) => `${Math.round(v * 100)}%` },
    { id: 'smoothing', label: 'Smoothing', min: 0, max: 0.95, step: 0.01, value: 0.82, fmt: (v) => v.toFixed(2) },
    { id: 'color-pop', label: 'Color Pop', min: 0.6, max: 1.9, step: 0.05, value: 1.0, fmt: (v) => `${Math.round(v*100)}%` },
    { id: 'bloom', label: 'Bloom', min: 0, max: 1, step: 0.05, value: 0.5, fmt: (v) => `${Math.round(v*100)}%` },
  ];

  const FX = ['reverb', 'limiter', 'lowpass', 'speed', 'autotune', 'chorus', 'echo', 'crush', 'chop', 'widener'];
  const EQ_FREQS = [60, 250, 1000, 4000, 12000];

  const sliderEls = {};
  const fxEls = {};

  function applySlider(id, v) {
    const ray = getRay();
    if (id === 'sensitivity') {
      engine.sensitivity = v;
      renderer.setSensitivity(v);
      ray.setSensitivity(v);
    } else if (id === 'bass-focus') {
      engine.bassFocus = v;
      renderer.setBassFocus(v);
      ray.setBassFocus(v);
    } else if (id === 'smoothing') {
      engine.setSmoothing(v);
    } else if (id === 'color-pop') {
      renderer.setColorPop(v);
      ray.setColorPop(v);
    } else if (id === 'bloom') {
      renderer.setBloom(v);
      ray.setBloom(v);
    }
  }

  /** Drive every side of an FX toggle from one place. */
  function setFx(name, on) {
    engine.setFx(name, on);
    const el = fxEls[name];
    if (el) setToggle(el, on, 'is-active');
    state.fx[name] = on;
  }

  function buildSliders() {
    const wrap = doc.getElementById('sliders');
    SLIDERS.forEach((cfg) => {
      const group = doc.createElement('div');
      group.className = 'slider-group';
      group.innerHTML = `
    <div class="slider-head">
      <label class="slider-label mono" for="sl-${cfg.id}">${cfg.label}</label>
      <span class="slider-value" id="sl-val-${cfg.id}">${cfg.fmt(cfg.value)}</span>
    </div>
    <input type="range" class="ctrl-slider" id="sl-${cfg.id}" min="${cfg.min}" max="${cfg.max}" step="${cfg.step}" value="${cfg.value}" aria-describedby="sl-val-${cfg.id}">`;
      wrap.appendChild(group);
      const input = group.querySelector('input');
      sliderEls[cfg.id] = input;
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        group.querySelector('.slider-value').textContent = cfg.fmt(v);
        applySlider(cfg.id, v);
        saveSettings();
      });
    });
  }

  function buildFx() {
    const row = doc.getElementById('fx-row');
    FX.forEach((fx) => {
      const btn = doc.createElement('button');
      btn.className = 'fx-chip';
      btn.innerHTML = `<span class="chip-dot"></span><span class="chip-txt">${fx.toUpperCase()}</span>`;
      setToggle(btn, false, 'is-active');   // report "off" from the start, not nothing
      btn.addEventListener('click', () => {
        const on = !btn.classList.contains('is-active');
        setToggle(btn, on, 'is-active');
        engine.setFx(fx, on);
        state.fx[fx] = on;
        saveSettings();
        toast(`FX <b>${fx.toUpperCase()}</b> ${on ? 'engaged' : 'bypassed'}`, { duration: 1400 });
      });
      row.appendChild(btn);
      fxEls[fx] = btn;
    });
  }

  function buildEq() {
    const eqBands = doc.getElementById('eq-bands');
    if (!eqBands) return;
    EQ_FREQS.forEach((f, i) => {
      const row = doc.createElement('div');
      row.className = 'eq-row';
      const label = f >= 1000 ? `${f / 1000}K` : `${f}`;
      const accessibleLabel = f >= 1000 ? `${f / 1000} kilohertz` : `${f} hertz`;
      const inputId = `eq-${f}`;
      const valueId = `${inputId}-value`;
      row.innerHTML = `<label class="mono eq-label" for="${inputId}">${label}</label><input id="${inputId}" type="range" class="ctrl-slider eq-slider" min="-10" max="10" step="0.5" value="0" aria-label="${accessibleLabel} equalizer gain" aria-describedby="${valueId}" aria-valuetext="0 dB" /><span class="mono eq-val" id="${valueId}">0</span>`;
      eqBands.appendChild(row);
      row.querySelector('input').addEventListener('input', (e) => {
        const input = /** @type {HTMLInputElement} */ (e.target);
        const v = parseFloat(input.value);
        row.querySelector('.eq-val').textContent = v > 0 ? '+' + v : String(v);
        input.setAttribute('aria-valuetext', `${v > 0 ? '+' : ''}${v} dB`);
        engine.setEq(i, v);
        saveSettings();
      });
    });
  }

  buildSliders();
  buildFx();
  buildEq();

  return { SLIDERS, FX, EQ_FREQS, sliderEls, fxEls, applySlider, setFx };
}
