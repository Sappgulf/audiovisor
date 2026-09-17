// @ts-check
import { initialTier, TIER_INFO } from './adaptive.js';

/**
 * Raytrace stage controls: the on/off chip and the quality cycle.
 *
 * The chosen quality is a ceiling — the adaptive loop in the render loop
 * starts lower on weak hardware and climbs to whatever it can sustain.
 *
 * @param {object} deps
 * @param {any} deps.state
 * @param {() => any} deps.getRay
 * @param {() => any} deps.getTheme
 * @param {any} deps.renderer
 * @param {string[]} deps.rayQualities
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {() => void} deps.saveSettings
 * @param {() => void} deps.resume
 * @param {Document} [deps.doc]
 */
export function createRaytraceControls({
  state, getRay, getTheme, renderer, rayQualities, toast, saveSettings, resume, doc = document,
}) {
  const $ = (id) => doc.getElementById(id);
  /** The tier the adaptive sampler is actually running, which can sit below
      the ceiling the user chose on hardware that cannot hold it. */
  let effective = null;

  const tierLabel = (q) => TIER_INFO[q]?.label || `${q[0].toUpperCase()}${q.slice(1)}`;

  function renderQualityLabel() {
    const label = $('rt-quality-label');
    const quality = $('rt-quality');
    const ceiling = state.rayQuality;
    const ceilingLabel = tierLabel(ceiling);
    if (label) {
      label.textContent = effective && effective !== ceiling
        ? `Quality: ${ceilingLabel} · now ${tierLabel(effective)}`
        : `Quality: ${ceilingLabel}`;
    }
    if (quality) {
      const blurb = TIER_INFO[ceiling]?.blurb || '';
      quality.title = effective && effective !== ceiling
        ? `${blurb} Currently running ${tierLabel(effective)} to hold the frame rate.`
        : blurb;
    }
  }

  /** Report a tier chosen by the adaptive sampler. */
  function showEffectiveTier(tier) {
    effective = tier;
    renderQualityLabel();
  }

  function setRaytrace(on, { quiet = false } = {}) {
    state.raytraceWanted = on;
    if (on) resume();
    const chip = $('rt-chip');
    chip?.classList.toggle('is-active', on);
    chip?.setAttribute('aria-pressed', String(on));
    const ray = getRay();
    if (on && ray.ok) {
      ray.setMode(state.modeId);
      ray.setTheme(getTheme());
      ray.resize(renderer.w, renderer.h);
    }
    if (!quiet) {
      toast(on ? 'RAYTRACE <b>engaged</b>' : 'Raytrace <b>off</b> — Canvas2D stage', { duration: 1600 });
      saveSettings();
    }
  }

  function setRayQuality(q, { quiet = false } = {}) {
    if (!rayQualities.includes(q)) return;
    /* What the user picks is a ceiling. On a device that cannot hold it, the
       stage starts lower and the adaptive climb walks up to whatever this
       hardware can actually sustain. */
    state.rayQuality = q;
    /* A new ceiling restarts the climb from whatever this device should
       begin at, so the readout follows that rather than the ceiling. */
    effective = initialTier(q);
    getRay().setQuality(effective);
    renderQualityLabel();
    if (!quiet) {
      toast(`Raytrace quality <b>${q}</b>`, { duration: 1400 });
      saveSettings();
    }
  }

  $('rt-chip')?.addEventListener('click', () => {
    const ray = getRay();
    if (ray.loading) { toast('Raytrace stage <b>still loading</b>…', { duration: 1600 }); return; }
    if (!ray.ok && !ray.lost) { toast('<b>Raytrace unavailable</b> — WebGL2 required', { duration: 2400 }); return; }
    setRaytrace(!state.raytraceWanted);
  });
  $('rt-quality')?.addEventListener('click', () => {
    const i = (rayQualities.indexOf(state.rayQuality) + 1) % rayQualities.length;
    setRayQuality(rayQualities[i]);
  });
  if (!getRay().ok) {
    $('rt-chip')?.classList.add('is-disabled');
    $('rt-quality')?.classList.add('is-disabled');
  }
  // re-apply whatever loadSettings() restored (or the defaults) now that the
  // chips exist in the DOM
  setRaytrace(state.raytraceWanted, { quiet: true });
  setRayQuality(state.rayQuality, { quiet: true });

  return { setRaytrace, setRayQuality, showEffectiveTier };
}
