// @ts-check
/**
 * Deferred Studio wiring.
 *
 * AI presets, collab/share, the local social feed, Voice AI and MIDI are not
 * on the first-frame path. They live in this chunk and are mounted on idle or
 * on first interaction, keeping the boot payload small without changing what
 * the user sees when they open the Studio tab.
 */
import { createAiStudio } from './ai-studio.js';
import { createCollab } from './collab.js';
import { createSocialFeed } from './social-ui.js';
import { createVoiceInput } from './voice-ui.js';
import { createMidiInput } from './midi.js';

export function mountStudio({
  engine, renderer, state, toast, setMode, setTheme, setFx, setCustomTheme,
  saveSettings, setSlider, setToggle, fxNames, modes, chip, getFx,
}) {
  createMidiInput({ chip, fxNames, modes, setSlider, setFx, getFx, setMode, toast, setToggle });
  createAiStudio({ engine, toast, setFx, setTheme, saveSettings });
  createCollab({ state, toast, setMode, setTheme, setFx, setCustomTheme });
  createVoiceInput({ engine, renderer, toast });
  createSocialFeed({ state, toast });
}
