import { THEMES } from './themes.js';
import { lerp, logFreqIndex, hexRgba, clamp } from './utils.js';

/**
 * Canvas2D renderer — delta-time driven, sprite-cached, bloom-composited.
 *
 * Perf notes:
 *  - All glows come from cached gradient sprites + a two-pass downscale
 *    bloom; zero shadowBlur calls per frame.
 *  - Every motion term is scaled by dt, so 60Hz and 144Hz displays move
 *    identically.
 */
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = 0;
    this.h = 0;
    this.t = 0;

    /* bloom buffers */
    this.glowA = document.createElement('canvas');
    this.glowB = document.createElement('canvas');
    this.glowACtx = this.glowA.getContext('2d');
    this.glowBCtx = this.glowB.getContext('2d');

    this.mode = 'bars';
    this.theme = THEMES[0];
    this.sensitivity = 1.4;
    this.bassFocus = 0.5;

    this.quality = 'high';

    this.sm = { bass: 0, mid: 0, high: 0, level: 0 };
    this.beat = 0;
    this.history = [];
    this.particles = [];
    this.peaks = [];
    this.idleDots = [];
    this.echo = null;
    this.barIndices = [];

    /* per-mode state */
    this.terrainRows = [];
    this._terrainAcc = 0;
    this._histAcc = 0;
    this._spawnAcc = 0;
    this.nebula = null;

    /* caches */
    this._dotSprites = null;
    this._barSprites = null;
    this._floorGrads = null;
    this._cacheSig = '';

    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    const scale = this.quality === 'low' ? 1 : this.dpr;
    this.canvas.width = Math.round(this.w * scale);
    this.canvas.height = Math.round(this.h * scale);
    this._floorGrads = null;
  }

  setQuality(q) {
    if (this.quality === q) return;
    this.quality = q;
    this.resize();
  }

  setMode(m) { this.mode = m; this.history = []; this.echo = null; this.terrainRows = []; }
  setTheme(t) {
    this.theme = t;
    this._cacheSig = '';
  }
  setSensitivity(v) { this.sensitivity = v; }
  setBassFocus(v) { this.bassFocus = v; }

  /* ---------------- caches ---------------- */

  _buildCache() {
    const sig = `${this.theme.colors.join(',')}|${this.quality}`;
    if (this._cacheSig === sig && this._dotSprites) return;
    this._cacheSig = sig;

    this._dotSprites = new Map();
    this._barSprites = new Map();
    for (const c of this.theme.colors) {
      const d = document.createElement('canvas');
      d.width = d.height = 64;
      const dc = d.getContext('2d');
      const g = dc.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.22, hexRgba(c, 0.85));
      g.addColorStop(1, hexRgba(c, 0));
      dc.fillStyle = g;
      dc.fillRect(0, 0, 64, 64);
      this._dotSprites.set(c, d);

      const b = document.createElement('canvas');
      b.width = 8;
      b.height = 256;
      const bc = b.getContext('2d');
      const bg = bc.createLinearGradient(0, 0, 0, 256);
      bg.addColorStop(0, hexRgba(c, 1));
      bg.addColorStop(0.82, hexRgba(c, 0.55));
      bg.addColorStop(1, hexRgba(c, 0.16));
      bc.fillStyle = bg;
      bc.beginPath();
      bc.roundRect(0, 0, 8, 256, [4, 4, 0, 0]);
      bc.fill();
      this._barSprites.set(c, b);
    }
    this._floorGrads = null;
  }

  _dot(c) { return this._dotSprites.get(c); }
  _barS(c) { return this._barSprites.get(c); }
  _color(i) { return this.theme.colors[i % this.theme.colors.length]; }

  /* ---------------- analysis smoothing ---------------- */

  _updateLevels(levels, dt) {
    const k = 1 - Math.pow(1 - 0.28, dt * 60);
    const t = levels
      ? { bass: Math.min(1.2, levels.bass * (1 + this.bassFocus * 0.6)), mid: levels.mid, high: levels.high, level: levels.level }
      : { bass: 0, mid: 0, high: 0, level: 0 };
    const prevBass = this.sm.bass;
    this.sm.bass = lerp(this.sm.bass, t.bass, k);
    this.sm.mid = lerp(this.sm.mid, t.mid, k);
    this.sm.high = lerp(this.sm.high, t.high, k);
    this.sm.level = lerp(this.sm.level, t.level, k);

    if (this.sm.bass - prevBass > 0.18 && this.sm.bass > 0.45) this.beat = 1;

    // level history sampled on a fixed clock so tunnel/terrain speed is
    // refresh-rate independent
    this._histAcc += dt;
    if (this._histAcc >= 0.034) {
      this._histAcc = 0;
      this.history.unshift(this.sm.level);
      if (this.history.length > 40) this.history.pop();
    }
  }

  /* ---------------- main entry ---------------- */

  render(idle, freq, wave, levels, dtMs = 16.7) {
    const { ctx, w, h } = this;
    const dt = clamp((dtMs || 16.7) / 1000, 0.001, 0.06);
    const dt60 = dt * 60;

    this.t += dt;
    this.beat *= Math.pow(0.86, dt60);
    this._updateLevels(levels, dt);
    this._buildCache();

    const scale = this.quality === 'low' ? 1 : this.dpr;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (idle) {
      this._idle(dt60);
      return;
    }

    switch (this.mode) {
      case 'bars': this._bars(freq, dt60); break;
      case 'waves': this._waves(wave, dt60); break;
      case 'particles': this._particles(dt, dt60); break;
      case 'kaleido': this._kaleido(freq, dt); break;
      case 'tunnel': this._tunnel(); break;
      case 'plasma': this._plasma(freq, dt); break;
      case 'terrain': this._terrain(freq, dt); break;
      case 'nebula': this._nebula(); break;
      case 'spiral': this._spiral(freq); break;
    }

    if (this.beat > 0.5) this._beatFlash();
    this._bloom();
  }

  /* ---------------- bloom ---------------- */

  _bloom() {
    if (this.quality === 'low') return;
    const { ctx, w, h } = this;
    const gw = Math.max(2, Math.floor(w / 4));
    const gh = Math.max(2, Math.floor(h / 4));
    if (this.glowA.width !== gw || this.glowA.height !== gh) {
      this.glowA.width = gw;
      this.glowA.height = gh;
      this.glowB.width = Math.max(2, gw >> 1);
      this.glowB.height = Math.max(2, gh >> 1);
    }
    const ga = this.glowACtx;
    ga.clearRect(0, 0, gw, gh);
    ga.drawImage(this.canvas, 0, 0, gw, gh);
    const gb = this.glowBCtx;
    gb.clearRect(0, 0, this.glowB.width, this.glowB.height);
    gb.drawImage(this.glowA, 0, 0, this.glowB.width, this.glowB.height);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.38;
    ctx.drawImage(this.glowB, -w * 0.02, -h * 0.02, w * 1.04, h * 1.04);
    ctx.globalAlpha = 0.3;
    ctx.drawImage(this.glowA, 0, 0, w, h);
    ctx.restore();
  }

  _beatFlash() {
    const { ctx, w, h } = this;
    const a = (this.beat - 0.5) * 0.5 * 0.08;
    const g = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.75, hexRgba(this._color(0), a));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  /* ---------------- IDLE AURORA ---------------- */

  _idle(dt60) {
    const { ctx, w, h } = this;
    const t = this.t * 0.35;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.42;

    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const x = cx + Math.sin(t * (0.21 + i * 0.09) + i * 2.1) * w * 0.28;
      const y = cy + Math.cos(t * (0.16 + i * 0.07) + i * 1.4) * h * 0.24;
      const r = R * (0.8 + 0.25 * Math.sin(t * 0.4 + i * 2));
      const c = this._color(Math.floor(this.t * 0.02) + i);
      ctx.globalAlpha = 0.09;
      ctx.drawImage(this._dot(c), x - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;

    if (this.idleDots.length < 40) {
      this.idleDots.push({
        x: Math.random() * w,
        y: h + Math.random() * h * 0.3,
        s: 0.4 + Math.random() * 0.9,
        v: 0.15 + Math.random() * 0.5,
        ph: Math.random() * Math.PI * 2,
      });
    }
    const sprite = this._dot(this._color(0));
    for (const d of this.idleDots) {
      d.y -= d.v * dt60;
      if (d.y < -10) { d.y = h + 10; d.x = Math.random() * w; }
      const a = 0.05 + 0.12 * (0.5 + 0.5 * Math.sin(this.t * 1.2 + d.ph));
      const r = d.s * 4;
      ctx.globalAlpha = a;
      ctx.drawImage(sprite, d.x - r, d.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- SPECTRUM BARS ---------------- */

  _bars(freq, dt60) {
    const { ctx, w, h } = this;
    const horizon = h * 0.65;
    const N = Math.min(96, Math.max(48, Math.round(w / (this.quality === 'low' ? 22 : 13))));
    const gap = Math.max(1.5, w / N / 5);
    const bw = (w - gap * (N - 1) - 32) / N;

    if (this.barIndices.length !== N) {
      this.barIndices = [];
      for (let i = 0; i < N; i++) this.barIndices.push(logFreqIndex(i, N, freq.length));
    }
    if (this.peaks.length !== N) this.peaks = new Array(N).fill(0);

    const peakDecay = Math.pow(0.985, dt60);
    const maxH = horizon - h * 0.06;

    const c0 = this._color(0);
    if (!this._floorGrads) {
      this._floorGrads = {};
      for (const c of this.theme.colors) {
        const g = ctx.createLinearGradient(0, horizon, 0, h);
        g.addColorStop(0, hexRgba(c, 0.07));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        this._floorGrads[c] = g;
      }
    }
    ctx.fillStyle = this._floorGrads[c0];
    ctx.fillRect(0, horizon, w, h - horizon);

    const colors = [];
    const amps = new Array(N);
    for (let i = 0; i < N; i++) {
      const idx = this.barIndices[i];
      const v = (freq[idx] / 255) * this.sensitivity;
      const weight = 1 + this.bassFocus * 2.2 * (1 - i / N);
      amps[i] = clamp(v * weight, 0.008, 1);
      this.peaks[i] = Math.max(this.peaks[i] * peakDecay, amps[i]);
      colors[i] = this._color(Math.floor((i / N) * this.theme.colors.length));
    }

    for (let i = 0; i < N; i++) {
      const barH = amps[i] * maxH;
      if (barH < 0.5) continue;
      ctx.drawImage(
        this._barS(colors[i]),
        16 + i * (bw + gap),
        horizon - barH,
        bw,
        barH + 2,
      );
    }

    /* reflections — one transform for the whole strip */
    ctx.save();
    ctx.translate(0, horizon * 2);
    ctx.scale(1, -1);
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < N; i++) {
      const barH = amps[i] * maxH;
      if (barH < 0.5) continue;
      ctx.drawImage(
        this._barS(colors[i]),
        16 + i * (bw + gap),
        horizon - barH,
        bw,
        Math.min(barH, maxH * 0.34),
      );
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    /* peak caps */
    for (let i = 0; i < N; i++) {
      if (this.peaks[i] <= 0.03) continue;
      ctx.fillStyle = colors[i];
      ctx.globalAlpha = 0.85;
      ctx.fillRect(16 + i * (bw + gap), horizon - this.peaks[i] * maxH - 2, bw, 2);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------- LINEAR WAVE ---------------- */

  _waves(wave, dt60) {
    const { ctx, w, h } = this;
    const midY = h * 0.5;
    const ampScale = h * 0.3 * (0.4 + this.sensitivity * 0.5);

    const buildPath = (data, yBase, yScale, smoothing) => {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const i = Math.min(data.length - 1, Math.floor((x / w) * data.length));
        const v = (data[i] - 128) / 128;
        const y = yBase + v * yScale * smoothing;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    };

    if (this.echo) {
      ctx.globalCompositeOperation = 'lighter';
      buildPath(this.echo, midY + 14, ampScale * 0.7, 0.5);
      ctx.strokeStyle = hexRgba(this._color(2), 0.3);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }

    buildPath(wave, midY, ampScale, 1);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, midY - ampScale, 0, h);
    g.addColorStop(0, hexRgba(this._color(0), 0.16));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fill();

    buildPath(wave, midY, ampScale, 1);
    ctx.strokeStyle = this._color(0);
    ctx.lineWidth = 2.2;
    ctx.stroke();

    this.echo = this.echo || new Uint8Array(wave.length);
    const k = 1 - Math.pow(0.85, dt60);
    for (let i = 0; i < wave.length; i++) {
      this.echo[i] = Math.round(lerp(this.echo[i] || 128, wave[i], k));
    }
  }

  /* ---------------- PARTICLE FIELD ---------------- */

  _particles(dt, dt60) {
    const { ctx, w, h } = this;
    const cx = w / 2;
    const cy = h * 0.5;
    const cap = this.quality === 'low' ? 110 : 220;

    const rate = (14 + this.sm.level * 150 * this.sensitivity * 0.5) + (this.beat > 0.6 ? 240 : 0);
    this._spawnAcc += rate * dt;
    let spawn = Math.floor(this._spawnAcc);
    this._spawnAcc -= spawn;

    for (let i = 0; i < spawn && this.particles.length < cap; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = (0.4 + Math.random() * 1.2 + this.sm.bass * 4.5) * this.sensitivity;
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 40,
        y: cy + (Math.random() - 0.5) * 40,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 0.3,
        r: 0.8 + Math.random() * 2.4,
        c: Math.floor(Math.random() * this.theme.colors.length),
        life: 1,
        decay: 0.006 + Math.random() * 0.012,
      });
    }

    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt60;
      p.y += p.vy * dt60;
      p.vx *= Math.pow(0.985, dt60);
      p.vy = p.vy * Math.pow(0.985, dt60) - 0.012 * dt60;
      p.life -= p.decay * dt60;
      if (p.life <= 0 || p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) {
        this.particles.splice(i, 1);
        continue;
      }
      const sprite = this._dot(this._color(p.c));
      const r = p.r * 5;
      ctx.globalAlpha = Math.max(0, 0.62 * p.life);
      ctx.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;

    if (this.quality !== 'low') {
      const lineAlpha = 0.1 + this.sm.level * 0.22;
      if (lineAlpha > 0.12) {
        ctx.lineWidth = 0.7;
        const pts = this.particles;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i];
          for (let j = i + 1; j < pts.length; j++) {
            const b = pts[j];
            const dx = a.x - b.x;
            if (dx > 85 || dx < -85) continue;
            const dy = a.y - b.y;
            if (dy > 85 || dy < -85) continue;
            const d2 = dx * dx + dy * dy;
            if (d2 < 7225) {
              ctx.strokeStyle = hexRgba(this._color(a.c), lineAlpha * (1 - d2 / 7225) * a.life * b.life);
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.stroke();
            }
          }
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- KALEIDOSCOPE ---------------- */

  _kaleido(freq, dt) {
    const { ctx, w, h } = this;
    const cx = w / 2;
    const cy = h / 2;
    const minDim = Math.min(w, h);
    const slices = this.quality === 'low' ? 6 : 10;
    const span = (Math.PI * 2) / slices;
    const rot = this.t * (0.12 + this.sm.level * 1.1) + this.beat * 0.4;
    const inner = minDim * 0.07 + this.sm.bass * minDim * 0.09;
    const maxR = minDim * 0.4 * (0.75 + this.sensitivity * 0.35);
    const P = this.quality === 'low' ? 28 : 56;
    void dt;

    ctx.globalCompositeOperation = 'lighter';
    for (let s = 0; s < slices; s++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(s * span + rot);
      const c = this._color(s);

      const pts = [];
      for (let i = 0; i <= P; i++) {
        const idx = logFreqIndex(i, P, freq.length);
        const v = freq[idx] / 255;
        const ang = (i / P) * span * 0.94;
        const r = inner + v * maxR * this.sensitivity * 0.85;
        pts.push([Math.cos(ang) * r, Math.sin(ang) * r]);
      }

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(pts[0][0], pts[0][1]);
      for (const [px, py] of pts) ctx.lineTo(px, py);
      ctx.closePath();
      const fg = ctx.createRadialGradient(0, 0, inner, 0, 0, inner + maxR);
      fg.addColorStop(0, hexRgba(c, 0.02));
      fg.addColorStop(1, hexRgba(c, 0.14));
      ctx.fillStyle = fg;
      ctx.fill();

      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
        else ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.strokeStyle = hexRgba(c, 0.8);
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- RADIAL TUNNEL ---------------- */

  _tunnel() {
    const { ctx, w, h } = this;
    const cx = w / 2;
    const cy = h / 2;
    const minDim = Math.min(w, h);
    const rings = this.quality === 'low' ? 16 : 26;
    const maxR = minDim * 0.46;

    while (this.history.length < rings) this.history.push(0);

    ctx.globalCompositeOperation = 'lighter';

    const glowR = maxR * 0.18 * (1 + this.sm.bass * 1.2);
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    cg.addColorStop(0, hexRgba(this._color(0), 0.14));
    cg.addColorStop(1, hexRgba(this._color(0), 0));
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < rings; i++) {
      const baseR = maxR * Math.pow((i + 1) / rings, 1.15);
      const pulse = this.history[this.history.length - 1 - i] * maxR * 0.3 * this.sensitivity;
      const r = baseR + pulse;
      const alpha = 0.85 - (i / rings) * 0.6;
      const c = this._color(Math.floor(i / 2.5) + Math.floor(this.t * 0.06));
      ctx.strokeStyle = hexRgba(c, alpha);
      ctx.lineWidth = Math.max(0.6, 2.4 - (i / rings) * 1.6);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- PLASMA ---------------- */

  _plasma(freq, dt) {
    const { ctx, w, h } = this;
    const cx = w / 2;
    const cy = h / 2;
    const minDim = Math.min(w, h);
    const rings = this.quality === 'low' ? 2 : 3;
    const P = this.quality === 'low' ? 44 : 80;
    void dt;

    ctx.globalCompositeOperation = 'lighter';
    for (let r = 0; r < rings; r++) {
      const baseR = minDim * (0.1 + r * 0.15);
      const spin = this.t * (0.14 + r * 0.08) * (1 + this.sm.level * 1.6) * (r % 2 ? -1 : 1);
      const sprite = this._dot(this._color(r));
      for (let i = 0; i < P; i++) {
        const ang = (i / P) * Math.PI * 2 + spin;
        const idx = logFreqIndex((i * 7 + Math.floor(this.t * 3) * 3) % P, P, freq.length);
        const v = freq[idx] / 255;
        const mod =
          Math.sin(ang * (2 + r * 2) - this.t * 1.4) * this.sm.mid * 0.4 +
          Math.cos(ang * 3 + this.t * 1.1) * this.sm.high * 0.5;
        const rad = baseR * (1 + v * 0.5 * this.sensitivity + mod) + this.beat * baseR * 0.06;
        const x = cx + Math.cos(ang) * rad;
        const y = cy + Math.sin(ang) * rad;
        const s = 7 + v * 6;
        ctx.globalAlpha = clamp(0.2 + v * 0.6, 0.05, 0.85);
        ctx.drawImage(sprite, x - s, y - s, s * 2, s * 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- AURORA TERRAIN ---------------- */

  _terrain(freq, dt) {
    const { ctx, w, h } = this;
    const horizon = h * 0.42;
    const COLS = this.quality === 'low' ? 36 : 60;
    const ROWS = this.quality === 'low' ? 16 : 26;
    const depth = h - horizon;

    /* sample spectrum rows on a fixed clock */
    this._terrainAcc += dt;
    const SAMPLE = 0.055;
    while (this._terrainAcc >= SAMPLE) {
      this._terrainAcc -= SAMPLE;
      const row = new Float32Array(COLS);
      for (let i = 0; i < COLS; i++) {
        const idx = logFreqIndex(i, COLS, freq.length);
        row[i] = clamp((freq[idx] / 255) * this.sensitivity, 0, 1.2);
      }
      this.terrainRows.unshift(row);
      if (this.terrainRows.length > ROWS) this.terrainRows.pop();
    }
    while (this.terrainRows.length < ROWS) this.terrainRows.push(new Float32Array(COLS));

    /* sun */
    const sunR = Math.min(w, h) * (0.11 + this.sm.bass * 0.03 + this.beat * 0.012);
    const sunY = horizon - Math.min(w, h) * 0.16;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.85;
    ctx.drawImage(this._dot(this._color(1)), w / 2 - sunR, sunY - sunR, sunR * 2, sunR * 2);
    ctx.globalAlpha = 1;

    /* sky haze */
    const sky = ctx.createLinearGradient(0, horizon - depth * 0.4, 0, horizon);
    sky.addColorStop(0, hexRgba(this._color(0), 0));
    sky.addColorStop(1, hexRgba(this._color(0), 0.07 + this.beat * 0.07));
    ctx.fillStyle = sky;
    ctx.fillRect(0, horizon - depth * 0.4, w, depth * 0.4);

    /* grid */
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, horizon, w, depth);
    ctx.clip();
    ctx.translate(w / 2, horizon);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.1;

    const ampBase = depth * 0.34;
    for (let r = ROWS - 1; r >= 0; r--) {
      const row = this.terrainRows[r];
      const u = (r + 1) / ROWS;               /* 0 = nearest, 1 = farthest */
      const persp = 1 - u * u;                 /* near rows spread wide     */
      const y = depth * u * u;                 /* perspective bunching      */
      const spread = 0.22 + 1.9 * persp * persp;
      const amp = ampBase * persp * (0.5 + this.sm.level * 1.1);

      ctx.beginPath();
      for (let i = 0; i <= COLS; i++) {
        const ci = Math.min(COLS - 1, i);
        const x = ((ci / COLS) - 0.5) * w * spread;
        const yy = y - row[ci] * amp;
        if (i === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      const c = this._color(r % this.theme.colors.length);
      ctx.strokeStyle = hexRgba(c, 0.65 * persp);
      ctx.stroke();

      /* fill ribbon toward the previous (nearer) row */
      if (r > 0) {
        const uPrev = r / ROWS;
        const yPrev = depth * uPrev * uPrev;
        ctx.lineTo(((COLS - 1) / COLS - 0.5) * w * (0.22 + 1.9 * Math.pow(1 - uPrev, 2)), yPrev + 2);
        ctx.lineTo((-0.5) * w * (0.22 + 1.9 * Math.pow(1 - uPrev, 2)), yPrev + 2);
        ctx.closePath();
        ctx.fillStyle = hexRgba(c, 0.05 * persp);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- NEBULA ---------------- */

  _nebula() {
    const { ctx, w, h } = this;
    const cx = w / 2;
    const cy = h / 2;
    const N = this.quality === 'low' ? 5 : 9;
    const minDim = Math.min(w, h);

    if (!this.nebula || this.nebula.length !== N) {
      this.nebula = Array.from({ length: N }, (_, i) => ({
        ax: 0.16 + ((i * 37) % 11) / 34,
        ay: 0.14 + ((i * 53) % 13) / 42,
        fx: 0.11 + ((i * 29) % 7) / 48,
        fy: 0.09 + ((i * 41) % 5) / 38,
        p1: (i * 2.399) % 6.283,
        p2: (i * 4.913) % 6.283,
        sz: 0.16 + ((i * 17) % 10) / 42,
        band: i % 3,
      }));
    }

    ctx.globalCompositeOperation = 'lighter';
    const bands = [this.sm.bass, this.sm.mid, this.sm.high];
    const swirl = this.t * (0.05 + this.sm.level * 0.35);
    for (let i = 0; i < N; i++) {
      const b = this.nebula[i];
      const x = cx + Math.sin(this.t * b.fx * 2 + b.p1) * w * b.ax;
      const y = cy + Math.cos(this.t * b.fy * 2 + b.p2) * h * b.ay;
      const bandV = bands[b.band];
      const r = minDim * b.sz * (0.75 + bandV * 1.5 * this.sensitivity + this.beat * 0.18);
      const ci = Math.floor(this.t * 0.05 + i * 0.8);
      const sprite = this._dot(this._color(ci));
      ctx.globalAlpha = clamp(0.1 + bandV * 0.5 * this.sensitivity, 0.05, 0.55);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(swirl * (i % 2 ? 1 : -1));
      ctx.drawImage(sprite, -r, -r, r * 2, r * 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- SPIRAL GALAXY ---------------- */

  _spiral(freq) {
    const { ctx, w, h } = this;
    const cx = w / 2;
    const cy = h / 2;
    const minDim = Math.min(w, h);
    const arms = this.quality === 'low' ? 2 : 3;
    const PTS = this.quality === 'low' ? 90 : 170;
    const rot = this.t * (0.08 + this.sm.level * 0.8) - this.beat * 0.25;
    const inner = minDim * 0.03;
    const outer = minDim * 0.44;

    ctx.globalCompositeOperation = 'lighter';

    /* galactic core */
    const coreR = minDim * (0.07 + this.sm.bass * 0.09 + this.beat * 0.02);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this._dot(this._color(1)), cx - coreR, cy - coreR, coreR * 2, coreR * 2);

    const P = 96;
    for (let a = 0; a < arms; a++) {
      const baseAng = (a / arms) * Math.PI * 2;
      const dir = a % 2 ? 1 : -1;
      const c = this._color(a);

      const pt = (i) => {
        const tt = i / PTS;
        const theta = baseAng + tt * 4.6 * dir + rot * (1 - tt * 0.35);
        const r = inner + Math.pow(tt, 1.35) * outer;
        return { x: cx + Math.cos(theta) * r, y: cy + Math.sin(theta) * r, theta, tt };
      };

      /* continuous arm stroke — the structural spine of the galaxy */
      ctx.beginPath();
      for (let i = 0; i <= PTS; i++) {
        const p = pt(i);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = hexRgba(c, 0.3 + this.sm.level * 0.25);
      ctx.lineWidth = Math.max(1.2, minDim * 0.007 * (1 + this.sm.bass));
      ctx.stroke();

      /* spectrum-driven star clusters along the arm */
      for (let i = 0; i < PTS; i++) {
        const p = pt(i);
        const idx = logFreqIndex((i * 5 + a * 11) % P, P, freq.length);
        const v = freq[idx] / 255;
        const jitter = Math.sin(i * 12.9898 + this.t * 2.2 + a) * 0.05;
        const spread = ((Math.sin(i * 7.13 + a * 3.3) + Math.cos(i * 3.71)) / 2) * 0.06 * (0.4 + v);
        const x = p.x + Math.cos(p.theta) * jitter * p.r + Math.cos(p.theta + Math.PI / 2) * spread * outer;
        const y = p.y + Math.sin(p.theta) * jitter * p.r + Math.sin(p.theta + Math.PI / 2) * spread * outer;
        const size = 3 + v * 10 * this.sensitivity + (1 - p.tt) * 4;
        const sprite = this._dot(this._color(a + Math.floor(p.tt * 2)));
        ctx.globalAlpha = clamp((0.42 + v * 0.5) * (1 - p.tt * 0.45), 0.18, 0.9);
        ctx.drawImage(sprite, x - size, y - size, size * 2, size * 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
