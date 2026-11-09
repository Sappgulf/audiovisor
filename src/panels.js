// @ts-check
import { setIcon } from './icons.js';
import { esc, fmtTime } from './utils.js';
import { clampActive } from './palette.js';
import * as Library from './library.js';

function fmtBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Push saved EQ gains through the real inputs so UI, engine and settings agree. */
function applyEqGains(gains) {
  const inputs = document.querySelectorAll('.eq-row input[type="range"]');
  inputs.forEach((node, i) => {
    const input = /** @type {HTMLInputElement} */ (node);
    const v = Number(gains[i]);
    if (!Number.isFinite(v)) return;
    input.value = String(Math.max(-10, Math.min(10, v)));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

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
 * @param {(name: string, on: boolean) => void} deps.setFx
 * @param {HTMLElement} deps.triggerQueue
 * @param {HTMLElement} deps.triggerLibrary
 * @param {HTMLElement | null} deps.saveLibraryBtn
 */
export function createPanels({ shell, engine, toast, setToggle, setFx, triggerQueue, triggerLibrary, saveLibraryBtn }) {
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
  let queueDragIndex = null;
  let queueReturnFocus = null;
  let libraryReturnFocus = null;

  /** Return focus to whatever opened a panel, falling back to its trigger. */
  function restorePanelFocus(el, fallback, panel) {
    const target = el?.isConnected && !el.hasAttribute('disabled') ? el : fallback;
    (window.requestAnimationFrame || setTimeout)(() => {
      if (!panel.classList.contains('is-hidden')) return;
      target?.focus?.();
    });
  }

  const libSearchInput = () => /** @type {HTMLInputElement | null} */ (libraryPanel.querySelector('#lib-search'));

  const getQueueRows = () => queuePanel.querySelectorAll('.queue-row');
  const getLibraryRows = () => libraryPanel.querySelectorAll('.library-row');

  function setQueueActive(index, doFocus = false) {
    const rows = getQueueRows();
    if (!rows.length) {
      queueActiveIndex = 0;
      return;
    }
    queueActiveIndex = clampActive(index, rows.length);
    rows.forEach((row, i) => {
      row.tabIndex = i === queueActiveIndex ? 0 : -1;
      row.classList.toggle('is-selected', i === queueActiveIndex);
      row.setAttribute('aria-current', String(i === queueActiveIndex));
    });
    if (doFocus) rows[queueActiveIndex]?.focus();
  }

  function setLibraryActive(index, doFocus = false) {
    const rows = getLibraryRows();
    if (!rows.length) {
      libraryActiveIndex = 0;
      return;
    }
    libraryActiveIndex = clampActive(index, rows.length);
    rows.forEach((row, i) => {
      row.tabIndex = i === libraryActiveIndex ? 0 : -1;
      row.classList.toggle('is-selected', i === libraryActiveIndex);
      row.setAttribute('aria-current', String(i === libraryActiveIndex));
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
      /* Restore the exact saved chain. The old loop only re-enabled the FX
         stored as true, so effects from the previous session stayed on and
         a "remix" was never the remix that was saved. */
      for (const k of Object.keys(engine.fx || {})) setFx(k, !!rec.edits[k]);
    }
    if (Array.isArray(rec.eq)) applyEqGains(rec.eq);
    toggleLibrary(false);
    toast(`Loaded <b>${esc(rec.name)}</b> from library`);
  }

  /** @type {ReturnType<typeof setTimeout> | null} */
  let libSearchTimer = null;
  libraryPanel.addEventListener('input', (e) => {
    if ((e.target instanceof HTMLInputElement) && e.target.id === 'lib-search') {
      if (e.isComposing) return;
      if (libSearchTimer) clearTimeout(libSearchTimer);
      libSearchTimer = setTimeout(() => renderLibrary(), 140);
    }
  });

  queuePanel.addEventListener('click', (e) => {
    if (e.target.closest('.queue-grip')) return;
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

    const next = e.target.closest('.queue-next');
    if (next) {
      const i = Number(next.dataset.i);
      if (!Number.isNaN(i) && engine.playNext(i)) {
        renderQueue();
        setQueueActive(clampActive(engine.queueIndex + 1, engine.queue.length), false);
        toast('Queued <b>next</b>', { duration: 1200 });
      }
      return;
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

  queuePanel.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.queue-row');
    if (!row) return;
    queueDragIndex = Number(row.dataset.i);
    row.classList.add('is-dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(queueDragIndex)); } catch { /* Firefox needs this */ }
    }
  });
  queuePanel.addEventListener('dragover', (e) => {
    if (queueDragIndex === null) return;
    const row = e.target.closest('.queue-row');
    if (!row) return;
    e.preventDefault();
    getQueueRows().forEach((r) => r.classList.toggle('is-drop', r === row));
  });
  queuePanel.addEventListener('dragleave', (e) => {
    if (!queuePanel.contains(/** @type {Node | null} */ (e.relatedTarget))) getQueueRows().forEach((r) => r.classList.remove('is-drop'));
  });
  queuePanel.addEventListener('drop', (e) => {
    const row = e.target.closest('.queue-row');
    if (!row || queueDragIndex === null) return;
    e.preventDefault();
    const to = Number(row.dataset.i);
    if (engine.moveQueueItem(queueDragIndex, to)) {
      renderQueue();
      setQueueActive(to, true);
    }
    queueDragIndex = null;
    getQueueRows().forEach((r) => r.classList.remove('is-drop', 'is-dragging'));
  });
  queuePanel.addEventListener('dragend', () => {
    queueDragIndex = null;
    getQueueRows().forEach((r) => r.classList.remove('is-drop', 'is-dragging'));
  });

  /* Native HTML5 drag is desktop-only. Touch and pen users get the same
     reorder from the grip handle with Pointer Events, which also keeps the
     gesture alive when the finger leaves the row. */
  let pointerDrag = null;
  queuePanel.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('.queue-grip');
    const row = grip?.closest('.queue-row');
    if (!row || !grip) return;
    e.preventDefault();
    pointerDrag = { from: Number(row.dataset.i), id: e.pointerId };
    try { grip.setPointerCapture(e.pointerId); } catch { /* move still works */ }
    row.classList.add('is-dragging');
  });
  queuePanel.addEventListener('pointermove', (e) => {
    if (!pointerDrag || e.pointerId !== pointerDrag.id) return;
    const hit = /** @type {HTMLElement | null} */ (document.elementFromPoint(e.clientX, e.clientY));
    const row = /** @type {HTMLElement | null} */ (hit?.closest('.queue-row'));
    getQueueRows().forEach((r) => r.classList.toggle('is-drop', r === row));
  });
  const endPointerDrag = (e) => {
    if (!pointerDrag || e.pointerId !== pointerDrag.id) return;
    const hit = /** @type {HTMLElement | null} */ (document.elementFromPoint(e.clientX, e.clientY));
    const row = /** @type {HTMLElement | null} */ (hit?.closest('.queue-row'));
    const to = row ? Number(row.dataset.i) : pointerDrag.from;
    const from = pointerDrag.from;
    pointerDrag = null;
    getQueueRows().forEach((r) => r.classList.remove('is-drop', 'is-dragging'));
    if (to !== from && engine.moveQueueItem(from, to)) {
      renderQueue();
      setQueueActive(to, true);
    }
  };
  queuePanel.addEventListener('pointerup', endPointerDrag);
  queuePanel.addEventListener('pointercancel', () => {
    pointerDrag = null;
    getQueueRows().forEach((r) => r.classList.remove('is-drop', 'is-dragging'));
  });

  queuePanel.addEventListener('keydown', (e) => {
    const rows = getQueueRows();
    if (e.target.closest('button') && e.key !== 'Escape') return;
    if (e.target.closest('.queue-remove')) return;
    if (!rows.length) {
      if (e.key === 'Escape' && !queuePanel.classList.contains('is-hidden')) {
        e.preventDefault();
        e.stopPropagation();
        toggleQueue(false);
      }
      return;
    }
    if (e.key === 'Escape') {
      // consume the event so the drawer below does not also close
      e.preventDefault();
      e.stopPropagation();
      toggleQueue(false);
      return;
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopPropagation();
      const to = clampActive(queueActiveIndex + (e.key === 'ArrowUp' ? -1 : 1), rows.length);
      if (engine.moveQueueItem(queueActiveIndex, to)) {
        renderQueue();
        setQueueActive(to, true);
      }
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
    if (e.target.closest('#lib-clear')) {
      const win = libraryPanel.ownerDocument.defaultView;
      if (!win?.confirm?.('Delete every saved track from this device?')) return;
      void (async () => {
        await Library.clearLibrary();
        renderLibrary();
        setLibraryActive(0, false);
        toast('Library <b>cleared</b>', { duration: 1600 });
      })();
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
            const blob = await Library.renderRemixToWav(buf, rec.edits || engine.fx, rec.eq || []);
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
    if (e.target.closest('button') && e.key !== 'Escape') return;
    if (e.target.closest('#lib-search')) return;
    if (e.target.closest('.lib-play, .lib-export, .lib-del')) return;
    if (!rows.length) {
      if (e.key === 'Escape' && !libraryPanel.classList.contains('is-hidden')) {
        e.preventDefault();
        e.stopPropagation();
        toggleLibrary(false);
      }
      return;
    }
    if (e.key === 'Escape') {
      // consume the event so the drawer below does not also close
      e.preventDefault();
      e.stopPropagation();
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
    queueDragIndex = null;
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
      html += `<div class="queue-list" role="list" aria-label="Queue tracks. Drag the grip or press Alt+Up/Alt+Down to reorder.">` + q.map((t, i) => `
      <div class="queue-row${i === engine.queueIndex ? ' is-active' : ''}" data-i="${i}" data-index="${i}" draggable="true" role="listitem" id="queue-row-${i}" tabindex="-1" aria-current="false">
        <span class="queue-grip" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
        <span class="mono queue-idx">${i === engine.queueIndex ? '▶' : String(i + 1).padStart(2, '0')}</span>
        <span class="queue-name">${esc(t.meta.name)}</span>
        <span class="mono queue-dur">${fmtTime(t.meta.duration)}</span>
        <button class="icon-x queue-next" data-i="${i}" title="Play next" draggable="false" ${i === engine.queueIndex ? 'disabled' : ''}><span class="ic ic-sm" data-icon="skip-fwd"></span></button>
        <button class="icon-x queue-remove" data-i="${i}" title="Remove" draggable="false"><span class="ic ic-sm" data-icon="close"></span></button>
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
    const wasHidden = queuePanel.classList.contains('is-hidden');
    if (show && wasHidden) {
      /* when switching from the library, the focused element is a row that
         is about to be hidden; return to the trigger instead */
      queueReturnFocus = libraryPanel.contains(document.activeElement)
        ? triggerQueue : document.activeElement;
    }
    if (show && !libraryPanel.classList.contains('is-hidden')) {
      /* switching panels: the newly opened panel owns focus, so do not
         schedule a focus restore that would steal it a frame later */
      libraryPanel.classList.add('is-hidden');
      libraryPanel.setAttribute('aria-hidden', 'true');
      setToggle(triggerLibrary, false);
      libraryReturnFocus = null;
    }
    queuePanel.classList.toggle('is-hidden', !show);
    queuePanel.setAttribute('aria-hidden', String(!show));
    setToggle(triggerQueue, show);
    if (show) {
      queueActiveIndex = clampActive(engine.queueIndex, engine.queue.length);
      renderQueue();
      requestAnimationFrame(() => {
        const rows = getQueueRows();
        if (rows.length) rows[queueActiveIndex]?.focus();
        else queuePanel.querySelector('#queue-close-btn')?.focus();
      });
    } else {
      restorePanelFocus(queueReturnFocus, triggerQueue, queuePanel);
      queueReturnFocus = null;
    }
  }

  let libRenderSeq = 0;
  async function renderLibrary() {
    const seq = ++libRenderSeq;
    const wasSearchFocused = libraryPanel.contains(document.activeElement) && document.activeElement.id === 'lib-search';
    const baseMeta = await Library.listLibraryMeta();
    if (seq !== libRenderSeq) return;
    const q = (libSearchInput()?.value || '').trim().toLowerCase();
    const filteredMeta = q
      ? baseMeta.filter((m) => m.name.toLowerCase().includes(q) || (m.ext || '').toLowerCase().includes(q))
      : baseMeta;
    const totalBytes = baseMeta.reduce((n, m) => n + (Number(m.bytes) || 0), 0);
    const totalLabel = fmtBytes(totalBytes);
    let html = `<div class="library-head"><span class="ic ic-lime" data-icon="layers"></span><span class="mono library-title">LIBRARY · ${filteredMeta.length}</span><button class="icon-x" id="lib-close" title="Close"><span class="ic ic-sm" data-icon="close"></span></button></div>
  <div class="library-search"><input id="lib-search" class="connect-input" placeholder="Search library…" aria-label="Search saved tracks"/></div>`;
    if (!filteredMeta.length) {
      html += `<div class="library-empty mono">${baseMeta.length ? 'NO MATCHING TRACKS — WIDEN YOUR SEARCH' : 'NO SAVED TRACKS — PLAY A TRACK THEN HIT SAVE'}</div>`;
    } else {
      html += `<div class="library-list" role="list" aria-label="Saved library tracks">` + filteredMeta.map((m, i) => `
      <div class="library-row ${m.edits ? 'is-remix' : ''}" data-id="${m.id}" data-index="${i}" role="listitem" id="lib-row-${i}" tabindex="-1" aria-current="false">
        <div class="library-copy">
          <div class="library-name">${esc(m.name)} ${m.edits ? '<span class="library-remix-tag">REMIX</span>' : ''}</div>
          <div class="mono library-meta">${esc(m.ext)} · ${(m.duration||0).toFixed(1)}s${m.bytes ? ' · ' + fmtBytes(m.bytes) : ''}${m.edits ? ' · ' + Object.keys(m.edits).filter(k=>m.edits[k]).join(', ') : ''}</div>
        </div>
        <div class="library-actions">
          <button class="ghost-btn lib-play" data-id="${m.id}" title="Play"><span class="ic ic-sm" data-icon="play"></span></button>
          <button class="ghost-btn lib-export" data-id="${m.id}" title="Export WAV"><span class="ic ic-sm" data-icon="link"></span></button>
          <button class="icon-x lib-del" data-id="${m.id}" title="Delete"><span class="ic ic-sm" data-icon="close"></span></button>
        </div>
      </div>`).join('') + `</div>`;
    }
    html += `<div class="library-foot mono">
      <span>${totalLabel} on this device</span>
      <button class="mini-btn" id="lib-clear" ${baseMeta.length ? '' : 'disabled'}>CLEAR ALL</button>
    </div>`;
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
    const wasHidden = libraryPanel.classList.contains('is-hidden');
    if (show && wasHidden) {
      libraryReturnFocus = queuePanel.contains(document.activeElement)
        ? triggerLibrary : document.activeElement;
    }
    if (show && !queuePanel.classList.contains('is-hidden')) {
      /* switching panels: the library search field will take focus */
      queuePanel.classList.add('is-hidden');
      queuePanel.setAttribute('aria-hidden', 'true');
      setToggle(triggerQueue, false);
      queueReturnFocus = null;
    }
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
    } else {
      restorePanelFocus(libraryReturnFocus, triggerLibrary, libraryPanel);
      libraryReturnFocus = null;
    }
  }

  async function saveToLibrary() {
    if (!engine.buffer || !engine.track) { toast('<b>No track</b> to save', { duration: 1600 }); return; }
    try {
      const edits = { ...engine.fx };
      const eq = (engine.eqFilters || []).map((f) => Number(f.gain.value) || 0);
      const hasEdits = Object.values(edits).some(Boolean) || eq.some((v) => Math.abs(v) >= 0.05);
      const item = engine.queue?.[engine.queueIndex];
      let ab = null;
      let ext = 'WAV';
      let sourceName = item?.file?.name || engine.track.name;

      /* Local files are already compressed. Store the original instead of
         inflating them to WAV: a five-minute track is ~100MB decoded, and a
         library of a few of those exhausts the origin quota. The saved edit
         chain is replayed when it is loaded or exported. */
      if (item?.file) {
        try {
          ab = await item.file.arrayBuffer();
          ext = (item.file.name.split('.').pop() || 'MP3').toUpperCase();
        } catch { ab = null; }
      }
      if (!ab) {
        const blob = await Library.renderRemixToWav(engine.buffer, {}, eq);
        ab = await blob.arrayBuffer();
      }

      const rec = await Library.addToLibrary({
        name: engine.track.name + (hasEdits ? ' (remix)' : ''),
        ext,
        sampleRate: engine.buffer.sampleRate,
        channels: engine.buffer.numberOfChannels,
        duration: engine.buffer.duration,
        arrayBuffer: ab,
        edits,
        eq,
        sourceName,
      });
      try { await navigator.storage?.persist?.(); } catch { /* best effort */ }
      if (!libraryPanel.classList.contains('is-hidden')) void renderLibrary();
      toast(`Saved <b>${esc(rec.name)}</b> to library · ${fmtBytes(ab.byteLength)}`, { duration: 2200 });
    } catch (e) {
      console.error(e);
      const full = e?.name === 'QuotaExceededError';
      toast(full ? '<b>Library full</b> — delete a saved track and try again' : '<b>Save failed</b>', { duration: 2600 });
    }
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
