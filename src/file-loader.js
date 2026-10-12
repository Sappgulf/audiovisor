// @ts-check
/**
 * File loading and the file picker.
 *
 * Owns the hidden input, the dropzone and the drag-and-drop handlers. The
 * picker has one entry point because the Add control and the Browse button
 * are `<label for>` elements that open it natively; `openFilePicker` is the
 * programmatic fallback for the stage shortcut, the command palette and the
 * transport play button.
 *
 * Accepts every type in formats.js. Video is decoded for its audio track only.
 * Playlists are parsed here and their links handed to `onPlaylist`.
 *
 * @param {object} deps
 * @param {any} deps.engine
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {() => void} deps.updateTrackUI
 * @param {() => void} deps.ensureAudible
 * @param {() => void} deps.closeMore
 * @param {(items: { name: string, url: string }[], sourceName: string, left: number) => void} [deps.onPlaylist]
 * @param {number} [deps.maxFileBytes]  decode size limit, MAX_FILE_BYTES unless a test lowers it
 * @param {Document} [deps.doc]
 */
import { ACCEPT_ATTR, extOf, isPlaylistFile, VIDEO_EXTENSIONS } from './formats.js';
import { collectDroppedFiles, isMediaFile } from './drop.js';
import { esc } from './utils.js';

/* The largest file we decode. The whole file is read into memory and
   decodeAudioData holds the decoded PCM on top of it, so a bigger file takes
   the tab down instead of failing politely. */
export const MAX_FILE_BYTES = 250 * 1024 * 1024;

const mb = (n) => `${(n / 1048576).toFixed(n < 104857600 ? 1 : 0)} MB`;

/** The engine reports a failure as a file name, or as { name, error } once it passes the error along. */
const failureOf = (f) => (typeof f === 'string' ? { name: f, error: null } : { name: f?.name || 'file', error: f?.error ?? null });

/** What a failed decode tells the user. EncodingError is what decodeAudioData rejects with for both an unsupported codec and a corrupt file. */
function failureText({ name, error }) {
  const n = `<b>${esc(name)}</b>`;
  const encoding = error?.name === 'EncodingError' || error?.name === 'NotSupportedError';
  if (encoding && VIDEO_EXTENSIONS.includes(extOf(name))) return `${n} has no audio track this browser can decode`;
  if (encoding) return `this browser can't decode ${n} — the format may be unsupported, or the file corrupt`;
  return `${n} couldn't be decoded — the file may be corrupt`;
}

