import { describe, it, expect, beforeEach, vi } from 'vitest';

class FakeParam {
  constructor(value) { this.value = value; }
  setTargetAtTime(v) { this.value = v; }
  setValueAtTime(v) { this.value = v; }
  cancelScheduledValues() {}
  linearRampToValueAtTime(v) { this.value = v; }
}

class FakeNode {
  constructor(ctx) {
    this.ctx = ctx;
    this.connections = [];
    this.frequency = new FakeParam(22050);
    this.gain = new FakeParam(1);
    this.threshold = new FakeParam(0);
    this.knee = new FakeParam(30);
    this.ratio = new FakeParam(12);
    this.attack = new FakeParam(0.003);
    this.release = new FakeParam(0.25);
    this.playbackRate = new FakeParam(1);
    this.Q = new FakeParam(1);
    this.delayTime = new FakeParam(0);
    this.curve = null;
    this.oversample = 'none';
  }
  connect(dest) { this.connections.push(dest); return dest; }
  disconnect() { this.connections.length = 0; }
}

class FakeSource extends FakeNode {
  constructor(ctx) {
    super(ctx);
    this.buffer = null;
    this.loop = false;
    this.startCalls = [];
    this.stopped = false;
    this.onended = null;
  }
  start(when = 0, offset = 0) { this.startCalls.push({ when, offset }); }
  stop() { this.stopped = true; }
}

class FakeBuffer {
  constructor(sampleRate = 44100, channels = 2, duration = 100) {
    this.sampleRate = sampleRate;
    this.numberOfChannels = channels;
    this.duration = duration;
  }
  getChannelData() { return new Float32Array(1024); }
}

