import { logFreqIndex, logSample, hexRgba, clamp } from './utils.js';
import { ResonanceLayer } from './resonance.js';

/**
 * The eighteen heavier visualizer modes, split out of visualizers.js so the
 * entry bundle only carries the four modes the app can actually open on a
 * cold start. They are written as a class body purely so the method syntax
 * matches the file they came from; installExtraModes() copies them onto the
 * real Renderer prototype, so `this` is an ordinary Renderer throughout.
 */
class ExtraModes {
  _resonanceBackdrop() {
    this._resonance ||= new ResonanceLayer();
    this._resonance.draw(this);
  }

  /* ---------------- CRYSTAL KALEIDOSCOPE ---------------- */

  _kaleido(freq, dt) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h / 2;
    const minDim = Math.min(w, h);
    const slices = this.quality === 'low' ? 6 : 10;
    const span = (Math.PI * 2) / slices;
    const rot = this.sceneTime * 0.42 + this.beat * 0.12;
    const burst = 1 + this.beat * 0.30;
    const inner = minDim * 0.07 + this.sm.bass * minDim * 0.09;
    const maxR = minDim * 0.4 * (0.75 + this.sensitivity * 0.35) * burst;
    const P = this.quality === 'low' ? 28 : 56;
    void dt;

    ctx.globalCompositeOperation = 'lighter';
    const ambR = minDim * (0.34 + this.sm.bass * 0.08);
    ctx.globalAlpha = 0.045 + this.sm.level * 0.05 + this.beat * 0.02;
    ctx.drawImage(this._soft(this._vivid(0)), cx - ambR, cy - ambR, ambR * 2, ambR * 2);
    ctx.globalAlpha = 1;

