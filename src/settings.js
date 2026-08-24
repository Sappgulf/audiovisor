/**
 * Settings schema — pure serialize / validate / migrate.
 *
 * Kept free of DOM and engine references so the rules that decide what is a
 * legal persisted setting are testable, and so localStorage restore and
 * JSON import share one validator. Anything this module rejects never
 * reaches the UI, which is the point: a hand-edited export used to be able
 * to set a mode or theme id that does not exist.
 */

export const SETTINGS_KEY = 'audiovisor.settings.v2';
export const LEGACY_SETTINGS_KEY = 'audiovisor.settings.v1';
export const SETTINGS_VERSION = 6;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Shape the live app state into the persisted object.
 * @param {object} src plain values already read out of the UI/engine
 */
export function serializeSettings(src) {
  return {
    version: SETTINGS_VERSION,
    mode: src.mode,
    theme: src.theme,
    autopilot: !!src.autopilot,
    raytrace: !!src.raytrace,
    rayQuality: src.rayQuality,
    fx: { ...src.fx },
    sliders: { ...src.sliders },
    eq: Array.isArray(src.eq) ? src.eq.slice() : undefined,
    volume: src.volume,
    loop: !!src.loop,
    autoDj: !!src.autoDj,
  };
}

/**
 * Validate a parsed settings object against the ids the build actually has.
 * Unknown modes/themes/fx/sliders are dropped rather than applied.
 *
 * @param {unknown} raw parsed JSON (any shape — this is untrusted input)
 * @param {{modeIds:string[], themeIds:string[], sliderIds:string[],
 *          fxNames:string[], rayQualities:string[], eqBands:number}} vocab
 * @returns {object} only the keys that survived validation
 */
export function validateSettings(raw, vocab) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;

  if (vocab.modeIds.includes(raw.mode)) out.mode = raw.mode;
  if (vocab.themeIds.includes(raw.theme)) out.theme = raw.theme;
  if (typeof raw.autopilot === 'boolean') out.autopilot = raw.autopilot;
  if (typeof raw.raytrace === 'boolean') out.raytrace = raw.raytrace;
  if (vocab.rayQualities.includes(raw.rayQuality)) out.rayQuality = raw.rayQuality;
  if (typeof raw.loop === 'boolean') out.loop = raw.loop;
  if (typeof raw.autoDj === 'boolean') out.autoDj = raw.autoDj;

  const vol = num(raw.volume);
  if (vol !== null) out.volume = clamp01(vol);

  if (raw.fx && typeof raw.fx === 'object') {
    const fx = {};
    for (const name of vocab.fxNames) {
      if (typeof raw.fx[name] === 'boolean') fx[name] = raw.fx[name];
    }
    if (Object.keys(fx).length) out.fx = fx;
  }

  if (raw.sliders && typeof raw.sliders === 'object') {
    const sliders = {};
    for (const id of vocab.sliderIds) {
      const v = num(typeof raw.sliders[id] === 'string' ? parseFloat(raw.sliders[id]) : raw.sliders[id]);
      if (v !== null) sliders[id] = v;
    }
    if (Object.keys(sliders).length) out.sliders = sliders;
  }

  if (Array.isArray(raw.eq)) {
    // EQ gains are dB; anything outside the UI range is a corrupt file
    const eq = raw.eq.slice(0, vocab.eqBands).map((v) => {
      const n = num(v);
      return n === null ? 0 : Math.max(-12, Math.min(12, n));
    });
    if (eq.length) out.eq = eq;
  }

  return out;
}

/** Read + validate in one step; returns {} for missing or corrupt storage. */
export function readSettings(storage, vocab) {
  let raw;
  try {
    raw = storage.getItem(SETTINGS_KEY) || storage.getItem(LEGACY_SETTINGS_KEY);
  } catch { return {}; }
  if (!raw) return {};
  try {
    return validateSettings(JSON.parse(raw), vocab);
  } catch {
    return {};
  }
}
