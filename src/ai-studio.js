// @ts-check
import { AI_PRESETS, suggestPreset } from './ai.js';

/**
 * AI Remix Studio: the stem-solo chips and the preset suggestions.
 *
 * Stem isolation is a coarse bandpass on the engine's filter rather than
 * real source separation, but it is enough to solo vocals, bass or drums
 * for a look. Presets apply through `setFx`/`setTheme` so the chips, engine
 * and persisted state all move together.
 *
 * @param {object} deps
 * @param {any} deps.engine
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {(name: string, on: boolean) => void} deps.setFx
 * @param {(id: string) => void} deps.setTheme
 * @param {() => void} deps.saveSettings
 * @param {Document} [deps.doc]
 */
export function createAiStudio({ engine, toast, setFx, setTheme, saveSettings, doc = document }) {
  const stems = doc.getElementById('ai-stems');
  if (stems) {
    const buttons = new Map();
    let activeStem = null;
    const frequencies = { vocals: 3200, drums: 8000, bass: 180 };
    function restoreFilter() {
      if (!engine.filter) return;
      engine.filter.type = 'lowpass';
      engine.filter.frequency.setTargetAtTime(engine.fx.lowpass ? 400 : 22050, engine.ctx?.currentTime || 0, 0.08);
    }
    function setStem(name) {
      const next = activeStem === name ? null : name;
      if (next && !engine.filter) {
        toast('<b>Play something first</b>', { duration: 1600 });
        return;
      }
      activeStem = next;
      for (const [key, btn] of buttons) btn.classList.toggle('is-active', key === activeStem);
      if (!next) { restoreFilter(); toast('Stem <b>all</b>'); return; }
      engine.filter.type = 'bandpass';
      engine.filter.frequency.setTargetAtTime(frequencies[next], engine.ctx?.currentTime || 0, 0.08);
      toast(`Stem <b>${next}</b> solo`);
    }
    ['vocals', 'drums', 'bass'].forEach((name) => {
      const b = doc.createElement('button');
      b.className = 'fx-chip';
      b.innerHTML = `<span class="chip-dot"></span><span class="chip-txt">${name}</span>`;
      b.addEventListener('click', () => setStem(name));
      buttons.set(name, b);
      stems.appendChild(b);
    });
  }

  const presetsEl = doc.getElementById('ai-presets');
  if (presetsEl) {
    AI_PRESETS.forEach((pr) => {
      const b = doc.createElement('button');
      b.className = 'mini-btn';
      b.textContent = pr.name;
      b.addEventListener('click', () => {
        for (const [k, v] of Object.entries(pr.fx)) setFx(k, v);
        if (pr.theme) setTheme(pr.theme);
        saveSettings();
        toast(`AI <b>${pr.name}</b> applied`);
      });
      presetsEl.appendChild(b);
    });
  }

  doc.getElementById('ai-suggest')?.addEventListener('click', () => {
    const levels = engine.getLevels?.() || {};
    const bpm = engine.beat?.bpm || 0;
    const mood = doc.getElementById('mood-value')?.textContent?.trim() || '';
    const pr = suggestPreset({ ...levels, mood, bpm });
    for (const [k, v] of Object.entries(pr.fx)) setFx(k, !!v);
    setTheme(pr.theme);
    saveSettings();
    toast(`AI suggests <b>${pr.name}</b>${mood && mood !== '—' ? ` for ${mood}` : ''}`);
  });
}
