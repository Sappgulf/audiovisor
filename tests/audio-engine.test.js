import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
    /* the stereo tap reads float samples; silence keeps the goniometer fed */
    this.analyser.getFloatTimeDomainData = (arr) => arr.fill(0);
    return this.analyser;
  }
  createChannelSplitter() { return new FakeNode(this); }
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
    expect(engine.getData()).toBeNull();
    expect(engine.getLevels().level).toBe(0);
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
    engine.repeat = true;
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

  it('clearQueue empties queue and resets file transport state', async () => {
    await engine.addToQueue([makeFile('a.mp3'), makeFile('b.mp3')]);
    engine.play();
    engine.clearQueue();
    expect(engine.queue.length).toBe(0);
    expect(engine.queueIndex).toBe(-1);
    expect(engine.track).toBeNull();
    expect(engine.buffer).toBeNull();
    expect(engine.source).toBeNull();
    expect(engine.playing).toBe(false);
    expect(engine.mode).toBe('none');
    expect(engine.hasTrack).toBe(false);
    expect(engine.activeInput).toBe('none');
  });

  it('clearQueue is safe when queue is already empty', async () => {
    await engine.addToQueue([makeFile('a.mp3')]);
    engine.removeFromQueue(0);
    expect(engine.activeInput).toBe('none');
    engine.clearQueue();
    expect(engine.queue.length).toBe(0);
    expect(engine.activeInput).toBe('none');
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
    expect(errors.map((e) => e.name)).toEqual(['bad.mp3']);
    expect(errors[0].error).toBeTruthy();
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

describe('latency compensation at the engine boundary', () => {
  let engine;

  beforeEach(async () => {
    vi.resetModules();
    const { AudioEngine } = await import('../src/audio.js');
    globalThis.window = { AudioContext: FakeAudioContext };
    engine = new AudioEngine();
    await engine.addToQueue([makeFile()]);
  });

  it('sums output and base latency on a normal wired setup', () => {
    engine.play();
    engine.ctx.outputLatency = 0.12;
    engine.ctx.baseLatency = 0.01;
    expect(engine.outputLatency()).toBeCloseTo(0.13, 6);
  });

  it('clamps an oversized Bluetooth report instead of dropping compensation', () => {
    /* a dongle reporting 0.56s used to fall past the sanity ceiling and
       return ZERO — the grid then fired half a second early every beat,
       which is far worse than clipping the estimate */
    engine.play();
    engine.ctx.outputLatency = 0.56;
    engine.ctx.baseLatency = 0.01;
    expect(engine.outputLatency()).toBe(0.5);
  });

  it('returns zero when the browser reports nothing usable', () => {
    delete engine.ctx.outputLatency;
    delete engine.ctx.baseLatency;
    expect(engine.outputLatency()).toBe(0);
  });
});

describe('getLevels content window', () => {
  let engine;

  beforeEach(async () => {
    vi.resetModules();
    const { AudioEngine } = await import('../src/audio.js');
    globalThis.window = { AudioContext: FakeAudioContext };
    engine = new AudioEngine();
    await engine.addToQueue([makeFile()]);
    engine.play();
  });

  it('does not dilute level with the silent bins above ~16kHz', () => {
    /* flat mid content across bins 2..743 and nothing above: the average
       must run over the content window only, not all 1024 bins — the old
       full-spectrum mean measured this track at ~72% of its real loudness */
    engine.analyser.getByteFrequencyData = (arr) => {
      for (let i = 0; i < arr.length; i++) arr[i] = i < 744 ? 100 : 0;
    };
    const lv = engine.getLevels();
    expect(lv.level).toBeCloseTo(100 / 255, 5);
  });

  it('keeps cymbal air beyond 8kHz in the high band', () => {
    /* energy only in the ~9-15kHz air band: the old band stopped at 8kHz
       and read it as silence, so hats never reached uHigh (this fill
       measured exactly 0 before) */
    engine.analyser.getByteFrequencyData = (arr) => {
      for (let i = 0; i < arr.length; i++) arr[i] = i >= 440 && i < 700 ? 200 : 0;
    };
    const lv = engine.getLevels();
    // 260 lit bins inside the 652-bin high window
    expect(lv.high).toBeCloseTo((200 * 260) / (744 - 92) / 255, 5);
    expect(lv.bass).toBe(0);
    expect(lv.mid).toBe(0);
  });
});

describe('stereo width', () => {
  let stereoWidth;

  beforeEach(async () => {
    vi.resetModules();
    ({ stereoWidth } = await import('../src/audio.js'));
  });

  const sine = (n, phase = 0) => {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = Math.sin((i / n) * Math.PI * 8 + phase);
    return a;
  };

  it('reads mono (dual-mono or silence) as 0', () => {
    const m = sine(512);
    expect(stereoWidth(m, m.slice())).toBe(0);
    expect(stereoWidth(new Float32Array(512), new Float32Array(512))).toBe(0);
  });

  it('reads opposite-phase material as fully wide', () => {
    expect(stereoWidth(sine(512), sine(512, Math.PI))).toBeCloseTo(1, 5);
  });

  it('reads decorrelated sides around the middle, panned mono near zero', () => {
    let s = 1234;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280) * 2 - 1;
    const l = new Float32Array(512);
    const r = new Float32Array(512);
    for (let i = 0; i < 512; i++) { l[i] = rnd(); r[i] = rnd(); }
    const wide = stereoWidth(l, r);
    expect(wide).toBeGreaterThan(0.35);
    expect(wide).toBeLessThan(0.65);
    const c = sine(512);
    const d = sine(512, 0.7);
    const mostlyMono = stereoWidth(
      c.map((v, i) => 0.8 * v + 0.2 * d[i]),
      c.map((v, i) => 0.8 * v - 0.2 * d[i]),
    );
    expect(mostlyMono).toBeLessThan(0.15);
  });

  it('returns 0 for missing, mismatched or tiny inputs', () => {
    expect(stereoWidth(null, null)).toBe(0);
    expect(stereoWidth(new Float32Array(64), null)).toBe(0);
    expect(stereoWidth(new Float32Array(4), new Float32Array(4))).toBe(0);
  });

  it('carries width through getLevels, defaulting to mono without a tap', async () => {
    vi.resetModules();
    const { AudioEngine } = await import('../src/audio.js');
    globalThis.window = { AudioContext: FakeAudioContext };
    const engine = new AudioEngine();
    await engine.addToQueue([makeFile()]);
    engine.play();
    // tapless analysers fill silence: no L/R difference to measure
    expect(engine.getLevels().width).toBe(0);
    // injected L/R pair flows into levels
    const l = sine(2048);
    const lv = engine.getLevels({
      freq: new Uint8Array(1024),
      stereoL: l,
      stereoR: l.map((v) => -v),
    });
    expect(lv.width).toBeCloseTo(1, 3);
  });
});

describe('playback clock, transitions and recovery', () => {
  let engine;

  beforeEach(async () => {
    vi.resetModules();
    const { AudioEngine } = await import('../src/audio.js');
    globalThis.window = { AudioContext: FakeAudioContext };
    engine = new AudioEngine();
  });

  it('advances the song position at the playback rate, not wall time', async () => {
    await engine.addToQueue([makeFile()]);
    engine.play();
    engine.setSpeed(1.5);
    engine.ctx.currentTime = 10;
    expect(engine.getTime()).toBeCloseTo(15, 5);
  });

  it('a mid-song rate change keeps the playhead where it was', async () => {
    await engine.addToQueue([makeFile()]);
    engine.play();
    engine.ctx.currentTime = 4;
    engine.setSpeed(2);
    expect(engine.getTime()).toBeCloseTo(4, 5);
    engine.ctx.currentTime = 5;
    expect(engine.getTime()).toBeCloseTo(6, 5);
  });

  it('seeking at a non-unit rate lands on the requested time', async () => {
    await engine.addToQueue([makeFile()]);
    engine.setSpeed(1.5);
    engine.play();
    engine.seek(30);
    engine.ctx.currentTime = 2;
    expect(engine.getTime()).toBeCloseTo(33, 5);
  });

  it('crossfade fades the outgoing track instead of cutting it', async () => {
    await engine.addToQueue([makeFile('a.mp3'), makeFile('b.mp3')]);
    engine.play();
    const outgoing = engine.sourceGain;
    engine.crossfadeTo(1, 4);
    expect(outgoing.connections).toContain(engine.filter);
    expect(engine.queueIndex).toBe(1);
  });

  it('crossfade refreshes the queue UI like any other track change', async () => {
    await engine.addToQueue([makeFile('a.mp3'), makeFile('b.mp3')]);
    engine.play();
    const onChange = vi.fn();
    engine.onQueueChange = onChange;
    engine.crossfadeTo(1, 4);
    expect(onChange).toHaveBeenCalled();
  });

  it('a late reload for a replaced queue does not overwrite the new track', async () => {
    await engine.addToQueue([makeFile('old.wav')]);
    engine.queue[0].buffer = null; // as if released under memory pressure
    engine.playTrack(0);           // starts reloading the old file
    engine.clearQueue();
    await engine.addToQueue([makeFile('new.wav')]);
    await new Promise((r) => setTimeout(r, 10));
    expect(engine.track.name).toBe('new');
    expect(engine.buffer).toBe(engine.queue[0].buffer);
  });

  it('a failed reload of a released track reports it and stops', async () => {
    await engine.addToQueue([makeFile('a.wav'), makeFile('b.wav')]);
    engine.queue[1].buffer = null;
    const errors = [];
    engine.on('error', (m) => errors.push(m));
    engine.ctx.failDecodeCount = 2;
    engine.playTrack(1);
    await new Promise((r) => setTimeout(r, 10));
    expect(engine.playing).toBe(false);
    expect(errors.length).toBe(1);
  });

  it('FX chosen before the audio context exists reach the nodes once it is built', async () => {
    engine.setFx('reverb', true);
    await engine.addToQueue([makeFile()]);
    expect(engine.reverbGain.gain.value).toBe(0.35);
  });

  it('resumes a context the OS interrupted (phone call, lock screen)', async () => {
    await engine.addToQueue([makeFile()]);
    engine.ctx.state = 'interrupted';
    engine.play();
    expect(engine.ctx.state).toBe('running');
  });

  it('a stream blocked by the autoplay policy reads paused, not as a failed stream', async () => {
    const realAudio = globalThis.Audio;
    globalThis.Audio = class {
      constructor() { this.src = ''; this.paused = true; }
      addEventListener() {}
      removeAttribute() {}
      load() {}
      pause() { this.paused = true; }
      play() {
        const err = new Error('play() was not allowed');
        err.name = 'NotAllowedError';
        return Promise.reject(err);
      }
    };
    try {
      engine.ctx = null;
      engine._ensureCtx();
      engine.ctx.createMediaElementSource = () => new FakeNode(engine.ctx);
      const errors = [];
      engine.on('error', (m) => errors.push(m));
      await engine.playUrl('https://example.com/live.mp3', { name: 'Live' });
      expect(engine.playing).toBe(false);
      expect(engine.streamNoTap).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      globalThis.Audio = realAudio;
    }
  });

  it('a second mic enable during the permission prompt keeps only one stream', async () => {
    await engine.addToQueue([makeFile()]);
    const tracks = [];
    const prev = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: async () => {
            const t = { stop: vi.fn() };
            tracks.push(t);
            return { getTracks: () => [t] };
          },
        },
      },
    });
    engine.ctx.createMediaStreamSource = () => new FakeNode(engine.ctx);
    try {
      await Promise.all([engine.enableMic(), engine.enableMic()]);
      expect(tracks.length).toBe(2);
      expect(tracks.filter((t) => t.stop.mock.calls.length > 0).length).toBe(1);
    } finally {
      if (prev) Object.defineProperty(globalThis, 'navigator', prev);
      else delete globalThis.navigator;
    }
  });
});

