import { describe, it, expect, vi } from 'vitest';
import { createTempoPrime } from '../src/tempo-prime.js';

const SR = 44100;

function clickTrack(bpm, seconds) {
  const n = Math.floor(seconds * SR);
  const out = new Float32Array(n);
  const period = Math.floor((60 / bpm) * SR);
  for (let start = 0; start < n; start += period) {
    for (let i = 0; i < SR * 0.06 && start + i < n; i++) {
      out[start + i] += 0.9 * Math.exp(-i / (SR * 0.012)) * Math.sin((2 * Math.PI * 90 * i) / SR);
    }
  }
  return out;
}

function makeEngine(buffer, track) {
  const handlers = {};
  return {
    mode: 'file',
    buffer,
    track,
    on(evt, cb) { handlers[evt] = cb; },
    emit(evt) { handlers[evt]?.(); },
  };
}

describe('createTempoPrime', () => {
  it('analyses a loaded track and stores its tempo', async () => {
    const samples = clickTrack(120, 12);
    const buffer = { length: samples.length, sampleRate: SR, getChannelData: () => samples };
    const engine = makeEngine(buffer, { name: 'clicky' });
    const state = { analyzedBpm: 0 };
    createTempoPrime({ engine, state });

    engine.emit('source');
    await new Promise((r) => setTimeout(r, 0));
    expect(state.analyzedBpm).toBeGreaterThan(0);
    expect(Math.abs(state.analyzedBpm - 120)).toBeLessThan(4);
  });

  it('ignores non-file sources', async () => {
    const samples = clickTrack(120, 12);
    const buffer = { length: samples.length, sampleRate: SR, getChannelData: () => samples };
    const engine = makeEngine(buffer, { name: 'clicky' });
    engine.mode = 'stream';
    const state = { analyzedBpm: 0 };
    createTempoPrime({ engine, state });
    engine.emit('source');
    await new Promise((r) => setTimeout(r, 0));
    expect(state.analyzedBpm).toBe(0);
  });

  it('only analyses the same track once', async () => {
    const samples = clickTrack(120, 12);
    const spy = vi.fn(() => samples);
    const engine = makeEngine({ length: samples.length, sampleRate: SR, getChannelData: spy }, { name: 'clicky' });
    const state = { analyzedBpm: 0 };
    createTempoPrime({ engine, state });
    engine.emit('source');
    await new Promise((r) => setTimeout(r, 0));
    engine.emit('source');
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
