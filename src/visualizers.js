import { THEMES } from './themes.js';
import { lerp, logFreqIndex, logSample, hexRgba, clamp } from './utils.js';

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
    this.ctx = canvas.getContext && canvas.getContext('2d');
    this._dead = !this.ctx;
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
    this.colorPop = 1.0;
    this.bloomAmount = 0.5;

    this.quality = 'high';

    this.sm = { bass: 0, mid: 0, high: 0, level: 0 };
    this.beat = 0;
    this.history = [];
    this.particles = [];
    this.peaks = [];
    this.peakVels = [];
    this.idleDots = [];
    this.echo = null;

    /* per-mode state */
    this.terrainRows = [];
    this._terrainAcc = 0;
    this._histAcc = 0;
    this._spawnAcc = 0;
    this.nebula = null;

    /* vectorscope / spectrogram / city / orb state */
    this.scopeCv = null;
    this.scopeCtx = null;
    this.scopeSig = '';
    this.specCv = null;
    this.specCtx = null;
    this.specLut = null;
    this.specSig = '';
    this._specAcc = 0;
    this.cityCols = [];
    this.stars = [];
    this._starSig = '';
    this.orbSat = [];
    this._scopePts = null;

    /* caches */
    this._dotSprites = null;
    this._barSprites = null;
    this._floorGrads = null;
    this._cacheSig = '';

    this.trailCv = null;
    this.trailCtx = null;

    this.resize();
  }

  resize() {
    if (this._dead) return;
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

  setMode(m) {
    this.mode = m;
    this.history = [];
    this.echo = null;
    this.terrainRows = [];
    this.cityCols = [];
    this.specSig = '';
    this.scopeSig = '';
    this.scopeCv = null;
    this.scopeCtx = null;
    this.orbSat = [];
    this._scopePts = null;
  }
  setTheme(t) {
    this.theme = t;
    this._cacheSig = '';
    this.specSig = '';
  }
  setSensitivity(v) { this.sensitivity = v; }
  setBassFocus(v) { this.bassFocus = v; }
  setColorPop(v) { this.colorPop = v; this._cacheSig = ''; }
  setBloom(v) { this.bloomAmount = v; }

  /* ---------------- caches ---------------- */

  _buildCache() {
    const sig = `${this.theme.colors.join(',')}|${this.quality}`;
    if (this._cacheSig === sig && this._dotSprites) return;
    this._cacheSig = sig;

    this._dotSprites = new Map();
    this._barSprites = new Map();
    for (const c of this.theme.colors) {
      // dot: warm highlight + soft outer bloom, 64x64
      const d = document.createElement('canvas');
      d.width = d.height = 64;
      const dc = d.getContext('2d');
      const g = dc.createRadialGradient(30, 29, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255, 252, 243, 0.96)');
      g.addColorStop(0.10, 'rgba(255, 255, 255, 0.88)');
      g.addColorStop(0.24, hexRgba(c, 0.90));
      g.addColorStop(0.42, hexRgba(c, 0.52));
      g.addColorStop(1, hexRgba(c, 0));
      dc.fillStyle = g;
      dc.fillRect(0, 0, 64, 64);
      // tiny specular highlight
      dc.fillStyle = 'rgba(255,255,255,0.52)';
      dc.beginPath();
      dc.ellipse(26, 24, 6, 4.5, -0.6, 0, Math.PI * 2);
      dc.fill();
      // rim light (soft edge ring)
      dc.strokeStyle = 'rgba(255,255,255,0.28)';
      dc.lineWidth = 1.6;
      dc.beginPath();
      dc.arc(32, 32, 21, 0, Math.PI * 2);
      dc.stroke();
      this._dotSprites.set(c, d);

      // bar: polished metal with top highlight and inner sheen, 8x256
      const b = document.createElement('canvas');
      b.width = 8;
      b.height = 256;
      const bc = b.getContext('2d');
      const bg = bc.createLinearGradient(0, 0, 0, 256);
      bg.addColorStop(0, hexRgba(c, 1));
      bg.addColorStop(0.10, 'rgba(255,255,255,0.42)');
      bg.addColorStop(0.14, hexRgba(c, 1));
      bg.addColorStop(0.78, hexRgba(c, 0.62));
      bg.addColorStop(1, hexRgba(c, 0.18));
      bc.fillStyle = bg;
      bc.beginPath();
      if (bc.roundRect) bc.roundRect(0, 0, 8, 256, [4, 4, 0, 0]);
      else bc.rect(0, 0, 8, 256);
      bc.fill();
      // inner sheen line
      bc.fillStyle = 'rgba(255,255,255,0.18)';
      bc.fillRect(1.2, 0, 1, 256);
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
    this.sm.bass = lerp(this.sm.bass, t.bass, k);
    this.sm.mid = lerp(this.sm.mid, t.mid, k);
    this.sm.high = lerp(this.sm.high, t.high, k);
    this.sm.level = lerp(this.sm.level, t.level, k);

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
    if (this._dead || !this.ctx) return;
    const { ctx, w, h } = this;
    const dt = clamp((dtMs || 16.7) / 1000, 0.001, 0.06);
    const dt60 = dt * 60;

    this.t += dt;
    this.beatInfo = levels || this.beatInfo || { bpm: 0, beatPhase: 0 };
    const tracked = levels?.beatPulse;
    if (tracked != null) {
      this.beat = Math.max(tracked, this.beat * Math.pow(0.86, dt60));
    } else {
      this.beat *= Math.pow(0.86, dt60);
    }
    this._updateLevels(levels, dt);
    this._buildCache();

    const scale = this.quality === 'low' ? 1 : this.dpr;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (idle || !freq || !wave) {
      this._idle(dt60);
      this._bloom(this.beat);
      return;
    }

    const chop = !!levels?.chop;
    const chopGlitch = chop && ((this.t * 1000) % 420) < 95;
    if (chopGlitch) {
      ctx.save();
      // screwed low, slow feel: slight desat via overlay
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = '#1a0a1e';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    const punched = this.beat > 0.02;
    if (punched) {
      ctx.save();
      const z = 1 + this.beat * 0.018;
      ctx.translate(w / 2, h / 2);
      ctx.scale(z, z);
      ctx.translate(-w / 2, -h / 2);
    }
    // chop slice stutter (VHS)
    if (chopGlitch) {
      ctx.save();
      const sliceY = (this.t * 380) % h;
      ctx.translate((Math.sin(this.t * 62) * 7), 0);
      ctx.beginPath();
      ctx.rect(0, sliceY, w, 18 + Math.random()*22);
      ctx.clip();
    }
    this._scene(freq, wave, dt, dt60);
    if (chopGlitch) ctx.restore();
    if (punched) ctx.restore();

    // ray-trace SSR floor (subtle reflection of the scene)
    if (this.quality !== 'low' && this.mode !== 'bars') {
      const fh = Math.round(h * 0.28);
      const sy = h - fh;
      ctx.save();
      ctx.globalAlpha = 0.13;
      ctx.globalCompositeOperation = 'source-over';
      // flip vertically around sy
      ctx.translate(0, sy * 2 + fh);
      ctx.scale(1, -1);
      // draw only the upper region that reflects
      ctx.drawImage(this.canvas, 0, 0, w, fh, 0, 0, w, fh);
      ctx.restore();
      // fade the reflection
      const fade = ctx.createLinearGradient(0, sy, 0, h);
      fade.addColorStop(0, 'rgba(15,14,13,0)');
      fade.addColorStop(1, 'rgba(15,14,13,0.92)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, sy, w, fh);
    }

    if (this.beat > 0.45) this._kickFlare();

    /* phosphor trail: accumulate this frame onto a faded accumulation
       buffer, then blend it under the live scene */
    if (this.quality !== 'low') {
      if (!this.trailCv || this.trailCv.width !== this.canvas.width || this.trailCv.height !== this.canvas.height) {
        this.trailCv = document.createElement('canvas');
        this.trailCv.width = this.canvas.width;
        this.trailCv.height = this.canvas.height;
        this.trailCtx = this.trailCv.getContext('2d');
      }
      const tc = this.trailCtx;
      const s = this.quality === 'low' ? 1 : this.dpr;
      tc.setTransform(1, 0, 0, 1, 0, 0);
      tc.globalCompositeOperation = 'destination-out';
      tc.fillStyle = 'rgba(0,0,0,0.28)';
      tc.fillRect(0, 0, this.canvas.width, this.canvas.height);
      tc.globalCompositeOperation = 'source-over';
      tc.drawImage(this.canvas, 0, 0);
      // blend trail under live scene
      ctx.save();
      ctx.setTransform(s, 0, 0, s, 0, 0);
      ctx.globalAlpha = 0.36;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.trailCv, 0, 0, w, h);
      ctx.restore();
    }

    if (this.mode !== 'bars' && this.beatInfo?.bpm > 0) this._beatGrid();
    this._bloom(this.beat);
  }

  /* beat-grid: 4 phase dots + pulse ring, bottom-center */
  _beatGrid() {
    const { ctx, w, h } = this;
    const by = h - 34;
    const cx = w / 2;
    const dot = this._dot(this._color(2));
    const quarter = Math.floor(this.beatInfo.beatPhase * 4);
    const gap = 16;
    const base = cx - gap * 1.5;
    for (let i = 0; i < 4; i++) {
      const lit = (i + 1) % 4 === (quarter + (this.beat > 0.35 ? 1 : 0)) % 4;
      const v = lit ? 0.9 + this.beat * 0.35 : 0.12;
      const r = lit ? 3.4 + this.beat * 1.6 : 2.2;
      ctx.globalAlpha = v;
      ctx.drawImage(dot, base + i * gap - r, by - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }

  _scene(freq, wave, dt, dt60) {
    switch (this.mode) {
      case 'bars': this._bars(freq, dt60, dt); break;
      case 'waves': this._waves(wave, dt60); break;
      case 'scope': this._scope(wave, dt60); break;
      case 'particles': this._particles(dt, dt60); break;
      case 'kaleido': this._kaleido(freq, dt); break;
      case 'spectro': this._spectro(freq, dt); break;
      case 'tunnel': this._tunnel(freq); break;
      case 'plasma': this._plasma(freq, dt); break;
      case 'terrain': this._terrain(freq, dt); break;
      case 'city': this._city(freq, dt60); break;
      case 'nebula': this._nebula(); break;
      case 'spiral': this._spiral(freq); break;
      case 'orb': this._orb(freq, dt60, dt); break;
      case 'fluid': this._fluid(freq); break;
      case 'tensor': this._tensor(freq); break;
      case 'prism': this._prism(freq); break;
      case 'void': this._void(freq); break;
      case 'bloomfield': this._bloomField(freq); break;
    }
  }

  /* ---------------- bloom ---------------- */

  _bloom(punch = 0) {
    if (this.quality === 'low' || this.bloomAmount <= 0.01) return;
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
    ctx.globalAlpha = clamp((0.36 + punch * 0.12) * (0.5 + this.bloomAmount), 0, 0.62);
    ctx.drawImage(this.glowB, -w * 0.02, -h * 0.02, w * 1.04, h * 1.04);
    ctx.globalAlpha = clamp((0.28 + punch * 0.10) * (0.5 + this.bloomAmount), 0, 0.52);
    ctx.drawImage(this.glowA, 0, 0, w, h);
    ctx.restore();
  }

  _kickFlare() {
    const { ctx, w, h } = this;
    /* soft lens flare core + horizontal streak (no full-screen wash) */
    const cx = w / 2, cy = h * 0.45;
    const maxD = Math.max(w, h);
    const flareR = maxD * (0.16 + this.beat * 0.22);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp((this.beat - 0.4) * 0.35, 0, 0.24);
    ctx.drawImage(this._dot(this._color(0)), cx - flareR, cy - flareR, flareR * 2, flareR * 2);
    ctx.globalAlpha = clamp((this.beat - 0.4) * 0.22, 0, 0.13);
    const sr = maxD * (0.28 + this.beat * 0.3);
    ctx.drawImage(this._dot(this._color(1)), cx - sr, cy - sr * 0.22, sr * 2, sr * 0.44);
    ctx.restore();
    ctx.globalAlpha = 1;
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
  /* ---------------- SPECTRUM GLASS BARS ---------------- */

  _rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  _bars(freq, dt60, dt) {
    const { ctx, w, h } = this;
    const horizon = h * 0.66;
    const N = Math.min(88, Math.max(44, Math.round(w / (this.quality === 'low' ? 24 : 14))));
    const gap = Math.max(2, w / N / 6);
    const bw = (w - gap * (N - 1) - 24) / N;

    if (this.peaks.length !== N) {
      this.peaks = new Array(N).fill(0);
      this.peakVels = new Array(N).fill(0);
    }
    const maxH = horizon - h * 0.05;
    const c0 = this._color(0);

    /* floor glow */
    if (!this._floorGrads) {
      this._floorGrads = {};
      for (const c of this.theme.colors) {
        const g = ctx.createLinearGradient(0, horizon, 0, h);
        g.addColorStop(0, hexRgba(c, 0.08));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        this._floorGrads[c] = g;
      }
    }
    ctx.fillStyle = this._floorGrads[c0];
    ctx.fillRect(0, horizon, w, h - horizon);

    const colors = [];
    const amps = new Array(N);
    const hueFlow = Math.floor(this.t * 0.5);
    for (let i = 0; i < N; i++) {
      const v = logSample(freq, i / N) * this.sensitivity;
      const weight = 1 + this.bassFocus * 2.2 * (1 - i / N);
      const bounce = 1 + this.beat * 0.34 * (1 - i / N);
      amps[i] = clamp(v * weight * bounce, 0.008, 1.25);
      if (amps[i] >= this.peaks[i]) { this.peaks[i] = amps[i]; this.peakVels[i] = 0; }
      else { this.peakVels[i] += 3.2 * dt; this.peaks[i] = Math.max(amps[i], this.peaks[i] - this.peakVels[i] * dt); }
      colors[i] = this._color(Math.floor((i / N) * this.theme.colors.length + hueFlow) % this.theme.colors.length);
    }

    const barX = (i) => 12 + i * (bw + gap);

    /* soft backdrop halo per bar */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < N; i++) {
      const bh = amps[i] * maxH;
      if (bh < 2) continue;
      const x = barX(i);
      const halo = this._dot(colors[i]);
      const hr = bw * 1.6;
      ctx.globalAlpha = 0.10 + amps[i] * 0.12;
      ctx.drawImage(halo, x + bw / 2 - hr, horizon - bh - hr * 0.4, hr * 2, hr * 2);
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    /* glass slab body */
    for (let i = 0; i < N; i++) {
      const bh = amps[i] * maxH;
      if (bh < 1.5) continue;
      const x = barX(i);
      const col = colors[i];
      const g = ctx.createLinearGradient(0, horizon - bh, 0, horizon);
      g.addColorStop(0, hexRgba(col, 0.95));
      g.addColorStop(0.12, 'rgba(255,255,255,0.28)');
      g.addColorStop(0.2, hexRgba(col, 0.9));
      g.addColorStop(1, hexRgba(col, 0.35));
      ctx.fillStyle = g;
      this._rr(ctx, x, horizon - bh, bw, bh, Math.min(4, bw / 2));
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(x + bw * 0.28, horizon - bh + 2, Math.max(1, bw * 0.1), Math.max(1, bh - 3));
    }

    /* reflections under horizon */
    ctx.save();
    ctx.translate(0, horizon * 2);
    ctx.scale(1, -1);
    ctx.globalAlpha = 0.16;
    for (let i = 0; i < N; i++) {
      const bh = amps[i] * maxH;
      if (bh < 1.5) continue;
      const x = barX(i);
      ctx.fillStyle = hexRgba(colors[i], 0.5);
      this._rr(ctx, x, horizon - bh, bw, Math.min(bh, maxH * 0.3), Math.min(4, bw / 2));
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    /* peak caps */
    for (let i = 0; i < N; i++) {
      if (this.peaks[i] <= 0.03) continue;
      const x = barX(i);
      const y = horizon - this.peaks[i] * maxH - 2;
      ctx.fillStyle = colors[i];
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x, y, bw, 2);
      if (this.quality !== 'low' && this.peaks[i] > 0.22) {
        const r = bw * 0.8;
        ctx.globalAlpha = 0.5;
        ctx.drawImage(this._dot(colors[i]), x + bw / 2 - r, y - r + 1, r * 2, r * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------- SILK HORIZON WAVES ---------------- */

  _waves(wave, dt60) {
    const { ctx, w, h } = this;
    const midY = h * 0.52;
    const ampScale = h * 0.32 * (0.4 + this.sensitivity * 0.5);
    const step = 6;

    const samplePts = (data, yBase, yScale, mul) => {
      const pts = [];
      for (let x = 0; x <= w; x += step) {
        const i = Math.min(data.length - 1, Math.floor((x / w) * data.length));
        const v = (data[i] - 128) / 128;
        pts.push([x, yBase + v * yScale * mul]);
      }
      return pts;
    };
    const strokeSmooth = (pts, color, width, alpha = 1) => {
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2;
        const my = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.globalAlpha = alpha;
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    const pts = samplePts(wave, midY, ampScale, 1);

    /* under-glow band */
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexRgba(this._color(2), 0.12 + this.sm.level * 0.1 + this.beat * 0.08);
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';

    /* fill below */
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    const g = ctx.createLinearGradient(0, midY - ampScale, 0, h);
    g.addColorStop(0, hexRgba(this._color(0), 0.20));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fill();

    /* echo pass */
    if (this.echo) {
      ctx.globalCompositeOperation = 'lighter';
      const ePts = samplePts(this.echo, midY + 16, ampScale * 0.7, 0.5);
      strokeSmooth(ePts, hexRgba(this._color(1), 0.35), 1.1);
      ctx.globalCompositeOperation = 'source-over';
    }

    /* crest beads */
    ctx.globalCompositeOperation = 'lighter';
    const beadStep = 96;
    const sprite = this._dot(this._color(0));
    for (let x = beadStep; x < w; x += beadStep) {
      let bi = 0, best = 1e9;
      for (let i = 0; i < pts.length; i++) { const d = Math.abs(pts[i][0] - x); if (d < best) { best = d; bi = i; } }
      const v = Math.max(0, (wave[Math.min(wave.length - 1, Math.floor((x / w) * wave.length))] - 128) / 128);
      const r = 3 + v * 8 + this.beat * 4;
      ctx.globalAlpha = 0.5 + v * 0.5;
      ctx.drawImage(sprite, pts[bi][0] - r, pts[bi][1] - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    strokeSmooth(pts, this._color(0), 2.3);

    /* mirrored ghost above */
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(0, midY * 2);
    ctx.scale(1, -1);
    strokeSmooth(pts, hexRgba(this._color(2), 0.6), 1.4);
    ctx.restore();

    this.echo = this.echo || new Uint8Array(wave.length);
    const k = 1 - Math.pow(0.85, dt60);
    for (let i = 0; i < wave.length; i++) {
      this.echo[i] = Math.round(lerp(this.echo[i] || 128, wave[i], k));
    }
  }

  /* ---------------- AZURE VECTORSCOPE ---------------- */

  _scope(wave, dt60) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h / 2;
    const minDim = Math.min(w, h);
    const R = minDim * 0.36 * (0.78 + this.sm.level * 0.5 * this.sensitivity);
    const N = this.quality === 'low' ? 110 : 200;
    const delay = Math.floor(wave.length / 4);
    const c0 = this._color(0), c1 = this._color(1);

    /* graticule + ring frame + ticks */
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexRgba(c0, 0.08);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.1, 0, Math.PI * 2);
    ctx.moveTo(cx - R * 1.1, cy); ctx.lineTo(cx + R * 1.1, cy);
    ctx.moveTo(cx, cy - R * 1.1); ctx.lineTo(cx, cy + R * 1.1);
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = hexRgba(c0, 0.14);
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * R * 1.1, cy + Math.sin(ang) * R * 1.1);
      ctx.lineTo(cx + Math.cos(ang) * R * 1.18, cy + Math.sin(ang) * R * 1.18);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    /* phosphor buffer */
    const sig = `${w}x${h}|${this.quality}`;
    if (!this.scopeCv || this.scopeSig !== sig) {
      this.scopeSig = sig;
      this.scopeCv = document.createElement('canvas');
      this.scopeCv.width = Math.max(2, Math.round(w));
      this.scopeCv.height = Math.max(2, Math.round(h));
      this.scopeCtx = this.scopeCv.getContext('2d');
    }
    const sctx = this.scopeCtx;
    const fade = clamp(1 - Math.pow(0.78, dt60), 0.08, 0.55);
    sctx.globalCompositeOperation = 'destination-out';
    sctx.fillStyle = `rgba(0,0,0,${fade})`;
    sctx.fillRect(0, 0, w, h);
    sctx.globalCompositeOperation = 'lighter';

    if (!this._scopePts || this._scopePts.length < N * 2) this._scopePts = new Float32Array(N * 2);
    const pts = this._scopePts;
    for (let i = 0; i < N; i++) {
      const si = ((i / N) * wave.length) | 0;
      const sj = (si + delay) % wave.length;
      pts[i * 2] = ((wave[si] - 128) / 128) * R;
      pts[i * 2 + 1] = ((wave[sj] - 128) / 128) * R;
    }

    sctx.save();
    sctx.translate(cx, cy);
    sctx.rotate(this.t * 0.08);
    sctx.lineJoin = 'round';
    /* colored trace segments */
    const segs = 8;
    for (let s = 0; s < segs; s++) {
      const s0 = Math.floor((N / segs) * s);
      const s1 = Math.min(N - 1, Math.floor((N / segs) * (s + 1)));
      sctx.beginPath();
      for (let i = s0; i <= s1; i++) {
        if (i === s0) sctx.moveTo(pts[i * 2], pts[i * 2 + 1]);
        else sctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
      }
      sctx.strokeStyle = hexRgba(this._color(s), 0.7);
      sctx.lineWidth = 1.6;
      sctx.stroke();
    }
    /* glow pass */
    sctx.beginPath();
    for (let i = 0; i < N; i++) {
      if (i === 0) sctx.moveTo(pts[0], pts[1]);
      else sctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
    }
    sctx.closePath();
    sctx.strokeStyle = hexRgba(c1, 0.32);
    sctx.lineWidth = 3.6;
    sctx.stroke();
    sctx.restore();

    /* composite */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(cx, cy);
    ctx.rotate(this.t * 0.08);
    ctx.drawImage(this.scopeCv, -w / 2, -h / 2, w, h);
    ctx.restore();

    /* heart core */
    const heartR = minDim * 0.012 * (1 + this.beat * 2 + this.sm.bass * 0.5);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(cx, cy);
    ctx.rotate(this.t * 0.08);
    ctx.drawImage(this._dot(c0), -heartR, -heartR, heartR * 2, heartR * 2);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- EMBER FIELD PARTICLES ---------------- */

  _particles(dt, dt60) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h * 0.5;
    const cap = this.quality === 'low' ? 120 : 240;

    const rate = (12 + this.sm.level * 160 * this.sensitivity * 0.5) + (this.beat > 0.6 ? 260 : 0);
    this._spawnAcc += rate * dt;
    let spawn = Math.floor(this._spawnAcc);
    this._spawnAcc -= spawn;

    for (let i = 0; i < spawn && this.particles.length < cap; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = (0.4 + Math.random() * 1.3 + this.sm.bass * 4.5) * this.sensitivity;
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 40,
        y: cy + (Math.random() - 0.5) * 40,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 0.45,
        r: 0.8 + Math.random() * 2.6,
        c: Math.floor(Math.random() * this.theme.colors.length),
        life: 1,
        decay: 0.005 + Math.random() * 0.011,
      });
    }

    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt60;
      p.y += p.vy * dt60;
      p.vx *= Math.pow(0.985, dt60);
      p.vy = p.vy * Math.pow(0.985, dt60) - 0.014 * dt60;
      p.life -= p.decay * dt60;
      if (p.life <= 0 || p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) {
        this.particles.splice(i, 1);
        continue;
      }
      const sprite = this._dot(this._color(p.c));
      const r = p.r * 5;
      ctx.globalAlpha = Math.max(0, 0.66 * p.life);
      ctx.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;

    /* inter-particle lines via spatial grid */
    if (this.quality !== 'low') {
      const lineAlpha = 0.1 + this.sm.level * 0.22;
      if (lineAlpha > 0.12) {
        ctx.lineWidth = 0.7;
        const pts = this.particles;
        const cell = 85;
        const cols = Math.ceil(w / cell);
        const grid = new Map();
        for (let i = 0; i < pts.length; i++) {
          const k = ((pts[i].x / cell) | 0) + ((pts[i].y / cell) | 0) * cols;
          let bucket = grid.get(k);
          if (!bucket) grid.set(k, (bucket = []));
          bucket.push(i);
        }
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i];
          const cx0 = (a.x / cell) | 0, cy0 = (a.y / cell) | 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const bucket = grid.get((cx0 + dx) + (cy0 + dy) * cols);
              if (!bucket) continue;
              for (const j of bucket) {
                if (j <= i) continue;
                const b = pts[j];
                const ddx = a.x - b.x;
                if (ddx > 85 || ddx < -85) continue;
                const ddy = a.y - b.y;
                if (ddy > 85 || ddy < -85) continue;
                const d2 = ddx * ddx + ddy * ddy;
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
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  /* ---------------- CRYSTAL MIRROR KALEIDOSCOPE ---------------- */

  _kaleido(freq, dt) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h / 2;
    const minDim = Math.min(w, h);
    const slices = this.quality === 'low' ? 6 : 10;
    const span = (Math.PI * 2) / slices;
    const rot = this.t * (0.12 + this.sm.level * 1.1) + this.beat * 0.4;
    const burst = 1 + this.beat * 0.30;
    const inner = minDim * 0.07 + this.sm.bass * minDim * 0.09;
    const maxR = minDim * 0.4 * (0.75 + this.sensitivity * 0.35) * burst;
    const P = this.quality === 'low' ? 28 : 56;
    void dt;

    ctx.globalCompositeOperation = 'lighter';
    const bloomR = minDim * 0.09 * (1 + this.sm.bass * 1.2 + this.beat * 0.6);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(this._dot(this._color(0)), cx - bloomR, cy - bloomR, bloomR * 2, bloomR * 2);
    ctx.globalAlpha = 1;

    for (let s = 0; s < slices; s++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(s * span + rot);
      const c = this._color(s);

      const pts = [];
      for (let i = 0; i <= P; i++) {
        const v = logSample(freq, i / P);
        const ang = (i / P) * span * 0.94;
        const r = inner + v * maxR * this.sensitivity * 0.85 + this.beat * minDim * 0.02;
        pts.push([Math.cos(ang) * r, Math.sin(ang) * r]);
      }

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(pts[0][0], pts[0][1]);
      for (const [px, py] of pts) ctx.lineTo(px, py);
      ctx.closePath();
      const fg = ctx.createRadialGradient(0, 0, inner, 0, 0, inner + maxR);
      fg.addColorStop(0, hexRgba(c, 0.04));
      fg.addColorStop(1, hexRgba(c, 0.18));
      ctx.fillStyle = fg;
      ctx.fill();

      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
        else ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.strokeStyle = hexRgba(c, 0.85);
      ctx.lineWidth = 1.6;
      ctx.stroke();

      if (this.sm.bass > 0.5) {
        ctx.strokeStyle = hexRgba(this._color(2), 0.4 + this.sm.bass * 0.3);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(pts[Math.floor(P / 2)][0], pts[Math.floor(P / 2)][1]);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- MATRIX WATERFALL SPECTROGRAM ---------------- */

  _buildSpectroLut() {
    const stops = [[5, 7, 13]];
    for (const c of this.theme.colors) {
      const n = parseInt(c.slice(1), 16);
      stops.push([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
    }
    const last = stops[stops.length - 1];
    stops.push([
      Math.min(255, last[0] + 150),
      Math.min(255, last[1] + 150),
      Math.min(255, last[2] + 150),
    ]);
    const lut = this.specLut = new Uint8Array(256 * 3);
    const segs = stops.length - 1;
    for (let i = 0; i < 256; i++) {
      const f = (i / 255) * segs;
      const s = Math.min(segs - 1, Math.floor(f));
      const u = f - s;
      const a = stops[s];
      const b = stops[s + 1];
      lut[i * 3] = a[0] + (b[0] - a[0]) * u;
      lut[i * 3 + 1] = a[1] + (b[1] - a[1]) * u;
      lut[i * 3 + 2] = a[2] + (b[2] - a[2]) * u;
    }
  }

  _spectro(freq, dt) {
    const { ctx, w, h } = this;
    const sig = `${w}x${h}|${this.theme.colors.join(',')}|${this.quality}`;
    if (!this.specCv || this.specSig !== sig) {
      this.specSig = sig;
      this.specCv = document.createElement('canvas');
      this.specCv.width = Math.max(2, Math.round(w));
      this.specCv.height = Math.max(2, Math.round(h));
      this.specCtx = this.specCv.getContext('2d');
      this._specAcc = 0;
      this._buildSpectroLut();
    }

    const colW = this.quality === 'low' ? 3 : 2;
    const W = this.specCv.width;
    const H = this.specCv.height;
    const COLINT = 0.032;
    this._specAcc = Math.min(this._specAcc + dt, COLINT * 6);
    while (this._specAcc >= COLINT) {
      this._specAcc -= COLINT;
      this.specCtx.drawImage(this.specCv, -colW, 0);
      const img = this.specCtx.createImageData(colW, H);
      const d = img.data;
      for (let y = 0; y < H; y++) {
        const t = 1 - y / H;
        const bin = Math.min(
          freq.length - 1,
          2 + Math.floor(Math.pow(t, 1.7) * freq.length * 0.72),
        );
        let v = (freq[bin] / 255) * this.sensitivity;
        v = v > 1 ? 1 : v < 0.04 ? 0 : v;
        const o = ((v * 255) | 0) * 3;
        const lut = this.specLut;
        for (let x = 0; x < colW; x++) {
          const p = (y * colW + x) * 4;
          d[p] = lut[o];
          d[p + 1] = lut[o + 1];
          d[p + 2] = lut[o + 2];
          d[p + 3] = 235;
        }
      }
      this.specCtx.putImageData(img, W - colW, 0);
    }

    ctx.drawImage(this.specCv, 0, 0, w, h);

    /* scanline sweep */
    const scanX = w - ((this.t * 140) % (w + 80));
    ctx.globalCompositeOperation = 'lighter';
    const beam = ctx.createLinearGradient(scanX - 30, 0, scanX, 0);
    beam.addColorStop(0, 'rgba(0,0,0,0)');
    beam.addColorStop(1, hexRgba(this._color(0), 0.22));
    ctx.fillStyle = beam;
    ctx.fillRect(scanX - 30, 0, 30, h);
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = hexRgba(this._color(0), 0.5);
    ctx.fillRect(w - colW - 1, 0, 1, h);
  }

  /* ---------------- HYPERSPACE TUNNEL ---------------- */

  _tunnel(freq) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h / 2;
    const minDim = Math.min(w, h);
    const rings = this.quality === 'low' ? 16 : 26;
    const maxR = minDim * 0.46;

    while (this.history.length < rings) this.history.push(0);

    ctx.globalCompositeOperation = 'lighter';

    const glowR = maxR * 0.16 * (1 + this.sm.bass * 1.3 + this.beat * 0.4);
    ctx.globalAlpha = 0.95;
    ctx.drawImage(this._dot(this._color(0)), cx - glowR, cy - glowR, glowR * 2, glowR * 2);
    ctx.globalAlpha = 1;

    const SEG = this.quality === 'low' ? 28 : 44;
    for (let i = 0; i < rings; i++) {
      const baseR = maxR * Math.pow((i + 1) / rings, 1.15);
      const pulse = this.history[this.history.length - 1 - i] * maxR * 0.3 * this.sensitivity;
      const alpha = 0.8 - (i / rings) * 0.62;
      const c = this._color(Math.floor(i / 2.5) + Math.floor(this.t * 0.06));
      ctx.strokeStyle = hexRgba(c, alpha);
      const tilt = Math.sin(i * 0.9 + this.t * 0.9) * 0.05;
      ctx.lineWidth = Math.max(0.6, 2.4 - (i / rings) * 1.6);
      ctx.beginPath();
      for (let s = 0; s <= SEG; s++) {
        const ang = (s / SEG) * Math.PI * 2;
        let wob = 0;
        if (freq) wob = (logSample(freq, (s / SEG + i * 0.11) % 1) - 0.5) * baseR * 0.1 * (0.4 + this.sm.level) * this.sensitivity;
        const r = baseR + pulse + wob;
        const x = cx + Math.cos(ang) * r * (1 + tilt);
        const y = cy + Math.sin(ang) * r * (1 - tilt);
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    /* vortex rays */
    const rays = 9;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < rays; i++) {
      const ang = this.t * (0.25 + i * 0.02) + (i / rays) * Math.PI * 2;
      const r0 = maxR * 0.2, r1 = maxR * 0.85;
      ctx.strokeStyle = hexRgba(this._color(i % this.theme.colors.length), 0.06 + this.sm.level * 0.08);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- AURORA PLASMA ---------------- */

  _plasma(freq, dt) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h / 2;
    const minDim = Math.min(w, h);
    const rings = this.quality === 'low' ? 2 : 3;
    const P = this.quality === 'low' ? 44 : 80;
    void dt;

    ctx.globalCompositeOperation = 'lighter';
    for (let r = 0; r < rings; r++) {
      const baseR = minDim * (0.1 + r * 0.15);
      const spin = this.t * (0.14 + r * 0.08) * (1 + this.sm.level * 1.6) * (r % 2 ? -1 : 1);
      const sprite = this._dot(this._color(r));
      const trail = [];
      for (let i = 0; i < P; i++) {
        const ang = (i / P) * Math.PI * 2 + spin;
        const v = logSample(freq, ((i * 7 + Math.floor(this.t * 3) * 3) % P) / P);
        const mod =
          Math.sin(ang * (2 + r * 2) - this.t * 1.4) * this.sm.mid * 0.4 +
          Math.cos(ang * 3 + this.t * 1.1) * this.sm.high * 0.5;
        const rad = baseR * (1 + v * 0.5 * this.sensitivity + mod) + this.beat * baseR * 0.06;
        const x = cx + Math.cos(ang) * rad;
        const y = cy + Math.sin(ang) * rad;
        const s = 7 + v * 6;
        ctx.globalAlpha = clamp(0.2 + v * 0.6, 0.05, 0.85);
        ctx.drawImage(sprite, x - s, y - s, s * 2, s * 2);
        trail.push([x, y]);
      }
      if (trail.length > 4) {
        ctx.beginPath();
        ctx.moveTo(trail[0][0], trail[0][1]);
        for (let i = 1; i < trail.length; i += 2) ctx.lineTo(trail[i][0], trail[i][1]);
        ctx.strokeStyle = hexRgba(this._color(r), 0.12 + this.sm.level * 0.12);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    /* beat star-cross + center halo */
    if (this.beat > 0.25) {
      const br = minDim * 0.5 * this.beat;
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = hexRgba(this._color(0), this.beat * 0.5);
      ctx.beginPath();
      ctx.moveTo(cx - br, cy); ctx.lineTo(cx + br, cy);
      ctx.moveTo(cx, cy - br); ctx.lineTo(cx, cy + br);
      ctx.moveTo(cx - br * 0.62, cy - br * 0.62); ctx.lineTo(cx + br * 0.62, cy + br * 0.62);
      ctx.moveTo(cx + br * 0.62, cy - br * 0.62); ctx.lineTo(cx - br * 0.62, cy + br * 0.62);
      ctx.stroke();
    }
    const haloR = minDim * 0.05 * (1 + this.sm.bass * 1.4 + this.beat * 0.8);
    ctx.globalAlpha = 0.8;
    ctx.drawImage(this._dot(this._color(0)), cx - haloR, cy - haloR, haloR * 2, haloR * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  /* ---------------- SUNSET TERRAIN ---------------- */

  _terrain(freq, dt) {
    const { ctx, w, h } = this;
    const horizon = h * 0.42;
    const COLS = this.quality === 'low' ? 36 : 60;
    const ROWS = this.quality === 'low' ? 16 : 26;
    const depth = h - horizon;

    this._terrainAcc += dt;
    const SAMPLE = 0.055;
    while (this._terrainAcc >= SAMPLE) {
      this._terrainAcc -= SAMPLE;
      const row = new Float32Array(COLS);
      for (let i = 0; i < COLS; i++) {
        row[i] = clamp(logSample(freq, i / COLS) * this.sensitivity, 0, 1.2);
      }
      this.terrainRows.unshift(row);
      if (this.terrainRows.length > ROWS) this.terrainRows.pop();
    }
    while (this.terrainRows.length < ROWS) this.terrainRows.push(new Float32Array(COLS));

    const starSig = `${w}x${h}|terrain`;
    if (this._starSig !== starSig || !this.stars.length) {
      this._starSig = starSig;
      this.stars = Array.from({ length: 60 }, () => ({
        x: Math.random() * w,
        y: Math.random() * horizon * 0.85,
        r: 0.5 + Math.random() * 1.2,
        ph: Math.random() * Math.PI * 2,
      }));
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ffffff';
    for (const s of this.stars) {
      ctx.globalAlpha = 0.10 + 0.30 * (0.5 + 0.5 * Math.sin(this.t * 0.9 + s.ph));
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    for (let i = 0; i < 2; i++) {
      const ax = w * (0.25 + i * 0.35) + Math.sin(this.t * 0.14 + i * 2.2) * w * 0.14;
      const ah = depth * (0.24 + i * 0.1);
      const aur = ctx.createLinearGradient(0, horizon - ah, 0, horizon);
      aur.addColorStop(0, 'rgba(0,0,0,0)');
      aur.addColorStop(1, hexRgba(this._color(1 + i), 0.10 + this.sm.level * 0.06 + this.beat * 0.04));
      ctx.fillStyle = aur;
      ctx.fillRect(ax, horizon - ah, w * 0.34, ah);
    }

    if (this.beat > 0.7) {
      if (!this._meteor) this._meteor = { x: w * 0.12, y: horizon * 0.18 };
      const m = this._meteor;
      m.x += 9; m.y += 2.2;
      const tailR = 30;
      const streak = ctx.createLinearGradient(m.x - tailR, m.y - tailR * 0.2, m.x, m.y);
      streak.addColorStop(0, hexRgba(this._color(1), 0));
      streak.addColorStop(1, hexRgba(this._color(1), 0.9));
      ctx.strokeStyle = streak;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(m.x - tailR, m.y - tailR * 0.2);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
    } else {
      this._meteor = null;
    }

    const sunR = Math.min(w, h) * (0.11 + this.sm.bass * 0.03 + this.beat * 0.012);
    const sunY = horizon - Math.min(w, h) * 0.16;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this._dot(this._color(1)), w / 2 - sunR, sunY - sunR, sunR * 2, sunR * 2);
    ctx.globalAlpha = 1;
    const sky = ctx.createLinearGradient(0, horizon - depth * 0.4, 0, horizon);
    sky.addColorStop(0, hexRgba(this._color(0), 0));
    sky.addColorStop(1, hexRgba(this._color(0), 0.08 + this.beat * 0.08));
    ctx.fillStyle = sky;
    ctx.fillRect(0, horizon - depth * 0.4, w, depth * 0.4);

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
      const u = (r + 1) / ROWS;
      const persp = 1 - u * u;
      const y = depth * u * u;
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
      ctx.strokeStyle = hexRgba(c, 0.7 * persp);
      ctx.stroke();

      if (r > 0) {
        const uPrev = r / ROWS;
        const yPrev = depth * uPrev * uPrev;
        ctx.lineTo(((COLS - 1) / COLS - 0.5) * w * (0.22 + 1.9 * Math.pow(1 - uPrev, 2)), yPrev + 2);
        ctx.lineTo((-0.5) * w * (0.22 + 1.9 * Math.pow(1 - uPrev, 2)), yPrev + 2);
        ctx.closePath();
        ctx.fillStyle = hexRgba(c, 0.06 * persp);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- NEON CITY DUSK ---------------- */

  _city(freq, dt60) {
    const { ctx, w, h } = this;
    const baseline = h * 0.74;
    const maxH = h * 0.5;
    const N = Math.max(14, Math.min(this.quality === 'low' ? 26 : 42, Math.floor(w / 24)));
    const bw = w / N;
    const colors = this.theme.colors;

    const starSig = `${w}x${h}|city`;
    if (this._starSig !== starSig || !this.stars.length) {
      this._starSig = starSig;
      this.stars = Array.from({ length: 80 }, () => ({
        x: Math.random() * w,
        y: Math.random() * baseline * 0.9,
        r: 0.6 + Math.random() * 1.2,
        ph: Math.random() * Math.PI * 2,
      }));
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ffffff';
    for (const s of this.stars) {
      ctx.globalAlpha = 0.05 + 0.22 * (0.5 + 0.5 * Math.sin(this.t * 0.8 + s.ph));
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    /* aurora ribbons */
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 2;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 20) {
        const y = baseline * (0.22 + i * 0.12) + Math.sin(x * 0.006 + this.t * 0.3 + i * 2) * h * 0.03;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = hexRgba(this._color(1 + i), 0.12 + this.sm.level * 0.08 + this.beat * 0.05);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    if (this.cityCols.length !== N) {
      this.cityCols = Array.from({ length: N }, (_, i) => ({
        v: 0,
        peak: 0,
        seed: ((i + 1) * 2654435761) % 997,
      }));
    }

    const fall = 1 - Math.pow(0.88, dt60);
    const fallPeak = Math.pow(0.985, dt60);
    for (let i = 0; i < N; i++) {
      const s0 = logSample(freq, i / N);
      const s1 = logSample(freq, Math.min(1, (i + 0.7) / N));
      const raw = ((s0 + s1) / 2) * this.sensitivity;
      const weight = 1 + this.bassFocus * 1.4 * (1 - i / N);
      const target = Math.min(1, raw * weight);
      const c = this.cityCols[i];
      c.v += (target - c.v) * (target > c.v ? Math.min(1, dt60 * 0.55) : fall);
      c.peak = Math.max(c.peak * fallPeak, c.v);
    }

    /* back-layer silhouettes */
    ctx.fillStyle = 'rgba(8, 11, 20, 0.85)';
    for (let i = 0; i < N; i += 2) {
      const src = this.cityCols[(i * 7 + 3) % N];
      const bh = maxH * 0.16 + src.v * maxH * 0.5;
      const x = i * bw - bw * 0.35;
      ctx.fillRect(x, baseline - bh, bw * 0.62, bh);
    }

    /* ground glow */
    const gGrad = ctx.createLinearGradient(0, baseline, 0, h);
    gGrad.addColorStop(0, hexRgba(this._color(0), 0.14));
    gGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gGrad;
    ctx.fillRect(0, baseline, w, h - baseline);

    /* buildings */
    const tall = [];
    for (let i = 0; i < N; i++) {
      const col = this.cityCols[i];
      const bh = Math.max(8, (0.06 + col.v * 0.64) * maxH);
      const bodyW = bw * 0.68;
      const x = i * bw + (bw - bodyW) / 2;
      const y = baseline - bh;
      const c = colors[i % colors.length];

      ctx.fillStyle = '#070a12';
      ctx.fillRect(x, y, bodyW, bh);

      ctx.globalAlpha = 0.1;
      ctx.fillStyle = c;
      ctx.fillRect(x, baseline + 2, bodyW, Math.min(bh * 0.4, maxH * 0.3));
      ctx.globalAlpha = 1;

      ctx.fillStyle = hexRgba(c, 0.9);
      ctx.fillRect(x, y, bodyW, 2);
      if (col.peak > 0.04) {
        const py = baseline - col.peak * maxH - 4;
        ctx.globalAlpha = 0.45;
        ctx.fillRect(x, py, bodyW, 1.5);
        ctx.globalAlpha = 1;
      }

      const wxMax = Math.max(1, Math.floor((bodyW - 5) / 5));
      const rows = Math.min(14, Math.floor((bh - 10) / 10));
      for (let wy = 0; wy < rows; wy++) {
        for (let wx = 0; wx < wxMax; wx++) {
          const hsh =
            (((Math.sin(col.seed + wx * 37 + wy * 101) + 1) / 2) * 43758.5453) % 1;
          if (hsh < 0.42) continue;
          const flick = 0.55 + 0.45 * Math.sin(this.t * (0.8 + hsh * 2.2) + col.seed + wx);
          const a = (0.14 + 0.6 * col.v) * (0.3 + 0.7 * hsh) * flick;
          if (a < 0.06) continue;
          ctx.fillStyle = hexRgba(c, a);
          ctx.fillRect(x + 3 + wx * 5, y + 7 + wy * 10, 2.5, 3.5);
        }
      }

      tall.push({ x: x + bodyW / 2, y: y });
    }

    /* beacon shafts */
    tall.sort((a, b) => b.y - a.y);
    const beaconC = this._color(0);
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < Math.min(3, tall.length); k++) {
      const tb = tall[k];
      const pulse = Math.max(0, Math.sin(this.t * 2.4 + k * 2.1)) ** 2;
      const r = 2.5 + this.beat * 2;
      const sh = ctx.createLinearGradient(0, tb.y, 0, h);
      sh.addColorStop(0, hexRgba(beaconC, 0.05 + pulse * 0.10));
      sh.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sh;
      ctx.fillRect(tb.x - 1.2, tb.y, 2.4, h - tb.y);
      ctx.globalAlpha = 0.25 + 0.75 * pulse;
      ctx.drawImage(this._dot(beaconC), tb.x - r, tb.y - r - 3, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  /* ---------------- NEBULA DEEP FIELD ---------------- */

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
    /* stardust */
    for (let i = 0; i < 22; i++) {
      const fx = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
      const fy = ((Math.sin(i * 78.233) * 12543.123) % 1 + 1) % 1;
      const px = fx * w + Math.sin(this.t * 0.18 + i * 1.7) * 18;
      const py = fy * h + Math.cos(this.t * 0.14 + i * 2.3) * 14;
      const a = 0.16 + 0.26 * (0.5 + 0.5 * Math.sin(this.t * 1.1 + i * 1.1));
      const rr = 1.2 + ((i * 7919) % 7) * 0.22;
      ctx.globalAlpha = a;
      ctx.drawImage(this._dot(this._color(i % this.theme.colors.length)), px - rr, py - rr, rr * 2, rr * 2);
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

    /* dust motes */
    for (let i = 0; i < 16; i++) {
      const ang = this.t * (0.05 + i * 0.007) * (i % 2 ? 1 : -1) + i * 1.7;
      const r = inner + ((i * 37) % 96) / 96 * (outer * 0.82);
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r * 0.6;
      const rr = 1 + (i % 3) * 0.7;
      ctx.globalAlpha = 0.14 + 0.2 * (0.5 + 0.5 * Math.sin(this.t * 1.3 + i));
      ctx.drawImage(this._dot(this._color((i + 1) % this.theme.colors.length)), x - rr, y - rr, rr * 2, rr * 2);
    }
    ctx.globalAlpha = 1;

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

      ctx.beginPath();
      for (let i = 0; i <= PTS; i++) {
        const p = pt(i);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = hexRgba(c, 0.3 + this.sm.level * 0.25);
      ctx.lineWidth = Math.max(1.2, minDim * 0.007 * (1 + this.sm.bass));
      ctx.stroke();

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

  /* ---------------- PULSE ORB ---------------- */

  _orb(freq, dt60, dt) {
    const { ctx, w, h } = this;
    const cx = w / 2;
    const cy = h / 2;
    const minDim = Math.min(w, h);
    const baseR = minDim * 0.18 * (0.85 + this.sm.level * 0.6);

    if (this.beat > 0.72 && this.orbSat.length < 40 && Math.random() < 0.55) {
      const ang = Math.random() * Math.PI * 2;
      this.orbSat.push({
        ang,
        dist: baseR * (1.45 + Math.random() * 0.7),
        spd: (0.5 + Math.random() * 1.0) * (Math.random() < 0.5 ? 1 : -1),
        c: Math.floor(Math.random() * this.theme.colors.length),
        life: 1,
        decay: 0.006 + Math.random() * 0.011,
      });
    }
    for (let i = this.orbSat.length - 1; i >= 0; i--) {
      const s = this.orbSat[i];
      s.ang += s.spd * dt;
      s.dist += 0.4 * dt60;
      s.life -= s.decay * dt60;
      if (s.life <= 0 || s.dist > minDim * 0.48) this.orbSat.splice(i, 1);
    }

    ctx.globalCompositeOperation = 'lighter';
    /* beat shockwave rings */
    if (this.beat > 0.55) {
      if (!this._orbWaves) this._orbWaves = [];
      this._orbWaves.push({ r: baseR * 1.05, a: 0.5 });
    }
    if (this._orbWaves) {
      for (let i = this._orbWaves.length - 1; i >= 0; i--) {
        const wv = this._orbWaves[i];
        wv.r += minDim * 0.012 * dt60;
        wv.a *= 0.94;
        if (wv.a < 0.02 || wv.r > minDim * 0.46) { this._orbWaves.splice(i, 1); continue; }
        ctx.strokeStyle = hexRgba(this._color(0), wv.a);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, wv.r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    const P = this.quality === 'low' ? 48 : 64;
    const pts = [];
    for (let i = 0; i < P; i++) {
      const u = i / P;
      const ang = u * Math.PI * 2;
      const rip = freq ? logSample(freq, u) : 0;
      const harm1 = Math.sin(ang * 3 + this.t * 1.4) * this.sm.mid * 0.10;
      const harm2 = Math.cos(ang * 5 - this.t * 2.2) * this.sm.high * 0.08;
      const r = baseR * (1 + rip * 0.42 * this.sensitivity + harm1 + harm2 + this.beat * 0.08);
      pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
    }

    const glowR = baseR * 1.55;
    const g = ctx.createRadialGradient(cx, cy, baseR * 0.3, cx, cy, glowR);
    g.addColorStop(0, hexRgba(this._color(0), 0.18 + this.beat * 0.12));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i][0] + pts[(i + 1) % pts.length][0]) / 2;
      const my = (pts[i][1] + pts[(i + 1) % pts.length][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    ctx.closePath();
    const fg = ctx.createRadialGradient(cx, cy, baseR * 0.2, cx, cy, baseR * 1.2);
    fg.addColorStop(0, hexRgba(this._color(1), 0.26));
    fg.addColorStop(1, hexRgba(this._color(0), 0.06));
    ctx.fillStyle = fg;
    ctx.fill();
    ctx.strokeStyle = this._color(0);
    ctx.lineWidth = 1.8;
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = hexRgba(this._color(2), 0.14 + this.sm.level * 0.12);
    ctx.lineWidth = 1;
    for (let r = 0; r < 2; r++) {
      const rr = baseR * (1.35 + r * 0.22);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rr, rr * 0.52, this.t * (0.12 + r * 0.07) * (r % 2 ? -1 : 1), 0, Math.PI * 2);
      ctx.stroke();
    }

    const coreR = minDim * 0.04 * (1 + this.beat * 1.4 + this.sm.bass * 0.5);
    ctx.globalAlpha = 0.95;
    ctx.drawImage(this._dot(this._color(1)), cx - coreR, cy - coreR, coreR * 2, coreR * 2);
    ctx.globalAlpha = 1;

    for (const s of this.orbSat) {
      const x = cx + Math.cos(s.ang) * s.dist;
      const y = cy + Math.sin(s.ang) * s.dist * 0.58;
      const col = this._color(s.c);
      const sr = 2.8 + s.life * 3.2;
      ctx.globalAlpha = clamp(s.life * 0.78, 0, 0.85);
      ctx.drawImage(this._dot(col), x - sr, y - sr, sr * 2, sr * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- LIQUID METAL FLUID ---------------- */

  _fluid(freq) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h / 2;
    const n = this.quality === 'low' ? 5 : 9;
    ctx.globalCompositeOperation = 'lighter';
    /* beat ripples */
    if (this.beat > 0.55) {
      const rr = Math.min(w, h) * (0.3 + this.beat * 0.2);
      ctx.strokeStyle = hexRgba(this._color(0), this.beat * 0.4);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = hexRgba(this._color(1), this.beat * 0.22);
      ctx.beginPath();
      ctx.arc(cx, cy, rr * 0.72, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + this.t * (0.18 + i * 0.02);
      const rad = Math.min(w, h) * 0.22 * (0.7 + this.sm.bass * 0.6 + this.beat * 0.25);
      const x = cx + Math.cos(ang) * rad * 0.7;
      const y = cy + Math.sin(ang) * rad * 0.5;
      const v = freq ? logSample(freq, i / n) : 0.5;
      const r = rad * 0.55 * (0.6 + v * 0.9);
      const c = this._color(i + Math.floor(this.t * 0.7));
      ctx.globalAlpha = 0.42 + v * 0.35;
      ctx.drawImage(this._dot(c), x - r, y - r, r * 2, r * 2);
    }
    const cr = Math.min(w, h) * 0.08 * (1 + this.sm.level * 0.6);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(this._dot(this._color(0)), cx - cr, cy - cr, cr * 2, cr * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- TENSOR GRID ---------------- */

  _tensor(freq) {
    const { ctx, w, h } = this;
    const cols = this.quality === 'low' ? 12 : 20;
    const rows = this.quality === 'low' ? 8 : 14;
    const cw = w / cols;
    const rh = h / rows;
    ctx.strokeStyle = hexRgba(this._color(0), 0.18);
    ctx.lineWidth = 1;
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath();
      for (let x = 0; x <= cols; x++) {
        const u = x / cols;
        const v = freq ? logSample(freq, u) : 0;
        const off = Math.sin(u * 6 + this.t * 1.4) * v * 22 * this.sensitivity;
        const px = x * cw;
        const py = y * rh + off * (1 - Math.abs(y - rows / 2) / (rows / 2));
        if (x === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    for (let x = 0; x <= cols; x++) {
      ctx.beginPath();
      for (let y = 0; y <= rows; y++) {
        const v = freq ? logSample(freq, y / rows) : 0;
        const off = Math.cos(y * 4 + this.t * 1.1) * v * 14;
        const px = x * cw + off * (1 - Math.abs(x - cols / 2) / (cols / 2));
        const py = y * rh;
        if (y === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    /* beat-lit nodes */
    if (this.beat > 0.35) {
      ctx.globalCompositeOperation = 'lighter';
      const nodeR = 2.6 + this.beat * 2.2;
      for (let gy = 1; gy < rows; gy += 3) {
        for (let gx = 1; gx < cols; gx += 3) {
          const u = gx / cols;
          const v = freq ? logSample(freq, u) : 0;
          const off = Math.sin(u * 6 + this.t * 1.4) * v * 22;
          const nx = gx * cw;
          const ny = gy * rh + off * (1 - Math.abs(gy - rows / 2) / (rows / 2));
          ctx.globalAlpha = clamp(v * this.beat * 0.9, 0, 0.7);
          ctx.drawImage(this._dot(this._color((gx + gy) % this.theme.colors.length)), nx - nodeR, ny - nodeR, nodeR * 2, nodeR * 2);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /* ---------------- PRISM RAY ---------------- */

  _prism(freq) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h * 0.58;
    const sz = Math.min(w, h) * 0.22;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexRgba(this._color(1), 0.9);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx, cy - sz);
    ctx.lineTo(cx - sz * 0.86, cy + sz * 0.5);
    ctx.lineTo(cx + sz * 0.86, cy + sz * 0.5);
    ctx.closePath();
    ctx.stroke();
    const beams = this.quality === 'low' ? 5 : 9;
    for (let i = 0; i < beams; i++) {
      const u = i / beams;
      const v = freq ? logSample(freq, u) : 0.5;
      const ang = -0.9 + u * 1.8 + this.beat * 0.15;
      const len = w * 0.7 * (0.5 + v * 0.7);
      const x1 = cx + Math.cos(Math.PI / 2 + ang) * sz * 0.6;
      const y1 = cy + Math.sin(Math.PI / 2 + ang) * sz * 0.6;
      const x2 = x1 + Math.cos(ang) * len;
      const y2 = y1 + Math.sin(ang) * len * 0.18;
      ctx.strokeStyle = hexRgba(this._color(i), 0.42 + v * 0.4);
      ctx.lineWidth = 1.2 + v * 2.2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    /* glitter on beat */
    if (this.beat > 0.5) {
      ctx.fillStyle = hexRgba(this._color(2), this.beat * 0.7);
      for (let i = 0; i < 8; i++) {
        const gx = cx + (Math.sin(i * 91.7 + this.t * 3) * sz * 0.9);
        const gy = cy + sz * 0.5 + this.beat * 7 + ((i % 3) * 6);
        ctx.fillRect(gx, gy, 2, 2);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- BLACK HOLE VOID ---------------- */

  _void(freq) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h / 2;
    const base = Math.min(w, h) * 0.11 * (1 + this.sm.bass * 0.3);
    ctx.globalCompositeOperation = 'lighter';
    const rings = this.quality === 'low' ? 22 : 36;
    for (let i = 0; i < rings; i++) {
      const t = i / rings;
      const r = base * 1.7 + Math.pow(t, 1.2) * Math.min(w, h) * 0.38;
      const v = freq ? logSample(freq, t) : 0.5;
      const wob = Math.sin(t * 18 + this.t * 2.2) * v * 6;
      ctx.strokeStyle = hexRgba(this._color(Math.floor(t * 4)), 0.18 + v * 0.32);
      ctx.lineWidth = 1.1 + v * 1.4;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r + wob, r * 0.38 + wob * 0.18, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    const g = ctx.createRadialGradient(cx, cy, base * 0.7, cx, cy, base);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.72, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, base, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexRgba(this._color(0), 0.85 + this.beat * 0.2);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(cx, cy, base * 1.02, 0, Math.PI * 2);
    ctx.stroke();
  }

  /* ---------------- BLOOM FIELD MESH ---------------- */

  _bloomField(freq) {
    const { ctx, w, h } = this;
    const cols = this.quality === 'low' ? 10 : 16;
    const rows = this.quality === 'low' ? 6 : 9;
    const cw = w / cols;
    const rh = h / rows;

    /* mesh lines between neighbor blooms */
    if (this.quality !== 'low') {
      ctx.globalCompositeOperation = 'lighter';
      const meshA = 0.04 + this.sm.level * 0.06;
      const dotAt = (x, y) => {
        const idx = (y * cols + x) % 64;
        return freq ? logSample(freq, idx / 64) : 0.5;
      };
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const a1 = dotAt(x, y);
          const cx1 = x * cw + cw / 2;
          const cy1 = y * rh + rh / 2;
          if (x < cols - 1) {
            const a2 = dotAt(x + 1, y);
            ctx.strokeStyle = hexRgba(this._color(x % this.theme.colors.length), meshA * (a1 + a2));
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx1, cy1);
            ctx.lineTo((x + 1) * cw + cw / 2, cy1);
            ctx.stroke();
          }
          if (y < rows - 1) {
            const a2 = dotAt(x, y + 1);
            ctx.strokeStyle = hexRgba(this._color((x + 1) % this.theme.colors.length), meshA * (a1 + a2));
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx1, cy1);
            ctx.lineTo(cx1, (y + 1) * rh + rh / 2);
            ctx.stroke();
          }
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = (y * cols + x) % 64;
        const amp = freq ? logSample(freq, (idx / 64)) : 0.5;
        const cx = x * cw + cw / 2 + Math.sin(this.t * 0.6 + idx) * 4;
        const cy = y * rh + rh / 2 + Math.cos(this.t * 0.5 + idx * 1.3) * 4;
        const s = 10 + amp * 22 * this.sensitivity + this.beat * 6;
        const c = this._color((x + y) % this.theme.colors.length);
        ctx.globalAlpha = 0.22 + amp * 0.55;
        ctx.drawImage(this._dot(c), cx - s, cy - s, s * 2, s * 2);
      }
    }
    ctx.globalAlpha = 1;
  }
}
