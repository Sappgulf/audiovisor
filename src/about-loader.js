// @ts-check
/**
 * Lazy loader for the About dialog.
 *
 * The dialog's markup, focus trap and copy are only needed once someone opens
 * About, so src/about.js is fetched on the first click of the nav button. That
 * click opens the dialog as soon as the module lands. From then on the
 * module's own trigger listener handles clicks, and this one steps aside.
 * `isOpen` and `setOpen` forward to the real dialog once it exists, because
 * the keyboard shortcuts hold on to this object from boot.
 *
 * @param {object} deps
 * @param {HTMLElement} deps.shell
 * @param {HTMLElement} deps.trigger
 * @param {number} deps.modeCount
 * @param {number} deps.themeCount
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {Document} [deps.doc]
 */
export function createAboutLoader({ shell, trigger, modeCount, themeCount, toast, doc = document }) {
  /** @type {{ isOpen: () => boolean, setOpen: (open: boolean) => void } | null} */
  let about = null;
  /** @type {Promise<typeof about> | null} */
  let load = null;
  /* the user's last click while the module is in flight */
  let wanted = false;

  function ensureAbout() {
    if (load) return load;
    load = import('./about.js')
      .then(({ createAboutPanel }) => {
        about = createAboutPanel({ shell, trigger, modeCount, themeCount, doc });
        return about;
      })
      .catch((err) => {
        console.error('About panel failed to load:', err);
        // allow a retry on the next click
        load = null;
        wanted = false;
        toast('<b>About unavailable</b> — could not load the dialog', { duration: 3600 });
        return null;
      });
    return load;
  }

  // Clicks before the dialog exists land here. Once it does, its own trigger
  // listener is attached and this one returns early.
  trigger.addEventListener('click', () => {
    if (about) return;
    wanted = !wanted;
    if (wanted) ensureAbout().then((a) => { if (a && wanted) a.setOpen(true); });
  });

  return {
    isOpen: () => (about ? about.isOpen() : false),
    setOpen: (open) => { if (about) about.setOpen(open); },
  };
}
