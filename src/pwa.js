// @ts-check
/**
 * Service worker registration.
 *
 * Registers with `updateViaCache: 'none'` and forces an update so a stale
 * cache-first HTML self-heals. When a new worker takes control the build has
 * changed under us; reload once so the running page isn't a mix of old JS
 * and new assets. Without that a returning visitor could sit on a stale
 * build indefinitely.
 *
 * @param {Document} [doc]
 */
export function registerServiceWorker(doc = document) {
  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  if (!win) return;
  const sw = win.navigator?.serviceWorker;
  if (!sw) return;
  /* first install claims the page with no prior controller; reloading there
     threw away file selection/settings (and could drop an OAuth callback) */
  const hadController = !!sw.controller;
  sw.register('/sw.js', { updateViaCache: 'none' })
    .then((reg) => reg.update())
    .catch(() => {});
  let reloading = false;
  sw.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    win.location.reload();
  });
}
