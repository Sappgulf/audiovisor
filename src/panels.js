// @ts-check
import { setIcon } from './icons.js';
import { esc, fmtTime } from './utils.js';
import { clampActive } from './palette.js';
import * as Library from './library.js';

/**
 * Queue and library panels.
 *
 * Both are dialogs appended to the shell, both are listboxes driven by the
 * keyboard, and they are mutually exclusive when open — so they share one
 * owner rather than reaching into each other from main.js. The audio engine
 * and the storage-backed Library are injected, along with the app's toast
 * and setToggle helpers, so this module has no module-level coupling to the
 * orchestrator.
 *
 * @param {object} deps
 * @param {HTMLElement} deps.shell
 * @param {any} deps.engine
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {(el: HTMLElement | null, on: boolean, cls?: string) => void} deps.setToggle
 * @param {HTMLElement} deps.triggerQueue
 * @param {HTMLElement} deps.triggerLibrary
 * @param {HTMLElement | null} deps.saveLibraryBtn
 */
export function createPanels({ shell, engine, toast, setToggle, triggerQueue, triggerLibrary, saveLibraryBtn }) {
  const queuePanel = document.createElement('div');
  queuePanel.className = 'queue-panel is-hidden';
  queuePanel.setAttribute('role', 'dialog');
  queuePanel.setAttribute('aria-label', 'Queue');
  queuePanel.setAttribute('aria-hidden', 'true');
  shell.appendChild(queuePanel);

  const libraryPanel = document.createElement('div');
  libraryPanel.className = 'library-panel is-hidden';
  libraryPanel.setAttribute('role', 'dialog');
  libraryPanel.setAttribute('aria-label', 'Library');
  libraryPanel.setAttribute('aria-hidden', 'true');
  shell.appendChild(libraryPanel);

  let queueActiveIndex = 0;
  let libraryActiveIndex = 0;

  const libSearchInput = () => /** @type {HTMLInputElement | null} */ (libraryPanel.querySelector('#lib-search'));

  const getQueueRows = () => queuePanel.querySelectorAll('.queue-row');
  const getLibraryRows = () => libraryPanel.querySelectorAll('.library-row');

  function setQueueActive(index, doFocus = false) {
    const rows = getQueueRows();
    const list = queuePanel.querySelector('.queue-list');
    if (!rows.length) {
      queueActiveIndex = 0;
      list?.removeAttribute('aria-activedescendant');
      return;
    }
    queueActiveIndex = clampActive(index, rows.length);
    rows.forEach((row, i) => {
      row.tabIndex = i === queueActiveIndex ? 0 : -1;
      row.setAttribute('aria-selected', String(i === queueActiveIndex));
      if (i === queueActiveIndex && list) list.setAttribute('aria-activedescendant', row.id);
    });
    if (doFocus) rows[queueActiveIndex]?.focus();
  }

  function setLibraryActive(index, doFocus = false) {
    const rows = getLibraryRows();
    const list = libraryPanel.querySelector('.library-list');
    if (!rows.length) {
      libraryActiveIndex = 0;
      list?.removeAttribute('aria-activedescendant');
      return;
    }
    libraryActiveIndex = clampActive(index, rows.length);
    rows.forEach((row, i) => {
      row.tabIndex = i === libraryActiveIndex ? 0 : -1;
      row.setAttribute('aria-selected', String(i === libraryActiveIndex));
      if (i === libraryActiveIndex && list) list.setAttribute('aria-activedescendant', row.id);
    });
    if (doFocus) rows[libraryActiveIndex]?.focus();
  }

  function playQueueRow(index) {
    if (engine.captureActive || engine.micActive || engine.mode !== 'file') return;
    engine.playTrack(index);
    renderQueue();
    setQueueActive(index, true);
  }

  async function playLibraryRecord(id) {
    const rec = await Library.getLibraryEntry(id);
    if (!rec) return;
    if (engine.captureActive) await engine.toggleCapture();
    if (engine.micActive) await engine.toggleMic();
    if (engine.isExternal()) engine.pause();
    engine.stopStream();
    const blob = new Blob([rec.arrayBuffer]);
    const file = new File([blob], rec.name + '.' + rec.ext.toLowerCase());
    await engine.addToQueue([file]);
    if (rec.edits) {
      for (const [k, v] of Object.entries(rec.edits)) {
        if (v) engine.setFx(k, true);
      }
    }
    toggleLibrary(false);
    toast(`Loaded <b>${esc(rec.name)}</b> from library`);
  }

  libraryPanel.addEventListener('input', (e) => {
    if ((e.target instanceof HTMLInputElement) && e.target.id === 'lib-search') {
      renderLibrary();
    }
  });

  queuePanel.addEventListener('click', (e) => {
    const clear = e.target.closest('#queue-clear-btn');
    const shuffle = e.target.closest('#queue-shuffle-btn');
    const close = e.target.closest('#queue-close-btn');
    if (clear || shuffle || close) {
      if (clear) {
        clearQueue();
        return;
      }
      if (shuffle) {
        engine.shuffleQueue();
        renderQueue();
        setQueueActive(queueActiveIndex, false);
        toast('QUEUE <b>SHUFFLED</b>', { duration: 1200 });
        return;
      }
      if (close) {
        toggleQueue(false);
        return;
      }
    }

    const remove = e.target.closest('.queue-remove');
    if (remove) {
      const i = Number(remove.dataset.i);
      if (!Number.isNaN(i)) {
        engine.removeFromQueue(i);
        renderQueue();
        setQueueActive(clampActive(i, engine.queue.length), false);
      }
      return;
    }

    const row = e.target.closest('.queue-row');
    if (row) playQueueRow(Number(row.dataset.i));
  });

  queuePanel.addEventListener('keydown', (e) => {
    const rows = getQueueRows();
    if (e.target.closest('.queue-remove')) return;
    if (!rows.length) {
      if (e.key === 'Escape' && !queuePanel.classList.contains('is-hidden')) {
        e.preventDefault();
        toggleQueue(false);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      toggleQueue(false);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      setQueueActive(0, true);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      setQueueActive(rows.length - 1, true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setQueueActive(queueActiveIndex + 1, true);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setQueueActive(queueActiveIndex - 1, true);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      playQueueRow(queueActiveIndex);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      const i = rows[queueActiveIndex]?.dataset.i;
      if (i != null) {
        engine.removeFromQueue(Number(i));
        renderQueue();
        setQueueActive(clampActive(Number(i), engine.queue.length), true);
      }
    }
  });

  libraryPanel.addEventListener('click', (e) => {
    const close = e.target.closest('#lib-close');
    if (close) {
      toggleLibrary(false);
      return;
    }
    const btn = e.target.closest('.lib-play, .lib-export, .lib-del');
    if (btn) {
      const id = btn.dataset.id;
      if (btn.classList.contains('lib-play')) {
        void playLibraryRecord(id);
      } else if (btn.classList.contains('lib-export')) {
        void (async () => {
          const rec = await Library.getLibraryEntry(id);
          if (!rec || !rec.arrayBuffer) return;
          toast('Rendering <b>remix</b>…', { duration: 1600 });
          try {
            const buf = await engine.ctx.decodeAudioData(rec.arrayBuffer.slice(0));
            const blob = await Library.renderRemixToWav(buf, rec.edits || engine.fx);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${rec.name}-remix.wav`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
            toast('Remix <b>exported</b> as WAV', { duration: 2200 });
          } catch { toast('<b>Export failed</b>', { duration: 2000 }); }
        })();
      } else if (btn.classList.contains('lib-del')) {
        void (async () => {
          await Library.removeFromLibrary(id);
          renderLibrary();
          setLibraryActive(0, false);
        })();
      }
      return;
    }
    const row = e.target.closest('.library-row');
    if (row) {
      const idx = Number(row.dataset.index);
      if (!Number.isNaN(idx)) setLibraryActive(idx, true);
      void playLibraryRecord(row.dataset.id);
    }
  });

  libraryPanel.addEventListener('keydown', (e) => {
    const rows = getLibraryRows();
    if (e.target.closest('#lib-search')) return;
    if (e.target.closest('.lib-play, .lib-export, .lib-del')) return;
    if (!rows.length) {
      if (e.key === 'Escape' && !libraryPanel.classList.contains('is-hidden')) {
        e.preventDefault();
        toggleLibrary(false);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      toggleLibrary(false);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      setLibraryActive(0, true);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      setLibraryActive(rows.length - 1, true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setLibraryActive(libraryActiveIndex + 1, true);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setLibraryActive(libraryActiveIndex - 1, true);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      const id = rows[libraryActiveIndex]?.dataset.id;
      if (id) void playLibraryRecord(id);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      const id = rows[libraryActiveIndex]?.dataset.id;
      if (id) {
        void (async () => {
          await Library.removeFromLibrary(id);
          renderLibrary();
          setLibraryActive(libraryActiveIndex, true);
        })();
      }
    }
  });

  function renderQueue() {
    const q = engine.queue;
    const total = q.reduce((acc, t) => acc + (t.meta?.duration || 0), 0);
    const totalText = q.length ? ` · ${fmtTime(total)}` : '';
    let html = `
    <div class="queue-head">
      <span class="ic ic-lime" data-icon="list"></span>
      <span class="mono queue-title">QUEUE · ${q.length}${totalText}</span>
      <button class="mini-btn queue-clear-btn" id="queue-clear-btn" title="Clear queue" ${q.length ? '' : 'disabled'}>CLEAR</button>
      <button class="icon-x" id="queue-shuffle-btn" title="Shuffle queue"><span class="ic ic-sm" data-icon="shuffle"></span></button>
      <button class="icon-x" id="queue-close-btn" title="Close"><span class="ic ic-sm" data-icon="close"></span></button>
    </div>`;
    if (!q.length) {
      html += `<div class="queue-empty mono">DROP AUDIO FILES TO BUILD A QUEUE</div>`;
    } else {
      html += `<div class="queue-list" role="listbox" aria-label="Queue tracks">` + q.map((t, i) => `
      <div class="queue-row${i === engine.queueIndex ? ' is-active' : ''}" data-i="${i}" data-index="${i}" role="option" id="queue-row-${i}" tabindex="-1" aria-selected="false">
        <span class="mono queue-idx">${i === engine.queueIndex ? '▶' : String(i + 1).padStart(2, '0')}</span>
        <span class="queue-name">${esc(t.meta.name)}</span>
        <span class="mono queue-dur">${fmtTime(t.meta.duration)}</span>
        <button class="icon-x queue-remove" data-i="${i}" title="Remove"><span class="ic ic-sm" data-icon="close"></span></button>
      </div>`).join('') + `</div>`;
    }
    queuePanel.innerHTML = html;
    queuePanel.querySelectorAll('[data-icon]').forEach((el) => setIcon(el, el.dataset.icon));
    if (q.length) setQueueActive(clampActive(queueActiveIndex, q.length), false);
  }

  function clearQueue() {
    if (!engine.queue.length) return;
    engine.clearQueue();
    toast('QUEUE <b>CLEARED</b>', { duration: 1200 });
    renderQueue();
    setQueueActive(queueActiveIndex, false);
  }

  function toggleQueue(force) {
    const show = force ?? queuePanel.classList.contains('is-hidden');
    queuePanel.classList.toggle('is-hidden', !show);
    queuePanel.setAttribute('aria-hidden', String(!show));
    setToggle(triggerQueue, show);
    if (show) {
      queueActiveIndex = clampActive(engine.queueIndex, engine.queue.length);
      renderQueue();
      requestAnimationFrame(() => {
        const rows = getQueueRows();
        if (!rows.length) return;
        rows[queueActiveIndex]?.focus();
      });
    }
  }

  async function renderLibrary() {
    const wasSearchFocused = libraryPanel.contains(document.activeElement) && document.activeElement.id === 'lib-search';
    const baseMeta = await Library.listLibraryMeta();
    const q = (libSearchInput()?.value || '').trim().toLowerCase();
    const filteredMeta = q
      ? baseMeta.filter((m) => m.name.toLowerCase().includes(q) || (m.ext || '').toLowerCase().includes(q))
      : baseMeta;
    let html = `<div class="library-head"><span class="ic ic-lime" data-icon="layers"></span><span class="mono library-title">LIBRARY · ${filteredMeta.length}</span><button class="icon-x" id="lib-close" title="Close"><span class="ic ic-sm" data-icon="close"></span></button></div>
  <div style="padding:8px 12px; border-bottom:1px solid var(--border-soft)"><input id="lib-search" class="connect-input" placeholder="Search library…" style="width:100%; padding:7px 10px; font-size:11px"/></div>`;
    if (!filteredMeta.length) {
      html += `<div class="library-empty mono">${baseMeta.length ? 'NO MATCHING TRACKS — WIDEN YOUR SEARCH' : 'NO SAVED TRACKS — PLAY A TRACK THEN HIT SAVE'}</div>`;
    } else {
      html += `<div class="library-list" role="listbox" aria-label="Saved library tracks">` + filteredMeta.map((m, i) => `
      <div class="library-row ${m.edits ? 'is-remix' : ''}" data-id="${m.id}" data-index="${i}" role="option" id="lib-row-${i}" tabindex="-1" aria-selected="false">
        <div style="flex:1; min-width:0">
          <div class="library-name">${esc(m.name)} ${m.edits ? '<span style="font-size:9px; color:var(--accent); margin-left:6px">REMIX</span>' : ''}</div>
          <div class="mono library-meta">${esc(m.ext)} · ${(m.duration||0).toFixed(1)}s${m.edits ? ' · ' + Object.keys(m.edits).filter(k=>m.edits[k]).join(', ') : ''}</div>
        </div>
        <div class="library-actions">
          <button class="ghost-btn lib-play" data-id="${m.id}" title="Play"><span class="ic ic-sm" data-icon="play"></span></button>
          <button class="ghost-btn lib-export" data-id="${m.id}" title="Export WAV"><span class="ic ic-sm" data-icon="link"></span></button>
          <button class="icon-x lib-del" data-id="${m.id}" title="Delete"><span class="ic ic-sm" data-icon="close"></span></button>
        </div>
      </div>`).join('') + `</div>`;
    }
    libraryPanel.innerHTML = html;
    libraryPanel.querySelectorAll('[data-icon]').forEach(el => setIcon(el, el.dataset.icon));
    const sInput = libSearchInput();
    if (sInput) sInput.value = q;
    if (wasSearchFocused) {
      requestAnimationFrame(() => {
        const freshInput = libSearchInput();
        if (freshInput) {
          freshInput.focus();
          freshInput.setSelectionRange(freshInput.value.length, freshInput.value.length);
        }
      });
    }
    if (filteredMeta.length) setLibraryActive(0, false);
  }

  function toggleLibrary(force) {
    const show = force ?? libraryPanel.classList.contains('is-hidden');
    libraryPanel.classList.toggle('is-hidden', !show);
    libraryPanel.setAttribute('aria-hidden', String(!show));
    setToggle(triggerLibrary, show);
    if (show) {
      renderLibrary().then(() => {
        const sInput = libSearchInput();
        // open at the library search field for quick filtering
        sInput?.focus();
        sInput?.setSelectionRange(sInput.value.length, sInput.value.length);
        setTimeout(() => setLibraryActive(0, false), 0);
      });
    }
    if (show) { queuePanel.classList.add('is-hidden'); setToggle(triggerQueue, false); }
  }

  async function saveToLibrary() {
    if (!engine.buffer || !engine.track) { toast('<b>No track</b> to save', { duration: 1600 }); return; }
    // render the current buffer to WAV and store that
    try {
      const ch = engine.buffer.numberOfChannels;
      const len = engine.buffer.length;
      const tmp = new OfflineAudioContext(ch, len, engine.buffer.sampleRate);
      const src = tmp.createBufferSource(); src.buffer = engine.buffer; src.connect(tmp.destination); src.start(0);
      const rendered = await tmp.startRendering();
      const blob = await Library.renderRemixToWav(rendered, {});
      const ab = await blob.arrayBuffer();
      const edits = { ...engine.fx };
      const rec = await Library.addToLibrary({
        name: engine.track.name + (Object.values(edits).some(Boolean) ? ' (remix)' : ''),
        ext: 'WAV',
        sampleRate: engine.buffer.sampleRate,
        channels: ch,
        duration: engine.buffer.duration,
        arrayBuffer: ab,
        edits,
        sourceName: engine.track.name,
      });
      toast(`Saved <b>${esc(rec.name)}</b> to library`, { duration: 2000 });
    } catch (e) { console.error(e); toast('<b>Save failed</b>', { duration: 2000 }); }
  }

  triggerQueue.addEventListener('click', () => toggleQueue());
  triggerLibrary.addEventListener('click', () => toggleLibrary());
  saveLibraryBtn?.addEventListener('click', saveToLibrary);

  return {
    queuePanel,
    libraryPanel,
    renderQueue,
    renderLibrary,
    renderQueueIfOpen: () => { if (!queuePanel.classList.contains('is-hidden')) renderQueue(); },
    toggleQueue,
    toggleLibrary,
    clearQueue,
    saveToLibrary,
    isQueueOpen: () => !queuePanel.classList.contains('is-hidden'),
    isLibraryOpen: () => !libraryPanel.classList.contains('is-hidden'),
  };
}
