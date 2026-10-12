// @ts-check
import { bindDragTrack, keyStep, makeDoubleTap } from './drag.js';
import { createChromeVisibility } from './chrome-visibility.js';

/**
 * Where the A-B region sits on the seek track, as CSS percentages. No region,
 * or no known length, is an empty span at the start.
 *
 * @param {{start: number, end: number} | null} region
 * @param {number} duration
 * @returns {{left: string, width: string}}
 */
export function loopSpan(region, duration) {
  if (!region || !(duration > 0)) return { left: '0%', width: '0%' };
  const pct = (s) => Math.max(0, Math.min(100, (s / duration) * 100));
  const a = pct(region.start);
  const b = pct(region.end);
  return { left: `${a}%`, width: `${Math.max(0, b - a)}%` };
}

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
      if (input === 'apple') {
        const t = connect?.currentTrack;
        if (t) {
          const artwork = t.artwork ? [{ src: t.artwork, sizes: '640x640', type: 'image/jpeg' }] : [];
          navigator.mediaSession.metadata = new MediaMetadata({
            title: t.name,
            artist: t.artists,
            album: `${t.album} · AUDIOVISOR`,
            artwork,
          });
        } else navigator.mediaSession.metadata = null;
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
  const visibility = createChromeVisibility({ engine, shell, transport: $('transport'), doc });

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
  /* engine.loop is the A-B region ({start, end}) or null, and engine.repeat
     is the whole-track repeat boolean. While a region is set, repeat steps
     aside instead of fighting the region. */
  const regionOf = () => engine.loop || null;
  $('loop-btn').addEventListener('click', () => {
    if (regionOf()) { toast('A-B loop is on, clear it with <b>A-B</b> first', { duration: 1600 }); return; }
    engine.repeat = !engine.repeat;
    setToggle($('loop-btn'), engine.repeat === true);
    saveSettings();
    toast(engine.repeat ? 'LOOP <b>ON</b>' : 'LOOP <b>OFF</b>', { duration: 1200 });
  });

  /* Tempo and A-B loop sit in the Studio tab, where a phone has the room.
     Every engine call is optional: the audio engine adds these methods
     alongside this UI, so a missing one leaves the label as it was. */
  const tapBtn = $('tap-tempo-btn');
  const tapLabel = $('tap-tempo-label');
  tapBtn?.addEventListener('click', () => {
    const r = engine.tapTempo?.();
    if (r && r.bpm && tapLabel) tapLabel.textContent = `${Math.round(r.bpm)} BPM`;
  });

  // 0: nothing, 1: A set and waiting for B, 2: loop set (the third press clears it)
  const abBtn = $('loop-ab-btn');
  const abLabel = $('loop-ab-label');
  let abStep = 0;
  let abStart = 0;
  let abEnd = 0;
  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  // the region span is set from the engine's loop and length, both guarded:
  // either can be missing on an engine that predates the A-B loop
  function paintSeekLoop() {
    const span = loopSpan(regionOf(), typeof engine.getDuration === 'function' ? engine.getDuration() : 0);
    seekTrack.style.setProperty('--loop-l', span.left);
    seekTrack.style.setProperty('--loop-w', span.width);
  }
  function paintAb() {
    paintSeekLoop();
    if (!abBtn) return;
    const r = regionOf();
    if (r) abStep = 2;
    else if (engine.loop === null && abStep === 2) abStep = 0;   // cleared by the engine
    setToggle(abBtn, abStep === 2, 'is-active');
    if (!abLabel) return;
    const [a, b] = r ? [r.start, r.end] : [abStart, abEnd];
    if (abStep === 2) abLabel.textContent = `A-B ${clock(a)}-${clock(b)}`;
    else if (abStep === 1) abLabel.textContent = `A ${clock(abStart)}, set B`;
    else abLabel.textContent = 'A-B loop';
  }
  abBtn?.addEventListener('click', () => {
    if (abStep === 0) {
      abStart = engine.getTime();
      abStep = 1;
    } else if (abStep === 1) {
      const end = engine.getTime();
      if (end <= abStart) { toast('B must come after <b>A</b>', { duration: 1600 }); return; }
      engine.setLoop?.(abStart, end);
      abEnd = end;
      abStep = 2;
    } else {
      engine.clearLoop?.();
      abStep = 0;
    }
    paintAb();
  });
  // a new source has no loop to keep, so the A-B state starts over with it
  engine.on?.('source', () => { abStep = 0; paintAb(); });
  // a loaded file brings its length; the span needs it, so repaint on state too
  engine.on?.('state', paintSeekLoop);
  paintAb();

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
    visibility.refresh();
  }
  function exitCinema() {
    pseudo = false;
    shell.classList.remove('is-cinema', 'is-chrome-hidden', 'is-pseudo-fs');
    visibility.refresh();
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
  /* Taps on a control inside the stage (Play demo, the file label) are not
     gestures on the stage. And a touch pair that already toggled cinema must
     not be toggled back by the dblclick a browser sends after it, or one
     double-tap would enter and leave in the same moment. */
  const onControl = (e) => e.target instanceof Element && !!e.target.closest('button, label, a, input, [role="button"], [role="slider"]');
  let touchToggleAt = -Infinity;
  stage.addEventListener('dblclick', (e) => {
    if (onControl(e) || e.timeStamp - touchToggleAt < 800) return;
    $('fullscreen-btn').click();
  });
  const stageDoubleTap = makeDoubleTap();
  stage.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse' || onControl(e)) return;   // dblclick covers the mouse
    if (stageDoubleTap(e.clientX, e.clientY, e.timeStamp)) {
      touchToggleAt = e.timeStamp;
      $('fullscreen-btn').click();
    }
  });

  return { transportToggle, setVolumeUI, updateMediaSession, seekTrack, paintSeekLoop };
}
