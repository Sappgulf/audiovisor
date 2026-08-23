import { BeatTracker } from './beattracker.js';
import { SynthFeed } from './synthfeed.js';

/**
 * Unified audio engine.
 *
 * Input modes:
 *  - 'file'     decoded AudioBuffers (drag & drop)
 *  - 'mic'      live microphone (analysis-only, no speaker routing)
 *  - 'capture'  system/tab audio capture (analysis-only)
 *  - 'stream'   HTMLMediaElement URLs (radio/podcast/direct links)
 *  - 'spotify'  external DRM playback — visuals driven by a synth feed
 *               unless capture/mic provides real spectrum data
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffer = null;
    this.track = null;
    this.queue = [];
    this.queueIndex = -1;

    this.source = null;
    this.analyser = null;
    this.filter = null;
    this.compressor = null;
    this.convolver = null;
    this.master = null;
    this.reverbGain = null;

    this.micStream = null;
    this.micSource = null;
    this.micActive = false;

    this.captureStream = null;
    this.captureSource = null;
    this.captureActive = false;

    this.tapGain = null;
    this.tapAnalyser = null;
    this.tapFreq = null;
    this.tapWave = null;

    this.mediaEl = null;
    this.mediaNode = null;
    this.streamNoTap = false;
    this._streamRetry = false;
    this.streamTrack = null;

    this.mode = 'none';
    this.external = null;
    this.synthFile = null;
    this.synthSpotify = null;

    this.playing = false;
    this.loop = false;
    this.volume = 0.75;
    this.sensitivity = 1.4;
    this.smoothing = 0.82;
    this.bassFocus = 0.5;

    this.fx = { reverb: false, limiter: false, lowpass: false, speed: false, autotune: false, chorus: false, echo: false, crush: false, chop: false };
    this.speed = 1;

    this.offset = 0;
    this.startedAt = 0;

    this.freqData = null;
    this.waveData = null;

    this.beat = new BeatTracker();

    this.recDest = null;

    this._listeners = { state: [], source: [], error: [] };

    this.onEnded = null;
    this.onQueueChange = null;
  }

  /** Subscribe to engine events: 'state' | 'source' | 'error'. */
  on(name, fn) {
    if (this._listeners[name]) this._listeners[name].push(fn);
  }

  _fire(name, payload) {
    for (const fn of this._listeners[name] || []) {
      try { fn(payload); } catch {}
    }
  }

  get hasTrack() {
    return !!this.buffer;
  }

  get activeInput() {
    if (this.micActive) return 'mic';
    if (this.captureActive) return 'capture';
    if (this.mode === 'spotify') return 'spotify';
    if (this.mode === 'stream') return 'stream';
    return this.hasTrack ? 'track' : 'none';
  }

  /* ---------- graph ---------- */

  _ensureCtx() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = this.smoothing;
      this.analyser.minDecibels = -95;
      this.analyser.maxDecibels = -15;

      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 22050;

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = 0;
      this.compressor.knee.value = 20;
      this.compressor.ratio.value = 12;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.25;

      this.convolver = this.ctx.createConvolver();
      this.convolver.buffer = this._makeImpulse();

      this.reverbGain = this.ctx.createGain();
      this.reverbGain.gain.value = 0;

      // fun FX: autotune (peaking), chorus (delay+feedback), echo (delay), crush (waveshaper)
      this.tuneFilter = this.ctx.createBiquadFilter();
      this.tuneFilter.type = 'peaking';
      this.tuneFilter.frequency.value = 1100;
      this.tuneFilter.Q.value = 1.2;
      this.tuneFilter.gain.value = 0;

      this.chorusDelay = this.ctx.createDelay(0.05);
      this.chorusDelay.delayTime.value = 0.012;
      this.chorusGain = this.ctx.createGain();
      this.chorusGain.gain.value = 0;
      this.chorusFeedback = this.ctx.createGain();
      this.chorusFeedback.gain.value = 0.18;

      this.echoDelay = this.ctx.createDelay(1.0);
      this.echoDelay.delayTime.value = 0.0;
      this.echoGain = this.ctx.createGain();
      this.echoGain.gain.value = 0;
      this.echoFeedback = this.ctx.createGain();
      this.echoFeedback.gain.value = 0.28;

      this.crushShaper = this.ctx.createWaveShaper();
      this.crushShaper.curve = null;

      this.chopGate = this.ctx.createGain();
      this.chopGate.gain.value = 1;
      this._chopTimer = null;

      // 5-band parametric EQ (60, 250, 1k, 4k, 12k) in series
      this.eqFilters = [60, 250, 1000, 4000, 12000].map((f) => {
        const b = this.ctx.createBiquadFilter();
        b.type = 'peaking';
        b.frequency.value = f;
        b.Q.value = 1.1;
        b.gain.value = 0;
        return b;
      });

      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;

      // main chain with fun inserts: filter -> tune -> crush -> compressor -> chopGate -> master
      let eqPrev = this.filter;
      for (const b of this.eqFilters) { eqPrev.connect(b); eqPrev = b; }
      eqPrev.connect(this.tuneFilter);
      this.tuneFilter.connect(this.crushShaper);
      this.crushShaper.connect(this.compressor);
      this.compressor.connect(this.chopGate);
      this.chopGate.connect(this.master);
      // parallel verb
      this.filter.connect(this.convolver);
      this.convolver.connect(this.reverbGain);
      this.reverbGain.connect(this.master);
      // chorus send (parallel)
      this.filter.connect(this.chorusDelay);
      this.chorusDelay.connect(this.chorusGain);
      this.chorusGain.connect(this.master);
      this.chorusDelay.connect(this.chorusFeedback);
      this.chorusFeedback.connect(this.chorusDelay);
      // echo send (parallel)
      this.filter.connect(this.echoDelay);
      this.echoDelay.connect(this.echoGain);
      this.echoGain.connect(this.master);
      this.echoDelay.connect(this.echoFeedback);
      this.echoFeedback.connect(this.echoDelay);
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.waveData = new Uint8Array(this.analyser.fftSize);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** Analysis-only bus: mic + capture feed this and it never reaches speakers. */
  _ensureTap() {
    if (this.tapAnalyser) return;
    this._ensureCtx();
    this.tapGain = this.ctx.createGain();
    this.tapAnalyser = this.ctx.createAnalyser();
    this.tapAnalyser.fftSize = 2048;
    this.tapAnalyser.smoothingTimeConstant = this.smoothing;
    this.tapAnalyser.minDecibels = -95;
    this.tapAnalyser.maxDecibels = -15;
    this.tapGain.connect(this.tapAnalyser);
    this.tapFreq = new Uint8Array(this.tapAnalyser.frequencyBinCount);
    this.tapWave = new Uint8Array(this.tapAnalyser.fftSize);
  }

  _makeImpulse() {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * 2.2);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
      }
    }
    return buf;
  }

  /* ---------- file queue ---------- */

  async decodeFile(file) {
    this._ensureCtx();
    const arrayBuf = await file.arrayBuffer();
    const audioBuf = await this.ctx.decodeAudioData(arrayBuf);
    return {
      buffer: audioBuf,
      meta: {
        name: file.name.replace(/\.[^.]+$/, ''),
        ext: file.name.split('.').pop().toUpperCase(),
        sampleRate: audioBuf.sampleRate,
        channels: audioBuf.numberOfChannels,
        duration: audioBuf.duration,
      },
    };
  }

  async addToQueue(files) {
    for (const file of files) {
      const decoded = await this.decodeFile(file);
      this.queue.push(decoded);
    }
    if (this.queueIndex === -1) {
      this.queueIndex = 0;
      this._applyQueueItem(0);
    }
    if (this.onQueueChange) this.onQueueChange();
  }

  _applyQueueItem(i) {
    this.queueIndex = i;
    const item = this.queue[i];
    this.buffer = item.buffer;
    this.track = item.meta;
    this.offset = 0;
    this.beat.reset();
    this._setMode('file');
  }

  _setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this._fire('source', mode);
  }

  playTrack(i) {
    if (!this.queue.length) return;
    if (this.playing) {
      try { this.source.stop(); } catch {}
      this.source = null;
    }
    this._applyQueueItem(i);
    this.playing = false;
    this.play();
  }

  _connectSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.speed;
    src.loop = this.loop;
    this.sourceGain = this.ctx.createGain();
    this.sourceGain.gain.value = 1;
    src.connect(this.sourceGain);
    this.sourceGain.connect(this.filter);
    src.onended = () => {
      if (src._fade) return; // crossfade handled by crossfadeTo
      if (this.playing) {
        this.playing = false;
        if (!this.loop && this.queueIndex < this.queue.length - 1) {
          this.playTrack(this.queueIndex + 1);
          if (this.onQueueChange) this.onQueueChange();
          return;
        }
        this.offset = 0;
        this._emit();
        if (this.onEnded) this.onEnded();
      }
    };
    this.source = src;
  }

  /* ---------- transport (routes by mode) ---------- */

  play() {
    if (this.micActive || this.captureActive) return;
    if (this.mode === 'spotify') {
      this.playing = true;
      if (this.external?.play) this.external.play();
      this._emit();
      return;
    }
    if (this.mode === 'stream') {
      this._ensureCtx();
      this.mediaEl?.play()?.catch(() => {});
      this.playing = true;
      this._emit();
      return;
    }
    if (!this.buffer) return;
    this._ensureCtx();
    if (this.playing) return;
    this._connectSource();
    this.source.start(0, this.offset % this.buffer.duration);
    this.startedAt = this.ctx.currentTime - this.offset;
    this.playing = true;
    this._emit();
  }

  pause() {
    if (this.mode === 'spotify' && this.playing) {
      this.playing = false;
      if (this.external?.pause) this.external.pause();
      this._emit();
      return;
    }
    if (this.mode === 'stream' && this.playing) {
      try { this.mediaEl?.pause(); } catch {}
      this.playing = false;
      this._emit();
      return;
    }
    if (!this.playing || !this.source) return;
    this.offset = this.getTime();
    try { this.source.stop(); } catch {}
    this.source = null;
    this.playing = false;
    this._emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t) {
    /* onsets are timestamped in song time — a jump invalidates the grid */
    this.beat.reset();
    if (this.mode === 'spotify') {
      if (this.external?.seek) this.external.seek(Math.max(0, t));
      return;
    }
    if (this.mode === 'stream') {
      if (!this.mediaEl) return;
      const dur = this.mediaEl.duration;
      this.mediaEl.currentTime = Number.isFinite(dur) ? Math.max(0, Math.min(t, dur - 0.05)) : Math.max(0, t);
      this._emit();
      return;
    }
    if (!this.buffer) return;
    t = Math.max(0, Math.min(t, this.buffer.duration - 0.05));
    this.offset = t;
    if (this.playing) {
      try { this.source.stop(); } catch {}
      this._connectSource();
      this.source.start(0, this.offset);
      this.startedAt = this.ctx.currentTime - this.offset;
    }
    this._emit();
  }

  skip(delta) {
    this.seek(this.getTime() + delta);
  }

  prevTrack() {
    if (this.mode === 'spotify') {
      if (this.external?.prev) this.external.prev();
      return;
    }
    if (this.queue.length > 1) {
      const i = (this.queueIndex - 1 + this.queue.length) % this.queue.length;
      this.playTrack(i);
      if (this.onQueueChange) this.onQueueChange();
    } else {
      this.seek(0);
    }
  }

  nextTrack() {
    if (this.mode === 'spotify') {
      if (this.external?.next) this.external.next();
      return;
    }
    if (this.queue.length > 1) {
      const i = (this.queueIndex + 1) % this.queue.length;
      this.playTrack(i);
      if (this.onQueueChange) this.onQueueChange();
    } else {
      this.skip(10);
    }
  }

  /** Remove a queue item. If it's playing, advance to the next track in its place. */
  removeFromQueue(i) {
    if (i < 0 || i >= this.queue.length) return;
    const removingCurrent = i === this.queueIndex;
    this.queue.splice(i, 1);

    if (!this.queue.length) {
      if (this.source) {
        try { this.source.stop(); } catch {}
        this.source = null;
      }
      this.buffer = null;
      this.track = null;
      this.offset = 0;
      this.playing = false;
      this.queueIndex = -1;
      if (this.mode === 'file') this._setMode('none');
      if (this.onQueueChange) this.onQueueChange();
      return;
    }

    if (removingCurrent) {
      const wasPlaying = this.playing;
      if (this.source) {
        try { this.source.stop(); } catch {}
        this.source = null;
      }
      this.playing = false;
      this._applyQueueItem(Math.min(i, this.queue.length - 1));
      if (wasPlaying) this.play();
    } else if (i < this.queueIndex) {
      this.queueIndex--;
    }
    if (this.onQueueChange) this.onQueueChange();
  }

  /** Fisher–Yates shuffle of the queue, keeping the current track first. */
  shuffleQueue() {
    if (this.queue.length < 2) return;
    const cur = this.queueIndex >= 0 && this.queueIndex < this.queue.length
      ? this.queue[this.queueIndex]
      : null;
    const rest = this.queue.filter((_, idx) => idx !== this.queueIndex);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    this.queue = cur ? [cur, ...rest] : rest;
    this.queueIndex = cur ? 0 : this.queueIndex;
    if (this.onQueueChange) this.onQueueChange();
  }

  /* ---------- session export ---------- */

  /** MediaStream carrying the master mix, for canvas+audio recording. */
  getRecordStream() {
    if (!this.ctx || !this.master) return null;
    if (!this.recDest) {
      this.recDest = this.ctx.createMediaStreamDestination();
      this.master.connect(this.recDest);
    }
    return this.recDest.stream;
  }

  /* ---------- params & fx ---------- */

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    if (this.external?.setVolume) this.external.setVolume(v);
  }

  setSpeed(mult) {
    this.speed = mult;
    if (this.source) this.source.playbackRate.value = mult;
  }

  setSmoothing(v) {
    this.smoothing = v;
    if (this.analyser) this.analyser.smoothingTimeConstant = v;
    if (this.tapAnalyser) this.tapAnalyser.smoothingTimeConstant = v;
  }

  setFx(name, on) {
    this.fx[name] = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (name === 'reverb') this.reverbGain.gain.setTargetAtTime(on ? 0.35 : 0, t, 0.05);
    if (name === 'limiter') this.compressor.threshold.setTargetAtTime(on ? -18 : 0, t, 0.05);
    if (name === 'lowpass') this.filter.frequency.setTargetAtTime(on ? 400 : 22050, t, 0.08);
    if (name === 'speed') this.setSpeed(on ? 1.5 : 1);
    if (name === 'autotune') this.tuneFilter.gain.setTargetAtTime(on ? 10 : 0, t, 0.08);
    if (name === 'chorus') {
      this.chorusDelay.delayTime.setTargetAtTime(on ? 0.028 : 0.012, t, 0.08);
      this.chorusGain.gain.setTargetAtTime(on ? 0.42 : 0, t, 0.06);
    }
    if (name === 'echo') {
      this.echoDelay.delayTime.setTargetAtTime(on ? 0.34 : 0.0, t, 0.08);
      this.echoGain.gain.setTargetAtTime(on ? 0.32 : 0, t, 0.06);
    }
    if (name === 'crush') {
      if (on) {
        const k = 20;
        const n = 44100;
        const curve = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const x = (i * 2) / n - 1;
          curve[i] = (3 + k) * x * 20 * (Math.PI / 180) / (Math.PI + k * Math.abs(x));
        }
        this.crushShaper.curve = curve;
        this.crushShaper.oversample = '2x';
      } else {
        this.crushShaper.curve = null;
      }
    }
    if (name === 'chop') {
      if (on) {
        // screwed: slow + lowpass
        this._chopPrevSpeed = this.speed;
        this.setSpeed(0.66);
        this.filter.frequency.setTargetAtTime(900, t, 0.12);
        this.chopGate.gain.cancelScheduledValues(t);
        this.chopGate.gain.setValueAtTime(1, t);
        if (this._chopTimer) clearInterval(this._chopTimer);
        this._chopTimer = setInterval(() => {
          if (!this.fx.chop || !this.ctx || !this.chopGate) return;
          const now = this.ctx.currentTime;
          try {
            this.chopGate.gain.cancelScheduledValues(now);
            this.chopGate.gain.setValueAtTime(1, now);
            this.chopGate.gain.linearRampToValueAtTime(0.02, now + 0.045);
            this.chopGate.gain.linearRampToValueAtTime(1, now + 0.14);
            if (this.source && this.source.playbackRate) {
              this.source.playbackRate.cancelScheduledValues(now);
              this.source.playbackRate.setValueAtTime(this.speed * 0.88, now);
              this.source.playbackRate.linearRampToValueAtTime(this.speed, now + 0.22);
            }
          } catch {}
        }, 420);
      } else {
        if (this._chopTimer) { clearInterval(this._chopTimer); this._chopTimer = null; }
        try {
          this.chopGate.gain.cancelScheduledValues(t);
          this.chopGate.gain.setValueAtTime(1, t);
          if (this.source) this.source.playbackRate.setValueAtTime(this.fx.speed ? 1.5 : 1, t);
        } catch {}
        // restore filter if lowpass not active
        if (!this.fx.lowpass) this.filter.frequency.setTargetAtTime(22050, t, 0.12);
        else this.filter.frequency.setTargetAtTime(400, t, 0.08);
        // restore speed if needed
        if (!this.fx.speed) this.setSpeed(this._chopPrevSpeed ?? 1);
      }
    }
  }

  setEq(band, gainDb) {
    if (this.eqFilters && this.eqFilters[band]) {
      this.eqFilters[band].gain.setTargetAtTime(gainDb, this.ctx.currentTime, 0.03);
    }
  }

  crossfadeTo(i, fadeSec = 4) {
    if (!this.queue[i] || i === this.queueIndex) return;
    const oldSrc = this.source;
    const oldGain = this.sourceGain;
    // beat-match: start next track at same beat phase
    const bpm = this.beat.bpm;
    let offset = 0;
    if (bpm > 0) offset = this.getTime() % (60 / bpm);
    this._applyQueueItem(i);
    this._connectSource();
    const t = this.ctx.currentTime;
    if (this.sourceGain) {
      this.sourceGain.gain.setValueAtTime(0.0001, t);
      this.sourceGain.gain.linearRampToValueAtTime(1, t + fadeSec);
    }
    if (oldSrc) oldSrc._fade = true;
    if (oldGain) {
      try {
        oldGain.gain.cancelScheduledValues(t);
        oldGain.gain.setValueAtTime(oldGain.gain.value, t);
        oldGain.gain.linearRampToValueAtTime(0.0001, t + fadeSec);
      } catch {}
      setTimeout(() => { try { oldSrc?.stop(); } catch {} }, fadeSec * 1000 + 100);
    }
    this.source.start(0, offset);
    this.startedAt = t - offset;
    this.playing = true;
    this._emit();
  }

  /* ---------- mic (analysis-only) ---------- */

  async enableMic() {
    this._ensureCtx();
    this._ensureTap();
    if (this.micActive) return;
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false },
    });
    this.micSource = this.ctx.createMediaStreamSource(this.micStream);
    this.micSource.connect(this.tapGain);
    if (this.playing) this.pause();
    this.micActive = true;
    this.beat.reset();
    this._emit();
  }

  disableMic() {
    if (!this.micActive) return;
    if (this.micSource) this.micSource.disconnect();
    this.micSource = null;
    if (this.micStream) {
      this.micStream.getTracks().forEach((tr) => tr.stop());
      this.micStream = null;
    }
    this.micActive = false;
    this._emit();
  }

  async toggleMic() {
    if (this.micActive) this.disableMic();
    else await this.enableMic();
    return this.micActive;
  }

  /* ---------- display / tab capture (analysis-only) ---------- */

  async enableCapture() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Tab capture is not supported in this browser');
    }
    this._ensureCtx();
    this._ensureTap();
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      preferCurrentTab: true,
    });
    const audioTracks = stream.getAudioTracks();
    stream.getVideoTracks().forEach((t) => t.stop());
    if (!audioTracks.length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('No audio was shared — pick a tab and enable "Share tab audio"');
    }
    this.captureStream = stream;
    this.captureSource = this.ctx.createMediaStreamSource(new MediaStream(audioTracks));
    this.captureSource.connect(this.tapGain);
    audioTracks[0].addEventListener('ended', () => {
      this.disableCapture();
      this._fire('source', 'capture-ended');
    });
    if (this.playing) this.pause();
    this.disableMic();
    this.captureActive = true;
    this.beat.reset();
    this._emit();
  }

  disableCapture() {
    if (!this.captureActive) return;
    if (this.captureSource) this.captureSource.disconnect();
    this.captureSource = null;
    if (this.captureStream) {
      this.captureStream.getTracks().forEach((tr) => tr.stop());
      this.captureStream = null;
    }
    this.captureActive = false;
    this._emit();
  }

  async toggleCapture() {
    if (this.captureActive) this.disableCapture();
    else await this.enableCapture();
    return this.captureActive;
  }

  /* ---------- direct URL streams ---------- */

  async playUrl(url, meta = {}) {
    this._ensureCtx();
    this.disableMic();
    this.disableCapture();
    if (this.playing && this.source) {
      try { this.source.stop(); } catch {}
      this.source = null;
      this.playing = false;
    }
    this.external = null;

    if (this.mediaEl) {
      try { this.mediaEl.pause(); } catch {}
    }

    /* a fresh element per stream keeps CORS-taint and old graph nodes
       from leaking into the next URL */
    this._resetStreamElement();
    this._streamRetry = false;

    try {
      this.mediaNode = this.ctx.createMediaElementSource(this.mediaEl);
      this.mediaNode.connect(this.filter);
    } catch {
      this.streamNoTap = true;
    }

    this.streamTrack = { name: meta.name || 'Stream', url, ext: meta.ext || 'STREAM' };
    this.mediaEl.src = url;
    this._setMode('stream');
    this.playing = true;
    this.beat.reset();

    const p = this.mediaEl.play();
    if (p) {
      try {
        await p;
      } catch (err) {
        if (err?.name !== 'AbortError') this._onStreamError(err);
      }
    }
    this._emit();
  }

  _resetStreamElement(noCors = false) {
    this.streamNoTap = noCors;
    if (this.mediaNode) {
      try { this.mediaNode.disconnect(); } catch {}
      this.mediaNode = null;
    }
    this.mediaEl = new Audio();
    this.mediaEl.preload = 'auto';
    if (!noCors) this.mediaEl.crossOrigin = 'anonymous';
    this.mediaEl.addEventListener('ended', () => {
      if (this.mode === 'stream') {
        this.playing = false;
        this.offset = 0;
        this._emit();
        if (this.onEnded) this.onEnded();
      }
    });
    this.mediaEl.addEventListener('error', () => this._onStreamError());
    this.mediaEl.addEventListener('play', () => {
      if (this.mode === 'stream' && !this.playing) { this.playing = true; this._emit(); }
    });
    this.mediaEl.addEventListener('pause', () => {
      if (this.mode === 'stream' && this.playing) { this.playing = false; this._emit(); }
    });
  }

  _onStreamError(_err) {
    // CORS-tainted sources fail with crossOrigin set; fall back to a plain
    // element (plays straight to speakers) + synth feed for visuals.
    if (!this._streamRetry && this.streamTrack?.url) {
      this._streamRetry = true;
      this._resetStreamElement(true);
      this.mediaEl.src = this.streamTrack.url;
      this.mediaEl.play().catch(() => {});
      return;
    }
    this.playing = false;
    this._emit();
    this._fire('error', 'Stream failed — link may be offline or block playback');
  }

  stopStream() {
    if (this.mode !== 'stream') return;
    try { this.mediaEl?.pause(); } catch {}
    this.playing = false;
    this.streamTrack = null;
    this._setMode(this.hasTrack ? 'file' : 'none');
    this._emit();
  }

  /* ---------- external transport (e.g. Spotify) ---------- */

  setExternal(controller) {
    this.external = controller;
    if (controller) {
      this.synthSpotify = null;
      this._setMode('spotify');
      this.playing = controller.isPlaying?.() ?? false;
    } else {
      this._setMode(this.hasTrack ? 'file' : 'none');
    }
    this._emit();
  }

  clearExternalIfIdle() {
    if (this.mode === 'spotify' && !this.external) {
      this._setMode(this.hasTrack ? 'file' : 'none');
    }
  }

  syncExternal() {
    if (this.mode !== 'spotify' || !this.external) return;
    const nowPlaying = !!this.external.isPlaying();
    if (nowPlaying !== this.playing) {
      this.playing = nowPlaying;
      this._emit();
    }
  }

  /* ---------- time ---------- */

  getTime() {
    if (this.mode === 'spotify' && this.external) return this.external.getTime();
    if (this.mode === 'stream') {
      if (!this.mediaEl) return 0;
      return Number.isFinite(this.mediaEl.duration) ? this.mediaEl.currentTime : 0;
    }
    if (!this.buffer) return 0;
    if (!this.playing) return this.offset;
    const t = this.ctx.currentTime - this.startedAt;
    return this.loop ? t % this.buffer.duration : Math.min(t, this.buffer.duration);
  }

  getDuration() {
    if (this.mode === 'spotify' && this.external) return this.external.getDuration();
    if (this.mode === 'stream') {
      const d = this.mediaEl?.duration;
      return Number.isFinite(d) ? d : 0;
    }
    return this.buffer ? this.buffer.duration : 0;
  }

  /* ---------- analysis ---------- */

  /**
   * Snapshot the active source once. Call at most once per frame —
   * getLevels() reuses this frame so every consumer sees the same
   * instant of audio (no double-sampling skew).
   */
  getData() {
    if (this.micActive || this.captureActive) {
      if (!this.tapAnalyser) return null;
      this.tapAnalyser.getByteFrequencyData(this.tapFreq);
      this.tapAnalyser.getByteTimeDomainData(this.tapWave);
      return { freq: this.tapFreq, wave: this.tapWave };
    }
    if (this.mode === 'spotify') {
      if (!this.synthSpotify) {
        this.synthSpotify = new SynthFeed(
          this.external?.seed ? this.external.seed : 'spotify',
        );
      }
      if (this.playing) this.synthSpotify.tick(this.getTime());
      else this.synthSpotify.clear();
      return this.synthSpotify.getData();
    }
    if (this.mode === 'stream' && this.streamNoTap) {
      if (!this.synthFile) {
        this.synthFile = new SynthFeed(this.streamTrack?.url || 'stream');
      }
      if (this.playing) this.synthFile.tick(this.getTime());
      else this.synthFile.clear();
      return this.synthFile.getData();
    }
    if (!this.analyser) return null;
    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.waveData);
    return { freq: this.freqData, wave: this.waveData };
  }

  getLevels(preFetched = null) {
    const d = preFetched || this.getData();
    if (!d) return { bass: 0, mid: 0, high: 0, level: 0 };
    const { freq } = d;
    const n = freq.length;
    const binHz = (this.ctx?.sampleRate || 44100) / 2 / n;
    const iBass = Math.floor(120 / binHz);
    const iMid = Math.floor(2000 / binHz);
    const iHigh = Math.floor(8000 / binHz);
    const avg = (a, b) => {
      let s = 0;
      for (let i = a; i < b; i++) s += freq[i];
      return s / Math.max(1, b - a) / 255;
    };
    const bass = avg(2, iBass);
    const mid = avg(iBass, iMid);
    const high = avg(iMid, iHigh);
    const level = avg(2, n);

    /* beat clock runs on song position + full spectrum, not wall time */
    this.beat.process(freq, this.getTime());
    const bi = this.beat;
    return {
      bass, mid, high, level,
      bpm: bi.bpm,
      beatPhase: bi.phase,
      beatPulse: bi.pulse,
      beatConfidence: bi.confidence,
      chop: !!this.fx.chop,
    };
  }

  getBpm() {
    return this.beat.bpm;
  }

  /** Live tempo/phase state for beat-synced visuals. */
  get beatInfo() {
    return this.beat.info;
  }

  _emit() {
    this._fire('state', this.playing);
  }
}
