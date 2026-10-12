// @ts-check
/**
 * Lazy loaders for the drawer's Source feed and Studio panel.
 *
 * The social feed (Source tab) and the AI stem and preset chips (Studio tab)
 * only exist inside their panels, and a panel is only visible once its tab is
 * open. So each module is fetched the first time its tab opens, and the tab
 * hook in main.js calls `ensure` for it. The factories build their DOM and
 * listeners as they run, so they are called once, on that first open.
 *
 * @param {object} deps
 * @param {any} deps.state
 * @param {any} deps.engine
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {(name: string, on: boolean) => void} deps.setFx
 * @param {(id: string) => void} deps.setTheme
 * @param {() => void} deps.saveSettings
 */
export function createDrawerSections({ state, engine, toast, setFx, setTheme, saveSettings }) {
  /* a failed fetch toasts and re-arms, so the next tab open retries it */
  function once(load, label) {
    let pending = null;
    return () => {
      pending ??= load().catch((err) => {
        console.error(`${label} failed to load:`, err);
        pending = null;
        toast(`<b>${label} unavailable</b> — could not load it`, { duration: 3600 });
        return null;
      });
      return pending;
    };
  }

  /** @type {() => Promise<unknown>} */
  const ensureSocial = once(
    () => import('./social-ui.js').then(({ createSocialFeed }) => createSocialFeed({ state, toast })),
    'Social feed',
  );
  /** @type {() => Promise<unknown>} */
  const ensureStudio = once(
    () => import('./ai-studio.js').then(({ createAiStudio }) => createAiStudio({ engine, toast, setFx, setTheme, saveSettings })),
    'AI studio',
  );

  /** @type {() => Promise<unknown>} */
  const ensureAudio = once(
    () => import('./audio-tab.js').then(({ createAudioTab }) => createAudioTab({ engine, saveSettings })),
    'Audio tab',
  );

  return { ensureSocial, ensureStudio, ensureAudio };
}