describe('graph hygiene: sources, crossfade and resume', () => {
  let engine;

  beforeEach(async () => {
    vi.resetModules();
    const { AudioEngine } = await import('../src/audio.js');
    globalThis.window = { AudioContext: FakeAudioContext };
    engine = new AudioEngine();
  });

  it('play retires a source it replaces instead of letting two run', async () => {
    await engine.addToQueue([makeFile()]);
    engine.play();
    const first = engine.source;
    // a rehydrate clears `playing` and calls play() again
    engine.playing = false;
    engine.play();
    expect(first.stopped).toBe(true);
    expect(first.onended).toBeNull();
    expect(engine.source).not.toBe(first);
  });

  it('crossfade into an unloaded track starts no silent source', async () => {
    await engine.addToQueue([makeFile('a.wav'), makeFile('b.wav')]);
    engine.play();
    engine.queue[1].buffer = null;          // released under memory pressure
    engine.crossfadeTo(1, 0.1);
    expect(engine.queueIndex).toBe(0);      // waits for the decode
    await new Promise((r) => setTimeout(r, 0));
    expect(engine.queueIndex).toBe(1);
    const started = engine.ctx.sources.filter((s) => s.startCalls.length > 0);
    expect(started.length).toBeGreaterThan(0);
    expect(started.filter((s) => !s.buffer)).toHaveLength(0);
  });

  it('a resume from suspend restarts the beat grid settle window', async () => {
    await engine.addToQueue([makeFile()]);
    engine.play();
    const spy = vi.spyOn(engine.beat, 'settle');
    engine.ctx.state = 'suspended';
    engine.ctx.state = 'running';
    engine.ctx.onstatechange?.();
    expect(spy).toHaveBeenCalledWith(0.6);
  });
});

