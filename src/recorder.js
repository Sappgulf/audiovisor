// @ts-check
import { fmtStamp } from './utils.js';
import * as Library from './library.js';

/**
 * Session recorder and remix export.
 *
 * Recording captures the live stage canvas at 60fps plus the engine's audio
 * stream and saves it as WebM. Remix export renders the current buffer
 * through the FX chain to WAV. Both hand their result to `download`.
 *
 * @param {object} deps
 * @param {any} deps.engine
 * @param {() => HTMLCanvasElement} deps.getLiveCanvas
 * @param {(blob: Blob, name: string) => void} deps.download
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {Document} [deps.doc]
 */
export function createRecorder({ engine, getLiveCanvas, download, toast, doc = document }) {
  /** the take in progress: { rec, stream, parts } */
  let take = null;

  /* the canvas capture keeps rendering frames until its video track stops.
     Only the video track: the audio track belongs to the engine's shared
     recording destination and must survive for the next take. */
  function stopVideo(stream) {
    stream?.getVideoTracks().forEach((t) => t.stop());
  }

  function setRecBtn(on) {
    doc.getElementById('record-btn').classList.toggle('is-rec', on);
  }

  function startRecording() {
    if (!('MediaRecorder' in window) || !getLiveCanvas().captureStream) {
      toast('<b>Recording unavailable</b> — browser lacks MediaRecorder', { duration: 3000 });
      return;
    }
    let stream = null;
    try {
      stream = getLiveCanvas().captureStream(60);
      try {
        const audio = engine.getRecordStream();
        if (audio) audio.getAudioTracks().forEach((t) => stream.addTrack(t));
      } catch {}
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        .find((m) => MediaRecorder.isTypeSupported(m)) || '';
      // each take owns its chunks, so a take still flushing never mixes with the next
      const parts = [];
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8000000 } : undefined);
      rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      rec.start(1000);
      take = { rec, stream, parts };
      setRecBtn(true);
      toast('RECORDING <b>LIVE</b> — press again to save', { duration: 2200 });
    } catch (err) {
      console.error(err);
      stopVideo(stream);
      take = null;
      toast('<b>Recording failed to start</b>', { duration: 2600 });
    }
  }

  function stopRecording() {
    const t = take;
    if (!t) return;
    take = null;
    setRecBtn(false);
    t.rec.onstop = () => {
      stopVideo(t.stream);
      const blob = new Blob(t.parts, { type: t.rec.mimeType || 'video/webm' });
      if (!blob.size) return;
      download(blob, `audiovisor-session-${fmtStamp()}.webm`);
      toast('SESSION <b>SAVED</b> — WebM downloaded', { duration: 2800 });
    };
    if (t.rec.state !== 'inactive') t.rec.stop();
    else t.rec.onstop();
  }

  doc.getElementById('record-btn').addEventListener('click', () => {
    if (take) stopRecording();
    else startRecording();
  });

  doc.getElementById('export-remix-btn')?.addEventListener('click', async () => {
    if (!engine.buffer) { toast('<b>No track</b> to export', { duration: 1600 }); return; }
    toast('Rendering <b>remix</b>…', { duration: 1600 });
    try {
      const blob = await Library.renderRemixToWav(engine.buffer, engine.fx);
      const url = URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = `${engine.track?.name || 'remix'}-remix.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Remix <b>exported</b>', { duration: 2000 });
    } catch { toast('<b>Export failed</b>', { duration: 2000 }); }
  });

  return { startRecording, stopRecording };
}
