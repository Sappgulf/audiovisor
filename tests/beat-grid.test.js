import { describe, it, expect } from 'vitest';
import { BeatTracker } from '../src/beattracker.js';

/* Steady pulses at `spacing` seconds, fed at 60Hz like the render loop. */
function feed(bt, { from = 0, to, spacing, step = 1 / 60, onsetAt = () => null }) {
  const rest = new Uint8Array(64).fill(40);
  const hit = new Uint8Array(64).fill(40);
  for (let i = 0; i < 16; i++) hit[i] = 220;
  const seen = [];
  for (let t = from; t <= to; t += step) {
    const beat = Math.round(t / spacing);
    const isOnset = Math.abs(t - beat * spacing) < step * 0.6 || onsetAt(t);
    bt.process(isOnset ? hit : rest, t);
    seen.push(bt.pulse);
  }
  return seen;
}

describe('grid phase', () => {
  it('phaseAt is always in [0, 1), including negative and far-away positions', () => {
    const bt = new BeatTracker();
    feed(bt, { to: 8, spacing: 0.5 });
    for (const t of [-7.3, -0.0001, 0, 0.25, 0.4999999, 0.5, 123.456, 1e6]) {
      const p = bt.phaseAt(t);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
    }
  });

  it('phaseAt is 0 with no tempo', () => {
    expect(new BeatTracker().phaseAt(3.3)).toBe(0);
  });

  it('nudgeTo lands a beat on the given song position and seeds an unlocked tempo', () => {
    const bt = new BeatTracker();
    bt.nudgeTo(2.0, 100, 0.5);
    expect(bt.bpm).toBe(100);
    expect(bt.confidence).toBeCloseTo(0.5, 6);
    expect(bt.phaseAt(2.0)).toBe(0);
    // half a 100 BPM beat (0.3s) later
    expect(bt.phaseAt(2.3)).toBeCloseTo(0.5, 6);
  });

  it('nudgeTo moves the phase of a locked grid without changing its tempo', () => {
    const bt = new BeatTracker();
    feed(bt, { to: 10, spacing: 0.5 });
    const locked = bt.bpm;
    bt.nudgeTo(10.1, 90, 0.9);
    expect(bt.bpm).toBe(locked);
    expect(bt.phaseAt(10.1)).toBe(0);
  });
});

describe('tempo stability', () => {
  it('a single outlier interval does not change the locked tempo', () => {
    const bt = new BeatTracker();
    feed(bt, { to: 12, spacing: 0.5, onsetAt: (t) => (t > 11.0 && t < 11.02 ? true : null) });
    const before = bt.bpm;
    expect(before).toBeGreaterThan(118);
    expect(before).toBeLessThan(122);
    // one stray hit half a beat after the grid, then the grid carries on
    feed(bt, { from: 12, to: 14, spacing: 0.5, onsetAt: (t) => (t > 12.24 && t < 12.26 ? true : null) });
    expect(Math.abs(bt.bpm - before) / before).toBeLessThan(0.01);
  });

  it('a tempo change needs repeated estimates before the lock follows it', () => {
    const bt = new BeatTracker();
    bt.bpm = 120;
    bt._followTempo(132, 6);
    expect(bt.bpm).toBe(120);
    bt._followTempo(132, 6);
    expect(bt.bpm).toBeGreaterThan(120);
    expect(bt.bpm).toBeLessThan(132);
  });

  it('a 0.5% wobble around the lock is ignored entirely', () => {
    const bt = new BeatTracker();
    bt.bpm = 120;
    for (let i = 0; i < 10; i++) bt._followTempo(i % 2 ? 120.5 : 119.5, 6);
    expect(bt.bpm).toBe(120);
  });

  it('octave hysteresis: a double-time estimate is only followed when nearer 120 by a margin', () => {
    const bt = new BeatTracker();
    bt.bpm = 90;
    for (let i = 0; i < 6; i++) bt._followTempo(180, 6);
    expect(bt.bpm).toBe(90);

    bt.bpm = 180;
    for (let i = 0; i < 3; i++) bt._followTempo(90, 6);
    expect(bt.bpm).toBe(90);

    // back toward 180 must not flip the lock again
    for (let i = 0; i < 6; i++) bt._followTempo(180, 6);
    expect(bt.bpm).toBe(90);
  });

  it('confidence eases toward each estimate instead of jumping', () => {
    const bt = new BeatTracker();
    bt.bpm = 120;
    bt.confidence = 0.2;
    bt._intervals.fill(0.5);
    bt._intervalCount = 24;
    bt._estimateTempo();
    // a full cluster targets 1.0; one estimate moves 30% of the way there
    expect(bt.confidence).toBeCloseTo(0.2 + (1 - 0.2) * 0.3, 6);
    expect(bt.bpm).toBe(120);
  });
});

