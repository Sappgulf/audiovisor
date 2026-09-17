// @ts-check
import { SETTINGS_KEY, serializeSettings, validateSettings } from './settings.js';
import { remove as removeStored } from './storage.js';

/**
 * Settings export/import and reset.
 *
 * Export and import share one serialized shape so a file written here can be
 * read back; import runs through the same validator as a localStorage
 * restore, which used to be skipped.
 *
 * @param {object} deps
 * @param {any} deps.state
 * @param {any} deps.engine
 * @param {Record<string, HTMLInputElement>} deps.sliderEls
 * @param {number[]} deps.eqFreqs
 * @param {() => boolean} deps.getAutoDj
 * @param {any} deps.vocab
 * @param {(s: object, opts?: object) => void} deps.applySettings
 * @param {() => void} deps.saveSettings
 * @param {(blob: Blob, name: string) => void} deps.download
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {Document} [deps.doc]
 * @param {Location} [deps.location]
 */
export function createSettingsUI({
  state, engine, sliderEls, eqFreqs, getAutoDj, vocab, applySettings, saveSettings, download, toast,
  doc = document, location = window.location,
}) {
  function currentSettings() {
    return serializeSettings({
      mode: state.modeId,
      theme: state.themeId,
      autopilot: state.autopilot,
      raytrace: state.raytraceWanted,
      rayQuality: state.rayQuality,
      fx: state.fx,
      sliders: Object.fromEntries(Object.entries(sliderEls).map(([k, el]) => [k, parseFloat(el.value)])),
      eq: eqFreqs.map((_, i) => engine.eqFilters?.[i]?.gain.value || 0),
      volume: engine.volume,
      loop: engine.loop,
      autoDj: getAutoDj(),
    });
  }

  doc.getElementById('settings-reset')?.addEventListener('click', () => {
    removeStored(SETTINGS_KEY);
    removeStored('audiovisor.tour');
    location.reload();
  });

  doc.getElementById('settings-export')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(currentSettings(), null, 2)], { type: 'application/json' });
    download(blob, 'audiovisor-settings.json');
    toast('Settings <b>exported</b>');
  });
  doc.getElementById('settings-import')?.addEventListener('click', () => doc.getElementById('settings-file')?.click());
  doc.getElementById('settings-file')?.addEventListener('change', (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    const f = input.files[0];
    if (!f) return;
    f.text().then(txt => {
      try {
        const s = validateSettings(JSON.parse(txt), vocab);
        if (!Object.keys(s).length) { toast('<b>Import failed</b> — nothing usable in that file'); return; }
        applySettings(s, { eq: true });
        saveSettings();
        toast('Settings <b>imported</b>');
      } catch { toast('<b>Import failed</b>'); }
    });
    input.value = '';
  });

  return { currentSettings };
}
