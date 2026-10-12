/**
 * Drop detection on synthetic arrangements. The failure modes worth pinning:
 * never fires on constant loudness, fires once (not per bar) after a real
 * breakdown, resets on seeks, and the envelope actually decays.
 */
import { describe, it, expect } from 'vitest';
import { DropDetector, collectDroppedFiles, isMediaFile } from '../src/drop.js';

/** Feed a bass level at 60fps starting from t=1 (after leading silence). */
function run(det, steps, bassAt) {
  let out = 0;
  for (let i = 0; i < steps; i++) {
    const t = 1 + i / 60;
    /* the engine's broadband level always carries the bass band, so the
       test level tracks the bass steps the way real frames do — a flat
       level would read as zero rise-rate and never confirm a slam */
    out = det.process(bassAt(t), 0.12 + bassAt(t) * 0.75, t);
  }
  return out;
}

describe('DropDetector', () => {
  it('stays silent on constant loudness', () => {
    const det = new DropDetector();
    expect(run(det, 60 * 20, () => 0.6)).toBe(0);
  });

  it('fires after a breakdown → slam and decays afterwards', () => {
    const det = new DropDetector();
    /* 4s loud, 2s breakdown, loud again */
    const bass = (t) => (t < 5 ? 0.6 : t < 7 ? 0.1 : 0.7);
    const level = (t) => 0.12 + bass(t) * 0.75;
    let peak = 0;
    let tFire = -1;
    for (let i = 0; i < 60 * 12; i++) {
      const t = 1 + i / 60;
      const d = det.process(bass(t), level(t), t);
      if (d > peak) { peak = d; tFire = t; }
    }
    expect(peak).toBe(1);
    expect(tFire).toBeGreaterThanOrEqual(7);  // fires when the slam lands
    expect(tFire).toBeLessThan(7.5);
    /* envelope decays: ~1s later it is well under half */
    const after = det.process(bass(8.6), level(8.6), 8.6);
    expect(after).toBeLessThan(0.5);
  });

  it('does not re-fire every bar of the same breakdown', () => {
    const det = new DropDetector({ cooldownSec: 10 });
    const bass = (t) => (t < 5 ? 0.6 : t < 7 ? 0.1 : t < 20 ? 0.7 : 0.1);
    let fires = 0;
    let wasZero = true;
    for (let i = 0; i < 60 * 25; i++) {
      const t = 1 + i / 60;
      const d = det.process(bass(t), 0.12 + bass(t) * 0.75, t);
      if (d > 0.9 && wasZero) { fires++; wasZero = false; }
      if (d === 0) wasZero = true;
    }
    expect(fires).toBe(1);
  });

  it('ignores a surge with no breakdown before it', () => {
    const det = new DropDetector();
    const bass = (t) => (t < 5 ? 0.25 : 0.9);   // jump, but never quiet
    let peak = 0;
    for (let i = 0; i < 60 * 10; i++) {
      const t = 1 + i / 60;
      peak = Math.max(peak, det.process(bass(t), 0.12 + bass(t) * 0.75, t));
    }
    expect(peak).toBe(0);
  });

  it('resets on a backwards seek', () => {
    const det = new DropDetector();
    const bass = (t) => (t < 5 ? 0.6 : t < 7 ? 0.1 : 0.7);
    run(det, 60 * 8, bass);            // through the first drop
    det.process(0.1, 0.5, 5.5);        // seek back into the breakdown
    expect(det._t).toBe(5.5);
    expect(det._quiet).toBe(0);        // armed state was wiped
  });

  it('survives NaN frames without poisoning the envelope', () => {
    const det = new DropDetector();
    det.process(0.5, 0.5, 1);
    expect(det.process(NaN, 0.5, 1.02)).toBe(0);
    expect(det.process(0.5, 0.5, 1.04)).toBe(0);
  });

  it('fires on a realistic smoothed slam, not just instant steps', () => {
    /* The old gate read only the single frame bass climbed back past the
       baseline, so a slam smeared over several frames by analyser smoothing
       disarmed the detector on its first rising frame and never fired. The
       arming now latches through the rise: an exponential return (tau 80ms,
       as a smoothed kick reads) must still fire. */
    const det = new DropDetector();
    const bass = (t) => {
      if (t < 5) return 0.6;
      if (t < 7) return 0.1;
      return 0.1 + (0.7 - 0.1) * (1 - Math.exp(-(t - 7) / 0.08));
    };
    let peak = 0;
    let tFire = -1;
    for (let i = 0; i < 60 * 12; i++) {
      const t = 1 + i / 60;
      const d = det.process(bass(t), 0.12 + bass(t) * 0.75, t);
      if (d > peak) { peak = d; tFire = t; }
    }
    expect(peak).toBe(1);
    expect(tFire).toBeGreaterThanOrEqual(7);
    expect(tFire).toBeLessThan(8);
  });

  it('does not fire on a slow swell back after a breakdown', () => {
    /* Same shape as a drop but with a 5-second linear fade instead of a
       slam: the return crosses the baseline inside the grace window, but
       the rise rate never reads as an impact, so the choreography stays
       off. A fade-in is not a drop. */
    const det = new DropDetector();
    const bass = (t) => {
      if (t < 5) return 0.6;
      if (t < 7) return 0.1;
      if (t < 12) return 0.1 + (0.7 - 0.1) * ((t - 7) / 5);
      return 0.7;
    };
    let peak = 0;
    for (let i = 0; i < 60 * 15; i++) {
      const t = 1 + i / 60;
      peak = Math.max(peak, det.process(bass(t), 0.12 + bass(t) * 0.75, t));
    }
    expect(peak).toBe(0);
  });
});

