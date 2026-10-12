// @ts-check
import {
  SETTINGS_KEY, MAX_SETTINGS_BYTES, serializeSettings, validateSettings, isSettingsObject,
} from './settings.js';
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
 * @param {(on: boolean) => void} deps.setReduceFlashing applies and remembers the choice
 * @param {Document} [deps.doc]
 * @param {Location} [deps.location]
 */
export function createSettingsUI({
  state, engine, sliderEls, eqFreqs, getAutoDj, vocab, applySettings, saveSettings, download, toast,
  setReduceFlashing, doc = document, location = window.location,
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
      reduceFlashing: state.reduceFlashing,
    });
  }

  /* Reduce flashing sits with the other settings tools. Built here rather than
     in index.html so the toggle lives next to the code that persists it. */
  const flashChip = doc.createElement('button');
  flashChip.className = 'fx-chip';
  flashChip.id = 'reduce-flashing-chip';
  flashChip.title = 'Calmer stage: no rapid flashing or strobing';
  flashChip.innerHTML = '<span class="chip-dot"></span><span class="chip-txt">Reduce flashing</span>';
  const paintFlash = () => {
    flashChip.classList.toggle('is-on', !!state.reduceFlashing);
    flashChip.setAttribute('aria-pressed', String(!!state.reduceFlashing));
  };
  flashChip.addEventListener('click', () => {
    setReduceFlashing(!state.reduceFlashing);
    paintFlash();
  });
  paintFlash();
  doc.getElementById('settings-export')?.parentElement?.prepend(flashChip);

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
    input.value = '';
    if (!f) return;
    // a settings file is a few KB; anything larger is not one, so do not read it
    if (f.size > MAX_SETTINGS_BYTES) { toast('<b>Import failed</b> — the file is larger than 64 KB'); return; }
    f.text().then(txt => {
      let raw;
      try { raw = JSON.parse(txt); } catch { toast('<b>Import failed</b> — not a valid JSON file'); return; }
      if (!isSettingsObject(raw)) { toast('<b>Import failed</b> — not a settings file'); return; }
      // validateSettings keeps only the keys this build knows, so unknown keys are never stored
      const s = validateSettings(raw, vocab);
      if (!Object.keys(s).length) { toast('<b>Import failed</b> — nothing usable in that file'); return; }
      applySettings(s, { eq: true });
      saveSettings();
      toast('Settings <b>imported</b>');
    }).catch(() => toast('<b>Import failed</b>'));
  });

  return { currentSettings, paintFlash };
}
