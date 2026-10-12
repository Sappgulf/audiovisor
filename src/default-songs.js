// @ts-check
/**
 * Default songs to try without bringing a file.
 *
 * public/songs/manifest.json lists them, and the picks only appear when that
 * file exists, so the app ships without them until the audio is added. A pick
 * loads through the same path as a dropped file, so the queue, the library
 * and the visualiser treat it like any other track.
 */

/** @typedef {{ title: string, file: string, type: string }} DefaultSong */

const AUDIO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(m4a|mp3|ogg|opus|wav|flac)$/;
const TYPES = { m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac' };
const MAX_SONGS = 24;

/**
 * Keeps the well-formed entries. A file name must be a plain name inside
 * songs/: a path, a traversal or an unknown extension is dropped.
 * @param {unknown} raw
 * @returns {DefaultSong[]}
 */
export function parseSongManifest(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {DefaultSong[]} */
  const out = [];
  for (const entry of raw.slice(0, MAX_SONGS)) {
    const e = /** @type {any} */ (entry);
    if (!e || typeof e.title !== 'string' || typeof e.file !== 'string') continue;
    if (!AUDIO.test(e.file)) continue;
    const title = e.title.trim().slice(0, 60);
    if (!title) continue;
    const ext = e.file.split('.').pop() || '';
    out.push({ title, file: e.file, type: TYPES[/** @type {keyof typeof TYPES} */ (ext)] });
  }
  return out;
}

/**
 * @param {string} base  the app's base URL, e.g. "/"
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<DefaultSong[]>} an empty list when the manifest is missing or unreadable
 */
export async function fetchSongList(base, fetchFn = fetch) {
  try {
    const res = await fetchFn(`${base}songs/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return [];
    return parseSongManifest(await res.json());
  } catch {
    return [];
  }
}

/**
 * Fetches one song as a File, named after its title so the queue shows it.
 * @param {string} base
 * @param {DefaultSong} song
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<File>}
 */
export async function fetchSongFile(base, song, fetchFn = fetch) {
  const res = await fetchFn(`${base}songs/${song.file}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const ext = song.file.split('.').pop() || 'wav';
  const name = `${song.title.replace(/[\\/]/g, '-')}.${ext}`;
  return new File([blob], name, { type: song.type });
}
