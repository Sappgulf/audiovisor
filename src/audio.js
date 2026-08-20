import { BeatTracker } from './beattracker.js';

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

    this.playing = false;
    this.loop = false;
    this.volume = 0.75;
    this.sensitivity = 1.4;
    this.smoothing = 0.82;
    this.bassFocus = 0.5;

    this.fx = { reverb: false, limiter: false, lowpass: false, speed: false };
    this.speed = 1;

    this.offset = 0;
    this.startedAt = 0;

    this.freqData = null;
    this.waveData = null;

    this.beat = new BeatTracker();

    this.onEnded = null;
    this.onStateChange = null;
    this.onQueueChange = null;
  }

  get hasTrack() {
    return !!this.buffer;
  }

  get activeInput() {
    return this.micActive ? 'mic' : this.hasTrack ? 'track' : 'none';
  }

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

      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;

      this.filter.connect(this.compressor);
      this.compressor.connect(this.master);
      this.filter.connect(this.convolver);
      this.convolver.connect(this.reverbGain);
      this.reverbGain.connect(this.master);
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.waveData = new Uint8Array(this.analyser.fftSize);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
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
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.playbackRate.value = this.speed;
    this.source.loop = this.loop;
    this.source.connect(this.filter);
    this.source.onended = () => {
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
  }

  play() {
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
    if (this.queue.length > 1) {
      const i = (this.queueIndex - 1 + this.queue.length) % this.queue.length;
      this.playTrack(i);
      if (this.onQueueChange) this.onQueueChange();
    } else {
      this.seek(0);
    }
  }

  nextTrack() {
    if (this.queue.length > 1) {
      const i = (this.queueIndex + 1) % this.queue.length;
      this.playTrack(i);
      if (this.onQueueChange) this.onQueueChange();
    } else {
      this.skip(10);
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setSpeed(mult) {
    this.speed = mult;
    if (this.source) this.source.playbackRate.value = mult;
  }

  setSmoothing(v) {
    this.smoothing = v;
    if (this.analyser) this.analyser.smoothingTimeConstant = v;
  }

  setFx(name, on) {
    this.fx[name] = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (name === 'reverb') this.reverbGain.gain.setTargetAtTime(on ? 0.35 : 0, t, 0.05);
    if (name === 'limiter') this.compressor.threshold.setTargetAtTime(on ? -18 : 0, t, 0.05);
    if (name === 'lowpass') this.filter.frequency.setTargetAtTime(on ? 400 : 22050, t, 0.08);
    if (name === 'speed') this.setSpeed(on ? 1.5 : 1);
  }

  async enableMic() {
    this._ensureCtx();
    if (this.micActive) return;
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false },
    });
    this.micSource = this.ctx.createMediaStreamSource(this.micStream);
    this.micSource.connect(this.filter);
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

  getTime() {
    if (!this.buffer) return 0;
    if (!this.playing) return this.offset;
    const t = this.ctx.currentTime - this.startedAt;
    return this.loop ? t % this.buffer.duration : Math.min(t, this.buffer.duration);
  }

  getDuration() {
    return this.buffer ? this.buffer.duration : 0;
  }

  getData() {
    if (!this.analyser) return null;
    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteWaveformData(this.waveData);
    return { freq: this.freqData, wave: this.waveData };
  }

  getLevels() {
    const d = this.getData();
    if (!d) return { bass: 0, mid: 0, high: 0, level: 0 };
    const { freq } = d;
    const n = freq.length;
    const binHz = this.ctx.sampleRate / 2 / n;
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
    this.beat.tick(bass);
    return { bass, mid, high, level };
  }

  getBpm() {
    return this.beat.bpm;
  }

  _emit() {
    if (this.onStateChange) this.onStateChange(this.playing);
  }
}
