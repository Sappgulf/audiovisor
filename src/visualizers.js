import { THEMES } from './themes.js';
import { lerp, logSample, hexRgba, clamp } from './utils.js';
import { beatEnergy } from './beatenergy.js';
import { sanitizeLevels, usableSpectrum, safeDimension } from './levels.js';
import { motionScale } from './motion.js';
import { isLowPowerDevice } from './adaptive.js';

/* modes whose scenes are broad bright plates rather than thin bright
   marks; full-strength bloom clips them (see _bloom) */
const MODE_BLOOM = { spectro: 0.28, gpu: 0.34, terrain: 0.62 };

/* The four modes that ship in the entry bundle. Everything else lives in
   modes-extra.js and is fetched the first time it is selected; until it
   lands the renderer falls back to bars rather than drawing nothing. */
const CORE_MODES = new Set(['bars', 'waves', 'scope', 'particles']);
const FALLBACK_MODE = 'bars';

let extrasReady = false;
let extrasPending = null;

/** Fetch and install the extra modes. Safe to call repeatedly. */
export function loadExtraModes(RendererClass) {
  if (extrasReady) return Promise.resolve();
  if (!extrasPending) {
    extrasPending = import('./modes-extra.js')
      .then(({ installExtraModes }) => {
        installExtraModes(RendererClass);
        extrasReady = true;
      })
      .catch((err) => {
        /* leave extrasPending null so a later mode switch can retry after a
           transient network failure; the fallback mode keeps drawing. */
        extrasPending = null;
        throw err;
      });
  }
  return extrasPending;
}

