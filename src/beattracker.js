import { clamp } from './utils.js';

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
    this._prevFlux = 0;
    this._fluxHist = new Float32Array(48); /* adaptive threshold ring */
    this._fluxHistCount = 0;
    this._fluxHistPos = 0;
    this._sortScratch = new Float32Array(48);
    this._lastOnset = -1e9;
    this._intervals = new Float32Array(24);
    this._intervalCount = 0;
    this._intervalScratch = new Float32Array(24);
    this._anchor = 0;        /* grid point phase-locked to onsets  */
  }

  reset() {
    this.bpm = 0;
    this.phase = 0;
    this.pulse = 0;
    this.confidence = 0;
    this._t = -1;
    this._prev = null;
    this._prevFlux = 0;
    this._fluxHistCount = 0;
    this._fluxHistPos = 0;
    this._lastOnset = -1e9;
    this._intervalCount = 0;
  }

  /**
   * Feed one analysis frame.
   * @param {Uint8Array} spectrum frequency data (0..255 per bin)
   * @param {number} tSec audio position in seconds (song time)
   */
  process(spectrum, tSec) {
    if (!spectrum?.length || !Number.isFinite(tSec)) return;
    /* A backwards jump is a seek or a new external track. Do not let the
       old phase grid leak into the new song; duplicate timestamps are common
       when a media element pauses between animation frames. */
    if (this._t >= 0 && tSec < this._t - 0.25) this.reset();
    else if (this._t >= 0 && tSec <= this._t) return;

    const firstCall = this._t < 0;
    const dt = firstCall ? 0 : Math.max(0, tSec - this._t);
    this._t = tSec;

    /* decay the onset envelope across audio time */
    if (dt > 0) this.pulse *= Math.pow(0.5, dt / 0.11);

    /* spectral flux — weight the kick region more heavily than cymbal/high
       frequency shimmer, then normalize by the total applied weight. */
    let flux = 0;
    if (this._prev) {
      let s = 0;
      let weightSum = 0;
      const lowEnd = Math.min(
        spectrum.length - 1,
        Math.max(8, Math.floor(spectrum.length * 0.18)),
      );
      for (let i = 2; i < spectrum.length; i++) {
        const w = i < lowEnd ? 2.2 - (i / lowEnd) * 1.25 : 0.35;
        const d = spectrum[i] - this._prev[i];
        if (d > 0) s += d * w;
        weightSum += w;
      }
      flux = s / (Math.max(1, weightSum) * 255);
    }
    const prev = this._prev && this._prev.length === spectrum.length
      ? this._prev
      : (this._prev = new Uint8Array(spectrum.length));
    prev.set(spectrum);

    /* Adaptive threshold: median + robust MAD noise estimate. Unlike a
       copied/sorted JS array this uses fixed storage, so analysis creates no
       per-frame garbage. Calculate before adding the current sample so a
       strong onset cannot raise its own threshold. */
    const thresh = this._adaptiveThreshold();
    this._fluxHist[this._fluxHistPos] = flux;
    this._fluxHistPos = (this._fluxHistPos + 1) % this._fluxHist.length;
    this._fluxHistCount = Math.min(this._fluxHistCount + 1, this._fluxHist.length);

    const gap = this.bpm > 0 ? Math.max(0.12, (60 / this.bpm) * 0.33) : 0.14;
    const rising = firstCall || flux > this._prevFlux * 1.06 + 0.0015;
    if (this._prev && flux > thresh && rising && tSec - this._lastOnset >= gap) {
      this.pulse = 1;
      this._onOnset(tSec);
      this._lastOnset = tSec;
    }
    this._prevFlux = flux;

    /* give up the lock after sustained silence */
    if (this.bpm > 0 && tSec - this._lastOnset > this.decaySec) {
      this.bpm = 0;
      this.confidence = 0;
      this.phase = 0;
      this._intervalCount = 0;
    }

    /* advance predicted phase along the locked grid */
    if (this.bpm > 0) {
      const period = 60 / this.bpm;
      let ph = ((tSec - this._anchor) / period) % 1;
      if (ph < 0) ph += 1;
      this.phase = ph;
    }
  }

  _adaptiveThreshold() {
    const n = this._fluxHistCount;
    if (n < 8) return 0.008;

    /* insertion sort is faster than allocating/sorting a new Array at this
       tiny fixed window size, and keeps the RAF path allocation-free. */
    for (let i = 0; i < n; i++) {
      const idx = (this._fluxHistPos - n + i + this._fluxHist.length) % this._fluxHist.length;
      const value = this._fluxHist[idx];
      let j = i;
      while (j > 0 && this._sortScratch[j - 1] > value) {
        this._sortScratch[j] = this._sortScratch[j - 1];
        j--;
      }
      this._sortScratch[j] = value;
    }
    const med = this._sortScratch[n >> 1];

    for (let i = 0; i < n; i++) {
      const idx = (this._fluxHistPos - n + i + this._fluxHist.length) % this._fluxHist.length;
      const value = Math.abs(this._fluxHist[idx] - med);
      let j = i;
      while (j > 0 && this._sortScratch[j - 1] > value) {
        this._sortScratch[j] = this._sortScratch[j - 1];
        j--;
      }
      this._sortScratch[j] = value;
    }
    const mad = this._sortScratch[n >> 1];
    return med + Math.max(0.008, med * 0.35, mad * 2.4);
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
          if (this._intervalCount < this._intervals.length) {
            this._intervals[this._intervalCount++] = f;
          } else {
            this._intervals.copyWithin(0, 1);
            this._intervals[this._intervals.length - 1] = f;
          }
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
    if (this._intervalCount < 4) return;

    /* cluster folded intervals within 6% tolerance; strongest cluster wins */
    const sorted = this._intervalScratch;
    sorted.set(this._intervals.subarray(0, this._intervalCount));
    sorted.subarray(0, this._intervalCount).sort();
    let best = null;
    let runStart = 0;
    for (let i = 1; i <= this._intervalCount; i++) {
      const brk = i === this._intervalCount || sorted[i] > sorted[runStart] * 1.06;
      if (!brk) continue;
      const count = i - runStart;
      const center = (sorted[runStart] + sorted[i - 1]) * 0.5;
      const previousIv = this.bpm > 0 ? 60 / this.bpm : 0.5;
      if (!best || count > best.count ||
          (count === best.count && Math.abs(center - previousIv) < Math.abs(best.iv - previousIv))) {
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
