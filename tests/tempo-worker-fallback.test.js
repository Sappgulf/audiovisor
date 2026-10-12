import { describe, it, expect, vi, afterEach } from 'vitest';
import { analyzeTempo, analyzeTempoAsync } from '../src/tempo-analysis.js';

/* a clicking bass line, long enough for the offline analysis to run */
function clicks(sampleRate = 22050, seconds = 8) {
  const out = new Float32Array(sampleRate * seconds);
  for (let t = 0; t < seconds; t += 0.5) {
    const at = Math.floor(t * sampleRate);
    for (let i = 0; i < 600 && at + i < out.length; i++) {
      out[at + i] = Math.sin(i * 0.2) * Math.exp(-i / 120);
    }
  }
  return out;
}

const samples = clicks();

afterEach(() => vi.unstubAllGlobals());

describe('analyzeTempoAsync worker failures', () => {
  it('a worker that refuses the message falls back to the synchronous pass and is shut down', async () => {
    const made = [];
    class RefusingWorker {
      constructor() { made.push(this); }
      postMessage() { throw new Error('DataCloneError'); }
      terminate() { this.terminated = true; }
    }
    vi.stubGlobal('Worker', RefusingWorker);
    await expect(analyzeTempoAsync(samples, 22050)).resolves.toEqual(analyzeTempo(samples, 22050));
    expect(made).toHaveLength(1);
    expect(made[0].terminated).toBe(true);
  });

  it('a worker that answers resolves with its result and is shut down', async () => {
    const made = [];
    class AnsweringWorker {
      constructor() { made.push(this); }
      postMessage() { setTimeout(() => this.onmessage?.({ data: { bpm: 120, confidence: 0.9 } })); }
      terminate() { this.terminated = true; }
    }
    vi.stubGlobal('Worker', AnsweringWorker);
    await expect(analyzeTempoAsync(samples, 22050)).resolves.toEqual({ bpm: 120, confidence: 0.9 });
    expect(made[0].terminated).toBe(true);
  });

  it('a worker that errors falls back to the synchronous pass', async () => {
    class ErroringWorker {
      postMessage() { setTimeout(() => this.onerror?.(new Event('error'))); }
      terminate() { this.terminated = true; }
    }
    vi.stubGlobal('Worker', ErroringWorker);
    await expect(analyzeTempoAsync(samples, 22050)).resolves.toEqual(analyzeTempo(samples, 22050));
  });
});
