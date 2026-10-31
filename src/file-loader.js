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
 * @param {object} deps
 * @param {any} deps.engine
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {() => void} deps.updateTrackUI
 * @param {() => void} deps.ensureAudible
 * @param {() => void} deps.closeMore
 * @param {Document} [deps.doc]
 */
import { esc } from './utils.js';

export function createFileLoader({ engine, toast, updateTrackUI, ensureAudible, closeMore, doc = document }) {
  const $ = (id) => doc.getElementById(id);
  const fileInput = $('file-input');
  const dropzone = $('dropzone');
  const entryTitle = dropzone.querySelector('.drop-title');
  const readyTitle = entryTitle?.textContent;
  let pending = 0;

  async function loadFiles(files) {
    if (!files || !files.length) return;
    const audioFiles = [...files].filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|flac|ogg|m4a|aac|opus|webm)$/i.test(f.name));
    if (!audioFiles.length) {
      toast('<b>Unsupported</b> — drop an audio file');
      return;
    }
    pending++;
    dropzone.setAttribute('aria-busy', 'true');
    if (entryTitle) entryTitle.textContent = 'Opening audio…';
    try {
      if (engine.captureActive) await engine.toggleCapture();
      if (engine.isExternal()) engine.pause();
      engine.stopStream();
      $('status-text').textContent = 'Decoding';
      $('status-pill')?.setAttribute('title', 'Decoding');
      const errors = await engine.addToQueue(audioFiles);
      if (!engine.hasTrack) {
        $('status-text').textContent = 'Decode failed';
        $('status-pill')?.setAttribute('title', 'Decode failed');
        toast('<b>Decode failed</b> — no playable files', { duration: 3000 });
        return;
      }
      dropzone.classList.add('is-hidden');
      // never let a UI hiccup abort the load: the audio decoded fine by here
      try { updateTrackUI(); } catch (err) { console.error('track UI failed', err); }
      engine.play();
      ensureAudible();
      const loaded = audioFiles.length - errors.length;
      if (engine.evicted) {
        toast(`<b>${engine.evicted}</b> track${engine.evicted > 1 ? 's' : ''} unloaded to save memory — they reload on play`, { duration: 3200 });
      }
      toast(errors.length
        ? `Loaded <b>${loaded}</b> · skipped <b>${errors.length}</b> corrupt`
        : (loaded > 1 ? `Loaded <b>${loaded} tracks</b> — queue playing` : `Loaded <b>${esc(engine.track.name)}</b>`));
    } catch (err) {
      console.error(err);
      $('status-text').textContent = 'Decode failed';
      $('status-pill')?.setAttribute('title', 'Decode failed');
      toast('<b>Decode failed</b> — file may be corrupted', { duration: 3000 });
    } finally {
      pending--;
      if (!pending) {
        dropzone.setAttribute('aria-busy', 'false');
        if (entryTitle) entryTitle.textContent = readyTitle;
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

  // Sample tracks live in public/samples. They go through loadFiles like any
  // picked file, so decode, toasts and the dropzone hand-off all match.
  const sampleButtons = /** @type {HTMLButtonElement[]} */ ([...doc.querySelectorAll('[data-sample]')]);
  async function loadSample(btn) {
    const name = btn.dataset.sampleName || btn.dataset.sample;
    const label = btn.textContent;
    sampleButtons.forEach((b) => { b.disabled = true; });
    btn.setAttribute('aria-busy', 'true');
    btn.setAttribute('aria-label', `Loading ${name}`);
    btn.textContent = 'Loading…';
    toast(`Loading <b>${name}</b>…`, { duration: 2000 });
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/${btn.dataset.sample}.mp3`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      await loadFiles([new File([blob], `${name}.mp3`, { type: 'audio/mpeg' })]);
    } catch (err) {
      console.error(err);
      toast(`<b>Couldn't load ${name}</b> — try again`, { duration: 3000 });
    } finally {
      btn.textContent = label;
      btn.removeAttribute('aria-busy');
      btn.removeAttribute('aria-label');
      sampleButtons.forEach((b) => { b.disabled = false; });
    }
  }
  sampleButtons.forEach((btn) => btn.addEventListener('click', () => loadSample(btn)));

  ['dragenter', 'dragover'].forEach((ev) =>
    (doc.defaultView || window).addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.querySelector('.dropzone').classList.add('drag-over');
    })
  );
  (doc.defaultView || window).addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) dropzone.querySelector('.dropzone').classList.remove('drag-over');
  });
  (doc.defaultView || window).addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.querySelector('.dropzone').classList.remove('drag-over');
    loadFiles(e.dataTransfer.files);
  });

  /* ---------- OS integration ---------- */

  /** Take the file a share_target POST parked in the service-worker cache. */
  async function takeSharedFile() {
    const win = /** @type {any} */ (doc.defaultView || window);
    if (!win.caches) return null;
    try {
      for (const name of await win.caches.keys()) {
        const cache = await win.caches.open(name);
        const res = await cache.match('/__shared_audio__');
        if (!res) continue;
        await cache.delete('/__shared_audio__');
        const blob = await res.blob();
        const named = res.headers.get('X-File-Name');
        let decoded = named ? decodeURIComponent(named) : 'shared-audio';
        if (!named) {
          const disposition = res.headers.get('Content-Disposition') || '';
          const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
          if (match) {
            try { decoded = decodeURIComponent(match[1].replace(/"/g, '')); } catch { /* keep fallback */ }
          }
        }
        return new File([blob], decoded, { type: res.headers.get('Content-Type') || blob.type || 'audio/mpeg' });
      }
    } catch { /* cache unavailable in private mode */ }
    return null;
  }

  const shared = new URLSearchParams((doc.defaultView || window).location.search).get('shared');
  if (shared === '1') {
    takeSharedFile().then((file) => {
      if (file) loadFiles([file]);
      const win = /** @type {any} */ (doc.defaultView || window);
      const clean = new URL(win.location.href);
      clean.searchParams.delete('shared');
      win.history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
    });
  }

  const launchQueue = /** @type {any} */ (doc.defaultView || window).launchQueue;
  launchQueue?.setConsumer?.(async (params) => {
    const files = [];
    for (const handle of params.files || []) {
      try { files.push(await handle.getFile()); } catch { /* stale handle */ }
    }
    if (files.length) loadFiles(files);
  });

  return { loadFiles, openFilePicker, dropzone };
}