/** True once the extra modes are installed. Exported for tests. */
export function extraModesLoaded() { return extrasReady; }

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
    /* navigator.deviceMemory does not exist on iOS at all, so this fell back
       to 8 and handed every iPhone the desktop cap — on a 3x screen that is
       four times the pixels of a 1.5x cap, all of it composited every frame.
       isLowPowerDevice() looks at more than one signal for that reason. */
    const mem = navigator.deviceMemory || 8;
    const dprCap = (mem < 4 || isLowPowerDevice()) ? 1.5 : 2;
    this.dpr = Math.min(window.devicePixelRatio || 1, dprCap);
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
    this._scopeW = 0;
    this._scopeQ = '';
    this.specCv = null;
    this.specCtx = null;
    this._specW = 0;
    this._specH = 0;
    this._specTheme = null;
    this._specQ = '';
    this.specLut = null;
    this._specAcc = 0;
    this.cityCols = [];
    this.stars = [];
    this._starSig = '';
    this.orbSat = [];
    this._scopePts = null;

    /* radar / lava state */
    this.radarBlips = [];
    this._sweepAng = -Math.PI / 2;
    this.lavaBlobs = null;
    this._particleSeeded = false;

    /* caches */
    this._dotSprites = null;
    this._softSprites = null;
    this._barSprites = null;
    this._floorGrads = null;
    this._cacheTheme = null;
    this._cacheQ = '';
    this._bgGrad = null;
    this._bgTheme = null;
    this._bgW = 0;
    this._bgH = 0;

    this.trailCv = null;
    this.trailCtx = null;

    /* post-fx caches (noise grain tiles, vignette) */
    this._noiseTiles = null;
    this._vigCv = null;
    this._vigW = 0;
    this._vigH = 0;

    this.resize();
  }

  resize() {
    if (this._dead) return;
    const rect = this.canvas.getBoundingClientRect();
    // Math.max propagates NaN, so a non-finite rect used to produce a
    // NaN width that coerces to a zero-size canvas; see src/levels.js
    this.w = safeDimension(rect.width);
    this.h = safeDimension(rect.height);
    const scale = this.quality === 'low' ? 1 : this.dpr;
    this.canvas.width = safeDimension(this.w * scale);
    this.canvas.height = safeDimension(this.h * scale);
    this._floorGrads = null;
  }

  setQuality(q) {
    if (this.quality === q) return;
    this.quality = q;
    this.resize();
  }

  setMode(m) {
    this.mode = m;
    if (!CORE_MODES.has(m) && !extrasReady) {
      loadExtraModes(Renderer).catch(() => {});
    }
    this.history = [];
    this.echo = null;
    this.terrainRows = [];
    this.cityCols = [];
    this._scopeW = 0;
    this.scopeCv = null;
    this.scopeCtx = null;
    this.orbSat = [];
    this._scopePts = null;
    this.radarBlips = [];
    this.lavaBlobs = null;
    /* transient effect state from the extra modes: shockwave rings, fluid
       droplets and nebula blobs all decay on their own, but switching away
       and back within their lifetime popped stale effects into the new
       scene (a shockwave from the last visit replaying over silence). All
       four rebuild lazily, so clearing is free. */
    this._orbWaves = [];
    this._tensorWaves = [];
    this.fluidDrops = [];
    this.nebula = null;
  }
  setTheme(t) {
    this.theme = t;
    this._cacheTheme = null;
    this._bgTheme = null;
    /* the spectro buffer bakes palette-tinted pixels; force a rebuild */
    this.specCv = null;
  }
  setSensitivity(v) { this.sensitivity = v; }
  setBassFocus(v) { this.bassFocus = v; }
  setColorPop(v) { this.colorPop = v; this._cacheTheme = null; }
  setBloom(v) { this.bloomAmount = v; }

  /* ---------------- caches ---------------- */

  _buildCache() {
    /* runs every frame; compare references instead of joining the palette
       into a signature string each time */
    if (this._cacheTheme === this.theme && this._cacheQ === this.quality && this._dotSprites) return;
    this._cacheTheme = this.theme;
    this._cacheQ = this.quality;

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
    /* rimless soft pool sprites — purely radial falloff, no rim ring or
       hot core; safe to scale huge (backdrop glows, wash gradients) */
    this._softSprites = new Map();
    for (const c of this.theme.colors) {
      const d = document.createElement('canvas');
      d.width = d.height = 64;
      const dc = d.getContext('2d');
      const g = dc.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, hexRgba(c, 0.9));
      g.addColorStop(0.4, hexRgba(c, 0.5));
      g.addColorStop(1, hexRgba(c, 0));
      dc.fillStyle = g;
      dc.fillRect(0, 0, 64, 64);
      this._softSprites.set(c, d);
    }
    this._floorGrads = null;
  }

  /**
   * A near-black tinted toward a theme colour.
   *
   * Neon City drew its skyline in a hardcoded navy, so the mode ignored the
   * theme completely and read cold against every warm palette. Silhouettes
   * still need to be dark enough for the windows to pop, so this keeps the
   * value low and only carries the hue.
   */
  _shadow(hex, tint = 0.09, floor = 6) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const mix = (v) => Math.round(floor + v * tint);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
  }

  /**
   * A hex colour lifted toward white without going achromatic.
   *
   * The counterpart to _shadow(): highlights that cap at pure white throw
   * the hue away exactly where the image is brightest, which is what made
   * several modes read as grey rather than lit.
   */
  _tint(hex, amount = 0.55) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (v, target) => Math.round(v + (target - v) * amount);
    return `rgb(${mix((n >> 16) & 255, 255)}, ${mix((n >> 8) & 255, 252)}, ${mix(n & 255, 243)})`;
  }

  _dot(c) { return this._dotSprites.get(c); }
  _soft(c) { return this._softSprites.get(c); }
  _barS(c) { return this._barSprites.get(c); }
  _color(i) { return this.theme.colors[i % this.theme.colors.length]; }

  /* ---------------- analysis smoothing ---------------- */

  _updateLevels(levels, dt) {
    /* Asymmetric envelope: a transient should arrive instantly and leave
       slowly. A single symmetric lerp made every band rise as sluggishly as
       it fell, which is what made kicks read as mush — the peak was already
       past by the time the bar got there. Attack is near-instant, release is
       slower than the old constant, so the decay reads as a tail rather than
       a flicker. Both are dt-shaped, so the feel holds at 60 and 144Hz. */
    const attack = 1 - Math.pow(1 - 0.55, dt * 60);
    const release = 1 - Math.pow(1 - 0.16, dt * 60);
    const t = {
      bass: Math.min(1.2, levels.bass * (1 + this.bassFocus * 0.6)),
      mid: levels.mid,
      high: levels.high,
      level: levels.level,
    };
    const env = (cur, target) => lerp(cur, target, target > cur ? attack : release);
    this.sm.bass = env(this.sm.bass, t.bass);
    this.sm.mid = env(this.sm.mid, t.mid);
    this.sm.high = env(this.sm.high, t.high);
    this.sm.level = env(this.sm.level, t.level);

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

  /**
   * Advance the analysis envelopes (beat, smoothed bands, history) without
   * drawing. The raytraced stage owns the pixels in that mode, but the VU
   * meter, chips and favicon still read these values.
   */
  updateAnalysis(rawLevels, dtMs = 16.7) {
    const dt = clamp((dtMs || 16.7) / 1000, 0.001, 0.06);
    this.t += dt;
    /* Everything downstream assumes finite, in-range numbers; one NaN here
       latches into the smoothed bands permanently. See src/levels.js. The
       scratch is this renderer's own — beatInfo always mirrors the latest
       frame, which is the only thing its readers want. */
    const levels = sanitizeLevels(rawLevels, this._lvScratch || (this._lvScratch = {}));
    this.beatInfo = levels;
    this.beat = beatEnergy(this.beat, levels, dt);
    this._updateLevels(levels, dt);
    return dt;
  }

  render(idle, freq, wave, levels, dtMs = 16.7, stereoL = null, stereoR = null) {
    if (this._dead || !this.ctx) return;
    const { ctx, w, h } = this;
    /* kept for the scope: a true L/R goniometer when the source is stereo */
    this.stereoL = stereoL;
    this.stereoR = stereoR;
    /* Four modes indexed straight into the spectrum and produced NaN
       geometry from an empty one. Substitute silence rather than null —
       two modes index freq directly, so a null would only move the crash. */
    if (!usableSpectrum(freq)) {
      this._silentFreq ||= new Uint8Array(1024);
      freq = this._silentFreq;
    }
    const dt = this.updateAnalysis(levels, dtMs);
    const dt60 = dt * 60;
    this._buildCache();

    const scale = this.quality === 'low' ? 1 : this.dpr;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, w, h);

    /* ambient base — theme-tinted deep gradient, so scenes never float on
       transparency or the page background. Rebuilt only when a real input
       changes; the signature string this used to build every frame was pure
       per-frame garbage. */
    if (!this._bgGrad || this._bgW !== w || this._bgH !== h || this._bgTheme !== this.theme.id) {
      this._bgW = w;
      this._bgH = h;
      this._bgTheme = this.theme.id;
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#080807');
      bg.addColorStop(0.55, '#0a0908');
      /* This ended on hexRgba(themeColour, 0.14) — an almost transparent
         bright stop after two opaque dark ones. A canvas gradient
         interpolates colour and alpha together, so between them it passes
         through an *opaque mid-bright* olive: a hard, full-width band across
         the lower third of every frame, in every mode, on every theme. It
         was the single most damaging thing on the stage and it read as
         haze rather than as the bug it was.
         Ending on an opaque dark tint keeps the intended hint of theme
         underfoot with no band, and lets the frame reach near-black. */
      bg.addColorStop(1, this._shadow(this.theme.colors[this.theme.colors.length - 1], 0.11, 8));
      this._bgGrad = bg;
      this._bgCtx = ctx;
    }
    if (this._bgGrad) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = this._bgGrad;
      ctx.fillRect(0, 0, w, h);
    }

    if (idle || !freq || !wave) {
      this._backdrop();
      this._idle(dt60);
      this._bloom(this.beat);
      this._vignette();
      if (this.quality !== 'low') {
        this._ensureNoise();
        const tile = this._noiseTiles[Math.floor(this.t * 12) % this._noiseTiles.length];
        ctx.save();
        ctx.globalAlpha = 0.07;
        ctx.drawImage(tile, 0, 0, w, h);
        ctx.restore();
      }
      return;
    }

    /* atmosphere: slow drifting theme glows behind the scene */
    this._backdrop();

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
    /* Whole-frame motion is what causes vestibular discomfort, so it scales
       to zero under prefers-reduced-motion while the visualisation itself —
       the reason the app exists — carries on. See src/motion.js. */
    const motion = motionScale();
    /* the drop lands on top of the beat punch: a deeper, slower zoom that
       reads as the camera flinching rather than the frame throbbing */
    const drop = levels?.drop || 0;
    const punched = (this.beat > 0.02 || drop > 0.02) && motion > 0;
    if (punched) {
      ctx.save();
      const z = 1 + this.beat * 0.012 * motion + drop * drop * 0.05 * motion;
      ctx.translate(w / 2, h / 2);
      ctx.scale(z, z);
      ctx.translate(-w / 2, -h / 2);
    }
    // chop slice stutter (VHS)
    if (chopGlitch && motion > 0) {
      ctx.save();
      const sliceY = (this.t * 380) % h;
      ctx.translate((Math.sin(this.t * 62) * 7) * motion, 0);
      ctx.beginPath();
      ctx.rect(0, sliceY, w, 18 + Math.random()*22);
      ctx.clip();
    }
    this._scene(freq, wave, dt, dt60);
    if (chopGlitch && motion > 0) ctx.restore();
    if (punched) ctx.restore();

    // ray-trace SSR floor (subtle reflection of the scene)
    if (this.quality !== 'low' && this.mode !== 'bars' && this.mode !== 'spectro' && this.mode !== 'scope') {
      const fh = Math.round(h * 0.28);
      const sy = h - fh;
      ctx.save();
      ctx.globalAlpha = this.mode === 'terrain' ? 0.07 : 0.09;
      ctx.globalCompositeOperation = 'source-over';
      // flip vertically around sy
      ctx.translate(0, sy * 2 + fh);
      ctx.scale(1, -1);
      /* Two bugs lived in this one call. It sampled (0, 0, w, fh) — the top
         of the frame — and mirrored that into the bottom, so what appeared
         under the "floor" was never what stood on it. And the source rect is
         in canvas device pixels while w/h are CSS pixels, so above 1x it
         also read the wrong sub-rect. Mirror the band directly above the
         floor line, measured on the backing store. */
      const px = this.canvas.height / h;
      ctx.drawImage(
        this.canvas,
        0, Math.max(0, sy - fh) * px, this.canvas.width, fh * px,
        0, 0, w, fh,
      );
      ctx.restore();
      // fade the reflection
      const fade = ctx.createLinearGradient(0, sy, 0, h);
      fade.addColorStop(0, 'rgba(15,14,13,0)');
      fade.addColorStop(1, 'rgba(15,14,13,0.96)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, sy, w, fh);
    }

    if (this.beat > 0.45) this._kickFlare();

    /* phosphor trail: accumulate this frame onto a faded accumulation
       buffer, then blend it under the live scene (spectro scrolls its own
       history — a second trail pass would smear it) */
    if (this.quality !== 'low' && this.mode !== 'spectro') {
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
      tc.fillStyle = 'rgba(0,0,0,0.24)';
      tc.fillRect(0, 0, this.canvas.width, this.canvas.height);
      tc.globalCompositeOperation = 'source-over';
      tc.drawImage(this.canvas, 0, 0);
      // blend trail under live scene
      ctx.save();
      ctx.setTransform(s, 0, 0, s, 0, 0);
      ctx.globalAlpha = 0.22;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.trailCv, 0, 0, w, h);
      ctx.restore();
    }

    /* Keep decorative beat markers off during the first few uncertain
       detections. The pulse still drives the scene immediately, but the
       grid waits for a stable lock instead of teaching the eye a wrong bar. */
    if (this.mode !== 'bars' && this.beatInfo?.bpm > 0 && (this.beatInfo.beatConfidence || 0) >= 0.35) this._beatGrid();
    /* the drop rides the bloom's bright-pass: everything hot flares for the
       ~1s the envelope takes to decay */
    this._bloom(Math.min(1, this.beat + drop * 0.7));
    // cinematic vignette
    this._vignette();
    // real film grain (cycling noise tiles)
    if (this.quality !== 'low') {
      this._ensureNoise();
      const tile = this._noiseTiles[Math.floor(this.t * 12) % this._noiseTiles.length];
      ctx.save();
      ctx.globalAlpha = clamp(0.07 + this.beat * 0.05, 0, 0.16);
      ctx.drawImage(tile, 0, 0, w, h);
      ctx.restore();
    }
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
    /* a non-core mode selected before modes-extra.js resolves would hit an
       undefined method, so draw bars until the chunk is actually installed */
    const mode = (CORE_MODES.has(this.mode) || extrasReady) ? this.mode : FALLBACK_MODE;
    switch (mode) {
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
      case 'nebula': this._nebula(freq); break;
      case 'spiral': this._spiral(freq); break;
      case 'orb': this._orb(freq, dt60, dt); break;
      case 'fluid': this._fluid(freq, dt); break;
      case 'tensor': this._tensor(freq, dt, dt60); break;
      case 'prism': this._prism(freq); break;
      case 'void': this._void(freq); break;
      case 'bloomfield': this._bloomField(freq); break;
      case 'fractal': this._fractal(freq); break;
      case 'radar': this._radar(freq, dt); break;
      case 'lava': this._lava(freq, dt, dt60); break;
      case 'gpu': this._gpu(freq); break;
      case 'vinyl': this._vinyl(freq, dt); break;
    }
  }

  /* ---------------- bloom ---------------- */

  _bloom(punch = 0) {
    if (this.quality === 'low' || this.bloomAmount <= 0.01) return;
    const { ctx, w, h } = this;
    /* Per-mode bloom scale. Spectrogram and GPU Core fill the frame with
       large, already-bright plates rather than thin bright marks, so the
       full-strength glow added itself back on top and drove a tenth of the
       waterfall past white — the mode read as a flat wash with its dynamics
       thrown away. They still bloom, just at a fraction that highlights the
       hot rows instead of erasing them. */
    const modeScale = MODE_BLOOM[this.mode] ?? 1;
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
    ga.globalCompositeOperation = 'source-over';
    ga.drawImage(this.canvas, 0, 0, gw, gh);
    /* Bright pass. The glow used to be a blurred copy of the entire frame
       added back on top, so mid-tones were lifted along with highlights —
       that flattened contrast, washed the colour out, and pushed already
       bright areas past white. Multiplying the frame by itself squares each
       channel, so 0.5 falls to 0.25 while 0.9 only falls to 0.81: mid-tones
       drop out of the glow and highlights survive it, which is what bloom
       is supposed to select. */
    ga.globalCompositeOperation = 'multiply';
    ga.drawImage(this.canvas, 0, 0, gw, gh);
    ga.globalCompositeOperation = 'source-over';
    const gb = this.glowBCtx;
    gb.clearRect(0, 0, this.glowB.width, this.glowB.height);
    gb.drawImage(this.glowA, 0, 0, this.glowB.width, this.glowB.height);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    // chromatic bloom on strong beats (soft offset split, capped hard)
    if (punch > 0.6) {
      ctx.globalAlpha = clamp((0.08 + punch * 0.03) * (0.5 + this.bloomAmount) * modeScale, 0, 0.14);
      ctx.drawImage(this.glowB, -w * 0.02 + 1.2, -h * 0.02, w * 1.04, h * 1.04);
      ctx.drawImage(this.glowB, -w * 0.02 - 1.2, -h * 0.02, w * 1.04, h * 1.04);
    }
    /* The bright pass halves what reaches the glow, so the gain is raised to
       keep the same amount of visible bloom — the difference is that it now
       comes from highlights rather than from lifting the whole frame. */
    ctx.globalAlpha = clamp((0.25 + punch * 0.06) * (0.5 + this.bloomAmount) * modeScale, 0, 0.36);
    ctx.drawImage(this.glowB, -w * 0.02, -h * 0.02, w * 1.04, h * 1.04);
    ctx.globalAlpha = clamp((0.17 + punch * 0.05) * (0.5 + this.bloomAmount) * modeScale, 0, 0.29);
    ctx.drawImage(this.glowA, 0, 0, w, h);
    ctx.restore();
  }

  _kickFlare() {
    const { ctx, w, h } = this;
    /* soft lens flare core + horizontal streak (no full-screen wash) */
    const cx = w / 2, cy = h * 0.45;
    const maxD = Math.max(w, h);
    const flareR = maxD * (0.10 + this.beat * 0.14);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp((this.beat - 0.4) * 0.16, 0, 0.10);
    ctx.drawImage(this._soft(this._color(0)), cx - flareR, cy - flareR, flareR * 2, flareR * 2);
    ctx.globalAlpha = clamp((this.beat - 0.4) * 0.10, 0, 0.05);
    const sr = maxD * (0.20 + this.beat * 0.22);
    ctx.drawImage(this._soft(this._color(1)), cx - sr, cy - sr * 0.22, sr * 2, sr * 0.44);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ---------------- POST-FX: backdrop / vignette / grain ---------------- */

  _backdrop() {
    const { ctx, w, h } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    /* Three sprites at 0.55x the min dimension cover the entire frame, so an
       additive draw at 0.035 each was a permanent haze over every pixel —
       the dominant reason the stage looked washed out and the reason every
       theme collapsed toward one tint. Smaller and fainter keeps the slow
       drift of colour behind the scene without raising the floor. */
    for (let i = 0; i < 3; i++) {
      const x = w * (0.5 + 0.33 * Math.sin(this.t * 0.043 + i * 2.1));
      const y = h * (0.45 + 0.30 * Math.cos(this.t * 0.037 + i * 1.7));
      const r = Math.min(w, h) * (0.34 + 0.07 * Math.sin(this.t * 0.05 + i));
      ctx.globalAlpha = 0.012 + this.sm.level * 0.016 + this.beat * 0.012;
      ctx.drawImage(this._soft(this._color(i)), x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  _vignette() {
    if (this.quality === 'low') return;
    const { ctx } = this;
    const hw = Math.max(2, Math.round(this.w / 2));
    const hh = Math.max(2, Math.round(this.h / 2));
    if (!this._vigCv || this._vigW !== hw || this._vigH !== hh) {
      this._vigW = hw;
      this._vigH = hh;
      this._vigCv = document.createElement('canvas');
      this._vigCv.width = hw;
      this._vigCv.height = hh;
      const vc = this._vigCv.getContext('2d');
      const R = Math.hypot(hw, hh) / 2;
      const g = vc.createRadialGradient(hw / 2, hh / 2, R * 0.52, hw / 2, hh / 2, R);
      g.addColorStop(0, 'rgba(4,5,9,0)');
      g.addColorStop(0.78, 'rgba(4,5,9,0.16)');
      g.addColorStop(1, 'rgba(4,5,9,0.52)');
      vc.fillStyle = g;
      vc.fillRect(0, 0, hw, hh);
    }
    ctx.drawImage(this._vigCv, 0, 0, this.w, this.h);
  }

  _ensureNoise() {
    if (this._noiseTiles && this._noiseW === Math.round(this.w / 2) && this._noiseH === Math.round(this.h / 2)) return;
    this._noiseW = Math.round(this.w / 2);
    this._noiseH = Math.round(this.h / 2);
    this._noiseTiles = [];
    for (let n = 0; n < 2; n++) {
      const c = document.createElement('canvas');
      c.width = Math.max(2, this._noiseW);
      c.height = Math.max(2, this._noiseH);
      const nc = c.getContext('2d');
      const img = nc.createImageData(c.width, c.height);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = Math.random();
        if (v > 0.90) {
          d[i] = d[i + 1] = d[i + 2] = 255;
          d[i + 3] = (v - 0.90) * 420;
        }
      }
      nc.putImageData(img, 0, 0);
      this._noiseTiles.push(c);
    }
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
    /* Density and duty cycle both ran too high: up to 88 bars, each filling
       5/6 of its slot, so the spectrum rendered as an edge-to-edge slab of
       colour rather than as bars. A bar chart reads by its gaps — the dark
       between the bars is what makes them countable — so fewer columns and
       a third of each slot given back to the background. */
    const N = Math.min(56, Math.max(28, Math.round(w / (this.quality === 'low' ? 38 : 24))));
    const gap = Math.max(3, w / N / 3);
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

    /* depth layers — staggered silk bands above/below the main line */
    ctx.globalCompositeOperation = 'lighter';
    strokeSmooth(samplePts(wave, midY - ampScale * 0.16, ampScale * 0.60, 0.82), hexRgba(this._color(1), 0.30 + this.sm.level * 0.10), 1.5, 0.9);
    strokeSmooth(samplePts(wave, midY + ampScale * 0.24, ampScale * 0.48, 0.68), hexRgba(this._color(2), 0.20 + this.sm.level * 0.08), 1.2, 0.8);
    ctx.globalCompositeOperation = 'source-over';

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
    if (!this.scopeCv || this._scopeW !== w || this._scopeQ !== this.quality) {
      this._scopeW = w;
      this._scopeQ = this.quality;
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
    if (this.stereoL && this.stereoR) {
      /* True goniometer: plot L against R over time, rotated 45° so an
         in-phase (mono) signal collapses to a vertical line and stereo
         width reads as horizontal spread. The delayed-self-correlation
         trace below is what runs when no L/R tap exists (synth feeds,
         mono streams) — same phosphor, honest data in both cases. */
      const n = Math.min(this.stereoL.length, this.stereoR.length);
      const step = Math.max(1, Math.floor(n / N));
      for (let i = 0; i < N; i++) {
        const si = Math.min(n - 1, i * step);
        const l = this.stereoL[si];
        const r = this.stereoR[si];
        pts[i * 2] = ((r - l) / Math.SQRT2) * (R * 0.5);
        pts[i * 2 + 1] = (-(l + r) / Math.SQRT2) * (R * 0.5);
      }
    } else {
      for (let i = 0; i < N; i++) {
        const si = ((i / N) * wave.length) | 0;
        const sj = (si + delay) % wave.length;
        pts[i * 2] = ((wave[si] - 128) / 128) * R;
        pts[i * 2 + 1] = ((wave[sj] - 128) / 128) * R;
      }
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
      /* This draws additively into a trail buffer that only fades ~22% a
         frame, so a 0.7 trace reached a steady state around three times
         over white wherever the figure crosses itself — the trail went
         flat white instead of reading as phosphor. Set so accumulation
         settles just about at full scale. */
      sctx.strokeStyle = hexRgba(this._color(s), 0.26);
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

    /* seed a warm ember pool so the field is alive from the first frame
       (re-seeds after every mode switch since setMode empties the pool) */
    if (this.particles.length === 0) {
      for (let i = 0; i < cap * 0.5 && this.particles.length < cap; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = 0.3 + Math.random() * 0.9;
        this.particles.push({
          x: cx + (Math.random() - 0.5) * w * 0.5,
          y: cy + (Math.random() - 0.5) * h * 0.6,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - 0.35,
          r: 0.8 + Math.random() * 2.4,
          c: Math.floor(Math.random() * this.theme.colors.length),
          life: 0.5 + Math.random() * 0.5,
          decay: 0.004 + Math.random() * 0.009,
        });
      }
    }

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
}
