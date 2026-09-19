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

  async function syncWakeLock(playing) {
    try {
      if (playing && navigator.wakeLock && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!playing && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch {}
  }

  function refreshStatus() {
    const playing = engine.playing;
    syncWakeLock(playing);
    const icon = playing ? 'pause' : 'play';
    setIcon($('play-pause-icon'), icon);

    $('track-info').classList.toggle('is-playing', playing);
    setToggle($('capture-btn'), engine.captureActive);
    setToggle($('mic-btn'), engine.micActive);

    let text = 'Ready · Add audio';
    switch (engine.activeInput) {
      case 'mic': text = playing || engine.micActive ? 'Live · Mic' : 'Mic ready'; break;
      case 'capture': text = 'Live · Capture'; break;
      case 'spotify': text = playing ? 'SPOTIFY · Live' : 'SPOTIFY · Paused'; break;
      case 'apple': text = playing ? 'APPLE MUSIC · Live' : 'APPLE MUSIC · Paused'; break;
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
  }

  engine.on('state', refreshStatus);
  engine.on('source', () => {
    refreshStatus();
    onTrackChange();
  });
  engine.onQueueChange = () => {
    onTrackChange();
    panels.renderQueueIfOpen();
  };

  return { refreshStatus };
}
