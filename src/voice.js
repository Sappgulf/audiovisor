// Voice AI — hum → MIDI via autocorrelation + simple synth
export function detectPitch(buf, sampleRate) {
  const N = Math.min(1024, buf.length);
  let rms = 0;
  for (let i = 0; i < N; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / N);
  if (rms < 0.01) return -1;
  let bestOffset = -1, bestCorr = 0;
  const MAX = Math.floor(N / 2);
  const W = N / 2;
  for (let offset = 16; offset < MAX; offset += 2) {
    let sum = 0;
    for (let i = 0; i < W; i += 2) {
      const d = buf[i] - buf[i + offset];
      sum += d < 0 ? -d : d;
    }
    const corr = 1 - sum / (W / 2);
    if (corr > bestCorr) { bestCorr = corr; bestOffset = offset; }
  }
  if (bestCorr > 0.35 && bestOffset > 0) return sampleRate / bestOffset;
  return -1;
}

export function freqToMidi(freq) {
  return Math.round(69 + 12 * Math.log2(freq / 440));
}

export class VoiceSynth {
  constructor(ctx) {
    this.ctx = ctx;
    this.osc = null;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(ctx.destination);
  }
  play(freq, vel = 0.3) {
    this.stop();
    this.osc = this.ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc.frequency.value = freq;
    this.osc.connect(this.gain);
    this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.gain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.gain.gain.linearRampToValueAtTime(vel, this.ctx.currentTime + 0.02);
    this.osc.start();
  }
  stop() {
    if (this.osc) {
      try { this.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.05); this.osc.stop(this.ctx.currentTime + 0.06); } catch {}
      this.osc = null;
    }
  }
}
