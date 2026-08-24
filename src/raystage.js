import { VERT, SCENE_FRAG, BLUR_FRAG, ACCUM_FRAG, POST_FRAG } from './rayshader.js';
import { MODES } from './themes.js';
import { beatEnergy } from './beatenergy.js';
import { sanitizeLevels, usableSpectrum } from './levels.js';

/**
 * RayStage — WebGL2 raytraced stage renderer (v8.7).
 *
 * Pipeline per frame:
 *   1. scene pass   → HDR RGBA16F target, N spp with lens + AA jitter
 *   2. temporal     → blended against the previous frame in the post pass
 *   3. bloom        → bright-pass + two separable gaussians at 1/4 res
 *   4. composite    → ACES tonemap, chromatic aberration, vignette, grain
 *
 * Falls back to null (caller keeps the Canvas2D renderer) when WebGL2 or
 * float render targets are unavailable.
 */

/* scale = fraction of the CSS-pixel * dpr resolution the tracer runs at;
   maxPx caps the total ray count so a 4K panel doesn't melt the GPU */
/* Sample budget per tier. spp stays at 1 below ultra — the jittered camera
   plus temporal accumulation already resolves edges, and a second sample
   costs a full extra trace. */
const QUALITY = {
  low:    { scale: 0.5,  spp: 1, steps: 64,  refl: 0, blend: 0.62, maxPx: 0.35e6 },
  medium: { scale: 0.7,  spp: 1, steps: 96,  refl: 1, blend: 0.5,  maxPx: 0.7e6 },
  high:   { scale: 0.8,  spp: 2, steps: 128, refl: 1, blend: 0.45, maxPx: 1.1e6 },
  ultra:  { scale: 1.0,  spp: 4, steps: 200, refl: 1, blend: 0.3,  maxPx: 2.0e6 },
};

const HIST_W = 256;
const HIST_H = 128;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`shader compile failed: ${log}`);
  }
  return s;
}

