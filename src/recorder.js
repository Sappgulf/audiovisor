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
  let recorder = null;
  let chunks = [];

  function setRecBtn(on) {
    doc.getElementById('record-btn').classList.toggle('is-rec', on);
  }

  function startRecording() {
    if (!('MediaRecorder' in window) || !getLiveCanvas().captureStream) {
      toast('<b>Recording unavailable</b> — browser lacks MediaRecorder', { duration: 3000 });
      return;
    }
    try {
      const stream = getLiveCanvas().captureStream(60);
      try {
        const audio = engine.getRecordStream();
        if (audio) audio.getAudioTracks().forEach((t) => stream.addTrack(t));
      } catch {}
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        .find((m) => MediaRecorder.isTypeSupported(m)) || '';
      chunks = [];
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8000000 } : undefined);
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.start(1000);
      setRecBtn(true);
      toast('RECORDING <b>LIVE</b> — press again to save', { duration: 2200 });
    } catch (err) {
      console.error(err);
      recorder = null;
      toast('<b>Recording failed to start</b>', { duration: 2600 });
    }
  }

  function stopRecording() {
    const r = recorder;
    if (!r) return;
    recorder = null;
    setRecBtn(false);
    r.onstop = () => {
      const blob = new Blob(chunks, { type: r.mimeType || 'video/webm' });
      chunks = [];
      if (!blob.size) return;
      download(blob, `audiovisor-session-${fmtStamp()}.webm`);
      toast('SESSION <b>SAVED</b> — WebM downloaded', { duration: 2800 });
    };
    if (r.state !== 'inactive') r.stop();
    else r.onstop();
  }

  doc.getElementById('record-btn').addEventListener('click', () => {
    if (recorder) stopRecording();
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
