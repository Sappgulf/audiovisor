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
    ['vocals', 'drums', 'bass'].forEach((s) => {
      const b = doc.createElement('button');
      b.className = 'fx-chip';
      b.innerHTML = `<span class="chip-dot"></span><span class="chip-txt">${s}</span>`;
      b.addEventListener('click', () => {
        b.classList.toggle('is-active');
        const on = b.classList.contains('is-active');
        if (!engine.filter) { toast('<b>Play something first</b>', { duration: 1600 }); b.classList.remove('is-active'); return; }
        // stem isolation via filter
        if (s === 'vocals') engine.filter.frequency.setTargetAtTime(on ? 3200 : 22050, engine.ctx?.currentTime || 0, 0.08);
        if (s === 'bass') engine.filter.frequency.setTargetAtTime(on ? 180 : 22050, engine.ctx?.currentTime || 0, 0.08);
        if (s === 'drums') engine.filter.frequency.setTargetAtTime(on ? 8000 : 22050, engine.ctx?.currentTime || 0, 0.08);
        engine.filter.type = 'bandpass';
        if (!on) { engine.filter.type = 'lowpass'; engine.filter.frequency.setTargetAtTime(engine.fx.lowpass ? 400 : 22050, engine.ctx?.currentTime || 0, 0.08); }
        toast(`Stem <b>${s}</b> ${on ? 'solo' : 'all'}`);
      });
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
    const pr = suggestPreset(Math.floor(Math.random() * 9999));
    for (const [k, v] of Object.entries(pr.fx)) setFx(k, !!v);
    setTheme(pr.theme);
    saveSettings();
    toast(`AI suggests <b>${pr.name}</b>`);
  });
}
