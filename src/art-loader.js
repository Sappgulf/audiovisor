// @ts-check
/**
 * Lazy loaders for the two cover-art modules.
 *
 * Procedural art (albumart.js) is the picture a local file gets, since it has
 * no cover. It loads on the first local track. Palette extraction
 * (artpalette.js) only runs on a provider cover, so it loads the first time a
 * provider track with artwork arrives. Neither is needed for first paint, and
 * the name hash the Auto theme uses for artless files lives in utils.js, so a
 * local file never loads the palette module.
 *
 * @param {object} deps
 * @param {(msg: string, opts?: object) => void} deps.toast
 */
export function createArtLoader({ toast }) {
  /** @type {Promise<typeof import('./albumart.js') | null> | null} */
  let albumLoad = null;
  /** @type {typeof import('./artpalette.js') | null} */
  let palette = null;
  /** @type {Promise<typeof import('./artpalette.js') | null> | null} */
  let paletteLoad = null;

  /** @returns {Promise<typeof import('./albumart.js') | null>} */
  function loadAlbumArt() {
    if (albumLoad) return albumLoad;
    albumLoad = import('./albumart.js')
      .catch((err) => {
        console.error('album art failed to load:', err);
        // allow a retry on the next track
        albumLoad = null;
        toast('<b>Track art unavailable</b> — could not load the generator', { duration: 3000 });
        return null;
      });
    return albumLoad;
  }

  /** @returns {Promise<typeof import('./artpalette.js') | null>} */
  function loadPalette() {
    if (paletteLoad) return paletteLoad;
    paletteLoad = import('./artpalette.js')
      .then((m) => (palette = m))
      .catch((err) => {
        console.error('artwork palette failed to load:', err);
        // allow a retry on the next cover
        paletteLoad = null;
        toast('<b>Cover colours unavailable</b> — could not load the reader', { duration: 3000 });
        return null;
      });
    return paletteLoad;
  }

  return {
    loadAlbumArt,
    loadPalette,
    /** The palette module once loaded, else null. Synchronous for the Auto theme. */
    getPalette: () => palette,
  };
}
