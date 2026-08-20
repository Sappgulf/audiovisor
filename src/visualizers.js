import { THEMES } from './themes.js';
import { lerp, logFreqIndex, hexRgba, clamp } from './utils.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = 0;
    this.h = 0;
    this.t = 0;

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

    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    const scale = this.quality === 'low' ? 1 : this.dpr;
    this.canvas.width = Math.round(this.w * scale);
    this.canvas.height = Math.round(this.h * scale);
  }

  setQuality(q) {
    if (this.quality === q) return;
    this.quality = q;
    this.resize();
  }

  setMode(m) { this.mode = m; this.history = []; this.echo = null; }
  setTheme(t) { this.theme = t; }
  setSensitivity(v) { this.sensitivity = v; }
  setBassFocus(v) { this.bassFocus = v; }

  _updateLevels(levels) {
    const k = 0.28;
    const t = levels
      ? { bass: Math.min(1.2, levels.bass * (1 + this.bassFocus * 0.6)), mid: levels.mid, high: levels.high, level: levels.level }
      : { bass: 0, mid: 0, high: 0, level: 0 };
    const prevBass = this.sm.bass;
    this.sm.bass = lerp(this.sm.bass, t.bass, k);
    this.sm.mid = lerp(this.sm.mid, t.mid, k);
    this.sm.high = lerp(this.sm.high, t.high, k);
    this.sm.level = lerp(this.sm.level, t.level, k);

    if (this.sm.bass - prevBass > 0.18 && this.sm.bass > 0.45) this.beat = 1;

    this.history.unshift(this.sm.level);
    if (this.history.length > 34) this.history.pop();
  }

  render(idle, freq, wave, levels) {
    const { ctx, w, h } = this;
    this.t += 1 / 60;
    this.beat *= 0.88;
    this._updateLevels(levels);
    const scale = this.quality === 'low' ? 1 : this.dpr;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (idle) {
      this._idle();
      return;
    }

    switch (this.mode) {
      case 'bars': this._bars(freq); break;
      case 'waves': this._waves(wave); break;
      case 'particles': this._particles(); break;
      case 'kaleido': this._kaleido(freq); break;
      case 'tunnel': this._tunnel(); break;
      case 'plasma': this._plasma(freq); break;
    }

    if (this.beat > 0.5) this._beatFlash();
  }

  _color(i) {
    return this.theme.colors[i % this.theme.colors.length];
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

  _idle() {
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
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const c = this._color(Math.floor(this.t * 0.02) + i);
      g.addColorStop(0, hexRgba(c, 0.075));
      g.addColorStop(1, hexRgba(c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    if (this.idleDots.length < 40) {
      this.idleDots.push({
        x: Math.random() * w,
        y: h + Math.random() * h * 0.3,
        s: 0.4 + Math.random() * 0.9,
        v: 0.15 + Math.random() * 0.5,
        ph: Math.random() * Math.PI * 2,
      });
    }
    for (const d of this.idleDots) {
      d.y -= d.v;
      if (d.y < -10) { d.y = h + 10; d.x = Math.random() * w; }
      const a = 0.05 + 0.12 * (0.5 + 0.5 * Math.sin(this.t * 1.2 + d.ph));
      ctx.fillStyle = hexRgba(this._color(0), a);
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- SPECTRUM BARS ---------------- */

  _bars(freq) {
    const { ctx, w, h } = this;
    const horizon = h * 0.65;
    const N = Math.min(96, Math.max(48, Math.round(w / (this.quality === 'low' ? 22 : 14))));
    const gap = Math.max(1.5, w / N / 5);
    const bw = (w - gap * (N - 1) - 32) / N;

    if (this.barIndices.length !== N) {
      this.barIndices = [];
      for (let i = 0; i < N; i++) this.barIndices.push(logFreqIndex(i, N, freq.length));
    }

    if (this.peaks.length !== N) this.peaks = new Array(N).fill(0);

    const amps = new Array(N);
    for (let i = 0; i < N; i++) {
      const idx = this.barIndices[i];
      const v = (freq[idx] / 255) * this.sensitivity;
      const weight = 1 + this.bassFocus * 2.2 * (1 - i / N);
      amps[i] = clamp(v * weight, 0.008, 1);
      this.peaks[i] = Math.max(this.peaks[i] * 0.985, amps[i]);
    }

    const maxH = horizon - h * 0.06;

    const g = ctx.createLinearGradient(0, horizon, 0, h);
    g.addColorStop(0, hexRgba(this._color(0), 0.05 + this.beat * 0.05));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon, w, h - horizon);

    const glow = this.quality !== 'low';

    for (let i = 0; i < N; i++) {
      const x = 16 + i * (bw + gap);

      const barH = amps[i] * maxH;
      const yTop = horizon - barH;
      const c = this._color(Math.floor((i / N) * this.theme.colors.length));
      const bg = ctx.createLinearGradient(0, yTop, 0, horizon);
      bg.addColorStop(0, hexRgba(c, 0.95));
      bg.addColorStop(1, hexRgba(c, 0.25));
      ctx.fillStyle = bg;
      if (glow) {
        ctx.shadowColor = c;
        ctx.shadowBlur = 16 * amps[i];
      }
      ctx.beginPath();
      ctx.roundRect(x, yTop, bw, barH + 2, [bw / 2, bw / 2, 0, 0]);
      ctx.fill();
      ctx.shadowBlur = 0;

      const rH = barH * 0.32;
      const rg = ctx.createLinearGradient(0, horizon, 0, horizon + rH);
      rg.addColorStop(0, hexRgba(c, 0.16));
      rg.addColorStop(1, hexRgba(c, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(x, horizon, bw, rH);

      const peakH = this.peaks[i] * maxH;
      if (this.peaks[i] > 0.03) {
        ctx.fillStyle = hexRgba(c, 0.85);
        ctx.fillRect(x, horizon - peakH - 2, bw, 2);
      }
    }
  }

  /* ---------------- LINEAR WAVE ---------------- */

  _waves(wave) {
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
    if (this.quality !== 'low') {
      ctx.shadowColor = this._color(0);
      ctx.shadowBlur = 14;
    }
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;

    this.echo = this.echo || new Uint8Array(wave.length);
    for (let i = 0; i < wave.length; i++) {
      this.echo[i] = Math.round(lerp(this.echo[i] || 128, wave[i], 0.15));
    }
  }

  /* ---------------- PARTICLE FIELD ---------------- */

  _particles() {
    const { ctx, w, h } = this;
    const cx = w / 2;
    const cy = h * 0.5;
    const cap = this.quality === 'low' ? 80 : 150;

    const burst = this.beat > 0.6 ? 6 : 0;
    const spawn = Math.floor(2 + this.sm.level * 14 * this.sensitivity * 0.5) + burst;
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
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.vy -= 0.012;
      p.life -= p.decay;
      if (p.life <= 0 || p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) {
        this.particles.splice(i, 1);
        continue;
      }
      const c = this._color(p.c);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 5);
      g.addColorStop(0, hexRgba(c, 0.5 * p.life));
      g.addColorStop(1, hexRgba(c, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexRgba('#ffffff', 0.55 * p.life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }

    if (this.quality !== 'low') {
      const lineAlpha = 0.1 + this.sm.level * 0.22;
      if (lineAlpha > 0.12) {
        ctx.lineWidth = 0.7;
        for (let i = 0; i < this.particles.length; i++) {
          const a = this.particles[i];
          for (let j = i + 1; j < this.particles.length; j++) {
            const b = this.particles[j];
            const dx = a.x - b.x;
            if (Math.abs(dx) > 85) continue;
            const dy = a.y - b.y;
            if (Math.abs(dy) > 85) continue;
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

  _kaleido(freq) {
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
      ctx.lineTo(0, 0);
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
      ctx.strokeStyle = hexRgba(c, 0.75);
      if (this.quality !== 'low') {
        ctx.shadowColor = c;
        ctx.shadowBlur = 10;
      }
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
  }

  /* ---------------- RADIAL TUNNEL ---------------- */

  _tunnel() {
    const { ctx, w, h } = this;
    const cx = w / 2;
    const cy = h / 2;
    const minDim = Math.min(w, h);
    const rings = this.quality === 'low' ? 14 : 24;
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
      const pulse = this.history[i] * maxR * 0.3 * this.sensitivity;
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

  _plasma(freq) {
    const { ctx, w, h } = this;
    const cx = w / 2;
    const cy = h / 2;
    const minDim = Math.min(w, h);
    const rings = this.quality === 'low' ? 2 : 3;
    const P = this.quality === 'low' ? 40 : 72;

    ctx.globalCompositeOperation = 'lighter';
    for (let r = 0; r < rings; r++) {
      const baseR = minDim * (0.1 + r * 0.15);
      const spin = this.t * (0.14 + r * 0.08) * (1 + this.sm.level * 1.6) * (r % 2 ? -1 : 1);
      const c = this._color(r);
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
        const a = 0.18 + v * 0.55;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 7);
        g.addColorStop(0, hexRgba(c, a));
        g.addColorStop(1, hexRgba(c, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