class FakeAudioContext {
  constructor() {
    this.sampleRate = 44100;
    this.currentTime = 0;
    this.state = 'running';
    this.destination = new FakeNode(this);
    this.analyser = null;
    this.sources = [];
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  createAnalyser() {
    this.analyser = new FakeNode(this);
    this.analyser.fftSize = 2048;
    this.analyser.frequencyBinCount = 1024;
    this.analyser.getByteFrequencyData = (arr) => arr.fill(0);
    this.analyser.getByteTimeDomainData = (arr) => arr.fill(128);
    return this.analyser;
  }
  createBiquadFilter() { return new FakeNode(this); }
  createDynamicsCompressor() { return new FakeNode(this); }
  createConvolver() { return new FakeNode(this); }
  createGain() { return new FakeNode(this); }
  createDelay() { return new FakeNode(this); }
  createWaveShaper() { return new FakeNode(this); }
  createBufferSource() {
    const s = new FakeSource(this);
    this.sources.push(s);
    return s;
  }
  createBuffer(channels, len) {
    const b = new FakeBuffer(this.sampleRate, channels, len / this.sampleRate);
    b.getChannelData = () => new Float32Array(len);
    return b;
  }
  async decodeAudioData(buf, cb, err) {
    if ((this.failDecodeCount || 0) > 0) {
      this.failDecodeCount--;
      if (err) return err(new Error('corrupt'));
      throw new Error('corrupt');
    }
    if (cb) return cb(new FakeBuffer());
    return new FakeBuffer();
  }
}

function makeFile(name = 'song.mp3') {
  return {
    name,
    type: 'audio/mpeg',
    arrayBuffer: async () => new ArrayBuffer(16),
  };
}

describe('AudioEngine', () => {
  let engine;

  beforeEach(async () => {
    vi.resetModules();
    const { AudioEngine } = await import('../src/audio.js');
    globalThis.window = { AudioContext: FakeAudioContext };
    engine = new AudioEngine();
  });

  it('decodes a file and populates track meta', async () => {
    await engine.addToQueue([makeFile('My Track.wav')]);
    expect(engine.hasTrack).toBe(true);
    expect(engine.track.name).toBe('My Track');
    expect(engine.track.ext).toBe('WAV');
    expect(engine.track.sampleRate).toBe(44100);
    expect(engine.track.duration).toBe(100);
  });

  it('routes Apple Music through the external transport contract', () => {
    const calls = [];
    engine.setExternal({
      kind: 'apple',
      seed: 'apple-track',
      isPlaying: () => true,
      getTime: () => 12,
      getDuration: () => 180,
      play: () => calls.push('play'),
      pause: () => calls.push('pause'),
      seek: (value) => calls.push(['seek', value]),
      next: () => calls.push('next'),
      prev: () => calls.push('prev'),
    });

    expect(engine.activeInput).toBe('apple');
    expect(engine.getTime()).toBe(12);
    expect(engine.getDuration()).toBe(180);
    engine.play();
    engine.pause();
    engine.seek(24);
    engine.nextTrack();
    engine.prevTrack();
    expect(calls).toEqual(['play', 'pause', ['seek', 24], 'next', 'prev']);
  });

  it('play starts a source at current offset and marks playing', async () => {
    await engine.addToQueue([makeFile()]);
    engine.play();
    expect(engine.playing).toBe(true);
    expect(engine.source.startCalls.length).toBe(1);
    expect(engine.source.startCalls[0].offset).toBe(0);
  });

  it('pause stores offset and stops the source', async () => {
    await engine.addToQueue([makeFile()]);
    engine.play();
    engine.ctx.currentTime = 10;
    engine.pause();
    expect(engine.playing).toBe(false);
    expect(engine.offset).toBe(10);
    expect(engine.source).toBeNull();
  });

  it('seek clamps into range and restarts playback when playing', async () => {
    await engine.addToQueue([makeFile()]);
    engine.play();
    engine.seek(50);
    expect(engine.getTime()).toBeCloseTo(50, 5);
    engine.seek(9999);
    expect(engine.offset).toBeCloseTo(engine.buffer.duration - 0.05, 5);
  });

  it('getTime returns duration-capped elapsed while playing', async () => {
    await engine.addToQueue([makeFile()]);
    engine.play();
    engine.ctx.currentTime = 5;
    expect(engine.getTime()).toBe(5);
    engine.ctx.currentTime = 500;
    expect(engine.getTime()).toBe(engine.buffer.duration);
  });

  it('toggle flips playing state', async () => {
    await engine.addToQueue([makeFile()]);
    engine.toggle();
    expect(engine.playing).toBe(true);
    engine.toggle();
    expect(engine.playing).toBe(false);
  });

  it('queue: nextTrack and prevTrack cycle through tracks', async () => {
    await engine.addToQueue([makeFile('a.mp3'), makeFile('b.mp3'), makeFile('c.mp3')]);
    expect(engine.queueIndex).toBe(0);
    expect(engine.track.name).toBe('a');
    engine.nextTrack();
    expect(engine.queueIndex).toBe(1);
    expect(engine.track.name).toBe('b');
    expect(engine.playing).toBe(true);
    engine.prevTrack();
    expect(engine.queueIndex).toBe(0);
    expect(engine.track.name).toBe('a');
  });

  it('auto-advances to next queue item on natural end', async () => {
    await engine.addToQueue([makeFile('a.mp3'), makeFile('b.mp3')]);
    engine.play();
    expect(engine.queueIndex).toBe(0);
    engine.source.onended();
    expect(engine.queueIndex).toBe(1);
    expect(engine.playing).toBe(true);
    expect(engine.track.name).toBe('b');
  });

  it('loop mode repeats instead of advancing', async () => {
    await engine.addToQueue([makeFile('a.mp3'), makeFile('b.mp3')]);
    engine.loop = true;
    engine.play();
    expect(engine.source.loop).toBe(true);
    engine.source.onended();
    expect(engine.queueIndex).toBe(0);
  });

  it('fx toggles set node parameters', async () => {
    await engine.addToQueue([makeFile()]);
    engine.play();
    engine.setFx('reverb', true);
    expect(engine.reverbGain.gain.value).toBe(0.35);
    engine.setFx('limiter', true);
    expect(engine.compressor.threshold.value).toBe(-18);
    engine.setFx('lowpass', true);
    expect(engine.filter.frequency.value).toBe(400);
    engine.setFx('speed', true);
    expect(engine.speed).toBe(1.5);
    expect(engine.source.playbackRate.value).toBe(1.5);
  });

  it('volume and smoothing update node params', async () => {
    await engine.addToQueue([makeFile()]);
    engine.play();
    engine.setVolume(0.3);
    expect(engine.master.gain.value).toBe(0.3);
    engine.setSmoothing(0.5);
    expect(engine.analyser.smoothingTimeConstant).toBe(0.5);
  });

  it('getLevels returns zeroed bands with silent analyser and ticks bpm', async () => {
    await engine.addToQueue([makeFile()]);
    engine.play();
    const lv = engine.getLevels();
    expect(lv.bass).toBe(0);
    expect(lv.mid).toBe(0);
    expect(lv.high).toBe(0);
    expect(lv.level).toBe(0);
  });

  it('does not double-play while already playing', async () => {
    await engine.addToQueue([makeFile()]);
    engine.play();
    engine.play();
    expect(engine.source.startCalls.length).toBe(1);
  });

  it('removeFromQueue drops a later track without touching playback', async () => {
    await engine.addToQueue([makeFile('a.mp3'), makeFile('b.mp3'), makeFile('c.mp3')]);
    engine.play();
    engine.removeFromQueue(2);
    expect(engine.queue.length).toBe(2);
    expect(engine.queueIndex).toBe(0);
    expect(engine.playing).toBe(true);
    expect(engine.track.name).toBe('a');
  });

  it('removeFromQueue before the current track shifts the index', async () => {
    await engine.addToQueue([makeFile('a.mp3'), makeFile('b.mp3'), makeFile('c.mp3')]);
    engine.nextTrack();
    expect(engine.track.name).toBe('b');
    engine.removeFromQueue(0);
    expect(engine.queue.length).toBe(2);
    expect(engine.queueIndex).toBe(0);
    expect(engine.track.name).toBe('b');
  });

  it('removeFromQueue on the current track advances to next and keeps playing', async () => {
    await engine.addToQueue([makeFile('a.mp3'), makeFile('b.mp3'), makeFile('c.mp3')]);
    engine.play();
    engine.removeFromQueue(0);
    expect(engine.queue.length).toBe(2);
    expect(engine.track.name).toBe('b');
    expect(engine.playing).toBe(true);
  });

  it('removeFromQueue on the only track returns the engine to idle', async () => {
    await engine.addToQueue([makeFile('a.mp3'), makeFile('b.mp3')]);
    engine.play();
    engine.removeFromQueue(1);
    engine.removeFromQueue(0);
    expect(engine.hasTrack).toBe(false);
    expect(engine.playing).toBe(false);
    expect(engine.mode).toBe('none');
    expect(engine.activeInput).toBe('none');
  });

  it('removeFromQueue ignores out-of-range indices', async () => {
    await engine.addToQueue([makeFile('a.mp3')]);
    engine.removeFromQueue(-1);
    engine.removeFromQueue(5);
    expect(engine.queue.length).toBe(1);
  });

  it('shuffleQueue keeps every track exactly once with current first', async () => {
    await engine.addToQueue([
      makeFile('a.mp3'), makeFile('b.mp3'), makeFile('c.mp3'), makeFile('d.mp3'),
    ]);
    engine.play();
    engine.shuffleQueue();
    expect(engine.queue.length).toBe(4);
    expect(engine.queueIndex).toBe(0);
    const names = engine.queue.map((t) => t.meta.name).sort();
    expect(names).toEqual(['a', 'b', 'c', 'd']);
    expect(engine.playing).toBe(true);
    // playback continues uninterrupted: same buffer object still loaded
    expect(engine.source.startCalls.length).toBe(1);
  });

  it('getLevels with preFetched reuses cached frame (no double sampling)', async () => {
    await engine.addToQueue([makeFile()]);
    engine.play();
    let calls = 0;
    const orig = engine.getData.bind(engine);
    engine.getData = () => { calls++; return orig(); };
    const d = engine.getData();
    calls = 0;
    const lv = engine.getLevels(d);
    expect(calls).toBe(0);
    expect(lv).toHaveProperty('bass');
    expect(lv).toHaveProperty('beatPulse');
  });

  it('seek resets beat tracker (bpm/phase go to 0)', async () => {
    await engine.addToQueue([makeFile()]);
    engine.play();
    // fake a locked beat
    engine.beat.bpm = 120;
    engine.beat.phase = 0.5;
    engine.beat.confidence = 0.9;
    engine.beat.pulse = 1;
    engine.seek(10);
    expect(engine.beat.bpm).toBe(0);
    expect(engine.beat.phase).toBe(0);
    expect(engine.beat.confidence).toBe(0);
  });

  it('beatInfo exposes tempo prediction state', async () => {
    await engine.addToQueue([makeFile()]);
    engine.play();
    const info = engine.beatInfo;
    expect(info).toHaveProperty('bpm');
    expect(info).toHaveProperty('phase');
    expect(info).toHaveProperty('pulse');
    expect(info).toHaveProperty('confidence');
    expect(info.bpm).toBe(0);
    // feed rest then loud to generate spectral flux onset
    const rest = new Uint8Array(1024); rest.fill(40);
    const loud = new Uint8Array(1024); loud.fill(40); for (let i=0;i<16;i++) loud[i]=220;
    const t0 = engine.getTime();
    engine.beat.process(rest, t0);
    engine.beat.process(loud, t0 + 0.016);
    expect(engine.beatInfo.pulse).toBeGreaterThan(0);
  });

  it('chop FX toggles speed and filter and schedules gate', async () => {
    await engine.addToQueue([makeFile()]);
    engine.play();
    engine.setFx('chop', true);
    expect(engine.fx.chop).toBe(true);
    expect(engine.chopGate.gain.value).toBe(1);
    // should be slowed
    expect(engine.speed).toBe(0.66);
    engine.setFx('chop', false);
    expect(engine.fx.chop).toBe(false);
    expect(engine._chopTimer).toBeNull();
  });

  it('addToQueue skips corrupt files and returns their names', async () => {
    await engine.addToQueue([makeFile('good.mp3')]);
    engine.ctx.failDecodeCount = 2; // both promise + callback attempts fail for bad.mp3
    const errors = await engine.addToQueue([makeFile('bad.mp3'), makeFile('fine.mp3')]);
    expect(errors).toEqual(['bad.mp3']);
    expect(engine.queue.length).toBe(2);
    expect(engine.queue[1].meta.name).toBe('fine');
  });

  it('getLevels returns beat fields and handles null analyser', async () => {
    await engine.addToQueue([makeFile()]);
    engine.play();
    const lv = engine.getLevels();
    expect(lv).toHaveProperty('bpm');
    expect(lv).toHaveProperty('beatPhase');
    expect(lv).toHaveProperty('beatPulse');
    expect(lv).toHaveProperty('beatConfidence');
  });

  it('seeking while playing does not fire the ended handler', async () => {
    // src.stop() fires onended asynchronously; that handler used to treat the
    // stop as "track finished", clearing playing and advancing the queue, so
    // dragging the seek bar could jump to the next track
    await engine.addToQueue([makeFile('one.wav'), makeFile('two.wav')]);
    engine.play();
    const first = engine.source;
    engine.seek(12);
    expect(first.stopped).toBe(true);
    expect(first.onended).toBe(null);          // detached before stopping
    first.onended?.();                          // a late callback must be inert
    expect(engine.playing).toBe(true);
    expect(engine.queueIndex).toBe(0);
    expect(engine.source).not.toBe(first);
  });

  it('pause detaches the ended handler so a later play is not cancelled', async () => {
    await engine.addToQueue([makeFile('one.wav'), makeFile('two.wav')]);
    engine.play();
    const first = engine.source;
    engine.pause();
    expect(first.onended).toBe(null);
    engine.play();
    expect(engine.playing).toBe(true);
    expect(engine.queueIndex).toBe(0);
  });

  it('bounds decoded audio without losing queue entries', async () => {
    const many = Array.from({ length: 45 }, (_, i) => makeFile(`t${i}.wav`));
    await engine.addToQueue(many);
    // every track keeps its slot, but the far ones give up their buffer
    expect(engine.queue.length).toBe(45);
    expect(engine.evicted).toBeGreaterThan(0);
    expect(engine.queue.filter((q) => q.buffer).length).toBeLessThan(45);
    expect(engine.queue[engine.queueIndex].buffer).toBeTruthy();
    expect(engine.queue.every((q) => q.meta && q.file)).toBe(true);
  });

  it('reloads a released buffer when its track is selected', async () => {
    const many = Array.from({ length: 45 }, (_, i) => makeFile(`t${i}.wav`));
    await engine.addToQueue(many);
    const released = engine.queue.findIndex((q) => !q.buffer);
    expect(released).toBeGreaterThan(-1);
    engine.playTrack(released);
    await new Promise((r) => setTimeout(r, 0));
    expect(engine.queue[released].buffer).toBeTruthy();
    expect(engine.queueIndex).toBe(released);
  });
});
