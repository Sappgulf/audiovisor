import { clamp } from './utils.js';

/**
 * Drop detection — the "wait for it… NOW" moment.
 *
 * A drop is a structural event, not a loudness event: the arrangement pulls
 * the energy out (breakdown), holds that tension, then slams everything
 * back in. Detector shape:
 *
 *   1. a slow EMA of bass energy forms the track's own baseline
 *   2. bass sagging well under that baseline for a sustained stretch arms
 *      the detector (the breakdown)
 *   3. bass surging back over the baseline while armed fires the drop
 *   4. a cooldown keeps one long breakdown from re-firing every bar
 *
 * The output is a 0..1 envelope that jumps to 1 on the fire and decays over
 * ~a second — renderers read it for slow-mo, camera punch and a bloom surge.
 *
 * Runs on the audio clock like BeatTracker, so seeks and track changes
 * (backwards timestamps) reset it instead of decaying through stale state.
 */
export class DropDetector {
  constructor({
    baseTau = 6,        /* seconds — baseline EMA time constant          */
    breakRatio = 0.5,   /* bass below baseline×this counts as breakdown  */
    breakSec = 1.0,     /* breakdown must hold this long to arm          */
    surgeRatio = 0.95,  /* fire when bass returns above baseline×this    */
    holdSec = 1.1,      /* envelope decay time from 1 → 0                */
    cooldownSec = 10,   /* minimum spacing between fires                 */
  } = {}) {
    this.baseTau = baseTau;
    this.breakRatio = breakRatio;
    this.breakSec = breakSec;
    this.surgeRatio = surgeRatio;
    this.holdSec = holdSec;
    this.cooldownSec = cooldownSec;

    this.drop = 0;
    this._base = 0;
    this._baseSeen = false;
    this._quiet = 0;
    this._lastFire = -1e9;
    this._t = -1;
  }

  reset() {
    this.drop = 0;
    this._base = 0;
    this._baseSeen = false;
    this._quiet = 0;
    this._lastFire = -1e9;
    this._t = -1;
  }

  /**
   * @param {number} bass 0..1 bass-band energy for this frame
   * @param {number} level 0..1 overall level (confirmation gate)
   * @param {number} tSec audio clock position, seconds
   * @returns {number} the drop envelope after this frame
   */
  process(bass, level, tSec) {
    if (![bass, level, tSec].every((v) => Number.isFinite(v))) return this.drop;
    /* backwards jump = seek / new track */
    if (this._t >= 0 && tSec < this._t - 0.25) this.reset();
    const firstCall = this._t < 0;
    const dt = firstCall ? 0 : clamp(tSec - this._t, 0, 0.25);
    this._t = tSec;

    /* envelope decay runs on every frame, fire or not */
    if (dt > 0) this.drop = Math.max(0, this.drop - dt / this.holdSec);

    if (firstCall) {
      this._base = bass;
      this._baseSeen = bass > 0.001;
      return this.drop;
    }

    if (!this._baseSeen) {
      /* still in leading silence — keep waiting for real energy */
      if (bass > 0.001) { this._base = bass; this._baseSeen = true; }
      return this.drop;
    }

    const armed = this._quiet >= this.breakSec;
    const cooled = tSec - this._lastFire >= this.cooldownSec;

    if (bass < this._base * this.breakRatio) {
      /* breakdown: hold the baseline steady (letting it sag would make the
         coming surge fire on a whisper) and accumulate quiet time */
      this._quiet += dt;
    } else {
      /* The slam is a return, not a peak: a real drop brings the energy
         back to roughly where it was, and the contrast is already guaranteed
         by being armed (bass held under half the baseline). So the fire is
         simply the moment bass recovers past the baseline while armed. */
      if (armed && cooled && bass > this._base * this.surgeRatio && level > 0.12) {
        this.drop = 1;
        this._lastFire = tSec;
      }
      this._quiet = 0;
      /* baseline only learns from non-breakdown audio */
      this._base += (bass - this._base) * (1 - Math.exp(-dt / this.baseTau));
    }

    return this.drop;
  }
}
