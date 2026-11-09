/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAutoplayGuard } from '../src/autoplay.js';

beforeEach(() => { document.body.innerHTML = ''; });

function setup(state = 'suspended') {
  const ctx = {
    state,
    resume: vi.fn(() => { ctx.state = 'running'; return Promise.resolve(); }),
  };
  const engine = { ctx, playing: false, play: vi.fn() };
  const toast = vi.fn();
  const refreshStatus = vi.fn();
  const guard = createAutoplayGuard({ engine, toast, refreshStatus });
  return { engine, toast, refreshStatus, guard };
}

describe('autoplay guard', () => {
  it('resumes a suspended context on the next pointer gesture', async () => {
    const { engine, toast, refreshStatus, guard } = setup();
    guard.ensureAudible();
    expect(toast).toHaveBeenCalled();
    window.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.ctx.resume).toHaveBeenCalled();
    expect(engine.play).toHaveBeenCalled();
    expect(refreshStatus).toHaveBeenCalled();
  });

  it('does nothing when the context is already running', () => {
    const { toast, guard } = setup('running');
    guard.ensureAudible();
    expect(toast).not.toHaveBeenCalled();
  });

  it('does nothing before an AudioContext exists', () => {
    const engine = { ctx: null, play: vi.fn() };
    const toast = vi.fn();
    const guard = createAutoplayGuard({ engine, toast, refreshStatus: vi.fn() });
    guard.ensureAudible();
    expect(toast).not.toHaveBeenCalled();
  });

  it('keeps listening when resume does not actually start the context', async () => {
    const { engine, guard } = setup();
    /* simulate a strict browser: resume() resolves but the context stays
       suspended. The guard must stay armed for the next gesture. */
    let attempts = 0;
    engine.ctx.resume = vi.fn(() => {
      attempts++;
      if (attempts > 1) engine.ctx.state = 'running';
      return Promise.resolve();
    });
    guard.ensureAudible();
    window.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve(); await Promise.resolve();
    expect(engine.play).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('keydown'));
    await Promise.resolve(); await Promise.resolve();
    expect(engine.ctx.resume).toHaveBeenCalledTimes(2);
    expect(engine.play).toHaveBeenCalledTimes(1);
  });

  it('keeps listening when resume rejects', async () => {
    const { engine, guard } = setup();
    let attempts = 0;
    engine.ctx.resume = vi.fn(() => {
      attempts++;
      if (attempts === 1) return Promise.reject(new Error('blocked'));
      engine.ctx.state = 'running';
      return Promise.resolve();
    });
    guard.ensureAudible();
    window.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve(); await Promise.resolve();
    expect(engine.play).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve(); await Promise.resolve();
    expect(engine.play).toHaveBeenCalledTimes(1);
  });
});
