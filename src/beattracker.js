import { median, clamp } from './utils.js';

/**
 * Tempo-locked beat tracker.
 *
 * Pipeline: spectral flux → adaptive-threshold onsets → interval histogram
 * with octave folding → tempo lock → phase prediction.
 *
 * Runs on the audio clock (seconds of song position) instead of wall time,
 * so predicted beats stay glued to playback even when rAF stalls or the
 * tab throttles. Exposes:
 *
 *  bpm        locked tempo (0 = not tracking)
 *  phase      0..1 position within the predicted beat
 *  pulse      1→0 envelope fired on each detected onset
 *  confidence 0..1 stability of the tempo lock
 */
export class BeatTracker {
  constructor({ minBpm = 70, maxBpm = 180, decaySec = 3.2 } = {}) {
    this.minBpm = minBpm;
    this.maxBpm = maxBpm;
    this.decaySec = decaySec;

    this.bpm = 0;
    this.phase = 0;
    this.pulse = 0;
    this.confidence = 0;

    this._t = -1;            /* last processed audio time          */
    this._prev = null;       /* previous spectrum, for flux        */
    this._fluxHist = [];     /* adaptive threshold window          */
    this._lastOnset = -1e9;
    this._intervals = [];
    this._anchor = 0;        /* grid point phase-locked to onsets  */
  }

  reset() {
    this.bpm = 0;
    this.phase = 0;
    this.pulse = 0;
    this.confidence = 0;
    this._t = -1;
    this._prev = null;
    this._fluxHist.length = 0;
    this._lastOnset = -1e9;
    this._intervals.length = 0;
  }

  /**
   * Feed one analysis frame.
   * @param {Uint8Array} spectrum frequency data (0..255 per bin)
   * @param {number} tSec audio position in seconds (song time)
   */
  process(spectrum, tSec) {
    if (!spectrum || !Number.isFinite(tSec)) return;
    const firstCall = this._t < 0;
    const dt = firstCall ? 0 : Math.max(0, tSec - this._t);
    this._t = tSec;

    /* decay the onset envelope across audio time */
    if (dt > 0) this.pulse *= Math.pow(0.5, dt / 0.11);

    /* spectral flux — mean positive bin delta, normalized 0..1 */
    let flux = 0;
    if (this._prev) {
      let s = 0;
      for (let i = 2; i < spectrum.length; i++) {
        const d = spectrum[i] - this._prev[i];
        if (d > 0) s += d;
      }
      flux = s / (Math.max(1, spectrum.length - 2) * 255);
    }
    const prev = this._prev || (this._prev = new Uint8Array(spectrum.length));
    prev.set(spectrum);

    /* adaptive threshold: recent flux median × margin + noise floor */
    const histForThresh = this._fluxHist.length >= 8 ? median(this._fluxHist) * 1.5 + 0.008 : 0.008;
    const thresh = histForThresh;
    this._fluxHist.push(flux);
    if (this._fluxHist.length > 43) this._fluxHist.shift();

    const gap = this.bpm > 0 ? Math.max(0.12, (60 / this.bpm) * 0.33) : 0.14;
    if (this._prev && flux > thresh && tSec - this._lastOnset >= gap) {
      this.pulse = 1;
      this._onOnset(tSec);
      this._lastOnset = tSec;
    }

    /* give up the lock after sustained silence */
    if (this.bpm > 0 && tSec - this._lastOnset > this.decaySec) {
      this.bpm = 0;
      this.confidence = 0;
      this.phase = 0;
      this._intervals.length = 0;
    }

    /* advance predicted phase along the locked grid */
    if (this.bpm > 0) {
      const period = 60 / this.bpm;
      let ph = ((tSec - this._anchor) / period) % 1;
      if (ph < 0) ph += 1;
      this.phase = ph;
    }
  }

  _onOnset(t) {
    const minIv = 60 / this.maxBpm;
    const maxIv = 60 / this.minBpm;

    if (this._lastOnset > -1e8) {
      const iv = t - this._lastOnset;
      if (iv >= minIv * 0.48 && iv <= maxIv * 2.05) {
        /* fold double/half-time intervals into the singing range */
        let f = iv;
        while (f < minIv) f *= 2;
        while (f > maxIv) f /= 2;
        if (f >= minIv && f <= maxIv) {
          this._intervals.push(f);
          if (this._intervals.length > 24) this._intervals.shift();
        }
        this._estimateTempo();
      }
    }

    /* snap the beat grid toward this onset with limited correction so a
       single late/early hit nudges rather than teleports the phase */
    if (this.bpm > 0) {
      const period = 60 / this.bpm;
      const k = Math.round((t - this._anchor) / period);
      if (k >= 1) {
        const corr = clamp(t - k * period - this._anchor, -period * 0.22, period * 0.22);
        this._anchor += corr;
      }
    } else {
      this._anchor = t;
    }
  }

  _estimateTempo() {
    if (this._intervals.length < 4) return;

    /* cluster folded intervals within 6% tolerance; strongest cluster wins */
    const sorted = [...this._intervals].sort((a, b) => a - b);
    let best = null;
    let runStart = 0;
    for (let i = 1; i <= sorted.length; i++) {
      const brk = i === sorted.length || sorted[i] > sorted[runStart] * 1.06;
      if (!brk) continue;
      const count = i - runStart;
      if (!best || count > best.count ||
          (count === best.count && Math.abs(sorted[i - 1] - 0.5) < Math.abs(best.iv - 0.5))) {
        let sum = 0;
        for (let j = runStart; j < i; j++) sum += sorted[j];
        best = { iv: sum / count, count };
      }
      runStart = i;
    }
    if (!best || best.count < 3) return;

    const raw = 60 / best.iv;
    if (this.bpm === 0) {
      this.bpm = Math.round(raw * 100) / 100;
    } else {
      const k = clamp(0.12 + best.count / 48, 0, 0.35);
      this.bpm = Math.round((this.bpm + (raw - this.bpm) * k) * 100) / 100;
    }
    this.confidence = clamp(best.count / 7, 0, 1);
  }

  get info() {
    return { bpm: this.bpm, phase: this.phase, pulse: this.pulse, confidence: this.confidence };
  }
}
