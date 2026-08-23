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

export function logFreqIndex(i, count, bins) {
  return Math.min(bins - 1, Math.floor(Math.pow(i / count, 2) * bins));
}

/**
 * Sample a spectrum at fraction t01 (0..1) along a log frequency curve,
 * linearly interpolating between adjacent bins for staircase-free output.
 * Returns normalized 0..1 amplitude.
 */
export function logSample(freq, t01) {
  const max = freq.length - 1;
  const t = clamp(t01, 0, 1);
  const x = Math.pow(t, 2) * max;
  const i = x | 0;
  const f = x - i;
  return (freq[i] + (freq[i + 1 > max ? max : i + 1] - freq[i]) * f) / 255;
}

export function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function hexRgba(hex, a) {
  const q = Math.round(Math.max(0, Math.min(1, a)) * 1000);
  const key = `${hex}:${q}`;
  let s = _rgbaCache.get(key);
  if (s === undefined) {
    if (_rgbaCache.size > 8192) _rgbaCache.clear();
    const n = parseInt(hex.slice(1), 16);
    s = `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${q / 1000})`;
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