describe('beat clock contract', () => {
  let engine;

  beforeEach(async () => {
    vi.resetModules();
    const { AudioEngine } = await import('../src/audio.js');
    globalThis.window = { AudioContext: FakeAudioContext };
    engine = new AudioEngine();
    await engine.addToQueue([makeFile()]);
  });

  it('beatPhase, beatConfidence and beatCount are zero with no tempo', () => {
    expect(engine.beatPhase).toBe(0);
    expect(engine.beatConfidence).toBe(0);
    expect(engine.beatCount).toBe(0);
  });

  it('beatPhase is latency-compensated and always in [0, 1)', () => {
    engine.ctx.currentTime = 0;
    engine.play();
    engine.ctx.currentTime = 2.0;
    engine.tapTempo(5000);
    engine.ctx.currentTime = 2.5;
    engine.tapTempo(5500);             // grid now on 120 BPM, a beat at 2.5s
    engine.ctx.currentTime = 2.5;
    expect(engine.beatPhase).toBeCloseTo(0, 6);
    engine.ctx.currentTime = 2.75;
    expect(engine.beatPhase).toBeCloseTo(0.5, 6);

    // a 100ms output latency means the listener is 100ms behind the graph
    engine.ctx.outputLatency = 0.1;
    engine.ctx.currentTime = 2.5;
    expect(engine.beatPhase).toBeCloseTo(0.8, 6);
    for (let t = 0; t < 4; t += 0.037) {
      engine.ctx.currentTime = t;
      expect(engine.beatPhase).toBeGreaterThanOrEqual(0);
      expect(engine.beatPhase).toBeLessThan(1);
    }
  });

  it('outputLatencyMs reports the compensated latency in milliseconds', () => {
    engine.ctx.outputLatency = 0.12;
    engine.ctx.baseLatency = 0.01;
    expect(engine.outputLatencyMs).toBeCloseTo(130, 6);
    delete engine.ctx.outputLatency;
    delete engine.ctx.baseLatency;
    expect(engine.outputLatencyMs).toBe(0);
    expect(Number.isNaN(engine.outputLatencyMs)).toBe(false);
  });

  it('beatPhase follows the playback rate: a 1.5x run keeps the grid on the song', () => {
    engine.ctx.currentTime = 0;
    engine.play();
    engine.ctx.currentTime = 1;
    engine.tapTempo(9000);
    engine.ctx.currentTime = 1.5;
    engine.tapTempo(9500);             // beat at song time 1.5s
    engine.setSpeed(1.5);
    // a 1.5x rate covers 0.5 song seconds in a third of a wall second
    engine.ctx.currentTime = 1.5 + 1 / 3;
    expect(engine.getTime()).toBeCloseTo(2.0, 6);
    // on the beat, which reads as 0 or a hair under 1 after float rounding
    const p = engine.beatPhase;
    expect(Math.min(p, 1 - p)).toBeCloseTo(0, 5);
  });

  it('chop wobble does not drift the song clock', () => {
    vi.useFakeTimers();
    try {
      engine.ctx.currentTime = 0;
      engine.play();
      engine.setFx('chop', true);
      engine.ctx.currentTime = 1;
      const before = engine.startedAt;
      vi.advanceTimersByTime(420);
      // the wobble plays about 13ms less song than the clock counts
      expect(engine.startedAt - before).toBeCloseTo(0.0132, 6);
      engine.setFx('chop', false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('turning chop off restores the rate the speed FX asked for', async () => {
    await engine.addToQueue([makeFile()]);
    engine.setFx('speed', true);
    engine.play();
    expect(engine.speed).toBe(1.5);
    engine.setFx('chop', true);
    engine.setFx('chop', false);
    expect(engine.speed).toBe(1.5);
    expect(engine.source.playbackRate.value).toBe(1.5);
  });
});

describe('tap tempo', () => {
  let engine;

  beforeEach(async () => {
    vi.resetModules();
    const { AudioEngine } = await import('../src/audio.js');
    globalThis.window = { AudioContext: FakeAudioContext };
    engine = new AudioEngine();
    await engine.addToQueue([makeFile()]);
    engine.play();
  });

  it('needs two taps before it reports a tempo', () => {
    expect(engine.tapTempo(1000)).toBeNull();
    const r = engine.tapTempo(1500);
    expect(r.bpm).toBe(120);
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it('ignores taps closer than 200ms to the last one', () => {
    engine.tapTempo(1000);
    engine.tapTempo(1500);
    expect(engine.tapTempo(1550).bpm).toBe(120);
    expect(engine._taps).toHaveLength(2);
  });

  it('starts a new run after 2.5s of silence', () => {
    engine.tapTempo(1000);
    engine.tapTempo(1500);
    expect(engine.tapTempo(4100)).toBeNull();
    expect(engine._taps).toEqual([4100]);
  });

  it('uses only the last eight taps', () => {
    for (let i = 0; i < 12; i++) engine.tapTempo(1000 + i * 500);
    expect(engine._taps.length).toBe(8);
    expect(engine.tapTempo(1000 + 12 * 500).bpm).toBe(120);
  });

  it('a steady tap run scores higher than a ragged one', () => {
    const steady = [1000, 1500, 2000, 2500].map((t) => engine.tapTempo(t));
    // 3.5s later is a new run
    const ragged = [6000, 6260, 6780, 7100].map((t) => engine.tapTempo(t));
    expect(steady.at(-1).confidence).toBeGreaterThan(ragged.at(-1).confidence);
  });
});

describe('A-B loop', () => {
  let engine;

  beforeEach(async () => {
    vi.resetModules();
    const { AudioEngine } = await import('../src/audio.js');
    globalThis.window = { AudioContext: FakeAudioContext };
    engine = new AudioEngine();
    await engine.addToQueue([makeFile('a.wav'), makeFile('b.wav')]);
  });

  afterEach(() => engine.clearLoop());

  it('rejects start >= end and leaves no region behind', () => {
    expect(engine.setLoop(10, 5)).toBeNull();
    expect(engine.setLoop(7, 7)).toBeNull();
    expect(engine.loop).toBeNull();
  });

  it('clamps the region to the track', () => {
    expect(engine.setLoop(-5, 1000)).toEqual({ start: 0, end: 100 });
    expect(engine.loop).toEqual({ start: 0, end: 100 });
  });

  it('wraps to the start without resetting the beat grid', () => {
    engine.ctx.currentTime = 0;
    engine.play();
    engine.setLoop(10, 20);
    const spy = vi.spyOn(engine.beat, 'reset');
    engine.ctx.currentTime = 21;
    engine.getLevels();
    expect(engine.getTime()).toBeCloseTo(10, 6);
    expect(spy).not.toHaveBeenCalled();
    const last = engine.source.startCalls.at(-1);
    expect(last.offset).toBe(10);
  });

  it('wraps through the source-ended path when the region reaches the end of the file', () => {
    engine.ctx.currentTime = 0;
    engine.play();
    engine.setLoop(50, 100);
    const src = engine.source;
    src.onended();
    expect(engine.playing).toBe(true);
    expect(engine.getTime()).toBeCloseTo(50, 6);
  });

  it('survives pause and resume', () => {
    engine.setLoop(10, 20);
    engine.play();
    engine.pause();
    engine.play();
    expect(engine.loop).toEqual({ start: 10, end: 20 });
  });

  it('is cleared when another track loads', () => {
    engine.setLoop(10, 20);
    engine.playTrack(1);
    expect(engine.loop).toBeNull();
  });

  it('needs a loaded file; streams and idle engines get null', () => {
    const idle = new (engine.constructor)();
    expect(idle.setLoop(1, 2)).toBeNull();
  });
});

describe('sleep fade output scale', () => {
  let engine;

  beforeEach(async () => {
    vi.resetModules();
    const { AudioEngine } = await import('../src/audio.js');
    globalThis.window = { AudioContext: FakeAudioContext };
    engine = new AudioEngine();
    await engine.addToQueue([makeFile()]);
  });

  it('scales the master gain without touching the user volume', () => {
    engine.setVolume(0.8);
    engine.setOutputScale(0.5);
    expect(engine.master.gain.value).toBeCloseTo(0.4, 6);
    expect(engine.volume).toBe(0.8);
    // a slider moved during the fade lands on the faded output
    engine.setVolume(0.6);
    expect(engine.master.gain.value).toBeCloseTo(0.3, 6);
    engine.setOutputScale(1);
    expect(engine.master.gain.value).toBeCloseTo(0.6, 6);
    expect(engine.volume).toBe(0.6);
  });
});

describe('decoded metadata for the library and failure messages', () => {
  let engine;

  beforeEach(async () => {
    vi.resetModules();
    const { AudioEngine } = await import('../src/audio.js');
    globalThis.window = { AudioContext: FakeAudioContext };
    engine = new AudioEngine();
  });

  it('tags a video container as kind video and keeps the full file name', async () => {
    const d = await engine.decodeFile(makeFile('Clip.MP4'));
    expect(d.meta.kind).toBe('video');
    expect(d.meta.fileName).toBe('Clip.MP4');
    expect(d.meta.name).toBe('Clip');
  });

  it('tags an audio file as kind audio', async () => {
    const d = await engine.decodeFile(makeFile('song.mp3'));
    expect(d.meta.kind).toBe('audio');
    expect(d.meta.fileName).toBe('song.mp3');
  });

  it('reports a failed file as { name, error } with the decode error attached', async () => {
    await engine.addToQueue([makeFile('warm.mp3')]);
    engine.ctx.failDecodeCount = 2;
    const errors = await engine.addToQueue([makeFile('bad.mp4')]);
    expect(errors).toHaveLength(1);
    expect(errors[0].name).toBe('bad.mp4');
    expect(errors[0].error).toBeInstanceOf(Error);
  });
});

describe('queued stream items (addUrlItems)', () => {
  let engine;
  const URL_A = 'https://a.test/x.mp3';

  beforeEach(async () => {
    vi.resetModules();
    const { AudioEngine } = await import('../src/audio.js');
    globalThis.window = { AudioContext: FakeAudioContext };
    engine = new AudioEngine();
  });

  afterEach(() => {
    engine.clearLoop();
    delete globalThis.Audio;
  });

  it('pushes one entry per http(s) item and skips every other scheme', () => {
    engine.addUrlItems([
      { url: URL_A, name: 'X', meta: { name: 'X', ext: 'MP3' } },
      { url: 'ftp://h.test/x.mp3' },
      { url: 'javascript:alert(1)' },
      { url: 'not a url' },
      { url: 'http://b.test/y.m3u8', name: 'Y' },
    ]);
    expect(engine.queue).toHaveLength(2);
    expect(engine.queue[0]).toMatchObject({ url: URL_A, buffer: null, file: null });
    expect(engine.queue[0].meta).toMatchObject({ name: 'X', ext: 'MP3' });
    expect(engine.queue[1].meta.name).toBe('Y');
  });

  it('selects index 0 when nothing was selected, and reports the queue change', () => {
    engine.onQueueChange = vi.fn();
    expect(engine.queueIndex).toBe(-1);
    engine.addUrlItems([{ url: URL_A, name: 'X' }]);
    expect(engine.queueIndex).toBe(0);
    expect(engine.onQueueChange).toHaveBeenCalledTimes(1);
    engine.addUrlItems([{ url: 'https://c.test/z.mp3', name: 'Z' }]);
    expect(engine.queueIndex).toBe(0);
  });

  it('selecting a stream item hands its url to playUrl', () => {
    engine.addUrlItems([{ url: URL_A, name: 'X' }]);
    engine.playUrl = vi.fn(() => Promise.resolve());
    engine.playTrack(0);
    expect(engine.playUrl).toHaveBeenCalledWith(URL_A, expect.objectContaining({ name: 'X' }));
  });

  it('auto-advancing from a file onto a stream item plays the stream, not silence', async () => {
    await engine.addToQueue([makeFile('local.mp3')]);
    engine.addUrlItems([{ url: URL_A, name: 'X' }]);
    engine.playUrl = vi.fn(() => Promise.resolve());
    engine.play();
    engine.source.onended();
    expect(engine.playUrl).toHaveBeenCalledWith(URL_A, expect.objectContaining({ name: 'X' }));
  });

  it('play() loads a selected but unloaded stream item', () => {
    class FakeAudioEl {
      constructor() { this.src = ''; }
      addEventListener() {}
      removeAttribute() {}
      load() {}
      pause() {}
      play() { return Promise.resolve(); }
    }
    globalThis.Audio = FakeAudioEl;
    engine.addUrlItems([{ url: URL_A, name: 'X' }]);
    engine.play();
    expect(engine.mode).toBe('stream');
    expect(engine.streamTrack.url).toBe(URL_A);
    expect(engine.playing).toBe(true);
  });

  it('crossfading into a stream item switches to it outright', async () => {
    await engine.addToQueue([makeFile('local.mp3')]);
    engine.addUrlItems([{ url: URL_A, name: 'X' }]);
    engine.playTrack = vi.fn();
    engine.crossfadeTo(1);
    expect(engine.playTrack).toHaveBeenCalledWith(1);
  });
});

describe('repeat and the A-B loop are separate', () => {
  let engine;

  beforeEach(async () => {
    vi.resetModules();
    const { AudioEngine } = await import('../src/audio.js');
    globalThis.window = { AudioContext: FakeAudioContext };
    engine = new AudioEngine();
  });

  it('loop is null by default and repeat is false', () => {
    expect(engine.loop).toBeNull();
    expect(engine.repeat).toBe(false);
  });

  it('repeat toggles as a boolean without touching the A-B loop', async () => {
    await engine.addToQueue([makeFile('a.mp3'), makeFile('b.mp3')]);
    engine.repeat = !engine.repeat;
    expect(engine.repeat).toBe(true);
    engine.setLoop(10, 20);
    expect(engine.loop).toEqual({ start: 10, end: 20 });
    expect(engine.repeat).toBe(true);
    engine.repeat = !engine.repeat;
    expect(engine.repeat).toBe(false);
    expect(engine.loop).toEqual({ start: 10, end: 20 });
    engine.clearLoop();
    expect(engine.loop).toBeNull();
  });
});