    /* a sparse dust ring outside the facets adds a second depth plane */
    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * Math.PI * 2 + this.t * 0.055;
      const rr = maxR * (1.02 + ((i * 37) % 13) / 31);
      const px = cx + Math.cos(ang) * rr;
      const py = cy + Math.sin(ang) * rr;
      const sr = 1 + (i % 3) * 0.7 + this.beat * 0.6;
      ctx.globalAlpha = 0.10 + 0.10 * (0.5 + 0.5 * Math.sin(this.t * 0.9 + i * 1.7));
      ctx.drawImage(this._dot(this._loud(i + 1)), px - sr, py - sr, sr * 2, sr * 2);
    }
    ctx.globalAlpha = 1;

    const bloomR = minDim * Math.min(0.22, 0.05 + this.sm.bass * 0.05 + this.beat * 0.03);
    ctx.globalAlpha = 0.30;
    ctx.drawImage(this._soft(this._loud(0)), cx - bloomR, cy - bloomR, bloomR * 2, bloomR * 2);
    ctx.globalAlpha = 1;

    for (let s = 0; s < slices; s++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(s * span + rot);
      const c = this._loud(s);
      const pts = [];
      for (let i = 0; i <= P; i++) {
        const v = logSample(freq, Math.pow(i / P, 0.55));
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
      fg.addColorStop(0, hexRgba(c, 0.018));
      fg.addColorStop(0.62, hexRgba(c, 0.085));
      fg.addColorStop(1, hexRgba(c, 0.25));
      ctx.fillStyle = fg;
      ctx.fill();

      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
        else ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.strokeStyle = hexRgba(c, 0.10);
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = hexRgba(c, 0.62);
      ctx.lineWidth = 1.1;
      ctx.stroke();
      if (this.sm.bass > 0.45) {
        ctx.strokeStyle = hexRgba(this._vivid(0), 0.26 + this.sm.bass * 0.22);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(pts[Math.floor(P / 2)][0], pts[Math.floor(P / 2)][1]);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* dark centre well: the facet tips converge here, and additive strokes
       otherwise fuse into a white knot instead of a lit crystal core */
    ctx.globalCompositeOperation = 'source-over';
    const wellR = inner * 1.7;
    const well = ctx.createRadialGradient(cx, cy, 0, cx, cy, wellR);
    well.addColorStop(0, 'rgba(4,4,6,0.92)');
    well.addColorStop(0.58, 'rgba(4,4,6,0.42)');
    well.addColorStop(1, 'rgba(4,4,6,0)');
    ctx.fillStyle = well;
    ctx.beginPath();
    ctx.arc(cx, cy, wellR, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexRgba(this._loud(0), 0.44 + this.beat * 0.2);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(cx, cy, inner * 0.86, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = hexRgba(this._loud(1), 0.18 + this.sm.level * 0.14);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * 0.96, rot * 0.4, rot * 0.4 + Math.PI * 1.55);
    ctx.stroke();
    const coreR = inner * (0.30 + this.beat * 0.14);
    ctx.globalAlpha = 0.62;
    ctx.drawImage(this._dot(this._vivid(0)), cx - coreR, cy - coreR, coreR * 2, coreR * 2);
    ctx.globalAlpha = 1;
    for (let i = 0; i < 3; i++) {
      const ang = this.t * (0.22 + i * 0.04) + (i / 3) * Math.PI * 2;
      const rr = maxR * (0.34 + i * 0.17);
      const x = cx + Math.cos(ang) * rr;
      const y = cy + Math.sin(ang) * rr;
      const sr = 2.2 + this.beat * 1.4 + i * 0.4;
      ctx.globalAlpha = 0.34 + 0.18 * Math.sin(this.t * 1.2 + i);
      ctx.drawImage(this._dot(this._loud(i + 1)), x - sr, y - sr, sr * 2, sr * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- SPECTROGRAM WATERFALL ---------------- */

  _buildSpectroLut() {
    /* contrast-ramped LUT: deep black floor, one bright ramp packet per
       theme color, white-hot only at peaks. Steep gamma + step mapping
       keep quiet audio black, so dynamics read as color silhouette. */
    const stops = [[3, 3, 4]];
    const palette = this._loudColors || this._vividColors || this.theme.colors;
    for (const c of palette) {
      const n = parseInt(c.slice(1), 16);
      stops.push([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
    }
    /* Lighten each theme stop slightly as energy climbs — but ceilinged.
       Adding a flat offset to a pale palette (Warm Brass tops out at
       #f5e6d3) drove every upper stop to 255,255,255, so a tenth of the
       waterfall was one flat white with no hue and no gradient left. The
       cap keeps the hot end reading as hot while the channels stay apart. */
    const CEIL = 198;
    const boosted = [];
    for (let i = 1; i < stops.length; i++) {
      const s = stops[i];
      boosted.push([
        Math.min(CEIL, s[0] + 6 + i * 3),
        Math.min(CEIL, s[1] + 6 + i * 3),
        Math.min(CEIL, s[2] + 6 + i * 3),
      ]);
    }
    stops.push(...boosted);
    /* The top of the ramp stays in the palette's own hue family; only its
       relative value lifts. */
    const top = stops[stops.length - 1];
    const tm = Math.max(1, top[0], top[1], top[2]);
    stops.push([
      Math.min(228, Math.round(top[0] * 0.78 + (top[0] / tm) * 255 * 0.22)),
      Math.min(224, Math.round(top[1] * 0.78 + (top[1] / tm) * 255 * 0.22)),
      Math.min(220, Math.round(top[2] * 0.78 + (top[2] / tm) * 255 * 0.22)),
    ]);
    const lut = this.specLut = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      /* steep gamma: low+mid values stay near-black, only peaks climb */
      const v = Math.pow(i / 255, 3.2);
      const f = v * (stops.length - 1);
      const s = Math.min(stops.length - 2, Math.floor(f));
      const u = f - s;
      const a = stops[s];
      const b = stops[s + 1];
      lut[i * 3] = (a[0] + (b[0] - a[0]) * u) * 0.80;
      lut[i * 3 + 1] = (a[1] + (b[1] - a[1]) * u) * 0.80;
      lut[i * 3 + 2] = (a[2] + (b[2] - a[2]) * u) * 0.80;
    }
  }

  _spectro(freq, dt) {
    const { ctx, w, h } = this;
    /* rebuilt when size, quality or palette actually change — the joined
       signature string this compared used to be built every frame */
    if (!this.specCv || this._specW !== w || this._specH !== h
        || this._specTheme !== this.theme || this._specQ !== this.quality) {
      this._specW = w;
      this._specH = h;
      this._specTheme = this.theme;
      this._specQ = this.quality;
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
      if (!this._specImg || this._specImgW !== colW || this._specImgH !== H) {
        this._specImg = this.specCtx.createImageData(colW, H);
        this._specImgW = colW; this._specImgH = H;
      }
      const img = this._specImg;
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
        v = v < 0.06 ? 0 : v;
        /* onsets print brighter: the fresh column carries the beat, so kick
           drums land in the waterfall as bright stripes instead of the
           history showing no trace of the rhythm */
        if (v > 0 && this.beat > 0.02) v = Math.min(1, v * (1 + this.beat * 0.35));
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

    /* calibration grid and edge shade turn the waterfall into an instrument
       panel instead of a full-bleed texture */
    ctx.strokeStyle = hexRgba(this._color(0), 0.075);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 6; i++) {
      const gy = (h * i) / 6;
      ctx.moveTo(0, gy); ctx.lineTo(w, gy);
    }
    for (let i = 1; i < 8; i++) {
      const gx = (w * i) / 8;
      ctx.moveTo(gx, 0); ctx.lineTo(gx, h);
    }
    ctx.stroke();
    const shade = ctx.createLinearGradient(0, 0, 0, h);
    shade.addColorStop(0, 'rgba(5,5,6,0.34)');
    shade.addColorStop(0.16, 'rgba(5,5,6,0)');
    shade.addColorStop(0.84, 'rgba(5,5,6,0)');
    shade.addColorStop(1, 'rgba(5,5,6,0.30)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, w, h);

    const scanX = w - ((this.t * 140) % (w + 80));
    ctx.globalCompositeOperation = 'lighter';
    const beam = ctx.createLinearGradient(scanX - 30, 0, scanX, 0);
    beam.addColorStop(0, 'rgba(0,0,0,0)');
    beam.addColorStop(1, hexRgba(this._color(0), 0.22 + this.beat * 0.12));
    ctx.fillStyle = beam;
    ctx.fillRect(scanX - 30, 0, 30, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = hexRgba(this._color(0), 0.5 + this.beat * 0.2);
    ctx.fillRect(w - colW - 1, 0, 1, h);
    /* the drop lands as a wash of theme colour over the waterfall — the
       global camera punch already covers motion, so this is brightness
       only and stays comfortable under reduced-motion */
    const drop = this.beatInfo?.drop || 0;
    if (drop > 0.02) {
      ctx.fillStyle = hexRgba(this._color(0), drop * 0.10);
      ctx.fillRect(0, 0, w, h);
    }
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
    const glowR = maxR * Math.min(0.30, 0.12 + this.sm.bass * 0.12 + this.beat * 0.06);
    ctx.globalAlpha = 0.18 + this.sm.bass * 0.12;
    ctx.drawImage(this._soft(this._loud(0)), cx - glowR, cy - glowR, glowR * 2, glowR * 2);
    ctx.globalAlpha = 1;
    const SEG = this.quality === 'low' ? 28 : 44;
    for (let i = 0; i < rings; i++) {
      const baseR = maxR * Math.pow((i + 1) / rings, 1.15);
      const pulse = this.history[this.history.length - 1 - i] * maxR * 0.3 * this.sensitivity;
      const alpha = 0.48 - (i / rings) * 0.34 + (i % 5 === 0 ? 0.05 : 0);
      const c = this._loud(Math.floor(i / 4.0) + Math.floor(this.t * 0.06));
      const tilt = Math.sin(i * 0.9 + this.t * 0.9) * 0.05;
      ctx.beginPath();
      for (let s = 0; s <= SEG; s++) {
        const ang = (s / SEG) * Math.PI * 2;
        let wob = 0;
        if (freq) {
          const u = Math.pow((s / SEG + i * 0.11) % 1, 0.55);
          wob = (logSample(freq, u) - 0.45) * baseR * 0.12 * (0.4 + this.sm.level) * this.sensitivity;
        }
        const r = baseR + pulse + wob;
        const x = cx + Math.cos(ang) * r * (1 + tilt);
        const y = cy + Math.sin(ang) * r * (1 - tilt);
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      if (i % 4 === 0) {
        ctx.strokeStyle = hexRgba(c, alpha * 0.18);
        ctx.lineWidth = 4.2;
        ctx.stroke();
      }
      ctx.strokeStyle = hexRgba(c, alpha);
      ctx.lineWidth = Math.max(0.55, 2.1 - (i / rings) * 1.5);
      ctx.stroke();
    }

    /* warp dust beyond the mouth of the tunnel */
    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * Math.PI * 2 + 0.3;
      const r0 = maxR * (1.02 + ((i * 29) % 9) / 26);
      const r1 = r0 + maxR * (0.05 + 0.05 * (0.5 + 0.5 * Math.sin(this.t * 0.7 + i)));
      ctx.strokeStyle = hexRgba(this._loud(i), 0.035 + this.sm.level * 0.045);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.stroke();
    }

    /* the opening is a dark eye with a lit rim, not an additive white dot */
    ctx.globalCompositeOperation = 'source-over';
    const wellR = maxR * (0.105 + this.sm.bass * 0.018);
    const well = ctx.createRadialGradient(cx, cy, 0, cx, cy, wellR);
    well.addColorStop(0, 'rgba(3,3,5,0.92)');
    well.addColorStop(0.62, 'rgba(3,3,5,0.46)');
    well.addColorStop(1, 'rgba(3,3,5,0)');
    ctx.fillStyle = well;
    ctx.beginPath();
    ctx.arc(cx, cy, wellR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexRgba(this._vivid(0), 0.40 + this.beat * 0.18);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, wellR * 0.94, 0, Math.PI * 2);
    ctx.stroke();
    const irisR = wellR * (0.34 + this.beat * 0.10);
    ctx.globalAlpha = 0.62;
    ctx.drawImage(this._dot(this._vivid(0)), cx - irisR, cy - irisR, irisR * 2, irisR * 2);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = hexRgba(this._loud(0), 0.13 + this.sm.level * 0.10);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * 0.54, this.t * 0.3, this.t * 0.3 + Math.PI * 1.2);
    ctx.arc(cx, cy, maxR * 0.72, -this.t * 0.2, -this.t * 0.2 + Math.PI * 0.8);
    ctx.stroke();

    const rays = 9;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < rays; i++) {
      const ang = this.t * (0.25 + i * 0.02) + (i / rays) * Math.PI * 2;
      const r0 = maxR * 0.2, r1 = maxR * 0.85;
      ctx.strokeStyle = hexRgba(this._loud(i), 0.06 + this.sm.level * 0.08);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.stroke();
    }
    const vigKey = `${w}x${h}`;
    if (!this._tunnelVig || this._tunnelVigKey !== vigKey) {
      this._tunnelVigKey = vigKey;
      const vig = ctx.createRadialGradient(cx, cy, maxR * 0.7, cx, cy, maxR * 1.25);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.32)');
      this._tunnelVig = vig;
    }
    ctx.fillStyle = this._tunnelVig;
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

    const ambR = minDim * (0.38 + this.sm.bass * 0.08);
    ctx.globalAlpha = 0.05 + this.sm.level * 0.05 + this.beat * 0.02;
    ctx.drawImage(this._soft(this._vivid(0)), cx - ambR, cy - ambR, ambR * 2, ambR * 2);
    ctx.globalAlpha = 1;
    for (let i = 0; i < 20; i++) {
      const ang = (i / 20) * Math.PI * 2 + this.t * 0.03;
      const rr = minDim * (0.32 + ((i * 43) % 19) / 38);
      const x = cx + Math.cos(ang) * rr;
      const y = cy + Math.sin(ang) * rr * 0.72;
      const sr = 1 + (i % 3) * 0.55;
      ctx.globalAlpha = 0.08 + 0.10 * (0.5 + 0.5 * Math.sin(this.t * 0.7 + i * 1.9));
      ctx.drawImage(this._dot(this._loud(i)), x - sr, y - sr, sr * 2, sr * 2);
    }
    ctx.globalAlpha = 1;

    for (let r = 0; r < rings; r++) {
      const baseR = minDim * (0.11 + r * 0.145);
      const spin = this.sceneTime * (0.14 + r * 0.08) * (r % 2 ? -1 : 1);
      const c = this._loud(r);
      ctx.beginPath();
      for (let i = 0; i <= P; i++) {
        const ang = (i / P) * Math.PI * 2 + spin;
        const slot = ((i * 7 + Math.floor(this.t * 3) * 3) % P) / P;
        const v = logSample(freq, Math.pow(slot, 0.55));
        const mod = Math.sin(ang * (2 + r * 2) - this.t * 1.4) * this.sm.mid * 0.22
          + Math.cos(ang * 3 + this.t * 1.1) * this.sm.high * 0.26;
        const rad = baseR * (1 + v * 0.46 * this.sensitivity + mod) + this.beat * baseR * 0.05;
        const x = cx + Math.cos(ang) * rad;
        const y = cy + Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const fg = ctx.createRadialGradient(cx, cy, baseR * 0.55, cx, cy, baseR * 1.55);
      fg.addColorStop(0, hexRgba(c, 0.012));
      fg.addColorStop(0.62, hexRgba(c, 0.05));
      fg.addColorStop(1, hexRgba(c, 0.16));
      ctx.fillStyle = fg;
      ctx.fill();
      ctx.strokeStyle = hexRgba(c, 0.07 + this.sm.level * 0.05);
      ctx.lineWidth = 4.5;
      ctx.stroke();
      ctx.strokeStyle = hexRgba(c, 0.30 + this.sm.level * 0.16);
      ctx.lineWidth = 1.2;
      ctx.stroke();

      for (let k = 0; k < 12; k++) {
        const i = (k / 12) * P;
        const ang = (i / P) * Math.PI * 2 + spin;
        const slot = ((i * 7 + Math.floor(this.t * 3) * 3) % P) / P;
        const v = logSample(freq, Math.pow(slot, 0.55));
        const mod = Math.sin(ang * (2 + r * 2) - this.t * 1.4) * this.sm.mid * 0.22
          + Math.cos(ang * 3 + this.t * 1.1) * this.sm.high * 0.26;
        const rad = baseR * (1 + v * 0.46 * this.sensitivity + mod) + this.beat * baseR * 0.05;
        const x = cx + Math.cos(ang) * rad;
        const y = cy + Math.sin(ang) * rad;
        const s = 2 + v * 4.5 + this.beat * 1.2;
        ctx.globalAlpha = clamp(0.20 + v * 0.45, 0.12, 0.62);
        ctx.drawImage(this._dot(c), x - s, y - s, s * 2, s * 2);
      }
      ctx.globalAlpha = 1;
    }

    if (this.beat > 0.25) {
      const br = minDim * 0.5 * this.beat;
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = hexRgba(this._vivid(0), this.beat * 0.34);
      ctx.beginPath();
      ctx.moveTo(cx - br, cy); ctx.lineTo(cx + br, cy);
      ctx.moveTo(cx, cy - br); ctx.lineTo(cx, cy + br);
      ctx.moveTo(cx - br * 0.62, cy - br * 0.62); ctx.lineTo(cx + br * 0.62, cy + br * 0.62);
      ctx.moveTo(cx + br * 0.62, cy - br * 0.62); ctx.lineTo(cx - br * 0.62, cy + br * 0.62);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
    const wellR = minDim * (0.070 + this.sm.bass * 0.012);
    const well = ctx.createRadialGradient(cx, cy, 0, cx, cy, wellR);
    well.addColorStop(0, 'rgba(3,3,5,0.90)');
    well.addColorStop(0.6, 'rgba(3,3,5,0.40)');
    well.addColorStop(1, 'rgba(3,3,5,0)');
    ctx.fillStyle = well;
    ctx.beginPath();
    ctx.arc(cx, cy, wellR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexRgba(this._vivid(0), 0.42 + this.beat * 0.16);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, wellR * 0.92, 0, Math.PI * 2);
    ctx.stroke();
    const coreR = wellR * (0.34 + this.beat * 0.16);
    ctx.globalAlpha = 0.58;
    ctx.drawImage(this._dot(this._vivid(1)), cx - coreR, cy - coreR, coreR * 2, coreR * 2);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = hexRgba(this._loud(0), 0.12 + this.sm.level * 0.10);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, minDim * 0.40, this.t * 0.12, this.t * 0.12 + Math.PI * 1.1);
    ctx.stroke();
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
      for (let i = 0; i < COLS; i++) {
        const u = Math.pow(i / Math.max(1, COLS - 1), 0.62);
        row[i] = clamp(logSample(freq, u) * this.sensitivity, 0, 1.2);
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
    const skyBase = ctx.createLinearGradient(0, 0, 0, horizon);
    skyBase.addColorStop(0, 'rgba(4,5,8,0.62)');
    skyBase.addColorStop(0.55, this._shadow(this._color(0), 0.14, 6));
    skyBase.addColorStop(1, this._shadow(this._color(1), 0.26, 5));
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = skyBase;
    ctx.fillRect(0, 0, w, horizon);

    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = this._loud(0);
    for (const s of this.stars) {
      ctx.globalAlpha = 0.08 + 0.26 * (0.5 + 0.5 * Math.sin(this.t * 0.9 + s.ph));
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 2; i++) {
      const ax = w * (0.25 + i * 0.35) + Math.sin(this.t * 0.14 + i * 2.2) * w * 0.14;
      const ah = depth * (0.24 + i * 0.1);
      const aur = ctx.createLinearGradient(0, horizon - ah, 0, horizon);
      aur.addColorStop(0, 'rgba(0,0,0,0)');
      aur.addColorStop(1, hexRgba(this._loud(1 + i), 0.08 + this.sm.level * 0.05 + this.beat * 0.03));
      ctx.fillStyle = aur;
      ctx.fillRect(ax, horizon - ah, w * 0.34, ah);
    }
    if (this.beat > 0.7) {
      if (!this._meteor) this._meteor = { x: w * 0.12, y: horizon * 0.18 };
      const m = this._meteor;
      m.x += 9; m.y += 2.2;
      const tailR = 30;
      const streak = ctx.createLinearGradient(m.x - tailR, m.y - tailR * 0.2, m.x, m.y);
      streak.addColorStop(0, hexRgba(this._vivid(0), 0));
      streak.addColorStop(1, hexRgba(this._vivid(0), 0.9));
      ctx.strokeStyle = streak;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(m.x - tailR, m.y - tailR * 0.2);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
    } else this._meteor = null;
    const sunR = Math.min(w, h) * (0.075 + this.sm.bass * 0.02 + this.beat * 0.01);
    const sunY = horizon - Math.min(w, h) * 0.16;
    ctx.globalAlpha = 0.14 + this.sm.bass * 0.08;
    ctx.drawImage(this._soft(this._loud(0)), w / 2 - sunR * 2.8, sunY - sunR * 2.8, sunR * 5.6, sunR * 5.6);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const sun = ctx.createRadialGradient(w / 2 - sunR * 0.26, sunY - sunR * 0.30, sunR * 0.06, w / 2, sunY, sunR);
    sun.addColorStop(0, this._tint(this._vivid(0), -0.02));
    sun.addColorStop(0.55, this._tint(this._vivid(0), -0.20));
    sun.addColorStop(0.88, this._tint(this._vivid(0), -0.34));
    sun.addColorStop(1, this._tint(this._vivid(0), -0.46));
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(w / 2, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    const bandColor = this._shadow(this._color(0), 0.1, 4);
    ctx.fillStyle = bandColor;
    for (let b = 0; b < 4; b++) {
      ctx.globalAlpha = 0.52 - b * 0.09;
      ctx.fillRect(w / 2 - sunR * 1.06, sunY + sunR * (0.02 + b * 0.23), sunR * 2.12, sunR * (0.028 + b * 0.013));
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    const sky = ctx.createLinearGradient(0, horizon - depth * 0.45, 0, horizon);
    sky.addColorStop(0, hexRgba(this._color(0), this.beat * 0.05));
    sky.addColorStop(0.55, hexRgba(this._color(0), 0.025 + this.sm.level * 0.03));
    sky.addColorStop(1, hexRgba(this._color(0), 0.035 + this.sm.bass * 0.045 + this.beat * 0.04));
    ctx.fillStyle = sky;
    ctx.fillRect(0, horizon - depth * 0.45, w, depth * 0.45);
    ctx.fillStyle = hexRgba(this._vivid(0), 0.13 + this.beat * 0.10);
    ctx.fillRect(0, horizon - 1, w, 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, horizon, w, depth);
    ctx.clip();
    ctx.translate(w / 2, horizon);
    const ground = ctx.createLinearGradient(0, 0, 0, depth);
    ground.addColorStop(0, this._shadow(this._color(0), 0.10, 4));
    ground.addColorStop(0.45, this._shadow(this._color(1), 0.07, 3));
    ground.addColorStop(1, this._shadow(this._color(0), 0.12, 5));
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = ground;
    ctx.fillRect(-w * 0.7, 0, w * 1.4, depth);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.05 + this.sm.level * 0.04;
    ctx.drawImage(this._soft(this._loud(0)), -w * 0.55, -depth * 0.06, w * 1.1, depth * 0.55);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.1;
    const ampBase = depth * 0.42;

    /* two silhouetted ranges sit behind the lit mesh, so the scene has a
       foreground, a middle distance and a sky rather than one beige field */
    ctx.globalCompositeOperation = 'source-over';
    const drawRidge = (baseY, rAmp, tint, alpha) => {
      ctx.beginPath();
      ctx.moveTo(-w * 0.7, baseY + rAmp * 1.6);
      for (let i = 0; i <= COLS; i++) {
        const u = i / COLS;
        const x = (u - 0.5) * w * 1.4;
        const yy = baseY - (Math.sin(u * 7.2 + 1.1) * 0.55
          + Math.sin(u * 3.1 - 0.6) * 0.45 + 0.35) * rAmp;
        ctx.lineTo(x, yy);
      }
      ctx.lineTo(w * 0.7, baseY + rAmp * 1.6);
      ctx.closePath();
      ctx.fillStyle = tint;
      ctx.globalAlpha = alpha;
      ctx.fill();
    };
    drawRidge(depth * 0.20, depth * 0.10, this._shadow(this._color(1), 0.10, 4), 0.82);
    drawRidge(depth * 0.34, depth * 0.08, this._shadow(this._color(0), 0.12, 3), 0.90);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.055 + this.sm.level * 0.045;
    ctx.drawImage(this._soft(this._loud(0)), -w * 0.6, -depth * 0.16, w * 1.2, depth * 0.32);
    ctx.globalAlpha = 1;

    /* parallax halo ridge behind the mesh — same displacement, dimmed,
       shifted slowly sideways so the range never looks frozen */
    {
      const drift = Math.sin(this.t * 0.11) * w * 0.035;
      ctx.beginPath();
      for (let i = 0; i <= COLS; i++) {
        const ci = Math.min(COLS - 1, i);
        const x = ((ci / COLS) - 0.5) * w * 1.3 + drift;
        const yy = depth * 0.06 - this.terrainRows[this.terrainRows.length - 1]?.[ci] * ampBase * 0.5;
        if (i === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.strokeStyle = hexRgba(this._loud(1), 0.035 + this.sm.level * 0.04);
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    for (let r = ROWS - 1; r >= 0; r--) {
      const row = this.terrainRows[r];
      const u = (ROWS - r) / ROWS;
      const y = depth * u * u;
      const spread = 0.16 + 1.86 * u * u;
      const amp = ampBase * (0.18 + 0.82 * u) * (0.5 + this.sm.level * 1.1);
      ctx.beginPath();
      for (let i = 0; i <= COLS; i++) {
        const ci = Math.min(COLS - 1, i);
        const x = ((ci / COLS) - 0.5) * w * spread;
        const yy = y - row[ci] * amp;
        if (i === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      const c = this._loud(r);
      /* front rows get the beat light */
      const isFront = r < 3;
      const lineA = isFront ? 0.32 + this.beat * 0.24 : 0.07 + u * 0.28;
      if (r % 5 === 0) {
        ctx.strokeStyle = hexRgba(isFront ? this._vivid(0) : c, lineA * 0.20);
        ctx.lineWidth = isFront ? 4 : 2.6;
        ctx.stroke();
      }
      ctx.strokeStyle = hexRgba(isFront ? this._vivid(0) : c, lineA);
      ctx.lineWidth = isFront ? 1.4 : 0.5 + u * 0.6;
      ctx.stroke();
      if (isFront && this.beat > 0.4) {
        /* peak glints along the lit ridge */
        for (let i = 0; i < COLS; i += 3) {
          if (row[i] > 0.8) {
            const gx = ((i / COLS) - 0.5) * w * spread;
            const gy = y - row[i] * amp;
            const gr = 1.5 + row[i] * 2.2;
            ctx.globalAlpha = (this.beat - 0.4) * 0.5;
            ctx.drawImage(this._dot(this._vivid(0)), gx - gr, gy - gr, gr * 2, gr * 2);
          }
        }
        ctx.globalAlpha = 1;
      }
      if (r > 0) {
        const uPrev = (ROWS - (r - 1)) / ROWS;
        const yPrev = depth * uPrev * uPrev;
        const spreadPrev = 0.16 + 1.86 * uPrev * uPrev;
        ctx.lineTo(((COLS - 1) / COLS - 0.5) * w * spreadPrev, yPrev + 2);
        ctx.lineTo((-0.5) * w * spreadPrev, yPrev + 2);
        ctx.closePath();
        ctx.fillStyle = hexRgba(c, 0.012 + u * 0.062);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      const y = h - h * (0.010 + 0.020 * (0.5 + 0.5 * Math.sin(u * 9 + 1.7)));
      ctx.lineTo(u * w, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = this._shadow(this._color(0), 0.16, 3);
    ctx.fill();
    ctx.globalAlpha = 1;
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
    const sky = ctx.createLinearGradient(0, 0, 0, baseline);
    sky.addColorStop(0, 'rgba(4,5,8,0.66)');
    sky.addColorStop(0.58, this._shadow(this._color(0), 0.13, 6));
    sky.addColorStop(1, this._shadow(this._color(1), 0.22, 5));
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, baseline);

    const moonR = Math.min(w, h) * (0.045 + this.sm.bass * 0.008);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.16 + this.sm.bass * 0.10;
    ctx.drawImage(this._soft(this._vivid(0)), w * 0.78 - moonR * 2.8, baseline * 0.24 - moonR * 2.8, moonR * 5.6, moonR * 5.6);
    ctx.globalAlpha = 0.52;
    ctx.drawImage(this._dot(this._vivid(0)), w * 0.78 - moonR, baseline * 0.24 - moonR, moonR * 2, moonR * 2);
    ctx.globalAlpha = 1;

    ctx.fillStyle = this._loud(0);
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
      ctx.strokeStyle = hexRgba(this._loud(1 + i), 0.12 + this.sm.level * 0.08 + this.beat * 0.05);
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
      const u = Math.pow(i / Math.max(1, N - 1), 0.62);
      const s0 = logSample(freq, u);
      const s1 = logSample(freq, Math.min(1, u + 0.06));
      const raw = ((s0 + s1) / 2) * this.sensitivity;
      const weight = 1 + this.bassFocus * 0.7 * (1 - u);
      const target = Math.min(1, raw * weight);
      const c = this.cityCols[i];
      c.v += (target - c.v) * (target > c.v ? Math.min(1, dt60 * 0.55) : fall);
      c.peak = Math.max(c.peak * fallPeak, c.v);
    }
    /* a farther, darker rank of towers gives the skyline real parallax */
    ctx.fillStyle = this._shadow(this._color(1), 0.052, 4);
    for (let i = 0; i < N; i += 3) {
      const src = this.cityCols[(i * 5 + 2) % N];
      const bh = maxH * (0.10 + ((src.seed % 89) / 89) * 0.20 + src.v * 0.12);
      ctx.fillRect(i * bw - bw * 0.16, baseline - bh, bw * 0.88, bh);
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
      const silhouette = 0.62 + ((col.seed % 97) / 97) * 0.7;
      const bh = Math.max(8, (0.05 + col.v * 0.78) * maxH * silhouette);
      const bodyW = bw * 0.68;
      const x = i * bw + (bw - bodyW) / 2;
      const y = baseline - bh;
      const c = this._loud(i);
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
          const flick = 0.78 + 0.22 * Math.sin(this.t * (0.8 + hsh * 2.2) + col.seed + wx);
          const a = (0.14 + 0.6 * col.v) * (0.3 + 0.7 * hsh) * flick;
          if (a < 0.06) continue;
          const wc = (wx + wy * 2 + i) % 5 === 0 ? colors[(i + 2) % colors.length] : c;
          ctx.fillStyle = hexRgba(wc, a);
          ctx.fillRect(x + 3 + wx * 5, y + 7 + wy * 10, 2.5, 3.5);
        }
      }
      tall.push({ x: x + bodyW / 2, y: y });
    }
    tall.sort((a, b) => b.y - a.y);

    /* wet asphalt: long vertical smears anchor the towers to the street */
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < Math.min(7, tall.length); k++) {
      const tb = tall[(k * 5) % tall.length];
      const c = this._loud(k + 1);
      const rr = ctx.createLinearGradient(0, baseline, 0, h);
      rr.addColorStop(0, hexRgba(c, 0.13 + this.sm.level * 0.08));
      rr.addColorStop(1, hexRgba(c, 0));
      ctx.fillStyle = rr;
      const rw = Math.max(2, bw * (0.14 + ((k * 7) % 5) * 0.045));
      ctx.fillRect(tb.x - rw / 2, baseline, rw, h - baseline);
    }
    ctx.fillStyle = hexRgba(this._color(0), 0.32 + this.beat * 0.18);
    ctx.fillRect(0, baseline - 0.5, w, 1);
    const beaconC = this._vivid(0);
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

  _nebula(freq) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h / 2;
    const minDim = Math.min(w, h);
    const N = this.quality === 'low' ? 4 : 7;
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
    const bands = this._nebulaBands || (this._nebulaBands = [0, 0, 0]);
    bands[0] = this.sm.bass; bands[1] = this.sm.mid; bands[2] = this.sm.high;
    const swirl = this.sceneTime * 0.15;

    const sky = ctx.createRadialGradient(cx, cy * 0.92, minDim * 0.04, cx, cy, minDim * 0.92);
    sky.addColorStop(0, this._shadow(this._color(1), 0.22, 5));
    sky.addColorStop(0.58, this._shadow(this._color(0), 0.12, 4));
    sky.addColorStop(1, '#050507');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'lighter';
    /* distant gas establishes a background plane before the bright clouds */
    for (let i = 0; i < 2; i++) {
      const gx = cx + Math.sin(this.t * 0.035 + i * 1.9) * w * (0.18 + i * 0.05);
      const gy = cy + Math.cos(this.t * 0.028 + i * 1.3) * h * (0.12 + i * 0.035);
      const gr = minDim * (0.30 + i * 0.055);
      ctx.globalAlpha = 0.025 + this.sm.level * 0.02;
      ctx.drawImage(this._soft(this._loud(i + 1)), gx - gr, gy - gr, gr * 2, gr * 2);
    }

    /* galactic disc — a stretched, tilted swirl of soft pools */
    const discTilt = -0.3 + Math.sin(this.t * 0.05) * 0.06;
    const coreGlow = minDim * (0.30 + this.sm.bass * 0.5 + this.beat * 0.10);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(discTilt);
    ctx.scale(1, 0.36);
    ctx.globalAlpha = clamp(0.08 + this.sm.level * 0.13, 0.03, 0.24);
    ctx.drawImage(this._soft(this._vivid(0)), -coreGlow, -coreGlow, coreGlow * 2, coreGlow * 2);
    ctx.restore();

    for (let i = 0; i < N; i++) {
      const b = this.nebula[i];
      const x = cx + Math.sin(this.t * b.fx * 2 + b.p1) * w * b.ax;
      const y = cy + Math.cos(this.t * b.fy * 2 + b.p2) * h * b.ay;
      const bandV = bands[b.band];
      /* unsmoothed spectral read at this blob's position: the smoothed
         bands alone made every filament breathe a half-beat late, so the
         transient pokes through on top of the band envelope */
      const rip = freq ? logSample(freq, (i + 0.5) / N) : bandV;
      const tv = Math.max(bandV, rip * 0.9);
      const r = Math.min(minDim * 0.20, minDim * b.sz * (0.75 + bandV * 1.4 * this.sensitivity + this.beat * 0.18));
      const ci = Math.floor(this.t * 0.05 + i * 0.8);
      const sprite = this._soft(this._loud(ci));
      /* soft gas */
      ctx.globalAlpha = clamp(0.055 + bandV * 0.18 * this.sensitivity, 0.03, 0.21);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(swirl * (i % 2 ? 1 : -1));
      ctx.drawImage(sprite, -r * 1.5, -r * 1.5, r * 3.0, r * 3.0);
      /* dense line-swept filament crossing the gas */
      ctx.strokeStyle = hexRgba(this._loud(ci), 0.16 + tv * 0.28 * this.sensitivity);
      ctx.lineWidth = 0.9 + tv * 1.4;
      ctx.beginPath();
      const fr = r * 2.1;
      ctx.moveTo(-fr, 0);
      ctx.quadraticCurveTo(0, -r * 0.9 + Math.sin(this.t * 0.9 + i) * r * 0.3, fr, 0);
      ctx.stroke();
      /* hot star core at filament center */
      const hr = Math.max(1.2, r * 0.13 * (0.55 + tv * 1.1));
      ctx.globalAlpha = clamp(0.26 + tv * 0.42, 0, 0.72);
      ctx.drawImage(this._dot(this._loud(ci)), -hr, -hr, hr * 2, hr * 2);
      ctx.restore();
    }
    /* starfield — twinkles over the gas */
    for (let i = 0; i < 28; i++) {
      const fx = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
      const fy = ((Math.sin(i * 78.233) * 12543.123) % 1 + 1) % 1;
      const px = fx * w + Math.sin(this.t * 0.18 + i * 1.7) * 18;
      const py = fy * h + Math.cos(this.t * 0.14 + i * 2.3) * 14;
      const a = 0.14 + 0.30 * (0.5 + 0.5 * Math.sin(this.t * 1.1 + i * 1.1));
      const rr = 0.9 + ((i * 7919) % 7) * 0.2;
      ctx.globalAlpha = a;
      ctx.drawImage(this._dot(this._loud(i)), px - rr, py - rr, rr * 2, rr * 2);
    }
    /* a handful of foreground stars with cross glints */
    for (let i = 0; i < 5; i++) {
      const fx = ((Math.sin((i + 41) * 12.9898) * 43758.5453) % 1 + 1) % 1;
      const fy = ((Math.sin((i + 41) * 78.233) * 12543.123) % 1 + 1) % 1;
      const px = fx * w + Math.sin(this.t * 0.11 + i * 2.1) * 9;
      const py = fy * h + Math.cos(this.t * 0.09 + i * 1.6) * 7;
      const sr = 1.3 + (i % 3) * 0.7 + this.beat * 0.5;
      const c = this._vivid(i);
      ctx.globalAlpha = 0.30 + 0.14 * Math.sin(this.t * 1.3 + i);
      ctx.strokeStyle = hexRgba(c, 0.22);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(px - sr * 3.4, py); ctx.lineTo(px + sr * 3.4, py);
      ctx.moveTo(px, py - sr * 3.4); ctx.lineTo(px, py + sr * 3.4);
      ctx.stroke();
      ctx.drawImage(this._dot(c), px - sr, py - sr, sr * 2, sr * 2);
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
    const rot = this.sceneTime * 0.28 - this.beat * 0.08;
    const inner = minDim * 0.03;
    const outer = minDim * 0.44;

    const bg = ctx.createRadialGradient(cx, cy, minDim * 0.02, cx, cy, minDim * 0.72);
    bg.addColorStop(0, this._shadow(this._color(1), 0.18, 5));
    bg.addColorStop(0.55, this._shadow(this._color(0), 0.10, 4));
    bg.addColorStop(1, 'rgba(5,5,7,0)');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    /* dark dust lanes sit under the luminous arms */
    ctx.strokeStyle = 'rgba(4,4,6,0.32)';
    ctx.lineWidth = Math.max(3, minDim * 0.022);
    for (let a = 0; a < arms; a++) {
      const baseAng = (a / arms) * Math.PI * 2;
      const dir = a % 2 ? 1 : -1;
      ctx.beginPath();
      for (let i = 0; i <= PTS; i += 2) {
        const tt = i / PTS;
        const theta = baseAng + 0.34 + tt * 4.6 * dir + rot * (1 - tt * 0.35);
        const r = inner + Math.pow(tt, 1.35) * outer;
        const x = cx + Math.cos(theta) * r;
        const y = cy + Math.sin(theta) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 28; i++) {
      const ang = this.t * (0.05 + (i % 8) * 0.007) * (i % 2 ? 1 : -1) + i * 1.7;
      const r = inner + ((i * 37) % 96) / 96 * (outer * 0.82);
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r * 0.6;
      const rr = 0.8 + (i % 3) * 0.55;
      ctx.globalAlpha = 0.10 + 0.16 * (0.5 + 0.5 * Math.sin(this.t * 1.3 + i));
      ctx.drawImage(this._dot(this._loud(i + 1)), x - rr, y - rr, rr * 2, rr * 2);
    }
    ctx.globalAlpha = 1;

    const coreR = minDim * (0.045 + this.sm.bass * 0.018 + this.beat * 0.012);
    const coreGlow = coreR * (3.4 + this.sm.bass);
    ctx.globalAlpha = 0.16 + this.sm.bass * 0.10;
    ctx.drawImage(this._soft(this._vivid(0)), cx - coreGlow, cy - coreGlow, coreGlow * 2, coreGlow * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const eye = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
    eye.addColorStop(0, 'rgba(4,4,6,0.92)');
    eye.addColorStop(0.62, 'rgba(4,4,6,0.44)');
    eye.addColorStop(1, 'rgba(4,4,6,0)');
    ctx.fillStyle = eye;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexRgba(this._loud(0), 0.52 + this.beat * 0.18);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 0.92, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.58;
    ctx.drawImage(this._dot(this._vivid(1)), cx - coreR * 0.32, cy - coreR * 0.32, coreR * 0.64, coreR * 0.64);
    ctx.globalAlpha = 1;
    for (let a = 0; a < arms; a++) {
      const baseAng = (a / arms) * Math.PI * 2;
      const dir = a % 2 ? 1 : -1;
      const c = this._loud(a);
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
      ctx.strokeStyle = hexRgba(c, 0.08 + this.sm.level * 0.06);
      ctx.lineWidth = Math.max(4, minDim * 0.016 * (1 + this.sm.bass));
      ctx.stroke();
      ctx.strokeStyle = hexRgba(c, 0.26 + this.sm.level * 0.18);
      ctx.lineWidth = Math.max(1.1, minDim * 0.006 * (1 + this.sm.bass));
      ctx.stroke();
      for (let i = 0; i < PTS; i++) {
        const p = pt(i);
        const idx = logFreqIndex(Math.min(PTS, i + a * 7), PTS, freq.length);
        const v = freq[idx] / 255;
        const jitter = Math.sin(i * 12.9898 + this.t * 2.2 + a) * 0.05;
        const spread = ((Math.sin(i * 7.13 + a * 3.3) + Math.cos(i * 3.71)) / 2) * 0.06 * (0.4 + v);
        const x = p.x + Math.cos(p.theta) * jitter * p.r + Math.cos(p.theta + Math.PI / 2) * spread * outer;
        const y = p.y + Math.sin(p.theta) * jitter * p.r + Math.sin(p.theta + Math.PI / 2) * spread * outer;
        /* capped: at max sensitivity an uncapped sprite reaches 27px
           half-size and the arm dissolves into overlapping blobs — structure
           first, glow second */
        const size = Math.min(14, 2.6 + v * 9 * this.sensitivity + (1 - p.tt) * 3.6);
        const sprite = this._dot(this._loud(a + Math.floor(p.tt * 2)));
        ctx.globalAlpha = clamp((0.30 + v * 0.40) * (1 - p.tt * 0.42), 0.14, 0.76);
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
    /* per-second spawn probability: a flat per-frame chance throws 2.4x as
       many satellites at 144Hz as at 60Hz (same complement form as the
       city peak falloff) */
    if (this.beat > 0.72 && this.orbSat.length < 40
        && Math.random() < 1 - Math.pow(1 - 0.55, dt60)) {
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
    /* one ring per hit, not one per frame: at 144Hz the old check pushed a
       new shockwave every 7ms, so the rings read as a solid glowing blob */
    if (this.beat > 0.55 && this.t - (this._orbWaveAt || 0) > 0.22) {
      this._orbWaveAt = this.t;
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
      const ang = (i / P) * Math.PI * 2;
      const rip = freq ? logSample(freq, Math.pow(i / P, 0.55)) : 0;
      const harm1 = Math.sin(ang * 3 + this.t * 1.4) * this.sm.mid * 0.10;
      const harm2 = Math.cos(ang * 5 - this.t * 2.2) * this.sm.high * 0.08;
      const r = baseR * (1 + rip * 0.42 * this.sensitivity + harm1 + harm2 + this.beat * 0.08);
      pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
    }
    /* ground shadow keeps the sphere sitting in the frame */
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.16 + this.beat * 0.06;
    ctx.drawImage(this._soft(this._loud(0)), cx - baseR * 1.9, cy + baseR * 0.94, baseR * 3.8, baseR * 0.52);
    ctx.globalAlpha = 1;

    const glowR = baseR * 1.55;
    const g = ctx.createRadialGradient(cx, cy, baseR * 0.3, cx, cy, glowR);
    g.addColorStop(0, hexRgba(this._vivid(0), 0.07 + this.beat * 0.05));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'lighter';
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
    ctx.globalCompositeOperation = 'source-over';
    const fg = ctx.createRadialGradient(
      cx - baseR * 0.34, cy - baseR * 0.38, baseR * 0.06,
      cx, cy, baseR * 1.18,
    );
    fg.addColorStop(0, this._tint(this._vivid(0), -0.04));
    fg.addColorStop(0.30, this._tint(this._vivid(0), -0.28));
    fg.addColorStop(0.76, this._tint(this._vivid(1), -0.52));
    fg.addColorStop(1, this._shadow(this._loud(0), 0.14, 4));
    ctx.fillStyle = fg;
    ctx.fill();
    ctx.strokeStyle = hexRgba(this._vivid(0), 0.62);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.save();
    ctx.clip();
    ctx.globalAlpha = 0.22 + this.sm.level * 0.10;
    ctx.drawImage(this._soft(this._vivid(1)), cx - baseR * 0.72, cy - baseR * 0.78, baseR * 1.05, baseR * 1.05);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = hexRgba(this._loud(1), 0.10 + this.sm.level * 0.07);
    ctx.lineWidth = 1;
    for (let r = 0; r < 3; r++) {
      ctx.beginPath();
      ctx.ellipse(cx, cy - baseR * 0.12 + r * baseR * 0.24, baseR * 0.84, baseR * 0.17, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = hexRgba(this._loud(0), 0.10);
    for (let r = 0; r < 2; r++) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, baseR * (0.20 + r * 0.24), baseR * 0.92, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexRgba(this._loud(1), 0.14 + this.sm.level * 0.12);
    ctx.lineWidth = 1;
    for (let r = 0; r < 2; r++) {
      const rr = baseR * (1.35 + r * 0.22);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rr, rr * 0.52, this.t * (0.12 + r * 0.07) * (r % 2 ? -1 : 1), 0, Math.PI * 2);
      ctx.stroke();
    }
    const coreR = minDim * (0.013 + this.beat * 0.013 + this.sm.bass * 0.005);
    ctx.globalAlpha = 0.30;
    ctx.drawImage(this._dot(this._vivid(1)), cx - coreR, cy - coreR, coreR * 2, coreR * 2);
    ctx.globalAlpha = 1;
    for (const s of this.orbSat) {
      const x = cx + Math.cos(s.ang) * s.dist;
      const y = cy + Math.sin(s.ang) * s.dist * 0.58;
      const col = this._loud(s.c);
      const sr = 2.8 + s.life * 3.2;
      ctx.globalAlpha = clamp(s.life * 0.78, 0, 0.85);
      ctx.drawImage(this._dot(col), x - sr, y - sr, sr * 2, sr * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- FLUID METAL — metaball membrane ---------------- */

  _fluid(freq, dt) {
    const { ctx, w, h } = this;
    /* dt in seconds for the droplet ballistics below; the render loop
       passes real frame time, tests pass 16ms-style values, and a missing
       argument falls back to one 60Hz step rather than freezing motion */
    const dt60 = Number.isFinite(dt) && dt > 0 ? dt * 60 : 1;
    /* Was nine blobs orbiting the centre of the frame, linked by straight
       strokes and ringed by an ellipse — a wireframe network, and the tenth
       mode in this file to put a symmetric cluster in the middle. Metal does
       not read by glow, it reads by a specular highlight running along a
       surface, so this is a molten pour: a liquid mass with a wave-driven
       surface, a hot crest, and droplets thrown off on beats. */
    const surfaceY = h * 0.62;
    const amp = Math.min(h * 0.16, h * (0.045 + this.sm.bass * 0.11 + this.beat * 0.05));
    const cols = this.quality === 'low' ? 48 : 128;
    const step = w / cols;

    /* the surface: three drifting waves, each scaled by its own band, so the
       shape of the metal follows the shape of the music */
    const surf = new Float32Array(cols + 1);
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const v = freq ? logSample(freq, u) : 0.4;
      /* Subtracting the spectrum per column cut sharp V notches into the
         surface and the high harmonic added spikes, which together read as
         a mountain range — and Aurora Terrain is already that mode. A liquid
         has no corners: the bands drive broad, rounded swells instead, and
         the per-column energy is smoothed across neighbours. */
      surf[i] = surfaceY
        + Math.sin(u * 3.4 + this.t * 0.62) * amp
        + Math.sin(u * 7.9 - this.t * 0.95) * amp * 0.46 * (0.4 + this.sm.mid)
        + Math.sin(u * 12.6 + this.t * 1.35) * amp * 0.20 * (0.3 + this.sm.high)
        - v * amp * 0.34 * this.sensitivity;
    }

    /* one box-blur pass along the surface: a single loud bin should bulge
       the metal, never crease it */
    const smoothed = new Float32Array(cols + 1);
    for (let i = 0; i <= cols; i++) {
      const a = surf[Math.max(0, i - 1)], b = surf[i], c = surf[Math.min(cols, i + 1)];
      smoothed[i] = (a + b * 2 + c) / 4;
    }
    surf.set(smoothed);

    /* the furnace behind the pour lights the far edge of the liquid */
    ctx.globalCompositeOperation = 'lighter';
    const furnaceR = Math.min(w, h) * (0.36 + this.sm.level * 0.12);
    ctx.globalAlpha = 0.05 + this.sm.bass * 0.055;
    ctx.drawImage(this._soft(this._vivid(0)), w / 2 - furnaceR, surfaceY - furnaceR * 0.72, furnaceR * 2, furnaceR * 1.2);
    ctx.globalAlpha = 1;

    /* the mass below the surface — source-over, so it is an opaque body with
       real value contrast rather than one more additive glow */
    ctx.globalCompositeOperation = 'source-over';
    const body = ctx.createLinearGradient(0, surfaceY - amp * 1.6, 0, h);
    body.addColorStop(0, this._tint(this._vivid(0), 0.02));
    body.addColorStop(0.22, this._tint(this._vivid(0), -0.24));
    body.addColorStop(0.68, this._tint(this._vivid(1), -0.40));
    body.addColorStop(1, this._shadow(this._vivid(1), 0.18, 3));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, surf[0]);
    for (let i = 1; i <= cols; i++) ctx.lineTo(i * step, surf[i]);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    /* a soft shadow under the crest gives the surface thickness */
    ctx.beginPath();
    ctx.moveTo(0, surf[0] + 7);
    for (let i = 1; i <= cols; i += 2) ctx.lineTo(i * step, surf[i] + 7);
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.globalCompositeOperation = 'lighter';

    /* wide crest bloom first, then the hard specular glints on top */
    ctx.beginPath();
    ctx.moveTo(0, surf[0]);
    for (let i = 1; i <= cols; i++) ctx.lineTo(i * step, surf[i]);
    ctx.strokeStyle = hexRgba(this._vivid(0), 0.08 + this.sm.level * 0.05);
    ctx.lineWidth = 5;
    ctx.stroke();

    /* specular crest: brightest where the surface is flattest, which is what
       makes a liquid read as metal rather than as a coloured shape */
    for (let i = 1; i < cols; i++) {
      const slope = Math.abs(surf[i + 1] - surf[i - 1]) / (step * 2);
      const flat = clamp(1 - slope * 2.4, 0, 1);
      if (flat <= 0.02) continue;
      ctx.strokeStyle = hexRgba(this._vivid(0), clamp(flat * (0.24 + this.sm.level * 0.26), 0, 0.58));
      ctx.lineWidth = 1 + flat * 2.2;
      ctx.beginPath();
      ctx.moveTo((i - 1) * step, surf[i - 1]);
      ctx.lineTo((i + 1) * step, surf[i + 1]);
      ctx.stroke();
      if (flat > 0.55) {
        ctx.strokeStyle = hexRgba(this._vivid(1), clamp(flat * (0.14 + this.sm.high * 0.18), 0, 0.38));
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo((i - 1) * step, surf[i - 1] - 0.6);
        ctx.lineTo((i + 1) * step, surf[i + 1] - 0.6);
        ctx.stroke();
      }
    }

    /* a soft sheen sitting on the metal, drifting out of step with the waves */
    const sheenX = w * (0.5 + 0.34 * Math.sin(this.t * 0.21));
    const sheenR = Math.min(w, h) * (0.26 + this.sm.level * 0.10);
    ctx.globalAlpha = 0.10 + this.sm.level * 0.10;
    ctx.drawImage(this._soft(this._vivid(1)), sheenX - sheenR, surfaceY - sheenR * 0.7, sheenR * 2, sheenR * 1.05);

    /* droplets thrown off the crest on beats, falling back under gravity.
       Spawn probability is per-second, not per-frame: gating on the beat
       alone threw 2.4x as many droplets at 144Hz as at 60Hz. */
    this.fluidDrops ||= [];
    if (this.beat > 0.5 && this.fluidDrops.length < 30
        && Math.random() < Math.min(1, dt60)) {
      const n = 1 + Math.round(this.beat * 2);
      for (let k = 0; k < n; k++) {
        const i = Math.floor(Math.random() * cols);
        this.fluidDrops.push({
          x: i * step,
          y: surf[i],
          vx: (Math.random() - 0.5) * w * 0.06,
          vy: -h * (0.20 + Math.random() * 0.28) * (0.6 + this.beat * 0.6),
          r: Math.min(w, h) * (0.008 + Math.random() * 0.014),
          c: Math.random() < 0.5 ? 0 : 2,
        });
      }
    }
    const g = h * 1.15;
    for (let k = this.fluidDrops.length - 1; k >= 0; k--) {
      const d = this.fluidDrops[k];
      /* fixed-step ballistics scaled by frame time: the 0.016 below is one
         60Hz step, so motion matches at any refresh rate */
      const ox = d.x, oy = d.y;
      d.vy += g * 0.016 * dt60;
      d.x += d.vx * 0.016 * dt60;
      d.y += d.vy * 0.016 * dt60;
      const si = clamp(Math.round(d.x / step), 0, cols);
      if (d.y >= surf[si] || d.x < -20 || d.x > w + 20) { this.fluidDrops.splice(k, 1); continue; }
      ctx.strokeStyle = hexRgba(this._loud(d.c), 0.20);
      ctx.lineWidth = Math.max(1, d.r * 0.8);
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
      ctx.globalAlpha = 0.50;
      ctx.drawImage(this._dot(this._loud(d.c)), d.x - d.r, d.y - d.r, d.r * 2, d.r * 2);
    }

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
    if (this.beat > 0.6 && this.t - (this._tensorWaveAt || 0) > 0.28) {
      this._tensorWaveAt = this.t;
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
    /* the vanishing point is the light source for the whole lattice */
    const vpY = rowY(0);
    const vpR = Math.min(w, h) * (0.32 + this.sm.bass * 0.06);
    ctx.globalAlpha = 0.07 + this.sm.level * 0.055 + this.beat * 0.02;
    ctx.drawImage(this._soft(this._vivid(0)), w / 2 - vpR, vpY - vpR * 0.55, vpR * 2, vpR * 1.1);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = hexRgba(this._vivid(0), 0.22 + this.beat * 0.12);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w * 0.08, vpY); ctx.lineTo(w * 0.92, vpY);
    ctx.stroke();

    /* horizontal wires with frequency displacement */
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath();
      for (let x = 0; x <= cols; x++) {
        const u = Math.pow(x / cols, 0.62);
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
      if (y % 3 === 0) {
        ctx.strokeStyle = hexRgba(this._loud(y), 0.035 + depth * 0.04);
        ctx.lineWidth = 3.5;
        ctx.stroke();
      }
      ctx.strokeStyle = hexRgba(this._loud(y), 0.13 + depth * 0.20);
      ctx.lineWidth = 0.7 + depth * 0.9;
      ctx.stroke();
    }
    /* vertical struts */
    for (let x = 0; x <= cols; x++) {
      ctx.beginPath();
      for (let y = 0; y <= rows; y++) {
        const u = Math.pow(x / cols, 0.62);
        const v = freq ? logSample(freq, Math.min(1, u * 0.7 + (y / rows) * 0.3)) : 0;
        const px = x * cw;
        const py = rowY(y);
        const off = Math.sin(u * 6 + this.t * 1.4 + y * 0.22) * v * 26 * this.sensitivity;
        const pull = (px - w / 2) * (1 - spread(y));
        if (y === 0) ctx.moveTo(px + pull, py + off);
        else ctx.lineTo(px + pull, py + off);
      }
      ctx.strokeStyle = hexRgba(this._loud(x), 0.10);
      ctx.lineWidth = 1.0;
      ctx.stroke();
    }

    /* a few data packets travel the near wires */
    for (let k = 0; k < 7; k++) {
      const gy = 3 + ((k * 3) % Math.max(1, rows - 5));
      const u = (this.t * (0.07 + k * 0.008) + k * 0.159) % 1;
      const v = freq ? logSample(freq, u) : 0.4;
      const px = u * w;
      const py = rowY(gy) + Math.sin(u * 6 + this.t * 1.4 + gy * 0.22) * v * 26 * this.sensitivity;
      const pull = (px - w / 2) * (1 - spread(gy));
      const c = this._loud(k + 1);
      const pr = 2 + v * 3.4 + this.beat * 1.1;
      ctx.strokeStyle = hexRgba(c, 0.16 + v * 0.2);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + pull - pr * 4, py);
      ctx.lineTo(px + pull - pr, py);
      ctx.stroke();
      ctx.globalAlpha = 0.38 + v * 0.34;
      ctx.drawImage(this._dot(c), px + pull - pr, py - pr, pr * 2, pr * 2);
    }
    ctx.globalAlpha = 1;

    /* node lattice — always on, amplitude-lit */
    const nodeR = 1.5 + this.sm.level * 2.0;
    for (let gy = 1; gy < rows; gy++) {
      for (let gx = 1; gx < cols; gx++) {
        const u = gx / cols;
        const v = freq ? logSample(freq, u * ((gy % 3) + 1) / 3) : 0.2;
        const px = gx * cw;
        const py = rowY(gy);
        const off = Math.sin(u * 6 + this.t * 1.4 + gy * 0.22) * v * 26 * this.sensitivity;
        const pull = (px - w / 2) * (1 - spread(gy));
        const a = clamp(0.06 + v * 0.32 + this.beat * v * 0.30, 0, 0.54);
        const r = nodeR + v * 2.3 + this.beat * 1.1;
        ctx.globalAlpha = a;
        ctx.drawImage(this._dot(this._loud(gx + gy)), px + pull - r, py + off - r, r * 2, r * 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const feet = ctx.createLinearGradient(0, h * 0.86, 0, h);
    feet.addColorStop(0, 'rgba(4,4,6,0)');
    feet.addColorStop(1, 'rgba(4,4,6,0.62)');
    ctx.fillStyle = feet;
    ctx.fillRect(0, h * 0.86, w, h * 0.14);
  }

  /* ---------------- PRISM RAY — dispersion ---------------- */

  _prism(freq) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h * 0.58;
    const sz = Math.min(w, h) * 0.25;
    const ax = cx, ay = cy - sz;
    const bx = cx - sz * 0.86, by = cy + sz * 0.5;
    const qx = cx + sz * 0.86, qy = cy + sz * 0.5;

    ctx.globalCompositeOperation = 'lighter';
    const ambR = Math.min(w, h) * (0.34 + this.sm.level * 0.06);
    ctx.globalAlpha = 0.055 + this.sm.bass * 0.055 + this.beat * 0.02;
    ctx.drawImage(this._soft(this._vivid(0)), cx - ambR, cy - ambR * 0.8, ambR * 2, ambR * 1.6);
    ctx.globalAlpha = 1;

    /* glass slab fill, drawn as a solid object rather than more glow */
    ctx.globalCompositeOperation = 'source-over';
    const ig = ctx.createLinearGradient(0, ay, 0, by);
    ig.addColorStop(0, hexRgba(this._vivid(0), 0.34 + this.sm.bass * 0.20));
    ig.addColorStop(0.55, hexRgba(this._loud(0), 0.18));
    ig.addColorStop(1, hexRgba(this._loud(0), 0.08));
    ctx.fillStyle = ig;
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(qx, qy);
    ctx.closePath();
    ctx.fill();

    /* second face offset — extra-triangular echo for volume */
    ctx.globalAlpha = 0.50;
    ctx.fillStyle = hexRgba(this._vivid(1), 0.14 + this.sm.mid * 0.16);
    ctx.beginPath();
    ctx.moveTo(ax, ay + sz * 0.08); ctx.lineTo(bx - sz * 0.05, by); ctx.lineTo(qx + sz * 0.05, qy);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    /* incoming beam from top */
    ctx.globalCompositeOperation = 'lighter';
    const inLen = h * 0.34;
    const inGrad = ctx.createLinearGradient(ax, ay - inLen, ax, ay);
    inGrad.addColorStop(0, hexRgba(this._vivid(0), 0));
    inGrad.addColorStop(1, hexRgba(this._vivid(0), 0.55 + this.sm.level * 0.25));
    ctx.strokeStyle = inGrad;
    ctx.lineWidth = 2.2 + this.sm.level * 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay - inLen);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    /* beam glint where it enters the glass */
    const br = 2.6 + this.sm.mid * 4;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this._dot(this._vivid(1)), ax - br, ay - br, br * 2, br * 2);
    ctx.globalAlpha = 1;

    /* frame — bright edges, hazy on loud */
    ctx.strokeStyle = hexRgba(this._vivid(0), 0.20 + this.sm.level * 0.16);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(ax + 3, ay); ctx.lineTo(bx + 3, by); ctx.lineTo(qx + 3, qy);
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = hexRgba(this._loud(0), 0.80);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(qx, qy);
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
      const col = this._loud(i);
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
      ctx.drawImage(this._dot(this._vivid(0)), gx - glintR, gy - glintR, glintR * 2, glintR * 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = hexRgba(this._vivid(1), this.beat * 0.7);
      for (let i = 0; i < 8; i++) {
        const sx = cx + (Math.sin(i * 91.7 + this.t * 3) * sz * 0.9);
        const sy = cy + sz * 0.5 + this.beat * 7 + ((i % 3) * 6);
        ctx.fillRect(sx, sy, 2, 2);
      }
    }

    /* reflected triangle and caustic pool give the glass a floor to stand on */
    ctx.globalCompositeOperation = 'source-over';
    const poolY = by + sz * 1.55;
    ctx.globalAlpha = 0.18 + this.sm.bass * 0.12;
    ctx.drawImage(this._soft(this._vivid(0)), cx - sz * 1.15, poolY - sz * 0.20, sz * 2.3, sz * 0.40);
    ctx.globalAlpha = 1;
    const ref = ctx.createLinearGradient(0, by, 0, poolY);
    ref.addColorStop(0, hexRgba(this._vivid(0), 0.16));
    ref.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ref;
    ctx.beginPath();
    ctx.moveTo(ax, by + (by - ay));
    ctx.lineTo(bx, by);
    ctx.lineTo(qx, qy);
    ctx.closePath();
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 10; i++) {
      const u = ((i * 0.137 + this.t * 0.03) % 1);
      const px = ax + Math.sin(i * 2.3 + this.t * 1.2) * sz * 0.10;
      const py = ay - inLen + u * inLen;
      const rr = 0.8 + (i % 3) * 0.6 + this.beat * 0.5;
      ctx.globalAlpha = 0.18 + 0.22 * (1 - u);
      ctx.drawImage(this._dot(this._vivid(1)), px - rr, py - rr, rr * 2, rr * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- BLACK HOLE VOID ---------------- */

  _void(freq) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h / 2;
    const drop = this.beatInfo?.drop || 0;
    /* the horizon tightens as the drop lands — collapse, not just throb */
    const base = Math.min(w, h) * 0.11 * (1 + this.sm.bass * 0.3 - drop * 0.18);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < 44; i++) {
      const fx = ((Math.sin(i * 12.9898 + 3.1) * 43758.5453) % 1 + 1) % 1;
      const fy = ((Math.sin(i * 78.233 + 1.7) * 12543.123) % 1 + 1) % 1;
      const px = fx * w;
      const py = fy * h;
      const sr = 0.7 + (i % 4) * 0.35;
      ctx.globalAlpha = 0.10 + 0.22 * (0.5 + 0.5 * Math.sin(this.t * 0.9 + i * 1.3));
      ctx.drawImage(this._dot(this._loud(i)), px - sr, py - sr, sr * 2, sr * 2);
    }
    const lensR = base * (5.2 + this.sm.bass * 0.8);
    ctx.globalAlpha = 0.06 + this.sm.bass * 0.05;
    ctx.drawImage(this._soft(this._vivid(0)), cx - lensR, cy - lensR, lensR * 2, lensR * 2);
    ctx.globalAlpha = 1;

    const rings = this.quality === 'low' ? 22 : 36;
    for (let i = 0; i < rings; i++) {
      const t = i / rings;
      const r = base * 1.7 + Math.pow(t, 1.2) * Math.min(w, h) * 0.38;
      const v = freq ? logSample(freq, t) : 0.5;
      /* treble warps the rings — hats ripple the horizon where bass only
         breathes it. This is the one mode where high-band energy bends
         geometry instead of just lighting it. */
      const wob = Math.sin(t * 18 + this.t * 2.2) * v * (6 + this.sm.high * 10);
      /* 36 rings drawn additively, and the radius curve packs them tightest
         near the core — so the inner rings piled on top of each other and
         burned out the centre. Fade the alpha in toward the middle, where
         the crowding is, instead of paying it flat across every ring. */
      const crowd = 0.45 + 0.55 * Math.min(1, t * 2.2);
      ctx.strokeStyle = hexRgba(this._loud(Math.floor(t * 4)), (0.22 + v * 0.34) * crowd);
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
    ctx.strokeStyle = hexRgba(this._loud(0), 0.72 + this.beat * 0.2 + drop * 0.12);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(cx, cy, base * 1.02, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexRgba(this._vivid(0), 0.22 + this.sm.level * 0.18);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, base * 1.32, base * 0.46, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = hexRgba(this._vivid(0), 0.30 + this.beat * 0.20);
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(cx, cy, base * 1.06, -0.6 + this.t * 0.2, 0.7 + this.t * 0.2);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- BLOOM FIELD MESH ---------------- */

  _bloomField(freq) {
    const { ctx, w, h } = this;
    const drop = this.beatInfo?.drop || 0;
    const cols = this.quality === 'low' ? 10 : 16;
    const rows = this.quality === 'low' ? 6 : 9;
    const cw = w / cols;
    const rh = h / rows;

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, 'rgba(4,4,6,0.58)');
    bg.addColorStop(0.52, this._shadow(this._color(0), 0.09, 4));
    bg.addColorStop(1, 'rgba(4,4,6,0.34)');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    const ambR = Math.min(w, h) * (0.42 + this.sm.level * 0.07);
    ctx.globalAlpha = 0.045 + this.sm.bass * 0.05;
    ctx.drawImage(this._soft(this._vivid(0)), w / 2 - ambR, h / 2 - ambR * 0.7, ambR * 2, ambR * 1.4);
    ctx.globalAlpha = 1;

    if (this.quality !== 'low') {
      ctx.globalCompositeOperation = 'lighter';
      const meshA = 0.032 + this.sm.level * 0.035 + drop * 0.02;
      /* Spread the grid across the whole spectrum instead of cycling the
         same 64 positions every few cells: the field then shows real
         spectral structure rather than 144 cells all lit the same. */
      const dotAt = (x, y) => (freq ? logSample(freq, (y * cols + x) / (cols * rows - 1)) : 0.5);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const a1 = dotAt(x, y);
          const cx1 = x * cw + cw / 2;
          const cy1 = y * rh + rh / 2;
          const rowDepth = 0.55 + (y / Math.max(1, rows - 1)) * 0.65;
          if (x < cols - 1) {
            const a2 = dotAt(x + 1, y);
            ctx.strokeStyle = hexRgba(this._loud(x), meshA * (a1 + a2) * rowDepth);
            ctx.lineWidth = 0.8 + rowDepth * 0.4;
            ctx.beginPath();
            ctx.moveTo(cx1, cy1);
            ctx.lineTo((x + 1) * cw + cw / 2, cy1);
            ctx.stroke();
          }
          if (y < rows - 1) {
            const a2 = dotAt(x, y + 1);
            ctx.strokeStyle = hexRgba(this._loud(x + 1), meshA * (a1 + a2) * rowDepth);
            ctx.lineWidth = 0.8 + rowDepth * 0.4;
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
        const rowDepth = 0.58 + (y / Math.max(1, rows - 1)) * 0.72;
        const px = x * cw + cw / 2 + Math.sin(this.t * 0.6 + idx) * 4 * rowDepth;
        const py = y * rh + rh / 2 + Math.cos(this.t * 0.5 + idx * 1.3) * 4 * rowDepth;
        const cell = Math.min(cw, rh) * rowDepth;
        const s = Math.min(cell * 1.18, (7 + amp * 20 * this.sensitivity + this.beat * 5 + drop * 8) * rowDepth);
        const c = this._loud(x + y * 2 + Math.floor(this.t * 0.04));
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.018 + amp * 0.036 * rowDepth;
        ctx.drawImage(this._soft(c), px - s * 1.12, py - s * 1.12, s * 2.24, s * 2.24);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.12 + amp * 0.26 * rowDepth;
        ctx.drawImage(this._dot(c), px - s * 0.82, py - s * 0.82, s * 1.64, s * 1.64);
        if (amp > 0.62 - this.beat * 0.12) {
          const hr = s * 0.28;
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = Math.max(0.05, (amp - 0.6) * 0.9) * rowDepth;
          ctx.drawImage(this._soft(this._vivid(x + y + 1)), px - hr, py - hr, hr * 2, hr * 2);
          ctx.globalAlpha = 1;
        }
      }
    }

    /* out-of-focus foreground bokeh gives the field a near plane */
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const bx = (0.08 + 0.84 * ((i * 0.618 + 0.11) % 1)) * w;
      const by = h * (0.52 + 0.42 * ((i * 0.37 + 0.19) % 1));
      const br = Math.min(w, h) * (0.05 + (i % 3) * 0.025 + this.sm.level * 0.02);
      ctx.globalAlpha = 0.022 + this.sm.level * 0.018;
      ctx.drawImage(this._soft(this._vivid(2 - (i % 2))), bx - br, by - br, br * 2, br * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const foot = ctx.createLinearGradient(0, h * 0.9, 0, h);
    foot.addColorStop(0, 'rgba(4,4,6,0)');
    foot.addColorStop(1, 'rgba(4,4,6,0.45)');
    ctx.fillStyle = foot;
    ctx.fillRect(0, h * 0.9, w, h * 0.1);
  }

  _fractal(freq) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h / 2;
    const minDim = Math.min(w, h);
    const drop = this.beatInfo?.drop || 0;
    const base = minDim * 0.12;
    const depth = this.quality === 'low' ? 4 : 6;

    ctx.globalCompositeOperation = 'lighter';
    const ambR = minDim * (0.34 + this.sm.level * 0.08);
    ctx.globalAlpha = 0.045 + this.sm.bass * 0.05 + this.beat * 0.02;
    ctx.drawImage(this._soft(this._vivid(0)), cx - ambR, cy - ambR, ambR * 2, ambR * 2);
    ctx.globalAlpha = 1;
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2 - this.t * 0.04;
      const rr = minDim * (0.30 + ((i * 41) % 17) / 40);
      const sr = 0.8 + (i % 3) * 0.5;
      ctx.globalAlpha = 0.06 + 0.08 * (0.5 + 0.5 * Math.sin(this.t * 0.8 + i * 1.7));
      ctx.drawImage(this._dot(this._loud(i)),
        cx + Math.cos(ang) * rr - sr, cy + Math.sin(ang) * rr - sr, sr * 2, sr * 2);
    }
    ctx.globalAlpha = 1;

    const drawBranch = (x, y, len, ang, d, colIdx) => {
      if (d <= 0) return;
      const v = freq ? logSample(freq, (d / depth)) : 0.5;
      const nx = x + Math.cos(ang) * len * (0.7 + v * 0.6);
      const ny = y + Math.sin(ang) * len * (0.7 + v * 0.6);
      const c = this._loud(colIdx);
      if (d > 2) {
        ctx.strokeStyle = hexRgba(c, 0.035 + v * 0.045);
        ctx.lineWidth = Math.max(3, d * 2.6);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(nx, ny);
        ctx.stroke();
      }
      ctx.strokeStyle = hexRgba(c, 0.16 + v * 0.26);
      ctx.lineWidth = Math.max(0.8, d * 1.05);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      if (d === 1) {
        const br = 1.4 + v * 2.4 + this.beat * 0.9;
        ctx.globalAlpha = 0.28 + v * 0.30;
        ctx.drawImage(this._dot(this._vivid(colIdx + 2)), nx - br, ny - br, br * 2, br * 2);
        ctx.globalAlpha = 1;
      }
      const spread = 0.55 + this.sm.bass * 0.3 + drop * 0.35;
      drawBranch(nx, ny, len * 0.68, ang - spread, d - 1, colIdx + 1);
      drawBranch(nx, ny, len * 0.68, ang + spread, d - 1, colIdx + 2);
    };
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < (this.quality === 'low' ? 3 : 5); i++) {
      // Treble flexes each branch without skipping its accumulated rotation.
      const ang = (i / 5) * Math.PI * 2 + this.sceneTime * 0.3 + this.sm.high * 0.12;
      drawBranch(cx, cy, base, ang, depth, i);
    }

    ctx.globalCompositeOperation = 'source-over';
    const eyeR = base * (0.22 + this.beat * 0.06);
    const eye = ctx.createRadialGradient(cx, cy, 0, cx, cy, eyeR);
    eye.addColorStop(0, 'rgba(4,4,6,0.88)');
    eye.addColorStop(0.62, 'rgba(4,4,6,0.36)');
    eye.addColorStop(1, 'rgba(4,4,6,0)');
    ctx.fillStyle = eye;
    ctx.beginPath();
    ctx.arc(cx, cy, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexRgba(this._loud(0), 0.40 + this.beat * 0.18);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, eyeR * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    const cr = base * (0.09 + this.beat * 0.05 + drop * 0.04);
    ctx.globalAlpha = 0.44;
    ctx.drawImage(this._dot(this._vivid(0)), cx - cr, cy - cr, cr * 2, cr * 2);
    ctx.globalAlpha = 1;

    for (let i = 0; i < 14; i++) {
      const px = ((i * 0.618 + 0.21) % 1) * w + Math.sin(this.t * 0.3 + i) * 5;
      const py = ((i * 0.37 + 0.14) % 1) * h + Math.cos(this.t * 0.25 + i) * 5;
      const pr = 0.8 + (i % 3) * 0.55 + this.beat * 0.4;
      ctx.globalAlpha = 0.08 + 0.10 * (0.5 + 0.5 * Math.sin(this.t * 0.9 + i * 1.4));
      ctx.drawImage(this._soft(this._vivid(2 - (i % 2))), px - pr, py - pr, pr * 2, pr * 2);
    }
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

    /* range rings + graticule + bezel/ticks are static for a given size and
       theme; cache them instead of restroking ~35 paths every frame */
    const baseKey = `${w}x${h}|${this.theme.id}|${this.quality}`;
    if (!this._radarBase || this._radarKey !== baseKey) {
      this._radarKey = baseKey;
      const cv = document.createElement('canvas');
      cv.width = Math.max(2, Math.round(w));
      cv.height = Math.max(2, Math.round(h));
      const rc = cv.getContext('2d');
      const bez = rc.createRadialGradient(cx, cy, R * 0.12, cx, cy, R * 1.22);
      bez.addColorStop(0, 'rgba(4,5,7,0)');
      bez.addColorStop(0.72, 'rgba(4,5,7,0.10)');
      bez.addColorStop(0.90, 'rgba(4,5,7,0.38)');
      bez.addColorStop(1, 'rgba(4,5,7,0)');
      rc.fillStyle = bez;
      rc.fillRect(0, 0, cv.width, cv.height);
      rc.globalCompositeOperation = 'lighter';
      rc.strokeStyle = hexRgba(this._color(0), 0.16);
      rc.lineWidth = 1;
      for (let i = 1; i <= 4; i++) {
        rc.beginPath();
        rc.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2);
        rc.stroke();
      }
      rc.beginPath();
      rc.moveTo(cx - R, cy); rc.lineTo(cx + R, cy);
      rc.moveTo(cx, cy - R); rc.lineTo(cx, cy + R);
      rc.stroke();
      rc.fillStyle = hexRgba(this._color(2), 0.30);
      for (let ring = 1; ring <= 4; ring++) {
        const rr = (R * ring) / 4;
        for (let a = 0; a < 12; a++) {
          const ang = (a / 12) * Math.PI * 2;
          rc.fillRect(cx + Math.cos(ang) * rr - 0.8, cy + Math.sin(ang) * rr - 0.8, 1.6, 1.6);
        }
      }
      rc.strokeStyle = hexRgba(this._color(2), 0.16);
      rc.beginPath();
      rc.arc(cx, cy, R + 6, 0, Math.PI * 2);
      rc.stroke();
      rc.strokeStyle = hexRgba(this._color(2), 0.38);
      for (let i = 0; i < 24; i++) {
        const ang = (i / 24) * Math.PI * 2;
        rc.beginPath();
        rc.moveTo(cx + Math.cos(ang) * (R + 2), cy + Math.sin(ang) * (R + 2));
        rc.lineTo(cx + Math.cos(ang) * (R + 7), cy + Math.sin(ang) * (R + 7));
        rc.stroke();
      }
      this._radarBase = cv;
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.10 + this.sm.bass * 0.06;
    ctx.drawImage(this._soft(this._vivid(0)), cx - R * 1.2, cy + R * 0.92, R * 2.4, R * 0.38);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this._radarBase, 0, 0);
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
    wg.addColorStop(0, hexRgba(this._vivid(0), 0.10 + this.sm.level * 0.15));
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

    /* blips: beat drops a heavy contact, spectrum seeds lighter ones.
       The ambient spawn chance is per-second, not per-frame, so high
       refresh rates do not fill the scope faster. */
    if (this.beat > 0.55 && this.radarBlips.length < 48 && this.t - (this._radarBeatAt || 0) > 0.18) {
      this._radarBeatAt = this.t;
      this.radarBlips.push({
        ang: this._sweepAng,
        dist: R * (0.25 + this.sm.bass * 0.6),
        life: 1,
        decay: 0.22 + Math.random() * 0.12,
        c: 0,
        big: true,
      });
    }
    const blipP = 0.35 + this.sm.level * 0.5;
    const dt60 = Number.isFinite(dt) && dt > 0 ? dt * 60 : 1;
    if (freq && this.radarBlips.length < 64
        && Math.random() < 1 - Math.pow(1 - blipP, dt60)) {
      const u = Math.random();
      this.radarBlips.push({
        ang: this._sweepAng - Math.random() * Math.PI * 1.15,
        dist: R * (0.18 + u * 0.74),
        life: 1,
        decay: 0.1 + logSample(freq, u) * 0.12,
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
      const r = (b.big ? 4.5 : 2.8) + b.life * (b.big ? 6 : 3.6);
      const bc = this._color(b.c);
      ctx.globalAlpha = clamp(b.life, 0, 1) * (b.big ? 0.14 : 0.08);
      ctx.drawImage(this._soft(bc), x - r * 2.5, y - r * 2.5, r * 5, r * 5);
      ctx.globalAlpha = clamp(b.life, 0, 1) * (b.big ? 0.74 : 0.42);
      ctx.drawImage(this._dot(bc), x - r, y - r, r * 2, r * 2);
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

    /* center core: dark hub, lit ring, small hot seed */
    ctx.globalCompositeOperation = 'source-over';
    const coreR = minDim * (0.020 + this.sm.bass * 0.012 + this.beat * 0.010);
    const hub = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.4);
    hub.addColorStop(0, 'rgba(4,5,7,0.90)');
    hub.addColorStop(0.55, 'rgba(4,5,7,0.38)');
    hub.addColorStop(1, 'rgba(4,5,7,0)');
    ctx.fillStyle = hub;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexRgba(this._vivid(0), 0.46 + this.beat * 0.18);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.50;
    ctx.drawImage(this._dot(this._vivid(1)), cx - coreR * 0.34, cy - coreR * 0.34, coreR * 0.68, coreR * 0.68);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- LAVA LAMP ---------------- */

  _lava(freq, dt, _dt60) {
    const { ctx, w, h } = this;
    const N = this.quality === 'low' ? 5 : 7;
    /* A lava lamp is a tall column, not a field. Blobs were scattered across
       the full width and only ever rose — which reads as drifting bokeh, not
       as convection. They now live in a centre column and carry a heat value
       that drives a real rise-and-fall cycle. */
    const colW = Math.min(w * 0.52, h * 0.72);
    const colX = w / 2;
    if (!this.lavaBlobs || this.lavaBlobs.length !== N) {
      this.lavaBlobs = Array.from({ length: N }, (_, i) => ({
        /* Spread has to beat the blob radius or the lumps overlap into one
           column-wide mass at every size and every signal — which on a pale
           palette then saturates to a white slab. Wider spread, smaller
           lumps: they still meet and merge, they just stop being one shape. */
        u: (((i * 61) % 100) / 100 - 0.5) * 0.86,   // -0.43..0.43 across the column
        r: 0.095 + ((i * 37) % 40) / 430,
        ph: (i * 2.399) % 6.283,
        wob: 0.4 + ((i * 29) % 30) / 50,
        /* One lamp, one wax. Cycling four theme colours through the blobs
           made every frame look like a bag of marbles; the heat of the blob
           carries the variation instead. */
        c: i % 2,
        /* spread the starting phases so the column is populated top to
           bottom from the first frame, and vary the periods so the blobs
           never fall into step with each other */
        phase: (i * 0.3819) % 1,
        speed: 0.055 + ((i * 23) % 17) / 260,
        y: 0,
        heat: 0.5,
      }));
    }

    const warmth = 0.5 + this.sm.bass * 1.1 + this.beat * 0.35;

    /* the lamp itself: a soft heated column, a base plate and glass edges */
    ctx.globalCompositeOperation = 'source-over';
    const seat = ctx.createRadialGradient(colX, h * 0.62, 0, colX, h * 0.62, colW * 0.95);
    seat.addColorStop(0, this._shadow(this._color(1), 0.16, 6));
    seat.addColorStop(0.62, this._shadow(this._color(0), 0.10, 4));
    seat.addColorStop(1, 'rgba(4,4,6,0)');
    ctx.fillStyle = seat;
    ctx.fillRect(colX - colW * 0.95, h * 0.12, colW * 1.9, h * 0.88);
    ctx.fillStyle = this._shadow(this._color(0), 0.14, 4);
    ctx.beginPath();
    ctx.ellipse(colX, h * 0.955, colW * 0.58, h * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexRgba(this._color(1), 0.20 + this.sm.bass * 0.10);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(colX, h * 0.955, colW * 0.58, h * 0.035, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalCompositeOperation = 'lighter';

    /* the lamp's heat source: a pool at the base, brightest on bass */
    const pool = ctx.createLinearGradient(0, h * 0.70, 0, h);
    pool.addColorStop(0, 'rgba(0,0,0,0)');
    pool.addColorStop(1, hexRgba(this._vivid(0), 0.10 + this.sm.bass * 0.18));
    ctx.fillStyle = pool;
    ctx.fillRect(colX - colW * 0.72, h * 0.70, colW * 1.44, h * 0.30);

    /* --- convection ---
       Modelling this as emergent heat exchange looked right on paper and
       piled every blob against the top and bottom in practice, because the
       thermal time constant and the rise speed have to be tuned against each
       other to keep the column populated. An explicit cycle per blob is the
       controllable version: each one climbs and sinks on its own period, and
       easing the ends gives the hang-and-turn that reads as viscous. */
    const pts = [];
    for (const b of this.lavaBlobs) {
      b.phase += dt * b.speed * (0.55 + warmth * 0.5);
      const cyc = b.phase % 1;
      // triangle wave, eased at both turns: slow at the top and bottom
      const tri = cyc < 0.5 ? cyc * 2 : (1 - cyc) * 2;
      /* Full smoothstep is what a real lamp does and it looks wrong here:
         easing slows the blob at both turns, so it spends most of its cycle
         parked at the top or the bottom and the middle of the column empties
         out. Mostly linear travel with a touch of ease keeps the column
         populated and still gives the hang at the turn. */
      const smooth = tri * tri * (3 - 2 * tri);
      const eased = tri * 0.72 + smooth * 0.28;
      b.y = 0.92 - eased * 0.82;
      const rising = cyc < 0.5;
      b.heat = rising ? 0.45 + eased * 0.55 : 0.45 - (1 - eased) * 0.30;

      const sway = Math.sin(this.t * b.wob * 0.5 + b.ph) * 0.10;
      const px = colX + (b.u + sway) * colW;
      const py = b.y * h;
      const v = freq ? logSample(freq, (b.ph % 1)) : 0.4;
      /* Sized off min(w, h) this fell apart on wide, short frames: the
         column width scales with both axes but the blobs scaled with the
         short one, so on a 16:9 stage — or a 176x108 thumbnail — seven
         lumps were each half the column wide and the whole thing overlapped
         into one mass. Scaling off the column keeps the composition
         self-consistent at any aspect ratio. */
      const pr = colW * b.r * (0.95 + v * 0.5 * this.sensitivity + this.beat * 0.14);
      /* viscous deformation: wax stretches along its direction of travel and
         squashes as it hangs at the turn, which is most of what makes it
         read as molten rather than as a drifting dot */
      const speed = Math.abs(tri - 0.5) * 2;
      const stretch = 1 + speed * 0.34;
      const squash = 1 / stretch;
      pts.push({ px, py, pr, v, c: b.c, stretch, squash, heat: b.heat, rising, ph: b.ph });
    }

    /* --- surface tension between lumps that are close ---
       A true metaball threshold needs a blur+contrast pass every frame,
       which is too expensive here. A tapered polygon was the first attempt
       and it was worse than nothing: it spans centre to centre, so it juts
       out past the blob body as a hard shard, and no amount of waist tuning
       hides that a polygon has edges while everything around it does not.
       Bridging with the same soft sprite the bodies use cannot produce an
       edge at all, and it merges because it is the identical falloff. */
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        const dx = b.px - a.px, dy = b.py - a.py;
        const d = Math.hypot(dx, dy);
        const reach = (a.pr + b.pr) * 1.05;
        if (d > reach || d < 1) continue;
        const pull = 1 - d / reach;            // 0 at reach, 1 when concentric
        const steps = 2;
        for (let k = 1; k <= steps; k++) {
          const f = k / (steps + 1);
          const br = Math.min(a.pr, b.pr) * (0.34 + pull * 0.42);
          ctx.globalAlpha = clamp(pull * 0.20, 0, 0.17);
          ctx.drawImage(
            this._soft(this._loud(f < 0.5 ? a.c : b.c)),
            a.px + dx * f - br, a.py + dy * f - br, br * 2, br * 2,
          );
        }
      }
    }
    ctx.globalAlpha = 1;

    /* --- the wax itself: soft body, hot core, no hard sprite edge ---
       The bodies were additive, which is wrong for the material and broke on
       bright themes: wax is opaque, so two overlapping lumps should merge at
       the same brightness, not sum. On Monolith, Arctic and Cotton — palettes
       that are already near white — three overlapping bodies plus a core
       summed straight past white and the column became one flat blob with no
       lumps in it at all. I had only tested this against mid-brightness
       saturated themes. source-over merges instead of stacking, so the shape
       survives whatever the palette. */
    ctx.globalCompositeOperation = 'source-over';
    for (const p of pts) {
      const base = this._loud(p.c);
      const bodyR = p.pr * 1.02;
      ctx.save();
      ctx.translate(p.px, p.py);
      ctx.scale(p.squash, p.stretch);
      const wax = ctx.createRadialGradient(-bodyR * 0.24, -bodyR * 0.30, bodyR * 0.04, 0, 0, bodyR * 1.08);
      wax.addColorStop(0, this._tint(base, 0.06));
      wax.addColorStop(0.34, this._tint(base, -0.18));
      wax.addColorStop(0.74, this._tint(base, -0.46));
      wax.addColorStop(0.94, this._tint(base, -0.64));
      wax.addColorStop(1, this._shadow(base, 0.10, 4));
      ctx.globalAlpha = clamp(0.40 + p.v * 0.16 + this.sm.bass * 0.08, 0.24, 0.66);
      ctx.fillStyle = wax;
      ctx.beginPath();
      for (let k = 0; k <= 16; k++) {
        const ang = (k / 16) * Math.PI * 2;
        const bump = 1
          + Math.sin(ang * 3 + this.t * 0.8 + p.ph) * 0.05
          + Math.cos(ang * 5 - this.t * 0.55 + p.ph * 1.7) * 0.028;
        const bx = Math.cos(ang) * bodyR * bump;
        const by = Math.sin(ang) * bodyR * bump;
        if (k === 0) ctx.moveTo(bx, by);
        else ctx.lineTo(bx, by);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.26 + p.heat * 0.14;
      ctx.strokeStyle = hexRgba(base, 0.30);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(0.08 + p.heat * 0.14 + p.v * 0.06, 0.04, 0.24);
      ctx.fillStyle = this._tint(base, 0.08 + p.heat * 0.20);
      ctx.beginPath();
      ctx.arc(0, 0, bodyR * (0.22 + p.heat * 0.11), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.07 + p.heat * 0.08;
      ctx.drawImage(this._soft(this._vivid(1)), -bodyR * 0.66, -bodyR * 0.80, bodyR * 0.95, bodyR * 0.95);
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }

    /* glass edge highlights and rising heat motes finish the lamp */
    ctx.globalCompositeOperation = 'lighter';
    for (let side = -1; side <= 1; side += 2) {
      const gx = colX + side * colW * 0.46;
      ctx.globalAlpha = 0.045 + this.sm.level * 0.03;
      ctx.drawImage(this._soft(this._vivid(0)), gx - colW * 0.045, h * 0.14, colW * 0.09, h * 0.78);
    }
    ctx.strokeStyle = hexRgba(this._vivid(0), 0.20 + this.sm.bass * 0.08);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(colX - colW * 0.50, h * 0.10);
    ctx.quadraticCurveTo(colX - colW * 0.57, h * 0.55, colX - colW * 0.33, h * 0.94);
    ctx.moveTo(colX + colW * 0.50, h * 0.10);
    ctx.quadraticCurveTo(colX + colW * 0.57, h * 0.55, colX + colW * 0.33, h * 0.94);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = this._shadow(this._color(1), 0.14, 5);
    ctx.beginPath();
    ctx.ellipse(colX, h * 0.085, colW * 0.53, h * 0.028, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexRgba(this._vivid(0), 0.24);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(colX, h * 0.085, colW * 0.53, h * 0.028, 0, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 10; i++) {
      const hx = colX + (((i * 0.37 + 0.11) % 1) - 0.5) * colW * 0.78
        + Math.sin(this.t * 0.6 + i * 1.7) * 6;
      const hy = h * 0.94 - (((i * 0.13 + this.t * 0.018) % 1) * h * 0.62);
      const hr = 0.8 + (i % 3) * 0.55 + this.sm.bass * 0.7;
      ctx.globalAlpha = 0.06 + 0.10 * (0.5 + 0.5 * Math.sin(this.t * 0.9 + i));
      ctx.drawImage(this._soft(this._vivid(0)), hx - hr, hy - hr, hr * 2, hr * 2);
    }
    ctx.globalAlpha = 1;
    void dt;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- GPU CORE — rotating voxel lattice ---------------- */

  _gpu(freq) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h / 2;
    const minDim = Math.min(w, h);
    const S = minDim * 0.115;
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

    /* the core sits in a dim room with a circuit floor under it */
    const floorY = cy + minDim * 0.30;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(4,4,6,0.34)';
    ctx.beginPath();
    ctx.ellipse(cx, floorY, minDim * 0.36, minDim * 0.070, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexRgba(this._loud(0), 0.085);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -4; i <= 4; i++) {
      const fx = cx + i * minDim * 0.075;
      ctx.moveTo(fx, floorY);
      ctx.lineTo(cx + (fx - cx) * 2.6, h);
    }
    for (let i = 1; i <= 4; i++) {
      const fy = floorY + (h - floorY) * (i / 4) * (i / 4);
      ctx.moveTo(cx - minDim * 0.55, fy);
      ctx.lineTo(cx + minDim * 0.55, fy);
    }
    ctx.stroke();
    const coreGlowR = minDim * (0.35 + this.sm.bass * 0.07);
    ctx.globalAlpha = 0.06 + this.sm.level * 0.045;
    ctx.drawImage(this._soft(this._vivid(0)), cx - coreGlowR, cy - coreGlowR, coreGlowR * 2, coreGlowR * 2);
    ctx.globalAlpha = 1;

    /* render back-to-front for painter's order */
    if (!this._gpuCells || this._gpuCells.length !== this.gpuVox.length) {
      this._gpuCells = this.gpuVox.map(() => ({ px: 0, py: 0, d: 0, s: 0 }));
    }
    const cells = this._gpuCells;
    for (let vi = 0; vi < this.gpuVox.length; vi++) {
      const [ix, iy, iz] = this.gpuVox[vi];
      const cell = cells[vi];
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
      cell.px = cx + x1 * scale * persp;
      cell.py = cy + y1 * scale * persp;
      cell.d = z2;
      cell.s = Math.max(2.5, S * 0.72 * persp);
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
      const col = this._loud(ci);
      /* cell body — source-over so overlapping cells stay saturated,
         never stack to white */
      ctx.globalCompositeOperation = 'source-over';
      const fog = 0.52 + u * 0.48;
      ctx.globalAlpha = clamp(0.62 + amp * 0.24, 0, 0.90) * fog;
      ctx.fillStyle = this._tint(col, -0.56);
      ctx.fillRect(c.px - c.s / 2, c.py - c.s / 2, c.s, c.s);
      /* lit edges keep the voxel structure legible at every size */
      ctx.globalAlpha = clamp(0.22 + amp * 0.24, 0, 0.48) * fog;
      ctx.strokeStyle = this._tint(col, 0.04);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.rect(c.px - c.s / 2 + 0.4, c.py - c.s / 2 + 0.4, c.s - 0.8, c.s - 0.8);
      ctx.stroke();
      /* Hot top face (fake isometric), always a lifted version of the slice
         hue rather than white. */
      ctx.globalAlpha = clamp((0.26 + amp * 0.20) * bright, 0, 0.48) * fog;
      ctx.fillStyle = this._tint(col, 0.10 + amp * 0.10);
      ctx.fillRect(c.px - c.s / 2, c.py - c.s / 2, c.s, c.s * 0.30);
      /* soft halo on loud cells */
      if (amp > 0.55) {
        ctx.globalCompositeOperation = 'lighter';
        const hr = c.s * (1.1 + amp * 0.5);
        ctx.globalAlpha = (amp - 0.55) * 0.13 * fog;
        ctx.drawImage(this._soft(this._loud(ci)), c.px - hr, c.py - hr, hr * 2, hr * 2);
      }
    }
    ctx.globalAlpha = 1;

    /* orbiting data nodes — circle the core like bus lines */
    ctx.globalCompositeOperation = 'lighter';
    const orbit = minDim * 0.66;
    ctx.strokeStyle = hexRgba(this._loud(1), 0.10 + this.sm.level * 0.07);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, orbit * 0.72, orbit * 0.45, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = hexRgba(this._vivid(0), 0.12 + this.beat * 0.08);
    ctx.beginPath();
    ctx.ellipse(cx, cy, orbit * 0.54, orbit * 0.34, 0, 0, Math.PI * 2);
    ctx.stroke();
    const nodes = 7;
    for (let i = 0; i < nodes; i++) {
      const ang = this.t * 0.35 + (i * Math.PI * 2) / nodes;
      const r = orbit * (0.55 + 0.28 * Math.sin(this.t * 0.13 + i * 1.4));
      const nx = cx + Math.cos(ang) * r;
      const ny = cy + Math.sin(ang) * r * 0.62;
      const v = freq ? logSample(freq, (i + 1) / (nodes + 1)) : 0.5;
      const rr = Math.min(8, 2.0 + v * 3.6 * this.sensitivity + this.beat * 1.6);
      ctx.globalAlpha = clamp(0.26 + v * 0.42, 0, 0.62);
      ctx.drawImage(this._dot(this._loud(i + 1)), nx - rr, ny - rr, rr * 2, rr * 2);
      /* link line to core center */
      const gl = ctx.createLinearGradient(nx, ny, cx, cy);
      gl.addColorStop(0, hexRgba(this._loud(i + 1), 0.05 + v * 0.12));
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

  /* 22 vinyl — a turntable record on the Canvas2D path: concentric grooves
     burned outward by the spectrum, a rotating shine, a theme-coloured label
     and a tonearm resting on the play. */
  _vinyl(freq, dt) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h / 2;
    const minDim = Math.min(w, h);
    const R = minDim * 0.40;
    /* the platter drags under the drop — pitch sags with the slam, then
       recovers. Grooves are circularly symmetric so the rate change reads
       as weight, not a skip. */
    const rot = this.sceneTime * 0.4 + this.beat * 0.08;
    const c0 = this._vivid(0), c1 = this._vivid(1);
    void dt;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(4,4,6,0.46)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + R * 0.96, R * 1.02, R * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(cx, cy);
    const platter = ctx.createRadialGradient(0, 0, R * 0.62, 0, 0, R * 1.08);
    platter.addColorStop(0, '#111113');
    platter.addColorStop(0.86, '#17171a');
    platter.addColorStop(1, '#2b2b30');
    ctx.fillStyle = platter;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexRgba(c1, 0.34);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.055, 0, Math.PI * 2);
    ctx.stroke();
    const body = ctx.createRadialGradient(0, 0, R * 0.12, 0, 0, R);
    body.addColorStop(0, '#1a1a1c');
    body.addColorStop(1, '#0a0a0b');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.rotate(rot);
    const G = 46;
    ctx.lineWidth = 1;
    for (let i = 0; i < G; i++) {
      const t = i / G;
      const r = R * (0.24 + 0.75 * Math.pow(t, 1.2));
      const band = logSample(freq, 1 - t);
      ctx.globalAlpha = 0.05 + band * 0.5 + this.beat * 0.1;
      ctx.strokeStyle = hexRgba(c1, 1);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      if (band > 0.6) {
        ctx.globalAlpha = band * 0.5;
        ctx.strokeStyle = hexRgba(c0, 1);
        ctx.lineWidth = 2;
        /* no beginPath here appended the emphasised groove to the path that
           had just been stroked, so it was drawn twice and grew a tail */
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'lighter';
    ctx.rotate(rot * 1.4);
    const sheen = ctx.createLinearGradient(-R, 0, R, 0);
    sheen.addColorStop(0, 'rgba(0,0,0,0)');
    sheen.addColorStop(0.5, hexRgba(c0, 0.10 + this.sm.mid * 0.12 + this.sm.high * 0.10));
    sheen.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(-R, -R, R * 2, R * 2);
    ctx.strokeStyle = hexRgba(this._vivid(1), 0.30 + this.sm.high * 0.16);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.985, -2.55, -0.62);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    const lr = R * 0.20;
    const label = ctx.createRadialGradient(0, 0, 0, 0, 0, lr);
    label.addColorStop(0, hexRgba(c0, 0.96));
    label.addColorStop(1, hexRgba(c1, 0.92));
    ctx.fillStyle = label;
    ctx.beginPath();
    ctx.arc(0, 0, lr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexRgba(this._vivid(1), 0.38 + this.sm.level * 0.16);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, lr * 0.78, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(10,10,11,0.9)';
    ctx.beginPath();
    ctx.arc(0, 0, lr * 0.2, 0, Math.PI * 2);
    ctx.fill();
    if (this.quality !== 'low') {
      ctx.strokeStyle = hexRgba(this._vivid(1), 0.30);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, lr, 0, Math.PI * 2);
      ctx.stroke();
    }

    const pvx = R * 0.92, pvy = -R * 0.98;
    const hx = R * 0.06, hy = R * -0.02;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(pvx + 2.5, pvy + 3.5);
    ctx.lineTo(hx + 2.5, hy + 3.5);
    ctx.stroke();
    const armGrad = ctx.createLinearGradient(pvx, pvy, hx, hy);
    armGrad.addColorStop(0, 'rgba(238,238,242,0.95)');
    armGrad.addColorStop(0.55, 'rgba(176,176,184,0.92)');
    armGrad.addColorStop(1, 'rgba(128,128,136,0.92)');
    ctx.strokeStyle = armGrad;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(pvx, pvy);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    /* counterweight and pivot */
    ctx.fillStyle = '#141416';
    ctx.beginPath();
    ctx.ellipse(pvx + R * 0.055, pvy - R * 0.035, R * 0.028, R * 0.050, Math.atan2(hy - pvy, hx - pvx), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexRgba(c1, 0.42);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(pvx + R * 0.055, pvy - R * 0.035, R * 0.028, R * 0.050, Math.atan2(hy - pvy, hx - pvx), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#202024';
    ctx.beginPath();
    ctx.arc(pvx, pvy, R * 0.045, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexRgba(c0, 0.42);
    ctx.beginPath();
    ctx.arc(pvx, pvy, R * 0.045, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#3a3a40';
    ctx.beginPath();
    ctx.arc(pvx, pvy, R * 0.018, 0, Math.PI * 2);
    ctx.fill();
    /* cartridge sitting in the groove */
    ctx.fillStyle = 'rgba(205,205,212,0.92)';
    ctx.beginPath();
    ctx.ellipse(hx, hy, 5.5, 3.6, Math.atan2(hy - pvy, hx - pvx) + Math.PI / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hexRgba(c0, 0.9);
    ctx.beginPath();
    ctx.arc(hx, hy, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ---------------- CHLADNI FIELD ---------------- */

  /* A standing-wave mode is a pair of integers, and the picture only changes
     when the pair does. Quantising the smoothed bands every frame made the
     mask rebuild whenever a band sat on a threshold, which strobed; advance
     the pair on a landed beat with a short cooldown instead, so the pattern
     changes musically. */
  _chladniPairFor(levels) {
    const seq = [[3, 4], [5, 4], [4, 5], [5, 6], [3, 5], [4, 3], [6, 5], [2, 5]];
    const mix = clamp(levels.bass * 0.5 + levels.mid * 0.3 + levels.high * 0.2, 0, 1);
    return seq[Math.floor(mix * (seq.length - 1) + 0.5)];
  }

  _buildChladni(levels) {
    const [n, m] = this._chladniPair || this._chladniPairFor(levels);
    const res = this.quality === 'low' ? 128 : 256;
    const mask = document.createElement('canvas');
    mask.width = mask.height = res;
    const mc = mask.getContext('2d');
    const img = mc.createImageData(res, res);
    const d = img.data;
    let seed = ((n * 73856093) ^ (m * 19349663) ^ 0x9e3779b9) >>> 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const dots = [];
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const u = ((x + 0.5) / res) * 2 - 1;
        const v = ((y + 0.5) / res) * 2 - 1;
        /* the field is evaluated across the whole square, so the nodal
           figure reaches every edge of the stage instead of stopping at a
           plate boundary */
        const c = Math.cos(n * Math.PI * u) * Math.cos(m * Math.PI * v)
                - Math.cos(m * Math.PI * u) * Math.cos(n * Math.PI * v);
        const line = Math.max(0, 1 - Math.abs(c) / 0.055);
        let a = Math.pow(line, 1.5);
        const h = Math.sin(x * 127.1 + y * 311.7 + n * 7.3) * 43758.5453;
        if (line > 0.08 && (h - Math.floor(h)) > 0.90) a = Math.min(1, a + line * 0.6);
        if (a > 0.32) dots.push([u, v, Math.min(1, a), rnd()]);
        const i = (y * res + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = Math.round(a * 255);
      }
    }
    mc.putImageData(img, 0, 0);

    /* Tint the mask with a radial palette ramp: bright in the middle, deep
       toward the edges, so the field reads as lit before bloom lands. */
    const tint = document.createElement('canvas');
    tint.width = tint.height = res;
    const tc = tint.getContext('2d');
    const cols = this._loudColors || this.theme.colors;
    const g = tc.createRadialGradient(res / 2, res / 2, 0, res / 2, res / 2, res / 2);
    for (let i = 0; i < cols.length; i++) {
      g.addColorStop(i / Math.max(1, cols.length - 1), cols[Math.min(cols.length - 1, i)]);
    }
    tc.fillStyle = g;
    tc.fillRect(0, 0, res, res);
    tc.globalCompositeOperation = 'destination-in';
    tc.drawImage(mask, 0, 0);

    this._chladniPat = tint;
    this._chladniDots = dots.slice(0, this.quality === 'low' ? 120 : 220);
    this._chladniKey = `${n},${m},${this.theme.id},${this.quality}`;
  }

  _chladni(_freq, _dt) {
    const { ctx, w, h } = this;
    const cx = w / 2, cy = h / 2;
    const drop = this.beatInfo?.drop || 0;

    if (!this._chladniPair) this._chladniPair = this._chladniPairFor(this.sm);
    if (this.beat > 0.55 && this.t - this._chladniAt > 0.75) {
      this._chladniAt = this.t;
      this._chladniPair = this._chladniPairFor(this.sm);
    }
    const key = `${this._chladniPair[0]},${this._chladniPair[1]},${this.theme.id},${this.quality}`;
    if (this._chladniKey !== key || !this._chladniPat) this._buildChladni(this.sm);

    const plateR = Math.min(w, h) * (0.58 + this.sm.bass * 0.02);
    const plate = ctx.createRadialGradient(cx, cy, plateR * 0.06, cx, cy, plateR);
    plate.addColorStop(0, this._shadow(this._color(1), 0.20, 8));
    plate.addColorStop(0.62, this._shadow(this._color(0), 0.10, 5));
    plate.addColorStop(1, 'rgba(4,4,6,0)');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = plate;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.t * 0.03 + this.beat * 0.006);
    /* overscan: the sheet covers every pixel even as it rotates slowly */
    const S = Math.max(w, h) * 1.35;
    ctx.globalCompositeOperation = 'lighter';
    const zoom = 1 + this.beat * 0.008 + drop * 0.012;
    ctx.globalAlpha = clamp(0.17 + this.sm.level * 0.09 + this.beat * 0.05 + drop * 0.03, 0, 0.36);
    ctx.drawImage(this._chladniPat, -S * zoom / 2, -S * zoom / 2, S * zoom, S * zoom);

    const cols = this._loudColors || this.theme.colors;
    for (const [u, v, a, phase] of this._chladniDots || []) {
      const j = Math.sin(this.t * (5 + phase * 9) + phase * 20) * (0.7 + this.beat * 1.8);
      const s = 0.55 + a * 1.2 + this.beat * 0.7;
      ctx.globalAlpha = clamp(0.10 + a * 0.32, 0, 0.55);
      ctx.fillStyle = this._tint(cols[Math.floor(phase * cols.length) % cols.length], 0.10);
      ctx.beginPath();
      ctx.arc(u * S * zoom / 2 + j, v * S * zoom / 2 + j * 0.55, s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    /* the plate rim and its tick ring sit still while the figure rotates */
    const rimR = Math.min(w, h) * 0.465;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexRgba(this._loud(0), 0.20 + this.sm.level * 0.08);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, rimR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = hexRgba(this._vivid(0), 0.28 + this.beat * 0.12);
    ctx.lineWidth = 1;
    for (let i = 0; i < 36; i++) {
      const ang = (i / 36) * Math.PI * 2;
      const long = i % 3 === 0;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * rimR, cy + Math.sin(ang) * rimR);
      ctx.lineTo(cx + Math.cos(ang) * (rimR + (long ? 7 : 3.5)),
        cy + Math.sin(ang) * (rimR + (long ? 7 : 3.5)));
      ctx.stroke();
    }
    ctx.strokeStyle = hexRgba(this._loud(1), 0.10 + this.sm.level * 0.06);
    ctx.beginPath();
    ctx.arc(cx, cy, rimR * 0.90, 0, Math.PI * 2);
    ctx.stroke();
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
