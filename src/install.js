// @ts-check
/**
 * PWA install prompt.
 *
 * Browsers fire beforeinstallprompt once and require the event to be held
 * until the user chooses to install. Keeping it here lets the command
 * palette and the More menu offer "Install app" without a visible install
 * button on first paint.
 */

/** @type {any} */
let deferred = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    window.dispatchEvent(new CustomEvent('audiovisor:installable'));
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    window.dispatchEvent(new CustomEvent('audiovisor:installed'));
  });
}

export function canInstall() {
  return !!deferred;
}

/**
 * Show the browser's install prompt.
 * @returns {Promise<'accepted'|'dismissed'|'unavailable'>}
 */
export async function promptInstall() {
  if (!deferred) return 'unavailable';
  const event = deferred;
  deferred = null;
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'dismissed';
  }
}
