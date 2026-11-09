// @ts-check
/**
 * Play-state sync.
 *
 * Keeps the transport chrome, the status pill, the screen wake lock and the
 * dropzone in step with the engine. Wires itself to the engine's events so
 * callers only ever need `refreshStatus` for a manual nudge.
 *
 * @param {object} deps
 * @param {any} deps.engine
 * @param {any} deps.panels
 * @param {(el: HTMLElement | null, name: string) => void} deps.setIcon
 * @param {(el: HTMLElement | null, on: boolean, cls?: string) => void} deps.setToggle
 * @param {() => HTMLElement} deps.getDropzone
 * @param {() => void} deps.onTrackChange
 * @param {Document} [deps.doc]
 */
export function createPlayState({ engine, panels, setIcon, setToggle, getDropzone, onTrackChange, doc = document }) {
  const $ = (id) => doc.getElementById(id);
  let wakeLock = null;
  let wakeLockPending = false;

  async function syncWakeLock(playing) {
    try {
      if (playing && navigator.wakeLock && !wakeLock && !wakeLockPending) {
        wakeLockPending = true;
        const lock = await navigator.wakeLock.request('screen');
        /* the request can resolve after a pause (or after another request
           replaced it); never keep a lock for a stopped transport */
        if (engine.playing && !wakeLock) {
          wakeLock = lock;
          lock.addEventListener('release', () => {
            if (wakeLock === lock) wakeLock = null;
          });
        } else {
          await lock.release();
        }
      } else if (!playing && wakeLock) {
        const lock = wakeLock;
        wakeLock = null;
        await lock.release();
      }
    } catch {}
    finally { wakeLockPending = false; }
  }

  /* a lock is released automatically when the tab is hidden; take it again
     when the listener returns to a playing stage */
  doc.addEventListener?.('visibilitychange', () => {
    if (!doc.hidden) syncWakeLock(engine.playing);
  });

  function refreshStatus() {
    const playing = engine.playing;
    syncWakeLock(playing);
    const icon = playing ? 'pause' : 'play';
    setIcon($('play-pause-icon'), icon);
    const playLabel = engine.activeInput === 'none' ? 'Choose audio to play' : playing ? 'Pause' : 'Play';
    $('play-pause-btn')?.setAttribute('aria-label', playLabel);
    $('play-pause-btn')?.setAttribute('title', `${playLabel} (Space)`);
    const queue = (engine.queue?.length || 0) > 1 || engine.activeInput === 'apple' || engine.activeInput === 'spotify';
    const previous = queue ? 'Previous track' : 'Restart track';
    const next = queue ? 'Next track' : 'Forward 10 seconds';
    $('prev-btn')?.setAttribute('aria-label', previous);
    $('prev-btn')?.setAttribute('title', previous);
    $('next-btn')?.setAttribute('aria-label', next);
    $('next-btn')?.setAttribute('title', next);

    $('track-info').classList.toggle('is-playing', playing);
    setToggle($('capture-btn'), engine.captureActive);
    setToggle($('mic-btn'), engine.micActive);

    let text = 'Ready · Add audio';
    switch (engine.activeInput) {
      case 'mic': text = playing || engine.micActive ? 'Live · Mic' : 'Mic ready'; break;
      case 'capture': text = 'Live · Capture'; break;
      case 'spotify': text = playing ? 'SPOTIFY · Playing' : 'SPOTIFY · Paused'; break;
      case 'apple': text = playing ? 'APPLE MUSIC · Playing' : 'APPLE MUSIC · Paused'; break;
      case 'stream': text = playing ? 'STREAM · Live' : 'STREAM · Paused'; break;
      case 'track': text = playing ? 'Live · Track' : 'Paused · Track'; break;
    }
    $('status-text').textContent = text;
    $('status-pill')?.setAttribute('title', text);
    refreshStatusDot();
    syncDropzone();
  }

  function refreshStatusDot() {
    const dot = doc.querySelector('#status-pill .status-dot');
    const live = engine.playing || engine.micActive || engine.captureActive;
    dot.classList.toggle('is-live', live);
  }

  function syncDropzone() {
    const idle = engine.activeInput === 'none';
    getDropzone().classList.toggle('is-hidden', !idle);
    $('stage')?.classList.toggle('is-empty', idle);
    // A source is enough to start the default visual. Otherwise audio can
    // play behind the first-run curtain until someone also picks a mode.
    if (!idle) doc.documentElement.classList.remove('mode-unchosen');
  }

  engine.on('state', refreshStatus);
  engine.on('source', () => {
    refreshStatus();
    onTrackChange();
  });
  engine.onQueueChange = () => {
    refreshStatus();
    onTrackChange();
    panels.renderQueueIfOpen();
  };

  return { refreshStatus };
}