/* ---------- dropped files and folders ---------- */

/* Minimal FileSystemEntry stand-ins. readEntries hands out children in
   batches of two, then an empty batch, so the batching loop is exercised. */
function fileEntry(name, { fail = false } = {}) {
  return {
    isFile: true, isDirectory: false, name,
    file(ok, err) { if (fail) err(new Error('unreadable')); else ok({ name }); },
  };
}
function dirEntry(name, children = []) {
  return {
    isFile: false, isDirectory: true, name,
    createReader() {
      let pos = 0;
      return {
        readEntries(ok) {
          const batch = children.slice(pos, pos + 2);
          pos += batch.length;
          ok(batch);
        },
      };
    },
  };
}
/** A DataTransfer with one item per top-level dropped entry. */
const dropOf = (...entries) => ({
  files: [],
  items: entries.map((e) => ({ kind: 'file', webkitGetAsEntry: () => e })),
});
const namesOf = (files) => files.map((f) => f.name);

describe('isMediaFile', () => {
  it('accepts known audio and video extensions, whatever the MIME type says', () => {
    expect(isMediaFile({ name: 'a.FLAC', type: '' })).toBe(true);
    expect(isMediaFile({ name: 'clip.mp4', type: '' })).toBe(true);
    expect(isMediaFile({ name: 'song', type: 'audio/x-unknown' })).toBe(true);
  });

  it('refuses playlists and documents', () => {
    expect(isMediaFile({ name: 'list.m3u', type: '' })).toBe(false);
    expect(isMediaFile({ name: 'notes.txt', type: 'text/plain' })).toBe(false);
  });
});

describe('collectDroppedFiles', () => {
  it('returns plain dropped files as they came', async () => {
    const a = { name: 'a.mp3' };
    const b = { name: 'b.txt' };
    const files = await collectDroppedFiles({ files: [a, b], items: [] });
    expect(files).toEqual([a, b]);
  });

  it('walks a dropped folder, keeping media in name order and skipping the rest', async () => {
    const root = dirEntry('Album', [
      fileEntry('b.flac'),
      fileEntry('cover.jpg'),
      fileEntry('a.mp3'),
      dirEntry('Bonus', [fileEntry('clip.mp4'), fileEntry('readme.txt')]),
    ]);
    const files = await collectDroppedFiles(dropOf(root));
    expect(namesOf(files)).toEqual(['a.mp3', 'b.flac', 'clip.mp4']);
  });

  it('stops descending after four levels below the dropped folder', async () => {
    // f0 sits in the dropped folder, f3 four levels down; f4 is one level deeper than the walk goes
    let dir = dirEntry('d4', [fileEntry('f4.mp3')]);
    for (let k = 3; k >= 0; k--) dir = dirEntry(`d${k}`, [fileEntry(`f${k}.mp3`), dir]);
    const files = await collectDroppedFiles(dropOf(dir));
    // nested folders are walked in name order, so compare as a set
    expect(namesOf(files).sort()).toEqual(['f0.mp3', 'f1.mp3', 'f2.mp3', 'f3.mp3']);
  });

  it('caps a walk at 500 files', async () => {
    const many = Array.from({ length: 600 }, (_, i) => fileEntry(`t${String(i).padStart(3, '0')}.mp3`));
    const files = await collectDroppedFiles(dropOf(dirEntry('Big', many)));
    expect(files).toHaveLength(500);
    expect(files[0].name).toBe('t000.mp3');
  });

  it('skips a file the browser refuses to open, rather than failing the drop', async () => {
    const root = dirEntry('Mixed', [fileEntry('bad.mp3', { fail: true }), fileEntry('good.mp3')]);
    const files = await collectDroppedFiles(dropOf(root));
    expect(namesOf(files)).toEqual(['good.mp3']);
  });

  it('falls back to the plain file list when the browser has no entry API', async () => {
    const a = { name: 'a.wav' };
    const files = await collectDroppedFiles({ files: [a], items: [{ kind: 'file' }] });
    expect(files).toEqual([a]);
  });
});
