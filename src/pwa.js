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
 * A reload mid-track or mid-capture cuts the audio off, so `isBusy` can hold
 * it back; the check repeats until the app is idle. Without it the reload is
 * immediate, as before.
 *
 * @param {Document} [doc]
 * @param {{ isBusy?: () => boolean }} [opts]
 */
export function registerServiceWorker(doc = document, { isBusy = () => false } = {}) {
  if (!('serviceWorker' in navigator)) return;
  /* A page no worker ever controlled was already loaded from the network, so
     the first install's controllerchange has nothing stale to replace. The
     worker claims clients on install, which used to reload every first visit
     a second time. Only a worker that replaces one serving this page reloads. */
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
    .then((reg) => reg.update())
    .catch(() => {});
  let reloading = false;
  const reloadWhenIdle = () => {
    if (isBusy()) { setTimeout(reloadWhenIdle, 15000); return; }
    (doc.defaultView || window).location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    reloadWhenIdle();
  });
}
