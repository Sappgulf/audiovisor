import { logFreqIndex, logSample, hexRgba, clamp } from './utils.js';

/**
 * The eighteen heavier visualizer modes, split out of visualizers.js so the
 * entry bundle only carries the four modes the app can actually open on a
 * cold start. They are written as a class body purely so the method syntax
 * matches the file they came from; installExtraModes() copies them onto the
 * real Renderer prototype, so `this` is an ordinary Renderer throughout.
 */
class ExtraModes {
  /* ---------------- CRYSTAL KALEIDOSCOPE ---------------- */

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
    const bloomR = minDim * Math.min(0.26, 0.06 + this.sm.bass * 0.06 + this.beat * 0.03);
    ctx.globalAlpha = 0.42;
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
      fg.addColorStop(0, hexRgba(c, 0.02));
      fg.addColorStop(1, hexRgba(c, 0.13));
      ctx.fillStyle = fg;
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
        else ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.strokeStyle = hexRgba(c, 0.7);
      ctx.lineWidth = 1.4;
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

  /* ---------------- SPECTROGRAM WATERFALL ---------------- */

  _buildSpectroLut() {
    /* contrast-ramped LUT: deep black floor, one bright ramp packet per
       theme color, white-hot only at peaks. Steep gamma + step mapping
       keep quiet audio black, so dynamics read as color silhouette. */
    const stops = [[3, 3, 4]];
    for (const c of this.theme.colors) {
      const n = parseInt(c.slice(1), 16);
      stops.push([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
    }
    /* lighten each theme stop slightly as energy climbs */
    const boosted = [];
    for (let i = 1; i < stops.length; i++) {
      const s = stops[i];
      boosted.push([
        Math.min(255, s[0] + 40 + i * 10),
        Math.min(255, s[1] + 40 + i * 10),
        Math.min(255, s[2] + 40 + i * 10),
      ]);
    }
    stops.push(...boosted);
    /* Top of the ramp keeps the theme's hue rather than going achromatic —
       a pure-white cap threw away the colour exactly where the signal is
       most interesting. True white is left to the very last entries via the
       gamma curve, so peaks still read as hot. */
    const top = stops[stops.length - 1];
    stops.push([
      Math.min(255, Math.round(top[0] * 0.35 + 255 * 0.65)),
      Math.min(255, Math.round(top[1] * 0.35 + 252 * 0.65)),
      Math.min(255, Math.round(top[2] * 0.35 + 242 * 0.65)),
    ]);
    const lut = this.specLut = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      /* steep gamma: low+mid values stay near-black, only peaks climb */
      const v = Math.pow(i / 255, 2.8);
      const f = v * (stops.length - 1);
      const s = Math.min(stops.length - 2, Math.floor(f));
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
      this.specCtx.imageSmoothingEnabled = false;
      this.specCtx.fillStyle = '#0b0a09';
      this.specCtx.fillRect(0, 0, this.specCv.width, this.specCv.height);
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
        const bin = Math.min(freq.length - 1, 2 + Math.floor(Math.pow(t, 1.7) * freq.length * 0.72));
        /* Soft shoulder instead of a hard clamp. Sensitivity defaults to
           1.4, so `min(1, raw * sens)` sent everything above 71% of full
           scale to the same top LUT entry — on busy material that flattened
           a fifth of the waterfall to a single flat white, which is why
           this mode read as blown out and colourless. This compresses
           toward 1 without reaching it, so hot bins keep climbing through
           the colour ramp and stay distinguishable. */
        const g = (freq[bin] / 255) * this.sensitivity;
        let v = g > 0 ? 1 - Math.exp(-g * 1.15) : 0;
        v = v < 0.04 ? 0 : v;
        const o = ((v * 255) | 0) * 3;
        const lut = this.specLut;
        for (let x = 0; x < colW; x++) {
          const p = (y * colW + x) * 4;
          d[p] = lut[o]; d[p + 1] = lut[o + 1]; d[p + 2] = lut[o + 2]; d[p + 3] = 255;
        }
      }
      this.specCtx.putImageData(img, W - colW, 0);
    }
    ctx.drawImage(this.specCv, 0, 0, w, h);
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
    const glowR = maxR * Math.min(0.28, 0.11 + this.sm.bass * 0.11 + this.beat * 0.06);
    ctx.globalAlpha = 0.55;
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
    const vig = ctx.createRadialGradient(cx, cy, maxR * 0.7, cx, cy, maxR * 1.25);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.32)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
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
        const mod = Math.sin(ang * (2 + r * 2) - this.t * 1.4) * this.sm.mid * 0.4 + Math.cos(ang * 3 + this.t * 1.1) * this.sm.high * 0.5;
        const rad = baseR * (1 + v * 0.5 * this.sensitivity + mod) + this.beat * baseR * 0.06;
        const x = cx + Math.cos(ang) * rad;
        const y = cy + Math.sin(ang) * rad;
        const s = 7 + v * 6;
        /* additive sprites that overlap along each arm; 0.85 each stacked
           past white wherever two arms crossed */
        ctx.globalAlpha = clamp(0.14 + v * 0.40, 0.04, 0.58);
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
  /* ---------------- SUNSET TERRAIN — stars + meteor ---------------- */

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
      for (let i = 0; i < COLS; i++) row[i] = clamp(logSample(freq, i / COLS) * this.sensitivity, 0, 1.2);
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
    } else this._meteor = null;
    const sunR = Math.min(w, h) * (0.075 + this.sm.bass * 0.02 + this.beat * 0.01);
    const sunY = horizon - Math.min(w, h) * 0.16;
    ctx.globalAlpha = 0.7;
    ctx.drawImage(this._dot(this._color(1)), w / 2 - sunR, sunY - sunR, sunR * 2, sunR * 2);
    ctx.globalAlpha = 1;
    const sky = ctx.createLinearGradient(0, horizon - depth * 0.45, 0, horizon);
    sky.addColorStop(0, hexRgba(this._color(0), this.beat * 0.08));
    sky.addColorStop(0.55, hexRgba(this._color(0), 0.05 + this.sm.level * 0.05));
    sky.addColorStop(1, hexRgba(this._color(0), 0.10 + this.sm.bass * 0.10 + this.beat * 0.10));
    ctx.fillStyle = sky;
    ctx.fillRect(0, horizon - depth * 0.45, w, depth * 0.45);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, horizon, w, depth);
    ctx.clip();
    ctx.translate(w / 2, horizon);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.1;
    const ampBase = depth * 0.42;
    /* parallax halo ridge behind the mesh — same displacement, dimmed,
       shifted slowly sideways so the range never looks frozen */
    {
      const drift = Math.sin(this.t * 0.11) * w * 0.035;
      ctx.beginPath();
      for (let i = 0; i <= COLS; i++) {
        const ci = Math.min(COLS - 1, i);
        const x = ((ci / COLS) - 0.5) * w * 1.3 + drift;
        const yy = depth * 0.06 - this.terrainRows[Math.min(this.terrainRows.length - 1, 2)]?.[ci] * ampBase * 0.5;
        if (i === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.strokeStyle = hexRgba(this._color(3), 0.035 + this.sm.level * 0.04);
      ctx.lineWidth = 3;
      ctx.stroke();
    }
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
      /* front rows get the beat light */
      const isFront = r < 3;
      ctx.strokeStyle = hexRgba(isFront ? this._color(0) : c,
        (isFront ? 0.55 + this.beat * 0.45 : 0.42 + persp * 0.5));
      ctx.lineWidth = isFront ? 1.6 : 1.1;
      ctx.stroke();
      if (isFront && this.beat > 0.4) {
        /* peak glints along the lit ridge */
        for (let i = 0; i < COLS; i += 3) {
          if (row[i] > 0.8) {
            const gx = ((i / COLS) - 0.5) * w * spread;
            const gy = y - row[i] * amp;
            const gr = 1.5 + row[i] * 2.2;
            ctx.globalAlpha = (this.beat - 0.4) * 0.9;
            ctx.drawImage(this._dot(this._color(1)), gx - gr, gy - gr, gr * 2, gr * 2);
          }
        }
        ctx.globalAlpha = 1;
      }
      if (r > 0) {
        const uPrev = r / ROWS;
        const yPrev = depth * uPrev * uPrev;
        ctx.lineTo(((COLS - 1) / COLS - 0.5) * w * (0.22 + 1.9 * Math.pow(1 - uPrev, 2)), yPrev + 2);
        ctx.lineTo((-0.5) * w * (0.22 + 1.9 * Math.pow(1 - uPrev, 2)), yPrev + 2);
        ctx.closePath();
        ctx.fillStyle = hexRgba(c, 0.03 + persp * 0.09);
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
    ctx.fillStyle = this._shadow(this._color(0), 0.07, 5);
    for (let i = 0; i < N; i += 2) {
      const src = this.cityCols[(i * 7 + 3) % N];
      const bh = maxH * 0.16 + src.v * maxH * 0.5;
      const x = i * bw - bw * 0.35;
      ctx.fillRect(x, baseline - bh, bw * 0.62, bh);
    }
    const gGrad = ctx.createLinearGradient(0, baseline, 0, h);
    gGrad.addColorStop(0, hexRgba(this._color(0), 0.14));
    gGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gGrad;
    ctx.fillRect(0, baseline, w, h - baseline);
    const tall = [];
    for (let i = 0; i < N; i++) {
      const col = this.cityCols[i];
      const bh = Math.max(8, (0.06 + col.v * 0.64) * maxH);
      const bodyW = bw * 0.68;
      const x = i * bw + (bw - bodyW) / 2;
      const y = baseline - bh;
      const c = colors[i % colors.length];
      ctx.fillStyle = this._shadow(this._color(0));
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
          const hsh = (((Math.sin(col.seed + wx * 37 + wy * 101) + 1) / 2) * 43758.5453) % 1;
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
    const cx = w / 2, cy = h / 2;
    const minDim = Math.min(w, h);
    const N = this.quality === 'low' ? 5 : 10;
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

    /* galactic disc — a stretched, tilted swirl of soft pools */
    const discTilt = -0.3 + Math.sin(this.t * 0.05) * 0.06;
    const coreGlow = minDim * (0.30 + this.sm.bass * 0.5 + this.beat * 0.10);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(discTilt);
    ctx.scale(1, 0.36);
    ctx.globalAlpha = clamp(0.10 + this.sm.level * 0.16, 0.04, 0.30);
    ctx.drawImage(this._soft(this._color(1)), -coreGlow, -coreGlow, coreGlow * 2, coreGlow * 2);
    ctx.restore();

    for (let i = 0; i < N; i++) {
      const b = this.nebula[i];
      const x = cx + Math.sin(this.t * b.fx * 2 + b.p1) * w * b.ax;
      const y = cy + Math.cos(this.t * b.fy * 2 + b.p2) * h * b.ay;
      const bandV = bands[b.band];
      const r = Math.min(minDim * 0.20, minDim * b.sz * (0.75 + bandV * 1.4 * this.sensitivity + this.beat * 0.18));
      const ci = Math.floor(this.t * 0.05 + i * 0.8);
      const sprite = this._soft(this._color(ci));
      /* soft gas */
      ctx.globalAlpha = clamp(0.06 + bandV * 0.20 * this.sensitivity, 0.03, 0.22);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(swirl * (i % 2 ? 1 : -1));
      ctx.drawImage(sprite, -r * 1.6, -r * 1.6, r * 3.2, r * 3.2);
      /* dense line-swept filament crossing the gas */
      ctx.strokeStyle = hexRgba(this._color(ci), 0.22 + bandV * 0.35 * this.sensitivity);
      ctx.lineWidth = 1 + bandV * 1.6;
      ctx.beginPath();
      const fr = r * 2.1;
      ctx.moveTo(-fr, 0);
      ctx.quadraticCurveTo(0, -r * 0.9 + Math.sin(this.t * 0.9 + i) * r * 0.3, fr, 0);
      ctx.stroke();
      /* hot star core at filament center */
      const hr = Math.max(1.4, r * 0.16 * (0.55 + bandV * 1.2));
      ctx.globalAlpha = clamp(0.35 + bandV * 0.6, 0, 0.9);
      ctx.drawImage(this._dot(this._color(ci)), -hr, -hr, hr * 2, hr * 2);
      ctx.restore();
    }
    /* starfield — twinkles over the gas */
    for (let i = 0; i < 34; i++) {
      const fx = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
      const fy = ((Math.sin(i * 78.233) * 12543.123) % 1 + 1) % 1;
      const px = fx * w + Math.sin(this.t * 0.18 + i * 1.7) * 18;
      const py = fy * h + Math.cos(this.t * 0.14 + i * 2.3) * 14;
      const a = 0.14 + 0.30 * (0.5 + 0.5 * Math.sin(this.t * 1.1 + i * 1.1));
      const rr = 0.9 + ((i * 7919) % 7) * 0.2;
      ctx.globalAlpha = a;
      ctx.drawImage(this._dot(this._color(i % this.theme.colors.length)), px - rr, py - rr, rr * 2, rr * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  /* ---------------- SPIRAL GALAXY ---------------- */

  _spiral(freq) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h / 2;
    const minDim = Math.min(w, h);
    const arms = this.quality === 'low' ? 2 : 3;
    const PTS = this.quality === 'low' ? 90 : 170;
    const rot = this.t * (0.08 + this.sm.level * 0.8) - this.beat * 0.25;
    const inner = minDim * 0.03;
    const outer = minDim * 0.44;
    ctx.globalCompositeOperation = 'lighter';
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
    const cx = w / 2, cy = h / 2;
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

  /* ---------------- FLUID METAL — metaball membrane ---------------- */

  _fluid(freq) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h / 2;
    const n = this.quality === 'low' ? 5 : 9;
    ctx.globalCompositeOperation = 'lighter';

    /* blob positions computed up front so the membrane can link them */
    const blobs = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + this.t * (0.18 + i * 0.02);
      const rad = Math.min(w, h) * 0.22 * (0.7 + this.sm.bass * 0.6 + this.beat * 0.25);
      const x = cx + Math.cos(ang) * rad * 0.7;
      const y = cy + Math.sin(ang) * rad * 0.5;
      const v = freq ? logSample(freq, i / n) : 0.5;
      blobs.push({ x, y, v });
    }

    /* metaball membrane — connective tissue between close blobs */
    const linkD = Math.min(w, h) * 0.30;
    for (let i = 0; i < blobs.length; i++) {
      for (let j = i + 1; j < blobs.length; j++) {
        const a = blobs[i], b = blobs[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > linkD * linkD) continue;
        const t = 1 - Math.sqrt(d2) / linkD;
        ctx.strokeStyle = hexRgba(this._color(i % this.theme.colors.length), t * (0.14 + this.sm.level * 0.22));
        ctx.lineWidth = 1 + t * 5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    /* beat ripple rings */
    if (this.beat > 0.55) {
      const rr = Math.min(w, h) * (0.3 + this.beat * 0.2);
      ctx.strokeStyle = hexRgba(this._color(0), this.beat * 0.4);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
    }

    /* precessing orbit ring around the cluster */
    const orbR = Math.min(w, h) * (0.34 + this.sm.bass * 0.06);
    ctx.strokeStyle = hexRgba(this._color(2), 0.10 + this.sm.level * 0.12);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, orbR, orbR * 0.62, Math.sin(this.t * 0.23) * 0.7, 0, Math.PI * 2);
    ctx.stroke();

    /* blobs */
    for (let i = 0; i < blobs.length; i++) {
      const { x, y, v } = blobs[i];
      const r = Math.min(w, h) * 0.11 * (0.6 + v * 0.85) * (0.7 + this.sm.bass * 0.5 + this.beat * 0.15);
      const c = this._color(i + Math.floor(this.t * 0.7));
      /* Nine blobs orbit a tight centre and are drawn additively, so the
         middle of the frame stacked three or four deep at up to 0.62 each
         and flattened to white. Budgeted against that overlap: the core
         still reads hot, it just stops being a flat disc of paper. */
      ctx.globalAlpha = clamp(0.20 + v * 0.18, 0, 0.38);
      ctx.drawImage(this._dot(c), x - r, y - r, r * 2, r * 2);
    }
    const cr = Math.min(w, h) * 0.075 * (1 + this.sm.level * 0.5);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(this._dot(this._color(0)), cx - cr, cy - cr, cr * 2, cr * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- TENSOR GRID — perspective wireframe ---------------- */

  _tensor(freq, dt, dt60) {
    const { ctx, w, h } = this;
    const cols = this.quality === 'low' ? 12 : 20;
    const rows = this.quality === 'low' ? 8 : 14;
    const cw = w / cols;
    /* perspective: rows compress toward the top (far plane) */
    const rowY = (gy) => h * (0.16 + 0.84 * Math.pow(gy / rows, 1.4));
    const spread = (gy) => 0.72 + 0.28 * (gy / rows); /* far rows pull inward */
    void dt;

    /* beat shockwaves ripple outward through the mesh */
    if (this.beat > 0.6) {
      if (!this._tensorWaves) this._tensorWaves = [];
      this._tensorWaves.push({ r: 0, a: 0.45 });
    }
    if (this._tensorWaves) {
      for (let i = this._tensorWaves.length - 1; i >= 0; i--) {
        const wv = this._tensorWaves[i];
        wv.r += Math.min(w, h) * 0.016 * dt60;
        wv.a *= 0.93;
        if (wv.a < 0.02) this._tensorWaves.splice(i, 1);
      }
    }
    const waveBoost = (x, y) => {
      if (!this._tensorWaves || !this._tensorWaves.length) return 0;
      const d = Math.hypot(x - w / 2, y - h / 2);
      let boost = 0;
      for (const wv of this._tensorWaves) {
        const band = Math.max(0, 1 - Math.abs(d - wv.r) / 90);
        boost += band * wv.a;
      }
      return boost;
    };

    ctx.globalCompositeOperation = 'lighter';
    /* horizontal wires with frequency displacement */
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath();
      for (let x = 0; x <= cols; x++) {
        const u = x / cols;
        const v = freq ? logSample(freq, u) : 0;
        const px = x * cw;
        const py = rowY(y);
        const off = Math.sin(u * 6 + this.t * 1.4 + y * 0.22) * v * 26 * this.sensitivity
          + waveBoost(px, py) * -14;
        const pull = (px - w / 2) * (1 - spread(y));
        if (x === 0) ctx.moveTo(px + pull, py + off);
        else ctx.lineTo(px + pull, py + off);
      }
      const depth = y / rows;
      ctx.strokeStyle = hexRgba(this._color(y % this.theme.colors.length), 0.10 + depth * 0.16);
      ctx.lineWidth = 0.7 + depth * 0.9;
      ctx.stroke();
    }
    /* vertical struts */
    for (let x = 0; x <= cols; x++) {
      ctx.beginPath();
      for (let y = 0; y <= rows; y++) {
        const u = x / cols;
        const v = freq ? logSample(freq, y / rows) : 0;
        const px = x * cw;
        const py = rowY(y);
        const off = Math.sin(u * 6 + this.t * 1.4 + y * 0.22) * v * 26 * this.sensitivity;
        const pull = (px - w / 2) * (1 - spread(y));
        if (y === 0) ctx.moveTo(px + pull, py + off);
        else ctx.lineTo(px + pull, py + off);
      }
      ctx.strokeStyle = hexRgba(this._color(x % this.theme.colors.length), 0.07);
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    /* node lattice — always on, amplitude-lit */
    const nodeR = 1.6 + this.sm.level * 2.2;
    for (let gy = 1; gy < rows; gy++) {
      for (let gx = 1; gx < cols; gx++) {
        const u = gx / cols;
        const v = freq ? logSample(freq, u * ((gy % 3) + 1) / 3) : 0.2;
        const px = gx * cw;
        const py = rowY(gy);
        const off = Math.sin(u * 6 + this.t * 1.4 + gy * 0.22) * v * 26 * this.sensitivity;
        const pull = (px - w / 2) * (1 - spread(gy));
        const a = clamp(0.08 + v * 0.40 + this.beat * v * 0.35, 0, 0.62);
        const r = nodeR + v * 2.6 + this.beat * 1.2;
        ctx.globalAlpha = a;
        ctx.drawImage(this._dot(this._color((gx + gy) % this.theme.colors.length)), px + pull - r, py + off - r, r * 2, r * 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- PRISM RAY — dispersion ---------------- */

  _prism(freq) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h * 0.58;
    const sz = Math.min(w, h) * 0.25;
    const ax = cx, ay = cy - sz;
    const bx = cx - sz * 0.86, by = cy + sz * 0.5;
    const qx = cx + sz * 0.86, qy = cy + sz * 0.5;

    /* glass slab fill */
    ctx.globalCompositeOperation = 'lighter';
    const ig = ctx.createLinearGradient(0, ay, 0, by);
    ig.addColorStop(0, hexRgba(this._color(1), 0.16 + this.sm.bass * 0.22));
    ig.addColorStop(1, hexRgba(this._color(0), 0.05));
    ctx.fillStyle = ig;
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(qx, qy);
    ctx.closePath();
    ctx.fill();

    /* second face offset — extra-triangular echo for volume */
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = hexRgba(this._color(2), 0.10 + this.sm.mid * 0.16);
    ctx.beginPath();
    ctx.moveTo(ax, ay + sz * 0.08); ctx.lineTo(bx - sz * 0.05, by); ctx.lineTo(qx + sz * 0.05, qy);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    /* incoming beam from top */
    const inLen = h * 0.34;
    const inGrad = ctx.createLinearGradient(ax, ay - inLen, ax, ay);
    inGrad.addColorStop(0, hexRgba(this._color(2), 0));
    inGrad.addColorStop(1, hexRgba(this._color(2), 0.6 + this.sm.level * 0.3));
    ctx.strokeStyle = inGrad;
    ctx.lineWidth = 2.2 + this.sm.level * 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay - inLen);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    /* beam glint where it enters the glass */
    const br = 2.6 + this.sm.mid * 4;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this._dot(this._color(2)), ax - br, ay - br, br * 2, br * 2);
    ctx.globalAlpha = 1;

    /* frame — bright edges, hazy on loud */
    ctx.strokeStyle = hexRgba(this._color(1), 0.92);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(qx, qy);
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = hexRgba(this._color(0), 0.25 + this.sm.level * 0.2);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(ax + 4, ay); ctx.lineTo(bx + 4, by); ctx.lineTo(qx + 4, qy);
    ctx.closePath();
    ctx.stroke();

    /* dispersed fan — spectrum-ordered beams that arc (not straight lines) */
    const beams = this.quality === 'low' ? 7 : 13;
    const ox = (bx + qx) / 2, oy = (by + qy) / 2;
    for (let i = 0; i < beams; i++) {
      const u = i / (beams - 1);
      const v = freq ? logSample(freq, u * 0.96) : 0.5;
      const ang = -1.15 + u * 2.3 + this.beat * 0.12;
      const len = w * 0.62 * (0.45 + v * 0.8);
      const x1 = ox + Math.cos(ang) * sz * 0.34;
      const y1 = oy + Math.sin(ang) * sz * 0.34;
      /* arc each beam through the fan */
      const x2 = x1 + Math.cos(ang) * len;
      const y2 = y1 + Math.sin(ang) * len * 0.20;
      const xm = (x1 + x2) / 2 + Math.sin(ang) * len * 0.16;
      const ym = (y1 + y2) / 2 - len * 0.06;
      const col = this._color(i);
      const g = ctx.createLinearGradient(x1, y1, x2, y2);
      g.addColorStop(0, hexRgba(col, 0.7 + v * 0.3));
      g.addColorStop(0.6, hexRgba(col, 0.22 + v * 0.2));
      g.addColorStop(1, hexRgba(col, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.1 + v * 2.4;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(xm, ym, x2, y2);
      ctx.stroke();
    }

    /* beat glints on the faces */
    if (this.beat > 0.45) {
      const glintR = 6 + this.beat * 12;
      const gx = bx + (qx - bx) * (0.5 + 0.4 * Math.sin(this.t * 2.2));
      const gy = by - sz * 0.28 * Math.abs(Math.sin(this.t * 1.7));
      ctx.globalAlpha = clamp(this.beat * 0.8, 0, 0.85);
      ctx.drawImage(this._dot(this._color(0)), gx - glintR, gy - glintR, glintR * 2, glintR * 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = hexRgba(this._color(2), this.beat * 0.7);
      for (let i = 0; i < 8; i++) {
        const sx = cx + (Math.sin(i * 91.7 + this.t * 3) * sz * 0.9);
        const sy = cy + sz * 0.5 + this.beat * 7 + ((i % 3) * 6);
        ctx.fillRect(sx, sy, 2, 2);
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
      /* 36 rings drawn additively, and the radius curve packs them tightest
         near the core — so the inner rings piled on top of each other and
         burned out the centre. Fade the alpha in toward the middle, where
         the crowding is, instead of paying it flat across every ring. */
      const crowd = 0.45 + 0.55 * Math.min(1, t * 2.2);
      ctx.strokeStyle = hexRgba(this._color(Math.floor(t * 4)), (0.18 + v * 0.32) * crowd);
      ctx.lineWidth = 1.1 + v * 1.4;
      ctx.beginPath();
      // wobble can exceed the radius on the innermost ring — a negative
      // axis throws and kills the whole frame
      ctx.ellipse(cx, cy, Math.max(0.1, r + wob), Math.max(0.1, r * 0.38 + wob * 0.18), 0, 0, Math.PI * 2);
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
    if (this.quality !== 'low') {
      ctx.globalCompositeOperation = 'lighter';
      const meshA = 0.03 + this.sm.level * 0.05;
      /* Spread the grid across the whole spectrum instead of cycling the
         same 64 positions every few cells: the field then shows real
         spectral structure rather than 144 cells all lit the same. */
      const dotAt = (x, y) => (freq ? logSample(freq, (y * cols + x) / (cols * rows - 1)) : 0.5);
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
        const idx = y * cols + x;
        const amp = freq ? logSample(freq, idx / (cols * rows - 1)) : 0.5;
        const px = x * cw + cw / 2 + Math.sin(this.t * 0.6 + idx) * 4;
        const py = y * rh + rh / 2 + Math.cos(this.t * 0.5 + idx * 1.3) * 4;
        /* Bound the bloom to its cell. Radius scaled with amplitude and
           sensitivity unbounded, so at full energy one sprite spanned most
           of the frame; 144 of them in additive mode then merged into a
           flat sheet of white. The old quadratic frequency mapping hid this
           by keeping most cells near silent — with a real log mapping every
           cell carries signal and the field blew out. */
        const cell = Math.min(cw, rh);
        const s = Math.min(cell * 1.25, 10 + amp * 22 * this.sensitivity + this.beat * 6);
        const c = this._color((x + y) % this.theme.colors.length);
        /* soft bokeh pool under every bloom */
        ctx.globalCompositeOperation = 'lighter';
        /* Each pool sprite spanned 3.8x its radius, so on a 16x9 grid every
           point overlapped roughly twenty neighbours; additively that summed
           several times past white and the field read as a flat sheet. Alpha
           is now budgeted against how much a sprite actually overlaps. */
        ctx.globalAlpha = 0.035 + amp * 0.055;
        ctx.drawImage(this._soft(c), px - s * 1.1, py - s * 1.1, s * 2.2, s * 2.2);
        ctx.globalCompositeOperation = 'source-over';
        /* crisp core with alpha falloff */
        ctx.globalAlpha = 0.20 + amp * 0.45;
        ctx.drawImage(this._dot(c), px - s * 0.85, py - s * 0.85, s * 1.7, s * 1.7);
        /* bright center popper on loud cells */
        if (amp > 0.6) {
          const hr = s * 0.3;
          ctx.globalAlpha = (amp - 0.6) * 1.2;
          ctx.drawImage(this._soft(this._color((x + y + 1) % this.theme.colors.length)), px - hr, py - hr, hr * 2, hr * 2);
          ctx.globalAlpha = 1;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  _fractal(freq) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h / 2;
    const base = Math.min(w, h) * 0.12;
    const depth = this.quality === 'low' ? 4 : 6;
    const drawBranch = (x, y, len, ang, d, colIdx) => {
      if (d <= 0) return;
      const v = freq ? logSample(freq, (d / depth)) : 0.5;
      const nx = x + Math.cos(ang) * len * (0.7 + v * 0.6);
      const ny = y + Math.sin(ang) * len * (0.7 + v * 0.6);
      ctx.strokeStyle = hexRgba(this._color(colIdx % this.theme.colors.length), 0.35 + v * 0.45);
      ctx.lineWidth = Math.max(1, d * 1.2);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      const spread = 0.55 + this.sm.bass * 0.3;
      drawBranch(nx, ny, len * 0.68, ang - spread, d - 1, colIdx + 1);
      drawBranch(nx, ny, len * 0.68, ang + spread, d - 1, colIdx + 2);
    };
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < (this.quality === 'low' ? 3 : 5); i++) {
      const ang = (i / 5) * Math.PI * 2 + this.t * 0.2;
      drawBranch(cx, cy, base, ang, depth, i);
    }
    const cr = base * 0.35 * (1 + this.beat * 0.8);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this._dot(this._color(0)), cx - cr, cy - cr, cr * 2, cr * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- BEAT RADAR ---------------- */

  _radar(freq, dt) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h / 2;
    const minDim = Math.min(w, h);
    const R = minDim * 0.42;

    /* sweep speed follows energy, kicks forward on beats */
    const spd = (0.9 + this.sm.level * 2.2) * (1 + this.beat * 1.4);
    this._sweepAng += spd * dt;

    /* range rings + graticule — read at a glance, brighter than before */
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexRgba(this._color(0), 0.16);
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.stroke();
    /* outer bezel + tick marks every 15deg */
    ctx.strokeStyle = hexRgba(this._color(2), 0.10);
    ctx.beginPath();
    ctx.arc(cx, cy, R + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = hexRgba(this._color(2), 0.22);
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * (R + 2), cy + Math.sin(ang) * (R + 2));
      ctx.lineTo(cx + Math.cos(ang) * (R + 7), cy + Math.sin(ang) * (R + 7));
      ctx.stroke();
    }
    /* rotating crosshair that reads as a hard grid pointer */
    ctx.strokeStyle = hexRgba(this._color(0), 0.12 + this.beat * 0.1);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(this._sweepAng) * R * 0.25, cy + Math.sin(this._sweepAng) * R * 0.25);
    ctx.lineTo(cx + Math.cos(this._sweepAng) * R * 0.86, cy + Math.sin(this._sweepAng) * R * 0.86);
    ctx.stroke();

    /* sweep wedge — soft sector that fades behind the leading edge */
    const wedge = 0.62;
    const lead = this._sweepAng;
    const wg = ctx.createLinearGradient(
      cx + Math.cos(lead) * R, cy + Math.sin(lead) * R,
      cx + Math.cos(lead - wedge) * R, cy + Math.sin(lead - wedge) * R
    );
    wg.addColorStop(0, hexRgba(this._color(0), 0.16 + this.sm.level * 0.20));
    wg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.arc(cx, cy, R, lead - wedge, lead);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();

    /* trailing sweep — few rays, wider spacing, decay along angle */
    const rays = this.quality === 'low' ? 8 : 13;
    for (let i = 0; i < rays; i++) {
      const ang = this._sweepAng - i * 0.045;
      const a = (1 - i / rays) * (0.28 + this.sm.level * 0.18);
      ctx.strokeStyle = hexRgba(this._color(Math.floor(i / 5)), a);
      ctx.lineWidth = i === 0 ? 1.8 : 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
      ctx.stroke();
    }
    /* leading edge glow */
    const tipR = minDim * 0.02 * (1 + this.beat);
    ctx.globalAlpha = 0.8;
    ctx.drawImage(
      this._dot(this._color(0)),
      cx + Math.cos(this._sweepAng) * R - tipR,
      cy + Math.sin(this._sweepAng) * R - tipR,
      tipR * 2, tipR * 2
    );
    ctx.globalAlpha = 1;

    /* blips: beat drops a heavy contact, spectrum seeds lighter ones */
    if (this.beat > 0.55 && this.radarBlips.length < 48) {
      this.radarBlips.push({
        ang: this._sweepAng,
        dist: R * (0.25 + this.sm.bass * 0.6),
        life: 1,
        decay: 0.22 + Math.random() * 0.12,
        c: 0,
        big: true,
      });
    }
    if (freq && this.radarBlips.length < 64 && Math.random() < 0.35 + this.sm.level * 0.5) {
      const u = Math.random();
      this.radarBlips.push({
        ang: this._sweepAng - Math.random() * 0.25,
        dist: R * (0.15 + u * 0.8),
        life: 0.7,
        decay: 0.35 + logSample(freq, u) * 0.5,
        c: 1 + Math.floor(u * 3),
        big: false,
      });
    }
    for (let i = this.radarBlips.length - 1; i >= 0; i--) {
      const b = this.radarBlips[i];
      b.life -= b.decay * dt;
      if (b.life <= 0) { this.radarBlips.splice(i, 1); continue; }
      const x = cx + Math.cos(b.ang) * b.dist;
      const y = cy + Math.sin(b.ang) * b.dist;
      const r = (b.big ? 5 : 3) + b.life * (b.big ? 7 : 4);
      ctx.globalAlpha = clamp(b.life, 0, 1) * (b.big ? 0.95 : 0.55);
      ctx.drawImage(this._dot(this._color(b.c)), x - r, y - r, r * 2, r * 2);
      /* ping ring on fresh contacts */
      if (b.life > 0.82) {
        ctx.strokeStyle = hexRgba(this._color(b.c), (b.life - 0.82) * 2.2);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, (1 - b.life) * 90 + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    /* center core */
    const coreR = minDim * 0.014 * (1 + this.sm.bass * 1.2 + this.beat * 0.8);
    ctx.globalAlpha = 0.95;
    ctx.drawImage(this._dot(this._color(0)), cx - coreR, cy - coreR, coreR * 2, coreR * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- LAVA LAMP ---------------- */

  _lava(freq, dt, dt60) {
    const { ctx, w, h } = this;
    const N = this.quality === 'low' ? 6 : 10;
    if (!this.lavaBlobs || this.lavaBlobs.length !== N) {
      this.lavaBlobs = Array.from({ length: N }, (_, i) => ({
        x: ((i * 61) % 100) / 100,
        y: Math.random(),
        r: 0.06 + ((i * 37) % 40) / 400,
        v: 0.008 + ((i * 17) % 20) / 1400,
        ph: (i * 2.399) % 6.283,
        wob: 0.4 + ((i * 29) % 30) / 50,
        c: i % 4,
      }));
    }
    const heat = 0.5 + this.sm.bass * 1.1 + this.beat * 0.35;
    ctx.globalCompositeOperation = 'lighter';

    /* bottom heat pool */
    const pool = ctx.createLinearGradient(0, h * 0.72, 0, h);
    pool.addColorStop(0, 'rgba(0,0,0,0)');
    pool.addColorStop(1, hexRgba(this._color(0), 0.10 + this.sm.bass * 0.16));
    ctx.fillStyle = pool;
    ctx.fillRect(0, h * 0.72, w, h * 0.28);

    for (const b of this.lavaBlobs) {
      /* buoyancy scales with bass — the lamp "heats up" */
      b.y -= b.v * heat * dt60 * 0.55;
      if (b.y < -b.r - 0.05) {
        b.y = 1 + b.r + 0.04;
        b.x = Math.random();
      }
      const px = (b.x + Math.sin(this.t * b.wob + b.ph) * 0.045) * w;
      const py = b.y * h;
      const v = freq ? logSample(freq, (b.ph % 1)) : 0.4;
      const pr = Math.min(w, h) * b.r * (0.85 + v * 0.7 * this.sensitivity + this.beat * 0.18);
      const sprite = this._dot(this._color(b.c));
      ctx.globalAlpha = clamp(0.34 + v * 0.4 + this.sm.bass * 0.18, 0.12, 0.8);
      ctx.drawImage(sprite, px - pr, py - pr, pr * 2, pr * 2);
      /* inner highlight blob */
      const hr = pr * 0.45;
      ctx.globalAlpha *= 0.8;
      ctx.drawImage(sprite, px - pr * 0.3 - hr, py - pr * 0.3 - hr, hr * 2, hr * 2);
    }
    void dt;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- GPU CORE — rotating voxel lattice ---------------- */

  _gpu(freq) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h / 2;
    const minDim = Math.min(w, h);
    const S = minDim * 0.10;
    const N = 4;
    if (!this.gpuVox || this._gpuSig !== N) {
      this._gpuSig = N;
      this.gpuVox = [];
      for (let ix = 0; ix < N; ix++)
        for (let iy = 0; iy < N; iy++)
          for (let iz = 0; iz < N; iz++)
            this.gpuVox.push([ix, iy, iz]);
    }
    const rot = this.t * 0.5 + this.sm.mid * 0.6;
    const cosA = Math.cos(rot), sinA = Math.sin(rot);
    const tilt = Math.sin(this.t * 0.21) * 0.2;
    const cosB = Math.cos(tilt), sinB = Math.sin(tilt);
    const beatP = 1 + this.beat * 0.10 + this.sm.bass * 0.08;
    const scale = S * beatP;

    /* render back-to-front for painter's order */
    const cells = [];
    for (const [ix, iy, iz] of this.gpuVox) {
      const x = (ix - (N - 1) / 2);
      const y = (iy - (N - 1) / 2);
      const z = (iz - (N - 1) / 2);
      /* rotate Y then X */
      const x1 = x * cosA + z * sinA;
      const z1 = -x * sinA + z * cosA;
      const y1 = y * cosB - z1 * sinB;
      const z2 = y * sinB + z1 * cosB;
      /* perspective */
      const persp = 2.6 / (2.6 + z2 * 0.34);
      cells.push({
        px: cx + x1 * scale * persp,
        py: cy + y1 * scale * persp,
        d: z2,
        s: Math.max(2.5, S * 0.72 * persp),
      });
    }
    cells.sort((a, b) => a.d - b.d);

    /* energy color per depth slice so the core reads as a compute stack */
    const sliceColors = this.theme.colors;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const u = clamp((c.d + 2) / 4, 0, 1);
      const amp = freq ? logSample(freq, u * 0.8 + 0.1) : 0.5;
      const bright = clamp(0.5 + amp * 0.42 * this.sensitivity, 0, 1.05);
      const ci = Math.floor(u * sliceColors.length) % sliceColors.length;
      const col = sliceColors[ci];
      /* cell body — source-over so overlapping cells stay saturated,
         never stack to white */
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = clamp(0.62 + amp * 0.26, 0, 0.86);
      ctx.fillStyle = col;
      ctx.fillRect(c.px - c.s / 2, c.py - c.s / 2, c.s, c.s);
      /* Hot top face (fake isometric). This was painted in near-white on
         every one of the 64 cells, so a loud frame turned the whole stack
         achromatic — the cell bodies were carefully kept off 'lighter' to
         avoid exactly that, and then the top face did it anyway. Lifting
         the slice colour instead keeps the lit read and the hue. */
      ctx.globalAlpha = clamp((0.4 + amp * 0.2) * bright, 0, 0.62);
      ctx.fillStyle = this._tint(col, 0.45 + amp * 0.25);
      ctx.fillRect(c.px - c.s / 2, c.py - c.s / 2, c.s, c.s * 0.30);
      /* soft halo on loud cells */
      if (amp > 0.55) {
        ctx.globalCompositeOperation = 'lighter';
        const hr = c.s * (1.1 + amp * 0.5);
        ctx.globalAlpha = (amp - 0.55) * 0.45;
        ctx.drawImage(this._soft(this._color(ci)), c.px - hr, c.py - hr, hr * 2, hr * 2);
      }
    }
    ctx.globalAlpha = 1;

    /* orbiting data nodes — circle the core like bus lines */
    ctx.globalCompositeOperation = 'lighter';
    const orbit = minDim * 0.66;
    const nodes = 7;
    for (let i = 0; i < nodes; i++) {
      const ang = this.t * 0.35 + (i * Math.PI * 2) / nodes;
      const r = orbit * (0.55 + 0.28 * Math.sin(this.t * 0.13 + i * 1.4));
      const nx = cx + Math.cos(ang) * r;
      const ny = cy + Math.sin(ang) * r * 0.62;
      const v = freq ? logSample(freq, (i + 1) / (nodes + 1)) : 0.5;
      const rr = 2.0 + v * 3.6 * this.sensitivity + this.beat * 1.6;
      ctx.globalAlpha = clamp(0.26 + v * 0.42, 0, 0.62);
      ctx.drawImage(this._dot(this._color((i + 1) % this.theme.colors.length)), nx - rr, ny - rr, rr * 2, rr * 2);
      /* link line to core center */
      const gl = ctx.createLinearGradient(nx, ny, cx, cy);
      gl.addColorStop(0, hexRgba(this._color((i + 1) % this.theme.colors.length), 0.05 + v * 0.12));
      gl.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.strokeStyle = gl;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(nx, ny);
      ctx.lineTo(cx, cy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

/** Copy every extra mode method onto the Renderer prototype. Idempotent. */
export function installExtraModes(Renderer) {
  for (const name of Object.getOwnPropertyNames(ExtraModes.prototype)) {
    if (name === 'constructor') continue;
    Renderer.prototype[name] = ExtraModes.prototype[name];
  }
}
