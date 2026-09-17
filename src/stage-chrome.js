// @ts-check
import { computePeaks, hexRgba } from './utils.js';

/**
 * Small canvas chrome around the stage: the seek-bar waveform preview and
 * the bass/mid/high VU meter. Both are drawn from the engine's data rather
 * than the visualizer, so they keep working whichever stage is active.
 *
 * @param {object} deps
 * @param {any} deps.engine
 * @param {any} deps.renderer
 * @param {() => { colors?: string[] } | undefined} deps.getTheme
 * @param {Document} [deps.doc]
 */
export function createStageChrome({ engine, renderer, getTheme, doc = document }) {
  function drawWaveform(buffer) {
    const c = /** @type {HTMLCanvasElement | null} */ (doc.getElementById('seek-wave'));
    if (!c || !buffer) return;
    const W = c.clientWidth || 600;
    const H = c.clientHeight || 24;
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const peaks = computePeaks(buffer, Math.min(240, Math.floor(W / 2)));
    const bw = W / peaks.length;
    const mid = H / 2;
    ctx.fillStyle = 'rgba(255,235,205,0.22)';
    for (let i = 0; i < peaks.length; i++) {
      const h = Math.max(1, peaks[i] * (H - 4));
      ctx.fillRect(i * bw + bw * 0.15, mid - h / 2, bw * 0.7, h);
    }
  }

  let vuPeaks = [0, 0, 0];
  function drawVu() {
    const c = /** @type {HTMLCanvasElement | null} */ (doc.getElementById('vu-meter'));
    if (!c) return;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    const idle = engine.activeInput === 'none';
    c.style.opacity = idle ? '0.3' : '1';
    const bands = [renderer.sm.bass, renderer.sm.mid, renderer.sm.high];
    const colors = (getTheme()?.colors) || ['#d9b089', '#c49a6e', '#f5e6d3'];
    const bw = 12, gap = (W - bw * 3) / 2;
    for (let i = 0; i < 3; i++) {
      const v = Math.min(1.2, bands[i] * renderer.sensitivity * 0.85);
      vuPeaks[i] = Math.max(v, vuPeaks[i] - 0.012);
      const x = i * (bw + gap);
      const bh = Math.max(2, v * (H - 6));
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x, 3, bw, H - 6);
      const g = ctx.createLinearGradient(0, H - 3 - bh, 0, H - 3);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.25, colors[i % colors.length]);
      g.addColorStop(1, hexRgba(colors[i % colors.length], 0.35));
      ctx.fillStyle = g;
      ctx.fillRect(x, H - 3 - bh, bw, bh);
      /* peak cap */
      const py = H - 3 - Math.max(2, vuPeaks[i] * (H - 6)) - 1;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(x, py, bw, 1.4);
    }
  }

  return { drawWaveform, drawVu };
}