function link(gl, fragSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(p)}`);
  }
  return p;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  // sRGB → linear, so the shader lights in linear space
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  return srgb.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
}

export class RayStage {
  constructor(canvas) {
    this.canvas = canvas;
    this.ok = false;
    this.error = null;
    let gl;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: false, antialias: false, depth: false, stencil: false,
        powerPreference: 'high-performance', preserveDrawingBuffer: true,
      });
    } catch { /* context creation can throw on locked-down GPUs */ }
    // jsdom and some headless contexts hand back a stub that isn't a real
    // WebGL2 context, so check for the API before trusting it
    if (!gl || typeof gl.getExtension !== 'function' || typeof gl.createProgram !== 'function') {
      this.error = 'webgl2 unavailable';
      return;
    }
    this.gl = gl;
    this.lost = false;

    // A GPU reset (driver hiccup, laptop sleep, another tab hogging the GPU)
    // kills the context. Without this the stage would stay black forever;
    // instead we drop to ok=false so the caller falls back to Canvas2D, then
    // rebuild everything when the browser hands the context back.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.ok = false;
      this.lost = true;
      this.targets = {};
    });
    canvas.addEventListener('webglcontextrestored', () => this._recover());
    // Some browsers never fire webglcontextrestored for a backgrounded page,
    // so poll as well and rebuild as soon as the driver hands the context back.
    this._watchdog = setInterval(() => {
      if (this.lost && this.gl && !this.gl.isContextLost()) this._recover();
    }, 2000);

    // look/quality state survives a context loss — only GL objects are rebuilt
    this.w = 0; this.h = 0;
    this.rw = 0; this.rh = 0;
    this.targets = {};
    this.quality = 'high';
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.mode = 0;
    this.pal = ['#ffb45c', '#ff8a3d', '#fff1d6'].map(hexToRgb);
    this.sensitivity = 1.4;
    this.colorPop = 1.0;
    this.bloomAmount = 0.5;
    this.bassFocus = 0.5;
    /* Exposure into the ACES curve. This sat at 0.62, which left most of
       the tonemapper's range unused: the stage measured a mean luminance
       around 32 against ~90 for the Canvas2D fallback, so the default
       renderer was three times darker than its own fallback and scenes
       like Neon City read as murk. Swept 0.62 to 2.4 across eight modes —
       ACES held clipping at 0.00% throughout, so the headroom was simply
       being left on the table. 1.3 roughly doubles measured brightness
       while keeping the deep blacks and most of the saturation. */
    this.exposure = 1.3;
    this.t = 0;
    this.beat = 0;
    this.frames = 0;

    this._init();
  }

  _recover() {
    if (!this.gl || this.gl.isContextLost()) return;
    this.lost = false;
    this._init();
    if (this.ok && this.w) this.resize(this.w, this.h);
  }

  _init() {
    const gl = this.gl;
    this.float = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');

    try {
      this.pScene = link(gl, SCENE_FRAG);
      this.pBlur = link(gl, BLUR_FRAG);
      this.pAccum = link(gl, ACCUM_FRAG);
      this.pPost = link(gl, POST_FRAG);
    } catch (e) {
      this.error = e.message;
      return;
    }

    try {
      this.vao = gl.createVertexArray();
      this.uScene = this._locs(this.pScene, [
        'uRes', 'uTime', 'uMode', 'uSpp', 'uSteps', 'uRefl', 'uPalN',
        'uBass', 'uMid', 'uHigh', 'uLevel', 'uBeat', 'uPhase',
        'uSens', 'uPop', 'uBassFocus', 'uIdle', 'uSpec', 'uWave', 'uHist', 'uHistRow', 'uSeed',
      ]);
      this.uPal = [0, 1, 2, 3, 4].map((i) => gl.getUniformLocation(this.pScene, `uPal[${i}]`));
      this.uBlur = this._locs(this.pBlur, ['uTex', 'uTexel', 'uDir', 'uThreshold', 'uPrefilter']);
      this.uAccum = this._locs(this.pAccum, ['uScene', 'uHistory', 'uRes', 'uBlend']);
      this.uPost = this._locs(this.pPost, [
        'uScene', 'uBloom', 'uRes', 'uBloomAmt', 'uExposure', 'uTime', 'uBeat', 'uPop',
      ]);

      this.specTex = this._dataTex(256, 1);
      this.waveTex = this._dataTex(256, 1);
      this.histTex = this._dataTex(HIST_W, HIST_H);
      this.histRow = 0;
      this._histScratch = new Uint8Array(HIST_W);

      this._lastKey = '';
      this.frames = 0;
      this.targets = {};
      this.error = null;
      this.ok = true;
    } catch (e) {
      this.error = e.message;
      this.ok = false;
    }
  }

  _locs(prog, names) {
    const o = {};
    for (const n of names) o[n] = this.gl.getUniformLocation(prog, n);
    return o;
  }

  _dataTex(w, h) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(w * h));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  }

  _target(name, w, h) {
    const gl = this.gl;
    const key = `${w}x${h}`;
    const cur = this.targets[name];
    if (cur && cur.key === key) return cur;
    if (cur) { gl.deleteTexture(cur.tex); gl.deleteFramebuffer(cur.fbo); }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const internal = this.float ? gl.RGBA16F : gl.RGBA8;
    const type = this.float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const t = { tex, fbo, w, h, key };
    this.targets[name] = t;
    return t;
  }

  setMode(id) {
    const i = MODES.findIndex((m) => m.id === id);
    if (i >= 0 && i !== this.mode) { this.mode = i; this.frames = 0; }
  }
  setTheme(theme) {
    if (!theme) return;
    this.pal = theme.colors.slice(0, 5).map(hexToRgb);
    this.frames = 0;
  }
  setQuality(q) {
    if (!QUALITY[q] || q === this.quality) return;
    this.quality = q;
    this.frames = 0;
    this.resize(this.w, this.h);
  }
  setSensitivity(v) { this.sensitivity = v; }
  setBassFocus(v) { this.bassFocus = v; }
  setColorPop(v) { this.colorPop = v; }
  setBloom(v) { this.bloomAmount = v; }

  resize(w, h) {
    if (!this.ok) return;
    this.w = Math.max(1, Math.round(w));
    this.h = Math.max(1, Math.round(h));
    const q = QUALITY[this.quality];
    let scale = this.dpr * q.scale;
    const px = this.w * this.h * scale * scale;
    if (px > q.maxPx) scale *= Math.sqrt(q.maxPx / px);
    this.rw = Math.max(2, Math.round(this.w * scale));
    this.rh = Math.max(2, Math.round(this.h * scale));
    this.canvas.width = this.rw;
    this.canvas.height = this.rh;
    this.frames = 0;
  }

  /** push one spectrum row into the rolling history used by spectro/terrain */
  pushHistory(freq) {
    const gl = this.gl;
    const row = this._histScratch;
    const n = freq.length;
    for (let i = 0; i < HIST_W; i++) {
      // log-ish frequency mapping so bass doesn't eat the whole texture
      const u = i / HIST_W;
      const idx = Math.min(n - 1, Math.floor(Math.pow(u, 1.9) * n * 0.72));
      row[i] = freq[idx];
    }
    gl.bindTexture(gl.TEXTURE_2D, this.histTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, this.histRow, HIST_W, 1, gl.RED, gl.UNSIGNED_BYTE, row);
    this.histRow = (this.histRow + 1) % HIST_H;
  }

  _uploadAudio(freq, wave) {
    const gl = this.gl;
    // reused scratch: these ran 60-144x a second and were pure GC churn
    const s = this._specScratch || (this._specScratch = new Uint8Array(256));
    if (freq) {
      const n = freq.length;
      for (let i = 0; i < 256; i++) {
        const u = i / 256;
        const idx = Math.min(n - 1, Math.floor(Math.pow(u, 1.65) * n * 0.72));
        const idx2 = Math.min(n - 1, idx + 2);
        s[i] = Math.max(freq[idx], freq[idx2]);
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, this.specTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RED, gl.UNSIGNED_BYTE, s);

    const wv = this._waveScratch || (this._waveScratch = new Uint8Array(256));
    if (wave) {
      const step = Math.max(1, Math.floor(wave.length / 256));
      for (let i = 0; i < 256; i++) wv[i] = wave[i * step];
    } else {
      wv.fill(128);
    }
    if (!freq) s.fill(0);
    gl.bindTexture(gl.TEXTURE_2D, this.waveTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RED, gl.UNSIGNED_BYTE, wv);
  }

  _fullscreen() { this.gl.drawArrays(this.gl.TRIANGLES, 0, 3); }

  render(idle, freq, wave, levels, dtMs = 16.7, tOverride = null) {
    if (!this.ok) return;
    // nothing is playing: render at ~30fps instead of burning a full GPU
    // budget on an idle stage
    if (idle && tOverride == null) {
      this._idleSkip = !this._idleSkip;
      if (this._idleSkip) { this.t += Math.min(Math.max((dtMs || 16.7) / 1000, 0.001), 0.06); return; }
      dtMs = (dtMs || 16.7) * 2;
    }
    const gl = this.gl;
    const dt = Math.min(Math.max((dtMs || 16.7) / 1000, 0.001), 0.06);
    this.t = tOverride != null ? tOverride : this.t + dt;

    /* Same boundary guard as the Canvas2D renderer. WebGL accepts a NaN
       uniform without complaint, so a bad analysis frame does not throw
       here — it just pushes NaN into the shader and the whole stage renders
       as garbage. See src/levels.js. */
    const lv = sanitizeLevels(levels);
    this.beat = beatEnergy(this.beat, lv, dt);
    if (usableSpectrum(freq)) {
      this._uploadAudio(freq, wave);
      // fixed 45 rows/sec so the spectrogram and terrain scroll at the same
      // speed on a 60Hz and a 144Hz display
      this._histAcc = (this._histAcc || 0) + dt;
      while (this._histAcc >= 1 / 45) {
        this._histAcc -= 1 / 45;
        this.pushHistory(freq);
      }
    } else if (idle) {
      // no input yet — breathe a slow synthetic spectrum so the stage is
      // alive on first paint instead of an empty scene
      this._idleAcc = (this._idleAcc || 0) + dt;
      if (this._idleAcc > 0.04) {
        this._idleAcc = 0;
        const f = this._idleFreq || (this._idleFreq = new Uint8Array(1024));
        const w = this._idleWave || (this._idleWave = new Uint8Array(2048));
        const t = this.t;
        for (let i = 0; i < 1024; i++) {
          const u = i / 1024;
          const v = 0.1 + 0.34 * Math.exp(-Math.pow((u - 0.03) * 13, 2)) * (0.6 + 0.4 * Math.sin(t * 0.7))
            + 0.2 * Math.abs(Math.sin(u * 15 + t * 0.5)) * Math.exp(-u * 3.0);
          f[i] = Math.max(0, Math.min(255, v * 255));
        }
        for (let i = 0; i < 2048; i++) w[i] = 128 + 42 * Math.sin(i * 0.012 + t * 1.1);
        this._uploadAudio(f, w);
        this.pushHistory(f);
        this._histAcc = 0;
      }
    }

    const q = QUALITY[this.quality];
    const scene = this._target('scene', this.rw, this.rh);
    const histA = this._target('histA', this.rw, this.rh);
    const histB = this._target('histB', this.rw, this.rh);
    const bw = Math.max(2, this.rw >> 2);
    const bh = Math.max(2, this.rh >> 2);
    const blurA = this._target('blurA', bw, bh);
    const blurB = this._target('blurB', bw, bh);

    gl.bindVertexArray(this.vao);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    /* ---- 1. scene ---- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, this.rw, this.rh);
    gl.useProgram(this.pScene);
    const u = this.uScene;
    gl.uniform2f(u.uRes, this.rw, this.rh);
    gl.uniform1f(u.uTime, this.t);
    gl.uniform1i(u.uMode, this.mode);
    gl.uniform1i(u.uSpp, q.spp);
    gl.uniform1i(u.uSteps, q.steps);
    gl.uniform1i(u.uRefl, q.refl);
    gl.uniform1i(u.uPalN, this.pal.length);
    for (let i = 0; i < 5; i++) {
      const c = this.pal[Math.min(i, this.pal.length - 1)];
      gl.uniform3f(this.uPal[i], c[0], c[1], c[2]);
    }
    gl.uniform1f(u.uBass, lv.bass || 0);
    gl.uniform1f(u.uMid, lv.mid || 0);
    gl.uniform1f(u.uHigh, lv.high || 0);
    gl.uniform1f(u.uLevel, idle ? 0.12 : (lv.level || 0));
    gl.uniform1f(u.uBeat, this.beat);
    gl.uniform1f(u.uPhase, lv.beatPhase || 0);
    gl.uniform1f(u.uSens, this.sensitivity);
    gl.uniform1f(u.uPop, this.colorPop);
    gl.uniform1f(u.uBassFocus, this.bassFocus);
    gl.uniform1f(u.uIdle, idle ? 1 : 0);
    gl.uniform1f(u.uHistRow, this.histRow / HIST_H);
    gl.uniform1f(u.uSeed, (this.frames % 64) * 0.618 + 0.13);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.specTex); gl.uniform1i(u.uSpec, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.waveTex); gl.uniform1i(u.uWave, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.histTex); gl.uniform1i(u.uHist, 2);
    this._fullscreen();

    /* ---- 2. temporal accumulation (linear HDR, pre-bloom) ---- */
    const prev = this.frames % 2 === 0 ? histA : histB;
    const next = this.frames % 2 === 0 ? histB : histA;
    // a look change or resize invalidates history; the beat also cuts it so
    // hits stay crisp instead of ghosting
    const key = `${this.mode}|${this.quality}|${this.rw}`;
    const stable = key === this._lastKey && this.frames > 1;
    this._lastKey = key;
    // a beat softens the blend so hits stay crisp, but killing it entirely
    // left every beat frame full of sampling noise
    const blend = stable ? q.blend * (1 - Math.min(this.beat, 0.6) * 0.5) : 0;

    // when blend is 0 the accumulation pass is a straight copy — skip it and
    // let the rest of the chain read the scene buffer directly
    const accumulated = blend > 0.001;
    if (accumulated) {
      gl.useProgram(this.pAccum);
      gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
      gl.viewport(0, 0, this.rw, this.rh);
      gl.uniform2f(this.uAccum.uRes, this.rw, this.rh);
      gl.uniform1f(this.uAccum.uBlend, blend);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, scene.tex); gl.uniform1i(this.uAccum.uScene, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, prev.tex); gl.uniform1i(this.uAccum.uHistory, 1);
      this._fullscreen();
    }
    const lit = accumulated ? next : scene;

    /* ---- 3. bloom: bright-pass H, then V (quarter res) ---- */
    gl.useProgram(this.pBlur);
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurA.fbo);
    gl.viewport(0, 0, bw, bh);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, lit.tex);
    gl.uniform1i(this.uBlur.uTex, 0);
    gl.uniform2f(this.uBlur.uTexel, 1 / this.rw, 1 / this.rh);
    gl.uniform2f(this.uBlur.uDir, 1, 0);
    gl.uniform1f(this.uBlur.uThreshold, 0.75);
    gl.uniform1i(this.uBlur.uPrefilter, 1);
    this._fullscreen();

    gl.bindFramebuffer(gl.FRAMEBUFFER, blurB.fbo);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, blurA.tex);
    gl.uniform2f(this.uBlur.uTexel, 1 / bw, 1 / bh);
    gl.uniform2f(this.uBlur.uDir, 0, 1);
    gl.uniform1i(this.uBlur.uPrefilter, 0);
    this._fullscreen();

    /* ---- 4. composite to the screen ---- */
    gl.useProgram(this.pPost);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.rw, this.rh);
    gl.uniform2f(this.uPost.uRes, this.rw, this.rh);
    gl.uniform1f(this.uPost.uBloomAmt, this.bloomAmount);
    gl.uniform1f(this.uPost.uExposure, this.exposure);
    gl.uniform1f(this.uPost.uTime, this.t);
    gl.uniform1f(this.uPost.uBeat, this.beat);
    gl.uniform1f(this.uPost.uPop, this.colorPop);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, lit.tex); gl.uniform1i(this.uPost.uScene, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, blurB.tex); gl.uniform1i(this.uPost.uBloom, 1);
    this._fullscreen();

    this.frames++;
  }
}
