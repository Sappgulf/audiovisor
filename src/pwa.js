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
  if (!('serviceWorker' in navigator)) return;
  /* first install claims the page with no prior controller; reloading there
     threw away file selection/settings (and could drop an OAuth callback) */
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
    .then((reg) => reg.update())
    .catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    (doc.defaultView || window).location.reload();
  });
}
