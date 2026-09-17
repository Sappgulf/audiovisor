// @ts-check
import { detectPitch, freqToMidi, VoiceSynth } from './voice.js';

/**
 * Voice AI: hum a note and the synth tracks the pitch, nudging the renderer's
 * beat so the stage reacts. Toggling off releases the mic and stops the loop.
 *
 * @param {object} deps
 * @param {any} deps.engine
 * @param {any} deps.renderer
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {Document} [deps.doc]
 */
export function createVoiceInput({ engine, renderer, toast, doc = document }) {
  let synth = null;
  let active = false;
  let raf = null;
  let stream = null;

  doc.getElementById('voice-btn')?.addEventListener('click', async () => {
    const btn = doc.getElementById('voice-btn');
    if (active) {
      active = false;
      btn.classList.remove('is-on');
      if (raf) cancelAnimationFrame(raf);
      synth?.stop();
      if (stream) { stream.getTracks().forEach(tr => tr.stop()); stream = null; }
      toast('Voice AI <b>off</b>');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // warm context already ensured via engine
      if (!engine.ctx) engine._ensureCtx();
      synth = new VoiceSynth(engine.ctx);
      const src = engine.ctx.createMediaStreamSource(stream);
      const analyser = engine.ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      active = true;
      btn.classList.add('is-on');
      toast('Voice AI <b>listening</b> — hum to play');
      const loop = () => {
        if (!active) return;
        analyser.getFloatTimeDomainData(buf);
        const freq = detectPitch(buf, engine.ctx.sampleRate);
        if (freq > 80 && freq < 1000) {
          const midi = freqToMidi(freq);
          const f = 440 * Math.pow(2, (midi - 69) / 12);
          synth.play(f, 0.25);
          renderer.beat = 0.7;
        } else {
          synth.stop();
        }
        raf = requestAnimationFrame(loop);
      };
      loop();
    } catch { toast('<b>Mic denied</b>'); }
  });
}
