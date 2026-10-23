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

  return { loadFiles, openFilePicker, dropzone };
}
