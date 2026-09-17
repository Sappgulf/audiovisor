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

  $('fullscreen-btn').addEventListener('click', () => {
    if (doc.fullscreenElement) doc.exitFullscreen();
    else shell.requestFullscreen?.();
  });
  doc.addEventListener('fullscreenchange', () => {
    const isFs = !!doc.fullscreenElement;
    shell.classList.toggle('is-cinema', isFs);
    if (isFs) {
      // auto-hide chrome after 2.2s
      let hid = setTimeout(() => shell.classList.add('is-chrome-hidden'), 2200);
      const show = () => {
        shell.classList.remove('is-chrome-hidden');
        clearTimeout(hid);
        hid = setTimeout(() => shell.classList.add('is-chrome-hidden'), 2200);
      };
      const onMove = () => show();
      /* pointermove covers the mouse; a touch device never emits it while the
         finger is off the glass, so without pointerdown the chrome hid after
         2.2s in fullscreen and there was no way to bring it back. */
      shell.addEventListener('pointermove', onMove);
      shell.addEventListener('pointerdown', onMove);
      const clr = () => {
        shell.removeEventListener('pointermove', onMove);
        shell.removeEventListener('pointerdown', onMove);
        doc.removeEventListener('fullscreenchange', clr);
        clearTimeout(hid);
      };
      // cleanup when exiting handled by next fullscreenchange
      cinemaShell._cinemaCleanup = clr;
    } else {
      shell.classList.remove('is-cinema', 'is-chrome-hidden');
      if (cinemaShell._cinemaCleanup) { try { cinemaShell._cinemaCleanup(); } catch {} cinemaShell._cinemaCleanup = null; }
    }
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