describe('beat count', () => {
  it('counts each grid beat once, so 120 BPM over 10s is about 20 beats', () => {
    const bt = new BeatTracker();
    feed(bt, { to: 6, spacing: 0.5 });
    expect(bt.bpm).toBeGreaterThan(0);
    const start = bt.beats;
    feed(bt, { from: 6.02, to: 16, spacing: 0.5 });
    const delta = bt.beats - start;
    expect(delta).toBeGreaterThanOrEqual(18);
    expect(delta).toBeLessThanOrEqual(22);
    expect(Number.isInteger(bt.beats)).toBe(true);
  });

  it('never goes backwards across a lock loss', () => {
    const bt = new BeatTracker();
    feed(bt, { to: 6, spacing: 0.5 });
    const before = bt.beats;
    bt.process(new Uint8Array(64).fill(40), 20);
    expect(bt.bpm).toBe(0);
    expect(bt.beats).toBe(before);
  });
});

describe('settle and jump', () => {
  function burst(bt, from, to) {
    let peak = 0;
    const loud = new Uint8Array(64).fill(20);
    const quiet = new Uint8Array(64).fill(200);
    let i = 0;
    for (let t = from; t <= to; t += 1 / 60) {
      bt.process(i++ % 2 ? loud : quiet, t);
      peak = Math.max(peak, bt.pulse);
    }
    return peak;
  }

  it('ignores onsets for the settle window after a resume', () => {
    const control = new BeatTracker();
    expect(burst(control, 0, 0.5)).toBeGreaterThan(0);

    const bt = new BeatTracker();
    bt.settle(0.6);
    expect(burst(bt, 0, 0.5)).toBe(0);
    expect(bt.bpm).toBe(0);
  });

  it('hears onsets again once the settle window has passed', () => {
    const bt = new BeatTracker();
    bt.settle(0.3);
    expect(burst(bt, 0, 0.25)).toBe(0);
    expect(burst(bt, 0.6, 1.2)).toBeGreaterThan(0);
  });

  it('a loop jump keeps the locked grid instead of resetting it', () => {
    const bt = new BeatTracker();
    feed(bt, { to: 10, spacing: 0.5 });
    const bpm = bt.bpm;
    bt.jumpTo(4.0);
    expect(bt.bpm).toBe(bpm);
    feed(bt, { from: 4.02, to: 5, spacing: 0.5 });
    expect(bt.bpm).toBeGreaterThan(0);
  });
});

/*
 * 120 BPM pulse train fed at 60Hz with a bass level per frame. Beat n sits at
 * n * 0.5s; bass is loud near every beat, louder when accent(n) is true.
 * Returns one record per frame.
 */
function accentTrain(bt, { to, accent = (n) => n % 4 === 0, from = 0 }) {
  const hit = new Uint8Array(64).fill(40);
  for (let i = 0; i < 16; i++) hit[i] = 220;
  const rest = new Uint8Array(64).fill(40);
  const out = [];
  for (let t = from; t <= to; t += 1 / 60) {
    const n = Math.round(t / 0.5);
    const d = Math.abs(t - n * 0.5);
    const near = d < 0.08;
    bt.process(d < (1 / 60) * 0.6 ? hit : rest, t, 0, near ? (accent(n) ? 1 : 0.47) : 0.05);
    out.push({ t, n, bar: bt.beatInBar, beats: bt.beats, bpm: bt.bpm });
  }
  return out;
}

