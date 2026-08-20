import { median } from './utils.js';

export class BeatTracker {
  constructor({ now = () => Date.now(), minInterval = 250, maxInterval = 2000, decayMs = 3200 } = {}) {
    this.now = now;
    this.minInterval = minInterval;
    this.maxInterval = maxInterval;
    this.decayMs = decayMs;
    this._lastBeat = 0;
    this._intervals = [];
    this._bpm = 0;
  }

  reset() {
    this._lastBeat = 0;
    this._intervals = [];
    this._bpm = 0;
  }

  tick(energy, threshold = 0.6) {
    const now = this.now();
    const dt = now - this._lastBeat;
    if (energy > threshold && (this._lastBeat === 0 || dt > this.minInterval)) {
      this._lastBeat = now;
      if (this._intervals.length && dt < this.maxInterval) {
        this._intervals.push(dt);
        if (this._intervals.length > 24) this._intervals.shift();
        const m = median(this._intervals);
        this._bpm = Math.round((60000 / m) * 100) / 100;
      } else if (!this._intervals.length) {
        this._intervals.push(600);
      }
    }
    if (this._lastBeat !== 0 && now - this._lastBeat > this.decayMs) {
      this._bpm = 0;
    }
    return this._bpm;
  }

  get bpm() {
    return this._bpm;
  }
}
