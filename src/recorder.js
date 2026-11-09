// @ts-check
import { fmtStamp } from './utils.js';
const CANDIDATES = [
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
  { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
];

/**
 * Pick the first recording container this browser can actually encode.
 * Safari has no WebM encoder; before this it still downloaded a `.webm`
 * file that nothing could open.
 *
 * @param {any} [ctor] MediaRecorder constructor, injectable for tests
 * @returns {{mime: string, ext: string} | null}
 */
export function pickRecorderMime(ctor = typeof MediaRecorder !== 'undefined' ? MediaRecorder : null) {
  if (!ctor) return null;
  for (const candidate of CANDIDATES) {
    try { if (ctor.isTypeSupported(candidate.mime)) return candidate; } catch { /* old Safari */ }
  }
  return { mime: '', ext: 'webm' };
}

import * as Library from './library.js';

/**
 * Session recorder and remix export.
 *
 * Recording captures the live stage canvas at 60fps plus the engine's audio
 * stream and saves it as WebM (or MP4 where the browser's MediaRecorder has
 * no WebM encoder — notably Safari). Both the recorder and remix export hand
 * their result to `download`.
 *
 * @param {object} deps
 * @param {any} deps.engine
 * @param {() => HTMLCanvasElement} deps.getLiveCanvas
 * @param {(blob: Blob, name: string) => void} deps.download
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {Document} [deps.doc]
 */
export function createRecorder({ engine, getLiveCanvas, download, toast, doc = document }) {
  let recorder = null;
  let recStream = null;
  let timer = null;
  let startedAt = 0;
  let pausedAt = 0;
  let pausedMs = 0;
  /* Each recording gets a generation. Its asynchronous onstop/cleanup must
     only touch that recording — a quick stop->start used to let the previous
     onstop null the new recorder and stop its capture tracks. */
  let recGen = 0;

  /** Stop only the canvas tracks; the audio tracks belong to the engine. */
  function stopCaptureTracks(stream) {
    if (!stream) return;
    stream.getTracks().forEach((t) => {
      if (t.kind !== 'video') return;   // never stop engine.getRecordStream()'s track
      try { t.stop(); } catch { /* already ended */ }
    });
  }

  function pickMime() {
    return pickRecorderMime();
  }

  const recordBtn = doc.getElementById('record-btn');
  const pauseBtn = /** @type {HTMLButtonElement | null} */ (doc.getElementById('record-pause-btn'));
  const note = doc.getElementById('record-note');

  function elapsed() {
    if (!startedAt) return 0;
    const end = pausedAt || Date.now();
    return Math.max(0, Math.floor((end - startedAt - pausedMs) / 1000));
  }

  function paintTimer() {
    if (!note || !startedAt) return;
    const secs = elapsed();
    note.textContent = `REC ${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}${pausedAt ? ' · paused' : ''}`;
  }

  function setRecUI(state) {
    const on = state !== 'idle';
    recordBtn?.classList.toggle('is-rec', on);
    const label = recordBtn?.querySelector('.tool-label');
    if (label) label.textContent = on ? 'Stop recording' : 'Record session';
    if (pauseBtn) {
      pauseBtn.hidden = !on;
      pauseBtn.disabled = !on;
      pauseBtn.classList.toggle('is-hidden', !on);
      const pauseLabel = pauseBtn.querySelector('.tool-label');
      if (pauseLabel) pauseLabel.textContent = state === 'paused' ? 'Resume recording' : 'Pause recording';
    }
    if (!on && note) note.textContent = 'Video with your audio';
    if (on) paintTimer();
  }

  function startTimer() {
    clearInterval(timer);
    timer = setInterval(paintTimer, 500);
  }

  function stopTimer() {
    clearInterval(timer);
    timer = null;
    startedAt = 0;
    pausedAt = 0;
    pausedMs = 0;
  }

  function startRecording() {
    if (!('MediaRecorder' in window) || !getLiveCanvas().captureStream) {
      toast('<b>Recording unavailable</b> — browser lacks MediaRecorder', { duration: 3000 });
      return;
    }
    const chosen = pickMime();
    if (!chosen) {
      toast('<b>Recording unavailable</b> — browser lacks MediaRecorder', { duration: 3000 });
      return;
    }
    const gen = ++recGen;
    try {
      const stream = getLiveCanvas().captureStream(60);
      recStream = stream;
      try {
        const audio = engine.getRecordStream();
        if (audio) audio.getAudioTracks().forEach((t) => stream.addTrack(t));
      } catch { /* video-only recording is better than nothing */ }
      /* chunks belong to this recording; a quick stop->start used to let the
         previous onstop consume the new recording's data */
      const recChunks = [];
      recorder = new MediaRecorder(stream, chosen.mime
        ? { mimeType: chosen.mime, videoBitsPerSecond: 8000000 }
        : undefined);
      recorder._chunks = recChunks;
      recorder._ext = chosen.ext;
      recorder._gen = gen;
      recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
      recorder.onerror = () => {
        toast('<b>Recording failed</b>', { duration: 2600 });
        cleanup(gen);
      };
      recorder.start(1000);
      startedAt = Date.now();
      pausedAt = 0;
      pausedMs = 0;
      setRecUI('recording');
      startTimer();
      toast('RECORDING <b>LIVE</b> — press again to save', { duration: 2200 });
    } catch (err) {
      console.error(err);
      cleanup(gen);
      toast('<b>Recording failed to start</b>', { duration: 2600 });
    }
  }

  function togglePause() {
    const r = recorder;
    if (!r) return;
    if (r.state === 'recording') {
      r.pause();
      pausedAt = Date.now();
      setRecUI('paused');
      toast('Recording <b>paused</b>', { duration: 1400 });
    } else if (r.state === 'paused') {
      r.resume();
      if (pausedAt) pausedMs += Date.now() - pausedAt;
      pausedAt = 0;
      setRecUI('recording');
      toast('Recording <b>resumed</b>', { duration: 1400 });
    }
  }

  function cleanup(gen = recGen) {
    /* a stale recording must not tear down the one that replaced it */
    if (gen !== recGen) return;
    recorder = null;
    stopTimer();
    setRecUI('idle');
    const stream = recStream;
    recStream = null;
    stopCaptureTracks(stream);
  }

  function stopRecording() {
    const r = recorder;
    if (!r) return;
    const gen = r._gen ?? recGen;
    const stream = recStream;
    recorder = null;
    recStream = null;
    const recChunks = r._chunks || [];
    const ext = r._ext || 'webm';
    setRecUI('idle');
    stopTimer();
    r.onstop = () => {
      stopCaptureTracks(stream);
      const blob = new Blob(recChunks, { type: r.mimeType || 'video/webm' });
      /* the user may have started another recording while this one was
         finalising; save this file, but leave the new session's UI alone */
      const stale = gen !== recGen;
      if (blob.size < 1024) {
        if (!stale) toast('<b>Recording empty</b> — try again with the stage visible', { duration: 2600 });
        return;
      }
      download(blob, `audiovisor-session-${fmtStamp()}.${ext}`);
      if (!stale) {
        toast(`SESSION <b>SAVED</b> — ${(blob.size / (1024 * 1024)).toFixed(1)} MB ${ext.toUpperCase()} downloaded`, { duration: 2800 });
      }
    };
    if (r.state !== 'inactive') r.stop();
    else r.onstop();
  }

  recordBtn?.addEventListener('click', () => {
    if (recorder) stopRecording();
    else startRecording();
  });
  pauseBtn?.addEventListener('click', togglePause);

  doc.getElementById('export-remix-btn')?.addEventListener('click', async () => {
    if (!engine.buffer) { toast('<b>No track</b> to export', { duration: 1600 }); return; }
    toast('Rendering <b>remix</b>…', { duration: 1600 });
    try {
      const eq = (engine.eqFilters || []).map((f) => Number(f.gain.value) || 0);
      const blob = await Library.renderRemixToWav(engine.buffer, engine.fx, eq);
      const url = URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = `${engine.track?.name || 'remix'}-remix.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Remix <b>exported</b>', { duration: 2000 });
    } catch { toast('<b>Export failed</b>', { duration: 2000 }); }
  });

  return { startRecording, stopRecording, togglePause };
}