/* The frame at 0.12s after each beat, where the grid reads that beat. */
const onBeat = (frames) => frames.filter((f) => Math.abs(f.t - (f.n * 0.5 + 0.12)) < 1 / 120);

describe('downbeat', () => {
  it('reads no bar position with no tempo', () => {
    expect(new BeatTracker().beatInBar).toBe(0);
  });

  it('puts the accented beat on 0 after a few bars of an every-fourth accent', () => {
    const bt = new BeatTracker();
    const beats = onBeat(accentTrain(bt, { to: 24 })).filter((f) => f.n >= 16);
    expect(beats.length).toBeGreaterThan(20);
    const offset = (beats[0].bar - beats[0].n) & 3;
    for (const f of beats) {
      expect((f.bar - f.n) & 3).toBe(offset);          // one consistent bar grid
      if (f.n % 4 === 0) expect(f.bar).toBe(0);         // the accent lands on 0
    }
  });

  it('keeps the bar on the accent when the accent falls on another slot', () => {
    const bt = new BeatTracker();
    const beats = onBeat(accentTrain(bt, { to: 24, accent: (n) => n % 4 === 2 })).filter((f) => f.n >= 16);
    for (const f of beats) if (f.n % 4 === 2) expect(f.bar).toBe(0);
  });

  it('a steady, unaccented train never moves the bar', () => {
    const bt = new BeatTracker();
    const frames = accentTrain(bt, { to: 16, accent: () => false }).filter((f) => f.bpm > 0);
    expect(frames.length).toBeGreaterThan(200);
    // the bar offset against the beat count is fixed for the whole run
    const offset = (frames[0].bar - frames[0].beats) & 3;
    for (const f of frames) expect((f.bar - f.beats) & 3).toBe(offset);
  });
});

describe('beat stability', () => {
  it('beatCount never goes backwards, including a backward jump', () => {
    const bt = new BeatTracker();
    const first = accentTrain(bt, { to: 10 });
    bt.jumpTo(2.0);
    const second = accentTrain(bt, { from: 2.02, to: 6 });
    const all = [...first, ...second];
    for (let i = 1; i < all.length; i++) expect(all[i].beats).toBeGreaterThanOrEqual(all[i - 1].beats);
  });

  it('beatInBar moves one step for each counted beat, except at an explicit jump', () => {
    const bt = new BeatTracker();
    const frames = accentTrain(bt, { to: 30 });
    let mismatches = 0;
    let lastMismatchT = -1;
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1];
      const b = frames[i];
      if (a.bpm <= 0 || b.bpm <= 0) continue;
      const beatStep = b.beats - a.beats;
      if (((b.bar - a.bar) - beatStep) & 3) { mismatches++; lastMismatchT = b.t; }
    }
    // the only allowed bar move is the one that lands the downbeat, and it
    // must come during the warm-up, not once the bar is established
    expect(mismatches).toBeLessThanOrEqual(1);
    expect(lastMismatchT).toBeLessThan(10);
  });

  it('a loop jump keeps beatInBar where the same song position was', () => {
    const bt = new BeatTracker();
    const first = onBeat(accentTrain(bt, { to: 12 }));
    const at8 = first.find((f) => f.n === 16);   // beat 16 (8.0s) is an accent
    expect(at8.bar).toBe(0);
    const bpm = bt.bpm;
    // loop back to 8.0s: the grid stays locked and the same beat reads the same
    bt.jumpTo(8.0);
    const again = onBeat(accentTrain(bt, { from: 8.02, to: 8.14 }));
    expect(bt.bpm).toBe(bpm);
    expect(again.find((f) => f.n === 16)?.bar).toBe(at8.bar);
  });
});
