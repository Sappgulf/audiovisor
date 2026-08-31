export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/*
 * Screen position -> spectrum bin, on a log frequency scale.
 *
 * This was `pow(t, 2) * bins`, which is quadratic, not logarithmic. At a
 * 48kHz rate that put 6kHz at the centre of the display: nearly all musical
 * content sits below 2kHz, so more than half the width stayed empty while
 * everything interesting bunched into the left quarter. A log mapping gives
 * every octave equal width, which is how a spectrum is meant to read and
 * what spreads real material across the whole picture.
 *
 * Bounds are in bin space rather than Hz, since callers do not pass a
 * sample rate: bin 1.4 is roughly 33Hz and 0.67 of the bins is roughly
 * 16kHz at 48kHz, above which there is nothing worth the pixels.
 */
const LOG_LO_BIN = 1.4;
const LOG_HI_FRAC = 0.67;

function logBin(t01, bins) {
  const hi = Math.max(LOG_LO_BIN + 1, bins * LOG_HI_FRAC);
  // clamp() passes NaN straight through, which would poison the exponent
  const t = Number.isFinite(t01) ? clamp(t01, 0, 1) : 0;
  return LOG_LO_BIN * Math.pow(hi / LOG_LO_BIN, t);
}

export function logFreqIndex(i, count, bins) {
  return Math.min(bins - 1, Math.max(0, Math.round(logBin(i / count, bins))));
}

/**
 * Sample a spectrum at fraction t01 (0..1) along a log frequency curve,
 * linearly interpolating between adjacent bins for staircase-free output.
 * Returns normalized 0..1 amplitude.
 */
export function logSample(freq, t01) {
  const max = freq.length - 1;
  const x = Math.min(max, logBin(t01, freq.length));
  const i = x | 0;
  const f = x - i;
  return (freq[i] + (freq[i + 1 > max ? max : i + 1] - freq[i]) * f) / 255;
}

export function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function hexRgba(hex, a) {
  const alpha = Math.round(Math.max(0, Math.min(1, a)) * 1000);
  const safe = typeof hex === 'string' ? hex.trim() : '';
  const match = safe.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  const key = `${match ? match[0] : '#000000'}:${alpha}`;
  let s = _rgbaCache.get(key);
  if (s === undefined) {
    if (_rgbaCache.size > 8192) _rgbaCache.clear();
    if (match) {
      const digits = match[1].length === 3
        ? match[1].split('').map((ch) => ch + ch).join('')
        : match[1];
      const n = parseInt(digits, 16);
      s = `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha / 1000})`;
    } else {
      s = `rgba(0, 0, 0, ${alpha / 1000})`;
    }
    _rgbaCache.set(key, s);
  }
  return s;
}

const _rgbaCache = new Map();

/** Timestamp for export filenames, e.g. "20260822-143005". */
export function fmtStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Downsample a decoded buffer to `buckets` normalized peak amplitudes for
 * the seek-bar waveform. Sub-samples within each bucket (every `step/64`th
 * frame) so a 10-minute track still draws in a few ms.
 */
export function computePeaks(buffer, buckets = 240) {
  const ch = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(ch.length / buckets));
  const peaks = new Float32Array(buckets);
  const sub = Math.max(1, Math.floor(step / 64));
  for (let b = 0; b < buckets; b++) {
    let max = 0;
    const end = Math.min(ch.length, (b + 1) * step);
    for (let i = b * step; i < end; i += sub) {
      const v = Math.abs(ch[i]);
      if (v > max) max = v;
    }
    peaks[b] = max;
  }
  let m = 0;
  for (let i = 0; i < buckets; i++) if (peaks[i] > m) m = peaks[i];
  if (!m) return peaks;
  for (let i = 0; i < buckets; i++) peaks[i] /= m;
  return peaks;
}

/**
 * Run `fn`, swallowing any throw.
 *
 * The app is full of calls that are expected to fail harmlessly — stopping an
 * already-stopped AudioBufferSourceNode, writing to a full localStorage — and
 * they were all written as a bare `catch {}`. That is correct at runtime and
 * miserable to debug: a genuine bug landing inside one of those blocks leaves
 * no trace at all. safe() keeps the swallow but names the site and reports it
 * on the console in development, so an unexpected throw is visible while a
 * routine one still costs nothing in production.
 *
 * @param {string} label  what was being attempted, e.g. 'preset save'
 * @param {Function} fn
 * @returns the function's result, or undefined if it threw
 */
export function safe(label, fn) {
  try {
    return fn();
  } catch (err) {
    if (import.meta.env?.DEV) console.warn(`[safe] ${label}:`, err);
    return undefined;
  }
}

/** Promise-returning sibling of safe(); never rejects. */
export async function safeAsync(label, fn) {
  try {
    return await fn();
  } catch (err) {
    if (import.meta.env?.DEV) console.warn(`[safe] ${label}:`, err);
    return undefined;
  }
}

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escape a string for interpolation into innerHTML.
 *
 * Toasts, track titles and provider error text all reach the DOM as HTML,
 * and every one of those strings comes from somewhere outside this app —
 * a Spotify track name, a browser permission error, a user-typed URL. This
 * used to be defined identically in both main.js and connect.js, which is
 * one definition too many for something that only has to be wrong once.
 */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ESC_MAP[ch]);
}
