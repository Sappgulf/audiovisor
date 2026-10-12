import { describe, it, expect } from 'vitest';
import { AudioEngine } from '../src/audio.js';
import { BeatTracker } from '../src/beattracker.js';

const FRAME = 1 / 60;

/* A 120 BPM grid (a beat every 0.5s) with an accent on every fourth beat, fed
   at 60Hz like the render loop. `before(t)` runs ahead of each frame. */
function run(bt, { to, latency = 0, before = () => {} }) {
  const rest = new Uint8Array(64).fill(40);
  const hit = new Uint8Array(64).fill(40);
  for (let i = 0; i < 16; i++) hit[i] = 220;
  const out = [];
  for (let t = 0; t <= to + 1e-9; t += FRAME) {
    before(t);
    const n = Math.round(t / 0.5);
    const onBeat = Math.abs(t - n * 0.5) < FRAME * 0.6;
    const bass = Math.abs(t - n * 0.5) < 0.25 ? (n % 4 === 0 ? 0.9 : 0.25) : 0.05;
    bt.process(onBeat ? hit : rest, t, latency, bass);
    out.push({ t, beats: bt.beats, bar: bt.beatInBar, bpm: bt.bpm, phase: bt.phase, conf: bt.confidence });
  }
  return out;
}

/* Engine whose beat clock reads ctx.currentTime, locked to 120 BPM with a beat at song 0. */
function clockEngine() {
  const engine = new AudioEngine();
  engine.ctx = { currentTime: 0 };
  engine.micActive = true;
  engine.beat.nudgeTo(0, 120, 0.9);
  return engine;
}

describe('syncOffsetMs on the engine', () => {
  it('defaults to 0', () => {
    expect(new AudioEngine().syncOffsetMs).toBe(0);
  });

  it('clamps to -300..300 ms', () => {
    const engine = new AudioEngine();
    engine.syncOffsetMs = 500;
    expect(engine.syncOffsetMs).toBe(300);
    engine.syncOffsetMs = -500;
    expect(engine.syncOffsetMs).toBe(-300);
    engine.syncOffsetMs = 120;
    expect(engine.syncOffsetMs).toBe(120);
  });

  it('ignores non-finite values and keeps the previous one', () => {
    const engine = new AudioEngine();
    engine.syncOffsetMs = 150;
    for (const bad of [NaN, Infinity, -Infinity, undefined, '50']) {
      engine.syncOffsetMs = bad;
      expect(engine.syncOffsetMs).toBe(150);
    }
  });

  it('moves beatPhase by the offset at a known time (120 BPM is 2 beats a second)', () => {
    const engine = clockEngine();
    engine.ctx.currentTime = 1.0;   // exactly on beat 2
    expect(engine.beatPhase).toBeCloseTo(0, 9);
    engine.syncOffsetMs = 100;      // visuals lead by 0.1s: 0.2 of a beat
    expect(engine.beatPhase).toBeCloseTo(0.2, 9);
    engine.syncOffsetMs = -100;     // lagging wraps back to 0.8 of the previous beat
    expect(engine.beatPhase).toBeCloseTo(0.8, 9);
    engine.syncOffsetMs = 300;
    expect(engine.beatPhase).toBeCloseTo(0.6, 9);
  });

  it('changing the offset keeps the beat lock, tempo, count and display tempo', () => {
    const engine = clockEngine();
    engine.beat.beats = 7;
    const before = { bpm: engine.beat.bpm, conf: engine.beatConfidence, count: engine.beatCount,
      bar: engine.beatInBar, shown: engine.displayBpm };
    engine.syncOffsetMs = 250;
    expect(engine.beat.bpm).toBe(before.bpm);
    expect(engine.beatConfidence).toBe(before.conf);
    expect(engine.beatCount).toBe(before.count);
    expect(engine.beatInBar).toBe(before.bar);
    expect(engine.displayBpm).toBe(before.shown);
    expect(engine.beat._anchor).toBe(0);
  });
});

describe('the lead on the beat tracker', () => {
  it('moves the grid phase by lead x bpm / 60', () => {
    const a = new BeatTracker();
    const b = new BeatTracker();
    b.leadSec = 0.1;                      // 0.1s x 2 beats/s = 0.2 of a beat
    const outA = run(a, { to: 6 });
    const outB = run(b, { to: 6 });
    const i = Math.round(5 / FRAME);
    expect(a.bpm).toBeCloseTo(120, 0);
    const delta = (outB[i].phase - outA[i].phase + 1) % 1;
    expect(delta).toBeCloseTo(0.2, 2);
  });

  it('counts each beat earlier by the lead, to within a frame', () => {
    const a = new BeatTracker();
    const b = new BeatTracker();
    b.leadSec = 0.1;
    const outA = run(a, { to: 8 });
    const outB = run(b, { to: 8 });
    const firstRise = (out) => out.find((s, i) => i > 0 && s.t >= 4 && s.beats > out[i - 1].beats).t;
    const gap = firstRise(outA) - firstRise(outB);
    expect(Math.abs(gap - 0.1)).toBeLessThanOrEqual(FRAME + 1e-9);
  });

  it('a lead set mid-song keeps the lock, the tempo and a count that never falls', () => {
    const bt = new BeatTracker();
    const out = run(bt, { to: 10, before: (t) => { if (t >= 5 && bt.leadSec === 0) bt.leadSec = 0.3; } });
    const at = out[Math.round(5 / FRAME)];
    expect(at.bpm).toBeGreaterThan(0);
    for (const s of out.filter((x) => x.t >= 5)) expect(s.bpm).toBe(at.bpm);
    for (let i = 1; i < out.length; i++) expect(out[i].beats).toBeGreaterThanOrEqual(out[i - 1].beats);
  });

  it('once the downbeat has settled, the bar moves only with the beat count, lead change or not', () => {
    // the bar can be re-judged while it settles; after that a lead change must not move it
    const bt = new BeatTracker();
    const out = run(bt, { to: 16, before: (t) => { if (t >= 12 && bt.leadSec === 0) bt.leadSec = 0.3; } });
    for (let i = Math.round(10 / FRAME) + 1; i < out.length; i++) {
      if (out[i].bar !== out[i - 1].bar) expect(out[i].beats).not.toBe(out[i - 1].beats);
    }
  });

  it('the downbeat stays on the accent under latency and a lead', () => {
    // beatInBar is the song beat index the visuals show, mod 4, once the accent is learnt
    for (const [latency, lead] of [[0, 0], [0.3, 0], [0.3, 0.3]]) {
      const bt = new BeatTracker();
      bt.leadSec = lead;
      const out = run(bt, { to: 14, latency });
      for (const s of out.filter((x) => x.t >= 10)) {
        const x = (s.t - latency + lead) * 2;
        if (x % 1 < 0.1 || x % 1 > 0.9) continue;      // skip frames on a beat edge
        expect(s.bar).toBe(Math.floor(x) % 4);
      }
    }
  });
});
