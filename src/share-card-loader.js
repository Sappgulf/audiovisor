// @ts-check
/**
 * Lazy loader for the share card (snapshot PNG).
 *
 * The compositor is only needed when someone takes a snapshot, so
 * src/share-card.js is fetched on the first one. The frame it copies still
 * comes from the render loop, which stays in the entry, so the copy path is
 * the same as before.
 *
 * @param {object} deps  the same getters and callbacks createShareCard takes
 * @param {() => any} deps.getTheme
 * @param {() => string} deps.getModeName
 * @param {() => string | null | undefined} deps.getTrackName
 * @param {() => HTMLCanvasElement} deps.getLiveCanvas
 * @param {(blob: Blob, name: string) => void} deps.download
 * @param {(msg: string, opts?: object) => void} deps.toast
 */
export function createShareCardLoader(deps) {
  /** @type {Promise<{ snapshot: () => void } | null> | null} */
  let load = null;

  function ensureCard() {
    if (load) return load;
    load = import('./share-card.js')
      .then(({ createShareCard }) => createShareCard(deps))
      .catch((err) => {
        console.error('share card failed to load:', err);
        // allow a retry on the next snapshot
        load = null;
        deps.toast('<b>Snapshot unavailable</b> — could not load the share card', { duration: 3600 });
        return null;
      });
    return load;
  }

  function snapshot() {
    ensureCard().then((card) => card?.snapshot());
  }

  return { snapshot };
}
