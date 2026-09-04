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
    this._pendingOnset = null; /* onset detected, not yet audible    */
    /* Peak-hold estimate of the ambient flux level. The fixed 0.008 onset
       floor this scales was measured against loud material; on a quiet
       acoustic track the kick flux sits around 0.005 and never fired at
       all, so nothing ever locked and the stage went arrhythmic. A slow
       peak-hold (not a mean — the mean sits in the valleys between kicks
       and would drag the gate down into the hats on loud tracks) scales
       the floor down for quiet music while loud peaks pin it at its old
       fixed value, keeping locked-tempo behaviour there identical. */
    this._fluxPeak = 0;
    /* The adaptive floor itself: starts at the ceiling so a track's first
       second behaves exactly like the old fixed gate (no 8th-note head
       start for the octave voter), then relaxes toward the measured room
       level. Attacks instantly, releases slowly. */
    this._floor = 0.008;
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
    this._fluxPeak = 0;
    this._floor = 0.008;
  }

  /**
   * Feed one analysis frame.
   *
   * @param {Uint8Array} spectrum frequency data (0..255 per bin)
   * @param {number} tSec audio position the graph has reached, in seconds
   * @param {number} latency seconds the speaker trails the graph by
   *   (AudioContext outputLatency + baseLatency). Onsets are stamped in
   *   graph time, because that is when the spectrum carrying them arrived,
   *   but phase and pulse are reported against what the listener is hearing
   *   right now — otherwise every flash lands `latency` early, which on
   *   Bluetooth output is 150-300ms and plainly visible.
   */
  process(spectrum, tSec, latency = 0) {
    if (!spectrum?.length || !Number.isFinite(tSec)) return;
    /* A backwards jump is a seek or a new external track. Do not let the
       old phase grid leak into the new song; duplicate timestamps are common
       when a media element pauses between animation frames. */
    if (this._t >= 0 && tSec < this._t - 0.25) this.reset();
    else if (this._t >= 0 && tSec <= this._t) return;

    const firstCall = this._t < 0;
    const dt = firstCall ? 0 : Math.max(0, tSec - this._t);
    this._t = tSec;

    const lat = Number.isFinite(latency) ? clamp(latency, 0, 0.5) : 0;
    const heard = tSec - lat;   // song position leaving the speaker right now

    /* decay the onset envelope across audio time */
    if (dt > 0) this.pulse *= Math.pow(0.5, dt / 0.11);

    /* release a detected onset only once the listener reaches it */
    if (this._pendingOnset !== null && heard >= this._pendingOnset) {
      this.pulse = 1;
      this._pendingOnset = null;
    }

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

    /* Peak-hold with a ~2s release: jumps to a new peak instantly, drifts
       down through quieter stretches. Ratio keeps the gate proportional
       across 20dB of material; clamps preserve the old fixed behaviour at
       both ends (loud peaks pin the ceiling, dither never clears the
       minimum). */
    const dtPeak = firstCall ? 0 : Math.max(0, dt);
    this._fluxPeak = Math.max(flux, this._fluxPeak * Math.exp(-dtPeak / 2.0));
    const target = clamp(this._fluxPeak * 0.25, 0.0022, 0.008);
    this._floor += (target - this._floor) *
      (target > this._floor ? 1 : 1 - Math.exp(-dtPeak / 1.5));
    const floorAbs = this._floor;

    /* Adaptive threshold: median + robust MAD noise estimate. Unlike a
       copied/sorted JS array this uses fixed storage, so analysis creates no
       per-frame garbage. Calculate before adding the current sample so a
       strong onset cannot raise its own threshold. */
    const thresh = this._adaptiveThreshold(floorAbs);
    this._fluxHist[this._fluxHistPos] = flux;
    this._fluxHistPos = (this._fluxHistPos + 1) % this._fluxHist.length;
    this._fluxHistCount = Math.min(this._fluxHistCount + 1, this._fluxHist.length);

    const gap = this.bpm > 0 ? Math.max(0.12, (60 / this.bpm) * 0.33) : 0.14;
    const riseGate = clamp(this._fluxPeak * 0.06, 0.0004, 0.0015);
    const rising = firstCall || flux > this._prevFlux * 1.06 + riseGate;
    if (this._prev && flux > thresh && rising && tSec - this._lastOnset >= gap) {
      // with no latency to wait out, flash immediately
      if (lat <= 0) this.pulse = 1;
      else this._pendingOnset = tSec;
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

    /* advance predicted phase along the locked grid, read at the position
       the listener is actually hearing */
    if (this.bpm > 0) {
      const period = 60 / this.bpm;
      let ph = ((heard - this._anchor) / period) % 1;
      if (ph < 0) ph += 1;
      this.phase = ph;
    }
  }

  _adaptiveThreshold(floorAbs = 0.008) {
    const n = this._fluxHistCount;
    if (n < 8) return floorAbs;

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
    return med + Math.max(floorAbs, med * 0.35, mad * 2.4);
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
