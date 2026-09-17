// @ts-check
import { writePreset, readPresets, PRESET_SLOTS } from './presets.js';
import { MODES, THEMES } from './themes.js';

/**
 * Look presets — click a chip to recall a slot, right-click to save the
 * current mode/theme/FX into it. The vocabulary is built on demand so the
 * ids always come from the live MODES/THEMES lists rather than a snapshot.
 *
 * @param {object} deps
 * @param {any} deps.state
 * @param {string[]} deps.fxNames
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {(id: string) => void} deps.setMode
 * @param {(id: string) => void} deps.setTheme
 * @param {(name: string, on: boolean) => void} deps.setFx
 * @param {() => void} deps.saveSettings
 * @param {HTMLElement | null} deps.row
 */
export function createLookPresets({ state, fxNames, toast, setMode, setTheme, setFx, saveSettings, row }) {
  const vocab = () => ({
    modeIds: MODES.map((m) => m.id),
    themeIds: ['auto', ...THEMES.map((t) => t.id)],
    fxNames,
  });

  function savePreset(slot) {
    const ok = writePreset(slot, { mode: state.modeId, theme: state.themeId, fx: { ...state.fx } }, vocab());
    toast(ok ? `LOOK <b>saved</b> to slot ${slot}` : 'Could not <b>save</b> — storage is full', { duration: 1600 });
    return ok;
  }

  function loadPreset(slot) {
    const p = readPresets(vocab())[slot];
    if (!p) { toast(`Slot <b>${slot}</b> is empty — right-click to save`, { duration: 2200 }); return; }
    if (p.mode) setMode(p.mode);
    if (p.theme) setTheme(p.theme);
    for (const [k, v] of Object.entries(p.fx)) setFx(k, v);
    saveSettings();
    toast(`LOOK <b>recalled</b> from slot ${slot}`, { duration: 1600 });
  }

  if (row) {
    const stored = readPresets(vocab());
    for (const slot of PRESET_SLOTS) {
      const b = document.createElement('button');
      b.className = 'fx-chip' + (stored[slot] ? ' is-active' : '');
      b.title = 'Click to recall · right-click to save';
      b.innerHTML = `<span class="chip-dot"></span><span class="chip-txt">P${slot}</span>`;
      b.addEventListener('click', () => loadPreset(slot));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // only light the chip if the write actually landed
        if (savePreset(slot)) b.classList.add('is-active');
      });
      row.appendChild(b);
    }
  }

  return { savePreset, loadPreset };
}