export function createFileLoader({ engine, toast, updateTrackUI, ensureAudible, closeMore, onPlaylist, maxFileBytes = MAX_FILE_BYTES, doc = document }) {
  const $ = (id) => doc.getElementById(id);
  const fileInput = $('file-input');
  const dropzone = $('dropzone');
  const frame = dropzone.querySelector('.dropzone');
  const win = doc.defaultView || window;

  // the picker and the drop handler accept the same list, so the UI never offers a type that is refused here
  /** @type {HTMLInputElement} */ (fileInput).accept = ACCEPT_ATTR;

  const setStatus = (text) => {
    const el = $('status-text');
    if (el) el.textContent = text;
    $('status-pill')?.setAttribute('title', text);
  };

  /* One load at a time. A second drop while the first was still decoding used
     to interleave with it: both reset the engine's shared `evicted` count, and
     the two status updates raced. */
  let chain = Promise.resolve();
  function loadFiles(files) {
    // snapshot now: the picker empties its FileList as soon as this returns
    const picked = [...(files || [])];
    const run = chain.then(() => loadBatch(picked));
    chain = run.catch(() => {});
    return run;
  }

  async function loadBatch(picked) {
    const playlists = picked.filter((f) => isPlaylistFile(f.name));
    const media = picked.filter((f) => !isPlaylistFile(f.name) && isMediaFile(f));
    if (!media.length && !playlists.length) {
      if (picked.length) toast('<b>Unsupported</b> — drop audio or video, or an .m3u / .pls playlist', { duration: 3200 });
      return;
    }
    if (playlists.length) {
      try { await loadPlaylists(playlists); } catch (err) { console.error(err); toast('<b>Playlist</b> could not be read', { duration: 3000 }); }
    }

    // size and emptiness are checked here, before the engine calls arrayBuffer() on anything
    const ok = [];
    const oversized = [];
    for (const f of media) {
      if (typeof f.size === 'number' && f.size > maxFileBytes) oversized.push(f);
      else if (f.size !== 0) ok.push(f);
    }
    if (oversized.length) {
      const f = oversized[0];
      toast(`<b>${esc(f.name)}</b> is ${mb(f.size)} — the limit is ${mb(maxFileBytes)}${oversized.length > 1 ? ` · ${oversized.length} files skipped` : ''}`, { duration: 4000 });
    }
    const empty = media.find((f) => f.size === 0);
    if (empty) toast(`<b>${esc(empty.name)}</b> is empty`, { duration: 3000 });
    if (ok.length) await decodeBatch(ok);
  }

  async function decodeBatch(ok) {
    const before = $('status-text')?.textContent || '';
    try {
      if (engine.captureActive) await engine.toggleCapture();
      if (engine.isExternal()) engine.pause();
      engine.stopStream();
      setStatus('Decoding');
      const failed = (await engine.addToQueue(ok)).map(failureOf);
      const loaded = ok.length - failed.length;
      if (!engine.hasTrack || loaded <= 0) {
        // nothing new decoded: a track that was already playing is left alone
        if (!engine.hasTrack) setStatus('Decode failed');
        const reason = failed.length ? failureText(failed[0]) : 'no playable files';
        toast(`<b>Decode failed</b> — ${reason}${failed.length > 1 ? ` (+${failed.length - 1} more)` : ''}`, { duration: 4000 });
        return;
      }
      dropzone.classList.add('is-hidden');
      // never let a UI hiccup abort the load: the audio decoded fine by here
      try { updateTrackUI(); } catch (err) { console.error('track UI failed', err); }
      engine.play();
      ensureAudible();
      if (engine.evicted) {
        toast(`<b>${engine.evicted}</b> track${engine.evicted > 1 ? 's' : ''} unloaded to save memory — they reload on play`, { duration: 3200 });
      }
      if (failed.length) {
        toast(`Loaded <b>${loaded}</b> · skipped <b>${failed.length}</b> — ${failureText(failed[0])}`, { duration: 4000 });
      } else {
        toast(loaded > 1 ? `Loaded <b>${loaded} tracks</b> — queue playing` : `Loaded <b>${esc(engine.track?.name)}</b>`);
      }
    } catch (err) {
      console.error(err);
      setStatus('Decode failed');
      toast('<b>Decode failed</b> — file may be corrupted', { duration: 3000 });
    } finally {
      // a status left on "Decoding" reads as a load still running
      if ($('status-text')?.textContent === 'Decoding') setStatus(before);
    }
  }

  /** Playlist files are read as text. A local file has no base URL, so its relative links are dropped. */
  async function loadPlaylists(files) {
    const { parsePlaylistInfo } = await import('./playlist.js');
    for (const f of files) {
      let text = '';
      try { text = await f.text(); } catch { /* unreadable reads as empty below */ }
      const { entries: items, total } = parsePlaylistInfo(text);
      if (!items.length) {
        toast(`<b>${esc(f.name)}</b> has no web links to play`, { duration: 3200 });
      } else if (onPlaylist) {
        onPlaylist(items, f.name, total - items.length);
      } else {
        toast(`Found <b>${items.length}</b> links in <b>${esc(f.name)}</b>`, { duration: 3200 });
      }
    }
  }

  fileInput.addEventListener('change', () => {
    loadFiles(fileInput.files);
    fileInput.value = '';
  });

  function openFilePicker() {
    try {
      if (typeof fileInput.showPicker === 'function') { fileInput.showPicker(); return; }
    } catch { /* NotAllowedError outside a user gesture — fall through */ }
    try {
      fileInput.click();
    } catch {
      toast('Could not open the file picker — use <b>Browse files</b> on the stage', { duration: 4000 });
    }
  }

  // labels open the picker themselves; these keep keyboard users working
  $('add-btn')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFilePicker(); }
  });
  $('browse-label')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFilePicker(); }
  });
  const localFileLabel = /** @type {HTMLElement | null} */ ($('provider-playback')?.querySelector('.provider-playback-add'));
  localFileLabel?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFilePicker(); }
  });
  $('add-more-btn')?.addEventListener('click', () => { closeMore(); openFilePicker(); });
  $('stage').addEventListener('click', (e) => {
    // clicking the empty stage is a shortcut for "add files"; once a track is
    // loaded the stage belongs to the visuals
    if (dropzone.classList.contains('is-hidden')) return;
    // the drop card carries its own <label for>, so don't double-fire on it
    if (e.target.closest('button, label')) return;
    openFilePicker();
  });

  /* dragenter and dragleave fire for every child element the pointer crosses,
     so the overlay follows a depth count. Clearing it on each dragleave made
     it flicker whenever the pointer crossed a child, because browsers often
     leave relatedTarget null. */
  let dragDepth = 0;
  const showDrag = (on) => frame?.classList.toggle('drag-over', on);
  win.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    showDrag(true);
  });
  win.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    showDrag(true);
  });
  win.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) showDrag(false);
  });
  // a drag cancelled with Escape never fires a final dragleave, so drop and dragend reset the count
  const endDrag = () => { dragDepth = 0; showDrag(false); };
  win.addEventListener('dragend', endDrag);
  win.addEventListener('drop', (e) => {
    e.preventDefault();
    endDrag();
    // collectDroppedFiles reads the drop synchronously, then walks any folders
    collectDroppedFiles(e.dataTransfer).then(loadFiles, (err) => console.error(err));
  });

  return { loadFiles, openFilePicker, dropzone };
}
