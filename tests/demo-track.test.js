import { describe, it, expect } from 'vitest';
import { renderDemoTrack, DEMO_BPM, DEMO_META } from '../src/demo-track.js';

function fakeCtx(sampleRate = 44100) {
  return {
    sampleRate,
    createBuffer(channels, length, rate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate: rate,
        duration: length / rate,
        getChannelData: (i) => data[i],
      };
    },
  };
}

describe('demo track', () => {
  it('renders a stereo loop at the advertised tempo', () => {
    const buf = renderDemoTrack(fakeCtx());
    const expected = (60 / DEMO_BPM) * 4 * 8;
    expect(buf.numberOfChannels).toBe(2);
    expect(buf.duration).toBeCloseTo(expected, 2);
    expect(DEMO_META.demo).toBe(true);
  });

  it('has a kick on the downbeat and stays inside unity', () => {
    const buf = renderDemoTrack(fakeCtx());
    const L = buf.getChannelData(0);
    const sr = buf.sampleRate;
    let peak = 0;
    let kick = 0;
    const kickN = Math.floor(sr * 0.04);
    for (let i = 0; i < L.length; i++) {
      const a = Math.abs(L[i]);
      if (a > peak) peak = a;
      if (i < kickN) kick += a;
    }
    expect(peak).toBeLessThanOrEqual(1);
    expect(peak).toBeGreaterThan(0.4);
    expect(kick / kickN).toBeGreaterThan(0.05);
  });
});