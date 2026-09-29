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

  function slotLabel(slot) {
    return `Look ${slot}`;
  }

  function paint() {
    if (!row) return;
    const stored = readPresets(vocab());
    for (const slot of PRESET_SLOTS) {
      const b = row.querySelector(`[data-slot="${slot}"]`);
      if (!b) continue;
      b.classList.toggle('is-active', !!stored[slot]);
      const txt = b.querySelector('.chip-txt');
      if (txt) txt.textContent = slotLabel(slot);
      const mode = MODES.find((m) => m.id === stored[slot]?.mode);
      const theme = THEMES.find((t) => t.id === stored[slot]?.theme);
      const saved = [mode?.name, theme?.name].filter(Boolean).join(' · ');
      b.setAttribute('title', stored[slot]
        ? `Recall ${saved || slotLabel(slot)}. Right-click to overwrite.`
        : 'Empty. Right-click to save the current look here.');
    }
  }

  if (row) {
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'fx-chip';
    save.title = 'Save the current mode, theme and FX into the next open slot';
    save.innerHTML = '<span class="chip-txt">Save look</span>';
    save.addEventListener('click', () => {
      const stored = readPresets(vocab());
      const slot = PRESET_SLOTS.find((s) => !stored[s]) || PRESET_SLOTS[0];
      if (savePreset(slot)) paint();
    });
    row.appendChild(save);

    for (const slot of PRESET_SLOTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fx-chip';
      b.dataset.slot = String(slot);
      b.innerHTML = '<span class="chip-dot"></span><span class="chip-txt"></span>';
      b.addEventListener('click', () => loadPreset(slot));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (savePreset(slot)) paint();
      });
      row.appendChild(b);
    }
    paint();
  }

  return { savePreset, loadPreset };
}
