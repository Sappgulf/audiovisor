// @ts-check

/**
 * Minimal in-place radix-2 Cooley–Tukey FFT.
 *
 * Used by the offline tempo analyser (src/tempo-analysis.js) so a whole
 * track can be analysed without the browser's AnalyserNode, which only
 * exists on the live audio graph. Iterative and allocation-free after
 * construction so it is safe to call once per analysis frame in a worker.
 */
export class FFT {
  /** @param {number} size power of two */
  constructor(size) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two');
    this.size = size;
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    /** @type {number[]} */
    this.rev = new Array(size);
    for (let i = 0; i < size; i++) {
      let x = i;
      let r = 0;
      for (let b = 0; b < Math.log2(size); b++) { r = (r << 1) | (x & 1); x >>= 1; }
      this.rev[i] = r;
    }
    /** @type {number[]} */
    this.cos = new Array(size / 2);
    /** @type {number[]} */
    this.sin = new Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }
  }

  /**
   * Transform `samples` (length must equal the FFT size) and return the
   * magnitude of the first half of the spectrum.
   *
   * @param {ArrayLike<number>} samples
   * @returns {Float64Array} magnitudes, length size/2
   */
  magnitudes(samples) {
    const n = this.size;
    const re = this.re;
    const im = this.im;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      re[i] = samples[rev[i]];
      im[i] = 0;
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k++) {
          const tw = k * step;
          const wr = this.cos[tw];
          const wi = this.sin[tw];
          const a = i + k;
          const b = a + half;
          const vr = re[b] * wr - im[b] * wi;
          const vi = re[b] * wi + im[b] * wr;
          const ur = re[a];
          const ui = im[a];
          re[a] = ur + vr;
          im[a] = ui + vi;
          re[b] = ur - vr;
          im[b] = ui - vi;
        }
      }
    }
    const half = n >> 1;
    const mags = new Float64Array(half);
    for (let i = 0; i < half; i++) mags[i] = Math.hypot(re[i], im[i]);
    return mags;
  }
}
