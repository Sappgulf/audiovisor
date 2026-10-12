// @ts-check
/**
 * Queue playlist import: the file picker, the read and the stream rows it
 * adds, and playing one of those rows. Loaded on first use by the queue panel
 * so the parser and this code stay out of the entry chunk.
 */
import { parsePlaylist } from './playlist.js';
import { esc } from './utils.js';

/** M3U and PLS. Not an ACCEPT_ATTR, so this file does not pull in formats.js. */
const PLAYLIST_ACCEPT = '.m3u,.m3u8,.pls';
/* Real playlists are a few KB; anything past these limits is not one, so it is
   refused before it is read or queued. */
const PLAYLIST_MAX_BYTES = 256 * 1024;
const PLAYLIST_MAX_ITEMS = 500;

/** @type {{ engine: any, toast: Function, onQueued: () => void } | null} */
let current = null;
/** @type {HTMLInputElement | null} */
let input = null;

/**
 * Open the playlist picker. The chosen file is queued and onQueued() runs.
 * @param {HTMLElement} shell  the file input lives here, outside the re-rendered queue
 * @param {{ engine: any, toast: Function, onQueued: () => void }} deps
 */
export function pickPlaylist(shell, deps) {
  current = deps;
  if (!input?.isConnected) {
    input = document.createElement('input');
    input.type = 'file';
    input.accept = PLAYLIST_ACCEPT;
    input.id = 'playlist-file';
    input.hidden = true;
    shell.appendChild(input);
    input.addEventListener('change', () => {
      const file = input?.files?.[0];
      if (input) input.value = '';
      if (file && current) void importPlaylistFile(file, current);
    });
  }
  input.click();
}

/**
 * Read a playlist file and queue its entries. A local file has no address to
 * resolve against, so the parser is given no base: relative entries drop.
 * @param {File} file
 * @param {{ engine: any, toast: Function, onQueued: () => void }} deps
 */
export async function importPlaylistFile(file, deps) {
  if (file.size > PLAYLIST_MAX_BYTES) {
    deps.toast('<b>Playlist too large</b> — the limit is 256 KB', { duration: 2600 });
    return;
  }
  let text;
  try {
    text = await file.text();
  } catch {
    deps.toast('<b>Could not read</b> that playlist', { duration: 2600 });
    return;
  }
  let entries;
  try {
    entries = parsePlaylist(text) || [];
  } catch {
    entries = [];
  }
  queueEntries(entries, deps, file.name);
}

/**
 * Queue parsed playlist entries as stream items. Anything that is not a web
 * URL is dropped here as well as by the parser, so a playlist cannot queue a
 * file: or blob: target. Used by the picker and by a playlist dropped on the stage.
 * @param {{ name?: string, url: string }[]} entries
 * @param {{ engine: any, toast: Function, onQueued: () => void }} deps
 * @param {string} [sourceName]
 */
export function queueEntries(entries, { engine, toast, onQueued }, sourceName = '') {
  if (typeof engine.addUrlItems !== 'function') {
    toast('<b>Playlist import</b> is not available in this build', { duration: 2600 });
    return;
  }
  const items = entries
    .filter((e) => e && typeof e.url === 'string' && /^https?:\/\//i.test(e.url))
    .slice(0, PLAYLIST_MAX_ITEMS)
    .map((e) => ({
      url: e.url,
      meta: { name: String(e.name || e.url).slice(0, 200), ext: 'STREAM', duration: 0 },
    }));
  if (!items.length) {
    toast(`<b>No playable links</b> found${sourceName ? ` in <b>${esc(sourceName)}</b>` : ' in that playlist'}`, { duration: 2800 });
    return;
  }
  engine.addUrlItems(items);
  onQueued();
  const n = items.length;
  toast(`Imported <b>${n}</b> ${n === 1 ? 'track' : 'tracks'} from playlist`, { duration: 2200 });
}

/** A playlist entry is a URL stream: it takes over from whatever is playing. */
export async function playStreamItem(engine, item, toast) {
  if (engine.captureActive) await engine.toggleCapture();
  if (engine.micActive) await engine.toggleMic();
  try {
    await engine.playUrl(item.url, item.meta);
    toast(`Streaming <b>${esc(item.meta?.name || 'stream')}</b>`);
  } catch (err) {
    toast(`<b>Stream failed</b> — ${esc(err?.message || err)}`, { duration: 3400 });
  }
}
