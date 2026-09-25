// @ts-check
import { bindDragTrack, keyStep, makeDoubleTap } from './drag.js';

/**
 * Transport controls: play/pause, prev/next, loop, seek and volume, plus
 * the Media Session metadata and the cinema (fullscreen) chrome.
 *
 * @param {object} deps
 * @param {any} deps.engine
 * @param {() => any | null} deps.getConnect
 * @param {(el: HTMLElement | null, on: boolean, cls?: string) => void} deps.setToggle
 * @param {() => void} deps.saveSettings
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {() => void} deps.openFilePicker
 * @param {Document} [deps.doc]
 */
export function createTransport({ engine, getConnect, setToggle, saveSettings, toast, openFilePicker, doc = document }) {
  const $ = (id) => doc.getElementById(id);

  async function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      const input = engine.activeInput;
      const connect = getConnect();
      if ((input === 'spotify' || input === 'apple') && connect?.currentTrack) {
        const t = connect.currentTrack;
        const artwork = t.artwork ? [{ src: t.artwork, sizes: '640x640', type: 'image/jpeg' }] : [];
        navigator.mediaSession.metadata = new MediaMetadata({
          title: t.name,
          artist: t.artists,
          album: `${t.album} · AUDIOVISOR`,
          artwork,
        });
      } else if (input === 'stream' && engine.streamTrack) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: engine.streamTrack.name,
          artist: 'LIVE STREAM',
          album: 'AUDIOVISOR',
        });
      } else if (engine.track) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: engine.track.name,
          artist: 'AUDIOVISOR',
          album: 'Local File',
        });
      }
    } catch {}
  }

  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const actions = {
      play: () => engine.play(),
      pause: () => engine.pause(),
      seekbackward: (d) => engine.skip(-(d.seekOffset || 10)),
      seekforward: (d) => engine.skip(d.seekOffset || 10),
      previoustrack: () => engine.prevTrack(),
      nexttrack: () => engine.nextTrack(),
      seekto: (d) => { if (d.seekTime != null) engine.seek(d.seekTime); },
    };
    for (const [name, fn] of Object.entries(actions)) {
      try { ms.setActionHandler(/** @type {MediaSessionAction} */ (name), fn); } catch {}
    }
  }

  const playPauseBtn = $('play-pause-btn');
  const seekTrack = $('seek-track');
  const volumeTrack = $('volume-track');
  const volumeFill = $('volume-fill');
  const stage = $('stage');
  const shell = $('shell');
  const cinemaShell = /** @type {any} */ (shell);   // carries the fullscreen cleanup handle

  function transportToggle() {
    if (engine.activeInput === 'none') {
      openFilePicker();
      return;
    }
    engine.toggle();
  }

  playPauseBtn.addEventListener('click', transportToggle);

  $('prev-btn').addEventListener('click', () => engine.prevTrack());
  $('next-btn').addEventListener('click', () => engine.nextTrack());
  $('loop-btn').addEventListener('click', () => {
    engine.loop = !engine.loop;
    setToggle($('loop-btn'), engine.loop);
    saveSettings();
    toast(engine.loop ? 'LOOP <b>ON</b>' : 'LOOP <b>OFF</b>', { duration: 1200 });
  });

  bindDragTrack(seekTrack, (ratio) => {
    const d = engine.getDuration();
    if (d > 0) engine.seek(ratio * d);
  });
  // arrow keys on a focused seek bar, for keyboard and switch-control users
  seekTrack.addEventListener('keydown', (e) => {
    const d = engine.getDuration();
    if (d <= 0) return;
    const next = keyStep(e.key, engine.getTime() / d, 0.02);
    if (next === null) return;
    e.preventDefault();
    engine.seek(next * d);
  });

  function setVolumeUI(v) {
    v = Math.max(0, Math.min(1, v));
    engine.setVolume(v);
    volumeFill.style.width = `${v * 100}%`;
    volumeTrack?.setAttribute('aria-valuenow', String(Math.round(v * 100)));
  }
  bindDragTrack(volumeTrack, (ratio, phase) => {
    setVolumeUI(ratio);
    if (phase === 'end') saveSettings();
  });
  volumeTrack?.addEventListener('keydown', (e) => {
    const next = keyStep(e.key, engine.volume);
    if (next === null) return;
    e.preventDefault();
    setVolumeUI(next);
    saveSettings();
  });
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    setVolumeUI(engine.volume - Math.sign(e.deltaY) * 0.05);
    saveSettings();
  }, { passive: false });

  /* Cinema mode: chrome auto-hides over a full-bleed stage. Real fullscreen
     is tried first; when the browser refuses or has no element fullscreen
     (iPhone Safari, an embedded view, a denied request) the shell fills the
     window itself (is-pseudo-fs) instead. The button used to call
     requestFullscreen() and drop the rejection, so on those browsers it
     did nothing at all. */
  let pseudo = false;
  function enterCinema() {
    if (shell.classList.contains('is-cinema')) return;
    shell.classList.add('is-cinema');
    /* fullscreen is for watching: an open settings drawer covered a third of
       the stage. Close it through its own control so its state stays true. */
    const drawer = doc.getElementById('drawer');
    if (drawer && !drawer.classList.contains('is-closed')) doc.getElementById('drawer-close')?.click();
    let hid = setTimeout(() => shell.classList.add('is-chrome-hidden'), 2200);
    const show = () => {
      shell.classList.remove('is-chrome-hidden');
      clearTimeout(hid);
      hid = setTimeout(() => shell.classList.add('is-chrome-hidden'), 2200);
    };
    /* pointermove covers the mouse; a touch device never emits it while the
       finger is off the glass, so without pointerdown the chrome hid after
       2.2s in fullscreen and there was no way to bring it back. */
    shell.addEventListener('pointermove', show);
    shell.addEventListener('pointerdown', show);
    cinemaShell._cinemaCleanup = () => {
      shell.removeEventListener('pointermove', show);
      shell.removeEventListener('pointerdown', show);
      clearTimeout(hid);
    };
  }
  function exitCinema() {
    pseudo = false;
    shell.classList.remove('is-cinema', 'is-chrome-hidden', 'is-pseudo-fs');
    if (cinemaShell._cinemaCleanup) { try { cinemaShell._cinemaCleanup(); } catch {} cinemaShell._cinemaCleanup = null; }
  }
  function enterPseudo() {
    pseudo = true;
    shell.classList.add('is-pseudo-fs');
    enterCinema();
  }
  $('fullscreen-btn').addEventListener('click', () => {
    if (doc.fullscreenElement) { doc.exitFullscreen().catch(() => {}); return; }
    if (pseudo) { exitCinema(); return; }
    const req = shell.requestFullscreen?.();
    if (!req) { enterPseudo(); return; }
    req.catch(() => enterPseudo());
  });
  doc.addEventListener('fullscreenchange', () => {
    if (doc.fullscreenElement) enterCinema();
    else if (!pseudo) exitCinema();
  });
  /* the browser normally consumes Escape to leave native fullscreen; if it
     reaches the page anyway (embedded views, keyboard remaps) honour it, and
     the fallback always needs its own */
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (doc.fullscreenElement) doc.exitFullscreen().catch(() => {});
    else if (pseudo) exitCinema();
  });
  /* Double-tap the stage for cinema mode. dblclick is unreliable on touch —
     Safari withholds it, and elsewhere it arrives after a 300ms delay — so
     taps are paired here. A second tap only counts if it lands near the first,
     which keeps a quick tap on two different controls from triggering it. */
  stage.addEventListener('dblclick', () => $('fullscreen-btn').click());
  const stageDoubleTap = makeDoubleTap();
  stage.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') return;   // dblclick already covers the mouse
    if (stageDoubleTap(e.clientX, e.clientY, e.timeStamp)) $('fullscreen-btn').click();
  });

  return { transportToggle, setVolumeUI, updateMediaSession, seekTrack };
}
