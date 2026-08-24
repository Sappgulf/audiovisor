import { clamp } from './utils.js';

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rand(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Procedural spectrum generator for sources whose audio cannot be tapped
 * (e.g. DRM streaming). Produces plausible frequency/waveform frames that
 * evolve with playback time so the stage stays alive.
 */
export class SynthFeed {
  constructor(seed = 'audiovisor', bins = 1024, waveLen = 2048) {
    this.seedNum = hashSeed(String(seed));
    this.freq = new Uint8Array(bins);
    this.wave = new Uint8Array(waveLen);
    this.energy = 0;
    this.beatPhase = 0;
    // per-track "tempo" between 92 and 148 bpm derived from the seed
    this.bpm = Math.round(92 + rand(this.seedNum % 9973) * 56);
    this.sectionLen = 22 + Math.round(rand(this.seedNum % 7919) * 10); // seconds
    this.t = -1;
    this._buildT = -1;
    this._data = { freq: this.freq, wave: this.wave };
  }

  _sectionShape(tSec) {
    const sIdx = Math.floor(tSec / this.sectionLen);
    const r = (tSec % this.sectionLen) / this.sectionLen;
    const kind = Math.floor(rand(this.seedNum ^ Math.imul(sIdx + 1, 2654435761)) * 4);
    // intro build, steady groove, peak, breakdown
    const env = [0.35 + r * 0.4, 0.75, 1.0, 0.28 + r * 0.15][kind];
    const swell = Math.min(1, r * 6); // fast attack at section start
    return clamp(env * (0.55 + 0.45 * swell), 0.08, 1);
  }

  tick(tSec) {
    if (tSec === this.t) return;
    const beatHz = this.bpm / 60;
    this.beatPhase = ((tSec * beatHz) % 1 + 1) % 1;
    this.t = tSec;
    /* External providers cannot expose their decoded PCM to this app, so
       this feed is deliberately procedural. Thirty fresh analysis frames per
       second are enough for the visual modes; the phase above remains
       continuous at the caller's real playback time. */
    if (this._buildT >= 0 && tSec - this._buildT < 1 / 30) return;
    const dt = this._buildT < 0 ? 1 / 60 : Math.max(0, tSec - this._buildT);
    this._buildT = tSec;
    const { freq, wave } = this;

    const shape = this._sectionShape(Math.max(0, tSec));
    /* Time-based envelope: the previous per-call coefficient made the
       synthetic source sound different at 60 Hz versus 144 Hz. */
    this.energy += (shape - this.energy) * (1 - Math.exp(-dt * 3.7));

    const kick = Math.pow(1 - this.beatPhase, 2.6) * this.energy;

    const bins = freq.length;
    for (let i = 0; i < bins; i++) {
      const f = i / bins;
      const bandRng = rand(this.seedNum + Math.floor(f * 64));
      const bassEnv = Math.exp(-f * 26) * kick * (0.7 + 0.3 * bandRng);
      const midEnv =
        Math.sin(f * 34 + tSec * 2.1 + bandRng * 6.28) *
        Math.exp(-Math.abs(f - 0.12) * 9) *
        (0.32 + 0.68 * this.energy) *
        (0.55 + 0.45 * rand(this.seedNum + i));
      const highEnv =
        (rand(this.seedNum + i * 7 + Math.floor(tSec * 8)) * 0.5 +
          0.25 * Math.sin(tSec * 5 + f * 40)) *
        Math.pow(f, 1.6) *
        this.energy *
        0.85;
      const noise = (rand(this.seedNum + i * 31 + Math.floor(tSec * 14)) - 0.5) * 0.08;
      const v = clamp(bassEnv + midEnv + highEnv + noise, 0, 1);
      freq[i] = Math.round(v * 235);
    }

    const wl = wave.length;
    for (let i = 0; i < wl; i++) {
      const x = i / wl;
      const v =
        Math.sin(x * Math.PI * 8 + tSec * 3.1) * 0.45 * this.energy +
        Math.sin(x * Math.PI * 23 - tSec * 5.7) * 0.25 * this.energy +
        (kick - 0.5) * 0.5 * Math.exp(-Math.abs(x - 0.02 - (i % 480) / 480) * 3);
      wave[i] = Math.round(clamp(128 + v * 110, 0, 255));
    }
  }

  getData() {
    return this._data;
  }

  /** Zero the frame so paused sources decay visually instead of freezing. */
  clear() {
    this.freq.fill(0);
    this.wave.fill(128);
    this.energy *= 0.5;
  }
}
